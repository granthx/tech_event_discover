import { NextResponse } from "next/server";
import { adminCreateEventInputSchema } from "@/features/curation/lifecycle";
import { normalizeSourceUrl } from "@/features/curation/url-normalization";
import { getServerEnv } from "@/lib/env";
import {
  jsonError,
  parseBoundedJsonBody,
  verifySameOriginMutation,
} from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/events
 * Creates a draft event (and optional primary source link) using the verified
 * curator's session client so auth.uid() and verified JWT aal='aal2' reach SQL RPCs.
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

  const parsed = adminCreateEventInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid event draft parameters."
    );
  }

  const input = parsed.data;
  if (input.primarySourceUrl) {
    const normalized = normalizeSourceUrl(input.primarySourceUrl);
    if (!normalized.ok) {
      return jsonError(400, "INVALID_REQUEST", normalized.message);
    }
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
  const { data: eventId, error } = await supabase.rpc(
    "curator_create_event" as never,
    {
      p_title: input.title,
      p_organizer: input.organizer,
      p_summary: input.summary ?? null,
      p_event_type: input.eventType,
      p_mode: input.mode,
      p_price_status: input.priceStatus,
      p_venue: input.venue ?? null,
      p_online_india_access_confirmed: input.onlineIndiaAccessConfirmed,
      p_event_timezone: input.eventTimezone,
      p_is_all_day: input.isAllDay,
      p_starts_at: input.startsAt ?? null,
      p_ends_at: input.endsAt ?? null,
      p_start_on: input.startOn ?? null,
      p_end_on: input.endOn ?? null,
      p_registration_deadline_at: input.registrationDeadlineAt ?? null,
      p_registration_deadline_on: input.registrationDeadlineOn ?? null,
    } as never
  );

  if (error) {
    const msg = error.message ?? "";
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
    if (msg.includes("RATE_LIMITED")) {
      return jsonError(
        429,
        "RATE_LIMITED",
        "Curator mutation rate limit exceeded.",
        { "Retry-After": "60" }
      );
    }
    return jsonError(400, "INVALID_REQUEST", "Unable to create draft event.");
  }

  return NextResponse.json(
    { id: eventId, status: "draft", version: 1 },
    {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
