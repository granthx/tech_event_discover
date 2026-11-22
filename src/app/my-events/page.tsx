"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MyEventItemView } from "@/features/account/lifecycle";
import type { TrackingState } from "@/lib/database.types";

export default function MyEventsPage() {
  const [activeTab, setActiveTab] = useState<TrackingState>("saved");
  const [items, setItems] = useState<MyEventItemView[]>([]);

  useEffect(() => {
    let canceled = false;
    fetch("/api/me/events?view=my-events", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) return { items: [] as MyEventItemView[] };
        return (await res.json()) as { items: MyEventItemView[] };
      })
      .then((data) => {
        if (!canceled && Array.isArray(data.items)) {
          setItems(data.items);
        }
      })
      .catch(() => {});

    return () => {
      canceled = true;
    };
  }, []);

  const filteredItems = items.filter((item) => item.trackingState === activeTab);

  const handleStateChange = async (
    eventId: string,
    targetState: "saved" | "registered" | "none"
  ) => {
    try {
      await fetch(`/api/me/events/${eventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: targetState }),
      });
    } catch {
      // Ignore offline error in local preview
    }

    if (targetState === "none") {
      setItems((prev) => prev.filter((i) => i.eventId !== eventId));
    } else {
      setItems((prev) =>
        prev.map((i) =>
          i.eventId === eventId ? { ...i, trackingState: targetState } : i
        )
      );
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">
          My Events
        </h1>
        <p className="text-sm text-[#475569]">
          Saved records your interest. Registered is your own indication that you registered on the organizer’s site.
        </p>
      </div>

      {/* Separate Saved & Registered Views */}
      <div
        role="tablist"
        aria-label="Tracked event views"
        className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
      >
        <button
          role="tab"
          id="tab-saved"
          aria-selected={activeTab === "saved"}
          aria-controls="panel-saved"
          type="button"
          onClick={() => setActiveTab("saved")}
          className={`rounded-[12px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
            activeTab === "saved"
              ? "bg-[#1D4ED8] text-white"
              : "border border-slate-300 bg-white text-[#0F172A] hover:border-[#1D4ED8]"
          }`}
        >
          Saved
        </button>
        <button
          role="tab"
          id="tab-registered"
          aria-selected={activeTab === "registered"}
          aria-controls="panel-registered"
          type="button"
          onClick={() => setActiveTab("registered")}
          className={`rounded-[12px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
            activeTab === "registered"
              ? "bg-[#1D4ED8] text-white"
              : "border border-slate-300 bg-white text-[#0F172A] hover:border-[#1D4ED8]"
          }`}
        >
          Registered
        </button>
      </div>

      <section
        role="tabpanel"
        id={activeTab === "saved" ? "panel-saved" : "panel-registered"}
        aria-labelledby={activeTab === "saved" ? "tab-saved" : "tab-registered"}
        className="space-y-4"
      >
        {filteredItems.length === 0 ? (
          <div
            data-testid="empty-my-events-state"
            className="rounded-[12px] border border-slate-200 bg-white p-8 text-center"
          >
            <p className="text-base font-semibold text-[#0F172A]">
              {activeTab === "saved"
                ? "No saved events yet."
                : "No registered events yet."}
            </p>
            <div className="mt-4">
              <Link
                href="/discover"
                className="inline-block rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                Browse events
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredItems.map((item) => {
              if (item.availability === "unavailable" || !item.event) {
                return (
                  <li
                    key={item.eventId}
                    data-testid="unavailable-tracked-event"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">
                        Event unavailable
                      </p>
                      <p className="text-xs text-[#475569]">
                        This listing is no longer publicly available.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStateChange(item.eventId, "none")}
                      className="rounded-[12px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:border-red-600 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                    >
                      Remove
                    </button>
                  </li>
                );
              }

              return (
                <li
                  key={item.eventId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-slate-200 bg-white p-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      {item.availability === "canceled" && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-red-900">
                          Canceled
                        </span>
                      )}
                      {item.availability === "ended" && (
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[#0F172A]">
                          Ended
                        </span>
                      )}
                      {item.availability === "ongoing" && (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">
                          Ongoing
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-semibold text-[#0F172A]">
                      <Link
                        href={`/events/${item.eventId}`}
                        className="hover:text-[#1D4ED8] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                      >
                        {item.event.title}
                      </Link>
                    </h2>
                    <p className="text-xs text-[#475569]">
                      Organized by {item.event.organizer}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(item.availability === "active" ||
                      item.availability === "ongoing") && (
                      <button
                        type="button"
                        onClick={() =>
                          handleStateChange(
                            item.eventId,
                            item.trackingState === "saved"
                              ? "registered"
                              : "saved"
                          )
                        }
                        className="rounded-[12px] border border-[#1D4ED8] bg-white px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                      >
                        {item.trackingState === "saved"
                          ? "Mark Registered"
                          : "Move to Saved"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleStateChange(item.eventId, "none")}
                      className="rounded-[12px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#475569] hover:border-red-600 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
