import { z } from "zod";
import type { ReminderKind } from "@/lib/database.types";

const smokeTupleSchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  kind: z.enum(["deadline", "attendance"]),
});

export type SmokeAllowlistTuple = z.infer<typeof smokeTupleSchema>;

export type ParsedSmokeAllowlist =
  | { ok: true; tuples: SmokeAllowlistTuple[] }
  | { ok: false; reason: string };

/**
 * Parses `REMINDER_SMOKE_ALLOWLIST` from either a JSON array of
 * `{ userId, eventId, kind }` objects OR a comma/semicolon-separated list
 * of `userId:eventId:kind` tuples.
 * Per ARCHITECTURE.md line 187:
 * - Missing or invalid smoke configuration stops sending (`ok: false`).
 */
export function parseSmokeAllowlist(raw: string): ParsedSmokeAllowlist {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "SMOKE_ALLOWLIST_EMPTY" };
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsedJson: unknown = JSON.parse(trimmed);
      const validated = z.array(smokeTupleSchema).min(1).safeParse(parsedJson);
      if (!validated.success) {
        return { ok: false, reason: "SMOKE_ALLOWLIST_INVALID_JSON" };
      }
      return { ok: true, tuples: validated.data };
    } catch {
      return { ok: false, reason: "SMOKE_ALLOWLIST_MALFORMED_JSON" };
    }
  }

  const entries = trimmed
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return { ok: false, reason: "SMOKE_ALLOWLIST_EMPTY" };
  }

  const tuples: SmokeAllowlistTuple[] = [];
  for (const entry of entries) {
    const parts = entry.split(":");
    if (parts.length !== 3) {
      return { ok: false, reason: "SMOKE_ALLOWLIST_INVALID_TUPLE" };
    }
    const candidate = smokeTupleSchema.safeParse({
      userId: parts[0],
      eventId: parts[1],
      kind: parts[2],
    });
    if (!candidate.success) {
      return { ok: false, reason: "SMOKE_ALLOWLIST_INVALID_TUPLE" };
    }
    tuples.push(candidate.data);
  }

  return { ok: true, tuples };
}

/**
 * Evaluates whether a `(userId, eventId, kind)` tuple is permitted under the active
 * `REMINDER_DELIVERY_MODE` (`smoke` | `live`).
 */
export function isDeliveryPermittedByMode(
  mode: "smoke" | "live",
  rawSmokeAllowlist: string,
  tuple: { userId: string; eventId: string; kind: ReminderKind }
): boolean {
  if (mode === "live") {
    return true;
  }

  const parsed = parseSmokeAllowlist(rawSmokeAllowlist);
  if (!parsed.ok) {
    return false;
  }

  return parsed.tuples.some(
    (item) =>
      item.userId.toLowerCase() === tuple.userId.toLowerCase() &&
      item.eventId.toLowerCase() === tuple.eventId.toLowerCase() &&
      item.kind === tuple.kind
  );
}
