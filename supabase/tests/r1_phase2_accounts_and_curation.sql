-- =============================================================================
-- Tech Event Discover · Phase 2 pgTAP Verification Suite
-- Covers required Phase 2 tests:
--   - archive_releases_url_and_preserves_tracking (plus archived_url_keys & concurrent reclaim)
--   - unpublish_hides_and_reserves_url
--   - canceled_repeat_returns_200_without_update
--   - ended_repeat_returns_200_without_update
--   - new_tracking_on_canceled_returns_409
--   - deletion_keeps_tombstone (including partial deletion retry)
--   - curator_every_mutation_requires_aal2 (create/edit/source/publish/unpublish/cancel/reinstate/archive)
--   - curator_revocation_denies_next_request
--   - denied writes for unattested UID
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(27);

-- Clean fixture tables inside rolled-back test transaction
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

-- Seed reference city & approved source
INSERT INTO public.cities (id, slug, name, state, center)
VALUES (
  '11111111-1111-4111-8111-111111111101',
  'bengaluru',
  'Bengaluru',
  'Karnataka',
  extensions.ST_SetSRID(extensions.ST_MakePoint(77.5946, 12.9716), 4326)::extensions.geography
);

INSERT INTO public.sources (
  slug, display_name, attribution_text, permission_basis, evidence_ref,
  allowed_fields, reviewed_on, permission_status
)
VALUES (
  'foss-united',
  'FOSS United',
  'Listed via FOSS United',
  'Written permission',
  'ref-foss-1',
  ARRAY['title', 'url'],
  '2026-11-22',
  'approved'
);

-- Seed users: curator, member A (eligible), member B (unattested)
INSERT INTO auth.users (id, email)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', 'curator@example.org'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', 'member@example.org'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03', 'unattested@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.account_controls (user_id, adult_confirmed_at, deletion_requested_at)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', '2026-11-22T10:00:00Z', NULL),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02', '2026-11-22T10:00:00Z', NULL),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03', NULL, NULL);

INSERT INTO public.curator_access (user_id, active)
VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01', true);

-- =============================================================================
-- TEST GROUP 1: curator_every_mutation_requires_aal2
-- Verify every curator mutation (create, edit, source, publish, unpublish,
-- cancel, reinstate, archive) fails at aal1 and succeeds at aal2
-- =============================================================================
SET LOCAL ROLE authenticated;

-- 1.1 Set aal1 session for active curator -> create fails
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal1"}',
  true
);

SELECT throws_ok(
  $$SELECT public.curator_create_event('AAL1 Rejected Draft', 'Org A')$$,
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: create denied at aal1'
);

-- 1.2 Upgrade to aal2 -> create succeeds
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

SELECT lives_ok(
  $$
    SELECT set_config(
      'test.event_id',
      public.curator_create_event(
        'Initial Draft Event',
        'FOSS United',
        'Summary v1',
        'hackathon',
        'online',
        'free',
        NULL,
        NULL,
        true,
        'Asia/Kolkata',
        false,
        '2026-12-10T10:00:00Z'::timestamptz,
        '2026-12-10T14:00:00Z'::timestamptz,
        NULL,
        NULL,
        '2026-12-08T10:00:00Z'::timestamptz,
        NULL,
        'draft_created',
        '2026-12-01T10:00:00Z'::timestamptz
      )::text,
      true
    )
  $$,
  'curator_every_mutation_requires_aal2: create succeeds at aal2'
);

-- 1.3 Downgrade to aal1 -> edit, source, and publish all denied
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal1"}',
  true
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_edit_event(%L::uuid, 1, 'Edited', 'FOSS United', 'Sum', 'hackathon', 'online', 'free', NULL, NULL, true, 'Asia/Kolkata', false, '2026-12-10T10:00:00Z', '2026-12-10T14:00:00Z', NULL, NULL, NULL, NULL)$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: edit denied at aal1'
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_set_event_source(%L::uuid, 1, 'foss-united', 'https://fossunited.org/events/p2-1', 'https://fossunited.org/events/p2-1', true)$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: source denied at aal1'
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_transition_event_status(%L::uuid, 1, 'publish')$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: publish denied at aal1'
);

-- 1.4 At aal2 -> edit (v1->v2), source (v2->v3), publish (v3->v4) succeed
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

SELECT is(
  public.curator_edit_event(
    current_setting('test.event_id')::uuid,
    1,
    'Published Hackathon Title',
    'FOSS United',
    'Updated summary',
    'hackathon',
    'online',
    'free',
    NULL,
    NULL,
    true,
    'Asia/Kolkata',
    false,
    '2026-12-10T10:00:00Z'::timestamptz,
    '2026-12-10T14:00:00Z'::timestamptz,
    NULL,
    NULL,
    '2026-12-08T10:00:00Z'::timestamptz,
    NULL,
    false,
    'metadata_edited',
    '2026-12-01T10:05:00Z'::timestamptz
  ),
  2::bigint,
  'curator_every_mutation_requires_aal2: edit increments version to 2 at aal2'
);

SELECT is(
  public.curator_set_event_source(
    current_setting('test.event_id')::uuid,
    2,
    'foss-united',
    'https://fossunited.org/events/p2-1',
    'https://fossunited.org/events/p2-1',
    true,
    'source_added',
    '2026-12-01T10:06:00Z'::timestamptz
  ),
  3::bigint,
  'curator_every_mutation_requires_aal2: source increments version to 3 at aal2'
);

SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    3,
    'publish',
    NULL,
    'initial_publish',
    '2026-12-01T10:07:00Z'::timestamptz
  ),
  4::bigint,
  'curator_every_mutation_requires_aal2: publish increments version to 4 at aal2'
);

-- 1.5 Check aal1 denial on unpublish, cancel, reinstate, archive
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal1"}',
  true
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_transition_event_status(%L::uuid, 4, 'unpublish')$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: unpublish denied at aal1'
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_transition_event_status(%L::uuid, 4, 'cancel', 'organizer_canceled')$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: cancel denied at aal1'
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_transition_event_status(%L::uuid, 4, 'archive')$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: archive denied at aal1'
);

-- =============================================================================
-- TEST GROUP 2: unpublish_hides_and_reserves_url
-- =============================================================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

-- Eligible member tracks the published event as 'saved' before unpublish
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02","role":"authenticated"}',
  true
);

SELECT is(
  (
    SELECT http_status
    FROM public.set_user_event_tracking(
      current_setting('test.event_id')::uuid,
      'saved',
      '2026-12-01T10:08:00Z'::timestamptz
    )
  ),
  200,
  'eligible member tracks active published event as saved (200)'
);

-- Unattested UID is denied tracking write even with direct Auth token
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03","role":"authenticated"}',
  true
);

SELECT is(
  (
    SELECT http_status
    FROM public.set_user_event_tracking(
      current_setting('test.event_id')::uuid,
      'saved',
      '2026-12-01T10:08:30Z'::timestamptz
    )
  ),
  403,
  'denied writes for unattested UID: set_user_event_tracking returns 403 FORBIDDEN'
);

-- Curator unpublishes to draft (v4 -> v5)
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    4,
    'unpublish',
    NULL,
    'unpublish_to_draft',
    '2026-12-01T10:09:00Z'::timestamptz
  ),
  5::bigint,
  'unpublish_hides_and_reserves_url: unpublish transitions published -> draft (v5)'
);

-- Competing draft event cannot claim the unpublished draft's reserved URL
SELECT set_config(
  'test.competing_event_id',
  public.curator_create_event('Competing Event', 'Org B')::text,
  true
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_set_event_source(%L::uuid, 1, 'foss-united', 'https://fossunited.org/events/p2-1', 'https://fossunited.org/events/p2-1', true)$$,
    current_setting('test.competing_event_id')
  ),
  '23505',
  NULL,
  'unpublish_hides_and_reserves_url: unpublished draft still reserves url_key against competing events (SOURCE_URL_CONFLICT)'
);

-- =============================================================================
-- TEST GROUP 3: Cancel, Reinstate, and Tracking State Machine Rules
--   - canceled_repeat_returns_200_without_update
--   - new_tracking_on_canceled_returns_409
--   - ended_repeat_returns_200_without_update
-- =============================================================================
-- Republish first event (v5 -> v6) then cancel (v6 -> v7)
SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    5,
    'publish',
    NULL,
    'republish',
    '2026-12-01T10:10:00Z'::timestamptz
  ),
  6::bigint,
  'republish draft -> published (v6)'
);

SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    6,
    'cancel',
    'organizer_canceled',
    'organizer_canceled_notice',
    '2026-12-01T10:11:00Z'::timestamptz
  ),
  7::bigint,
  'curator_every_mutation_requires_aal2: cancel transitions published -> canceled (v7)'
);

-- Verify reinstate denied at aal1
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal1"}',
  true
);

SELECT throws_ok(
  format(
    $$SELECT public.curator_transition_event_status(%L::uuid, 7, 'reinstate')$$,
    current_setting('test.event_id')
  ),
  '42501',
  NULL,
  'curator_every_mutation_requires_aal2: reinstate denied at aal1'
);

-- Member A (who already saved the event) repeats 'saved' on the canceled event -> 200 without update!
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02","role":"authenticated"}',
  true
);

SELECT results_eq(
  format(
    $$SELECT http_status, was_updated FROM public.set_user_event_tracking(%L::uuid, 'saved', '2026-12-01T10:12:00Z'::timestamptz)$$,
    current_setting('test.event_id')
  ),
  $$VALUES (200, false)$$,
  'canceled_repeat_returns_200_without_update: exact repeat of saved state on canceled event returns 200 without update'
);

-- Changing state from 'saved' to 'registered' on canceled event -> 409 EVENT_INACTIVE!
SELECT results_eq(
  format(
    $$SELECT http_status, error_code FROM public.set_user_event_tracking(%L::uuid, 'registered', '2026-12-01T10:13:00Z'::timestamptz)$$,
    current_setting('test.event_id')
  ),
  $$VALUES (409, 'EVENT_INACTIVE'::text)$$,
  'new_tracking_on_canceled_returns_409: changing tracking state on canceled event returns 409 EVENT_INACTIVE'
);

-- Curator reinstates event (v7 -> v8)
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    7,
    'reinstate',
    NULL,
    'reinstated_by_organizer',
    '2026-12-01T10:14:00Z'::timestamptz
  ),
  8::bigint,
  'curator_every_mutation_requires_aal2: reinstate transitions canceled -> published and clears cancellation fields (v8)'
);

-- After event has ended (p_now = 2026-12-11T00:00:00Z > ends_at 2026-12-10T14:00:00Z),
-- repeating existing 'saved' state still returns 200 without update!
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02","role":"authenticated"}',
  true
);

SELECT results_eq(
  format(
    $$SELECT http_status, was_updated FROM public.set_user_event_tracking(%L::uuid, 'saved', '2026-12-11T00:00:00Z'::timestamptz)$$,
    current_setting('test.event_id')
  ),
  $$VALUES (200, false)$$,
  'ended_repeat_returns_200_without_update: exact repeat of existing state on ended event returns 200 without update'
);

-- =============================================================================
-- TEST GROUP 4: archive_releases_url_and_preserves_tracking & curator_revocation_denies_next_request
-- =============================================================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

-- Archive the event (v8 -> v9) and verify sequentially:
-- 1) archive succeeds and increments version to 9
-- 2) competing event can now claim the released url_key (v1 -> v2)
-- 3) archived_url_keys is recorded in private curator_audit & existing user_events row is preserved
SELECT is(
  public.curator_transition_event_status(
    current_setting('test.event_id')::uuid,
    8,
    'archive',
    NULL,
    'archived_after_event',
    '2026-12-01T10:15:00Z'::timestamptz
  ),
  9::bigint,
  'archive_releases_url_and_preserves_tracking: archive transitions published -> archived (v9)'
);

SELECT is(
  public.curator_set_event_source(
    current_setting('test.competing_event_id')::uuid,
    1,
    'foss-united',
    'https://fossunited.org/events/p2-1',
    'https://fossunited.org/events/p2-1',
    true,
    'reclaimed_after_archive',
    '2026-12-01T10:16:00Z'::timestamptz
  ),
  2::bigint,
  'archive_releases_url_and_preserves_tracking: competing event reclaims released url_key after archive'
);

-- Inspect private curator_audit and preserved user_events row as owner role
RESET ROLE;
SELECT results_eq(
  format(
    $$
      SELECT
        (SELECT archived_url_keys FROM public.curator_audit WHERE target_id = %L AND action = 'archive' LIMIT 1),
        (SELECT count(*)::int FROM public.user_events WHERE event_id = %L::uuid)
    $$,
    current_setting('test.event_id'),
    current_setting('test.event_id')
  ),
  $$VALUES (ARRAY['https://fossunited.org/events/p2-1']::text[], 1)$$,
  'archive_releases_url_and_preserves_tracking: archive records archived_url_keys in audit and preserves tracking row'
);

-- Revoke curator_access while JWT session is still aal2 -> next request is denied
UPDATE public.curator_access
   SET active = false,
       updated_at = now()
 WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01","role":"authenticated","aal":"aal2"}',
  true
);

SELECT throws_ok(
  $$SELECT public.curator_create_event('After Revocation', 'Org X')$$,
  '42501',
  NULL,
  'curator_revocation_denies_next_request: revoking curator_access immediately denies the next request on a previously valid aal2 session'
);

-- =============================================================================
-- TEST GROUP 5: deletion_keeps_tombstone (including partial deletion retry & Auth cascade)
-- =============================================================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02","role":"authenticated"}',
  true
);

-- First call marks deletion pending and writes tombstone; second retry call is idempotent;
-- deleting the auth.users row cascades user_events/account_controls while keeping deleted_accounts tombstone!
RESET ROLE;
SELECT public.mark_account_deletion_pending(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'::uuid,
  '2026-12-01T11:00:00Z'::timestamptz
);
-- Partial deletion retry (idempotent)
SELECT public.mark_account_deletion_pending(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'::uuid,
  '2026-12-01T11:05:00Z'::timestamptz
);
DELETE FROM auth.users WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';

SELECT results_eq(
  $$
    SELECT
      (SELECT count(*)::int FROM public.deleted_accounts WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'),
      (SELECT count(*)::int FROM public.user_events WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02'),
      (SELECT count(*)::int FROM public.account_controls WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02')
  $$,
  $$VALUES (1, 0, 0)$$,
  'deletion_keeps_tombstone: deleting Auth user cascades user_events and account_controls while preserving the 35-day deleted_accounts tombstone'
);

SELECT * FROM finish();
ROLLBACK;
