import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { inviteAcceptInputSchema } from "@/features/account/state";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";

/**
 * POST /api/auth/invite
 * R1 invite acceptance contract (ARCHITECTURE.md):
 * - User submits invite token hash and explicit adultConfirmed: true.
 * - Server verifies invite with Supabase type=invite, buffering session cookies.
 * - Records immutable adult_confirmed_at for the verified UID via record_adult_attestation.
 * - Releases session cookies ONLY after both verification and attestation succeed.
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

  const parsed = inviteAcceptInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ??
        "Invite token and 18+ age confirmation are required."
    );
  }

  const pubEnv = getPublicEnv();
  const isPlaceholderEnv =
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") ||
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invitation token could not be verified or has already been consumed."
    );
  }

  // Buffer session cookies until both verifyOtp AND record_adult_attestation succeed
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
          for (const c of cookiesToSet) {
            bufferedCookies.push(c);
          }
        },
      },
    }
  );

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: parsed.data.tokenHash,
    type: "invite",
  });

  if (error || !data.user) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invitation token could not be verified or has already been consumed."
    );
  }

  // Record adult_confirmed_at for the verified UID before releasing any session cookies
  const { error: attestError } = await supabase.rpc(
    "record_adult_attestation" as never
  );

  if (attestError) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Could not record age confirmation; session was not created. Please retry with a fresh OTP."
    );
  }

  const response = NextResponse.json(
    { status: "accepted" },
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
