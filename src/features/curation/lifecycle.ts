import { z } from "zod";
import {
  classifyEventActivity,
  isValidIanaTimezone,
  resolveEffectiveScheduleBounds,
} from "@/features/catalog/time";
import { normalizeSourceUrl } from "@/features/curation/url-normalization";
import type {
  CancellationReason,
  EventMode,
  EventStatus,
  EventType,
  PriceStatus,
} from "@/lib/database.types";

export interface CuratorIdentityContext {
  userId: string | null;
  isEligible: boolean;
  aal: "aal1" | "aal2" | null;
  hasActiveCuratorAccess: boolean;
}

export interface ManagedEventSourceRecord {
  id: string;
  sourceSlug: string;
  publicUrl: string;
  urlKey: string;
  isPrimary: boolean;
}

export interface ManagedEventRecord {
  id: string;
  status: EventStatus;
  version: number;
  title: string;
  organizer: string;
  summary: string | null;
  eventType: EventType;
  mode: EventMode;
  priceStatus: PriceStatus;
  citySlug: string | null;
  venue: string | null;
  onlineIndiaAccessConfirmed: boolean;
  eventTimezone: string;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  registrationDeadlineAt: string | null;
  registrationDeadlineOn: string | null;
  registrationClosed: boolean;
  canceledAt: string | null;
  cancellationReason: CancellationReason | null;
  sources: ManagedEventSourceRecord[];
  updatedAt: string;
}

export interface CuratorAuditEntry {
  id: string;
  actorId: string;
  targetId: string;
  action:
    | "create"
    | "edit"
    | "source"
    | "publish"
    | "unpublish"
    | "cancel"
    | "reinstate"
    | "archive";
  priorVersion: number | null;
  newVersion: number;
  recordedAt: string;
  reasonCode: string;
  archivedUrlKeys: string[];
}

export type CuratorOperationResult<T> =
  | { ok: true; status: 200 | 201; data: T }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409;
      code:
        | "INVALID_REQUEST"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "VERSION_CONFLICT"
        | "SOURCE_URL_CONFLICT"
        | "EVENT_INACTIVE";
      message: string;
      conflictingEventId?: string;
    };

/**
 * Normalizes event title using NFKC, lowercase, punctuation to spaces, and whitespace collapse
 * per ARCHITECTURE.md line 92.
 */
export function normalizeTitleForDeduplication(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes PostgreSQL pg_trgm compatible trigram similarity between two titles.
 * Pads each word with two leading spaces and one trailing space per pg_trgm rules.
 */
export function computeTitleTrigramSimilarity(a: string, b: string): number {
  const normA = normalizeTitleForDeduplication(a);
  const normB = normalizeTitleForDeduplication(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const extractTrigrams = (str: string): Set<string> => {
    const trigrams = new Set<string>();
    for (const word of str.split(" ")) {
      if (!word) continue;
      const padded = `  ${word} `;
      for (let i = 0; i <= padded.length - 3; i++) {
        trigrams.add(padded.slice(i, i + 3));
      }
    }
    return trigrams;
  };

  const setA = extractTrigrams(normA);
  const setB = extractTrigrams(normB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface NearDuplicateWarning {
  eventId: string;
  title: string;
  status: EventStatus;
  similarityScore: number;
  effectiveStartAt: string;
}

/**
 * Before publishing, warns on normalized title trigram similarity >= 0.65,
 * effective starts within 24 hours, and same city or both online.
 */
export function findNearDuplicateEvents(
  candidate: ManagedEventRecord,
  existingEvents: ManagedEventRecord[]
): NearDuplicateWarning[] {
  let candidateStartMs: number;
  try {
    const bounds = resolveEffectiveScheduleBounds({
      isAllDay: candidate.isAllDay,
      eventTimezone: candidate.eventTimezone,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      startOn: candidate.startOn,
      endOn: candidate.endOn,
    });
    candidateStartMs = bounds.effectiveStartAt.getTime();
  } catch {
    return [];
  }

  const warnings: NearDuplicateWarning[] = [];
  for (const other of existingEvents) {
    if (other.id === candidate.id || other.status === "archived") {
      continue;
    }

    const sameLocationScope =
      (candidate.mode === "online" && other.mode === "online") ||
      (candidate.citySlug !== null && candidate.citySlug === other.citySlug);

    if (!sameLocationScope) {
      continue;
    }

    let otherBounds;
    try {
      otherBounds = resolveEffectiveScheduleBounds({
        isAllDay: other.isAllDay,
        eventTimezone: other.eventTimezone,
        startsAt: other.startsAt,
        endsAt: other.endsAt,
        startOn: other.startOn,
        endOn: other.endOn,
      });
    } catch {
      continue;
    }

    const timeDiffMs = Math.abs(
      otherBounds.effectiveStartAt.getTime() - candidateStartMs
    );
    if (timeDiffMs > 24 * 60 * 60 * 1000) {
      continue;
    }

    const similarity = computeTitleTrigramSimilarity(
      candidate.title,
      other.title
    );
    if (similarity >= 0.65) {
      warnings.push({
        eventId: other.id,
        title: other.title,
        status: other.status,
        similarityScore: Math.round(similarity * 100) / 100,
        effectiveStartAt: otherBounds.effectiveStartAt.toISOString(),
      });
    }
  }

  return warnings.sort((a, b) => b.similarityScore - a.similarityScore);
}

/**
 * Verifies curator authorization per ARCHITECTURE.md:
 * Every call requires eligible UID, verified JWT aal='aal2', and active curator_access.
 */
export function verifyCuratorAuthority(
  ctx: CuratorIdentityContext
): { ok: true; actorId: string } | { ok: false; status: 401 | 403; code: "UNAUTHENTICATED" | "FORBIDDEN"; message: string } {
  if (!ctx.userId) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required for curator operations.",
    };
  }
  if (!ctx.isEligible || ctx.aal !== "aal2" || !ctx.hasActiveCuratorAccess) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message:
        "Active curator access and verified TOTP (aal2) assurance are required.",
    };
  }
  return { ok: true, actorId: ctx.userId };
}

function validatePublicationInvariants(
  event: ManagedEventRecord,
  now: Date
): { ok: true } | { ok: false; status: 400 | 409; code: "INVALID_REQUEST" | "EVENT_INACTIVE"; message: string } {
  if (!event.title.trim() || !event.organizer.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Published events require a nonblank title and organizer.",
    };
  }
  if (!isValidIanaTimezone(event.eventTimezone)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Published events require a valid IANA timezone.",
    };
  }
  if (
    (event.mode === "in_person" || event.mode === "hybrid") &&
    !event.citySlug
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "In-person and hybrid events require an Indian city.",
    };
  }
  if (
    event.mode === "online" &&
    (event.citySlug !== null || !event.onlineIndiaAccessConfirmed)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message:
        "Online events require city to be null and India access confirmed.",
    };
  }
  const hasPrimarySource = event.sources.some((s) => s.isPrimary);
  if (!hasPrimarySource) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Published events require one primary authorized source link.",
    };
  }

  let bounds;
  try {
    bounds = resolveEffectiveScheduleBounds({
      isAllDay: event.isAllDay,
      eventTimezone: event.eventTimezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      startOn: event.startOn,
      endOn: event.endOn,
    });
  } catch (err) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: err instanceof Error ? err.message : "Invalid schedule bounds.",
    };
  }

  const activity = classifyEventActivity(bounds, now);
  if (!activity.isActive) {
    return {
      ok: false,
      status: 409,
      code: "EVENT_INACTIVE",
      message: "Cannot publish or reinstate an event whose effective end has passed.",
    };
  }

  return { ok: true };
}

/**
 * Transactional in-memory/domain curator store implementing all R1-MUST curator invariants:
 * - Every mutation requires eligible UID + verified aal2 + active curator_access
 * - Optimistic concurrency via expectedVersion (409 VERSION_CONFLICT)
 * - State machine transitions (409 INVALID_TRANSITION)
 * - Unpublish to Draft hides listing and reserves source url_key
 * - Archive snapshots normalized url_keys into curator_audit.archivedUrlKeys and deletes source links
 */
export class CuratorDomainStore {
  private events = new Map<string, ManagedEventRecord>();
  private urlKeyToEventId = new Map<string, string>();
  private audits: CuratorAuditEntry[] = [];
  private idCounter = 1;

  constructor(initialEvents: ManagedEventRecord[] = []) {
    for (const ev of initialEvents) {
      this.events.set(ev.id, structuredClone(ev));
      if (ev.status !== "archived") {
        for (const s of ev.sources) {
          this.urlKeyToEventId.set(s.urlKey, ev.id);
        }
      }
    }
  }

  public getEvent(id: string): ManagedEventRecord | undefined {
    const ev = this.events.get(id);
    return ev ? structuredClone(ev) : undefined;
  }

  public listAllEvents(
    ctx: CuratorIdentityContext
  ): CuratorOperationResult<ManagedEventRecord[]> {
    const auth = verifyCuratorAuthority(ctx);
    if (!auth.ok) return auth;
    return {
      ok: true,
      status: 200,
      data: Array.from(this.events.values()).map((e) => structuredClone(e)),
    };
  }

  public getAuditEntriesForTarget(targetId: string): CuratorAuditEntry[] {
    return this.audits
      .filter((a) => a.targetId === targetId)
      .map((a) => structuredClone(a));
  }

  public createDraft(
    ctx: CuratorIdentityContext,
    input: {
      id?: string;
      title: string;
      organizer: string;
      summary?: string | null;
      eventType?: EventType;
      mode?: EventMode;
      priceStatus?: PriceStatus;
      citySlug?: string | null;
      venue?: string | null;
      onlineIndiaAccessConfirmed?: boolean;
      eventTimezone?: string;
      isAllDay?: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      startOn?: string | null;
      endOn?: string | null;
      registrationDeadlineAt?: string | null;
      registrationDeadlineOn?: string | null;
    },
    now: Date = new Date()
  ): CuratorOperationResult<ManagedEventRecord> {
    const auth = verifyCuratorAuthority(ctx);
    if (!auth.ok) return auth;

    const id =
      input.id ??
      `77777777-7777-4777-8777-${(this.idCounter++).toString(16).padStart(12, "0")}`;

    const record: ManagedEventRecord = {
      id,
      status: "draft",
      version: 1,
      title: input.title,
      organizer: input.organizer,
      summary: input.summary ?? null,
      eventType: input.eventType ?? "other",
      mode: input.mode ?? "online",
      priceStatus: input.priceStatus ?? "unknown",
      citySlug: input.citySlug ?? null,
      venue: input.venue ?? null,
      onlineIndiaAccessConfirmed: input.onlineIndiaAccessConfirmed ?? false,
      eventTimezone: input.eventTimezone ?? "Asia/Kolkata",
      isAllDay: input.isAllDay ?? false,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      startOn: input.startOn ?? null,
      endOn: input.endOn ?? null,
      registrationDeadlineAt: input.registrationDeadlineAt ?? null,
      registrationDeadlineOn: input.registrationDeadlineOn ?? null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [],
      updatedAt: now.toISOString(),
    };

    this.events.set(id, record);
    this.audits.push({
      id: `audit-${this.audits.length + 1}`,
      actorId: auth.actorId,
      targetId: id,
      action: "create",
      priorVersion: null,
      newVersion: 1,
      recordedAt: now.toISOString(),
      reasonCode: "draft_created",
      archivedUrlKeys: [],
    });

    return { ok: true, status: 201, data: structuredClone(record) };
  }

  public editMetadata(
    ctx: CuratorIdentityContext,
    eventId: string,
    expectedVersion: number,
    updates: Partial<
      Pick<
        ManagedEventRecord,
        | "title"
        | "organizer"
        | "summary"
        | "eventType"
        | "mode"
        | "priceStatus"
        | "citySlug"
        | "venue"
        | "onlineIndiaAccessConfirmed"
        | "eventTimezone"
        | "isAllDay"
        | "startsAt"
        | "endsAt"
        | "startOn"
        | "endOn"
        | "registrationDeadlineAt"
        | "registrationDeadlineOn"
        | "registrationClosed"
      >
    >,
    now: Date = new Date()
  ): CuratorOperationResult<ManagedEventRecord> {
    const auth = verifyCuratorAuthority(ctx);
    if (!auth.ok) return auth;

    const existing = this.events.get(eventId);
    if (!existing) {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Event not found.",
      };
    }
    if (existing.status === "archived") {
      return {
        ok: false,
        status: 409,
        code: "INVALID_TRANSITION",
        message: "Archived events cannot be edited.",
      };
    }
    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        status: 409,
        code: "VERSION_CONFLICT",
        message: `Expected version ${expectedVersion}, but current version is ${existing.version}.`,
      };
    }

    const updated: ManagedEventRecord = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: now.toISOString(),
    };

    if (updated.status === "published") {
      const check = validatePublicationInvariants(updated, now);
      if (!check.ok) return check;
    }

    this.events.set(eventId, updated);
    this.audits.push({
      id: `audit-${this.audits.length + 1}`,
      actorId: auth.actorId,
      targetId: eventId,
      action: "edit",
      priorVersion: existing.version,
      newVersion: updated.version,
      recordedAt: now.toISOString(),
      reasonCode: "metadata_edited",
      archivedUrlKeys: [],
    });

    return { ok: true, status: 200, data: structuredClone(updated) };
  }

  public setSourceLink(
    ctx: CuratorIdentityContext,
    eventId: string,
    expectedVersion: number,
    sourceInput: {
      sourceSlug: string;
      rawUrl: string;
      isPrimary: boolean;
    },
    now: Date = new Date()
  ): CuratorOperationResult<ManagedEventRecord> {
    const auth = verifyCuratorAuthority(ctx);
    if (!auth.ok) return auth;

    const existing = this.events.get(eventId);
    if (!existing) {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Event not found.",
      };
    }
    if (existing.status === "archived") {
      return {
        ok: false,
        status: 409,
        code: "INVALID_TRANSITION",
        message: "Cannot modify source links on an archived event.",
      };
    }
    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        status: 409,
        code: "VERSION_CONFLICT",
        message: `Expected version ${expectedVersion}, but current version is ${existing.version}.`,
      };
    }

    const normalized = normalizeSourceUrl(sourceInput.rawUrl);
    if (!normalized.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REQUEST",
        message: normalized.message,
      };
    }

    const ownerEventId = this.urlKeyToEventId.get(normalized.urlKey);
    if (ownerEventId && ownerEventId !== eventId) {
      return {
        ok: false,
        status: 409,
        code: "SOURCE_URL_CONFLICT",
        message: `Source URL is already claimed by event ${ownerEventId}.`,
        conflictingEventId: ownerEventId,
      };
    }

    const nextSources = existing.sources.map((s) =>
      sourceInput.isPrimary && s.urlKey !== normalized.urlKey
        ? { ...s, isPrimary: false }
        : { ...s }
    );

    const sameKeyIdx = nextSources.findIndex(
      (s) => s.urlKey === normalized.urlKey
    );
    if (sameKeyIdx >= 0) {
      nextSources[sameKeyIdx] = {
        ...nextSources[sameKeyIdx]!,
        sourceSlug: sourceInput.sourceSlug,
        publicUrl: normalized.publicUrl,
        urlKey: normalized.urlKey,
        isPrimary: sourceInput.isPrimary,
      };
    } else {
      nextSources.push({
        id: `src-${this.idCounter++}`,
        sourceSlug: sourceInput.sourceSlug,
        publicUrl: normalized.publicUrl,
        urlKey: normalized.urlKey,
        isPrimary: sourceInput.isPrimary,
      });
    }

    this.urlKeyToEventId.set(normalized.urlKey, eventId);

    const updated: ManagedEventRecord = {
      ...existing,
      version: existing.version + 1,
      sources: nextSources,
      updatedAt: now.toISOString(),
    };

    this.events.set(eventId, updated);
    this.audits.push({
      id: `audit-${this.audits.length + 1}`,
      actorId: auth.actorId,
      targetId: eventId,
      action: "source",
      priorVersion: existing.version,
      newVersion: updated.version,
      recordedAt: now.toISOString(),
      reasonCode: "source_updated",
      archivedUrlKeys: [],
    });

    return { ok: true, status: 200, data: structuredClone(updated) };
  }

  public transitionStatus(
    ctx: CuratorIdentityContext,
    eventId: string,
    expectedVersion: number,
    action: "publish" | "unpublish" | "cancel" | "reinstate" | "archive",
    options?: {
      cancellationReason?: CancellationReason | null;
      reasonCode?: string;
    },
    now: Date = new Date()
  ): CuratorOperationResult<ManagedEventRecord> {
    const auth = verifyCuratorAuthority(ctx);
    if (!auth.ok) return auth;

    const existing = this.events.get(eventId);
    if (!existing) {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Event not found.",
      };
    }

    if (existing.version !== expectedVersion) {
      return {
        ok: false,
        status: 409,
        code: "VERSION_CONFLICT",
        message: `Expected version ${expectedVersion}, but current version is ${existing.version}.`,
      };
    }

    let nextStatus: EventStatus;
    if (action === "publish") {
      if (existing.status !== "draft") {
        return {
          ok: false,
          status: 409,
          code: "INVALID_TRANSITION",
          message: "Only draft events can be published.",
        };
      }
      nextStatus = "published";
    } else if (action === "unpublish") {
      if (existing.status !== "published") {
        return {
          ok: false,
          status: 409,
          code: "INVALID_TRANSITION",
          message: "Only published events can be unpublished to draft.",
        };
      }
      nextStatus = "draft";
    } else if (action === "cancel") {
      if (existing.status !== "published") {
        return {
          ok: false,
          status: 409,
          code: "INVALID_TRANSITION",
          message: "Only published events can be canceled.",
        };
      }
      if (!options?.cancellationReason) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_REQUEST",
          message: "Canceled listings require a cancellation_reason value.",
        };
      }
      nextStatus = "canceled";
    } else if (action === "reinstate") {
      if (existing.status !== "canceled") {
        return {
          ok: false,
          status: 409,
          code: "INVALID_TRANSITION",
          message: "Only canceled events can be reinstated.",
        };
      }
      nextStatus = "published";
    } else if (action === "archive") {
      if (existing.status === "archived") {
        return {
          ok: false,
          status: 409,
          code: "INVALID_TRANSITION",
          message: "Archived is terminal.",
        };
      }
      nextStatus = "archived";
    } else {
      return {
        ok: false,
        status: 409,
        code: "INVALID_TRANSITION",
        message: "Unsupported state transition.",
      };
    }

    if (nextStatus === "published") {
      const check = validatePublicationInvariants(existing, now);
      if (!check.ok) return check;
    }

    let archivedUrlKeys: string[] = [];
    let nextSources = existing.sources.map((s) => ({ ...s }));

    if (nextStatus === "archived") {
      archivedUrlKeys = existing.sources
        .map((s) => s.urlKey)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const s of existing.sources) {
        if (this.urlKeyToEventId.get(s.urlKey) === eventId) {
          this.urlKeyToEventId.delete(s.urlKey);
        }
      }
      nextSources = [];
    }

    const updated: ManagedEventRecord = {
      ...existing,
      status: nextStatus,
      version: existing.version + 1,
      canceledAt: nextStatus === "canceled" ? now.toISOString() : null,
      cancellationReason:
        nextStatus === "canceled"
          ? options?.cancellationReason ?? null
          : null,
      sources: nextSources,
      updatedAt: now.toISOString(),
    };

    this.events.set(eventId, updated);
    this.audits.push({
      id: `audit-${this.audits.length + 1}`,
      actorId: auth.actorId,
      targetId: eventId,
      action,
      priorVersion: existing.version,
      newVersion: updated.version,
      recordedAt: now.toISOString(),
      reasonCode: options?.reasonCode ?? action,
      archivedUrlKeys,
    });

    return { ok: true, status: 200, data: structuredClone(updated) };
  }
}

export const adminCreateEventInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  organizer: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(4000).nullable().optional(),
  eventType: z
    .enum([
      "hackathon",
      "workshop",
      "seminar",
      "meetup",
      "conference",
      "other",
    ])
    .default("other"),
  mode: z.enum(["online", "in_person", "hybrid"]).default("online"),
  priceStatus: z.enum(["free", "paid", "unknown"]).default("unknown"),
  citySlug: z.string().trim().nullable().optional(),
  venue: z.string().trim().max(300).nullable().optional(),
  onlineIndiaAccessConfirmed: z.boolean().default(false),
  eventTimezone: z.string().trim().default("Asia/Kolkata"),
  isAllDay: z.boolean().default(false),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  startOn: z.string().nullable().optional(),
  endOn: z.string().nullable().optional(),
  registrationDeadlineAt: z.string().nullable().optional(),
  registrationDeadlineOn: z.string().nullable().optional(),
  primarySourceSlug: z.string().trim().optional(),
  primarySourceUrl: z.string().trim().optional(),
});

export const adminPatchEventInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  transition: z
    .enum(["publish", "unpublish", "cancel", "reinstate", "archive"])
    .optional(),
  cancellationReason: z
    .enum(["organizer_canceled", "venue_unavailable", "other_confirmed"])
    .nullable()
    .optional(),
  reasonCode: z.string().trim().max(120).optional(),
  source: z
    .object({
      sourceSlug: z.string().trim().min(1),
      url: z.string().trim().min(1),
      isPrimary: z.boolean().default(true),
    })
    .optional(),
  metadata: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      organizer: z.string().trim().min(1).max(200).optional(),
      summary: z.string().trim().max(4000).nullable().optional(),
      eventType: z
        .enum([
          "hackathon",
          "workshop",
          "seminar",
          "meetup",
          "conference",
          "other",
        ])
        .optional(),
      mode: z.enum(["online", "in_person", "hybrid"]).optional(),
      priceStatus: z.enum(["free", "paid", "unknown"]).optional(),
      citySlug: z.string().trim().nullable().optional(),
      venue: z.string().trim().max(300).nullable().optional(),
      onlineIndiaAccessConfirmed: z.boolean().optional(),
      eventTimezone: z.string().trim().optional(),
      isAllDay: z.boolean().optional(),
      startsAt: z.string().nullable().optional(),
      endsAt: z.string().nullable().optional(),
      startOn: z.string().nullable().optional(),
      endOn: z.string().nullable().optional(),
      registrationDeadlineAt: z.string().nullable().optional(),
      registrationDeadlineOn: z.string().nullable().optional(),
      registrationClosed: z.boolean().optional(),
    })
    .optional(),
});
