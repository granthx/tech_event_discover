import { z } from "zod";
import {
  evaluateTrackingTransition,
  type TrackingMutationRequestState,
} from "@/features/account/state";
import {
  classifyEventActivity,
  resolveEffectiveScheduleBounds,
} from "@/features/catalog/time";
import type { ManagedEventRecord } from "@/features/curation/lifecycle";
import type {
  CancellationReason,
  EventMode,
  EventType,
  PriceStatus,
  TrackingState,
} from "@/lib/database.types";

export interface AccountControlRecord {
  userId: string;
  adultConfirmedAt: string | null;
  deletionRequestedAt: string | null;
}

export interface DeletedAccountTombstone {
  userId: string;
  requestedAt: string;
}

export interface UserEventTrackingRecord {
  userId: string;
  eventId: string;
  state: TrackingState;
  createdAt: string;
  updatedAt: string;
}

export interface MyEventItemView {
  eventId: string;
  trackingState: TrackingState;
  trackedUpdatedAt: string;
  availability: "active" | "ongoing" | "ended" | "canceled" | "unavailable";
  // Present only when the linked event is visible (published or canceled);
  // null when unpublished (draft) or archived -> UI renders "Event unavailable" with Remove.
  event: {
    title: string;
    organizer: string;
    eventType: EventType;
    mode: EventMode;
    priceStatus: PriceStatus;
    citySlug: string | null;
    venue: string | null;
    eventTimezone: string;
    isAllDay: boolean;
    startsAt: string | null;
    endsAt: string | null;
    startOn: string | null;
    endOn: string | null;
    canceledAt: string | null;
    cancellationReason: CancellationReason | null;
  } | null;
}

/**
 * Domain store for R1 Account Admission, Consent, Tracking, and Deletion Tombstones:
 * - Invite acceptance buffers session cookies until adult_confirmed_at is persisted
 * - Interrupted invite can recover via fresh OTP verification with explicit adult checkbox
 * - Repeat verification keeps immutable first adult_confirmed_at timestamp
 * - Unattested UID or deletion-pending UID is denied member reads and writes
 * - Deletion writes 35-day tombstone outside Auth cascade and supports partial deletion retry
 */
export class AccountDomainStore {
  private authUsers = new Map<
    string,
    { id: string; email: string; inviteConsumed: boolean }
  >();
  private inviteTokens = new Map<string, string>(); // tokenHash -> userId
  private otpCodes = new Map<string, { userId: string; code: string }>(); // email -> { userId, code }
  private controls = new Map<string, AccountControlRecord>();
  private tombstones = new Map<string, DeletedAccountTombstone>();
  private tracking = new Map<string, UserEventTrackingRecord>(); // `${userId}:${eventId}`

  public seedInvitedUser(input: {
    userId: string;
    email: string;
    inviteTokenHash: string;
    otpCode?: string;
  }) {
    const emailLower = input.email.toLowerCase();
    this.authUsers.set(input.userId, {
      id: input.userId,
      email: emailLower,
      inviteConsumed: false,
    });
    this.inviteTokens.set(input.inviteTokenHash, input.userId);
    if (input.otpCode) {
      this.otpCodes.set(emailLower, {
        userId: input.userId,
        code: input.otpCode,
      });
    }
  }

  public issueOtpForExistingUser(email: string, code: string): boolean {
    const emailLower = email.toLowerCase();
    for (const user of this.authUsers.values()) {
      if (user.email === emailLower) {
        this.otpCodes.set(emailLower, { userId: user.id, code });
        return true;
      }
    }
    return false;
  }

  public isUserEligible(userId: string | null): boolean {
    if (!userId) return false;
    if (!this.authUsers.has(userId)) return false;
    const ctrl = this.controls.get(userId);
    return Boolean(
      ctrl && ctrl.adultConfirmedAt !== null && ctrl.deletionRequestedAt === null
    );
  }

  public getAccountControls(userId: string): AccountControlRecord | undefined {
    const c = this.controls.get(userId);
    return c ? { ...c } : undefined;
  }

  public getDeletionTombstone(
    userId: string
  ): DeletedAccountTombstone | undefined {
    const t = this.tombstones.get(userId);
    return t ? { ...t } : undefined;
  }

  /**
   * Invite acceptance flow (ARCHITECTURE.md):
   * Verifies invite server-side, buffers session cookies, records adult_confirmed_at
   * for the verified UID, and only then releases cookies.
   * No acknowledgement or failed write yields no usable app session (sessionCookiesReleased: false).
   */
  public acceptInvite(
    input: {
      tokenHash: string;
      adultConfirmed: boolean;
      simulateAttestationWriteFailure?: boolean;
    },
    now: Date = new Date()
  ):
    | {
        ok: true;
        userId: string;
        adultConfirmedAt: string;
        sessionCookiesReleased: true;
      }
    | {
        ok: false;
        status: 400 | 401 | 500;
        code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        sessionCookiesReleased: false;
        message: string;
      } {
    if (!input.adultConfirmed) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REQUEST",
        sessionCookiesReleased: false,
        message: "Adult self-attestation is required before accepting an invitation.",
      };
    }

    const userId = this.inviteTokens.get(input.tokenHash);
    if (!userId || !this.authUsers.has(userId)) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHENTICATED",
        sessionCookiesReleased: false,
        message: "Invite token is invalid or has already been consumed.",
      };
    }

    // Consume the one-time invite token at Auth verification step
    this.inviteTokens.delete(input.tokenHash);
    const user = this.authUsers.get(userId)!;
    user.inviteConsumed = true;

    // Buffer session cookies until attestation DB write succeeds
    if (input.simulateAttestationWriteFailure) {
      return {
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        sessionCookiesReleased: false,
        message: "Failed to persist adult attestation; session cookies withheld.",
      };
    }

    const existing = this.controls.get(userId);
    const confirmedAt = existing?.adultConfirmedAt ?? now.toISOString();
    this.controls.set(userId, {
      userId,
      adultConfirmedAt: confirmedAt,
      deletionRequestedAt: existing?.deletionRequestedAt ?? null,
    });

    return {
      ok: true,
      userId,
      adultConfirmedAt: confirmedAt,
      sessionCookiesReleased: true,
    };
  }

  /**
   * Returning OTP verification or interrupted invite recovery:
   * - If adult_confirmed_at is not yet recorded, requires explicit adultConfirmed: true
   * - Once recorded, adult_confirmed_at is immutable on repeat verifications
   */
  public verifyOtpCode(
    input: {
      email: string;
      code: string;
      adultConfirmed?: boolean;
    },
    now: Date = new Date()
  ):
    | {
        ok: true;
        userId: string;
        adultConfirmedAt: string;
        sessionCookiesReleased: true;
      }
    | {
        ok: false;
        status: 400 | 401 | 403;
        code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "FORBIDDEN";
        sessionCookiesReleased: false;
        message: string;
      } {
    const emailLower = input.email.toLowerCase();
    const record = this.otpCodes.get(emailLower);
    if (!record || record.code !== input.code) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHENTICATED",
        sessionCookiesReleased: false,
        message: "Invalid or expired one-time verification code.",
      };
    }

    const userId = record.userId;
    const existing = this.controls.get(userId);
    if (existing?.deletionRequestedAt) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        sessionCookiesReleased: false,
        message: "Account deletion is pending.",
      };
    }

    if (!existing?.adultConfirmedAt && input.adultConfirmed !== true) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REQUEST",
        sessionCookiesReleased: false,
        message:
          "Explicit 18+ age confirmation is required to complete initial account admission.",
      };
    }

    this.otpCodes.delete(emailLower);

    // Immutable first confirmed timestamp
    const confirmedAt = existing?.adultConfirmedAt ?? now.toISOString();
    this.controls.set(userId, {
      userId,
      adultConfirmedAt: confirmedAt,
      deletionRequestedAt: null,
    });

    return {
      ok: true,
      userId,
      adultConfirmedAt: confirmedAt,
      sessionCookiesReleased: true,
    };
  }

  /**
   * Mutates tracking row for a caller and event, strictly enforcing:
   * - Owner & eligibility check (null adultConfirmedAt or pending deletion -> 403 FORBIDDEN)
   * - Ordered tracking state table (none -> 200; exact repeat -> 200 without update;
   *   published active -> 200 upsert; ended/canceled -> 409 EVENT_INACTIVE; draft/archived/unknown -> 404)
   */
  public mutateTracking(
    userId: string | null,
    eventId: string,
    requestedState: TrackingMutationRequestState,
    eventLookup: (id: string) => ManagedEventRecord | undefined,
    now: Date = new Date()
  ):
    | {
        ok: true;
        status: 200;
        newState: TrackingState | null;
        wasUpdated: boolean;
        updatedAt: string | null;
      }
    | {
        ok: false;
        status: 401 | 403 | 404 | 409;
        code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "EVENT_INACTIVE";
        message: string;
      } {
    if (!userId) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      };
    }
    if (!this.isUserEligible(userId)) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "Account is not eligible for member mutations.",
      };
    }

    const key = `${userId}:${eventId}`;
    const existingRow = this.tracking.get(key) ?? null;
    const event = eventLookup(eventId);

    let isEventActive = false;
    if (event && event.status === "published") {
      try {
        const bounds = resolveEffectiveScheduleBounds({
          isAllDay: event.isAllDay,
          eventTimezone: event.eventTimezone,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          startOn: event.startOn,
          endOn: event.endOn,
        });
        isEventActive = classifyEventActivity(bounds, now).isActive;
      } catch {
        isEventActive = false;
      }
    }

    const decision = evaluateTrackingTransition({
      requestedState,
      existingState: existingRow?.state ?? null,
      eventStatus: event?.status ?? "unknown",
      isEventActive,
    });

    if (decision.status === 409) {
      return {
        ok: false,
        status: 409,
        code: "EVENT_INACTIVE",
        message: decision.message,
      };
    }
    if (decision.status === 404) {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: decision.message,
      };
    }

    if (decision.action === "delete") {
      this.tracking.delete(key);
      return {
        ok: true,
        status: 200,
        newState: null,
        wasUpdated: true,
        updatedAt: null,
      };
    }

    if (decision.action === "noop") {
      return {
        ok: true,
        status: 200,
        newState: existingRow?.state ?? null,
        wasUpdated: false,
        updatedAt: existingRow?.updatedAt ?? null,
      };
    }

    const ts = now.toISOString();
    const nextRow: UserEventTrackingRecord = {
      userId,
      eventId,
      state: decision.newState!,
      createdAt: existingRow?.createdAt ?? ts,
      updatedAt: ts,
    };
    this.tracking.set(key, nextRow);

    return {
      ok: true,
      status: 200,
      newState: nextRow.state,
      wasUpdated: true,
      updatedAt: nextRow.updatedAt,
    };
  }

  /**
   * Lists My Events for the eligible owner only, left-joining visible catalog rows (published/canceled).
   * Hidden (draft/archived) listings return event: null and availability: "unavailable".
   */
  public getMyEvents(
    userId: string | null,
    eventLookup: (id: string) => ManagedEventRecord | undefined,
    now: Date = new Date()
  ): MyEventItemView[] {
    if (!this.isUserEligible(userId)) {
      return [];
    }

    const items: MyEventItemView[] = [];
    for (const row of this.tracking.values()) {
      if (row.userId !== userId) continue;

      const ev = eventLookup(row.eventId);
      if (!ev || ev.status === "draft" || ev.status === "archived") {
        items.push({
          eventId: row.eventId,
          trackingState: row.state,
          trackedUpdatedAt: row.updatedAt,
          availability: "unavailable",
          event: null,
        });
        continue;
      }

      const bounds = resolveEffectiveScheduleBounds({
        isAllDay: ev.isAllDay,
        eventTimezone: ev.eventTimezone,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        startOn: ev.startOn,
        endOn: ev.endOn,
      });
      const activity = classifyEventActivity(bounds, now);

      const availability: MyEventItemView["availability"] =
        ev.status === "canceled"
          ? "canceled"
          : activity.isEnded
          ? "ended"
          : activity.isOngoing
          ? "ongoing"
          : "active";

      items.push({
        eventId: row.eventId,
        trackingState: row.state,
        trackedUpdatedAt: row.updatedAt,
        availability,
        event: {
          title: ev.title,
          organizer: ev.organizer,
          eventType: ev.eventType,
          mode: ev.mode,
          priceStatus: ev.priceStatus,
          citySlug: ev.citySlug,
          venue: ev.venue,
          eventTimezone: ev.eventTimezone,
          isAllDay: ev.isAllDay,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          startOn: ev.startOn,
          endOn: ev.endOn,
          canceledAt: ev.canceledAt,
          cancellationReason: ev.cancellationReason,
        },
      });
    }

    return items;
  }

  /**
   * Account deletion with fresh OTP, atomic pending flag + 35-day tombstone,
   * Auth deletion cascade, and retryable partial deletion support.
   */
  public confirmAccountDeletion(
    input: {
      userId: string;
      otpCode?: string;
      isOperatorRetry?: boolean;
      simulateAuthDeleteFailure?: boolean;
    },
    now: Date = new Date()
  ):
    | { ok: true; status: 204; tombstone: DeletedAccountTombstone }
    | {
        ok: false;
        status: 401 | 500;
        code: "UNAUTHENTICATED" | "INTERNAL_ERROR";
        tombstoneRecorded: boolean;
        message: string;
      } {
    const user = this.authUsers.get(input.userId);
    const existingTombstone = this.tombstones.get(input.userId);

    if (!input.isOperatorRetry) {
      if (!user) {
        return {
          ok: false,
          status: 401,
          code: "UNAUTHENTICATED",
          tombstoneRecorded: Boolean(existingTombstone),
          message: "Authenticated identity not found.",
        };
      }
      const otpEntry = this.otpCodes.get(user.email);
      if (!input.otpCode || !otpEntry || otpEntry.code !== input.otpCode) {
        return {
          ok: false,
          status: 401,
          code: "UNAUTHENTICATED",
          tombstoneRecorded: Boolean(existingTombstone),
          message: "A fresh valid OTP is required to confirm account deletion.",
        };
      }
      this.otpCodes.delete(user.email);
    }

    // Step 1: In one DB transaction set deletion_requested_at and insert tombstone idempotently
    const requestedAt = existingTombstone?.requestedAt ?? now.toISOString();
    const tombstone: DeletedAccountTombstone = {
      userId: input.userId,
      requestedAt,
    };
    this.tombstones.set(input.userId, tombstone);

    const ctrl = this.controls.get(input.userId);
    this.controls.set(input.userId, {
      userId: input.userId,
      adultConfirmedAt: ctrl?.adultConfirmedAt ?? null,
      deletionRequestedAt: requestedAt,
    });

    // If Auth user deletion fails mid-flight, deletion stays pending, blocks ordinary writes, and is retryable
    if (input.simulateAuthDeleteFailure) {
      return {
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        tombstoneRecorded: true,
        message:
          "Deletion marked pending and tombstoned; Auth deletion step can be retried.",
      };
    }

    // Step 2: Delete Auth user and cascade user-linked rows (user_events, account_controls), keeping tombstone!
    this.authUsers.delete(input.userId);
    this.controls.delete(input.userId);
    for (const [k, row] of this.tracking.entries()) {
      if (row.userId === input.userId) {
        this.tracking.delete(k);
      }
    }

    return {
      ok: true,
      status: 204,
      tombstone,
    };
  }
}

export const accountDeleteInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"),
  }),
  z.object({
    action: z.literal("confirm"),
    code: z
      .string()
      .trim()
      .regex(/^\d{6,8}$/, "A 6 to 8 digit OTP code is required."),
  }),
]);
