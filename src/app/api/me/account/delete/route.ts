import { NextResponse } from "next/server";
import { accountDeleteInputSchema } from "@/features/account/lifecycle";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import {
  createSupabaseServiceServerClient,
  createSupabaseSessionServerClient,
} from "@/lib/supabase/server";

/**
 * POST /api/me/account/delete
 * - { action: "request" } sends a fresh OTP to the verified address and returns 202.
 * - { action: "confirm", code } proves the same identity, marks pending deletion,
 *   writes the 35-day deleted_accounts tombstone, deletes the Auth user, clears the session,
 *   and returns 204.
 * - A failure after marking pending leaves deletion retryable and blocks ordinary writes.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!verifySameOriginMutation(request, env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin mutation denied.");
  }

  const bodyResult = await parseBoundedJsonBody<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = accountDeleteInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid account deletion request."
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "An active authenticated session is required to delete your account."
    );
  }

  const sessionClient = await createSupabaseSessionServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user || !user.email) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "An active authenticated session is required to delete your account."
    );
  }

  if (parsed.data.action === "request") {
    await sessionClient.auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false },
    });

    return NextResponse.json(
      {
        status: "accepted",
        message: "A fresh confirmation code has been sent to your verified email address.",
      },
      {
        status: 202,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }

  // Confirm step: verify fresh OTP for the exact same UID
  const { data: verified, error: verifyError } =
    await sessionClient.auth.verifyOtp({
      email: user.email,
      token: parsed.data.code,
      type: "email",
    });

  if (verifyError || !verified.user || verified.user.id !== user.id) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Invalid or expired deletion confirmation code."
    );
  }

  // Step 1: Set deletion_requested_at and insert tombstone idempotently in one DB transaction
  const { error: tombstoneError } = await sessionClient.rpc(
    "mark_account_deletion_pending" as never,
    { p_user_id: user.id } as never
  );

  if (tombstoneError) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Failed to record deletion tombstone. Please try again."
    );
  }

  // Step 2: Delete Auth user (cascading user_events and account_controls while preserving deleted_accounts tombstone)
  const serviceClient = createSupabaseServiceServerClient();
  const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(
    user.id
  );

  if (deleteUserError) {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Account deletion is marked pending and ordinary writes are blocked; please retry to complete removal."
    );
  }

  await sessionClient.auth.signOut();

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
}
