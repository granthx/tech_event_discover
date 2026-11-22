import { z } from "zod";
import type { DiscoverFilters } from "@/features/catalog/types";

const ALLOWED_FACET_KEYS = new Set([
  "q",
  "type",
  "mode",
  "price",
  "source",
  "city",
  "distance",
  "sort",
  "cursor",
]);

const eventTypeSchema = z.enum([
  "hackathon",
  "workshop",
  "seminar",
  "meetup",
  "conference",
  "other",
]);

const eventModeSchema = z.enum(["online", "in_person", "hybrid"]);
const priceStatusSchema = z.enum(["free", "paid", "unknown"]);
const distanceSchema = z.enum(["nearby", "farther"]);
const sortSchema = z.enum(["start", "deadline"]);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug format");

const rawDiscoverFilterSchema = z.object({
  q: z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length <= 100, {
      message: "Search query must be at most 100 characters.",
    })
    .optional(),
  type: eventTypeSchema.optional(),
  mode: eventModeSchema.optional(),
  price: priceStatusSchema.optional(),
  source: slugSchema.optional(),
  city: slugSchema.optional(),
  distance: distanceSchema.optional(),
  sort: sortSchema.default("start"),
  cursor: z.string().trim().min(1).max(2048).optional(),
});

export type ParseDiscoverFiltersResult =
  | { ok: true; filters: DiscoverFilters }
  | { ok: false; code: "INVALID_REQUEST"; message: string };

export function parseDiscoverSearchParams(
  searchParams: URLSearchParams
): ParseDiscoverFiltersResult {
  const singleValues: Record<string, string | undefined> = {};

  for (const key of searchParams.keys()) {
    if (!ALLOWED_FACET_KEYS.has(key)) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: `Unsupported filter parameter: ${key}`,
      };
    }
    const allValues = searchParams.getAll(key);
    if (allValues.length > 1) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: `Only one value per facet is permitted (${key}).`,
      };
    }
    const val = allValues[0]?.trim();
    if (val && val.length > 0) {
      singleValues[key] = val;
    }
  }

  const parsed = rawDiscoverFilterSchema.safeParse(singleValues);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: firstIssue?.message ?? "Invalid filter parameters.",
    };
  }

  const data = parsed.data;

  // Cross-facet validation per ARCHITECTURE.md:
  // "A distance filter requires a city and applies to in-person/hybrid rows. mode=online combined with distance returns 400."
  if (data.distance) {
    if (!data.city) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: "A distance filter requires a city selection.",
      };
    }
    if (data.mode === "online") {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: "mode=online cannot be combined with a distance filter.",
      };
    }
  }

  const filters: DiscoverFilters = {
    sort: data.sort,
    ...(data.q ? { q: data.q } : {}),
    ...(data.type ? { type: data.type } : {}),
    ...(data.mode ? { mode: data.mode } : {}),
    ...(data.price ? { price: data.price } : {}),
    ...(data.source ? { source: data.source } : {}),
    ...(data.city ? { city: data.city } : {}),
    ...(data.distance ? { distance: data.distance } : {}),
    ...(data.cursor ? { cursor: data.cursor } : {}),
  };

  return { ok: true, filters };
}

/**
 * Deterministic canonical identity of active filters (excluding cursor).
 * Embedded in keyset cursor to detect filter changes across paginated requests.
 */
export function buildCanonicalFilterIdentity(filters: Omit<DiscoverFilters, "cursor">): string {
  const canonical = {
    q: filters.q ?? null,
    type: filters.type ?? null,
    mode: filters.mode ?? null,
    price: filters.price ?? null,
    source: filters.source ?? null,
    city: filters.city ?? null,
    distance: filters.distance ?? null,
    sort: filters.sort,
  };
  return JSON.stringify(canonical);
}
