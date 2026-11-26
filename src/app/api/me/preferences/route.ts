import { NextResponse } from "next/server";
import { preferenceMutationInputSchema } from "@/features/account/state";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

/**
 * GET /api/me/preferences
 * Reads the authenticated eligible user's reminder preference row under RLS.
 * Absent row means opt-out (`emailRemindersEnabled: false`, `consentVersion: 0`).
 */
export async function GET() {
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return NextResponse.json(
      {
        emailRemindersEnabled: false,
        consentVersion: 0,
        consentRecordedAt: null,
        consentNoticeVersion: null,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const supabase = await createSupabaseSessionServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in to view preferences.");
  }

  const { data: row, error } = await supabase
    .from("user_preferences")
    .select(
      "email_reminders_enabled, consent_version, consent_recorded_at, consent_notice_version"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return jsonError(500, "INTERNAL_ERROR", "Unable to load preferences.");
  }

  return NextResponse.json(
    {
      emailRemindersEnabled: row?.email_reminders_enabled ?? false,
      consentVersion: row?.consent_version ?? 0,
      consentRecordedAt: row?.consent_recorded_at ?? null,
      consentNoticeVersion: row?.consent_notice_version ?? null,
    },
    { status: 200, headers: { "Cache-Control": "private, no-store" } }
  );
}

/**
 * PUT /api/me/preferences
 * `{ emailRemindersEnabled: boolean }` updates the caller's setting via narrow session RPC.
 * Increments `consent_version` ONLY on a real change and records notice version and timestamp.
 */
export async function PUT(request: Request) {
  const env = getServerEnv();
  if (!verifySameOriginMutation(request, env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin mutation denied.");
  }

  const bodyResult = await parseBoundedJsonBody<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = preferenceMutationInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Expected { emailRemindersEnabled: boolean }."
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Sign in to update reminder preferences."
    );
  }

  const supabase = await createSupabaseSessionServerClient();
  const { data, error } = await supabase.rpc(
    "set_user_reminder_preference" as never,
    {
      p_email_reminders_enabled: parsed.data.emailRemindersEnabled,
      p_notice_version: env.REMINDER_CONSENT_NOTICE_VERSION,
    } as never
  );

  if (error) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Unable to update reminder preferences."
    );
  }

  const rows = (data ?? []) as Array<{
    http_status: number;
    error_code: string | null;
    email_reminders_enabled: boolean;
    consent_version: number;
    consent_recorded_at: string | null;
    consent_notice_version: string | null;
    was_updated: boolean;
  }>;

  const outcome = rows[0];
  if (!outcome) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Empty response updating preferences."
    );
  }

  if (outcome.http_status === 401) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Sign in to update reminder preferences."
    );
  }

  if (outcome.http_status === 403) {
    return jsonError(
      403,
      "FORBIDDEN",
      "Account is not eligible to modify preferences."
    );
  }

  if (outcome.http_status === 429) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Too many preference updates. Please wait a moment and try again.",
      { "Retry-After": "60" }
    );
  }

  if (outcome.http_status !== 200) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Invalid preference update request."
    );
  }

  return NextResponse.json(
    {
      emailRemindersEnabled: outcome.email_reminders_enabled,
      consentVersion: outcome.consent_version,
      consentRecordedAt: outcome.consent_recorded_at,
      consentNoticeVersion: outcome.consent_notice_version,
      wasUpdated: outcome.was_updated,
    },
    { status: 200, headers: { "Cache-Control": "private, no-store" } }
  );
}
