"use client";

import { useEffect, useState } from "react";
import type { TrackingState } from "@/lib/database.types";

export interface EventDetailActionsProps {
  eventId: string;
  eventTitle: string;
  isPublishedAndActive: boolean;
}

export function EventDetailActions({
  eventId,
  eventTitle,
  isPublishedAndActive,
}: EventDetailActionsProps) {
  const [trackingState, setTrackingState] = useState<TrackingState | null>(null);
  const [updating, setUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetch(`/api/me/events?ids=${encodeURIComponent(eventId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) return { items: {} as Record<string, TrackingState> };
        return (await res.json()) as { items: Record<string, TrackingState> };
      })
      .then((data) => {
        if (canceled) return;
        setTrackingState(data.items?.[eventId] ?? null);
      })
      .catch(() => { });

    return () => {
      canceled = true;
    };
  }, [eventId]);

  const handleSetTracking = async (nextState: "saved" | "registered" | "none") => {
    const previousState = trackingState;
    setUpdating(true);
    setStatusMessage(null);
    // Optimistic instant UI update
    setTrackingState(nextState === "none" ? null : nextState);

    try {
      const res = await fetch(`/api/me/events/${eventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      });

      if (res.status === 401) {
        setTrackingState(previousState);
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(`/events/${eventId}`)}`
        );
        return;
      }

      if (res.ok) {
        setStatusMessage(
          nextState === "none"
            ? "Removed from My Events."
            : nextState === "registered"
              ? "Marked as Registered in My Events."
              : "Saved to My Events."
        );
      } else {
        setTrackingState(previousState);
        const err = (await res.json()) as { message?: string };
        setStatusMessage(err.message ?? "Could not update tracking state.");
      }
    } catch {
      setTrackingState(previousState);
      setStatusMessage("Network error while updating tracking.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section
      aria-label="Event tracking and calendar download"
      className="space-y-4 rounded-[12px] border border-slate-200 bg-[#F8FAFC] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-[#0F172A]">
            Track Event & Calendar Copy
          </h2>
          <p className="text-xs text-[#475569]">
            Save for later or mark Registered after you complete registration on the organizer’s site.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={updating || (!isPublishedAndActive && trackingState !== "saved")}
            onClick={() =>
              handleSetTracking(trackingState === "saved" ? "none" : "saved")
            }
            aria-pressed={trackingState === "saved"}
            className={`rounded-[12px] border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${trackingState === "saved"
              ? "border-[#1D4ED8] bg-[#1D4ED8] text-white"
              : "border-slate-300 bg-white text-[#0F172A] hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
              }`}
          >
            {trackingState === "saved" ? "Saved" : "Save event"}
          </button>

          <button
            type="button"
            disabled={
              updating || (!isPublishedAndActive && trackingState !== "registered")
            }
            onClick={() =>
              handleSetTracking(
                trackingState === "registered" ? "none" : "registered"
              )
            }
            aria-pressed={trackingState === "registered"}
            className={`rounded-[12px] border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${trackingState === "registered"
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-slate-300 bg-white text-[#0F172A] hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
              }`}
          >
            {trackingState === "registered"
              ? "Marked Registered"
              : "Mark Registered"}
          </button>

          {trackingState !== null && (
            <button
              type="button"
              disabled={updating}
              onClick={() => handleSetTracking("none")}
              className="rounded-[12px] border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#475569] hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <p role="status" className="text-xs font-medium text-[#1D4ED8]">
          {statusMessage}
        </p>
      )}

      {isPublishedAndActive ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
          <p className="text-xs text-[#475569]">
            This calendar file (<code>.ics</code>) is a one-time static copy and does not sync future changes automatically.
          </p>
          <a
            href={`/api/events/${eventId}/calendar`}
            download={`event-${eventId}.ics`}
            aria-label={`Download calendar file for ${eventTitle}`}
            className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#1D4ED8] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            <span>Download calendar (.ics)</span>
          </a>
        </div>
      ) : (
        <p className="border-t border-slate-200 pt-3 text-xs text-[#475569]">
          Calendar download and new tracking are unavailable for canceled or ended events.
        </p>
      )}
    </section>
  );
}
