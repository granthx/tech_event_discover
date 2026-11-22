import { z } from "zod";
import { buildCanonicalFilterIdentity } from "@/features/catalog/filters";
import type { DiscoverFilters } from "@/features/catalog/types";

export const MAX_CURSOR_DECODED_BYTES = 1024; // 1 KiB cap per ARCHITECTURE.md
export const MAX_CURSOR_AGE_MS = 15 * 60 * 1000; // 15 minutes cap per ARCHITECTURE.md

const isoTimestampSchema = z.string().refine(
  (value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) && value.includes("T");
  },
  { message: "Invalid ISO timestamp in cursor." }
);

const startCursorTupleSchema = z.object({
  sort: z.literal("start"),
  ongoingRank: z.union([z.literal(0), z.literal(1)]),
  effectiveStartAt: isoTimestampSchema,
  id: z.string().uuid(),
});

const deadlineCursorTupleSchema = z.object({
  sort: z.literal("deadline"),
  sortableDeadlineAt: isoTimestampSchema.nullable(),
  effectiveStartAt: isoTimestampSchema,
  id: z.string().uuid(),
});

const cursorTupleSchema = z.discriminatedUnion("sort", [
  startCursorTupleSchema,
  deadlineCursorTupleSchema,
]);

const cursorPayloadSchema = z.object({
  filterIdentity: z.string().min(2).max(600),
  asOf: isoTimestampSchema,
  tuple: cursorTupleSchema,
});

export type CursorTuple = z.infer<typeof cursorTupleSchema>;
export type CursorPayload = z.infer<typeof cursorPayloadSchema>;

export type DecodeCursorResult =
  | { ok: true; payload: CursorPayload }
  | { ok: false; code: "CURSOR_INVALID"; message: string };

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeCatalogCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") > MAX_CURSOR_DECODED_BYTES) {
    throw new Error("Encoded cursor exceeds 1 KiB decoded limit.");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeAndValidateCatalogCursor(
  rawCursor: string,
  filters: Omit<DiscoverFilters, "cursor">,
  now: Date = new Date()
): DecodeCursorResult {
  if (!rawCursor || !BASE64URL_PATTERN.test(rawCursor)) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Cursor must be a valid base64url string.",
    };
  }

  let decodedBuffer: Buffer;
  try {
    decodedBuffer = Buffer.from(rawCursor, "base64url");
  } catch {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Failed to decode base64url cursor.",
    };
  }

  if (
    decodedBuffer.byteLength === 0 ||
    decodedBuffer.byteLength > MAX_CURSOR_DECODED_BYTES
  ) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Decoded cursor exceeds 1 KiB size limit.",
    };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(decodedBuffer.toString("utf8"));
  } catch {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Cursor is not valid JSON.",
    };
  }

  const parsed = cursorPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Malformed cursor tuple.",
    };
  }

  const payload = parsed.data;
  const expectedFilterIdentity = buildCanonicalFilterIdentity(filters);

  if (
    payload.filterIdentity !== expectedFilterIdentity ||
    payload.tuple.sort !== filters.sort
  ) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Cursor does not match the current filter or sort selection.",
    };
  }

  const asOfMs = Date.parse(payload.asOf);
  const nowMs = now.getTime();

  // Reject future times (allowing 0ms drift against explicit clock)
  if (asOfMs > nowMs) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Cursor timestamp is in the future.",
    };
  }

  // Reject ages over 15 minutes
  if (nowMs - asOfMs > MAX_CURSOR_AGE_MS) {
    return {
      ok: false,
      code: "CURSOR_INVALID",
      message: "Cursor has expired (older than 15 minutes).",
    };
  }

  return { ok: true, payload };
}
