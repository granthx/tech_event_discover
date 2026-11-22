import ICAL from "ical.js";
import {
  classifyEventActivity,
  resolveEffectiveScheduleBounds,
} from "@/features/catalog/time";
import type { EventStatus } from "@/lib/database.types";

export interface CalendarExportEventInput {
  id: string;
  status: EventStatus;
  title: string;
  organizer: string;
  summary: string | null;
  mode: "online" | "in_person" | "hybrid";
  cityName: string | null;
  cityState: string | null;
  venue: string | null;
  eventTimezone: string;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  primarySourceUrl: string | null;
  appOrigin: string;
}

export type GenerateEventCalendarResult =
  | {
      ok: true;
      status: 200;
      icsContent: string;
      filename: string;
    }
  | {
      ok: false;
      status: 404 | 409;
      code: "NOT_FOUND" | "EVENT_INACTIVE";
      message: string;
    };

function toIcalUtcTime(isoString: string): ICAL.Time {
  const d = new Date(isoString);
  return ICAL.Time.fromData(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      isDate: false,
    },
    ICAL.Timezone.utcTimezone
  );
}

function toIcalDateOnly(dateString: string): ICAL.Time {
  const [yStr, mStr, dStr] = dateString.split("-");
  return ICAL.Time.fromData({
    year: Number(yStr),
    month: Number(mStr),
    day: Number(dStr),
    isDate: true,
  });
}

function buildLocationText(input: CalendarExportEventInput): string {
  if (input.mode === "online") {
    return "Online (India access confirmed)";
  }
  const parts: string[] = [];
  if (input.venue) parts.push(input.venue);
  if (input.cityName) parts.push(input.cityName);
  if (input.cityState) parts.push(input.cityState);
  if (input.mode === "hybrid") parts.push("(Hybrid)");
  return parts.length > 0 ? parts.join(", ") : "India";
}

/**
 * Generates an RFC 5545 compliant .ics calendar export using ical.js:
 * - 200 text/calendar for active published events
 * - 409 EVENT_INACTIVE for public canceled or ended events
 * - 404 NOT_FOUND for draft, archived, or unknown events
 * - Stable UID, UTC times or VALUE=DATE, exclusive all-day DTEND,
 *   omits timed DTEND when endsAt is unknown (`ongoing_unknown_end_exports_without_dtend`),
 *   RFC-compliant escaping and folding, detail link, and one-time copy explanation.
 */
export function generateEventCalendarIcs(
  input: CalendarExportEventInput | null,
  now: Date = new Date()
): GenerateEventCalendarResult {
  if (!input || input.status === "draft" || input.status === "archived") {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Event not found or unavailable.",
    };
  }

  if (input.status === "canceled") {
    return {
      ok: false,
      status: 409,
      code: "EVENT_INACTIVE",
      message: "Calendar download is unavailable for canceled events.",
    };
  }

  const bounds = resolveEffectiveScheduleBounds({
    isAllDay: input.isAllDay,
    eventTimezone: input.eventTimezone,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    startOn: input.startOn,
    endOn: input.endOn,
  });

  const activity = classifyEventActivity(bounds, now);
  if (!activity.isActive) {
    return {
      ok: false,
      status: 409,
      code: "EVENT_INACTIVE",
      message: "Calendar download is unavailable for ended events.",
    };
  }

  const baseOrigin = input.appOrigin.replace(/\/$/, "");
  const detailUrl = `${baseOrigin}/events/${input.id}`;

  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.updatePropertyWithValue("version", "2.0");
  vcalendar.updatePropertyWithValue(
    "prodid",
    "-//Tech Event Discover//Curated Beta//EN"
  );
  vcalendar.updatePropertyWithValue("calscale", "GREGORIAN");
  vcalendar.updatePropertyWithValue("method", "PUBLISH");

  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue(
    "uid",
    `event-${input.id}@techeventdiscover.in`
  );
  vevent.updatePropertyWithValue("dtstamp", toIcalUtcTime(now.toISOString()));
  vevent.updatePropertyWithValue("summary", input.title);
  vevent.updatePropertyWithValue("location", buildLocationText(input));
  vevent.updatePropertyWithValue("url", detailUrl);

  const descriptionLines: string[] = [
    `Organizer: ${input.organizer}`,
  ];
  if (input.summary) {
    descriptionLines.push("", input.summary);
  }
  if (input.primarySourceUrl) {
    descriptionLines.push("", `Official registration: ${input.primarySourceUrl}`);
  }
  descriptionLines.push(
    "",
    `Event details: ${detailUrl}`,
    "Note: This calendar file is a one-time static copy and does not sync future schedule changes automatically."
  );

  vevent.updatePropertyWithValue("description", descriptionLines.join("\n"));

  if (input.isAllDay && input.startOn && input.endOn) {
    const dtstartProp = new ICAL.Property("dtstart");
    dtstartProp.setValue(toIcalDateOnly(input.startOn));
    vevent.addProperty(dtstartProp);

    // Exclusive all-day DTEND
    const dtendProp = new ICAL.Property("dtend");
    dtendProp.setValue(toIcalDateOnly(input.endOn));
    vevent.addProperty(dtendProp);
  } else if (input.startsAt) {
    vevent.updatePropertyWithValue("dtstart", toIcalUtcTime(input.startsAt));

    // Only emit DTEND when endsAt is explicitly supplied; omit DTEND when unknown!
    if (input.endsAt) {
      vevent.updatePropertyWithValue("dtend", toIcalUtcTime(input.endsAt));
    }
  }

  vcalendar.addSubcomponent(vevent);

  return {
    ok: true,
    status: 200,
    icsContent: vcalendar.toString(),
    filename: `event-${input.id}.ics`,
  };
}
