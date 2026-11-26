"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EventCard } from "@/components/EventCard";
import { APPROVED_SOURCES, REFERENCE_CITIES } from "@/features/catalog/fixtures";
import type {
  CatalogCard,
  CatalogDiscoverResponse,
  UserTrackingMap,
} from "@/features/catalog/types";
import type { TrackingState } from "@/lib/database.types";

export function DiscoverClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentQuery = searchParams.get("q") ?? "";
  const currentType = searchParams.get("type") ?? "";
  const currentMode = searchParams.get("mode") ?? "";
  const currentPrice = searchParams.get("price") ?? "";
  const currentSource = searchParams.get("source") ?? "";
  const currentCity = searchParams.get("city") ?? "";
  const currentDistance = searchParams.get("distance") ?? "";
  const currentSort = searchParams.get("sort") ?? "start";
  const currentCursor = searchParams.get("cursor") ?? "";

  const [searchInput, setSearchInput] = useState(currentQuery);
  const [items, setItems] = useState<CatalogCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [trackingMap, setTrackingMap] = useState<UserTrackingMap>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setSearchInput(currentQuery);
  }, [currentQuery]);

  const apiQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (currentQuery) params.set("q", currentQuery);
    if (currentType) params.set("type", currentType);
    if (currentMode) params.set("mode", currentMode);
    if (currentPrice) params.set("price", currentPrice);
    if (currentSource) params.set("source", currentSource);
    if (currentCity) params.set("city", currentCity);
    if (currentDistance) params.set("distance", currentDistance);
    if (currentSort && currentSort !== "start") params.set("sort", currentSort);
    if (currentCursor) params.set("cursor", currentCursor);
    return params.toString();
  }, [
    currentQuery,
    currentType,
    currentMode,
    currentPrice,
    currentSource,
    currentCity,
    currentDistance,
    currentSort,
    currentCursor,
  ]);

  // 1. Fetch public catalog JSON with credentials omitted (30s shared CDN cacheable)
  useEffect(() => {
    let canceled = false;
    setStatus("loading");

    const url = apiQueryString
      ? `/api/catalog/discover?${apiQueryString}`
      : "/api/catalog/discover";

    fetch(url, {
      method: "GET",
      credentials: "omit",
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as CatalogDiscoverResponse;
      })
      .then((data) => {
        if (canceled) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setStatus("ready");
      })
      .catch(() => {
        if (canceled) return;
        setStatus("error");
      });

    return () => {
      canceled = true;
    };
  }, [apiQueryString, reloadNonce]);

  // 2. Separately overlay private tracking states with no-store
  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    let canceled = false;
    const ids = items.slice(0, 24).map((i) => i.id).join(",");

    fetch(`/api/me/events?ids=${encodeURIComponent(ids)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) return { items: {} as UserTrackingMap };
        return (await res.json()) as { items: UserTrackingMap };
      })
      .then((data) => {
        if (canceled) return;
        setTrackingMap(data.items ?? {});
      })
      .catch(() => {
        // Non-fatal if private tracking overlay fails
      });

    return () => {
      canceled = true;
    };
  }, [items]);

  const updateFacet = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      // Reset keyset cursor whenever any filter changes
      next.delete("cursor");

      for (const [key, val] of Object.entries(updates)) {
        if (!val || val.trim() === "") {
          next.delete(key);
        } else {
          next.set(key, val.trim());
        }
      }

      // Enforce distance facet rules in UI:
      // distance requires a city and cannot combine with mode=online
      if (!next.get("city") || next.get("mode") === "online") {
        next.delete("distance");
      }

      if (next.get("sort") === "start") {
        next.delete("sort");
      }

      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const handleClearFilters = useCallback(() => {
    setSearchInput("");
    router.push(pathname);
  }, [pathname, router]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFacet({ q: searchInput });
  };

  const handleToggleSave = async (
    eventId: string,
    currentState: TrackingState | undefined
  ) => {
    const targetState = currentState === "saved" ? "none" : "saved";

    // Optimistic instant UI update (reverts on error or 401)
    setTrackingMap((prev) => {
      const copy = { ...prev };
      if (targetState === "none") {
        delete copy[eventId];
      } else {
        copy[eventId] = targetState;
      }
      return copy;
    });

    try {
      const res = await fetch(`/api/me/events/${eventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: targetState }),
      });

      if (res.status === 401) {
        // Revert optimistic toggle and perform full navigation so /sign-in receives its Turnstile CSP
        setTrackingMap((prev) => {
          const copy = { ...prev };
          if (currentState) {
            copy[eventId] = currentState;
          } else {
            delete copy[eventId];
          }
          return copy;
        });
        window.location.assign(
          `/sign-in?returnTo=${encodeURIComponent(pathname)}`
        );
        return;
      }

      if (!res.ok) {
        // Revert optimistic update on failure
        setTrackingMap((prev) => {
          const copy = { ...prev };
          if (currentState) {
            copy[eventId] = currentState;
          } else {
            delete copy[eventId];
          }
          return copy;
        });
      }
    } catch {
      // Revert optimistic update on network error
      setTrackingMap((prev) => {
        const copy = { ...prev };
        if (currentState) {
          copy[eventId] = currentState;
        } else {
          delete copy[eventId];
        }
        return copy;
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Search and Visible Filters Bar */}
      <section
        aria-label="Search and filter events"
        className="rounded-[12px] border border-slate-200 bg-[#FFFFFF] p-4 shadow-xs"
      >
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="discover-search" className="sr-only">
              Search events by title, organizer, or topic
            </label>
            <input
              id="discover-search"
              name="q"
              type="search"
              maxLength={100}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search hackathons, workshops, Rust, systems..."
              className="w-full rounded-[12px] border border-slate-300 bg-white px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#475569] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            />
          </div>
          <button
            type="submit"
            className="rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Search
          </button>
        </form>

        {/* Visible Facets */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
          <div>
            <label
              htmlFor="filter-type"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Event type
            </label>
            <select
              id="filter-type"
              value={currentType}
              onChange={(e) => updateFacet({ type: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">All types</option>
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
              htmlFor="filter-mode"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Attendance mode
            </label>
            <select
              id="filter-mode"
              value={currentMode}
              onChange={(e) => updateFacet({ mode: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">All modes</option>
              <option value="online">Online (incl. Hybrid)</option>
              <option value="in_person">In person (incl. Hybrid)</option>
              <option value="hybrid">Hybrid only</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-price"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Price
            </label>
            <select
              id="filter-price"
              value={currentPrice}
              onChange={(e) => updateFacet({ price: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">Any price</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
              <option value="unknown">Price unknown</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-city"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              City
            </label>
            <select
              id="filter-city"
              value={currentCity}
              onChange={(e) => updateFacet({ city: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">All India / Online</option>
              {REFERENCE_CITIES.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-distance"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Distance (50 km)
            </label>
            <select
              id="filter-distance"
              value={currentDistance}
              disabled={!currentCity || currentMode === "online"}
              onChange={(e) => updateFacet({ distance: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] disabled:bg-slate-100 disabled:text-[#475569] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">Exact city match</option>
              <option value="nearby">Nearby (≤ 50 km center est.)</option>
              <option value="farther">Farther away (&gt; 50 km)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-source"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Source
            </label>
            <select
              id="filter-source"
              value={currentSource}
              onChange={(e) => updateFacet({ source: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="">All sources</option>
              {APPROVED_SOURCES.map((source) => (
                <option key={source.slug} value={source.slug}>
                  {source.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-sort"
              className="block text-xs font-semibold text-[#0F172A]"
            >
              Sort by
            </label>
            <select
              id="filter-sort"
              value={currentSort}
              onChange={(e) => updateFacet({ sort: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              <option value="start">Start date (ongoing first)</option>
              <option value="deadline">Registration deadline</option>
            </select>
          </div>
        </div>
      </section>

      {/* Catalog Results Grid / Empty / Error States */}
      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[12px] border border-slate-200 bg-white p-8 text-center text-sm text-[#475569]"
        >
          Loading verified tech events...
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="rounded-[12px] border border-red-200 bg-white p-8 text-center"
        >
          <p className="text-base font-semibold text-[#0F172A]">
            We couldn’t load events.
          </p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="mt-4 rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Try again
          </button>
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <div
          data-testid="empty-discover-state"
          className="rounded-[12px] border border-slate-200 bg-white p-8 text-center"
        >
          <p className="text-base font-semibold text-[#0F172A]">
            No events match these filters.
          </p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="mt-4 rounded-[12px] bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            Clear filters
          </button>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <>
          {/* Density tokens: 1 col at 320px, 2 cols at 768px (md), 3 cols at 1200px (xl) */}
          <div
            data-testid="discover-grid"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {items.map((card) => (
              <EventCard
                key={card.id}
                card={card}
                trackingState={trackingMap[card.id]}
                onToggleSave={handleToggleSave}
              />
            ))}
          </div>

          {nextCursor && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams.toString());
                  next.set("cursor", nextCursor);
                  router.push(`${pathname}?${next.toString()}`);
                }}
                className="rounded-[12px] border border-[#1D4ED8] bg-white px-5 py-2 text-sm font-semibold text-[#1D4ED8] hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
              >
                Next page
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
