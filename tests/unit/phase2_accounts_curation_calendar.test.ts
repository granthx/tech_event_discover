import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { AccountDomainStore } from "@/features/account/lifecycle";
import { generateEventCalendarIcs } from "@/features/catalog/calendar";
import {
  CuratorDomainStore,
  findNearDuplicateEvents,
  type CuratorIdentityContext,
} from "@/features/curation/lifecycle";

describe("Phase 2 · Accounts, Curation, State Machines, Tombstones & Calendar (.ics) Export", () => {
  const baseNow = new Date("2026-12-01T10:00:00.000Z");

  const activeAal2Curator: CuratorIdentityContext = {
    userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
    isEligible: true,
    aal: "aal2",
    hasActiveCuratorAccess: true,
  };

  const aal1Curator: CuratorIdentityContext = {
    ...activeAal2Curator,
    aal: "aal1",
  };

  const revokedAal2Curator: CuratorIdentityContext = {
    ...activeAal2Curator,
    hasActiveCuratorAccess: false,
  };

  it("curator_every_mutation_requires_aal2 & curator_revocation_denies_next_request: covers create, edit, source, publish, unpublish, cancel, reinstate, archive", () => {
    const store = new CuratorDomainStore();

    // 1. Create denied at aal1, succeeds at aal2
    const createAal1 = store.createDraft(
      aal1Curator,
      { title: "Test Event", organizer: "FOSS United" },
      baseNow
    );
    expect(createAal1.ok).toBe(false);
    if (!createAal1.ok) expect(createAal1.status).toBe(403);

    const created = store.createDraft(
      activeAal2Curator,
      {
        title: "Test Event",
        organizer: "FOSS United",
        mode: "online",
        onlineIndiaAccessConfirmed: true,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T10:00:00.000Z",
        endsAt: "2026-12-10T14:00:00.000Z",
      },
      baseNow
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const eventId = created.data.id;

    // 2. Edit denied at aal1, succeeds at aal2 (v1 -> v2)
    expect(
      store.editMetadata(aal1Curator, eventId, 1, { title: "Updated" }, baseNow)
        .ok
    ).toBe(false);

    const edited = store.editMetadata(
      activeAal2Curator,
      eventId,
      1,
      { title: "Updated Title" },
      baseNow
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.version).toBe(2);

    // 3. Source denied at aal1, succeeds at aal2 (v2 -> v3)
    expect(
      store.setSourceLink(
        aal1Curator,
        eventId,
        2,
        {
          sourceSlug: "foss-united",
          rawUrl: "https://fossunited.org/events/test-1",
          isPrimary: true,
        },
        baseNow
      ).ok
    ).toBe(false);

    const sourced = store.setSourceLink(
      activeAal2Curator,
      eventId,
      2,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/test-1",
        isPrimary: true,
      },
      baseNow
    );
    expect(sourced.ok).toBe(true);
    if (!sourced.ok) return;
    expect(sourced.data.version).toBe(3);

    // 4. Publish denied at aal1, succeeds at aal2 (v3 -> v4)
    expect(
      store.transitionStatus(aal1Curator, eventId, 3, "publish", undefined, baseNow)
        .ok
    ).toBe(false);

    const published = store.transitionStatus(
      activeAal2Curator,
      eventId,
      3,
      "publish",
      undefined,
      baseNow
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.data.status).toBe("published");
    expect(published.data.version).toBe(4);

    // 5. Unpublish denied at aal1, succeeds at aal2 (v4 -> v5)
    expect(
      store.transitionStatus(aal1Curator, eventId, 4, "unpublish", undefined, baseNow)
        .ok
    ).toBe(false);

    const unpublished = store.transitionStatus(
      activeAal2Curator,
      eventId,
      4,
      "unpublish",
      undefined,
      baseNow
    );
    expect(unpublished.ok).toBe(true);
    if (!unpublished.ok) return;
    expect(unpublished.data.status).toBe("draft");
    expect(unpublished.data.version).toBe(5);

    // Republish (v5 -> v6) to test cancel, reinstate, archive
    const republished = store.transitionStatus(
      activeAal2Curator,
      eventId,
      5,
      "publish",
      undefined,
      baseNow
    );
    expect(republished.ok).toBe(true);

    // 6. Cancel denied at aal1, succeeds at aal2 (v6 -> v7)
    expect(
      store.transitionStatus(
        aal1Curator,
        eventId,
        6,
        "cancel",
        { cancellationReason: "organizer_canceled" },
        baseNow
      ).ok
    ).toBe(false);

    const canceled = store.transitionStatus(
      activeAal2Curator,
      eventId,
      6,
      "cancel",
      { cancellationReason: "organizer_canceled" },
      baseNow
    );
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(canceled.data.status).toBe("canceled");
    expect(canceled.data.cancellationReason).toBe("organizer_canceled");
    expect(canceled.data.canceledAt).toBe(baseNow.toISOString());
    expect(canceled.data.version).toBe(7);

    // 7. Reinstate denied at aal1, succeeds at aal2 and clears cancellation fields (v7 -> v8)
    expect(
      store.transitionStatus(aal1Curator, eventId, 7, "reinstate", undefined, baseNow)
        .ok
    ).toBe(false);

    const reinstated = store.transitionStatus(
      activeAal2Curator,
      eventId,
      7,
      "reinstate",
      undefined,
      baseNow
    );
    expect(reinstated.ok).toBe(true);
    if (!reinstated.ok) return;
    expect(reinstated.data.status).toBe("published");
    expect(reinstated.data.canceledAt).toBeNull();
    expect(reinstated.data.cancellationReason).toBeNull();
    expect(reinstated.data.version).toBe(8);

    // 8. Archive denied at aal1, succeeds at aal2 (v8 -> v9)
    expect(
      store.transitionStatus(aal1Curator, eventId, 8, "archive", undefined, baseNow)
        .ok
    ).toBe(false);

    const archived = store.transitionStatus(
      activeAal2Curator,
      eventId,
      8,
      "archive",
      undefined,
      baseNow
    );
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.data.status).toBe("archived");
    expect(archived.data.version).toBe(9);

    // 9. curator_revocation_denies_next_request: revoking curator_access denies a previously valid aal2 session
    const afterRevocation = store.createDraft(
      revokedAal2Curator,
      { title: "Blocked After Revocation", organizer: "FOSS United" },
      baseNow
    );
    expect(afterRevocation.ok).toBe(false);
    if (!afterRevocation.ok) {
      expect(afterRevocation.status).toBe(403);
      expect(afterRevocation.code).toBe("FORBIDDEN");
    }
  });

  it("unpublish_hides_and_reserves_url & archive_releases_url_and_preserves_tracking (with archived_url_keys and one winner on concurrent reclaim)", () => {
    const curatorStore = new CuratorDomainStore();
    const accountStore = new AccountDomainStore();

    // Admit an eligible member
    accountStore.seedInvitedUser({
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      email: "member1@example.org",
      inviteTokenHash: "invite-hash-member-1",
    });
    accountStore.acceptInvite(
      { tokenHash: "invite-hash-member-1", adultConfirmed: true },
      baseNow
    );

    // Create & publish event A with URL https://fossunited.org/events/shared-link?utm_source=x
    const draftA = curatorStore.createDraft(
      activeAal2Curator,
      {
        title: "Event A",
        organizer: "FOSS United",
        mode: "online",
        onlineIndiaAccessConfirmed: true,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T10:00:00.000Z",
        endsAt: "2026-12-10T14:00:00.000Z",
      },
      baseNow
    );
    if (!draftA.ok) throw new Error("Failed draft A");

    curatorStore.setSourceLink(
      activeAal2Curator,
      draftA.data.id,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/shared-link?utm_source=x",
        isPrimary: true,
      },
      baseNow
    );
    curatorStore.transitionStatus(
      activeAal2Curator,
      draftA.data.id,
      2,
      "publish",
      undefined,
      baseNow
    );

    // Member saves Event A
    const trackRes = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      draftA.data.id,
      "saved",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(trackRes.ok).toBe(true);

    // Unpublish Event A to Draft (v3 -> v4): hides event from public My Events (shows "Event unavailable") AND reserves URL
    curatorStore.transitionStatus(
      activeAal2Curator,
      draftA.data.id,
      3,
      "unpublish",
      undefined,
      baseNow
    );

    const myEventsWhileUnpublished = accountStore.getMyEvents(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(myEventsWhileUnpublished).toHaveLength(1);
    expect(myEventsWhileUnpublished[0]?.availability).toBe("unavailable");
    expect(myEventsWhileUnpublished[0]?.event).toBeNull();

    // Create competing drafts B and C; B tries to claim Event A's URL while A is unpublished -> 409 SOURCE_URL_CONFLICT
    const draftB = curatorStore.createDraft(
      activeAal2Curator,
      { title: "Event B", organizer: "FOSS United" },
      baseNow
    );
    const draftC = curatorStore.createDraft(
      activeAal2Curator,
      { title: "Event C", organizer: "FOSS United" },
      baseNow
    );
    if (!draftB.ok || !draftC.ok) throw new Error("Failed drafts B/C");

    const conflictWhileDraft = curatorStore.setSourceLink(
      activeAal2Curator,
      draftB.data.id,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/shared-link",
        isPrimary: true,
      },
      baseNow
    );
    expect(conflictWhileDraft.ok).toBe(false);
    if (!conflictWhileDraft.ok) {
      expect(conflictWhileDraft.status).toBe(409);
      expect(conflictWhileDraft.code).toBe("SOURCE_URL_CONFLICT");
      expect(conflictWhileDraft.conflictingEventId).toBe(draftA.data.id);
    }

    // Now archive Event A (v4 -> v5): snapshots archived_url_keys in audit, deletes source links, preserves tracking row
    const archivedA = curatorStore.transitionStatus(
      activeAal2Curator,
      draftA.data.id,
      4,
      "archive",
      undefined,
      baseNow
    );
    expect(archivedA.ok).toBe(true);
    if (archivedA.ok) {
      expect(archivedA.data.sources).toHaveLength(0);
    }

    const auditsA = curatorStore.getAuditEntriesForTarget(draftA.data.id);
    const archiveAudit = auditsA.find((a) => a.action === "archive");
    expect(archiveAudit?.archivedUrlKeys).toEqual([
      "https://fossunited.org/events/shared-link",
    ]);

    // Competing drafts B and C both attempt to reclaim the released URL: exactly ONE winner succeeds, the other gets 409 SOURCE_URL_CONFLICT
    const reclaimB = curatorStore.setSourceLink(
      activeAal2Curator,
      draftB.data.id,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/shared-link",
        isPrimary: true,
      },
      baseNow
    );
    const reclaimC = curatorStore.setSourceLink(
      activeAal2Curator,
      draftC.data.id,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/shared-link",
        isPrimary: true,
      },
      baseNow
    );
    expect(reclaimB.ok).toBe(true);
    expect(reclaimC.ok).toBe(false);
    if (!reclaimC.ok) {
      expect(reclaimC.status).toBe(409);
      expect(reclaimC.code).toBe("SOURCE_URL_CONFLICT");
    }

    // Tracking row on archived Event A is still preserved and shows unavailable with Remove capability
    const myEventsAfterArchive = accountStore.getMyEvents(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(myEventsAfterArchive).toHaveLength(1);
    expect(myEventsAfterArchive[0]?.eventId).toBe(draftA.data.id);
    expect(myEventsAfterArchive[0]?.availability).toBe("unavailable");
  });

  it("canceled_repeat_returns_200_without_update, ended_repeat_returns_200_without_update & new_tracking_on_canceled_returns_409", () => {
    const curatorStore = new CuratorDomainStore();
    const accountStore = new AccountDomainStore();

    accountStore.seedInvitedUser({
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      email: "member1@example.org",
      inviteTokenHash: "hash-1",
    });
    accountStore.acceptInvite({ tokenHash: "hash-1", adultConfirmed: true }, baseNow);

    accountStore.seedInvitedUser({
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      email: "member2@example.org",
      inviteTokenHash: "hash-2",
    });
    accountStore.acceptInvite({ tokenHash: "hash-2", adultConfirmed: true }, baseNow);

    const draft = curatorStore.createDraft(
      activeAal2Curator,
      {
        title: "Lifecycle Tracking Event",
        organizer: "FOSS United",
        mode: "online",
        onlineIndiaAccessConfirmed: true,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-02T10:00:00.000Z",
        endsAt: "2026-12-02T12:00:00.000Z",
      },
      baseNow
    );
    if (!draft.ok) throw new Error("Failed draft");
    const eventId = draft.data.id;

    curatorStore.setSourceLink(
      activeAal2Curator,
      eventId,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/lifecycle-1",
        isPrimary: true,
      },
      baseNow
    );
    curatorStore.transitionStatus(
      activeAal2Curator,
      eventId,
      2,
      "publish",
      undefined,
      baseNow
    );

    // Member 1 saves while active
    const initialSave = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      eventId,
      "saved",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(initialSave.ok).toBe(true);
    if (!initialSave.ok) return;
    const originalUpdatedAt = initialSave.updatedAt;

    // 1. After event has ended (2026-12-03T00:00:00Z > endsAt), Member 1 repeats 'saved' -> 200 without update!
    const afterEndTime = new Date("2026-12-03T00:00:00.000Z");
    const endedRepeat = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      eventId,
      "saved",
      (id) => curatorStore.getEvent(id),
      afterEndTime
    );
    expect(endedRepeat.ok).toBe(true);
    if (endedRepeat.ok) {
      expect(endedRepeat.status).toBe(200);
      expect(endedRepeat.wasUpdated).toBe(false);
      expect(endedRepeat.updatedAt).toBe(originalUpdatedAt);
    }

    // 2. Curator cancels the event
    curatorStore.transitionStatus(
      activeAal2Curator,
      eventId,
      3,
      "cancel",
      { cancellationReason: "organizer_canceled" },
      baseNow
    );

    // Member 1 repeats 'saved' on canceled event -> 200 without update!
    const canceledRepeat = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      eventId,
      "saved",
      (id) => curatorStore.getEvent(id),
      new Date("2026-12-01T12:00:00.000Z")
    );
    expect(canceledRepeat.ok).toBe(true);
    if (canceledRepeat.ok) {
      expect(canceledRepeat.status).toBe(200);
      expect(canceledRepeat.wasUpdated).toBe(false);
      expect(canceledRepeat.updatedAt).toBe(originalUpdatedAt);
    }

    // 3. Member 1 tries to switch from 'saved' to 'registered' on canceled event -> 409 EVENT_INACTIVE
    const changeOnCanceled = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
      eventId,
      "registered",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(changeOnCanceled.ok).toBe(false);
    if (!changeOnCanceled.ok) {
      expect(changeOnCanceled.status).toBe(409);
      expect(changeOnCanceled.code).toBe("EVENT_INACTIVE");
    }

    // 4. Member 2 (not tracking yet) tries new tracking on canceled event -> 409 EVENT_INACTIVE
    const newOnCanceled = accountStore.mutateTracking(
      "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      eventId,
      "saved",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(newOnCanceled.ok).toBe(false);
    if (!newOnCanceled.ok) {
      expect(newOnCanceled.status).toBe(409);
      expect(newOnCanceled.code).toBe("EVENT_INACTIVE");
    }
  });

  it("verifies attestation before session cookies, OTP recovery after interrupted invite, repeat verification immutability, denied writes for unattested UID, and deletion_keeps_tombstone with partial deletion retry", () => {
    const accountStore = new AccountDomainStore();
    const curatorStore = new CuratorDomainStore();

    const draft = curatorStore.createDraft(
      activeAal2Curator,
      {
        title: "Admission Test Event",
        organizer: "FOSS United",
        mode: "online",
        onlineIndiaAccessConfirmed: true,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T10:00:00.000Z",
        endsAt: "2026-12-10T12:00:00.000Z",
      },
      baseNow
    );
    if (!draft.ok) throw new Error("Failed draft");
    curatorStore.setSourceLink(
      activeAal2Curator,
      draft.data.id,
      1,
      {
        sourceSlug: "foss-united",
        rawUrl: "https://fossunited.org/events/admission-1",
        isPrimary: true,
      },
      baseNow
    );
    curatorStore.transitionStatus(
      activeAal2Curator,
      draft.data.id,
      2,
      "publish",
      undefined,
      baseNow
    );

    const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddd99";
    accountStore.seedInvitedUser({
      userId,
      email: "invited@example.org",
      inviteTokenHash: "token-hash-99",
    });

    // 1. Invite without adultConfirmed -> rejected, sessionCookiesReleased: false
    const missingCheckbox = accountStore.acceptInvite(
      { tokenHash: "token-hash-99", adultConfirmed: false },
      baseNow
    );
    expect(missingCheckbox.ok).toBe(false);
    expect(missingCheckbox.sessionCookiesReleased).toBe(false);

    // 2. Interrupted invite: token consumed at Auth, but attestation write fails -> no session cookies released!
    const interrupted = accountStore.acceptInvite(
      {
        tokenHash: "token-hash-99",
        adultConfirmed: true,
        simulateAttestationWriteFailure: true,
      },
      baseNow
    );
    expect(interrupted.ok).toBe(false);
    expect(interrupted.sessionCookiesReleased).toBe(false);

    // 3. Direct Auth token for this unattested UID is denied writes (403 FORBIDDEN)
    const deniedWrite = accountStore.mutateTracking(
      userId,
      draft.data.id,
      "saved",
      (id) => curatorStore.getEvent(id),
      baseNow
    );
    expect(deniedWrite.ok).toBe(false);
    if (!deniedWrite.ok) {
      expect(deniedWrite.status).toBe(403);
      expect(deniedWrite.code).toBe("FORBIDDEN");
    }

    // 4. OTP recovery after interrupted invite: requires explicit adultConfirmed checkbox on first OTP verification
    accountStore.issueOtpForExistingUser("invited@example.org", "654321");
    const otpWithoutAdult = accountStore.verifyOtpCode(
      { email: "invited@example.org", code: "654321", adultConfirmed: false },
      baseNow
    );
    expect(otpWithoutAdult.ok).toBe(false);

    const firstConfirmTime = new Date("2026-12-01T10:15:00.000Z");
    const otpRecovered = accountStore.verifyOtpCode(
      { email: "invited@example.org", code: "654321", adultConfirmed: true },
      firstConfirmTime
    );
    expect(otpRecovered.ok).toBe(true);
    if (!otpRecovered.ok) return;
    expect(otpRecovered.sessionCookiesReleased).toBe(true);
    expect(otpRecovered.adultConfirmedAt).toBe(firstConfirmTime.toISOString());

    // 5. Repeat OTP verification preserves the original immutable adult_confirmed_at timestamp
    accountStore.issueOtpForExistingUser("invited@example.org", "112233");
    const laterTime = new Date("2026-12-02T10:00:00.000Z");
    const repeatVerify = accountStore.verifyOtpCode(
      { email: "invited@example.org", code: "112233" },
      laterTime
    );
    expect(repeatVerify.ok).toBe(true);
    if (repeatVerify.ok) {
      expect(repeatVerify.adultConfirmedAt).toBe(firstConfirmTime.toISOString());
    }

    // User saves an event now that they are eligible
    expect(
      accountStore.mutateTracking(
        userId,
        draft.data.id,
        "saved",
        (id) => curatorStore.getEvent(id),
        baseNow
      ).ok
    ).toBe(true);

    // 6. deletion_keeps_tombstone & partial deletion retry:
    accountStore.issueOtpForExistingUser("invited@example.org", "998877");
    const deleteTime = new Date("2026-12-03T08:00:00.000Z");

    // Simulate failure after marking pending and writing tombstone
    const partialDelete = accountStore.confirmAccountDeletion(
      {
        userId,
        otpCode: "998877",
        simulateAuthDeleteFailure: true,
      },
      deleteTime
    );
    expect(partialDelete.ok).toBe(false);
    if (!partialDelete.ok) {
      expect(partialDelete.tombstoneRecorded).toBe(true);
    }

    // While deletion is pending, ordinary member writes are blocked (403 FORBIDDEN)
    const blockedWhileDeleting = accountStore.mutateTracking(
      userId,
      draft.data.id,
      "registered",
      (id) => curatorStore.getEvent(id),
      deleteTime
    );
    expect(blockedWhileDeleting.ok).toBe(false);
    if (!blockedWhileDeleting.ok) {
      expect(blockedWhileDeleting.status).toBe(403);
    }

    // Retry completes Auth removal and cascades user_events/account_controls while keeping tombstone
    const completedDelete = accountStore.confirmAccountDeletion(
      {
        userId,
        isOperatorRetry: true,
      },
      new Date("2026-12-03T08:05:00.000Z")
    );
    expect(completedDelete.ok).toBe(true);
    expect(accountStore.getDeletionTombstone(userId)).toEqual({
      userId,
      requestedAt: deleteTime.toISOString(),
    });
    expect(accountStore.getAccountControls(userId)).toBeUndefined();
    expect(
      accountStore.getMyEvents(userId, (id) => curatorStore.getEvent(id), deleteTime)
    ).toHaveLength(0);
  });

  it("ongoing_unknown_end_exports_without_dtend & RFC-compliant calendar export for timed, all-day, and unknown-end fixtures", () => {
    // 1. Ongoing timed event with unknown end omits DTEND
    const unknownEndExport = generateEventCalendarIcs(
      {
        id: "22222222-2222-4222-8222-222222222206",
        status: "published",
        title: "Live Ongoing Compiler Office Hours",
        organizer: "Rust India Community",
        summary: "Interactive compiler internals Q&A.",
        mode: "online",
        cityName: null,
        cityState: null,
        venue: null,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-01T09:00:00.000Z",
        endsAt: null,
        startOn: null,
        endOn: null,
        primarySourceUrl: "https://rustindia.org/seminars/compiler-office-hours-2026",
        appOrigin: "https://techeventdiscover.example.org",
      },
      baseNow
    );

    expect(unknownEndExport.ok).toBe(true);
    if (unknownEndExport.ok) {
      const jcal = ICAL.parse(unknownEndExport.icsContent);
      const comp = new ICAL.Component(jcal);
      const vevent = comp.getFirstSubcomponent("vevent");
      expect(vevent).not.toBeNull();
      expect(vevent?.getFirstPropertyValue("uid")).toBe(
        "event-22222222-2222-4222-8222-222222222206@techeventdiscover.in"
      );
      expect(vevent?.hasProperty("dtstart")).toBe(true);
      expect(vevent?.hasProperty("dtend")).toBe(false);
      expect(String(vevent?.getFirstPropertyValue("description"))).toContain(
        "one-time static copy"
      );
    }

    // 2. All-day event exports VALUE=DATE with exclusive DTEND
    const allDayExport = generateEventCalendarIcs(
      {
        id: "22222222-2222-4222-8222-222222222299",
        status: "published",
        title: "All Day Open Source Summit",
        organizer: "FOSS United",
        summary: "Full day summit.",
        mode: "in_person",
        cityName: "Bengaluru",
        cityState: "Karnataka",
        venue: "Indiranagar Hall",
        eventTimezone: "Asia/Kolkata",
        isAllDay: true,
        startsAt: null,
        endsAt: null,
        startOn: "2026-12-05",
        endOn: "2026-12-07",
        primarySourceUrl: "https://fossunited.org/events/summit-2026",
        appOrigin: "https://techeventdiscover.example.org",
      },
      baseNow
    );

    expect(allDayExport.ok).toBe(true);
    if (allDayExport.ok) {
      expect(allDayExport.icsContent).toContain("DTSTART;VALUE=DATE:20261205");
      expect(allDayExport.icsContent).toContain("DTEND;VALUE=DATE:20261207");
    }

    // 3. Canceled event returns 409 EVENT_INACTIVE; draft returns 404 NOT_FOUND
    const canceledExport = generateEventCalendarIcs(
      {
        id: "22222222-2222-4222-8222-222222222207",
        status: "canceled",
        title: "Canceled Event",
        organizer: "FOSS United",
        summary: null,
        mode: "online",
        cityName: null,
        cityState: null,
        venue: null,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T10:00:00.000Z",
        endsAt: "2026-12-10T12:00:00.000Z",
        startOn: null,
        endOn: null,
        primarySourceUrl: null,
        appOrigin: "https://techeventdiscover.example.org",
      },
      baseNow
    );
    expect(canceledExport.ok).toBe(false);
    if (!canceledExport.ok) expect(canceledExport.status).toBe(409);

    const draftExport = generateEventCalendarIcs(
      {
        id: "22222222-2222-4222-8222-222222222208",
        status: "draft",
        title: "Draft Event",
        organizer: "FOSS United",
        summary: null,
        mode: "online",
        cityName: null,
        cityState: null,
        venue: null,
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T10:00:00.000Z",
        endsAt: "2026-12-10T12:00:00.000Z",
        startOn: null,
        endOn: null,
        primarySourceUrl: null,
        appOrigin: "https://techeventdiscover.example.org",
      },
      baseNow
    );
    expect(draftExport.ok).toBe(false);
    if (!draftExport.ok) expect(draftExport.status).toBe(404);
  });

  it("warns on near-duplicate events before publish (trigram similarity >= 0.65, starts within 24h, same city or both online)", () => {
    const store = new CuratorDomainStore();
    const existing = store.createDraft(
      activeAal2Curator,
      {
        title: "India Systems Hackathon 2026",
        organizer: "FOSS United",
        mode: "in_person",
        citySlug: "bengaluru",
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T09:00:00.000Z",
        endsAt: "2026-12-10T18:00:00.000Z",
      },
      baseNow
    );
    const candidate = store.createDraft(
      activeAal2Curator,
      {
        title: "India Systems Hackathon - 2026!",
        organizer: "FOSS United",
        mode: "in_person",
        citySlug: "bengaluru",
        eventTimezone: "Asia/Kolkata",
        isAllDay: false,
        startsAt: "2026-12-10T15:00:00.000Z",
        endsAt: "2026-12-10T20:00:00.000Z",
      },
      baseNow
    );

    if (!existing.ok || !candidate.ok) throw new Error("Failed setup");
    const warnings = findNearDuplicateEvents(candidate.data, [existing.data]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.eventId).toBe(existing.data.id);
    expect(warnings[0]?.similarityScore).toBeGreaterThanOrEqual(0.65);
  });
});
