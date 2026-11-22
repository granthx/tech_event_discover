import { NextResponse } from "next/server";
import { z } from "zod";
import type { MyEventItemView } from "@/features/account/lifecycle";
import {
  classifyEventActivity,
  resolveEffectiveScheduleBounds,
} from "@/features/catalog/time";
import type { UserTrackingMap } from "@/features/catalog/types";
import { jsonError } from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const idsParamSchema = z
  .array(z.string().uuid())
  .max(24, "Cannot request more than 24 event IDs at once.");

/**
 * GET /api/me/events
 * - With ?ids=uuid1,uuid2,... (up to 24): returns caller's tracking map { items: Record<id, state> }.
 * - With ?view=my-events: reads caller's user_events under RLS and left-joins visible events
 *   (published/canceled), returning { items: MyEventItemView[] } with unavailable placeholders for hidden rows.
 * - Uses private, no-store cache directive.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view");

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (view === "my-events") {
    const detailedItems: MyEventItemView[] = [];
    if (!isPlaceholderEnv) {
      try {
        const supabase = await createSupabaseSessionServerClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: trackedRows } = await supabase
            .from("user_events")
            .select("event_id, state, updated_at")
            .order("updated_at", { ascending: false });

          const tracked = trackedRows ?? [];
          const trackedIds = tracked.map((r) => r.event_id);

          const visibleMap = new Map<
            string,
            {
              id: string;
              status: "draft" | "published" | "canceled" | "archived";
              title: string | null;
              organizer: string | null;
              event_type:
                | "hackathon"
                | "workshop"
                | "seminar"
                | "meetup"
                | "conference"
                | "other"
                | null;
              mode: "online" | "in_person" | "hybrid" | null;
              price_status: "free" | "paid" | "unknown";
              venue: string | null;
              event_timezone: string | null;
              is_all_day: boolean | null;
              starts_at: string | null;
              ends_at: string | null;
              start_on: string | null;
              end_on: string | null;
              canceled_at: string | null;
              cancellation_reason:
                | "organizer_canceled"
                | "venue_unavailable"
                | "other_confirmed"
                | null;
            }
          >();

          if (trackedIds.length > 0) {
            const { data: visibleEvents } = await supabase
              .from("events")
              .select(
                "id, status, title, organizer, event_type, mode, price_status, venue, event_timezone, is_all_day, starts_at, ends_at, start_on, end_on, canceled_at, cancellation_reason"
              )
              .in("id", trackedIds);

            for (const ev of visibleEvents ?? []) {
              visibleMap.set(ev.id, ev);
            }
          }

          const now = new Date();
          for (const row of tracked) {
            const ev = visibleMap.get(row.event_id);
            if (!ev || (ev.status !== "published" && ev.status !== "canceled")) {
              detailedItems.push({
                eventId: row.event_id,
                trackingState: row.state,
                trackedUpdatedAt: row.updated_at,
                availability: "unavailable",
                event: null,
              });
              continue;
            }

            let availability: MyEventItemView["availability"] = "active";
            if (ev.status === "canceled") {
              availability = "canceled";
            } else {
              try {
                const bounds = resolveEffectiveScheduleBounds({
                  isAllDay: Boolean(ev.is_all_day),
                  eventTimezone: ev.event_timezone ?? "Asia/Kolkata",
                  startsAt: ev.starts_at,
                  endsAt: ev.ends_at,
                  startOn: ev.start_on,
                  endOn: ev.end_on,
                });
                const act = classifyEventActivity(bounds, now);
                availability = act.isEnded
                  ? "ended"
                  : act.isOngoing
                  ? "ongoing"
                  : "active";
              } catch {
                availability = "active";
              }
            }

            detailedItems.push({
              eventId: row.event_id,
              trackingState: row.state,
              trackedUpdatedAt: row.updated_at,
              availability,
              event: {
                title: ev.title ?? "",
                organizer: ev.organizer ?? "",
                eventType: ev.event_type ?? "other",
                mode: ev.mode ?? "online",
                priceStatus: ev.price_status,
                citySlug: null,
                venue: ev.venue,
                eventTimezone: ev.event_timezone ?? "Asia/Kolkata",
                isAllDay: Boolean(ev.is_all_day),
                startsAt: ev.starts_at,
                endsAt: ev.ends_at,
                startOn: ev.start_on,
                endOn: ev.end_on,
                canceledAt: ev.canceled_at,
                cancellationReason: ev.cancellation_reason,
              },
            });
          }
        }
      } catch {
        // Return empty list if session unavailable
      }
    }

    return NextResponse.json(
      { items: detailedItems },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }

  const rawIdsParam = url.searchParams.get("ids");
  const rawList = rawIdsParam
    ? rawIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  const parsedIds = idsParamSchema.safeParse(rawList);
  if (!parsedIds.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsedIds.error.issues[0]?.message ?? "Invalid event IDs parameter."
    );
  }

  const eventIds = parsedIds.data;
  const items: UserTrackingMap = {};

  if (eventIds.length === 0) {
    return NextResponse.json(
      { items },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }

  if (!isPlaceholderEnv) {
    try {
      const supabase = await createSupabaseSessionServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: rows } = await supabase
          .from("user_events")
          .select("event_id, state")
          .in("event_id", eventIds);

        for (const row of rows ?? []) {
          items[row.event_id] = row.state;
        }
      }
    } catch {
      // Return empty map if session cannot be verified
    }
  }

  return NextResponse.json(
    { items },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
