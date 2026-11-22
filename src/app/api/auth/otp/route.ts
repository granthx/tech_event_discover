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
 * Takes email and Turnstile token, uses shouldCreateUser: false (public signup off in R1),
 * and returns a neutral 202 response.
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

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (!isPlaceholderEnv) {
    try {
      const supabase = createSupabaseAnonymousServerClient();
      await supabase.auth.signInWithOtp({
        email: parsed.data.email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          captchaToken: parsed.data.captchaToken,
        },
      });
    } catch {
      // Return neutral 202 response so enumeration is prevented
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
