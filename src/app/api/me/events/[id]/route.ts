import { NextResponse } from "next/server";
import { z } from "zod";
import { trackingMutationInputSchema } from "@/features/account/state";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const eventIdSchema = z.string().uuid();

interface TrackingRpcRow {
  http_status: number;
  error_code: string | null;
  resulting_state: string | null;
  was_updated: boolean;
}

/**
 * PUT /api/me/events/[id]
 * Takes { state: "saved" | "registered" | "none" } and invokes the transactional
 * `set_user_event_tracking` SQL RPC (advisory lock, eligibility, rate limit, ordered state table).
 * Uses private, no-store.
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

  const { data, error } = await supabase.rpc(
    "set_user_event_tracking" as never,
    {
      p_event_id: id,
      p_state: parsedInput.data.state,
    } as never
  );

  if (error) {
    return jsonError(500, "INTERNAL_ERROR", "Unable to update tracking state.");
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | TrackingRpcRow
    | undefined;

  if (!row) {
    return jsonError(500, "INTERNAL_ERROR", "Empty tracking response.");
  }

  if (row.http_status === 401) {
    return jsonError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  if (row.http_status === 403) {
    return jsonError(
      403,
      "FORBIDDEN",
      "Your account is not eligible for tracking mutations."
    );
  }
  if (row.http_status === 404) {
    return jsonError(404, "NOT_FOUND", "Event not found or unavailable.");
  }
  if (row.http_status === 409) {
    return jsonError(
      409,
      "EVENT_INACTIVE",
      "Cannot track an ended or canceled event."
    );
  }
  if (row.http_status === 429) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Too many tracking updates. Please wait a minute.",
      { "Retry-After": "60" }
    );
  }

  return NextResponse.json(
    { eventId: id, state: row.resulting_state },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
