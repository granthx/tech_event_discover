import { NextResponse } from "next/server";
import {
  classifyResendWebhookEvent,
  verifyResendWebhookSignature,
} from "@/features/reminders/crypto";
import { getServerEnv } from "@/lib/env";
import { jsonError } from "@/lib/security/http";
import { createSupabaseServiceServerClient } from "@/lib/supabase/server";

const MAX_WEBHOOK_BYTES = 65_536;

function extractEmailAddress(headerOrAddress: string): string {
  const match = headerOrAddress.match(/<([^>]+)>/);
  const addr = match ? match[1]! : headerOrAddress;
  return addr.trim().toLowerCase();
}

/**
 * POST /api/webhooks/resend
 * Verifies raw webhook body, signature, and timestamp with `RESEND_WEBHOOK_SECRET`.
 * Matches configured sender, provider message ID, and current verified recipient.
 * Only exact `"Permanent"` bounce (+90d) and complaint (+180d) suppress; soft/unknown bounces
 * produce a safe diagnostic with zero raw payloads or emails logged.
 */
export async function POST(request: Request) {
  const env = getServerEnv();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError(400, "INVALID_REQUEST", "Unable to read webhook body.");
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return jsonError(413, "PAYLOAD_TOO_LARGE", "Webhook payload too large.");
  }

  const isValidSignature = verifyResendWebhookSignature(
    rawBody,
    {
      svixId: request.headers.get("svix-id"),
      svixTimestamp: request.headers.get("svix-timestamp"),
      svixSignature: request.headers.get("svix-signature"),
    },
    env.RESEND_WEBHOOK_SECRET
  );

  if (!isValidSignature) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired webhook signature."
    );
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "INVALID_REQUEST", "Malformed JSON body.");
  }

  // Verify sender matches REMINDER_FROM_EMAIL before correlating
  const dataObj =
    parsedPayload &&
    typeof parsedPayload === "object" &&
    "data" in parsedPayload &&
    parsedPayload.data &&
    typeof parsedPayload.data === "object"
      ? (parsedPayload.data as Record<string, unknown>)
      : null;

  const rawFrom =
    dataObj && typeof dataObj.from === "string" ? dataObj.from : "";
  if (
    rawFrom &&
    extractEmailAddress(rawFrom) !==
      extractEmailAddress(env.REMINDER_FROM_EMAIL)
  ) {
    return NextResponse.json(
      { status: "ignored", code: "sender_mismatch" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const classification = classifyResendWebhookEvent(parsedPayload);

  if (
    classification.action !== "suppress" ||
    !classification.reason ||
    !classification.providerMessageId ||
    !classification.recipientEmail ||
    !classification.expiresAtIso
  ) {
    return NextResponse.json(
      { status: "ignored", code: classification.diagnosticCode },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const isPlaceholderEnv =
    !serviceKey ||
    serviceKey.includes("placeholder") ||
    serviceKey.includes("test_key");

  if (isPlaceholderEnv) {
    return NextResponse.json(
      { status: "processed", code: classification.diagnosticCode },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = createSupabaseServiceServerClient();
  const { data, error } = await supabase.rpc(
    "record_webhook_suppression" as never,
    {
      p_provider_message_id: classification.providerMessageId,
      p_webhook_recipient_email: classification.recipientEmail,
      p_digest_key: env.RECIPIENT_DIGEST_KEY,
      p_reason: classification.reason,
      p_expires_at: classification.expiresAtIso,
    } as never
  );

  if (error) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Webhook suppression persistence failed."
    );
  }

  const rows = (data ?? []) as Array<{
    http_status: number;
    outcome: string;
  }>;
  const result = rows[0];

  // Event-before-acceptance correlation: retryable 503 until provider_message_id is recorded
  if (!result || result.http_status === 503) {
    return jsonError(
      503,
      "CORRELATION_PENDING",
      "Delivery provider message ID not yet recorded; retry shortly."
    );
  }

  if (result.http_status >= 400) {
    return jsonError(400, "INVALID_REQUEST", "Invalid suppression event.");
  }

  return NextResponse.json(
    { status: "processed", code: result.outcome },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
