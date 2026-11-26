import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeTokenSha256Hex,
  generateRandomToken32,
} from "@/features/reminders/crypto";
import { evaluateReminderEligibility } from "@/features/reminders/eligibility";
import {
  isDeliveryPermittedByMode,
  parseSmokeAllowlist,
  type SmokeAllowlistTuple,
} from "@/features/reminders/smoke";
import type {
  Database,
  EventStatus,
  ReminderKind,
  TrackingState,
} from "@/lib/database.types";

export const APPLICATION_WORK_BUDGET_MS = 35_000; // 35s work budget inside 60s Vercel maxDuration
const MAX_RETRY_HORIZON_MS = 23 * 60 * 60 * 1000; // 23 hours from first attempt
const RETRY_BACKOFF_MINUTES = [5, 15, 60] as const;

export interface FrozenResendPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
  headers: {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click";
  };
}

export type ProviderSendResult =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "definitive_rejection"; errorCode: string }
  | {
      kind: "transient_failure";
      ambiguousSend: boolean;
      retryAfterSeconds: number | null;
      errorCode: string;
    };

export type ResendSender = (args: {
  idempotencyKey: string;
  apiKey: string;
  payload: FrozenResendPayload;
}) => Promise<ProviderSendResult>;

/**
 * Default Resend HTTPS API dispatcher with 10s per-call timeout and Retry-After parsing.
 */
export const defaultResendSender: ResendSender = async ({
  idempotencyKey,
  apiKey,
  payload,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.ok) {
      const body = (await res.json()) as { id?: string };
      if (body.id && typeof body.id === "string") {
        return { kind: "accepted", providerMessageId: body.id };
      }
      return {
        kind: "transient_failure",
        ambiguousSend: true,
        retryAfterSeconds: null,
        errorCode: "PROVIDER_MALFORMED_2XX",
      };
    }

    const retryAfterHeader = res.headers.get("retry-after");
    const parsedRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const retryAfterSeconds =
      Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
        ? Math.ceil(parsedRetryAfter)
        : null;

    if (res.status === 429 || res.status >= 500) {
      return {
        kind: "transient_failure",
        // HTTP 429 or 5xx before acceptance; 5xx may be ambiguous at edge, 429 is pre-send rate limit
        ambiguousSend: res.status >= 500,
        retryAfterSeconds,
        errorCode: res.status === 429 ? "PROVIDER_429" : `PROVIDER_${res.status}`,
      };
    }

    return {
      kind: "definitive_rejection",
      errorCode: `PROVIDER_${res.status}`,
    };
  } catch {
    // Network error or abort timeout: send outcome is ambiguous (`may_have_sent` stays true)
    return {
      kind: "transient_failure",
      ambiguousSend: true,
      retryAfterSeconds: null,
      errorCode: "PROVIDER_TIMEOUT_OR_NETWORK",
    };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Computes next retry timestamp per ARCHITECTURE.md line 179:
 * - Backoff 5, 15, and 60 minutes for attempts 1, 2, 3.
 * - Honors a longer provider `Retry-After` delay ONLY if it fits before `expiresAt`
 *   and within 23 hours of `firstAttemptAt`.
 * - Returns `null` when no safe retry remains.
 */
export function computeNextRetryTimestamp(args: {
  attemptCount: number;
  now: Date;
  firstAttemptAt: Date;
  expiresAt: Date;
  providerRetryAfterSeconds: number | null;
}): Date | null {
  if (args.attemptCount < 1 || args.attemptCount > RETRY_BACKOFF_MINUTES.length) {
    return null;
  }

  const baseMinutes = RETRY_BACKOFF_MINUTES[args.attemptCount - 1]!;
  const baseDelayMs = baseMinutes * 60_000;
  const providerDelayMs =
    args.providerRetryAfterSeconds && args.providerRetryAfterSeconds > 0
      ? args.providerRetryAfterSeconds * 1000
      : 0;

  const chosenDelayMs = Math.max(baseDelayMs, providerDelayMs);
  const candidateMs = args.now.getTime() + chosenDelayMs;
  const horizonMs = args.firstAttemptAt.getTime() + MAX_RETRY_HORIZON_MS;

  if (candidateMs >= args.expiresAt.getTime() || candidateMs >= horizonMs) {
    return null;
  }

  return new Date(candidateMs);
}

/**
 * Builds escaped plain-text reminder email payload and RFC 8058 one-click headers.
 */
export function buildReminderEmailPayload(args: {
  appOrigin: string;
  fromEmail: string;
  recipientEmail: string;
  kind: ReminderKind;
  eventId: string;
  eventTitle: string;
  eventOrganizer: string;
  targetAtIso: string;
  rawUnsubscribeToken: string;
}): FrozenResendPayload {
  const cleanOrigin = args.appOrigin.replace(/\/+$/, "");
  const detailUrl = `${cleanOrigin}/events/${encodeURIComponent(args.eventId)}`;
  const postUnsubscribeUrl = `${cleanOrigin}/api/reminders/unsubscribe?token=${encodeURIComponent(
    args.rawUnsubscribeToken
  )}`;
  const confirmUnsubscribeUrl = `${cleanOrigin}/unsubscribe?token=${encodeURIComponent(
    args.rawUnsubscribeToken
  )}`;

  const safeTitle = args.eventTitle.replace(/[\r\n]+/g, " ").trim();
  const safeOrganizer = args.eventOrganizer.replace(/[\r\n]+/g, " ").trim();
  const formattedTargetIst = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(args.targetAtIso));

  const subject =
    args.kind === "deadline"
      ? `Registration deadline soon: ${safeTitle}`
      : `Upcoming event reminder: ${safeTitle}`;

  const introLine =
    args.kind === "deadline"
      ? `Registration closes around ${formattedTargetIst} IST for an event you saved on Tech Event Discover.`
      : `An event you marked Registered on Tech Event Discover starts around ${formattedTargetIst} IST.`;

  const text = [
    introLine,
    "",
    `Event: ${safeTitle}`,
    `Organizer: ${safeOrganizer}`,
    `Details & official link: ${detailUrl}`,
    "",
    "---",
    `Manage reminder preferences: ${cleanOrigin}/settings`,
    `Unsubscribe from event reminders: ${confirmUnsubscribeUrl}`,
  ].join("\n");

  return {
    from: args.fromEmail,
    to: args.recipientEmail,
    subject,
    text,
    headers: {
      "List-Unsubscribe": `<${postUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

interface ClaimedDeliveryRow {
  delivery_id: string;
  user_id: string;
  event_id: string;
  kind: ReminderKind;
  target_at: string;
  due_at: string;
  expires_at: string;
  attempt_count: number;
  first_attempt_at: string;
  may_have_sent: boolean;
  pending_payload: FrozenResendPayload | null;
  unsubscribe_token_digest: string | null;
  unsubscribe_expires_at: string | null;
  consent_version_at_send: number | null;
  current_verified_email: string | null;
  has_verified_recipient: boolean;
  deletion_or_ineligible_account: boolean;
  has_active_suppression: boolean;
  opt_in_enabled: boolean;
  current_consent_version: number;
  tracking_state: TrackingState | null;
  event_status: EventStatus;
  event_title: string | null;
  event_organizer: string | null;
  event_timezone: string | null;
  event_is_all_day: boolean | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_start_on: string | null;
  event_end_on: string | null;
  event_registration_deadline_at: string | null;
  event_registration_deadline_on: string | null;
  event_registration_closed: boolean;
  event_reminder_hold: boolean;
}

export interface ReminderWorkerConfig {
  appOrigin: string;
  sendEnabled: boolean;
  deliveryMode: "smoke" | "live";
  smokeAllowlistRaw: string;
  recipientDigestKey: string;
  resendApiKey: string;
  reminderFromEmail: string;
  heartbeatUrl: string | null;
}

export interface ReminderWorkerRunSummary {
  materialized: number;
  expiredSweep: number;
  claimed: number;
  accepted: number;
  retried: number;
  requeuedPending: number;
  suppressed: number;
  expired: number;
  failed: number;
  unknown: number;
  killSwitchActive: boolean;
  healthy: boolean;
}

/**
 * Executes one bounded reminder worker tick (claim <= 10, recheck eligibility at provider boundary,
 * freeze payload, send with provider idempotency, finalize attempt-checked lease, and ping monitor).
 */
export async function executeReminderWorkerBatch(args: {
  supabase: SupabaseClient<Database>;
  config: ReminderWorkerConfig;
  sender?: ResendSender;
  clock?: () => Date;
  pingFetch?: typeof fetch;
}): Promise<ReminderWorkerRunSummary> {
  const getNow = args.clock ?? (() => new Date());
  const sender = args.sender ?? defaultResendSender;
  const pingFetch = args.pingFetch ?? fetch;
  const startedMs = getNow().getTime();

  const summary: ReminderWorkerRunSummary = {
    materialized: 0,
    expiredSweep: 0,
    claimed: 0,
    accepted: 0,
    retried: 0,
    requeuedPending: 0,
    suppressed: 0,
    expired: 0,
    failed: 0,
    unknown: 0,
    killSwitchActive: !args.config.sendEnabled,
    healthy: true,
  };

  // Independent kill switch (`REMINDER_SEND_ENABLED=false` pauses final sends cleanly)
  if (!args.config.sendEnabled) {
    await sendSafeMonitorPing({
      heartbeatUrl: args.config.heartbeatUrl,
      healthy: true,
      checkId: "reminders_paused",
      pingFetch,
    });
    return summary;
  }

  let smokeTuples: SmokeAllowlistTuple[] | null = null;
  if (args.config.deliveryMode === "smoke") {
    const parsedSmoke = parseSmokeAllowlist(args.config.smokeAllowlistRaw);
    if (!parsedSmoke.ok) {
      // Missing or invalid smoke configuration stops sending (ARCHITECTURE.md line 187)
      summary.healthy = false;
      await sendSafeMonitorPing({
        heartbeatUrl: args.config.heartbeatUrl,
        healthy: false,
        checkId: "reminders_invalid_smoke_config",
        pingFetch,
      });
      return summary;
    }
    smokeTuples = parsedSmoke.tuples;
  }

  const tickNowIso = getNow().toISOString();

  // 1. Materialize due candidates (Smoke Check #1 inside SQL)
  const { data: matData, error: matErr } = await args.supabase.rpc(
    "materialize_due_reminder_deliveries" as never,
    {
      p_delivery_mode: args.config.deliveryMode,
      p_smoke_allowlist: smokeTuples,
      p_digest_key: args.config.recipientDigestKey,
      p_now: tickNowIso,
    } as never
  );

  if (matErr) {
    throw new Error(`MATERIALIZE_FAILED:${matErr.code ?? "SQL"}`);
  }

  const matRow = (
    matData as Array<{ materialized_count: number; expired_count: number }> | null
  )?.[0];
  summary.materialized = matRow?.materialized_count ?? 0;
  summary.expiredSweep = matRow?.expired_count ?? 0;

  // 2. Claim at most 10 rows with 90s lease (Smoke Check #2 inside SQL)
  const { data: claimedData, error: claimErr } = await args.supabase.rpc(
    "claim_due_reminder_deliveries" as never,
    {
      p_delivery_mode: args.config.deliveryMode,
      p_smoke_allowlist: smokeTuples,
      p_digest_key: args.config.recipientDigestKey,
      p_max_rows: 10,
      p_now: getNow().toISOString(),
    } as never
  );

  if (claimErr) {
    throw new Error(`CLAIM_FAILED:${claimErr.code ?? "SQL"}`);
  }

  const claimedRows = (claimedData ?? []) as ClaimedDeliveryRow[];
  summary.claimed = claimedRows.length;

  // 3. Process each claimed row within 35s work budget and <= 10 req/s pacing
  for (let idx = 0; idx < claimedRows.length; idx++) {
    const row = claimedRows[idx]!;
    const currentNow = getNow();
    if (currentNow.getTime() - startedMs >= APPLICATION_WORK_BUDGET_MS) {
      break;
    }

    // Pace calls <= 10 req/s (110ms spacing after first send)
    if (idx > 0 && !args.clock) {
      await new Promise((r) => setTimeout(r, 110));
    }

    // Smoke Check #3: Final pre-send allowlist recheck at provider boundary
    const allowedByMode = isDeliveryPermittedByMode(
      args.config.deliveryMode,
      args.config.smokeAllowlistRaw,
      {
        userId: row.user_id,
        eventId: row.event_id,
        kind: row.kind,
      }
    );

    if (!allowedByMode) {
      const outcome = row.may_have_sent ? "unknown" : "suppressed";
      await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: outcome,
          p_may_have_sent: row.may_have_sent,
          p_error_code: "SMOKE_ALLOWLIST_BLOCKED",
          p_now: currentNow.toISOString(),
        } as never
      );
      if (outcome === "unknown") summary.unknown++;
      else summary.suppressed++;
      continue;
    }

    // Check changed_verified_email_blocks_retry on retries with frozen payload
    if (row.pending_payload !== null) {
      const frozenRecipient = row.pending_payload.to.trim().toLowerCase();
      const latestVerified = row.current_verified_email?.trim().toLowerCase() ?? "";
      if (!latestVerified || frozenRecipient !== latestVerified) {
        const outcome = row.may_have_sent ? "unknown" : "suppressed";
        await args.supabase.rpc(
          "finalize_reminder_delivery_attempt" as never,
          {
            p_delivery_id: row.delivery_id,
            p_attempt_count: row.attempt_count,
            p_outcome: outcome,
            p_may_have_sent: row.may_have_sent,
            p_error_code: "RECIPIENT_CHANGED",
            p_now: currentNow.toISOString(),
          } as never
        );
        if (outcome === "unknown") summary.unknown++;
        else summary.suppressed++;
        continue;
      }
    }

    // Final provider-boundary eligibility recheck using TypeScript truth-table domain rule
    const recheck = evaluateReminderEligibility({
      trackingState: row.tracking_state,
      eventStatus: row.event_status,
      optIn: row.opt_in_enabled,
      reminderHold: row.event_reminder_hold,
      deletionPending: row.deletion_or_ineligible_account,
      hasVerifiedRecipient: row.has_verified_recipient,
      hasActiveSuppression: row.has_active_suppression,
      isAllDay: Boolean(row.event_is_all_day),
      startsAt: row.event_starts_at,
      endsAt: row.event_ends_at,
      startOn: row.event_start_on,
      endOn: row.event_end_on,
      eventTimezone: row.event_timezone,
      registrationDeadlineAt: row.event_registration_deadline_at,
      registrationDeadlineOn: row.event_registration_deadline_on,
      registrationClosed: row.event_registration_closed,
      now: currentNow,
    });

    const targetMatches =
      recheck.eligible &&
      recheck.kind === row.kind &&
      recheck.anchorAt === new Date(row.target_at).toISOString();

    if (!targetMatches) {
      const isExpiredNow = currentNow.getTime() >= Date.parse(row.expires_at);
      const beforeFirstProviderAttempt =
        row.pending_payload === null && !row.may_have_sent;

      let outcome: "pending" | "expired" | "suppressed" | "unknown";
      if (row.may_have_sent) {
        outcome = "unknown";
      } else if (isExpiredNow || recheck.reason === "too_late") {
        outcome = "expired";
      } else if (
        beforeFirstProviderAttempt &&
        (recheck.reason === "applicable_hold" || recheck.reason === "too_early") &&
        !row.has_active_suppression &&
        !row.deletion_or_ineligible_account
      ) {
        // Temporary eligibility loss (e.g. feed reminder_hold) before first attempt leaves candidate pending
        outcome = "pending";
      } else {
        outcome = "suppressed";
      }

      await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: outcome,
          p_may_have_sent: row.may_have_sent,
          p_error_code: `INELIGIBLE_${(recheck.reason ?? "TARGET_CHANGED").toUpperCase()}`,
          p_now: currentNow.toISOString(),
        } as never
      );

      if (outcome === "pending") summary.requeuedPending++;
      else if (outcome === "expired") summary.expired++;
      else if (outcome === "unknown") summary.unknown++;
      else summary.suppressed++;
      continue;
    }

    // Build payload & unsubscribe token on first attempt, or reuse frozen payload on retry
    const rawUnsubToken = generateRandomToken32();
    const candidateDigest = computeTokenSha256Hex(rawUnsubToken);
    const candidatePayload =
      row.pending_payload ??
      buildReminderEmailPayload({
        appOrigin: args.config.appOrigin,
        fromEmail: args.config.reminderFromEmail,
        recipientEmail: row.current_verified_email!,
        kind: row.kind,
        eventId: row.event_id,
        eventTitle: row.event_title ?? "Tech Event",
        eventOrganizer: row.event_organizer ?? "Organizer",
        targetAtIso: row.target_at,
        rawUnsubscribeToken: rawUnsubToken,
      });

    // Freeze payload, unsubscribe digest, and may_have_sent=true BEFORE calling Resend
    const { data: prepData, error: prepErr } = await args.supabase.rpc(
      "prepare_reminder_provider_attempt" as never,
      {
        p_delivery_id: row.delivery_id,
        p_attempt_count: row.attempt_count,
        p_pending_payload: candidatePayload,
        p_unsubscribe_token_digest: candidateDigest,
        p_consent_version_at_send: row.current_consent_version,
        p_now: getNow().toISOString(),
      } as never
    );

    const prepRow = (
      prepData as Array<{
        prepared: boolean;
        prior_may_have_sent: boolean;
        frozen_payload: FrozenResendPayload;
      }> | null
    )?.[0];

    if (prepErr || !prepRow?.prepared) {
      // Lease expired before dispatch; skip sending
      continue;
    }

    // Dispatch to Resend with delivery UUID as provider Idempotency-Key
    const sendResult = await sender({
      idempotencyKey: row.delivery_id,
      apiKey: args.config.resendApiKey,
      payload: prepRow.frozen_payload,
    });

    const finalizeNow = getNow();

    if (sendResult.kind === "accepted") {
      const { data: finalized } = await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: "accepted",
          p_may_have_sent: true,
          p_provider_message_id: sendResult.providerMessageId,
          p_now: finalizeNow.toISOString(),
        } as never
      );
      if (finalized) summary.accepted++;
      continue;
    }

    if (sendResult.kind === "definitive_rejection") {
      // Definitive rejection restores prior ambiguity flag
      const restoredAmbiguity = prepRow.prior_may_have_sent;
      const terminalOutcome = restoredAmbiguity ? "unknown" : "failed";
      const { data: finalized } = await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: terminalOutcome,
          p_may_have_sent: restoredAmbiguity,
          p_error_code: sendResult.errorCode,
          p_now: finalizeNow.toISOString(),
        } as never
      );
      if (finalized) {
        if (terminalOutcome === "unknown") summary.unknown++;
        else summary.failed++;
      }
      continue;
    }

    // Transient failure (timeout/network, 429, or 5xx)
    const effectiveAmbiguity = sendResult.ambiguousSend
      ? true
      : prepRow.prior_may_have_sent;

    const nextRetry = computeNextRetryTimestamp({
      attemptCount: row.attempt_count,
      now: finalizeNow,
      firstAttemptAt: new Date(row.first_attempt_at),
      expiresAt: new Date(row.expires_at),
      providerRetryAfterSeconds: sendResult.retryAfterSeconds,
    });

    if (nextRetry) {
      const { data: finalized } = await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: "retry",
          p_may_have_sent: effectiveAmbiguity,
          p_next_attempt_at: nextRetry.toISOString(),
          p_error_code: sendResult.errorCode,
          p_now: finalizeNow.toISOString(),
        } as never
      );
      if (finalized) summary.retried++;
    } else {
      // Retain ambiguous outcome as 'unknown' once no safe retry remains
      const terminalOutcome = effectiveAmbiguity ? "unknown" : "failed";
      const { data: finalized } = await args.supabase.rpc(
        "finalize_reminder_delivery_attempt" as never,
        {
          p_delivery_id: row.delivery_id,
          p_attempt_count: row.attempt_count,
          p_outcome: terminalOutcome,
          p_may_have_sent: effectiveAmbiguity,
          p_error_code: sendResult.errorCode,
          p_now: finalizeNow.toISOString(),
        } as never
      );
      if (finalized) {
        if (terminalOutcome === "unknown") summary.unknown++;
        else summary.failed++;
      }
    }
  }

  // 4. Check backlog (>10m) and unknown outcomes for external Healthchecks.io ping
  const { data: healthData } = await args.supabase.rpc(
    "get_reminder_health_summary" as never,
    { p_now: getNow().toISOString() } as never
  );

  const healthRow = (
    healthData as Array<{
      actionable_backlog_over_10m_count: number;
      unknown_outcome_count: number;
    }> | null
  )?.[0];

  const hasBacklogAlert = (healthRow?.actionable_backlog_over_10m_count ?? 0) > 0;
  const hasUnknownAlert =
    summary.unknown > 0 || (healthRow?.unknown_outcome_count ?? 0) > 0;
  const hasFailedAlert = summary.failed > 0;

  summary.healthy = !hasBacklogAlert && !hasUnknownAlert && !hasFailedAlert;

  await sendSafeMonitorPing({
    heartbeatUrl: args.config.heartbeatUrl,
    healthy: summary.healthy,
    checkId: summary.healthy ? "reminders_ok" : "reminders_degraded",
    pingFetch,
  });

  return summary;
}

async function sendSafeMonitorPing(args: {
  heartbeatUrl: string | null;
  healthy: boolean;
  checkId: string;
  pingFetch: typeof fetch;
}): Promise<void> {
  if (!args.heartbeatUrl || args.heartbeatUrl.includes("00000000-0000")) {
    return;
  }

  const baseUrl = args.heartbeatUrl.replace(/\/+$/, "");
  const targetUrl = args.healthy ? baseUrl : `${baseUrl}/fail`;

  try {
    await args.pingFetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      // Send ONLY safe status and check identifier (no personal data or provider diagnostics)
      body: `status=${args.healthy ? "ok" : "fail"} check=${args.checkId}`,
    });
  } catch {
    // Non-fatal if monitor endpoint is unreachable
  }
}
