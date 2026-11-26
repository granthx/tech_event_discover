import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseServiceServerClient } from "@/lib/supabase/server";

const verifyOtpSchema = z.object({
  email: z.string().trim().email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, "A 6 to 8 digit verification code is required."),
  adultConfirmed: z.boolean().optional(),
});

/**
 * POST /api/auth/verify
 * Exchanges email and OTP code on the server (ARCHITECTURE.md):
 * - Buffers session cookies before verification.
 * - Checks account_controls: if adult_confirmed_at is missing, requires explicit adultConfirmed: true.
 * - Rejects pending deletion accounts without releasing cookies.
 * - Releases session cookies on the NextResponse only after eligibility is confirmed.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!verifySameOriginMutation(request, env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request denied.");
  }

  const bodyResult = await parseBoundedJsonBody<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = verifyOtpSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ??
        "Email and verification code are required."
    );
  }

  const pubEnv = getPublicEnv();
  const isPlaceholderEnv =
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") ||
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("test_key");

  if (isPlaceholderEnv) {
    if (parsed.data.adultConfirmed !== true) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "You must confirm that you are at least 18 years old."
      );
    }
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired one-time verification code."
    );
  }

  const bufferedCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient<Database>(
    pubEnv.NEXT_PUBLIC_SUPABASE_URL,
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          bufferedCookies.push(...cookiesToSet);
        },
      },
    }
  );

  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email.toLowerCase(),
    token: parsed.data.code,
    type: "email",
  });

  if (error || !data.user) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired one-time verification code."
    );
  }

  const svc = createSupabaseServiceServerClient();
  const { data: ctrl } = await svc
    .from("account_controls")
    .select("adult_confirmed_at, deletion_requested_at")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (ctrl?.deletion_requested_at) {
    return jsonError(
      403,
      "FORBIDDEN",
      "Account deletion is pending for this account."
    );
  }

  // Missing attestation (e.g. interrupted invite recovery) requires explicit adultConfirmed: true
  if (!ctrl?.adult_confirmed_at) {
    if (parsed.data.adultConfirmed !== true) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Please check 'I confirm I am at least 18 years old' to complete initial account setup, then request a new code."
      );
    }

    const { error: attestError } = await supabase.rpc(
      "record_adult_attestation" as never
    );
    if (attestError) {
      return jsonError(
        403,
        "FORBIDDEN",
        "Unable to record age confirmation; session was not created."
      );
    }
  }

  const response = NextResponse.json(
    { status: "verified" },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );

  for (const c of bufferedCookies) {
    response.cookies.set(c.name, c.value, c.options);
  }

  return response;
}
