import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateTrackingTransition,
  trackingMutationInputSchema,
} from "@/features/account/state";
import { getPublicEventDetailById } from "@/features/catalog/service";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const eventIdSchema = z.string().uuid();

/**
 * PUT /api/me/events/[id]
 * Takes { state: "saved" | "registered" | "none" } and follows the tracking state table.
 * Uses no-store.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const env = getServerEnv();
  if (!verifySameOriginMutation(request, env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin mutation denied.");
  }

  const { id } = await context.params;
  if (!eventIdSchema.safeParse(id).success) {
    return jsonError(404, "NOT_FOUND", "Event not found.");
  }

  const bodyResult = await parseBoundedJsonBody<unknown>(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedInput = trackingMutationInputSchema.safeParse(bodyResult.data);
  if (!parsedInput.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "State must be 'saved', 'registered', or 'none'."
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Please sign in with an invited account to track events."
    );
  }

  const supabase = await createSupabaseSessionServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError(
      401,
      "UNAUTHENTICATED",
      "Please sign in with an invited account to track events."
    );
  }

  const { data: existingRow } = await supabase
    .from("user_events")
    .select("state")
    .eq("event_id", id)
    .maybeSingle();

  const detail = await getPublicEventDetailById(id);

  const decision = evaluateTrackingTransition({
    requestedState: parsedInput.data.state,
    existingState: existingRow?.state ?? null,
    eventStatus: detail?.status ?? "unknown",
    isEventActive: Boolean(detail && !detail.isEnded),
  });

  if (decision.status === 409) {
    return jsonError(409, decision.code, decision.message);
  }
  if (decision.status === 404) {
    return jsonError(404, decision.code, decision.message);
  }

  return NextResponse.json(
    { eventId: id, state: decision.newState },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
