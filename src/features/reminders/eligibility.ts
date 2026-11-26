import { Temporal } from "@js-temporal/polyfill";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEffectiveScheduleBounds } from "@/features/catalog/time";
import type {
  Database,
  EventStatus,
  ReminderKind,
  TrackingState,
} from "@/lib/database.types";

export type ReminderIneligibilityReason =
  | "untracked"
  | "inactive_status"
  | "opted_out"
  | "applicable_hold"
  | "no_exact_deadline"
  | "registration_closed"
  | "too_early"
  | "too_late";

export interface ReminderEligibilityInput {
  trackingState: TrackingState | null;
  eventStatus: EventStatus;
  optIn: boolean;
  reminderHold: boolean;
  deletionPending: boolean;
  hasVerifiedRecipient: boolean;
  hasActiveSuppression: boolean;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  eventTimezone: string | null;
  registrationDeadlineAt: string | null;
  registrationDeadlineOn: string | null;
  registrationClosed: boolean;
  now: Date | string;
}

export interface ReminderEligibilityResult {
  eligible: boolean;
  kind: ReminderKind | null;
  anchorAt: string | null;
  dueAt: string | null;
  expiresAt: string | null;
  reason: ReminderIneligibilityReason | null;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Pure TypeScript reminder eligibility domain contract (AGENTS.md & ARCHITECTURE.md lines 64-83).
 * Evaluates the exact 12-row ordered truth table with an explicit clock (`now`).
 * Must stay 100% consistent with `public.evaluate_reminder_eligibility` in PostgreSQL.
 */
export function evaluateReminderEligibility(
  input: ReminderEligibilityInput
): ReminderEligibilityResult {
  const nowMs =
    input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);

  // Row 1: None -> Untracked
  if (
    input.trackingState !== "saved" &&
    input.trackingState !== "registered"
  ) {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "untracked",
    };
  }

  // Row 2: Draft, canceled, archived -> Inactive status
  if (input.eventStatus !== "published") {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "inactive_status",
    };
  }

  // Row 3: Opt-in Off -> Opted out
  if (!input.optIn) {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "opted_out",
    };
  }

  // Row 4: Hold, deletion pending, unverified recipient, or active suppression -> Applicable hold
  if (
    input.reminderHold ||
    input.deletionPending ||
    !input.hasVerifiedRecipient ||
    input.hasActiveSuppression
  ) {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "applicable_hold",
    };
  }

  if (!input.eventTimezone) {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "inactive_status",
    };
  }

  let effectiveStartMs: number;
  let effectiveEndMs: number;
  try {
    const bounds = resolveEffectiveScheduleBounds({
      isAllDay: input.isAllDay,
      eventTimezone: input.eventTimezone,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      startOn: input.startOn,
      endOn: input.endOn,
    });
    effectiveStartMs = bounds.effectiveStartAt.getTime();
    effectiveEndMs = bounds.effectiveEndAt.getTime();
  } catch {
    return {
      eligible: false,
      kind: null,
      anchorAt: null,
      dueAt: null,
      expiresAt: null,
      reason: "inactive_status",
    };
  }

  // Rows 5-9: Saved tracking
  if (input.trackingState === "saved") {
    // Row 5: Missing or date-only deadline (date-only is non-exact)
    if (!input.registrationDeadlineAt) {
      return {
        eligible: false,
        kind: null,
        anchorAt: null,
        dueAt: null,
        expiresAt: null,
        reason: "no_exact_deadline",
      };
    }

    // Row 6: Registration closed
    if (input.registrationClosed) {
      return {
        eligible: false,
        kind: null,
        anchorAt: null,
        dueAt: null,
        expiresAt: null,
        reason: "registration_closed",
      };
    }

    const anchorMs = Date.parse(input.registrationDeadlineAt);
    if (!Number.isFinite(anchorMs)) {
      return {
        eligible: false,
        kind: null,
        anchorAt: null,
        dueAt: null,
        expiresAt: null,
        reason: "no_exact_deadline",
      };
    }

    const dueMs = anchorMs - TWENTY_FOUR_HOURS_MS;
    const expiresMs = Math.min(anchorMs, effectiveEndMs) - FIFTEEN_MINUTES_MS;

    const anchorIso = new Date(anchorMs).toISOString();
    const dueIso = new Date(dueMs).toISOString();
    const expiresIso = new Date(expiresMs).toISOString();

    if (nowMs < dueMs) {
      return {
        eligible: false,
        kind: "deadline",
        anchorAt: anchorIso,
        dueAt: dueIso,
        expiresAt: expiresIso,
        reason: "too_early",
      };
    }

    if (dueMs < expiresMs && nowMs < expiresMs) {
      return {
        eligible: true,
        kind: "deadline",
        anchorAt: anchorIso,
        dueAt: dueIso,
        expiresAt: expiresIso,
        reason: null,
      };
    }

    return {
      eligible: false,
      kind: "deadline",
      anchorAt: anchorIso,
      dueAt: dueIso,
      expiresAt: expiresIso,
      reason: "too_late",
    };
  }

  // Rows 10-12: Registered tracking
  let anchorMs: number;
  if (input.isAllDay) {
    if (!input.startOn) {
      return {
        eligible: false,
        kind: null,
        anchorAt: null,
        dueAt: null,
        expiresAt: null,
        reason: "inactive_status",
      };
    }
    const zdt = Temporal.PlainDate.from(input.startOn).toZonedDateTime({
      timeZone: input.eventTimezone,
      plainTime: Temporal.PlainTime.from("09:00:00"),
    });
    anchorMs = zdt.epochMilliseconds;
  } else {
    if (!input.startsAt) {
      return {
        eligible: false,
        kind: null,
        anchorAt: null,
        dueAt: null,
        expiresAt: null,
        reason: "inactive_status",
      };
    }
    anchorMs = Date.parse(input.startsAt);
  }

  const dueMs = anchorMs - TWENTY_FOUR_HOURS_MS;
  // Attendance cutoff is S (effectiveStartMs), including for ongoing events and all-day listings
  const expiresMs =
    Math.min(effectiveStartMs, effectiveEndMs) - FIFTEEN_MINUTES_MS;

  const anchorIso = new Date(anchorMs).toISOString();
  const dueIso = new Date(dueMs).toISOString();
  const expiresIso = new Date(expiresMs).toISOString();

  if (nowMs < dueMs) {
    return {
      eligible: false,
      kind: "attendance",
      anchorAt: anchorIso,
      dueAt: dueIso,
      expiresAt: expiresIso,
      reason: "too_early",
    };
  }

  if (dueMs < expiresMs && nowMs < expiresMs) {
    return {
      eligible: true,
      kind: "attendance",
      anchorAt: anchorIso,
      dueAt: dueIso,
      expiresAt: expiresIso,
      reason: null,
    };
  }

  return {
    eligible: false,
    kind: "attendance",
    anchorAt: anchorIso,
    dueAt: dueIso,
    expiresAt: expiresIso,
    reason: "too_late",
  };
}

/**
 * Invokes the authoritative SQL `public.evaluate_reminder_eligibility` RPC via a service-role client.
 */
export async function evaluateReminderEligibilityViaSql(
  supabase: SupabaseClient<Database>,
  input: ReminderEligibilityInput
): Promise<ReminderEligibilityResult> {
  const nowIso =
    input.now instanceof Date
      ? input.now.toISOString()
      : new Date(input.now).toISOString();

  const { data, error } = await supabase.rpc(
    "evaluate_reminder_eligibility" as never,
    {
      p_tracking_state: input.trackingState,
      p_event_status: input.eventStatus,
      p_opt_in: input.optIn,
      p_reminder_hold: input.reminderHold,
      p_deletion_pending: input.deletionPending,
      p_has_verified_recipient: input.hasVerifiedRecipient,
      p_has_active_suppression: input.hasActiveSuppression,
      p_is_all_day: input.isAllDay,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_start_on: input.startOn,
      p_end_on: input.endOn,
      p_event_timezone: input.eventTimezone,
      p_registration_deadline_at: input.registrationDeadlineAt,
      p_registration_deadline_on: input.registrationDeadlineOn,
      p_registration_closed: input.registrationClosed,
      p_now: nowIso,
    } as never
  );

  if (error) {
    throw new Error(`SQL eligibility evaluation failed: ${error.code ?? "ERR"}`);
  }

  const rows = (data ?? []) as Array<{
    eligible: boolean;
    kind: ReminderKind | null;
    anchor_at: string | null;
    due_at: string | null;
    expires_at: string | null;
    reason: ReminderIneligibilityReason | null;
  }>;

  const row = rows[0];
  if (!row) {
    throw new Error("Empty response from SQL evaluate_reminder_eligibility");
  }

  return {
    eligible: row.eligible,
    kind: row.kind,
    anchorAt: row.anchor_at ? new Date(row.anchor_at).toISOString() : null,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    reason: row.reason,
  };
}
