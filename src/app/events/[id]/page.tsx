import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventDetailActions } from "@/components/EventDetailActions";
import { getPublicEventDetailById } from "@/features/catalog/service";
import { formatEventScheduleDisplay } from "@/features/catalog/time";
import { getServerEnv } from "@/lib/env";
import type { CancellationReason } from "@/lib/database.types";

export const dynamic = "force-dynamic";

const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  organizer_canceled: "Canceled by the organizer",
  venue_unavailable: "Canceled due to venue unavailability",
  other_confirmed: "Confirmed cancellation",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await getPublicEventDetailById(id);

  if (!event) {
    return {
      title: "Event Not Found",
      robots: { index: false, follow: false },
    };
  }

  const shouldIndex = event.status === "published" && !event.isEnded;

  return {
    title: event.title,
    description:
      event.summary ?? `${event.title} organized by ${event.organizer}.`,
    alternates: {
      canonical: `/events/${event.id}`,
    },
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      title: `${event.title} · Tech Event Discover`,
      description:
        event.summary ?? `${event.title} organized by ${event.organizer}.`,
      type: "article",
      url: `/events/${event.id}`,
    },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await getPublicEventDetailById(id);

  if (!event) {
    notFound();
  }

  const env = getServerEnv();
  const schedule = formatEventScheduleDisplay({
    isAllDay: event.isAllDay,
    eventTimezone: event.eventTimezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    startOn: event.startOn,
    endOn: event.endOn,
    mode: event.mode,
  });

  const eventPublicUrl = `${env.APP_ORIGIN}/events/${event.id}`;
  const correctionMailto = `mailto:${encodeURIComponent(
    env.PUBLIC_CONTACT_EMAIL
  )}?subject=${encodeURIComponent(
    `Correction report: ${event.title}`
  )}&body=${encodeURIComponent(
    `Event URL: ${eventPublicUrl}\n\nWhat needs correction or removal:\n`
  )}`;

  const primarySource = event.sources.find((s) => s.isPrimary) ?? event.sources[0];

  return (
    <article className="mx-auto max-w-3xl space-y-6 rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/discover"
          className="text-sm font-semibold text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          ← Back to Discover
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-md bg-blue-50 px-2.5 py-1 text-[#1D4ED8] uppercase">
            {event.eventType}
          </span>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[#0F172A]">
            {event.mode === "in_person"
              ? "In person"
              : event.mode === "hybrid"
              ? "Hybrid"
              : "Online"}
          </span>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[#475569]">
            {event.priceStatus === "free"
              ? "Free"
              : event.priceStatus === "paid"
              ? "Paid"
              : "Price unknown"}
          </span>
        </div>
      </div>

      {/* Canceled Banner */}
      {event.status === "canceled" && (
        <div
          role="alert"
          data-testid="canceled-event-banner"
          className="rounded-[12px] border border-red-300 bg-red-50 p-4 text-sm text-red-950"
        >
          <p className="font-bold">Event Canceled</p>
          {event.cancellationReason && (
            <p className="mt-1">
              Reason: {CANCELLATION_REASON_LABELS[event.cancellationReason]}
            </p>
          )}
          {event.canceledAt && (
            <p className="mt-0.5 text-xs text-red-800">
              Recorded at:{" "}
              {new Intl.DateTimeFormat("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kolkata",
              }).format(new Date(event.canceledAt))}{" "}
              IST
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-[#0F172A] break-words">
          {event.title}
        </h1>
        <p className="text-base font-medium text-[#475569]">
          Organized by <span className="text-[#0F172A]">{event.organizer}</span>
        </p>
      </div>

      {/* Schedule & Location Box */}
      <section
        aria-label="Schedule and location"
        className="grid grid-cols-1 gap-4 rounded-[12px] bg-[#F8FAFC] p-4 text-sm sm:grid-cols-2"
      >
        <div className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
            Date & Time
          </h2>
          <p className="font-semibold text-[#0F172A]">
            {schedule.primaryScheduleText}
          </p>
          {schedule.secondaryTimezoneBadge && (
            <p className="text-xs text-[#475569]">
              {schedule.secondaryTimezoneBadge}
            </p>
          )}
          {schedule.endTimeNote && (
            <p className="text-xs italic text-[#475569]">
              {schedule.endTimeNote}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
            Location & Access
          </h2>
          {event.cityName ? (
            <>
              <p className="font-semibold text-[#0F172A]">
                {event.cityName}
                {event.cityState ? `, ${event.cityState}` : ""}
              </p>
              {event.venue && (
                <p className="text-xs text-[#475569]">{event.venue}</p>
              )}
            </>
          ) : (
            <p className="font-semibold text-[#0F172A]">
              Online (Verified accessible from India)
            </p>
          )}
        </div>
      </section>

      {/* Curator Summary (Escaped plain text via React text node) */}
      {event.summary && (
        <section aria-label="Event summary" className="space-y-2">
          <h2 className="text-sm font-semibold text-[#0F172A]">About this event</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-[#475569]">
            {event.summary}
          </p>
        </section>
      )}

      {/* Tracking & Calendar Download Controls */}
      <EventDetailActions
        eventId={event.id}
        eventTitle={event.title}
        isPublishedAndActive={event.status === "published" && !event.isEnded}
      />

      {/* Primary Registration & Authorized Sources */}
      <section aria-label="Authorized event sources" className="space-y-3 border-t border-slate-200 pt-4">
        <h2 className="text-sm font-semibold text-[#0F172A]">
          Official Registration & Authorized Sources
        </h2>
        {primarySource && (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={primarySource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-[12px] bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <span>Follow primary source ({primarySource.name})</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}

        <ul className="space-y-2 text-xs text-[#475569]">
          {event.sources.map((src) => (
            <li key={src.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#0F172A]">{src.name}:</span>
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1D4ED8] hover:underline break-all"
              >
                {src.url}
              </a>
              <span>({src.attribution})</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Correction & Takedown Contact */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-[#475569]">
        <span>Registration and payment take place directly on the organizer’s site.</span>
        <a
          href={correctionMailto}
          className="font-semibold text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          Report a correction
        </a>
      </footer>
    </article>
  );
}
