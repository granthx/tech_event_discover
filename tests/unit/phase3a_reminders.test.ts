import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateOtpSignupGate } from "@/features/account/state";
import {
  classifyResendWebhookEvent,
  verifyResendWebhookSignature,
} from "@/features/reminders/crypto";
import {
  evaluateReminderEligibility,
  type ReminderEligibilityInput,
} from "@/features/reminders/eligibility";
import eligibilityFixtures from "@/features/reminders/eligibility-fixtures.json";
import {
  isDeliveryPermittedByMode,
  parseSmokeAllowlist,
} from "@/features/reminders/smoke";
import {
  computeNextRetryTimestamp,
  executeReminderWorkerBatch,
  type FrozenResendPayload,
  type ReminderWorkerConfig,
} from "@/features/reminders/worker";
import type { Database } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Phase 3A · Shared Reminder Eligibility Truth-Table Fixtures", () => {
  for (const testCase of eligibilityFixtures.cases) {
    it(`matches shared fixture ${testCase.id}`, () => {
      const actual = evaluateReminderEligibility(
        testCase.input as ReminderEligibilityInput
      );
      expect(actual).toEqual(testCase.expected);
    });
  }
});

describe("Phase 3A · Webhook Signatures & Defensive Bounce Classification", () => {
  const rawSecretBytes = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
  const webhookSecret = `whsec_${rawSecretBytes.toString("base64")}`;
  const now = new Date("2026-12-09T12:00:00.000Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const msgId = "msg_test_svix_1";

  function signPayload(body: string, timestamp = ts): string {
    const sig = crypto
      .createHmac("sha256", rawSecretBytes)
      .update(`${msgId}.${timestamp}.${body}`, "utf8")
      .digest("base64");
    return `v1,${sig}`;
  }

  it("verifies valid Svix signature and rejects tampered body, wrong secret, or stale timestamp", () => {
    const body = JSON.stringify({ type: "email.delivered", data: {} });
    const validSig = signPayload(body);

    expect(
      verifyResendWebhookSignature(
        body,
        { svixId: msgId, svixTimestamp: ts, svixSignature: validSig },
        webhookSecret,
        now
      )
    ).toBe(true);

    // Tampered body
    expect(
      verifyResendWebhookSignature(
        body + " ",
        { svixId: msgId, svixTimestamp: ts, svixSignature: validSig },
        webhookSecret,
        now
      )
    ).toBe(false);

    // Stale timestamp (> 300s)
    const staleTs = String(Math.floor(now.getTime() / 1000) - 301);
    expect(
      verifyResendWebhookSignature(
        body,
        {
          svixId: msgId,
          svixTimestamp: staleTs,
          svixSignature: signPayload(body, staleTs),
        },
        webhookSecret,
        now
      )
    ).toBe(false);
  });

  it("soft_bounce_does_not_suppress: suppresses ONLY exact Permanent bounce (+90d) and complaint (+180d)", () => {
    const baseEventTime = "2026-12-09T10:00:00.000Z";

    for (const nonPermanent of [
      "Temporary",
      "Transient",
      "Undetermined",
      "",
      "UnknownCustomBounce",
      undefined,
    ]) {
      const res = classifyResendWebhookEvent({
        type: "email.bounced",
        created_at: baseEventTime,
        data: {
          email_id: "re_123",
          from: "reminders@example.org",
          to: ["member@example.org"],
          bounce: nonPermanent === undefined ? {} : { type: nonPermanent },
        },
      });
      expect(res.action).toBe("diagnostic");
    }

    const perm = classifyResendWebhookEvent({
      type: "email.bounced",
      created_at: baseEventTime,
      data: {
        email_id: "re_123",
        from: "reminders@example.org",
        to: ["Member@Example.org"],
        bounce: { type: "Permanent" },
      },
    });
    expect(perm).toEqual({
      action: "suppress",
      reason: "permanent_bounce",
      providerMessageId: "re_123",
      recipientEmail: "member@example.org",
      expiresAtIso: "2027-03-09T10:00:00.000Z",
      diagnosticCode: "permanent_bounce",
    });

    const complaint = classifyResendWebhookEvent({
      type: "email.complained",
      created_at: baseEventTime,
      data: {
        email_id: "re_456",
        from: "reminders@example.org",
        to: ["member@example.org"],
      },
    });
    expect(complaint).toEqual({
      action: "suppress",
      reason: "complaint",
      providerMessageId: "re_456",
      recipientEmail: "member@example.org",
      expiresAtIso: "2027-06-07T10:00:00.000Z",
      diagnosticCode: "complaint",
    });
  });
});

describe("Phase 3A · Smoke Allowlist, Open-Signup Age Gate & Retry Backoff", () => {
  const u1 = "aaaaaaaa-1111-4111-8111-111111111101";
  const e1 = "22222222-2222-4222-8222-222222222201";

  it("rejects empty or malformed smoke allowlists and enforces exact user/event/kind match", () => {
    expect(parseSmokeAllowlist("").ok).toBe(false);
    expect(parseSmokeAllowlist("not-a-uuid").ok).toBe(false);
    expect(
      isDeliveryPermittedByMode("smoke", "", {
        userId: u1,
        eventId: e1,
        kind: "deadline",
      })
    ).toBe(false);

    const allowRaw = `${u1}:${e1}:deadline`;
    expect(
      isDeliveryPermittedByMode("smoke", allowRaw, {
        userId: u1,
        eventId: e1,
        kind: "deadline",
      })
    ).toBe(true);
    expect(
      isDeliveryPermittedByMode("smoke", allowRaw, {
        userId: u1,
        eventId: e1,
        kind: "attendance",
      })
    ).toBe(false);
  });

  it("enforces the open-signup age gate while keeping returning sign-in shouldCreateUser=false", () => {
    expect(
      evaluateOtpSignupGate({
        intent: "signin",
        authSignupEnabled: false,
      })
    ).toEqual({ allowed: true, shouldCreateUser: false });

    expect(
      evaluateOtpSignupGate({
        intent: "signup",
        adultConfirmed: true,
        authSignupEnabled: false,
      })
    ).toMatchObject({ allowed: false, status: 403, code: "SIGNUP_DISABLED" });

    expect(
      evaluateOtpSignupGate({
        intent: "signup",
        adultConfirmed: false,
        authSignupEnabled: true,
      })
    ).toMatchObject({
      allowed: false,
      status: 400,
      code: "ADULT_ATTESTATION_REQUIRED",
    });

    expect(
      evaluateOtpSignupGate({
        intent: "signup",
        adultConfirmed: true,
        authSignupEnabled: true,
      })
    ).toEqual({ allowed: true, shouldCreateUser: true });
  });

  it("schedules 5m, 15m, 60m retries within expiry and 23h horizon, and stops when exceeded", () => {
    const first = new Date("2026-12-09T00:00:00.000Z");
    const expires = new Date("2026-12-09T23:45:00.000Z");

    expect(
      computeNextRetryTimestamp({
        attemptCount: 1,
        now: first,
        firstAttemptAt: first,
        expiresAt: expires,
        providerRetryAfterSeconds: null,
      })?.toISOString()
    ).toBe("2026-12-09T00:05:00.000Z");

    // Longer Retry-After honored when within expiry and 23h horizon
    expect(
      computeNextRetryTimestamp({
        attemptCount: 1,
        now: first,
        firstAttemptAt: first,
        expiresAt: expires,
        providerRetryAfterSeconds: 1200, // 20m > 5m
      })?.toISOString()
    ).toBe("2026-12-09T00:20:00.000Z");

    // Exceeding 23h horizon returns null
    expect(
      computeNextRetryTimestamp({
        attemptCount: 2,
        now: new Date("2026-12-09T22:50:00.000Z"),
        firstAttemptAt: first,
        expiresAt: expires,
        providerRetryAfterSeconds: null, // +15m -> 23:05 >= 23:00 horizon!
      })
    ).toBeNull();
  });
});

describe("Phase 3A · Worker Delivery Retry, Payload Reuse & Changed Email Blocking", () => {
  const userId = "aaaaaaaa-1111-4111-8111-111111111101";
  const eventId = "22222222-2222-4222-8222-222222222201";
  const deliveryId = "99999999-9999-4999-8999-999999999901";

  function createInMemoryWorkerSupabase(state: {
    currentVerifiedEmail: string;
    attemptCount: number;
    mayHaveSent: boolean;
    pendingPayload: FrozenResendPayload | null;
    status: string;
    lastFinalizedOutcome: string | null;
    expiresAt: string;
  }) {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      if (fn === "materialize_due_reminder_deliveries") {
        return {
          data: [{ materialized_count: 1, expired_count: 0 }],
          error: null,
        };
      }
      if (fn === "claim_due_reminder_deliveries") {
        state.attemptCount += 1;
        state.status = "leased";
        return {
          data: [
            {
              delivery_id: deliveryId,
              user_id: userId,
              event_id: eventId,
              kind: "deadline",
              target_at: "2026-12-09T12:00:00.000Z",
              due_at: "2026-12-08T12:00:00.000Z",
              expires_at: state.expiresAt,
              attempt_count: state.attemptCount,
              first_attempt_at: "2026-12-09T00:00:00.000Z",
              may_have_sent: state.mayHaveSent,
              pending_payload: state.pendingPayload,
              unsubscribe_token_digest: null,
              unsubscribe_expires_at: null,
              consent_version_at_send: 1,
              current_verified_email: state.currentVerifiedEmail,
              has_verified_recipient: true,
              deletion_or_ineligible_account: false,
              has_active_suppression: false,
              opt_in_enabled: true,
              current_consent_version: 1,
              tracking_state: "saved",
              event_status: "published",
              event_title: "India Systems Hackathon 2026",
              event_organizer: "FOSS United",
              event_timezone: "Asia/Kolkata",
              event_is_all_day: false,
              event_starts_at: "2026-12-10T12:00:00.000Z",
              event_ends_at: "2026-12-10T15:00:00.000Z",
              event_start_on: null,
              event_end_on: null,
              event_registration_deadline_at: "2026-12-09T12:00:00.000Z",
              event_registration_deadline_on: null,
              event_registration_closed: false,
              event_reminder_hold: false,
            },
          ],
          error: null,
        };
      }
      if (fn === "prepare_reminder_provider_attempt") {
        const prior = state.mayHaveSent;
        if (!state.pendingPayload) {
          state.pendingPayload = params.p_pending_payload as FrozenResendPayload;
        }
        state.mayHaveSent = true;
        return {
          data: [
            {
              prepared: true,
              prior_may_have_sent: prior,
              frozen_payload: state.pendingPayload,
            },
          ],
          error: null,
        };
      }
      if (fn === "finalize_reminder_delivery_attempt") {
        state.status = params.p_outcome as string;
        state.lastFinalizedOutcome = state.status;
        state.mayHaveSent = Boolean(params.p_may_have_sent);
        if (state.status !== "retry" && state.status !== "pending") {
          state.pendingPayload = null;
        }
        return { data: true, error: null };
      }
      if (fn === "get_reminder_health_summary") {
        return {
          data: [
            {
              actionable_backlog_over_10m_count: 0,
              unknown_outcome_count: state.status === "unknown" ? 1 : 0,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    };

    return { rpc } as unknown as SupabaseClient<Database>;
  }

  const baseConfig: ReminderWorkerConfig = {
    appOrigin: "https://tech-event-discover.vercel.app",
    sendEnabled: true,
    deliveryMode: "smoke",
    smokeAllowlistRaw: `${userId}:${eventId}:deadline`,
    recipientDigestKey:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    resendApiKey: "re_test_key",
    reminderFromEmail: "reminders@example.org",
    heartbeatUrl: null,
  };

  it("timeout_retries_same_payload_and_key: reuses identical payload and idempotency key after timeout", async () => {
    const state = {
      currentVerifiedEmail: "user-a@example.org",
      attemptCount: 0,
      mayHaveSent: false,
      pendingPayload: null as FrozenResendPayload | null,
      status: "pending",
      lastFinalizedOutcome: null as string | null,
      expiresAt: "2026-12-09T11:45:00.000Z",
    };
    const supabase = createInMemoryWorkerSupabase(state);
    const capturedCalls: Array<{ key: string; payload: FrozenResendPayload }> = [];

    // Attempt 1: simulated timeout
    const run1 = await executeReminderWorkerBatch({
      supabase,
      config: baseConfig,
      clock: () => new Date("2026-12-09T00:00:00.000Z"),
      pingFetch: async () => new Response("ok"),
      sender: async ({ idempotencyKey, payload }) => {
        capturedCalls.push({ key: idempotencyKey, payload: structuredClone(payload) });
        return {
          kind: "transient_failure",
          ambiguousSend: true,
          retryAfterSeconds: null,
          errorCode: "PROVIDER_TIMEOUT_OR_NETWORK",
        };
      },
    });

    expect(run1.retried).toBe(1);
    expect(state.mayHaveSent).toBe(true);
    expect(state.pendingPayload).not.toBeNull();

    // Attempt 2: succeeds with exact same payload & idempotency key
    const run2 = await executeReminderWorkerBatch({
      supabase,
      config: baseConfig,
      clock: () => new Date("2026-12-09T00:06:00.000Z"),
      pingFetch: async () => new Response("ok"),
      sender: async ({ idempotencyKey, payload }) => {
        capturedCalls.push({ key: idempotencyKey, payload: structuredClone(payload) });
        return { kind: "accepted", providerMessageId: "re_accepted_after_retry" };
      },
    });

    expect(run2.accepted).toBe(1);
    expect(capturedCalls).toHaveLength(2);
    expect(capturedCalls[0]!.key).toBe(deliveryId);
    expect(capturedCalls[1]!.key).toBe(deliveryId);
    expect(capturedCalls[1]!.payload).toEqual(capturedCalls[0]!.payload);
    expect(state.pendingPayload).toBeNull();
  });

  it("changed_verified_email_blocks_retry: ends delivery as unknown (when may_have_sent=true) without calling provider", async () => {
    const state = {
      currentVerifiedEmail: "user-a@example.org",
      attemptCount: 1,
      mayHaveSent: true,
      pendingPayload: {
        from: "reminders@example.org",
        to: "user-a@example.org",
        subject: "Registration deadline soon: India Systems Hackathon 2026",
        text: "Body",
        headers: {
          "List-Unsubscribe": "<https://tech-event-discover.vercel.app/api/reminders/unsubscribe?token=abc>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      } as FrozenResendPayload | null,
      status: "retry",
      lastFinalizedOutcome: null as string | null,
      expiresAt: "2026-12-09T11:45:00.000Z",
    };

    // User changes their verified email before retry attempt 2
    state.currentVerifiedEmail = "new-address@example.org";
    const supabase = createInMemoryWorkerSupabase(state);
    let providerCalled = false;

    const summary = await executeReminderWorkerBatch({
      supabase,
      config: baseConfig,
      clock: () => new Date("2026-12-09T00:10:00.000Z"),
      pingFetch: async () => new Response("ok"),
      sender: async () => {
        providerCalled = true;
        return { kind: "accepted", providerMessageId: "should_not_send" };
      },
    });

    expect(providerCalled).toBe(false);
    expect(summary.unknown).toBe(1);
    expect(state.status).toBe("unknown");
    expect(state.pendingPayload).toBeNull();
  });
});
