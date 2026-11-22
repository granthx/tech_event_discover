"use client";

import Link from "next/link";
import { formatEventScheduleDisplay } from "@/features/catalog/time";
import type { CatalogCard } from "@/features/catalog/types";
import type { TrackingState } from "@/lib/database.types";

const EVENT_TYPE_LABELS: Record<CatalogCard["eventType"], string> = {
  hackathon: "Hackathon",
  workshop: "Workshop",
  seminar: "Seminar",
  meetup: "Meetup",
  conference: "Conference",
  other: "Other",
};

const MODE_LABELS: Record<CatalogCard["mode"], string> = {
  online: "Online",
  in_person: "In person",
  hybrid: "Hybrid",
};

const PRICE_LABELS: Record<CatalogCard["priceStatus"], string> = {
  free: "Free",
  paid: "Paid",
  unknown: "Price unknown",
};

function formatDeadlineBadge(card: CatalogCard): string | null {
  if (card.registrationClosed) {
    return "Registration closed";
  }
  if (card.registrationDeadlineAt) {
    const fmt = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
    return `Deadline: ${fmt.format(new Date(card.registrationDeadlineAt))} IST`;
  }
  if (card.registrationDeadlineOn) {
    const fmt = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return `Deadline: ${fmt.format(new Date(`${card.registrationDeadlineOn}T00:00:00Z`))}`;
  }
  return null;
}

export interface EventCardProps {
  card: CatalogCard;
  trackingState?: TrackingState | undefined;
  onToggleSave?: (eventId: string, currentState: TrackingState | undefined) => void;
}

export function EventCard({ card, trackingState, onToggleSave }: EventCardProps) {
  const schedule = formatEventScheduleDisplay({
    isAllDay: card.isAllDay,
    eventTimezone: card.eventTimezone,
    startsAt: card.startsAt,
    endsAt: card.endsAt,
    startOn: card.startOn,
    endOn: card.endOn,
    mode: card.mode,
  });

  const deadlineText = formatDeadlineBadge(card);
  const isSaved = trackingState === "saved";
  const isRegistered = trackingState === "registered";

  return (
    <article
      data-testid="event-card"
      className="flex min-w-0 flex-col justify-between rounded-[12px] border border-slate-200 bg-[#FFFFFF] p-4 shadow-xs transition-shadow hover:shadow-sm"
    >
      <div className="min-w-0 space-y-2">
        {/* Top Metadata Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[#1D4ED8]">
            {EVENT_TYPE_LABELS[card.eventType]}
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[#0F172A]">
            {MODE_LABELS[card.mode]}
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[#475569]">
            {PRICE_LABELS[card.priceStatus]}
          </span>
          {card.isOngoing && (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
              Ongoing
            </span>
          )}
        </div>

        {/* Event Title & Detail Link */}
        <h2 className="text-base font-semibold leading-snug text-[#0F172A] break-words">
          <Link
            href={`/events/${card.id}`}
            className="hover:text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            {card.title}
          </Link>
        </h2>

        {/* Organizer */}
        <p className="text-sm font-medium text-[#475569] break-words">
          Organized by <span className="text-[#0F172A]">{card.organizer}</span>
        </p>

        {/* Schedule & Timezone */}
        <div className="space-y-1 text-xs text-[#475569]">
          <p className="font-medium text-[#0F172A]">{schedule.primaryScheduleText}</p>
          {schedule.secondaryTimezoneBadge && (
            <p className="text-[#475569]">{schedule.secondaryTimezoneBadge}</p>
          )}
          {schedule.endTimeNote && (
            <p className="italic text-[#475569]">{schedule.endTimeNote}</p>
          )}
        </div>

        {/* City & Distance Estimate */}
        <div className="text-xs text-[#475569]">
          {card.cityName ? (
            <p>
              Location:{" "}
              <span className="font-medium text-[#0F172A]">
                {card.cityName}
                {card.cityState ? `, ${card.cityState}` : ""}
              </span>
              {card.distanceEstimateKm !== null && (
                <span className="ml-1 text-[#475569]">
                  (~{card.distanceEstimateKm} km city-center estimate)
                </span>
              )}
            </p>
          ) : (
            <p>Location: Online (India access confirmed)</p>
          )}
        </div>

        {/* Supplied Deadline */}
        {deadlineText && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
            {deadlineText}
          </p>
        )}
      </div>

      {/* Footer Actions: Primary Organizer Link + Save Button */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="min-w-0 flex-1">
          <a
            href={card.primarySource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            <span>Register on {card.primarySource.name}</span>
            <span aria-hidden="true">↗</span>
          </a>
          <p className="truncate text-[11px] text-[#475569]">
            {card.primarySource.attribution}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onToggleSave?.(card.id, trackingState)}
          aria-pressed={isSaved || isRegistered}
          aria-label={`${isRegistered ? "Registered for" : isSaved ? "Saved" : "Save"} ${card.title}`}
          className={`rounded-[12px] border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
            isRegistered
              ? "border-emerald-700 bg-emerald-50 text-emerald-900"
              : isSaved
              ? "border-[#1D4ED8] bg-[#1D4ED8] text-white"
              : "border-slate-300 bg-white text-[#0F172A] hover:border-[#1D4ED8] hover:text-[#1D4ED8]"
          }`}
        >
          {isRegistered ? "Registered" : isSaved ? "Saved" : "Save"}
        </button>
      </div>
    </article>
  );
}
