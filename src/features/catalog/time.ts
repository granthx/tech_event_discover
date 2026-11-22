import { Temporal } from "@js-temporal/polyfill";

export const IST_TIMEZONE = "Asia/Kolkata";
export const UNKNOWN_END_FALLBACK_MS = 2 * 60 * 60 * 1000; // 2 hours fallback for visibility only

export interface EventScheduleInput {
  isAllDay: boolean;
  eventTimezone: string;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
}

export interface EffectiveScheduleBounds {
  effectiveStartAt: Date;
  effectiveEndAt: Date;
  hasExplicitEnd: boolean;
}

const validIanaTimezoneCache = new Map<string, boolean>();

export function isValidIanaTimezone(tz: string): boolean {
  if (
    !tz ||
    typeof tz !== "string" ||
    /^[+-]?\d/.test(tz.trim()) ||
    (!tz.includes("/") && tz !== "UTC")
  ) {
    return false;
  }
  const cached = validIanaTimezoneCache.get(tz);
  if (cached !== undefined) {
    return cached;
  }
  try {
    Intl.DateTimeFormat("en-IN", { timeZone: tz });
    validIanaTimezoneCache.set(tz, true);
    return true;
  } catch {
    validIanaTimezoneCache.set(tz, false);
    return false;
  }
}

/**
 * Resolves civil all-day or timed schedule bounds using Temporal polyfill.
 * For all-day events: start_on 00:00 in eventTimezone to end_on 00:00 in eventTimezone (exclusive end).
 * For timed events: starts_at to COALESCE(ends_at, starts_at + 2 hours).
 */
export function resolveEffectiveScheduleBounds(
  input: EventScheduleInput
): EffectiveScheduleBounds {
  if (!isValidIanaTimezone(input.eventTimezone)) {
    throw new Error(`Invalid IANA timezone: ${input.eventTimezone}`);
  }

  if (input.isAllDay) {
    if (!input.startOn || !input.endOn) {
      throw new Error("All-day events require startOn and endOn dates.");
    }
    const startDate = Temporal.PlainDate.from(input.startOn);
    const endDate = Temporal.PlainDate.from(input.endOn);
    if (Temporal.PlainDate.compare(endDate, startDate) <= 0) {
      throw new Error("All-day endOn must be strictly after startOn.");
    }

    const startZoned = startDate.toZonedDateTime({
      timeZone: input.eventTimezone,
      plainTime: Temporal.PlainTime.from("00:00:00"),
    });
    const endZoned = endDate.toZonedDateTime({
      timeZone: input.eventTimezone,
      plainTime: Temporal.PlainTime.from("00:00:00"),
    });

    return {
      effectiveStartAt: new Date(startZoned.epochMilliseconds),
      effectiveEndAt: new Date(endZoned.epochMilliseconds),
      hasExplicitEnd: true,
    };
  }

  if (!input.startsAt) {
    throw new Error("Timed events require startsAt.");
  }

  const startMs = Date.parse(input.startsAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Invalid startsAt timestamp.");
  }

  if (input.endsAt) {
    const endMs = Date.parse(input.endsAt);
    if (!Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error("Timed endsAt must be strictly after startsAt.");
    }
    return {
      effectiveStartAt: new Date(startMs),
      effectiveEndAt: new Date(endMs),
      hasExplicitEnd: true,
    };
  }

  return {
    effectiveStartAt: new Date(startMs),
    effectiveEndAt: new Date(startMs + UNKNOWN_END_FALLBACK_MS),
    hasExplicitEnd: false,
  };
}

export function classifyEventActivity(
  bounds: EffectiveScheduleBounds,
  asOf: Date
): { isActive: boolean; isOngoing: boolean; isEnded: boolean } {
  const nowMs = asOf.getTime();
  const startMs = bounds.effectiveStartAt.getTime();
  const endMs = bounds.effectiveEndAt.getTime();

  const isActive = endMs > nowMs;
  const isOngoing = startMs <= nowMs && endMs > nowMs;
  const isEnded = endMs <= nowMs;

  return { isActive, isOngoing, isEnded };
}

/**
 * Formats event schedule per PROJECT_CONTEXT.md & ARCHITECTURE.md:
 * - Timed online events are shown in IST and labeled with their event zone when different.
 * - All-day events preserve local dates (displaying inclusive end date to humans).
 * - Unknown end times stay explicit ("End time not specified").
 */
export function formatEventScheduleDisplay(input: EventScheduleInput & { mode: "online" | "in_person" | "hybrid" }): {
  primaryScheduleText: string;
  secondaryTimezoneBadge: string | null;
  endTimeNote: string | null;
} {
  if (input.isAllDay && input.startOn && input.endOn) {
    const startPlain = Temporal.PlainDate.from(input.startOn);
    const inclusiveEndPlain = Temporal.PlainDate.from(input.endOn).subtract({ days: 1 });

    const fmt = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

    const startStr = fmt.format(new Date(`${startPlain.toString()}T00:00:00Z`));
    const endStr = fmt.format(new Date(`${inclusiveEndPlain.toString()}T00:00:00Z`));

    const dateRange =
      startPlain.equals(inclusiveEndPlain)
        ? `${startStr} · All day`
        : `${startStr} – ${endStr} · All day`;

    return {
      primaryScheduleText: dateRange,
      secondaryTimezoneBadge: `Local date (${input.eventTimezone})`,
      endTimeNote: null,
    };
  }

  if (!input.startsAt) {
    return {
      primaryScheduleText: "Schedule pending",
      secondaryTimezoneBadge: null,
      endTimeNote: null,
    };
  }

  const displayZone = input.mode === "online" ? IST_TIMEZONE : input.eventTimezone;
  const zoneLabel = displayZone === IST_TIMEZONE ? "IST" : displayZone;

  const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: displayZone,
  });

  const startFormatted = dateTimeFmt.format(new Date(input.startsAt));

  let primaryScheduleText = `${startFormatted} ${zoneLabel}`;
  let endTimeNote: string | null = null;

  if (input.endsAt) {
    const endFormatted = dateTimeFmt.format(new Date(input.endsAt));
    primaryScheduleText = `${startFormatted} – ${endFormatted} ${zoneLabel}`;
  } else {
    endTimeNote = "End time not specified";
  }

  let secondaryTimezoneBadge: string | null = null;
  if (input.mode === "online" && input.eventTimezone !== IST_TIMEZONE) {
    const origFmt = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: input.eventTimezone,
    });
    secondaryTimezoneBadge = `Event zone: ${input.eventTimezone} (${origFmt.format(new Date(input.startsAt))})`;
  }

  return {
    primaryScheduleText,
    secondaryTimezoneBadge,
    endTimeNote,
  };
}
