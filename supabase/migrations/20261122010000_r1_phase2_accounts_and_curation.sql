-- =============================================================================
-- Tech Event Discover · R1-MUST Phase 2 Migration: Accounts, Tracking & Curation
-- Tier: R1-MUST ONLY. No R2-MUST or LATER-HARDENING relations, columns, or jobs.
-- =============================================================================

BEGIN;

-- 1. Atomic Fixed-Window Rate Limit Bucket Consumer
CREATE OR REPLACE FUNCTION private.consume_rate_limit_bucket(
  p_scope text,
  p_key_digest text,
  p_window_seconds integer,
  p_limit integer,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_epoch bigint;
  v_window_start_epoch bigint;
  v_window_start timestamptz;
  v_new_count integer;
  v_retry integer;
BEGIN
  v_epoch := pg_catalog.floor(pg_catalog.extract(epoch FROM p_now))::bigint;
  v_window_start_epoch := (v_epoch / p_window_seconds) * p_window_seconds;
  v_window_start := pg_catalog.to_timestamp(v_window_start_epoch);

  INSERT INTO public.rate_limit_buckets (scope, key_digest, window_start, count)
  VALUES (p_scope, p_key_digest, v_window_start, 1)
  ON CONFLICT (scope, key_digest, window_start)
  DO UPDATE SET count = public.rate_limit_buckets.count + 1
  RETURNING public.rate_limit_buckets.count INTO v_new_count;

  v_retry := GREATEST(1, (v_window_start_epoch + p_window_seconds - v_epoch)::integer);

  RETURN QUERY SELECT (v_new_count <= p_limit), v_new_count, v_retry;
END;
$$;

REVOKE ALL ON FUNCTION private.consume_rate_limit_bucket(text, text, integer, integer, timestamptz) FROM PUBLIC;

-- 2. Title Normalization for Duplicate Detection (NFKC-compatible lowercase, punctuation to space, collapsed whitespace)
CREATE OR REPLACE FUNCTION public.normalize_event_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.lower(COALESCE(p_title, '')),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

-- 3. Account Admission (18+ Self-Attestation) & Deletion Tombstone RPCs
CREATE OR REPLACE FUNCTION public.record_adult_attestation(
  p_confirmed_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_recorded timestamptz;
  v_deletion timestamptz;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: verified session required to record attestation'
      USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.deleted_accounts da WHERE da.user_id = v_uid) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED: account deletion is already recorded'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.account_controls (user_id, adult_confirmed_at, deletion_requested_at)
  VALUES (v_uid, COALESCE(p_confirmed_at, now()), NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET adult_confirmed_at = COALESCE(public.account_controls.adult_confirmed_at, EXCLUDED.adult_confirmed_at)
  RETURNING public.account_controls.adult_confirmed_at, public.account_controls.deletion_requested_at
  INTO v_recorded, v_deletion;

  IF v_deletion IS NOT NULL THEN
    RAISE EXCEPTION 'DELETION_PENDING: ordinary writes are blocked while deletion is pending'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_recorded;
END;
$$;

REVOKE ALL ON FUNCTION public.record_adult_attestation(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_adult_attestation(timestamptz) TO authenticated, service_role;

-- Dedicated deletion initiation & tombstone persistence (idempotent for partial deletion retry)
CREATE OR REPLACE FUNCTION public.mark_account_deletion_pending(
  p_user_id uuid DEFAULT NULL,
  p_requested_at timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_uid uuid;
  v_ts timestamptz;
BEGIN
  v_target_uid := COALESCE((SELECT auth.uid()), p_user_id);
  IF v_target_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: user UUID required for deletion'
      USING ERRCODE = '28000';
  END IF;

  -- If called by an authenticated session, target must match auth.uid()
  IF (SELECT auth.uid()) IS NOT NULL AND p_user_id IS NOT NULL AND p_user_id <> (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: cannot initiate deletion for another user'
      USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(p_requested_at, now());

  INSERT INTO public.deleted_accounts (user_id, requested_at)
  VALUES (v_target_uid, v_ts)
  ON CONFLICT (user_id) DO UPDATE
    SET requested_at = LEAST(public.deleted_accounts.requested_at, EXCLUDED.requested_at)
  RETURNING public.deleted_accounts.requested_at INTO v_ts;

  INSERT INTO public.account_controls (user_id, adult_confirmed_at, deletion_requested_at)
  VALUES (v_target_uid, NULL, v_ts)
  ON CONFLICT (user_id) DO UPDATE
    SET deletion_requested_at = COALESCE(public.account_controls.deletion_requested_at, v_ts);

  RETURN v_ts;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_account_deletion_pending(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_account_deletion_pending(uuid, timestamptz) TO authenticated, service_role;

-- 4. Member Tracking Mutation RPC (Ordered State Table + Advisory Lock + Rate Limit)
CREATE OR REPLACE FUNCTION public.set_user_event_tracking(
  p_event_id uuid,
  p_state text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  http_status integer,
  error_code text,
  resulting_state text,
  was_updated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_allowed boolean;
  v_existing_state text;
  v_event_status public.event_status;
  v_eff_end timestamptz;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 401, 'UNAUTHENTICATED'::text, NULL::text, false;
    RETURN;
  END IF;

  IF NOT private.is_user_eligible(v_uid) THEN
    RETURN QUERY SELECT 403, 'FORBIDDEN'::text, NULL::text, false;
    RETURN;
  END IF;

  IF p_state IS NULL OR p_state NOT IN ('saved', 'registered', 'none') THEN
    RETURN QUERY SELECT 400, 'INVALID_REQUEST'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Enforce 30 member mutations per user per minute
  SELECT rl.allowed INTO v_allowed
  FROM private.consume_rate_limit_bucket('member_mutation', v_uid::text, 60, 30, p_now) rl;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN QUERY SELECT 429, 'RATE_LIMITED'::text, NULL::text, false;
    RETURN;
  END IF;

  -- Serialize competing mutations for (user_id, event_id), including creation when no row exists
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('user_events:' || v_uid::text || ':' || COALESCE(p_event_id::text, ''))
  );

  SELECT ue.state
    INTO v_existing_state
    FROM public.user_events ue
   WHERE ue.user_id = v_uid
     AND ue.event_id = p_event_id
   FOR UPDATE;

  -- Rule 1: `none` -> 200. Delete caller's row if present.
  IF p_state = 'none' THEN
    IF v_existing_state IS NOT NULL THEN
      DELETE FROM public.user_events
       WHERE user_id = v_uid
         AND event_id = p_event_id;
      RETURN QUERY SELECT 200, NULL::text, NULL::text, true;
    ELSE
      RETURN QUERY SELECT 200, NULL::text, NULL::text, false;
    END IF;
    RETURN;
  END IF;

  -- Rule 2: Exact repeat of caller's existing Saved or Registered state -> 200 with NO tracking-row update,
  -- irrespective of event status (even if ended, canceled, draft, or archived).
  IF v_existing_state = p_state THEN
    RETURN QUERY SELECT 200, NULL::text, v_existing_state, false;
    RETURN;
  END IF;

  -- Look up current event status and effective end
  SELECT
    e.status,
    public.event_effective_end_at(e.is_all_day, e.starts_at, e.ends_at, e.start_on, e.end_on, e.event_timezone)
  INTO v_event_status, v_eff_end
  FROM public.events e
  WHERE e.id = p_event_id;

  -- Rule 3: New or changed state, published with effective_end_at > p_now -> 200 and apply change.
  IF v_event_status = 'published' AND v_eff_end > p_now THEN
    INSERT INTO public.user_events (user_id, event_id, state, created_at, updated_at)
    VALUES (v_uid, p_event_id, p_state, p_now, p_now)
    ON CONFLICT (user_id, event_id)
    DO UPDATE SET
      state = EXCLUDED.state,
      updated_at = p_now;

    RETURN QUERY SELECT 200, NULL::text, p_state, true;
    RETURN;
  END IF;

  -- Rule 4: New or changed state, ended or canceled -> 409 EVENT_INACTIVE.
  IF v_event_status = 'canceled' OR (v_event_status = 'published' AND v_eff_end <= p_now) THEN
    RETURN QUERY SELECT 409, 'EVENT_INACTIVE'::text, v_existing_state, false;
    RETURN;
  END IF;

  -- Rule 5: New or changed state, draft, archived, or unknown -> 404. Preserve any existing row.
  RETURN QUERY SELECT 404, 'NOT_FOUND'::text, v_existing_state, false;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_event_tracking(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_event_tracking(uuid, text, timestamptz) TO authenticated;

-- 5. Curator Authorization Guard (Requires eligible UID + verified JWT aal='aal2' + active curator_access)
CREATE OR REPLACE FUNCTION private.require_active_aal2_curator(
  p_is_mutation boolean DEFAULT true,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_aal text;
  v_allowed boolean;
BEGIN
  v_uid := (SELECT auth.uid());
  v_aal := COALESCE((SELECT auth.jwt()->>'aal'), '');

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CURATOR_UNAUTHENTICATED: session required'
      USING ERRCODE = '28000';
  END IF;

  IF NOT private.is_user_eligible(v_uid) THEN
    RAISE EXCEPTION 'CURATOR_FORBIDDEN: account is not eligible'
      USING ERRCODE = '42501';
  END IF;

  IF v_aal <> 'aal2' THEN
    RAISE EXCEPTION 'CURATOR_AAL2_REQUIRED: verified TOTP aal2 session required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.curator_access ca
    WHERE ca.user_id = v_uid
      AND ca.active = true
  ) THEN
    RAISE EXCEPTION 'CURATOR_ACCESS_DENIED: active curator_access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_mutation THEN
    -- Enforce 20 curator mutations per curator per minute
    SELECT rl.allowed INTO v_allowed
    FROM private.consume_rate_limit_bucket('curator_mutation', v_uid::text, 60, 20, p_now) rl;

    IF NOT COALESCE(v_allowed, false) THEN
      RAISE EXCEPTION 'RATE_LIMITED: curator mutation rate limit exceeded'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION private.require_active_aal2_curator(boolean, timestamptz) FROM PUBLIC;

-- 6. Guarded Curator Session RPCs (create, edit, source, status transitions, read, duplicate warning)

-- 6.1 Curator create draft event
CREATE OR REPLACE FUNCTION public.curator_create_event(
  p_title text,
  p_organizer text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_event_type public.event_type DEFAULT 'other',
  p_mode public.event_mode DEFAULT 'online',
  p_price_status public.price_status DEFAULT 'unknown',
  p_city_id uuid DEFAULT NULL,
  p_venue text DEFAULT NULL,
  p_online_india_access_confirmed boolean DEFAULT false,
  p_event_timezone text DEFAULT 'Asia/Kolkata',
  p_is_all_day boolean DEFAULT false,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_start_on date DEFAULT NULL,
  p_end_on date DEFAULT NULL,
  p_registration_deadline_at timestamptz DEFAULT NULL,
  p_registration_deadline_on date DEFAULT NULL,
  p_reason_code text DEFAULT 'draft_created',
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_event_id uuid;
BEGIN
  v_actor := private.require_active_aal2_curator(true, p_now);

  INSERT INTO public.events (
    status, version, title, organizer, summary, event_type, mode, price_status,
    city_id, venue, online_india_access_confirmed, event_timezone, is_all_day,
    starts_at, ends_at, start_on, end_on,
    registration_deadline_at, registration_deadline_on, registration_closed,
    created_at, updated_at
  )
  VALUES (
    'draft', 1, p_title, p_organizer, p_summary, p_event_type, p_mode, COALESCE(p_price_status, 'unknown'),
    p_city_id, p_venue, COALESCE(p_online_india_access_confirmed, false), p_event_timezone, p_is_all_day,
    p_starts_at, p_ends_at, p_start_on, p_end_on,
    p_registration_deadline_at, p_registration_deadline_on, false,
    p_now, p_now
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.curator_audit (
    actor_id, target_id, action, prior_version, new_version, recorded_at, reason_code, archived_url_keys
  )
  VALUES (
    v_actor, v_event_id::text, 'create', NULL, 1, p_now, COALESCE(pg_catalog.nullif(pg_catalog.btrim(p_reason_code), ''), 'draft_created'), '{}'::text[]
  );

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.curator_create_event(
  text, text, text, public.event_type, public.event_mode, public.price_status,
  uuid, text, boolean, text, boolean, timestamptz, timestamptz, date, date,
  timestamptz, date, text, timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.curator_create_event(
  text, text, text, public.event_type, public.event_mode, public.price_status,
  uuid, text, boolean, text, boolean, timestamptz, timestamptz, date, date,
  timestamptz, date, text, timestamptz
) TO authenticated;

-- 6.2 Curator edit event metadata (optimistic version check)
CREATE OR REPLACE FUNCTION public.curator_edit_event(
  p_event_id uuid,
  p_expected_version bigint,
  p_title text,
  p_organizer text,
  p_summary text,
  p_event_type public.event_type,
  p_mode public.event_mode,
  p_price_status public.price_status,
  p_city_id uuid,
  p_venue text,
  p_online_india_access_confirmed boolean,
  p_event_timezone text,
  p_is_all_day boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_start_on date,
  p_end_on date,
  p_registration_deadline_at timestamptz,
  p_registration_deadline_on date,
  p_registration_closed boolean DEFAULT false,
  p_reason_code text DEFAULT 'metadata_edited',
  p_now timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_current_version bigint;
  v_current_status public.event_status;
  v_new_version bigint;
BEGIN
  v_actor := private.require_active_aal2_curator(true, p_now);

  SELECT e.version, e.status
    INTO v_current_version, v_current_status
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF v_current_version IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: event % does not exist', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'archived' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: archived events cannot be edited'
      USING ERRCODE = '23514';
  END IF;

  IF v_current_version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: expected version %, found %', p_expected_version, v_current_version
      USING ERRCODE = '40001';
  END IF;

  v_new_version := v_current_version + 1;

  UPDATE public.events
     SET version = v_new_version,
         title = p_title,
         organizer = p_organizer,
         summary = p_summary,
         event_type = p_event_type,
         mode = p_mode,
         price_status = COALESCE(p_price_status, 'unknown'),
         city_id = p_city_id,
         venue = p_venue,
         online_india_access_confirmed = COALESCE(p_online_india_access_confirmed, false),
         event_timezone = p_event_timezone,
         is_all_day = p_is_all_day,
         starts_at = p_starts_at,
         ends_at = p_ends_at,
         start_on = p_start_on,
         end_on = p_end_on,
         registration_deadline_at = p_registration_deadline_at,
         registration_deadline_on = p_registration_deadline_on,
         registration_closed = COALESCE(p_registration_closed, false),
         updated_at = p_now
   WHERE id = p_event_id;

  INSERT INTO public.curator_audit (
    actor_id, target_id, action, prior_version, new_version, recorded_at, reason_code, archived_url_keys
  )
  VALUES (
    v_actor, p_event_id::text, 'edit', v_current_version, v_new_version, p_now,
    COALESCE(pg_catalog.nullif(pg_catalog.btrim(p_reason_code), ''), 'metadata_edited'),
    '{}'::text[]
  );

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.curator_edit_event(
  uuid, bigint, text, text, text, public.event_type, public.event_mode, public.price_status,
  uuid, text, boolean, text, boolean, timestamptz, timestamptz, date, date,
  timestamptz, date, boolean, text, timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.curator_edit_event(
  uuid, bigint, text, text, text, public.event_type, public.event_mode, public.price_status,
  uuid, text, boolean, text, boolean, timestamptz, timestamptz, date, date,
  timestamptz, date, boolean, text, timestamptz
) TO authenticated;

-- 6.3 Curator upsert event source link (checks url_key conflict & bumps event version)
CREATE OR REPLACE FUNCTION public.curator_set_event_source(
  p_event_id uuid,
  p_expected_version bigint,
  p_source_slug text,
  p_public_url text,
  p_url_key text,
  p_is_primary boolean DEFAULT true,
  p_reason_code text DEFAULT 'source_updated',
  p_now timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_current_version bigint;
  v_current_status public.event_status;
  v_conflicting_event_id uuid;
  v_new_version bigint;
BEGIN
  v_actor := private.require_active_aal2_curator(true, p_now);

  SELECT e.version, e.status
    INTO v_current_version, v_current_status
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF v_current_version IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: event % does not exist', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'archived' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: cannot modify sources on an archived event'
      USING ERRCODE = '23514';
  END IF;

  IF v_current_version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: expected version %, found %', p_expected_version, v_current_version
      USING ERRCODE = '40001';
  END IF;

  -- Check if another live event claims this url_key
  SELECT es.event_id
    INTO v_conflicting_event_id
    FROM public.event_sources es
   WHERE es.url_key = p_url_key
     AND es.event_id <> p_event_id;

  IF v_conflicting_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'SOURCE_URL_CONFLICT: url_key is already claimed by event %', v_conflicting_event_id
      USING ERRCODE = '23505';
  END IF;

  IF p_is_primary THEN
    UPDATE public.event_sources
       SET is_primary = false,
           updated_at = p_now
     WHERE event_id = p_event_id
       AND url_key <> p_url_key
       AND is_primary = true;
  END IF;

  -- Idempotent on same event
  INSERT INTO public.event_sources (
    event_id, source_slug, public_url, url_key, is_primary, verified_at, created_at, updated_at
  )
  VALUES (
    p_event_id, p_source_slug, p_public_url, p_url_key, p_is_primary, p_now, p_now, p_now
  )
  ON CONFLICT (url_key)
  DO UPDATE SET
    source_slug = EXCLUDED.source_slug,
    public_url = EXCLUDED.public_url,
    is_primary = EXCLUDED.is_primary,
    verified_at = p_now,
    updated_at = p_now
  WHERE public.event_sources.event_id = p_event_id;

  v_new_version := v_current_version + 1;

  UPDATE public.events
     SET version = v_new_version,
         updated_at = p_now
   WHERE id = p_event_id;

  INSERT INTO public.curator_audit (
    actor_id, target_id, action, prior_version, new_version, recorded_at, reason_code, archived_url_keys
  )
  VALUES (
    v_actor, p_event_id::text, 'source', v_current_version, v_new_version, p_now,
    COALESCE(pg_catalog.nullif(pg_catalog.btrim(p_reason_code), ''), 'source_updated'),
    '{}'::text[]
  );

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.curator_set_event_source(
  uuid, bigint, text, text, text, boolean, text, timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.curator_set_event_source(
  uuid, bigint, text, text, text, boolean, text, timestamptz
) TO authenticated;

-- 6.4 Curator Event State Machine Transition RPC (publish, unpublish, cancel, reinstate, archive)
CREATE OR REPLACE FUNCTION public.curator_transition_event_status(
  p_event_id uuid,
  p_expected_version bigint,
  p_action text,
  p_cancellation_reason public.cancellation_reason DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_event public.events%ROWTYPE;
  v_eff_end timestamptz;
  v_target_status public.event_status;
  v_new_version bigint;
  v_archived_keys text[];
BEGIN
  v_actor := private.require_active_aal2_curator(true, p_now);

  SELECT e.*
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: event % does not exist', p_event_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event.version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: expected version %, found %', p_expected_version, v_event.version
      USING ERRCODE = '40001';
  END IF;

  -- Validate permitted transitions per Event State Machine table in ARCHITECTURE.md
  IF p_action = 'publish' THEN
    IF v_event.status <> 'draft' THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: publish is only allowed from draft (current: %)', v_event.status
        USING ERRCODE = '23514';
    END IF;
    v_target_status := 'published';

  ELSIF p_action = 'unpublish' THEN
    IF v_event.status <> 'published' THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: unpublish is only allowed from published (current: %)', v_event.status
        USING ERRCODE = '23514';
    END IF;
    v_target_status := 'draft';

  ELSIF p_action = 'cancel' THEN
    IF v_event.status <> 'published' THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: cancel is only allowed from published (current: %)', v_event.status
        USING ERRCODE = '23514';
    END IF;
    IF p_cancellation_reason IS NULL THEN
      RAISE EXCEPTION 'INVALID_REQUEST: cancellation_reason is required when canceling an event'
        USING ERRCODE = '22023';
    END IF;
    v_target_status := 'canceled';

  ELSIF p_action = 'reinstate' THEN
    IF v_event.status <> 'canceled' THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: reinstate is only allowed from canceled (current: %)', v_event.status
        USING ERRCODE = '23514';
    END IF;
    v_target_status := 'published';

  ELSIF p_action = 'archive' THEN
    IF v_event.status NOT IN ('draft', 'published', 'canceled') THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: archive is not allowed from %', v_event.status
        USING ERRCODE = '23514';
    END IF;
    v_target_status := 'archived';

  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION: unsupported transition action %', p_action
      USING ERRCODE = '22023';
  END IF;

  -- Publication & Reinstatement active-window check (effective_end_at > p_now)
  IF v_target_status = 'published' THEN
    v_eff_end := public.event_effective_end_at(
      v_event.is_all_day,
      v_event.starts_at,
      v_event.ends_at,
      v_event.start_on,
      v_event.end_on,
      v_event.event_timezone
    );

    IF v_eff_end IS NULL OR v_eff_end <= p_now THEN
      RAISE EXCEPTION 'EVENT_INACTIVE: cannot publish or reinstate an event whose effective end is not in the future'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.event_sources es
      WHERE es.event_id = p_event_id
        AND es.is_primary = true
    ) THEN
      RAISE EXCEPTION 'MISSING_PRIMARY_SOURCE: published event requires one primary source link'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_new_version := v_event.version + 1;
  v_archived_keys := '{}'::text[];

  -- Archive snapshots every normalized url_key into curator_audit.archived_url_keys
  -- before deleting event_sources rows in the same transaction
  IF v_target_status = 'archived' THEN
    SELECT COALESCE(pg_catalog.array_agg(es.url_key ORDER BY es.url_key), '{}'::text[])
      INTO v_archived_keys
      FROM public.event_sources es
     WHERE es.event_id = p_event_id;

    DELETE FROM public.event_sources
     WHERE event_id = p_event_id;
  END IF;

  UPDATE public.events
     SET status = v_target_status,
         version = v_new_version,
         canceled_at = CASE WHEN v_target_status = 'canceled' THEN p_now ELSE NULL END,
         cancellation_reason = CASE WHEN v_target_status = 'canceled' THEN p_cancellation_reason ELSE NULL END,
         updated_at = p_now
   WHERE id = p_event_id;

  INSERT INTO public.curator_audit (
    actor_id, target_id, action, prior_version, new_version, recorded_at, reason_code, archived_url_keys
  )
  VALUES (
    v_actor,
    p_event_id::text,
    p_action,
    v_event.version,
    v_new_version,
    p_now,
    COALESCE(pg_catalog.nullif(pg_catalog.btrim(p_reason_code), ''), p_action),
    v_archived_keys
  );

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.curator_transition_event_status(
  uuid, bigint, text, public.cancellation_reason, text, timestamptz
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.curator_transition_event_status(
  uuid, bigint, text, public.cancellation_reason, text, timestamptz
) TO authenticated;

-- 6.5 Guarded Curator Near-Duplicate Warning Check (trigram similarity >= 0.65, starts within 24h, same city or both online)
CREATE OR REPLACE FUNCTION public.curator_find_near_duplicates(
  p_title text,
  p_effective_start_at timestamptz,
  p_mode public.event_mode,
  p_city_id uuid DEFAULT NULL,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  status public.event_status,
  similarity_score real,
  effective_start_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm_candidate text;
BEGIN
  PERFORM private.require_active_aal2_curator(false, now());
  v_norm_candidate := public.normalize_event_title(p_title);

  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.status,
    extensions.similarity(public.normalize_event_title(e.title), v_norm_candidate) AS similarity_score,
    public.event_effective_start_at(e.is_all_day, e.starts_at, e.start_on, e.event_timezone) AS effective_start_at
  FROM public.events e
  WHERE e.status IN ('draft', 'published', 'canceled')
    AND (p_exclude_event_id IS NULL OR e.id <> p_exclude_event_id)
    AND extensions.similarity(public.normalize_event_title(e.title), v_norm_candidate) >= 0.65
    AND pg_catalog.abs(
      pg_catalog.extract(
        epoch FROM (
          public.event_effective_start_at(e.is_all_day, e.starts_at, e.start_on, e.event_timezone)
          - p_effective_start_at
        )
      )
    ) <= 86400
    AND (
      (p_mode = 'online' AND e.mode = 'online')
      OR (p_city_id IS NOT NULL AND e.city_id = p_city_id)
    )
  ORDER BY similarity_score DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.curator_find_near_duplicates(
  text, timestamptz, public.event_mode, uuid, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.curator_find_near_duplicates(
  text, timestamptz, public.event_mode, uuid, uuid
) TO authenticated;

COMMIT;
