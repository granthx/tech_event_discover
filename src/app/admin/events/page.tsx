"use client";

import { useState } from "react";
import { CuratorMfaPanel } from "@/components/CuratorMfaPanel";
import { APPROVED_SOURCES, REFERENCE_CITIES } from "@/features/catalog/fixtures";
import type {
  CancellationReason,
  EventMode,
  EventType,
  PriceStatus,
} from "@/lib/database.types";

export default function AdminEventsPage() {
  const [title, setTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [summary, setSummary] = useState("");
  const [eventType, setEventType] = useState<EventType>("hackathon");
  const [mode, setMode] = useState<EventMode>("in_person");
  const [priceStatus, setPriceStatus] = useState<PriceStatus>("free");
  const [citySlug, setCitySlug] = useState("bengaluru");
  const [venue, setVenue] = useState("");
  const [onlineConfirmed, setOnlineConfirmed] = useState(false);
  const [eventTimezone, setEventTimezone] = useState("Asia/Kolkata");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [startOn, setStartOn] = useState("");
  const [endOn, setEndOn] = useState("");
  const [primarySourceSlug, setPrimarySourceSlug] = useState("foss-united");
  const [primarySourceUrl, setPrimarySourceUrl] = useState("");

  const [targetEventId, setTargetEventId] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(1);
  const [transitionAction, setTransitionAction] = useState<
    "publish" | "unpublish" | "cancel" | "reinstate" | "archive"
  >("publish");
  const [cancellationReason, setCancellationReason] =
    useState<CancellationReason>("organizer_canceled");

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          organizer,
          summary: summary || null,
          eventType,
          mode,
          priceStatus,
          citySlug: mode === "online" ? null : citySlug,
          venue: mode === "online" ? null : venue || null,
          onlineIndiaAccessConfirmed: mode === "online" ? onlineConfirmed : false,
          eventTimezone,
          isAllDay,
          startsAt: isAllDay ? null : startsAt || null,
          endsAt: isAllDay ? null : endsAt || null,
          startOn: isAllDay ? startOn || null : null,
          endOn: isAllDay ? endOn || null : null,
          primarySourceSlug,
          primarySourceUrl: primarySourceUrl || undefined,
        }),
      });

      const data = (await res.json()) as {
        id?: string;
        version?: number;
        message?: string;
      };
      if (!res.ok) {
        setErrorMessage(data.message ?? "Failed to create draft.");
      } else {
        if (data.id) {
          setTargetEventId(data.id);
        }
        if (typeof data.version === "number") {
          setExpectedVersion(data.version);
        }
        setStatusMessage(
          `Created draft event ${data.id ?? ""} (version ${data.version ?? 1})`
        );
      }
    } catch {
      setErrorMessage("Network error while creating draft.");
    }
  };

  const handleTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/admin/events/${targetEventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion,
          transition: transitionAction,
          cancellationReason:
            transitionAction === "cancel" ? cancellationReason : null,
        }),
      });

      const data = (await res.json()) as { version?: number; message?: string };
      if (!res.ok) {
        setErrorMessage(data.message ?? "Failed to apply transition.");
      } else {
        setStatusMessage(
          `Applied '${transitionAction}' (new version: ${data.version ?? expectedVersion + 1})`
        );
      }
    } catch {
      setErrorMessage("Network error while applying state transition.");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
          Curator Event Management
        </h1>
        <p className="text-sm text-[#475569]">
          Every curator operation requires an active <code>curator_access</code> row and a verified TOTP (<code>aal2</code>) session.
        </p>
      </div>

      <CuratorMfaPanel />

      {errorMessage && (
        <div
          role="alert"
          className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-900"
        >
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className="rounded-[12px] border border-blue-200 bg-blue-50 p-4 text-xs font-medium text-blue-950"
        >
          {statusMessage}
        </div>
      )}

      {/* Create Draft Form */}
      <section
        aria-label="Create event draft"
        className="rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs"
      >
        <h2 className="text-base font-semibold text-[#0F172A]">
          Create Draft Listing
        </h2>
        <form onSubmit={handleCreateDraft} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="curator-title"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Event title
              </label>
              <input
                id="curator-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>

            <div>
              <label
                htmlFor="curator-organizer"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Organizer
              </label>
              <input
                id="curator-organizer"
                type="text"
                required
                value={organizer}
                onChange={(e) => setOrganizer(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="curator-type"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Event type
              </label>
              <select
                id="curator-type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as EventType)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                <option value="hackathon">Hackathon</option>
                <option value="workshop">Workshop</option>
                <option value="seminar">Seminar</option>
                <option value="meetup">Meetup</option>
                <option value="conference">Conference</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="curator-mode"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Mode
              </label>
              <select
                id="curator-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as EventMode)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                <option value="in_person">In person</option>
                <option value="hybrid">Hybrid</option>
                <option value="online">Online</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="curator-price"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Price status
              </label>
              <select
                id="curator-price"
                value={priceStatus}
                onChange={(e) => setPriceStatus(e.target.value as PriceStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                <option value="free">Free</option>
                <option value="paid">Paid</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>

          {mode !== "online" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="curator-city"
                  className="block text-xs font-semibold text-[#0F172A]"
                >
                  Indian Venue City
                </label>
                <select
                  id="curator-city"
                  value={citySlug}
                  onChange={(e) => setCitySlug(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                >
                  {REFERENCE_CITIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name} ({c.state})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="curator-venue"
                  className="block text-xs font-semibold text-[#0F172A]"
                >
                  Venue name
                </label>
                <input
                  id="curator-venue"
                  type="text"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                id="curator-online-confirmed"
                type="checkbox"
                checked={onlineConfirmed}
                onChange={(e) => setOnlineConfirmed(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8]"
              />
              <label
                htmlFor="curator-online-confirmed"
                className="text-xs font-semibold text-[#0F172A]"
              >
                Confirm online event is accessible from India
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="curator-timezone"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                IANA Timezone
              </label>
              <input
                id="curator-timezone"
                type="text"
                required
                value={eventTimezone}
                onChange={(e) => setEventTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>

            {isAllDay ? (
              <>
                <div>
                  <label
                    htmlFor="curator-start-on"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    Start date (YYYY-MM-DD)
                  </label>
                  <input
                    id="curator-start-on"
                    type="date"
                    required
                    value={startOn}
                    onChange={(e) => setStartOn(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="curator-end-on"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    Exclusive end date (YYYY-MM-DD)
                  </label>
                  <input
                    id="curator-end-on"
                    type="date"
                    required
                    value={endOn}
                    onChange={(e) => setEndOn(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="curator-starts-at"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    Start timestamp (ISO 8601)
                  </label>
                  <input
                    id="curator-starts-at"
                    type="text"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    placeholder="2026-12-10T10:00:00Z"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="curator-ends-at"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    End timestamp (optional)
                  </label>
                  <input
                    id="curator-ends-at"
                    type="text"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    placeholder="Leave blank if unknown"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              id="curator-all-day"
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8]"
            />
            <label
              htmlFor="curator-all-day"
              className="text-xs font-semibold text-[#0F172A]"
            >
              All-day event (uses local start_on and exclusive end_on dates)
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="curator-source-slug"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Primary authorized source
              </label>
              <select
                id="curator-source-slug"
                value={primarySourceSlug}
                onChange={(e) => setPrimarySourceSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                {APPROVED_SOURCES.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="curator-source-url"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Primary source HTTPS URL
              </label>
              <input
                id="curator-source-url"
                type="url"
                value={primarySourceUrl}
                onChange={(e) => setPrimarySourceUrl(e.target.value)}
                placeholder="https://fossunited.org/events/..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="curator-summary"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Original curator summary (plain text)
            </label>
            <textarea
              id="curator-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
          </div>

          <button
            type="submit"
            className="rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Create draft
          </button>
        </form>
      </section>

      {/* Lifecycle Transitions Section */}
      <section
        aria-label="Event lifecycle transitions"
        className="rounded-[12px] border border-slate-200 bg-white p-6 shadow-xs"
      >
        <h2 className="text-base font-semibold text-[#0F172A]">
          Apply Lifecycle State Transition
        </h2>
        <form onSubmit={handleTransition} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="transition-event-id"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Event UUID
              </label>
              <input
                id="transition-event-id"
                type="text"
                required
                value={targetEventId}
                onChange={(e) => setTargetEventId(e.target.value)}
                placeholder="22222222-2222-4222-8222-222222222201"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>

            <div>
              <label
                htmlFor="transition-version"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Expected version
              </label>
              <input
                id="transition-version"
                type="number"
                min={1}
                required
                value={expectedVersion}
                onChange={(e) => setExpectedVersion(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              />
            </div>

            <div>
              <label
                htmlFor="transition-action"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Action
              </label>
              <select
                id="transition-action"
                value={transitionAction}
                onChange={(e) =>
                  setTransitionAction(
                    e.target.value as
                      | "publish"
                      | "unpublish"
                      | "cancel"
                      | "reinstate"
                      | "archive"
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                <option value="publish">Publish (Draft → Published)</option>
                <option value="unpublish">
                  Unpublish (Published → Draft, reserves URL)
                </option>
                <option value="cancel">Cancel (Published → Canceled)</option>
                <option value="reinstate">
                  Reinstate (Canceled → Published)
                </option>
                <option value="archive">
                  Archive (Releases source URL claims)
                </option>
              </select>
            </div>
          </div>

          {transitionAction === "cancel" && (
            <div>
              <label
                htmlFor="transition-cancel-reason"
                className="block text-xs font-semibold text-[#0F172A]"
              >
                Cancellation reason
              </label>
              <select
                id="transition-cancel-reason"
                value={cancellationReason}
                onChange={(e) =>
                  setCancellationReason(e.target.value as CancellationReason)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                <option value="organizer_canceled">
                  Canceled by the organizer
                </option>
                <option value="venue_unavailable">Venue unavailable</option>
                <option value="other_confirmed">
                  Other confirmed cancellation
                </option>
              </select>
            </div>
          )}

          <button
            type="submit"
            className="rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Apply transition
          </button>
        </form>
      </section>
    </div>
  );
}
