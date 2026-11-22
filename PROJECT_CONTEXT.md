# Tech Event Discover · Project context

**[R1-MUST]** Help students, early-career developers and tech communities find events they can attend from India. Start with an English, personally operated, non-commercial curated beta. Guests can browse, follow the organizer’s registration link and download a calendar file. An invitation unlocks tracking.

## Vocabulary and release scope

| Tier | Term | Meaning |
|---|---|---|
| R1-MUST | Owner / curator | The owner approves scope, permissions and deployment. A curator verifies listings, publishes corrections and handles reports. Start with one curator. |
| R1-MUST | Source | The organizer or original listing. Each published event has one primary source and may have additional authorized links. |
| R1-MUST | Saved / Registered | Saved records interest. Registered is the member’s own indication that they registered externally. My Events keeps these views separate. Registration and payment take place at the source. |
| R1-MUST | Discover | Search and filter a public catalog, open a detail, follow the primary source, save, mark Registered and import a one-time calendar copy. Physical and hybrid events need an Indian venue city. A curator confirms India access for online events. |
| R2-MUST | Feed | One permitted machine-readable calendar. Incoming changes go to a curator before publication. Open independent signup and opt-in reminders after the production gate. |
| LATER-HARDENING | Deferred scope | Native sharing, posters, richer event fields, typo correction, recommendations, per-event reminders, cancellation mail, push, registration verification, provider connections and calendar sync. |

## Product acceptance

| Tier | Scenario | What the owner can observe |
|---|---|---|
| R1-MUST | Find and evaluate | A card gives title, type, organizer, date/time, mode, physical city, price status, primary source, Save and any supplied deadline. Detail adds a summary, all authorized sources, tracking and calendar download. Unknown prices and end times stay explicit. |
| R1-MUST | Use My Events | A member can change or remove their own tracking. Past and canceled events have labels. Hidden listings show “Event unavailable” and Remove. Only the owner of the tracking row can see it. |
| R1-MUST | Beta inventory | At least 12 verified events starting in the next 45 days. At least two sources contribute three apiece. Include four online and four physical events, counting hybrid only in the physical group. |
| R1-MUST | Walkthrough | In three consented walkthroughs, time a signed-in visitor from Discover to saving a matching event. Record whether they finish within two minutes. Fix repeated blockers before expansion. |
| R1-MUST | Curation and release | The curator can create, publish, correct and withdraw listings in the UI. Check calendar imports, accessibility, privacy review, actual invitations, inbox receipt and tenant isolation at the five R1 gates in ROADMAP.md. |
| R2-MUST | Full release journey | A new user finds a real event, saves it, opts in, receives the correct deadline reminder, marks it Registered, imports the calendar file and finds it in My Events. The curator approves a real feed item and edits a listing through the UI. Prove both reminder kinds in staging and a controlled deadline send in production. |

## Discover design brief

| Tier | Decision | Working default pending owner references |
|---|---|---|
| R1-MUST | Screen and behavior | Review one mobile reference if supplied. Start with search, visible filters, scannable cards and a prominent organizer link. Use original visual treatment and text attribution. |
| R1-MUST | Density and tokens | One column at 320 px, two at 768 px, three at 1,200 px. System sans, 8 px spacing base, 12 px radius. Canvas #F8FAFC, cards #FFFFFF, text #0F172A, secondary #475569, accent/focus #1D4ED8. |
| R1-MUST | Empty and error states | “No events match these filters.” with **Clear filters**. “We couldn’t load events.” with **Try again**. “No saved events yet.” with **Browse events**. |
| R1-MUST | Display and access | Show timed online events in IST and label their event zone when different. Preserve local all-day dates. Label 50 km distances as city-center estimates. Review contrast, control names, keyboard order, focus and mobile reflow against WCAG 2.2 AA. |

## Privacy and retention

| Tier | Data or user choice | Policy |
|---|---|---|
| R1-MUST | Account notice | Owner reviews and approves the public privacy notice, age and consent wording before invitations. Identify responsible owner, monitored grievance contact, processors, uses, retention and how to request access or deletion. Publish at /privacy. Default wording for a separate unchecked box is “I confirm I am at least 18 years old.” Store the first confirmed timestamp. Collect neither date of birth nor device coordinates. |
| R1-MUST | Member and catalog data | Verified email lives in Auth. City selection lives in the Discover URL. Members own their tracking rows. Keep private audit entries for 180 days, mutation and OTP buckets for 24 hours, encrypted backups for 30 days. |
| R1-MUST | Deletion | Require a fresh OTP, block ordinary writes while deletion is pending and delete Auth-linked account data. Keep only the user UUID and request time in a separate 35-day tombstone so a 30-day backup cannot silently reinstate a deleted account. Audit actors become null on deletion. |
| R2-MUST | Reminder consent | Separate unchecked setting in Settings: “Email me before a saved event’s registration deadline and before events I mark Registered. I can turn this off at any time.” Record notice version, timestamp and consent version. Offer settings and one-click opt-out. |
| R2-MUST | Delivery and recovery | Keep delivery keys through 90 days after target, unsubscribe digests for 90 days and job runs for 30 days. Clear temporary request payload at terminal completion or the earlier of expiry and 23 hours after first attempt. Permanent-bounce suppression lasts 90 days, complaint suppression 180 days. Account deletion cascades preferences, ledger and suppressions. Verify provider-side retention before launch. |

## Source registry and corrections

**[R1-MUST]** These are proposed entries. Each actual source needs a stable slug, display name, permission basis and evidence reference, allowed fields, attribution and last review date before use. Keep the approved record in `sources`. A publicly reachable URL alone establishes no reuse permission.

| Tier | Candidate / status | Permission basis | Fields subject to approval | Attribution | Last review |
|---|---|---|---|---|---|
| R1-MUST | Manual organizer or original listing, per source · PENDING | Owner records organizer consent or reviewed permitted use | Verified event facts, public event link, original curator summary | Approved text source name linked to listing | PENDING |
| R2-MUST | One organizer-approved Luma or organizer-hosted ICS · PENDING | Written permission for polling, field storage, display and attribution, plus passing sample | UID, title, schedule/zone, location, event URL, cancellation and update markers within approved scope | Owner records organizer’s requested credit | PENDING |

**[R1-MUST]** Use logos, posters or third-party descriptions only with explicit reuse permission. Never scrape or use authenticated automation or undocumented endpoints against LinkedIn, Unstop or Internshala. A “Report a correction” email link includes the event URL. Acknowledge reports within two working days and audit the outcome. Remove withdrawn material. Archive if an independently authorized listing and valid primary source cannot remain.

**[R2-MUST]** On feed revocation disable polling, clear affected pending proposals, recompute holds and review linked public material under the same rights policy.

## External dependencies

| Tier | Dependency | Status and evidence needed |
|---|---|---|
| R1-MUST | Owner inputs, authorized catalog, calendar clients and beta participants | PENDING names, policy approval, permissions, inventory, two test inboxes, three walkthroughs and calendar import checks. |
| R1-MUST | GitHub CI, Supabase Auth/Postgres, Vercel, Turnstile, SMTP, backup destination | PENDING project access, plan suitability, hostnames, actual settings, restore rehearsal and inbox evidence. Vercel HTTPS plus eligible Gmail SMTP is a beta option. |
| R2-MUST | Feed, sending subdomains, Auth SMTP and Resend capacity | PENDING approval, sample, verified senders, isolated capacity, webhook and staging/production evidence. Documented vendor behavior is tracked in ARCHITECTURE.md. |
| R2-MUST | Cron, pg_net, independent Healthchecks.io checks, daily backups | PENDING availability choice, alert recipient, dispatch timings, failed/missed alert receipts and deletion-safe restore. |

## Owner decisions

| Tier | Owner question | Recommended default and timing | Status |
|---|---|---|---|
| R1-MUST | Which exact Unstop or Luma screens and browsing behaviors should inform Discover? | One mobile reference and up to two behaviors. The neutral brief above supports an initial staging review. | CONFIRMED (2026-11-22: Owner approved neutral Discover design brief tokens and search + visible filters) |
| R1-MUST | Which SMTP mailbox can Astra configure for the hosted beta, and which two inboxes can receive the test invitations? | Resend SMTP on an already verified domain, otherwise an eligible dedicated Gmail mailbox for the invited beta. Supply addresses privately before hosted tests. | CONFIRMED approach / PENDING private addresses (2026-11-22: Owner selected dedicated Gmail mailbox with 2-Step Verification + App Password; addresses to be supplied privately in Phase 2B) |
| R1-MUST | What public name and monitored email should appear on the site, and which verified Auth account should receive curator access? | One monitored project mailbox and one verified curator. Confirm before invitations. | PENDING private environment values (2026-11-22: Keep placeholders in repo; supply real `PUBLIC_OWNER_NAME`, `PUBLIC_CONTACT_EMAIL`, and curator email in private environment settings before Phase 2B hosted tests) |
| R1-MUST | Which ages may create accounts? | Guests browse freely. Proposed account minimum is 18 with self-attestation. A younger audience needs an owner-approved consent design. Review the notice and consent text before invitations. | CONFIRMED (2026-11-22: Guests of all ages (0+) browse freely and follow organizer eligibility rules on Luma/Unstop; stored email accounts remain 18+ with self-attestation checkbox) |
| R2-MUST | Which exact calendar may the app fetch, which fields may it store or display, and what approval and attribution apply? | One organizer-approved Luma calendar or organizer-hosted ICS, with written scope and a passing sample. | PENDING |
| R2-MUST | Which sending subdomains, provider teams, and controlled production inbox can Astra use? | Distinct verified subdomains and independent Auth and reminder quotas. Owner approves a paid additional Resend team or supplies independent production Auth SMTP. | PENDING |
| R2-MUST | Should public reminders use a paid Supabase project, and who receives job alerts? | Paid project and owner recipient. A limited pilot needs explicit acceptance of pauses and missed windows. | PENDING |
| LATER-HARDENING | Should a later release also email people when an event is canceled? | Defer. Launch with an in-app cancellation reason and suppress pending reminders. | PENDING |
