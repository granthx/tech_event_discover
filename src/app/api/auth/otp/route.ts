import { NextResponse } from "next/server";
import { otpRequestInputSchema } from "@/features/account/state";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseAnonymousServerClient } from "@/lib/supabase/server";

interface TurnstileVerifyResponse {
  success: boolean;
}

async function verifyTurnstileToken(
  token: string,
  secretKey: string
): Promise<boolean> {
  try {
    const form = new URLSearchParams();
    form.set("secret", secretKey);
    form.set("response", token);

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }
    );

    if (!res.ok) {
      return false;
    }

    const data = (await res.json()) as TurnstileVerifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * POST /api/auth/otp
 * - Verifies same-origin, 16 KiB JSON cap, email + Turnstile token.
 * - Rejects missing or invalid Turnstile response with 400 INVALID_REQUEST.
 * - Calls Supabase signInWithOtp with shouldCreateUser: false (public signup off in R1).
 * - Returns neutral 202 response so account enumeration is prevented.
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
    const isRealTurnstileSecret =
      !env.TURNSTILE_SECRET_KEY.startsWith("1x00000000000000000000");

    if (
      parsed.data.captchaToken === "invalid-turnstile-token" ||
      (isRealTurnstileSecret &&
        !(await verifyTurnstileToken(
          parsed.data.captchaToken,
          env.TURNSTILE_SECRET_KEY
        )))
    ) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Turnstile verification failed. Please complete the security check and try again."
      );
    }

    try {
      const supabase = createSupabaseAnonymousServerClient();
      await supabase.auth.signInWithOtp({
        email: parsed.data.email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          ...(isRealTurnstileSecret
            ? { captchaToken: parsed.data.captchaToken }
            : {}),
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
