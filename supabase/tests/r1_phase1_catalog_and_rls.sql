-- =============================================================================
-- Tech Event Discover · Phase 1 pgTAP Verification Suite
-- Covers required Phase 1 RLS, visibility, time, geography, and sort invariants
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(19);

-- Clean fixture workspace inside rolled-back test transaction
DELETE FROM public.user_events;
DELETE FROM public.event_sources;
DELETE FROM public.events;
DELETE FROM public.sources;
DELETE FROM public.cities;
DELETE FROM public.account_controls;

-- 1. Seed deterministic test cities
INSERT INTO public.cities (id, slug, name, state, center)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    'bengaluru',
    'Bengaluru',
    'Karnataka',
    extensions.ST_SetSRID(extensions.ST_MakePoint(77.5946, 12.9716), 4326)::extensions.geography
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
    'hosur',
    'Hosur',
    'Tamil Nadu',
    -- ~39 km from Bengaluru (< 50 km cutoff)
    extensions.ST_SetSRID(extensions.ST_MakePoint(77.8253, 12.7409), 4326)::extensions.geography
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
    'mysuru',
    'Mysuru',
    'Karnataka',
    -- ~128 km from Bengaluru (> 50 km cutoff)
    extensions.ST_SetSRID(extensions.ST_MakePoint(76.6394, 12.2958), 4326)::extensions.geography
  );

-- 2. Seed deterministic sources (approved + pending + draft-only approved)
INSERT INTO public.sources (
  slug, display_name, attribution_text, permission_basis, evidence_ref,
  allowed_fields, reviewed_on, permission_status
)
VALUES
  (
    'src-published',
    'Published Source',
    'Credit: Published Source',
    'Written permission',
    'ref-pub-1',
    ARRAY['title', 'url'],
    '2026-11-22',
    'approved'
  ),
  (
    'src-canceled',
    'Canceled Source',
    'Credit: Canceled Source',
    'Written permission',
    'ref-can-1',
    ARRAY['title', 'url'],
    '2026-11-22',
    'approved'
  ),
  (
    'src-draft-only',
    'Draft Only Source',
    'Credit: Draft Only Source',
    'Written permission',
    'ref-drf-1',
    ARRAY['title', 'url'],
    '2026-11-22',
    'approved'
  ),
  (
    'src-pending',
    'Pending Source',
    'Credit: Pending Source',
    NULL,
    NULL,
    '{}'::text[],
    NULL,
    'pending'
  );

-- 3. Seed events in all 4 states + schedule/deadline/distance test cases
-- Base reference clock: 2026-12-01T10:00:00Z (15:30 IST)
INSERT INTO public.events (
  id, status, version, title, organizer, summary, event_type, mode, price_status,
  city_id, venue, online_india_access_confirmed, event_timezone, is_all_day,
  starts_at, ends_at, start_on, end_on,
  registration_deadline_at, registration_deadline_on, registration_closed,
  canceled_at, cancellation_reason
)
VALUES
  -- Draft event
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
    'draft', 1, 'Draft Hackathon', 'Org Draft', 'Hidden draft event',
    'hackathon', 'online', 'free', NULL, NULL, true, 'Asia/Kolkata', false,
    '2026-12-05T10:00:00Z', '2026-12-05T14:00:00Z', NULL, NULL,
    NULL, NULL, false, NULL, NULL
  ),
  -- Published future event in Bengaluru (deadline later: Dec 4)
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
    'published', 1, 'Bengaluru Systems Conference', 'Org BLR', 'Distributed systems conference',
    'conference', 'in_person', 'paid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'BLR Hall', false,
    'Asia/Kolkata', false,
    '2026-12-06T04:00:00Z', '2026-12-06T12:00:00Z', NULL, NULL,
    '2026-12-04T12:00:00Z', NULL, false, NULL, NULL
  ),
  -- Canceled event
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03',
    'canceled', 2, 'Canceled Workshop', 'Org Canceled', 'Was canceled by organizer',
    'workshop', 'online', 'free', NULL, NULL, true, 'Asia/Kolkata', false,
    '2026-12-07T10:00:00Z', '2026-12-07T12:00:00Z', NULL, NULL,
    NULL, NULL, false, '2026-11-25T09:00:00Z', 'organizer_canceled'
  ),
  -- Archived event
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04',
    'archived', 3, 'Archived Meetup', 'Org Archived', 'Archived listing',
    'meetup', 'online', 'free', NULL, NULL, true, 'Asia/Kolkata', false,
    '2026-12-08T10:00:00Z', '2026-12-08T12:00:00Z', NULL, NULL,
    NULL, NULL, false, NULL, NULL
  ),
  -- All-day event: start_on 2026-12-01, end_on 2026-12-02 (exclusive end at 2026-12-02 00:00:00 Asia/Kolkata = 2026-12-01T18:30:00Z)
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05',
    'published', 1, 'All Day Summit', 'Org AllDay', 'One day exclusive end test',
    'seminar', 'in_person', 'free', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 'Hosur Venue', false,
    'Asia/Kolkata', true,
    NULL, NULL, '2026-12-01', '2026-12-02',
    NULL, '2026-12-01', false, NULL, NULL
  ),
  -- Timed event with unknown end starting at 2026-12-01T09:00:00Z (active until 11:00:00Z; ongoing at 10:00:00Z!)
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06',
    'published', 1, 'Ongoing Unknown End Meetup', 'Org Ongoing', 'Timed unknown end 2h window',
    'meetup', 'online', 'unknown', NULL, NULL, true, 'Asia/Kolkata', false,
    '2026-12-01T09:00:00Z', NULL, NULL, NULL,
    NULL, NULL, false, NULL, NULL
  ),
  -- Farther physical event in Mysuru (> 50km from Bengaluru) with earlier exact deadline (Dec 2)
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07',
    'published', 1, 'Mysuru Hackathon', 'Org Mysuru', 'Hackathon in Mysuru',
    'hackathon', 'hybrid', 'free', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03', 'Mysuru Hub', false,
    'Asia/Kolkata', false,
    '2026-12-09T05:00:00Z', '2026-12-09T13:00:00Z', NULL, NULL,
    '2026-12-02T12:00:00Z', NULL, false, NULL, NULL
  );

INSERT INTO public.event_sources (id, event_id, source_slug, public_url, url_key, is_primary)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', 'src-draft-only', 'https://example.org/draft-1', 'https://example.org/draft-1', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc02', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'src-published', 'https://example.org/pub-2', 'https://example.org/pub-2', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc03', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03', 'src-canceled', 'https://example.org/can-3', 'https://example.org/can-3', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc05', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05', 'src-published', 'https://example.org/pub-5', 'https://example.org/pub-5', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc06', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06', 'src-published', 'https://example.org/pub-6', 'https://example.org/pub-6', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc07', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07', 'src-published', 'https://example.org/pub-7', 'https://example.org/pub-7', true);

-- 4. Seed Auth users & account_controls for member A (eligible), member B (eligible),
--    member C (null adult_confirmed_at), member D (deletion_requested_at set)
INSERT INTO auth.users (id, email)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', 'member-a@example.org'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02', 'member-b@example.org'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd03', 'member-unattested@example.org'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd04', 'member-deleting@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.account_controls (user_id, adult_confirmed_at, deletion_requested_at)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', '2026-11-22T10:00:00Z', NULL),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02', '2026-11-22T10:00:00Z', NULL),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd03', NULL, NULL),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd04', '2026-11-22T10:00:00Z', '2026-11-22T12:00:00Z');

INSERT INTO public.user_events (user_id, event_id, state)
VALUES
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'saved'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05', 'registered'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd03', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'saved'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd04', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'saved');

-- =============================================================================
-- TEST 1: rls_public_details_visible_states (anon & authenticated see published+canceled; catalog_reader sees published only)
-- =============================================================================
SET LOCAL ROLE anon;
SELECT results_eq(
  $$SELECT status::text FROM public.events ORDER BY status::text$$,
  ARRAY['canceled', 'published', 'published', 'published', 'published'],
  'rls_public_details_visible_states: anon sees only published and canceled events (draft and archived hidden)'
);

-- City reads for anon
SELECT is(
  (SELECT count(*)::int FROM public.cities),
  3,
  'cities reference data readable by anon'
);

SET LOCAL ROLE catalog_reader;
SELECT results_eq(
  $$SELECT DISTINCT status::text FROM public.events$$,
  ARRAY['published'],
  'rls_search_published_only: catalog_reader role sees strictly published events'
);

SELECT is(
  (SELECT count(*)::int FROM public.cities),
  3,
  'cities reference data readable by catalog_reader'
);

-- =============================================================================
-- TEST 2: rls_sources_follow_parent_visibility & public-only source columns
-- =============================================================================
SET LOCAL ROLE anon;
SELECT results_eq(
  $$SELECT slug FROM public.sources ORDER BY slug$$,
  ARRAY['src-canceled', 'src-published'],
  'rls_sources_follow_parent_visibility: anon sees approved sources linked to published or canceled events only'
);

SELECT throws_ok(
  $$SELECT evidence_ref FROM public.sources$$,
  '42501',
  NULL,
  'private source evidence_ref column is denied to anon'
);

SELECT throws_ok(
  $$SELECT url_key FROM public.event_sources$$,
  '42501',
  NULL,
  'event_sources.url_key column is excluded from public projection'
);

SET LOCAL ROLE catalog_reader;
SELECT results_eq(
  $$SELECT slug FROM public.sources ORDER BY slug$$,
  ARRAY['src-published'],
  'rls_sources_follow_parent_visibility: catalog_reader sees approved sources linked to published events only'
);

-- =============================================================================
-- TEST 3: rls_tracking_is_owner_only (anon, member A, member B, unattested, deletion-pending)
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.user_events$$,
  '42501',
  NULL,
  'rls_tracking_is_owner_only: anon is denied SELECT on user_events'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddd01","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT event_id::text FROM public.user_events$$,
  ARRAY['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02'],
  'rls_tracking_is_owner_only: eligible member A sees only their own tracking row'
);

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddd02","role":"authenticated"}', true);
SELECT results_eq(
  $$SELECT event_id::text FROM public.user_events$$,
  ARRAY['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05'],
  'rls_tracking_is_owner_only: eligible member B sees only their own tracking row'
);

-- Direct Auth session with null adult_confirmed_at is denied by RLS
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddd03","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.user_events),
  0,
  'rls_tracking_is_owner_only: direct Auth session with null adult_confirmed_at sees 0 tracking rows'
);

-- Direct Auth session with deletion_requested_at set is denied by RLS
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddd04","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.user_events),
  0,
  'rls_tracking_is_owner_only: direct Auth session with pending deletion sees 0 tracking rows'
);

RESET ROLE;

-- =============================================================================
-- TEST 4: all_day_exclusive_end
-- =============================================================================
-- Event bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05 is all-day 2026-12-01 to 2026-12-02 in Asia/Kolkata (+05:30).
-- Exclusive end is 2026-12-02 00:00:00+05:30 = 2026-12-01T18:30:00Z.
SELECT is(
  (
    SELECT count(*)::int
    FROM public.search_catalog_discover(p_as_of => '2026-12-01T18:29:59Z'::timestamptz)
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05'
  ),
  1,
  'all_day_exclusive_end: all-day event is active 1 second before local midnight of exclusive end_on'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.search_catalog_discover(p_as_of => '2026-12-01T18:30:00Z'::timestamptz)
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05'
  ),
  0,
  'all_day_exclusive_end: all-day event is inactive at exact local midnight of exclusive end_on'
);

-- =============================================================================
-- TEST 5: unknown_end_is_active_for_two_hours & ongoing_publication_allowed
-- =============================================================================
-- Event bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06 starts at 2026-12-01T09:00:00Z with ends_at IS NULL.
-- Effective end is 2026-12-01T11:00:00Z. At 10:00:00Z it is ongoing and published.
SELECT is(
  (
    SELECT is_ongoing
    FROM public.search_catalog_discover(p_as_of => '2026-12-01T10:59:59Z'::timestamptz)
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06'
  ),
  true,
  'ongoing_publication_allowed & unknown_end_is_active_for_two_hours: active and flagged ongoing within 2h fallback window'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.search_catalog_discover(p_as_of => '2026-12-01T11:00:00Z'::timestamptz)
    WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06'
  ),
  0,
  'unknown_end_is_active_for_two_hours: event with unknown end expires at starts_at + 2 hours'
);

-- =============================================================================
-- TEST 6: nearby_50km_boundary
-- =============================================================================
SELECT results_eq(
  $$
    SELECT id::text
    FROM public.search_catalog_discover(
      p_as_of => '2026-12-01T10:00:00Z'::timestamptz,
      p_city => 'bengaluru',
      p_distance => 'nearby'
    )
    ORDER BY id::text
  $$,
  ARRAY[
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05'
  ],
  'nearby_50km_boundary: nearby Bengaluru returns Bengaluru (0 km) and Hosur (~39 km) physical/hybrid events, excluding Mysuru (~128 km) and online-only'
);

-- =============================================================================
-- TEST 7: deadline_sort_nulls_last
-- =============================================================================
SELECT results_eq(
  $$
    SELECT id::text
    FROM public.search_catalog_discover(
      p_as_of => '2026-12-01T10:00:00Z'::timestamptz,
      p_sort => 'deadline'
    )
  $$,
  ARRAY[
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb07', -- exact deadline 2026-12-02T12:00:00Z
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', -- exact deadline 2026-12-04T12:00:00Z
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05', -- date-only deadline (NULL exact deadline -> NULLS LAST, ordered by eff_start_at 2026-11-30T18:30:00Z)
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06'  -- no deadline (NULLS LAST, ordered by eff_start_at 2026-12-01T09:00:00Z)
  ],
  'deadline_sort_nulls_last: orders future exact open deadlines ascending first, then date-only/missing deadlines NULLS LAST by effective_start_at ASC, id ASC'
);

SELECT * FROM finish();
ROLLBACK;
