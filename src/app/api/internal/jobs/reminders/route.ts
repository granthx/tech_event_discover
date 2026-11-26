import { NextResponse } from "next/server";
import { z } from "zod";
import { computeTokenSha256Hex } from "@/features/reminders/crypto";
import { executeReminderWorkerBatch } from "@/features/reminders/worker";
import { getServerEnv } from "@/lib/env";
import { jsonError, parseBoundedJsonBody } from "@/lib/security/http";
import { createSupabaseServiceServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const runJobInputSchema = z.object({
  runId: z.string().uuid(),
});

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([A-Za-z0-9_-]{16,512})$/);
  return match ? match[1]! : null;
}

/**
 * POST /api/internal/jobs/reminders
 * Takes `{ runId }` and an expiring single-run 120s bearer in `Authorization`.
 * Atomically checks digest, expiry, matching job name (`reminders`), and unclaimed status,
 * consuming the bearer so replays return `401`.
 * Returns `200` after durable success, `401` for invalid/consumed/expired bearer,
 * and `500` with a safe error code on execution failure.
 */
export async function POST(request: Request) {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (!bearer) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Missing or invalid single-run job bearer."
    );
  }

  const bodyResult = await parseBoundedJsonBody<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = runJobInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(400, "INVALID_REQUEST", "Expected { runId: uuid }.");
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const isPlaceholderEnv =
    !serviceKey ||
    serviceKey.includes("placeholder") ||
    serviceKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid, consumed, or expired job bearer."
    );
  }

  const env = getServerEnv();
  const supabase = createSupabaseServiceServerClient();
  const tokenDigest = computeTokenSha256Hex(bearer);

  const { data: consumed, error: consumeErr } = await supabase.rpc(
    "consume_job_run_bearer" as never,
    {
      p_run_id: parsed.data.runId,
      p_expected_job_name: "reminders",
      p_token_digest: tokenDigest,
    } as never
  );

  if (consumeErr || consumed !== true) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid, consumed, or expired job bearer."
    );
  }

  try {
    const summary = await executeReminderWorkerBatch({
      supabase,
      config: {
        appOrigin: env.APP_ORIGIN,
        sendEnabled: env.REMINDER_SEND_ENABLED,
        deliveryMode: env.REMINDER_DELIVERY_MODE,
        smokeAllowlistRaw: env.REMINDER_SMOKE_ALLOWLIST,
        recipientDigestKey: env.RECIPIENT_DIGEST_KEY,
        resendApiKey: env.RESEND_API_KEY,
        reminderFromEmail: env.REMINDER_FROM_EMAIL,
        heartbeatUrl: env.REMINDER_HEARTBEAT_URL,
      },
    });

    await supabase.rpc(
      "complete_job_run" as never,
      {
        p_run_id: parsed.data.runId,
        p_execution_status: "succeeded",
        p_counts: {
          materialized: summary.materialized,
          expiredSweep: summary.expiredSweep,
          claimed: summary.claimed,
          accepted: summary.accepted,
          retried: summary.retried,
          requeuedPending: summary.requeuedPending,
          suppressed: summary.suppressed,
          expired: summary.expired,
          failed: summary.failed,
          unknown: summary.unknown,
          killSwitchActive: summary.killSwitchActive,
        },
        p_error_code: null,
      } as never
    );

    return NextResponse.json(
      {
        status: "succeeded",
        counts: {
          materialized: summary.materialized,
          claimed: summary.claimed,
          accepted: summary.accepted,
          retried: summary.retried,
          suppressed: summary.suppressed,
          expired: summary.expired,
          failed: summary.failed,
          unknown: summary.unknown,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    await supabase.rpc(
      "complete_job_run" as never,
      {
        p_run_id: parsed.data.runId,
        p_execution_status: "failed",
        p_counts: {},
        p_error_code: "WORKER_EXECUTION_FAILED",
      } as never
    );

    return jsonError(
      500,
      "WORKER_EXECUTION_FAILED",
      "Reminder worker execution failed."
    );
  }
}
