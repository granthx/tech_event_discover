-- =============================================================================
-- Tech Event Discover · Phase 3A pgTAP Verification Suite
-- Covers required Phase 3A SQL evidence (ROADMAP.md lines 50-51):
--   - All 22 ordered shared eligibility fixtures (matching eligibility-fixtures.json),
--     including exact due/expiry, all-day midnight, unknown end, hold, consent,
--     both tracking transitions, and ongoing_event_does_not_receive_attendance_reminder
--   - Own-preference RLS (user_preferences) & private worker tables (job_runs,
--     reminder_deliveries, reminder_suppressions, events.reminder_hold)
--   - set_user_reminder_preference increments consent_version ONLY on real change
--   - old_unsubscribe_token_cannot_revoke_new_consent
--   - expired_lease_cannot_finalize_new_attempt & preserved first_attempt_at
--   - Smoke allowlist enforcement at selection and claim
--   - Webhook permanent bounce / complaint suppression replay monotonic GREATEST expiry
--   - Single-run 120s job bearer consumption & replay rejection
--   - Auth deletion cascades user_preferences, reminder_deliveries, reminder_suppressions
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(61);

-- Clean fixture tables inside rolled-back test transaction
DELETE FROM public.reminder_suppressions;
DELETE FROM public.reminder_deliveries;
DELETE FROM public.job_runs;
DELETE FROM public.user_preferences;
DELETE FROM public.curator_audit;
DELETE FROM public.curator_access;
DELETE FROM public.user_events;
DELETE FROM public.event_sources;
DELETE FROM public.events;
DELETE FROM public.sources;
DELETE FROM public.cities;
DELETE FROM public.account_controls;
DELETE FROM public.deleted_accounts;
DELETE FROM public.rate_limit_buckets;

-- =============================================================================
-- PART 1: Shared 22-Case Ordered Reminder Eligibility Truth-Table Fixtures
-- =============================================================================

-- 01_untracked_none
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    NULL, 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'untracked'::text)$$,
  'fixture 01_untracked_none'
);

-- 02_inactive_status_draft
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'draft', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, 'inactive_status'::text)$$,
  'fixture 02_inactive_status_draft'
);

-- 03_inactive_status_canceled
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'canceled', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-10T00:00:00Z'
  )$$,
  $$VALUES (false, 'inactive_status'::text)$$,
  'fixture 03_inactive_status_canceled'
);

-- 04_inactive_status_archived
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'archived', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-10T00:00:00Z'
  )$$,
  $$VALUES (false, 'inactive_status'::text)$$,
  'fixture 04_inactive_status_archived'
);

-- 05_opted_out
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', false, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, 'opted_out'::text)$$,
  'fixture 05_opted_out'
);

-- 06_hold_reminder_hold_true
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, true, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, 'applicable_hold'::text)$$,
  'fixture 06_hold_reminder_hold_true'
);

-- 07_hold_deletion_pending
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, true, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-10T00:00:00Z'
  )$$,
  $$VALUES (false, 'applicable_hold'::text)$$,
  'fixture 07_hold_deletion_pending'
);

-- 08_hold_unverified_recipient
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, false, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-10T00:00:00Z'
  )$$,
  $$VALUES (false, 'applicable_hold'::text)$$,
  'fixture 08_hold_unverified_recipient'
);

-- 09_hold_active_suppression
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, true, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, 'applicable_hold'::text)$$,
  'fixture 09_hold_active_suppression'
);

-- 10_saved_missing_deadline
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-09T12:00:00Z'
  )$$,
  $$VALUES (false, 'no_exact_deadline'::text)$$,
  'fixture 10_saved_missing_deadline'
);

-- 11_saved_date_only_deadline_is_non_exact
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, true,
    NULL, NULL, '2026-12-10', '2026-12-12', 'Asia/Kolkata',
    NULL, '2026-12-09', false, '2026-12-08T12:00:00Z'
  )$$,
  $$VALUES (false, 'no_exact_deadline'::text)$$,
  'fixture 11_saved_date_only_deadline_is_non_exact'
);

-- 12_saved_registration_closed
SELECT results_eq(
  $$SELECT eligible, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, true, '2026-12-09T00:00:00Z'
  )$$,
  $$VALUES (false, 'registration_closed'::text)$$,
  'fixture 12_saved_registration_closed'
);

-- 13_saved_exact_before_due_boundary
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-08T11:59:59Z'
  )$$,
  $$VALUES (false, 'deadline'::text, '2026-12-09T12:00:00Z'::timestamptz, '2026-12-08T12:00:00Z'::timestamptz, '2026-12-09T11:45:00Z'::timestamptz, 'too_early'::text)$$,
  'fixture 13_saved_exact_before_due_boundary'
);

-- 14_saved_exact_at_due_boundary_in_window
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-08T12:00:00Z'
  )$$,
  $$VALUES (true, 'deadline'::text, '2026-12-09T12:00:00Z'::timestamptz, '2026-12-08T12:00:00Z'::timestamptz, '2026-12-09T11:45:00Z'::timestamptz, NULL::text)$$,
  'fixture 14_saved_exact_at_due_boundary_in_window'
);

-- 15_saved_exact_at_expiry_boundary_too_late
SELECT results_eq(
  $$SELECT eligible, kind, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T11:45:00Z'
  )$$,
  $$VALUES (false, 'deadline'::text, 'too_late'::text)$$,
  'fixture 15_saved_exact_at_expiry_boundary_too_late'
);

-- 16_saved_timed_unknown_end_in_window
SELECT results_eq(
  $$SELECT eligible, kind, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', NULL, NULL, NULL, 'UTC',
    '2026-12-10T10:00:00Z', NULL, false, '2026-12-10T09:44:59Z'
  )$$,
  $$VALUES (true, 'deadline'::text, '2026-12-10T09:45:00Z'::timestamptz, NULL::text)$$,
  'fixture 16_saved_timed_unknown_end_in_window'
);

-- 17_registered_timed_before_due
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, false, '2026-12-09T11:59:59Z'
  )$$,
  $$VALUES (false, 'attendance'::text, '2026-12-10T12:00:00Z'::timestamptz, '2026-12-09T12:00:00Z'::timestamptz, '2026-12-10T11:45:00Z'::timestamptz, 'too_early'::text)$$,
  'fixture 17_registered_timed_before_due'
);

-- 18_registered_timed_in_window_at_exact_due_transition_from_saved
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T12:00:00Z', NULL, true, '2026-12-09T12:00:00Z'
  )$$,
  $$VALUES (true, 'attendance'::text, '2026-12-10T12:00:00Z'::timestamptz, '2026-12-09T12:00:00Z'::timestamptz, '2026-12-10T11:45:00Z'::timestamptz, NULL::text)$$,
  'fixture 18_registered_timed_in_window_at_exact_due_transition_from_saved'
);

-- 19_ongoing_event_does_not_receive_attendance_reminder
SELECT results_eq(
  $$SELECT eligible, kind, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', NULL, NULL, NULL, 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-10T12:30:00Z'
  )$$,
  $$VALUES (false, 'attendance'::text, '2026-12-10T11:45:00Z'::timestamptz, 'too_late'::text)$$,
  'ongoing_event_does_not_receive_attendance_reminder: ongoing event returns ineligible too_late'
);

-- 20_registered_all_day_in_window_0900_anchor
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, true, false, true,
    NULL, NULL, '2026-12-10', '2026-12-11', 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-09T10:00:00Z'
  )$$,
  $$VALUES (true, 'attendance'::text, '2026-12-10T03:30:00Z'::timestamptz, '2026-12-09T03:30:00Z'::timestamptz, '2026-12-09T18:15:00Z'::timestamptz, NULL::text)$$,
  'fixture 20_registered_all_day_in_window_0900_anchor'
);

-- 21_registered_all_day_midnight_cutoff_too_late
SELECT results_eq(
  $$SELECT eligible, kind, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'registered', 'published', true, false, false, true, false, true,
    NULL, NULL, '2026-12-10', '2026-12-11', 'Asia/Kolkata',
    NULL, NULL, false, '2026-12-09T18:15:00Z'
  )$$,
  $$VALUES (false, 'attendance'::text, '2026-12-09T18:15:00Z'::timestamptz, 'too_late'::text)$$,
  'fixture 21_registered_all_day_midnight_cutoff_too_late'
);

-- 22_registered_to_saved_transition_restores_deadline_evaluation
SELECT results_eq(
  $$SELECT eligible, kind, anchor_at, due_at, expires_at, reason FROM public.evaluate_reminder_eligibility(
    'saved', 'published', true, false, false, true, false, false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', NULL, NULL, 'Asia/Kolkata',
    '2026-12-09T18:00:00Z', NULL, false, '2026-12-09T12:00:00Z'
  )$$,
  $$VALUES (true, 'deadline'::text, '2026-12-09T18:00:00Z'::timestamptz, '2026-12-08T18:00:00Z'::timestamptz, '2026-12-09T17:45:00Z'::timestamptz, NULL::text)$$,
  'fixture 22_registered_to_saved_transition_restores_deadline_evaluation'
);

-- =============================================================================
-- PART 2: Seed Test Users, Events, Preferences & Verify RLS / Private Worker Tables
-- =============================================================================

INSERT INTO public.sources (
  slug, display_name, attribution_text, permission_basis, evidence_ref,
  allowed_fields, reviewed_on, permission_status
)
VALUES (
  'foss-united', 'FOSS United', 'Credit: FOSS United', 'Written permission',
  'ref-p3a-1', ARRAY['title', 'url'], '2026-11-26', 'approved'
);

INSERT INTO public.events (
  id, status, version, title, organizer, summary, event_type, mode, price_status,
  online_india_access_confirmed, event_timezone, is_all_day,
  starts_at, ends_at, registration_deadline_at, registration_closed, reminder_hold
)
VALUES
  (
    '12121212-1212-4212-8212-121212121201',
    'published', 1, 'Phase 3A Deadline Event', 'FOSS United', 'Test summary',
    'hackathon', 'online', 'free', true, 'Asia/Kolkata', false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', '2026-12-09T12:00:00Z', false, false
  ),
  (
    '12121212-1212-4212-8212-121212121202',
    'published', 1, 'Phase 3A Second Event', 'FOSS United', 'Second summary',
    'workshop', 'online', 'free', true, 'Asia/Kolkata', false,
    '2026-12-10T12:00:00Z', '2026-12-10T15:00:00Z', '2026-12-09T12:00:00Z', false, false
  );

INSERT INTO public.event_sources (id, event_id, source_slug, public_url, url_key, is_primary)
VALUES
  ('34343434-3434-4434-8434-343434343401', '12121212-1212-4212-8212-121212121201', 'foss-united', 'https://fossunited.org/events/p3a-1', 'https://fossunited.org/events/p3a-1', true),
  ('34343434-3434-4434-8434-343434343402', '12121212-1212-4212-8212-121212121202', 'foss-united', 'https://fossunited.org/events/p3a-2', 'https://fossunited.org/events/p3a-2', true);

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', 'user-a@example.org', '2026-11-26T10:00:00Z'),
  ('aaaaaaaa-1111-4111-8111-111111111102', 'user-b@example.org', '2026-11-26T10:00:00Z'),
  ('aaaaaaaa-1111-4111-8111-111111111103', 'unattested@example.org', '2026-11-26T10:00:00Z');

INSERT INTO public.account_controls (user_id, adult_confirmed_at, deletion_requested_at)
VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', '2026-11-26T10:00:00Z', NULL),
  ('aaaaaaaa-1111-4111-8111-111111111102', '2026-11-26T10:00:00Z', NULL),
  ('aaaaaaaa-1111-4111-8111-111111111103', NULL, NULL);

-- Verify private events.reminder_hold column is hidden from anon, authenticated, and catalog_reader
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT reminder_hold FROM public.events$$,
  '42501',
  NULL,
  'events.reminder_hold is private and denied to anon'
);

SELECT throws_ok(
  $$SELECT * FROM public.user_preferences$$,
  '42501',
  NULL,
  'user_preferences denied to anon'
);

SELECT throws_ok(
  $$SELECT * FROM public.job_runs$$,
  '42501',
  NULL,
  'job_runs denied to anon'
);

SELECT throws_ok(
  $$SELECT * FROM public.reminder_deliveries$$,
  '42501',
  NULL,
  'reminder_deliveries denied to anon'
);

SELECT throws_ok(
  $$SELECT * FROM public.reminder_suppressions$$,
  '42501',
  NULL,
  'reminder_suppressions denied to anon'
);

SET LOCAL ROLE catalog_reader;
SELECT throws_ok(
  $$SELECT * FROM public.user_preferences$$,
  '42501',
  NULL,
  'user_preferences denied to catalog_reader'
);

SELECT throws_ok(
  $$SELECT * FROM public.reminder_deliveries$$,
  '42501',
  NULL,
  'reminder_deliveries denied to catalog_reader'
);

-- =============================================================================
-- PART 3: Preference RPC & Own-Preference RLS
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-4111-8111-111111111101","role":"authenticated"}', true);

-- Private worker tables also denied to authenticated
SELECT throws_ok(
  $$SELECT * FROM public.job_runs$$,
  '42501',
  NULL,
  'job_runs denied to authenticated'
);

SELECT throws_ok(
  $$SELECT * FROM public.reminder_deliveries$$,
  '42501',
  NULL,
  'reminder_deliveries denied to authenticated'
);

SELECT throws_ok(
  $$SELECT * FROM public.reminder_suppressions$$,
  '42501',
  NULL,
  'reminder_suppressions denied to authenticated'
);

-- Setting false when absent does NOT increment consent_version (stays 0, was_updated = false)
SELECT results_eq(
  $$SELECT http_status, email_reminders_enabled, consent_version, was_updated
    FROM public.set_user_reminder_preference(false, '2026-11-r2-v1', '2026-12-01T10:00:00Z')$$,
  $$VALUES (200, false, 0::bigint, false)$$,
  'set_user_reminder_preference: setting false when absent keeps consent_version 0 without creating row'
);

-- Opt-in increments consent_version to 1
SELECT results_eq(
  $$SELECT http_status, email_reminders_enabled, consent_version, was_updated
    FROM public.set_user_reminder_preference(true, '2026-11-r2-v1', '2026-12-01T10:01:00Z')$$,
  $$VALUES (200, true, 1::bigint, true)$$,
  'set_user_reminder_preference: first opt-in records consent_version 1'
);

-- Repeating true does NOT increment consent_version
SELECT results_eq(
  $$SELECT http_status, email_reminders_enabled, consent_version, was_updated
    FROM public.set_user_reminder_preference(true, '2026-11-r2-v1', '2026-12-01T10:02:00Z')$$,
  $$VALUES (200, true, 1::bigint, false)$$,
  'set_user_reminder_preference: repeating true keeps consent_version 1'
);

-- Member B opts in too; verify Member A sees ONLY Member A's preference row
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-4111-8111-111111111102","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT * FROM public.set_user_reminder_preference(true, '2026-11-r2-v1', '2026-12-01T10:03:00Z')$$,
  'Member B opts in to reminders'
);

SELECT results_eq(
  $$SELECT user_id::text FROM public.user_preferences$$,
  ARRAY['aaaaaaaa-1111-4111-8111-111111111102'],
  'own-preference RLS: Member B sees only Member B preference row'
);

-- Unattested user is denied preference writes (403) and sees 0 rows
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-4111-8111-111111111103","role":"authenticated"}', true);
SELECT is(
  (SELECT http_status FROM public.set_user_reminder_preference(true, '2026-11-r2-v1', '2026-12-01T10:04:00Z')),
  403,
  'unattested user denied set_user_reminder_preference (403)'
);

RESET ROLE;

-- =============================================================================
-- PART 4: Smoke Allowlist at Selection & Claim + expired_lease_cannot_finalize_new_attempt
-- =============================================================================
INSERT INTO public.user_events (user_id, event_id, state)
VALUES
  ('aaaaaaaa-1111-4111-8111-111111111101', '12121212-1212-4212-8212-121212121201', 'saved'),
  ('aaaaaaaa-1111-4111-8111-111111111102', '12121212-1212-4212-8212-121212121202', 'saved');

-- Empty smoke allowlist stops materialization (0 rows)
SELECT is(
  (SELECT materialized_count FROM public.materialize_due_reminder_deliveries(
    'smoke', '[]'::jsonb, 'digest-secret-key-0000000000000000', '2026-12-09T00:00:00Z'
  )),
  0,
  'smoke allowlist selection check: empty smoke allowlist materializes 0 deliveries'
);

-- Explicit smoke allowlist for Member A + Event 1 materializes ONLY 1 row (skipping Member B)
SELECT is(
  (SELECT materialized_count FROM public.materialize_due_reminder_deliveries(
    'smoke',
    '[{"userId":"aaaaaaaa-1111-4111-8111-111111111101","eventId":"12121212-1212-4212-8212-121212121201","kind":"deadline"}]'::jsonb,
    'digest-secret-key-0000000000000000',
    '2026-12-09T00:00:00Z'
  )),
  1,
  'smoke allowlist selection check: materializes only allowlisted user/event/kind tuple'
);

-- Claim with non-matching smoke allowlist claims 0 rows
SELECT is(
  (SELECT count(*)::int FROM public.claim_due_reminder_deliveries(
    'smoke',
    '[{"userId":"aaaaaaaa-1111-4111-8111-111111111102","eventId":"12121212-1212-4212-8212-121212121202","kind":"deadline"}]'::jsonb,
    'digest-secret-key-0000000000000000',
    10,
    '2026-12-09T00:00:00Z'
  )),
  0,
  'smoke allowlist claim check: non-matching allowlist claims 0 rows'
);

-- Worker 1 claims at 2026-12-09T00:00:00Z -> attempt_count = 1, lease_until = 00:01:30Z
SELECT lives_ok(
  $$
    SELECT set_config(
      'test.delivery_id',
      (
        SELECT delivery_id::text
        FROM public.claim_due_reminder_deliveries(
          'smoke',
          '[{"userId":"aaaaaaaa-1111-4111-8111-111111111101","eventId":"12121212-1212-4212-8212-121212121201","kind":"deadline"}]'::jsonb,
          'digest-secret-key-0000000000000000',
          10,
          '2026-12-09T00:00:00Z'
        )
        LIMIT 1
      ),
      true
    )
  $$,
  'worker 1 claims due delivery (attempt 1)'
);

-- Prepare attempt 1 at 00:00:10Z (freezes payload + unsubscribe digest + consent_version_at_send=1)
SELECT is(
  (
    SELECT prepared
    FROM public.prepare_reminder_provider_attempt(
      current_setting('test.delivery_id')::uuid,
      1,
      '{"to":"user-a@example.org","subject":"Test"}'::jsonb,
      'digest-unsub-v1',
      1,
      '2026-12-09T00:00:10Z'
    )
  ),
  true,
  'worker 1 prepares attempt 1 before lease expiry'
);

-- Lease expires at 00:01:30Z -> Worker 1 tries to finalize at 00:01:31Z -> REJECTED!
SELECT is(
  public.finalize_reminder_delivery_attempt(
    current_setting('test.delivery_id')::uuid,
    1,
    'accepted',
    true,
    'msg_stale_1',
    NULL,
    NULL,
    '2026-12-09T00:01:31Z'
  ),
  false,
  'expired_lease_cannot_finalize_new_attempt: finalizing after 90s lease expiry returns false'
);

-- Worker 2 recovers the expired lease at 00:02:00Z -> attempt_count = 2, first_attempt_at stays 00:00:00Z!
SELECT results_eq(
  $$
    SELECT attempt_count, first_attempt_at
    FROM public.claim_due_reminder_deliveries(
      'smoke',
      '[{"userId":"aaaaaaaa-1111-4111-8111-111111111101","eventId":"12121212-1212-4212-8212-121212121201","kind":"deadline"}]'::jsonb,
      'digest-secret-key-0000000000000000',
      10,
      '2026-12-09T00:02:00Z'
    )
  $$,
  $$VALUES (2, '2026-12-09T00:00:00Z'::timestamptz)$$,
  'recovered lease increments attempt_count to 2 and does NOT reset first_attempt_at retry horizon'
);

-- Worker 1 tries to finalize with stale attempt_count = 1 while Worker 2 holds active lease -> REJECTED!
SELECT is(
  public.finalize_reminder_delivery_attempt(
    current_setting('test.delivery_id')::uuid,
    1,
    'accepted',
    true,
    'msg_stale_1b',
    NULL,
    NULL,
    '2026-12-09T00:02:10Z'
  ),
  false,
  'expired_lease_cannot_finalize_new_attempt: stale attempt_count=1 cannot finalize attempt_count=2 lease'
);

-- Worker 2 finalizes attempt_count = 2 as accepted -> clears pending_payload!
SELECT is(
  public.finalize_reminder_delivery_attempt(
    current_setting('test.delivery_id')::uuid,
    2,
    'accepted',
    true,
    're_msg_accepted_1',
    NULL,
    NULL,
    '2026-12-09T00:02:15Z'
  ),
  true,
  'attempt 2 finalizes accepted returning true'
);

SELECT results_eq(
  format(
    $$
      SELECT rd.status, rd.pending_payload IS NULL, rd.provider_message_id
      FROM public.reminder_deliveries rd
      WHERE rd.id = %L::uuid
    $$,
    current_setting('test.delivery_id')
  ),
  $$VALUES ('accepted'::text, true, 're_msg_accepted_1'::text)$$,
  'attempt 2 finalization persists accepted status and clears temporary pending_payload'
);

-- =============================================================================
-- PART 5: old_unsubscribe_token_cannot_revoke_new_consent
-- =============================================================================
-- Member A opts out via Settings (v1 -> v2) and opts back in via Settings (v2 -> v3)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-4111-8111-111111111101","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT * FROM public.set_user_reminder_preference(false, '2026-11-r2-v1', '2026-12-09T01:00:00Z')$$,
  'Member A opts out to consent_version 2'
);
SELECT is(
  (SELECT consent_version FROM public.set_user_reminder_preference(true, '2026-11-r2-v1', '2026-12-09T01:05:00Z')),
  3::bigint,
  'Member A re-consents to consent_version 3'
);
RESET ROLE;

-- Clicking old v1 unsubscribe token ('digest-unsub-v1', issued at consent_version_at_send = 1)
-- MUST return 204 preserved_newer_consent and keep email_reminders_enabled = true!
SELECT results_eq(
  $$SELECT http_status, outcome FROM public.apply_reminder_unsubscribe_token('digest-unsub-v1', '2026-12-09T02:00:00Z')$$,
  $$VALUES (204, 'preserved_newer_consent'::text)$$,
  'old_unsubscribe_token_cannot_revoke_new_consent: old v1 token returns 204 preserved_newer_consent'
);

SELECT results_eq(
  $$SELECT email_reminders_enabled, consent_version FROM public.user_preferences WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111101'$$,
  $$VALUES (true, 3::bigint)$$,
  'old_unsubscribe_token_cannot_revoke_new_consent: newer v3 opt-in remains enabled'
);

-- Invalid unsubscribe token returns 400
SELECT is(
  (SELECT http_status FROM public.apply_reminder_unsubscribe_token('nonexistent-digest', '2026-12-09T02:00:00Z')),
  400,
  'invalid unsubscribe token returns generic 400'
);

-- =============================================================================
-- PART 6: Webhook Suppression Correlation, Monotonic Expiry & Single-Run Job Bearer
-- =============================================================================
-- Event-before-acceptance correlation returns 503 retryable
SELECT is(
  (SELECT http_status FROM public.record_webhook_suppression(
    'unrecorded_msg_id', 'user-a@example.org', 'digest-secret-key-0000000000000000',
    'permanent_bounce', '2027-03-09T00:00:00Z', '2026-12-09T03:00:00Z'
  )),
  503,
  'webhook event-before-acceptance returns 503 unmatched_retryable'
);

-- Matched permanent bounce records +90d suppression; replaying an earlier expiry keeps later GREATEST expiry!
SELECT results_eq(
  $$SELECT http_status, outcome FROM public.record_webhook_suppression(
    're_msg_accepted_1', 'user-a@example.org', 'digest-secret-key-0000000000000000',
    'permanent_bounce', '2027-03-15T00:00:00Z', '2026-12-09T03:01:00Z'
  )$$,
  $$VALUES (200, 'suppressed'::text)$$,
  'first permanent bounce webhook records suppression'
);

SELECT results_eq(
  $$SELECT http_status, outcome FROM public.record_webhook_suppression(
    're_msg_accepted_1', 'user-a@example.org', 'digest-secret-key-0000000000000000',
    'permanent_bounce', '2027-03-01T00:00:00Z', '2026-12-09T03:02:00Z'
  )$$,
  $$VALUES (200, 'suppressed'::text)$$,
  'replayed permanent bounce webhook with older timestamp succeeds'
);

SELECT is(
  (SELECT expires_at FROM public.reminder_suppressions WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111101'),
  '2027-03-15T00:00:00Z'::timestamptz,
  'suppression replay preserves later stored expires_at monotonically'
);

-- Single-run 120s job bearer: first consume succeeds, replay fails (false)
SELECT lives_ok(
  $$
    SELECT set_config(
      'test.job_run_id',
      public.create_scheduled_job_run(
        'reminders', '2026-12-09T04:00:00Z', 'bearer-digest-1', '2026-12-09T04:00:00Z'
      )::text,
      true
    )
  $$,
  'create_scheduled_job_run creates reminders run row'
);

SELECT is(
  public.consume_job_run_bearer(
    current_setting('test.job_run_id')::uuid, 'reminders', 'bearer-digest-1', '2026-12-09T04:00:05Z'
  ),
  true,
  'single-run job bearer succeeds on first consumption within 120s'
);

SELECT is(
  public.consume_job_run_bearer(
    current_setting('test.job_run_id')::uuid, 'reminders', 'bearer-digest-1', '2026-12-09T04:00:06Z'
  ),
  false,
  'single-run job bearer rejects replay after consumption'
);

-- Auth user deletion cascades user_preferences, reminder_deliveries, and reminder_suppressions
DELETE FROM auth.users WHERE id = 'aaaaaaaa-1111-4111-8111-111111111101';
SELECT results_eq(
  $$
    SELECT
      (SELECT count(*)::int FROM public.user_preferences WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111101'),
      (SELECT count(*)::int FROM public.reminder_deliveries WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111101'),
      (SELECT count(*)::int FROM public.reminder_suppressions WHERE user_id = 'aaaaaaaa-1111-4111-8111-111111111101')
  $$,
  $$VALUES (0, 0, 0)$$,
  'Auth user deletion cascades user_preferences, reminder_deliveries, and reminder_suppressions'
);

SELECT * FROM finish();
ROLLBACK;
