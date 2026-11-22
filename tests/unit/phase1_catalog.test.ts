import { describe, expect, it } from "vitest";
import { GET as getCatalogDiscover } from "@/app/api/catalog/discover/route";
import {
  decodeAndValidateCatalogCursor,
  encodeCatalogCursor,
} from "@/features/catalog/cursor";
import {
  buildCanonicalFilterIdentity,
  parseDiscoverSearchParams,
} from "@/features/catalog/filters";
import {
  buildCatalogFixtureEvents,
  type EventFixture,
} from "@/features/catalog/fixtures";
import { executeCatalogDiscoverInMemory } from "@/features/catalog/service";
import {
  classifyEventActivity,
  resolveEffectiveScheduleBounds,
} from "@/features/catalog/time";

describe("Phase 1 · Catalog time, search, distance, sorting, cursor & public/private isolation", () => {
  const baseNow = new Date("2026-12-01T10:00:00.000Z");

  it("all_day_exclusive_end: uses local midnight in event IANA timezone as exclusive end", () => {
    // start_on 2026-12-01, end_on 2026-12-02 in Asia/Kolkata (+05:30)
    // Exclusive end is 2026-12-02T00:00:00+05:30 == 2026-12-01T18:30:00.000Z
    const bounds = resolveEffectiveScheduleBounds({
      isAllDay: true,
      eventTimezone: "Asia/Kolkata",
      startsAt: null,
      endsAt: null,
      startOn: "2026-12-01",
      endOn: "2026-12-02",
    });

    expect(bounds.effectiveStartAt.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(bounds.effectiveEndAt.toISOString()).toBe("2026-12-01T18:30:00.000Z");

    const oneSecBeforeEnd = classifyEventActivity(
      bounds,
      new Date("2026-12-01T18:29:59.000Z")
    );
    expect(oneSecBeforeEnd.isActive).toBe(true);
    expect(oneSecBeforeEnd.isOngoing).toBe(true);

    const atExactExclusiveEnd = classifyEventActivity(
      bounds,
      new Date("2026-12-01T18:30:00.000Z")
    );
    expect(atExactExclusiveEnd.isActive).toBe(false);
    expect(atExactExclusiveEnd.isEnded).toBe(true);
  });

  it("unknown_end_is_active_for_two_hours & ongoing_publication_allowed: timed unknown end is active for 2 hours and sorts ongoing first", () => {
    const bounds = resolveEffectiveScheduleBounds({
      isAllDay: false,
      eventTimezone: "Asia/Kolkata",
      startsAt: "2026-12-01T09:00:00.000Z",
      endsAt: null,
      startOn: null,
      endOn: null,
    });

    expect(bounds.hasExplicitEnd).toBe(false);
    expect(bounds.effectiveEndAt.toISOString()).toBe("2026-12-01T11:00:00.000Z");

    const withinTwoHours = classifyEventActivity(
      bounds,
      new Date("2026-12-01T10:59:59.000Z")
    );
    expect(withinTwoHours.isActive).toBe(true);
    expect(withinTwoHours.isOngoing).toBe(true);

    const atTwoHours = classifyEventActivity(
      bounds,
      new Date("2026-12-01T11:00:00.000Z")
    );
    expect(atTwoHours.isActive).toBe(false);
    expect(atTwoHours.isEnded).toBe(true);

    // Verify ongoing event sorts first in start sort
    const fixtures = buildCatalogFixtureEvents(baseNow);
    const res = executeCatalogDiscoverInMemory({ sort: "start" }, fixtures, baseNow);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.items[0]?.id).toBe("22222222-2222-4222-8222-222222222206");
      expect(res.data.items[0]?.isOngoing).toBe(true);
    }
  });

  it("nearby_50km_boundary: includes Bengaluru (0 km) and Hosur (~35.9 km), excludes Mysuru (~128 km) and online-only", () => {
    const fixtures = buildCatalogFixtureEvents(baseNow);

    const nearbyRes = executeCatalogDiscoverInMemory(
      { sort: "start", city: "bengaluru", distance: "nearby" },
      fixtures,
      baseNow
    );
    expect(nearbyRes.ok).toBe(true);
    if (nearbyRes.ok) {
      const ids = nearbyRes.data.items.map((i) => i.id);
      // Bengaluru in-person hackathon + Hosur hybrid meetup
      expect(ids).toContain("22222222-2222-4222-8222-222222222201");
      expect(ids).toContain("22222222-2222-4222-8222-222222222203");
      // Excludes Mysuru (~128 km) and Mumbai and online-only events
      expect(ids).not.toContain("22222222-2222-4222-8222-222222222204");
      expect(ids).not.toContain("22222222-2222-4222-8222-222222222205");
      expect(ids).not.toContain("22222222-2222-4222-8222-222222222202");
    }

    const fartherRes = executeCatalogDiscoverInMemory(
      { sort: "start", city: "bengaluru", distance: "farther" },
      fixtures,
      baseNow
    );
    expect(fartherRes.ok).toBe(true);
    if (fartherRes.ok) {
      const ids = fartherRes.data.items.map((i) => i.id);
      expect(ids).toContain("22222222-2222-4222-8222-222222222204"); // Mysuru
      expect(ids).toContain("22222222-2222-4222-8222-222222222205"); // Mumbai
      expect(ids).not.toContain("22222222-2222-4222-8222-222222222201");
      expect(ids).not.toContain("22222222-2222-4222-8222-222222222203");
    }
  });

  it("rejects mode=online combined with distance and distance without city with 400", () => {
    const onlineDistance = parseDiscoverSearchParams(
      new URLSearchParams("city=bengaluru&mode=online&distance=nearby")
    );
    expect(onlineDistance.ok).toBe(false);

    const distanceWithoutCity = parseDiscoverSearchParams(
      new URLSearchParams("distance=nearby")
    );
    expect(distanceWithoutCity.ok).toBe(false);
  });

  it("deadline_sort_nulls_last: orders future exact open deadlines ascending first, then date-only/closed/missing deadlines NULLS LAST by effective_start_at ASC, id ASC", () => {
    const fixtures = buildCatalogFixtureEvents(baseNow);
    const extraDateOnlyEvent: EventFixture = {
      id: "22222222-2222-4222-8222-222222222210",
      status: "published",
      version: 1,
      title: "Date Only Deadline Summit",
      organizer: "FOSS United",
      summary: "Has a date-only deadline which is non-exact and sorts in NULLS LAST group",
      eventType: "seminar",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: new Date(baseNow.getTime() + 1 * 86_400_000).toISOString(),
      endsAt: new Date(baseNow.getTime() + 1.2 * 86_400_000).toISOString(),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: "2026-12-01",
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333310",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/date-only-deadline-2026",
          isPrimary: true,
        },
      ],
    };

    const res = executeCatalogDiscoverInMemory(
      { sort: "deadline" },
      [...fixtures, extraDateOnlyEvent],
      baseNow
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ids = res.data.items.map((i) => i.id);
      // First 4 items have exact future open deadlines ordered ascending (+2d, +3d, +6d, +11d):
      expect(ids.slice(0, 4)).toEqual([
        "22222222-2222-4222-8222-222222222204", // deadline +2 days
        "22222222-2222-4222-8222-222222222201", // deadline +3 days
        "22222222-2222-4222-8222-222222222202", // deadline +6 days
        "22222222-2222-4222-8222-222222222205", // deadline +11 days
      ]);
      // Remaining 3 items have no exact open future deadline (NULLS LAST), ordered by effectiveStartAt ASC:
      expect(ids.slice(4)).toEqual([
        "22222222-2222-4222-8222-222222222206", // starts -1h (ongoing, no deadline)
        "22222222-2222-4222-8222-222222222210", // starts +1d (date-only deadline)
        "22222222-2222-4222-8222-222222222203", // starts +10d (no deadline)
      ]);
    }
  });

  it("verifies plural, reverse plural, last-word prefix, quoted phrase, and negated search", () => {
    const fixtures = buildCatalogFixtureEvents(baseNow);

    // 1. "hackathons" -> matches event titled "India Systems Hackathon 2026" (singular) and "Mysuru Open Source Hackathons" (plural)
    const pluralQuery = executeCatalogDiscoverInMemory(
      { sort: "start", q: "hackathons" },
      fixtures,
      baseNow
    );
    expect(pluralQuery.ok).toBe(true);
    if (pluralQuery.ok) {
      const ids = pluralQuery.data.items.map((i) => i.id);
      expect(ids).toContain("22222222-2222-4222-8222-222222222201");
      expect(ids).toContain("22222222-2222-4222-8222-222222222204");
    }

    // 2. Reverse: "hackathon" -> matches both singular "Hackathon" and plural "Hackathons"
    const singularQuery = executeCatalogDiscoverInMemory(
      { sort: "start", q: "hackathon" },
      fixtures,
      baseNow
    );
    expect(singularQuery.ok).toBe(true);
    if (singularQuery.ok) {
      const ids = singularQuery.data.items.map((i) => i.id);
      expect(ids).toContain("22222222-2222-4222-8222-222222222201");
      expect(ids).toContain("22222222-2222-4222-8222-222222222204");
    }

    // 3. Prefix: "hack" -> matches "hackathon" and "hackathons"
    const prefixQuery = executeCatalogDiscoverInMemory(
      { sort: "start", q: "hack" },
      fixtures,
      baseNow
    );
    expect(prefixQuery.ok).toBe(true);
    if (prefixQuery.ok) {
      const ids = prefixQuery.data.items.map((i) => i.id);
      expect(ids).toContain("22222222-2222-4222-8222-222222222201");
      expect(ids).toContain("22222222-2222-4222-8222-222222222204");
    }

    // 4. Multi-word with last-word prefix: "systems hack" -> retains whole-lexeme match for "systems" + prefix "hack"
    const multiWordPrefix = executeCatalogDiscoverInMemory(
      { sort: "start", q: "systems hack" },
      fixtures,
      baseNow
    );
    expect(multiWordPrefix.ok).toBe(true);
    if (multiWordPrefix.ok) {
      expect(multiWordPrefix.data.items.map((i) => i.id)).toEqual([
        "22222222-2222-4222-8222-222222222201",
      ]);
    }

    // 5. Quoted phrase: '"distributed databases"'
    const quotedQuery = executeCatalogDiscoverInMemory(
      { sort: "start", q: '"distributed databases"' },
      fixtures,
      baseNow
    );
    expect(quotedQuery.ok).toBe(true);
    if (quotedQuery.ok) {
      expect(quotedQuery.data.items.map((i) => i.id)).toEqual([
        "22222222-2222-4222-8222-222222222201",
      ]);
    }

    // 6. Negated term: 'hackathon -mysuru'
    const negatedQuery = executeCatalogDiscoverInMemory(
      { sort: "start", q: "hackathon -mysuru" },
      fixtures,
      baseNow
    );
    expect(negatedQuery.ok).toBe(true);
    if (negatedQuery.ok) {
      expect(negatedQuery.data.items.map((i) => i.id)).toEqual([
        "22222222-2222-4222-8222-222222222201",
      ]);
    }
  });

  it("validates plain base64url keyset cursor and rejects malformed, mismatched, future, and expired (>15m) cursors with CURSOR_INVALID", () => {
    const activeFilters = { sort: "start" as const, type: "hackathon" as const };
    const validCursor = encodeCatalogCursor({
      filterIdentity: buildCanonicalFilterIdentity(activeFilters),
      asOf: baseNow.toISOString(),
      tuple: {
        sort: "start",
        ongoingRank: 1,
        effectiveStartAt: "2026-12-06T10:00:00.000Z",
        id: "22222222-2222-4222-8222-222222222201",
      },
    });

    const validDecoded = decodeAndValidateCatalogCursor(
      validCursor,
      activeFilters,
      new Date(baseNow.getTime() + 5 * 60_000)
    );
    expect(validDecoded.ok).toBe(true);

    // 1. Malformed base64 / JSON
    const malformed = decodeAndValidateCatalogCursor(
      "%%%not-base64url%%%",
      activeFilters,
      baseNow
    );
    expect(malformed).toEqual({
      ok: false,
      code: "CURSOR_INVALID",
      message: expect.any(String),
    });

    // 2. Filter mismatch (e.g. changing type or sort while reusing cursor)
    const mismatched = decodeAndValidateCatalogCursor(
      validCursor,
      { sort: "start", type: "workshop" },
      baseNow
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.code).toBe("CURSOR_INVALID");
    }

    // 3. Future time
    const futureDecoded = decodeAndValidateCatalogCursor(
      validCursor,
      activeFilters,
      new Date(baseNow.getTime() - 1000)
    );
    expect(futureDecoded.ok).toBe(false);
    if (!futureDecoded.ok) {
      expect(futureDecoded.code).toBe("CURSOR_INVALID");
    }

    // 4. Expired (> 15 minutes old)
    const expiredDecoded = decodeAndValidateCatalogCursor(
      validCursor,
      activeFilters,
      new Date(baseNow.getTime() + 15 * 60_000 + 1)
    );
    expect(expiredDecoded.ok).toBe(false);
    if (!expiredDecoded.ok) {
      expect(expiredDecoded.code).toBe("CURSOR_INVALID");
    }
  });

  it("enforces public/private separation and shared cache directives on GET /api/catalog/discover", async () => {
    const reqWithCookies = new Request(
      "http://127.0.0.1:3000/api/catalog/discover?type=hackathon",
      {
        headers: {
          cookie: "sb-access-token=secret-user-session-cookie",
        },
      }
    );

    const res = await getCatalogDiscover(reqWithCookies);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(res.headers.get("vercel-cdn-cache-control")).toBe(
      "public, s-maxage=30"
    );
    expect(res.headers.get("set-cookie")).toBeNull();

    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);

    // Ensure no user tracking or session fields exist on public catalog items
    for (const item of body.items) {
      expect(item).not.toHaveProperty("trackingState");
      expect(item).not.toHaveProperty("userId");
      expect(item).not.toHaveProperty("user_id");
    }

    // Error response sends no shared-cache directive (Cache-Control: no-store)
    const badReq = new Request(
      "http://127.0.0.1:3000/api/catalog/discover?cursor=bad_cursor"
    );
    const badRes = await getCatalogDiscover(badReq);
    expect(badRes.status).toBe(400);
    expect(badRes.headers.get("cache-control")).toBe("no-store");
    expect(badRes.headers.get("vercel-cdn-cache-control")).toBeNull();
    const badJson = (await badRes.json()) as { code: string };
    expect(badJson.code).toBe("CURSOR_INVALID");
  });

  it("benchmarks 1,000 fixture events across 50 representative catalog calls with p95 <= 150ms", () => {
    const thousandEvents: EventFixture[] = Array.from({ length: 1000 }, (_, idx) => {
      const num = idx + 1;
      const hex = num.toString(16).padStart(12, "0");
      const isOnline = idx % 3 === 0;
      const citySlug = isOnline
        ? null
        : idx % 2 === 0
        ? "bengaluru"
        : "hosur";
      return {
        id: `99999999-9999-4999-8999-${hex}`,
        status: "published",
        version: 1,
        title: `India Systems & Cloud Hackathon #${num}`,
        organizer: idx % 2 === 0 ? "FOSS United" : "Rust India Community",
        summary: `Distributed systems, Rust, and web engineering event number ${num}.`,
        eventType: idx % 2 === 0 ? "hackathon" : "workshop",
        mode: isOnline ? "online" : "in_person",
        priceStatus: idx % 4 === 0 ? "paid" : "free",
        citySlug,
        venue: isOnline ? null : "Tech Auditorium",
        onlineIndiaAccessConfirmed: isOnline,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: new Date(baseNow.getTime() + (idx + 1) * 3600_000).toISOString(),
        endsAt: new Date(baseNow.getTime() + (idx + 3) * 3600_000).toISOString(),
        startOn: null,
        endOn: null,
        registrationDeadlineAt:
          idx % 2 === 0
            ? new Date(baseNow.getTime() + (idx + 0.5) * 3600_000).toISOString()
            : null,
        registrationDeadlineOn: null,
        registrationClosed: false,
        canceledAt: null,
        cancellationReason: null,
        sources: [
          {
            id: `88888888-8888-4888-8888-${hex}`,
            sourceSlug: idx % 2 === 0 ? "foss-united" : "rust-india",
            publicUrl: `https://fossunited.org/events/bench-${num}`,
            isPrimary: true,
          },
        ],
      };
    });

    const representativeQueries = [
      { sort: "start" as const },
      { sort: "deadline" as const },
      { sort: "start" as const, q: "hackathons" },
      { sort: "start" as const, city: "bengaluru", distance: "nearby" as const },
      { sort: "deadline" as const, type: "hackathon" as const, price: "free" as const },
    ];

    const durationsMs: number[] = [];
    for (let i = 0; i < 50; i++) {
      const q = representativeQueries[i % representativeQueries.length]!;
      const t0 = performance.now();
      const res = executeCatalogDiscoverInMemory(q, thousandEvents, baseNow);
      const t1 = performance.now();
      expect(res.ok).toBe(true);
      durationsMs.push(t1 - t0);
    }

    durationsMs.sort((a, b) => a - b);
    const p95Index = Math.floor(durationsMs.length * 0.95) - 1;
    const p95Ms = durationsMs[p95Index] ?? 0;
    expect(p95Ms).toBeLessThanOrEqual(150);
  });
});
