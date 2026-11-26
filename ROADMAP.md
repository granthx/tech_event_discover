# Tech Event Discover · Roadmap

**[R1-MUST] Current gate:** Phase 0, Phase 1 and Phase 2 are approved by the owner. Phase 2B (R1 hosted beta gate) is in progress on staging (`https://tech-event-discover.vercel.app`, Supabase project `bnuzmwbsbmradxebynyc`, region `ap-southeast-1` / Vercel `sin1`). Staging deployment, two invited test accounts + 6-digit OTP sign-in (`hosted_invite_otp_turnstile`), cross-account tracking isolation (`hosted_cross_account_isolation`), curator TOTP (`aal2`) draft creation + audit, CDN `MISS`→`HIT`, security headers, and Vercel WAF rule (`600/60s`) are verified on 2026-11-22 / 2026-11-26. Remaining Phase 2B items: custom Turnstile production widget keys, curator lost-factor recovery drill, 12 real beta events + calendar client imports + 3 user walkthroughs, and production project promotion. Use sanitized records with environment, date, result and responsible reviewer.

## Scope by release

| Requirement | Tier | Decision and trade-off |
|---|---|---|
| Docs-first commit, Next.js/Supabase foundation, CI, fixtures | R1-MUST | KEEP. |
| Discover, search, filters, event details, source attribution, calendar download | R1-MUST | KEEP. Use PostgreSQL for search and distance. |
| Catalog cursor | R1-MUST | SIMPLIFY. Validate a plain keyset cursor. It controls position in public results, so signing adds key management without protecting private data. |
| Public read protection and caching | R1-MUST | SIMPLIFY. One edge rule and a 30-second public JSON cache replace database read counters and dynamic rendering of the Discover shell. |
| Hosted OTP, Turnstile, invited beta accounts, Saved, Registered, My Events | R1-MUST | KEEP. Use managed Auth and owner-provisioned invitations. |
| Curator forms, TOTP, event lifecycle, basic audit, URL deduplication | R1-MUST | SIMPLIFY. One curator authority in Postgres. Archiving deletes source-link rows instead of introducing an archive-aware URL index or a restore workflow. |
| Accessible UI, basic event metadata and canonicals | R1-MUST | KEEP. |
| Correction and takedown contact | R1-MUST | SIMPLIFY. Use a prefilled email link and the existing curator audit path. |
| Privacy notice, consent wording, in-app deletion, initial backup | R1-MUST | KEEP. In-app deletion reuses the managed OTP flow and adds a minimal deletion tombstone. |
| Live reminder delivery, separate sending capacity, consent and opt-out | R2-MUST | KEEP. Gate release on production inbox evidence and independent quotas. |
| Reminder ledger, leases, and provider idempotency | R2-MUST | SIMPLIFY. Keep the unique ledger key, a lease deadline, and attempt-number-checked finalization. Short-lived private JSON keeps retries identical. Remove custom payload encryption, delivery recipient HMACs, and separate lease tokens. |
| One-click unsubscribe | R2-MUST | SIMPLIFY. Store the token digest on the existing delivery row. |
| Permanent bounce and complaint protection | R2-MUST | SIMPLIFY. Use one suppression relation and monotonic expiry updates. Replays need no receipt table. |
| Authorized `.ics` feed and curator review | R2-MUST | KEEP. |
| Feed DNS pinning | R2-MUST | KEEP. Connect to a validated public address with the approved hostname for TLS. A preflight lookup alone leaves a DNS change between validation and connection. Limit this to one configured fetcher. |
| Scheduled job authentication | R2-MUST | SIMPLIFY. Use a random, single-run bearer that expires in 120 seconds. Remove persistent job signing keys and rotation overlap. A reusable bearer would be exposed in the `pg_net` queue. |
| Job alerting, daily backup, restore rehearsal | R2-MUST | KEEP. Use two external heartbeat checks and the existing job records. |
| Native share button, posters, richer event attributes, public typo correction | LATER-HARDENING | DEFER. A copyable canonical URL and the core card cover launch browsing. |
| Per-event reminder preferences, cancellation emails, registration verification, calendar sync, push, recommendations | LATER-HARDENING | DEFER. Each adds a preference, notification, or integration flow beyond launch. |
| Application-layer payload encryption or independent deletion journal | LATER-HARDENING | DEFER. R2 uses restricted, short-lived payload storage and blocks account restoration when deletion reconciliation is unavailable. |

## Phases and evidence

| Tier | Phase / status | Deliverable and acceptance evidence |
|---|---|---|
| R1-MUST | 0 · Documentation · approved | First commit contains only PROJECT_CONTEXT.md, ARCHITECTURE.md, AGENTS.md and ROADMAP.md. Check the commit tree, cross-document contracts, G-A1–G-A7 and outstanding owner decisions. Owner approval makes the root documents authoritative. |
| R1-MUST | 1 · Foundation and Discover · approved | Clean CI, Auth, schema/RLS, facets, client-rendered Discover, isolated public JSON, cache, search and keyset cursor. Run the Phase 1 tests below. Staging performance on 1,000 events: SQL p95 ≤150 ms over 50 representative calls, mobile LCP ≤2.5 s in four of five runs, 320 px reflow. |
| R1-MUST | 2 · Accounts and curation · approved | My Events, curator tools, calendar, privacy and deletion. Run the Phase 2 tests below. Check axe, manual keyboard/focus/labels and 320 px reflow against WCAG 2.2 AA. Import timed, all-day and unknown-end fixtures into Google Calendar web, Apple Calendar and Outlook web. Record dates, times, titles and links. |
| R1-MUST | 2B · Hosted curated beta · in progress | Pass all five numbered R1 checks. Public catalog and invited accounts only. Staging evidence recorded 2026-11-22 / 2026-11-26: deploy `77fb7ee`, two invited accounts verified via Gmail SMTP + 6-digit OTP (`eligibleUsersCount: 2`, `hosted_invite_otp_turnstile`), cross-account RLS isolation proven (`trackingCountsByDistinctUsers: [2, 2]`, `hosted_cross_account_isolation`), curator TOTP `aal2` draft + audit (`action: create`), CDN `MISS`→`HIT`, headers, and WAF `600/60s`. |
| R2-MUST | 3A · Reminders · pending after R1 | Worker, real SMTP/API isolation, consent, unsubscribe, webhooks, independent job monitoring and shared eligibility fixtures. Validate the retry and delivery cases below. |
| R2-MUST | 3B · Authorized import · pending after R1 | Fixture-tested importer, curator review and one real authorized publication. Extend the curator assurance test to review. |
| R2-MUST | 4 · Full public release · pending | Pass the five R2 checks. Open independent signup and live delivery at handoff. |

### Required regression evidence

| Tier | Phase | Evidence to collect |
|---|---|---|
| R1-MUST | 1 | pgTAP: `rls_public_details_visible_states`, `rls_sources_follow_parent_visibility`, `rls_search_published_only`, `rls_tracking_is_owner_only`. Exercise anon, two member UIDs and catalog_reader with city reads and public-only source labels. Test null adult timestamp and deletion-pending account via direct Auth session. |
| R1-MUST | 1 | `all_day_exclusive_end`, `unknown_end_is_active_for_two_hours`, `ongoing_publication_allowed`, `nearby_50km_boundary`, `deadline_sort_nulls_last`. Vitest/Playwright verify plural, prefix, quoted/negated search, malformed/mismatched/expired cursor and public/private response separation. |
| R1-MUST | 2 | `archive_releases_url_and_preserves_tracking` also checks archived_url_keys and one winner on concurrent reclaim. `unpublish_hides_and_reserves_url`, `canceled_repeat_returns_200_without_update`, `ended_repeat_returns_200_without_update`, `new_tracking_on_canceled_returns_409`, `ongoing_unknown_end_exports_without_dtend`, `deletion_keeps_tombstone`. Exercise partial deletion retry. |
| R1-MUST | 2 | `curator_every_mutation_requires_aal2` covers create/edit/source/publish/unpublish/cancel/reinstate/archive. `curator_revocation_denies_next_request` covers a previously valid session. Verify attestation before session cookies, OTP recovery after an interrupted invite, repeat verification and denied writes for an unattested UID. |
| R2-MUST | 3A | Run TS and pgTAP on the same ordered eligibility fixtures, including exact due/expiry, all-day midnight, unknown end, hold, consent, both tracking transitions and `ongoing_event_does_not_receive_attendance_reminder`. |
| R2-MUST | 3A | `expired_lease_cannot_finalize_new_attempt`, `timeout_retries_same_payload_and_key`, `changed_verified_email_blocks_retry`, `soft_bounce_does_not_suppress`, `old_unsubscribe_token_cannot_revoke_new_consent`. Test invalid signatures, suppression replay, unknown outcomes and smoke allowlist at all three checks. Prove own-preference RLS, private worker tables and the open-signup age gate. |
| R2-MUST | 3B | `etag_304_is_noop`, `older_sequence_is_ignored`, `cancellation_sets_hold`, `missing_item_does_not_cancel`, `private_dns_address_rejected`, `stream_limit_aborts`. Test stale versions, revocation and recomputing holds. |

## R1 hosted beta gate · Phase 2B

1. **[R1-MUST] Deploy staging and production.** Apply migrations, record deploy and migration IDs, configure stable HTTPS origins and OTP settings, and verify rollback to the previous app deployment. **Evidence:** passing CI, deployment record, and backup/rollback checklist.
2. **[R1-MUST] Verify SMTP, invitations, and Turnstile.** Invite two real test accounts on hosted staging. Accept each invitation, sign out, and sign in by an OTP delivered to a real inbox. Verify a missing or invalid Turnstile response fails and an uninvited address cannot self-register. Repeat one invitation and OTP smoke on production. **Evidence:** sanitized inbox receipt, `hosted_invite_otp_turnstile`, missing-attestation denial and Auth ceiling alert receipt with restored cap. Owner approval of notice and consent wording precedes invitations.
3. **[R1-MUST] Enroll the curator.** Bootstrap one `curator_access` row, enroll TOTP, and demonstrate that an `aal1` request fails, `aal2` succeeds, and revocation denies the next request. **Evidence:** `curator_every_mutation_requires_aal2`, hosted enrollment/revocation checklist and staged lost-factor recovery drill.
4. **[R1-MUST] Verify hosted isolation and edge behavior.** Use both hosted accounts to check that A cannot see or alter B’s tracking row, and test hidden details and published-only Discover. Verify cache `MISS`/`HIT`, no credential-specific response, live cancellation on detail, and the staging WAF test. **Evidence:** `hosted_cross_account_isolation`, cache header capture, and edge rule record.
5. **[R1-MUST] Release the curated beta.** Check approved privacy/contact/age copy, inventory, calendar-client results, accessibility, and basic create → publish → discover → save → calendar flow. Release to invited users with import and reminder jobs inactive. **Evidence:** signed-off R1 checklist, inventory count, three walkthrough records, and production smoke results.

## R2 launch gate · Phase 4

1. **[R2-MUST] Prove both reminder types in staging.** Use owner-controlled fixtures starting approximately 90 minutes ahead, with an exact deadline approximately 60 minutes ahead. Use distinct allowlisted users in Saved and Registered. Run real cron, record provider acceptance and inbox receipt for both, and verify one delivery per key. Validate unsubscribe headers and DKIM. Exercise webhook and suppression behavior separately. **Evidence:** `staging_deadline_and_attendance` inbox and provider checklist.
2. **[R2-MUST] Prove permissions and capacity.** Record feed approval, one real approved import, SMTP and reminder sender verification, independent quota evidence, and live-project plan choice. No approved feed means R1 can continue and R2 remains gated. **Evidence:** source registry, import run ID, published event ID, provider team/usage evidence, and verified sender status.
3. **[R2-MUST] Prove operations.** Run a clean-room restore with jobs disabled. Verify a tombstoned user stays deleted. Trigger one failed job and one missed heartbeat in staging and confirm the owner receives both. **Evidence:** `restore_replays_deletion_tombstones`, restore timestamps, dispatch reconciliation result, and alert receipt.
4. **[R2-MUST] Send one controlled production reminder.** With wider public signup still disabled, use one newly invited owner-allowlisted user and one temporary legitimate owner-controlled event. Set a known deadline and start inside the due window, with more than 15 minutes remaining. Set production `REMINDER_DELIVERY_MODE=smoke`, restricted in candidate selection, claim, and final recheck to the specified user ID, event ID, and `deadline` kind. Save the event and opt in. Let the normal production Cron → `pg_net` → Node → Resend path send. **Evidence:** production run ID, one `accepted` ledger row and provider message ID, plus an inbox receipt with the correct event, deadline, and link. Provider acceptance alone does not pass this gate.
5. **[R2-MUST] Complete and clean up the handoff.** On that account, mark the event Registered, import the calendar file, and verify My Events. Archive the temporary listing and clear smoke settings. Enable independent signup, the approved import schedule, and `REMINDER_DELIVERY_MODE=live` only after all gate evidence is recorded. **Evidence:** `production_new_user_reminder_journey`, curator maintenance checklist, and final job and Auth configuration record.

## Open items

| Tier | Item | Decision, reason and remaining check |
|---|---|---|
| R1-MUST | G-A1 · age at admission | Confirmed 18+ stored-account policy with free guest browsing for all ages (0+, event eligibility governed by organizer on Luma/Unstop). Check an explicit box at invite acceptance, verify identity server-side, persist adult_confirmed_at, then issue app cookies. Missing controls deny member access even with a direct Auth token. Retry a partial flow with fresh OTP. |
| R2-MUST | G-A1 · public signup | Enable hosted signup and shouldCreateUser only for explicit signup after gate 5. Confirm age before creating the first usable session. Keep reminder consent separate so a new account defaults to off. |
| R1-MUST | G-A2 · reference data | All three read roles need cities for filtering. sources holds labels, rights, review dates and allowed fields. Only approved attribution for visible linked events is public. Verify the three roles and private evidence columns in pgTAP. |
| R2-MUST | G-A2 · private data | Limit preferences to the eligible owner. Feed state/items, jobs, deliveries and suppressions deny direct browser and search-role access. Exercise each role at Phase 3. |
| R1-MUST | G-A3 · curator authority | Use session-bound SECURITY DEFINER RPCs so auth.uid() and verified aal2 reach SQL. Recheck active membership and assurance for each operation and audit it transactionally. |
| R1-MUST | G-A4 · sole curator recovery | Use operator identity verification, temporary revocation, Supabase admin factor removal, old token expiry and new enrollment. Demonstrate deny/allow behavior at R1 gate 3. |
| R1-MUST | G-A5 · configuration | ARCHITECTURE.md distinguishes browser, server, CI, operator and hosted Auth settings. Environment separation and placeholder-only examples reduce accidental disclosure. |
| R2-MUST | G-A5 · worker configuration | Keep feed allowlist, smoke/live, send kill switch, recipient key, webhook secret and two heartbeat URLs server-side. Smoke allowlist restricts each production send path. |
| R1-MUST | G-A6 · Auth exhaustion | Ten emails/hour limits both abuse and legitimate recovery. Monitor project-wide rate-limit events, alert on a hit, test in staging, and revisit at repeated hits or expansion. |
| R2-MUST | G-A6 · capacity | Start at 30/hour after verifying capacity. Revisit at signup opening, quota errors and 80% usage. Preserve independent reminder capacity. |
| R1-MUST | G-A7 · notice and consent | Owner reviews privacy, contact, age and consent wording before hosted invitations. Document operating policy without making a legal determination. |
| R1-MUST | Archive history | Store normalized url_key values in the private archive audit row before releasing claims. This preserves attribution history while allowing a new event to claim the URL. |
| R1-MUST | Discover rendering | Static shell with client-fetched public cards and separate no-store tracking. This permits a shared 30-second catalog cache without personal data. |
| R2-MUST | Optional items in the blueprint | Include one-click unsubscribe and signed bounce/complaint handling because both appear in the R2 tier table and launch evidence. Defer cancellation emails. |

### Vendor checks and deployment dependencies

| Tier | Official documentation checked 2026-11-22 | Consequence and outstanding evidence |
|---|---|---|
| R2-MUST | **VERIFIED**. Resend defaults to 10 API requests per second across a team's keys. [Usage limits](https://resend.com/docs/api-reference/rate-limit) | PENDING actual team allowance, daily/monthly capacity and independent usage records. Pace calls and honor retry headers within delivery expiry. |
| R2-MUST | **VERIFIED in part**. The webhook shows `Permanent` and gives `Temporary` as another example. Its linked guide lists `Permanent`, `Transient` and `Undetermined`. An exhaustive wire enum is **UNVERIFIED**. [Webhook reference](https://resend.com/docs/webhooks/emails/bounced) · [Bounce guide](https://resend.com/docs/dashboard/emails/email-bounces) | Treat the field as an open string. Only exact `Permanent` suppresses on bounce. Exercise both soft spellings, undetermined, missing and unknown in defensive tests. PENDING sanitized staging webhook evidence. |
| R2-MUST | **VERIFIED for the documented creation flow**. Creating an additional team under one login requires selecting a paid plan. Teams have separate billing and usage. [Multiple teams](https://resend.com/blog/multiple-teams) · [Managing teams](https://resend.com/docs/dashboard/settings/team) | Budget for an owner-approved additional team or independent production Auth SMTP plus a dedicated reminder team. PENDING actual plan, charges, domain verification and separate quotas. |

**[R1-MUST] PENDING staging evidence.** Verify allocated accounts, intended non-commercial hosting plan and limits, project pausing, Node version, CDN and WAF behavior, SMTP eligibility, Auth ceilings, stable CAPTCHA hostnames, MFA and backups. **[R2-MUST] PENDING staging and production evidence.** Confirm Cron/pg_net timing and reconciliation, real feed permission/sample, team quotas and log retention, DKIM coverage, actual inbox delivery, alert receipts and restore. Vendor documentation establishes capabilities. Only gate evidence establishes deployment readiness.

### Owner dependencies

| Tier | Owner question | Recommended default and timing | Status |
|---|---|---|---|
| R1-MUST | Which exact Unstop or Luma screens and browsing behaviors should inform Discover? | One mobile reference and up to two behaviors. The neutral brief supports an initial staging review. | CONFIRMED (2026-11-22: Neutral Discover design brief tokens and search + visible filters approved) |
| R1-MUST | Which SMTP mailbox can Astra configure for the hosted beta, and which two inboxes can receive the test invitations? | Resend SMTP on an already verified domain, otherwise an eligible dedicated Gmail mailbox for the invited beta. Supply addresses privately before hosted tests. | CONFIRMED approach / PENDING private addresses (2026-11-22: Dedicated Gmail mailbox selected; addresses supplied privately in Phase 2B) |
| R1-MUST | What public name and monitored email should appear on the site, and which verified Auth account should receive curator access? | One monitored project mailbox and one verified curator. Confirm before invitations. | PENDING private environment values (2026-11-22: Placeholders kept in repo; real values supplied in private environment settings before Phase 2B) |
| R1-MUST | Which ages may create accounts? | Guests browse freely. Proposed account minimum is 18 with self-attestation. A younger audience needs an owner-approved consent design. Review the notice and consent text before invitations. | CONFIRMED (2026-11-22: Guests of all ages (0+) browse freely and follow organizer rules on Luma/Unstop; stored email accounts remain 18+ with self-attestation) |
| R2-MUST | Which exact calendar may the app fetch, which fields may it store or display, and what approval and attribution apply? | One organizer-approved Luma calendar or organizer-hosted ICS, with written scope and a passing sample. | PENDING |
| R2-MUST | Which sending subdomains, provider teams, and controlled production inbox can Astra use? | Distinct verified subdomains and independent Auth and reminder quotas. Owner approves a paid additional Resend team or supplies independent production Auth SMTP. | PENDING |
| R2-MUST | Should public reminders use a paid Supabase project, and who receives job alerts? | Paid project and owner recipient. A limited pilot needs explicit acceptance of pauses and missed windows. | PENDING |
| LATER-HARDENING | Should a later release also email people when an event is canceled? | Defer. Launch with an in-app cancellation reason and suppress pending reminders. | PENDING |
