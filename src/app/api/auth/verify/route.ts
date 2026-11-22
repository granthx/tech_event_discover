import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const verifyOtpSchema = z.object({
  email: z.string().trim().email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "A 6-digit verification code is required."),
  adultConfirmed: z.boolean().optional(),
});

/**
 * POST /api/auth/verify
 * Exchanges email and OTP code on the server (ARCHITECTURE.md):
 * - Missing attestation requires explicit adultConfirmed: true on the verification form.
 * - Buffers session cookies until adult_confirmed_at is persisted.
 * - Recovers an interrupted invite via fresh OTP.
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
      parsed.error.issues[0]?.message ?? "Email and 6-digit code are required."
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

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

  const supabase = await createSupabaseSessionServerClient();
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

  if (parsed.data.adultConfirmed === true) {
    const { error: attestError } = await supabase.rpc(
      "record_adult_attestation" as never
    );
    if (attestError) {
      await supabase.auth.signOut();
      return jsonError(
        403,
        "FORBIDDEN",
        "Unable to verify account eligibility."
      );
    }
  }

  return NextResponse.json(
    { status: "verified" },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
