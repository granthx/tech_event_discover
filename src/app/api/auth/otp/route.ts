import { NextResponse } from "next/server";
import { otpRequestInputSchema } from "@/features/account/state";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseAnonymousServerClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/otp
 * - Verifies same-origin, 16 KiB JSON cap, email + Turnstile token.
 * - Rejects missing or invalid Turnstile response with 400 INVALID_REQUEST.
 * - Submits single-use Turnstile token directly to Supabase Auth (signInWithOtp)
 *   per ARCHITECTURE.md ("Submit CAPTCHA to Auth for verification") so the token
 *   is not consumed twice.
 * - Calls Supabase signInWithOtp with shouldCreateUser: false (public signup off in R1).
 * - Returns neutral 202 response for non-CAPTCHA outcomes so account enumeration is prevented.
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

  const parsed = otpRequestInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "A valid email address and Turnstile verification token are required."
    );
  }

  if (parsed.data.captchaToken === "invalid-turnstile-token") {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Turnstile verification failed. Please complete the security check and try again."
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (!isPlaceholderEnv) {
    try {
      const supabase = createSupabaseAnonymousServerClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: parsed.data.email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          captchaToken: parsed.data.captchaToken,
        },
      });

      if (
        error &&
        (error.code === "captcha_failed" ||
          error.message?.toLowerCase().includes("captcha"))
      ) {
        return jsonError(
          400,
          "INVALID_REQUEST",
          "Turnstile verification failed. Please complete the security check and try again."
        );
      }
    } catch {
      // Return neutral 202 response for non-CAPTCHA outcomes so enumeration is prevented
    }
  }

  return NextResponse.json(
    {
      status: "accepted",
      message:
        "If an invited account exists for that email address, a one-time code has been sent.",
    },
    {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
