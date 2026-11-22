import { NextResponse } from "next/server";
import { generateEventCalendarIcs } from "@/features/catalog/calendar";
import { getPublicEventDetailById } from "@/features/catalog/service";
import { getServerEnv } from "@/lib/env";
import { jsonError } from "@/lib/security/http";

/**
 * GET /api/events/[id]/calendar
 * - 200 text/calendar for active published events
 * - 409 EVENT_INACTIVE for public canceled or ended events
 * - 404 NOT_FOUND for hidden (draft, archived) or unknown events
 * - Live read with Cache-Control: no-store
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const now = new Date();
  const detail = await getPublicEventDetailById(id, now);

  if (!detail) {
    return jsonError(404, "NOT_FOUND", "Event not found or unavailable.");
  }

  const env = getServerEnv();
  const primarySource =
    detail.sources.find((s) => s.isPrimary) ?? detail.sources[0] ?? null;

  const calendarResult = generateEventCalendarIcs(
    {
      id: detail.id,
      status: detail.status,
      title: detail.title,
      organizer: detail.organizer,
      summary: detail.summary,
      mode: detail.mode,
      cityName: detail.cityName,
      cityState: detail.cityState,
      venue: detail.venue,
      eventTimezone: detail.eventTimezone,
      isAllDay: detail.isAllDay,
      startsAt: detail.startsAt,
      endsAt: detail.endsAt,
      startOn: detail.startOn,
      endOn: detail.endOn,
      primarySourceUrl: primarySource?.url ?? null,
      appOrigin: env.APP_ORIGIN,
    },
    now
  );

  if (!calendarResult.ok) {
    return jsonError(
      calendarResult.status,
      calendarResult.code,
      calendarResult.message
    );
  }

  return new NextResponse(calendarResult.icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${calendarResult.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
