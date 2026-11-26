import { NextResponse } from "next/server";
import { REFERENCE_CITIES } from "@/features/catalog/fixtures";
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
  let normalizedSource: { publicUrl: string; urlKey: string } | null = null;
  if (input.primarySourceUrl) {
    const normalized = normalizeSourceUrl(input.primarySourceUrl);
    if (!normalized.ok) {
      return jsonError(400, "INVALID_REQUEST", normalized.message);
    }
    normalizedSource = {
      publicUrl: normalized.publicUrl,
      urlKey: normalized.urlKey,
    };
  }

  let resolvedCityId: string | null = null;
  if (input.mode !== "online" && input.citySlug) {
    const cityMatch = REFERENCE_CITIES.find((c) => c.slug === input.citySlug);
    if (!cityMatch) {
      return jsonError(
        400,
        "INVALID_REQUEST",
        `Unknown Indian venue city: ${input.citySlug}`
      );
    }
    resolvedCityId = cityMatch.id;
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
      p_city_id: resolvedCityId,
      p_venue: input.venue ?? null,
      p_online_india_access_confirmed: input.onlineIndiaAccessConfirmed,
      p_event_timezone: input.eventTimezone,
      p_is_all_day: input.isAllDay,
      p_starts_at: input.isAllDay ? null : input.startsAt ?? null,
      p_ends_at: input.isAllDay ? null : input.endsAt ?? null,
      p_start_on: input.isAllDay ? input.startOn ?? null : null,
      p_end_on: input.isAllDay ? input.endOn ?? null : null,
      p_registration_deadline_at: input.registrationDeadlineAt ?? null,
      p_registration_deadline_on: input.registrationDeadlineOn ?? null,
    } as never
  );

  if (error || !eventId) {
    const msg = error?.message ?? "";
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

  let currentVersion = 1;
  if (normalizedSource && input.primarySourceSlug) {
    const { data: nextVer, error: srcError } = await supabase.rpc(
      "curator_set_event_source" as never,
      {
        p_event_id: eventId,
        p_expected_version: 1,
        p_source_slug: input.primarySourceSlug,
        p_public_url: normalizedSource.publicUrl,
        p_url_key: normalizedSource.urlKey,
        p_is_primary: true,
        p_reason_code: "initial_primary_source",
      } as never
    );

    if (srcError) {
      const sMsg = srcError.message ?? "";
      if (sMsg.includes("SOURCE_URL_CONFLICT")) {
        return jsonError(
          409,
          "SOURCE_URL_CONFLICT",
          `Draft ${String(eventId)} created (v1), but the source URL is already claimed by another active event.`
        );
      }
    } else if (typeof nextVer === "number") {
      currentVersion = nextVer;
    }
  }

  return NextResponse.json(
    { id: eventId, status: "draft", version: currentVersion },
    {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
