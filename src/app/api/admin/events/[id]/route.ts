import { NextResponse } from "next/server";
import { z } from "zod";
import { adminPatchEventInputSchema } from "@/features/curation/lifecycle";
import { normalizeSourceUrl } from "@/features/curation/url-normalization";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const eventIdSchema = z.string().uuid();

/**
 * PATCH /api/admin/events/[id]
 * Edit fields and sources, or apply an explicit state transition.
 * Takes expectedVersion; conflict is 409 VERSION_CONFLICT.
 * Canceled listings require a cancellation_reason value.
 * Passes verified user session client into guarded SECURITY DEFINER RPCs.
 */
export async function PATCH(
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

  const parsed = adminPatchEventInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid patch payload."
    );
  }

  const input = parsed.data;
  if (input.transition === "cancel" && !input.cancellationReason) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Canceled listings require a cancellation_reason value."
    );
  }

  let normalizedSource: { publicUrl: string; urlKey: string } | null = null;
  if (input.source) {
    const norm = normalizeSourceUrl(input.source.url);
    if (!norm.ok) {
      return jsonError(400, "INVALID_REQUEST", norm.message);
    }
    normalizedSource = { publicUrl: norm.publicUrl, urlKey: norm.urlKey };
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      403,
      "FORBIDDEN",
      "Active curator access and verified TOTP (aal2) assurance are required."
    );
  }

  const supabase = await createSupabaseSessionServerClient();

  if (input.source && normalizedSource) {
    const { data: newVersion, error } = await supabase.rpc(
      "curator_set_event_source" as never,
      {
        p_event_id: id,
        p_expected_version: input.expectedVersion,
        p_source_slug: input.source.sourceSlug,
        p_public_url: normalizedSource.publicUrl,
        p_url_key: normalizedSource.urlKey,
        p_is_primary: input.source.isPrimary,
        p_reason_code: input.reasonCode ?? "source_updated",
      } as never
    );

    if (error) {
      return mapCuratorRpcError(error.message ?? "");
    }

    return NextResponse.json(
      { id, version: newVersion },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  if (input.transition) {
    const { data: newVersion, error } = await supabase.rpc(
      "curator_transition_event_status" as never,
      {
        p_event_id: id,
        p_expected_version: input.expectedVersion,
        p_action: input.transition,
        p_cancellation_reason: input.cancellationReason ?? null,
        p_reason_code: input.reasonCode ?? input.transition,
      } as never
    );

    if (error) {
      return mapCuratorRpcError(error.message ?? "");
    }

    return NextResponse.json(
      { id, version: newVersion },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return jsonError(
    400,
    "INVALID_REQUEST",
    "Specify metadata, source, or transition to update."
  );
}

function mapCuratorRpcError(msg: string) {
  if (msg.includes("CURATOR_UNAUTHENTICATED")) {
    return jsonError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  if (
    msg.includes("CURATOR_FORBIDDEN") ||
    msg.includes("CURATOR_AAL2_REQUIRED") ||
    msg.includes("CURATOR_ACCESS_DENIED")
  ) {
    return jsonError(
      403,
      "FORBIDDEN",
      "Active curator access and verified TOTP (aal2) assurance are required."
    );
  }
  if (msg.includes("NOT_FOUND")) {
    return jsonError(404, "NOT_FOUND", "Event not found.");
  }
  if (msg.includes("VERSION_CONFLICT")) {
    return jsonError(
      409,
      "VERSION_CONFLICT",
      "Stale expectedVersion; refresh the event before saving."
    );
  }
  if (msg.includes("SOURCE_URL_CONFLICT")) {
    return jsonError(
      409,
      "SOURCE_URL_CONFLICT",
      "Source URL is already claimed by another active event."
    );
  }
  if (msg.includes("INVALID_TRANSITION")) {
    return jsonError(
      409,
      "INVALID_TRANSITION",
      "Requested status transition is not permitted."
    );
  }
  if (msg.includes("EVENT_INACTIVE")) {
    return jsonError(
      409,
      "EVENT_INACTIVE",
      "Event effective end must be in the future to publish or reinstate."
    );
  }
  if (msg.includes("RATE_LIMITED")) {
    return jsonError(
      429,
      "RATE_LIMITED",
      "Curator mutation rate limit exceeded.",
      { "Retry-After": "60" }
    );
  }
  return jsonError(400, "INVALID_REQUEST", "Curator update failed.");
}
