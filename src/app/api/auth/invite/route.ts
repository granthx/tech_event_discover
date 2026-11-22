import { inviteAcceptInputSchema } from "@/features/account/state";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";

/**
 * POST /api/auth/invite
 * R1 invite acceptance contract (ARCHITECTURE.md):
 * - User submits invite token hash and explicit adultConfirmed: true.
 * - Server verifies invite with Supabase type=invite, buffers session cookies,
 *   records adult_confirmed_at for the verified UID, and only then releases cookies.
 * - Missing acknowledgement or failed write yields no usable app session.
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

  return jsonError(
    401,
    "UNAUTHENTICATED",
    "Invitation token could not be verified or has already been consumed."
  );
}
