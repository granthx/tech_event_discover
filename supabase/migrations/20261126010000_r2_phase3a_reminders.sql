-- =============================================================================
-- Tech Event Discover · R2-MUST Phase 3A: Reminders, Consent, Unsubscribe,
-- Suppressions, Job Runs, and Shared SQL Eligibility Contract
-- Tier: R2-MUST (Phase 3A). Keeps feed_state/feed_items for Phase 3B.
-- =============================================================================

BEGIN;

-- 1. Extend public.events with private reminder_hold column
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_hold boolean NOT NULL DEFAULT false;

-- 2. R2-MUST Phase 3A Relations

-- 2.1 user_preferences (absent row means opt-out; cascades on Auth deletion)
CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_reminders_enabled boolean NOT NULL DEFAULT false,
  consent_version bigint NOT NULL DEFAULT 0 CHECK (consent_version >= 0),
  consent_recorded_at timestamptz,
  consent_notice_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2 job_runs (durable cron dispatch & execution tracking)
CREATE TABLE public.job_runs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  job_name text NOT NULL CHECK (job_name IN ('import', 'reminders')),
  scheduled_at timestamptz NOT NULL,
  dispatch_token_digest text,
  dispatch_token_expires_at timestamptz,
  pg_net_request_id bigint,
  dispatch_status text NOT NULL DEFAULT 'queued'
    CHECK (dispatch_status IN ('queued', 'received', 'error', 'missing')),
  execution_status text NOT NULL DEFAULT 'unclaimed'
    CHECK (execution_status IN ('unclaimed', 'running', 'succeeded', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_name, scheduled_at)
);

CREATE INDEX job_runs_name_status_scheduled_idx
  ON public.job_runs (job_name, execution_status, scheduled_at DESC);

-- 2.3 reminder_deliveries (cascades on Auth deletion; independent of user_events so untracking preserves history)
CREATE TABLE public.reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id),
  kind text NOT NULL CHECK (kind IN ('deadline', 'attendance')),
  target_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'retry', 'accepted', 'expired', 'suppressed', 'failed', 'unknown')),
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz,
  may_have_sent boolean NOT NULL DEFAULT false,
  provider_message_id text,
  pending_payload jsonb,
  unsubscribe_token_digest text,
  unsubscribe_expires_at timestamptz,
  consent_version_at_send bigint,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_deliveries_due_before_expires CHECK (due_at < expires_at),
  UNIQUE (user_id, event_id, kind, target_at)
);

CREATE UNIQUE INDEX reminder_deliveries_provider_message_id_idx
  ON public.reminder_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX reminder_deliveries_due_retry_lease_idx
  ON public.reminder_deliveries (status, due_at, next_attempt_at, lease_until, expires_at);

CREATE INDEX reminder_deliveries_unsubscribe_digest_idx
  ON public.reminder_deliveries (unsubscribe_token_digest)
  WHERE unsubscribe_token_digest IS NOT NULL;

-- 2.4 reminder_suppressions (permanent bounce +90d, complaint +180d; cascades on Auth deletion)
CREATE TABLE public.reminder_suppressions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_digest text NOT NULL CHECK (pg_catalog.btrim(recipient_digest) <> ''),
  reason text NOT NULL CHECK (reason IN ('permanent_bounce', 'complaint')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipient_digest, reason)
);

CREATE INDEX reminder_suppressions_expires_idx
  ON public.reminder_suppressions (user_id, recipient_digest, expires_at);

-- 3. Row Level Security & Narrow Grants (ARCHITECTURE.md)
REVOKE ALL ON public.user_preferences FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.job_runs FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.reminder_deliveries FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.reminder_suppressions FROM PUBLIC, anon, authenticated, catalog_reader;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_suppressions ENABLE ROW LEVEL SECURITY;

-- user_preferences: anon & catalog_reader denied; authenticated USING (owner AND eligible)
GRANT SELECT (
  user_id,
  email_reminders_enabled,
  consent_version,
  consent_recorded_at,
  consent_notice_version,
  created_at,
  updated_at
) ON public.user_preferences TO authenticated;

CREATE POLICY user_preferences_owner_select
  ON public.user_preferences
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
    AND private.is_user_eligible((SELECT auth.uid()))
  );

-- job_runs, reminder_deliveries, reminder_suppressions have NO policies for anon/authenticated/catalog_reader
-- (all direct access denied; accessed strictly via service_role / SECURITY DEFINER worker routines).

-- 4. Private Helper: Keyed Recipient Digest (HMAC-SHA256 of normalized lowercase email)
CREATE OR REPLACE FUNCTION private.compute_recipient_digest(
  p_email text,
  p_digest_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email)), 'UTF8'),
      pg_catalog.convert_to(p_digest_key, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION private.compute_recipient_digest(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.compute_recipient_digest(text, text) TO service_role;

-- Private Helper: Check smoke allowlist match
-- p_smoke_allowlist is a JSONB array of {"userId": "...", "eventId": "...", "kind": "deadline"|"attendance"}
CREATE OR REPLACE FUNCTION private.matches_smoke_allowlist(
  p_delivery_mode text,
  p_smoke_allowlist jsonb,
  p_user_id uuid,
  p_event_id uuid,
  p_kind text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_delivery_mode = 'live' THEN true
    WHEN p_delivery_mode = 'smoke' THEN
      CASE
        WHEN p_smoke_allowlist IS NULL
          OR pg_catalog.jsonb_typeof(p_smoke_allowlist) <> 'array'
          OR pg_catalog.jsonb_array_length(p_smoke_allowlist) = 0
        THEN false
        ELSE EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(p_smoke_allowlist) elem
          WHERE (elem->>'userId') = p_user_id::text
            AND (elem->>'eventId') = p_event_id::text
            AND (elem->>'kind') = p_kind
        )
      END
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.matches_smoke_allowlist(text, jsonb, uuid, uuid, text) FROM PUBLIC;

-- 5. Shared Reminder Eligibility Truth-Table Function (ARCHITECTURE.md lines 64-83)
-- Tested against the exact same ordered machine-readable fixtures as src/features/reminders/eligibility.ts
CREATE OR REPLACE FUNCTION public.evaluate_reminder_eligibility(
  p_tracking_state text,
  p_event_status public.event_status,
  p_opt_in boolean,
  p_reminder_hold boolean,
  p_deletion_pending boolean,
  p_has_verified_recipient boolean,
  p_has_active_suppression boolean,
  p_is_all_day boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_start_on date,
  p_end_on date,
  p_event_timezone text,
  p_registration_deadline_at timestamptz,
  p_registration_deadline_on date,
  p_registration_closed boolean,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  eligible boolean,
  kind text,
  anchor_at timestamptz,
  due_at timestamptz,
  expires_at timestamptz,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eff_start timestamptz;
  v_eff_end timestamptz;
  v_anchor timestamptz;
  v_due timestamptz;
  v_expires timestamptz;
BEGIN
  -- Row 1: None -> Untracked
  IF p_tracking_state IS NULL OR p_tracking_state NOT IN ('saved', 'registered') THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'untracked'::text;
    RETURN;
  END IF;

  -- Row 2: Draft, canceled, archived -> Inactive status
  IF p_event_status IS DISTINCT FROM 'published' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'inactive_status'::text;
    RETURN;
  END IF;

  -- Row 3: Opt-in Off -> Opted out
  IF NOT COALESCE(p_opt_in, false) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'opted_out'::text;
    RETURN;
  END IF;

  -- Row 4: Hold, deletion pending, unverified recipient, or active suppression -> Applicable hold
  IF COALESCE(p_reminder_hold, false)
     OR COALESCE(p_deletion_pending, false)
     OR NOT COALESCE(p_has_verified_recipient, false)
     OR COALESCE(p_has_active_suppression, false)
  THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'applicable_hold'::text;
    RETURN;
  END IF;

  v_eff_start := public.event_effective_start_at(
    p_is_all_day,
    p_starts_at,
    p_start_on,
    p_event_timezone
  );

  v_eff_end := public.event_effective_end_at(
    p_is_all_day,
    p_starts_at,
    p_ends_at,
    p_start_on,
    p_end_on,
    p_event_timezone
  );

  IF v_eff_start IS NULL OR v_eff_end IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'inactive_status'::text;
    RETURN;
  END IF;

  -- Rows 5-9: Saved tracking
  IF p_tracking_state = 'saved' THEN
    -- Row 5: Missing or date-only deadline (date-only is non-exact)
    IF p_registration_deadline_at IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'no_exact_deadline'::text;
      RETURN;
    END IF;

    -- Row 6: Registration closed
    IF COALESCE(p_registration_closed, false) THEN
      RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'registration_closed'::text;
      RETURN;
    END IF;

    v_anchor := p_registration_deadline_at;
    v_due := v_anchor - interval '24 hours';
    v_expires := LEAST(v_anchor, v_eff_end) - interval '15 minutes';

    -- Row 7: Before due
    IF p_now < v_due THEN
      RETURN QUERY SELECT false, 'deadline'::text, v_anchor, v_due, v_expires, 'too_early'::text;
      RETURN;
    END IF;

    -- Row 8: In window (due_at <= p_now AND p_now < expires_at, plus due_at < expires_at)
    IF v_due < v_expires AND p_now < v_expires THEN
      RETURN QUERY SELECT true, 'deadline'::text, v_anchor, v_due, v_expires, NULL::text;
      RETURN;
    END IF;

    -- Row 9: At/after expiry
    RETURN QUERY SELECT false, 'deadline'::text, v_anchor, v_due, v_expires, 'too_late'::text;
    RETURN;
  END IF;

  -- Rows 10-12: Registered tracking
  IF p_is_all_day IS TRUE THEN
    v_anchor := ((p_start_on::timestamp + interval '9 hours') AT TIME ZONE p_event_timezone);
  ELSE
    v_anchor := p_starts_at;
  END IF;

  IF v_anchor IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, 'inactive_status'::text;
    RETURN;
  END IF;

  v_due := v_anchor - interval '24 hours';
  -- Attendance cutoff is S (v_eff_start), including for ongoing events and all-day listings
  v_expires := LEAST(v_eff_start, v_eff_end) - interval '15 minutes';

  -- Row 10: Before due
  IF p_now < v_due THEN
    RETURN QUERY SELECT false, 'attendance'::text, v_anchor, v_due, v_expires, 'too_early'::text;
    RETURN;
  END IF;

  -- Row 11: In window
  IF v_due < v_expires AND p_now < v_expires THEN
    RETURN QUERY SELECT true, 'attendance'::text, v_anchor, v_due, v_expires, NULL::text;
    RETURN;
  END IF;

  -- Row 12: At/after expiry
  RETURN QUERY SELECT false, 'attendance'::text, v_anchor, v_due, v_expires, 'too_late'::text;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_reminder_eligibility(
  text, public.event_status, boolean, boolean, boolean, boolean, boolean,
  boolean, timestamptz, timestamptz, date, date, text, timestamptz, date, boolean, timestamptz
) FROM PUBLIC, anon, authenticated, catalog_reader;

GRANT EXECUTE ON FUNCTION public.evaluate_reminder_eligibility(
  text, public.event_status, boolean, boolean, boolean, boolean, boolean,
  boolean, timestamptz, timestamptz, date, date, text, timestamptz, date, boolean, timestamptz
) TO service_role;

-- 6. Member Self-Only Reminder Preference RPC (ARCHITECTURE.md lines 117, 130, 152)
-- Locks user preference on opt-in/out; missing row means off; increments consent_version ONLY on real change.
CREATE OR REPLACE FUNCTION public.set_user_reminder_preference(
  p_email_reminders_enabled boolean,
  p_notice_version text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  http_status integer,
  error_code text,
  email_reminders_enabled boolean,
  consent_version bigint,
  consent_recorded_at timestamptz,
  consent_notice_version text,
  was_updated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_allowed boolean;
  v_existing public.user_preferences%ROWTYPE;
  v_found boolean;
  v_clean_notice text;
  v_next_version bigint;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 401, 'UNAUTHENTICATED'::text, false, 0::bigint, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  IF NOT private.is_user_eligible(v_uid) THEN
    RETURN QUERY SELECT 403, 'FORBIDDEN'::text, false, 0::bigint, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  v_clean_notice := NULLIF(pg_catalog.btrim(COALESCE(p_notice_version, '')), '');
  IF p_email_reminders_enabled IS NULL OR v_clean_notice IS NULL THEN
    RETURN QUERY SELECT 400, 'INVALID_REQUEST'::text, false, 0::bigint, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  -- Enforce 30 member mutations per user per minute
  SELECT rl.allowed INTO v_allowed
  FROM private.consume_rate_limit_bucket('member_mutation', v_uid::text, 60, 30, p_now) rl;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN QUERY SELECT 429, 'RATE_LIMITED'::text, false, 0::bigint, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('user_preferences:' || v_uid::text)
  );

  SELECT up.*
    INTO v_existing
    FROM public.user_preferences up
   WHERE up.user_id = v_uid
   FOR UPDATE;

  v_found := FOUND;

  -- Missing row means off (email_reminders_enabled = false, consent_version = 0).
  IF NOT v_found THEN
    IF p_email_reminders_enabled = false THEN
      -- No real change from implicit off: do not increment consent_version
      RETURN QUERY SELECT 200, NULL::text, false, 0::bigint, NULL::timestamptz, NULL::text, false;
      RETURN;
    END IF;

    INSERT INTO public.user_preferences (
      user_id,
      email_reminders_enabled,
      consent_version,
      consent_recorded_at,
      consent_notice_version,
      created_at,
      updated_at
    )
    VALUES (
      v_uid,
      true,
      1,
      p_now,
      v_clean_notice,
      p_now,
      p_now
    )
    RETURNING * INTO v_existing;

    RETURN QUERY SELECT
      200,
      NULL::text,
      v_existing.email_reminders_enabled,
      v_existing.consent_version,
      v_existing.consent_recorded_at,
      v_existing.consent_notice_version,
      true;
    RETURN;
  END IF;

  -- Existing row present: check if state actually changed
  IF v_existing.email_reminders_enabled = p_email_reminders_enabled THEN
    RETURN QUERY SELECT
      200,
      NULL::text,
      v_existing.email_reminders_enabled,
      v_existing.consent_version,
      v_existing.consent_recorded_at,
      v_existing.consent_notice_version,
      false;
    RETURN;
  END IF;

  v_next_version := v_existing.consent_version + 1;

  UPDATE public.user_preferences up
     SET email_reminders_enabled = p_email_reminders_enabled,
         consent_version = v_next_version,
         consent_recorded_at = p_now,
         consent_notice_version = v_clean_notice,
         updated_at = p_now
   WHERE up.user_id = v_uid
   RETURNING * INTO v_existing;

  RETURN QUERY SELECT
    200,
    NULL::text,
    v_existing.email_reminders_enabled,
    v_existing.consent_version,
    v_existing.consent_recorded_at,
    v_existing.consent_notice_version,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_reminder_preference(boolean, text, timestamptz) FROM PUBLIC, anon, catalog_reader;
GRANT EXECUTE ON FUNCTION public.set_user_reminder_preference(boolean, text, timestamptz) TO authenticated;

-- 7. Token-Authorized One-Click Unsubscribe RPC (ARCHITECTURE.md lines 130, 183)
-- Executes token comparison and opt-out in one transaction.
-- Rejects invalid/expired tokens generically (400).
-- Returns 204 for success, already opted-out, or preserved newer opt-in on consent_version mismatch.
CREATE OR REPLACE FUNCTION public.apply_reminder_unsubscribe_token(
  p_token_digest text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  http_status integer,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery public.reminder_deliveries%ROWTYPE;
  v_pref public.user_preferences%ROWTYPE;
BEGIN
  IF p_token_digest IS NULL OR pg_catalog.btrim(p_token_digest) = '' THEN
    RETURN QUERY SELECT 400, 'invalid_or_expired'::text;
    RETURN;
  END IF;

  SELECT rd.*
    INTO v_delivery
    FROM public.reminder_deliveries rd
   WHERE rd.unsubscribe_token_digest = p_token_digest
   LIMIT 1;

  IF NOT FOUND
     OR v_delivery.unsubscribe_expires_at IS NULL
     OR v_delivery.unsubscribe_expires_at <= p_now
  THEN
    RETURN QUERY SELECT 400, 'invalid_or_expired'::text;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('user_preferences:' || v_delivery.user_id::text)
  );

  SELECT up.*
    INTO v_pref
    FROM public.user_preferences up
   WHERE up.user_id = v_delivery.user_id
   FOR UPDATE;

  IF NOT FOUND OR v_pref.email_reminders_enabled = false THEN
    RETURN QUERY SELECT 204, 'already_opted_out'::text;
    RETURN;
  END IF;

  -- Preserve newer opt-in if the user re-consented after this delivery's consent_version_at_send
  IF v_delivery.consent_version_at_send IS NOT NULL
     AND v_pref.consent_version > v_delivery.consent_version_at_send
  THEN
    RETURN QUERY SELECT 204, 'preserved_newer_consent'::text;
    RETURN;
  END IF;

  UPDATE public.user_preferences up
     SET email_reminders_enabled = false,
         consent_version = up.consent_version + 1,
         updated_at = p_now
   WHERE up.user_id = v_delivery.user_id;

  RETURN QUERY SELECT 204, 'opted_out'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_reminder_unsubscribe_token(text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
GRANT EXECUTE ON FUNCTION public.apply_reminder_unsubscribe_token(text, timestamptz) TO service_role;

-- 8. Webhook Bounce / Complaint Suppression Upsert (ARCHITECTURE.md line 185)
-- Matches provider_message_id and current verified recipient digest.
-- Event-before-acceptance correlation returns 503 retryable until provider_message_id is recorded.
-- Monotonically takes GREATEST(stored expires_at, new expires_at) on conflict.
CREATE OR REPLACE FUNCTION public.record_webhook_suppression(
  p_provider_message_id text,
  p_webhook_recipient_email text,
  p_digest_key text,
  p_reason text,
  p_expires_at timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  http_status integer,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery public.reminder_deliveries%ROWTYPE;
  v_current_email text;
  v_email_confirmed timestamptz;
  v_webhook_digest text;
  v_current_digest text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('permanent_bounce', 'complaint') THEN
    RETURN QUERY SELECT 400, 'invalid_reason'::text;
    RETURN;
  END IF;

  IF p_provider_message_id IS NULL OR pg_catalog.btrim(p_provider_message_id) = '' THEN
    RETURN QUERY SELECT 400, 'missing_message_id'::text;
    RETURN;
  END IF;

  SELECT rd.*
    INTO v_delivery
    FROM public.reminder_deliveries rd
   WHERE rd.provider_message_id = p_provider_message_id
   LIMIT 1;

  -- Event-before-acceptance correlation: return retryable non-success (503) until provider ID is recorded
  IF NOT FOUND THEN
    RETURN QUERY SELECT 503, 'unmatched_retryable'::text;
    RETURN;
  END IF;

  SELECT u.email, u.email_confirmed_at
    INTO v_current_email, v_email_confirmed
    FROM auth.users u
   WHERE u.id = v_delivery.user_id;

  IF v_current_email IS NULL OR v_email_confirmed IS NULL THEN
    RETURN QUERY SELECT 200, 'recipient_not_verified_diagnostic'::text;
    RETURN;
  END IF;

  v_webhook_digest := private.compute_recipient_digest(p_webhook_recipient_email, p_digest_key);
  v_current_digest := private.compute_recipient_digest(v_current_email, p_digest_key);

  IF v_webhook_digest <> v_current_digest THEN
    RETURN QUERY SELECT 200, 'recipient_mismatch_diagnostic'::text;
    RETURN;
  END IF;

  INSERT INTO public.reminder_suppressions (
    user_id,
    recipient_digest,
    reason,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    v_delivery.user_id,
    v_current_digest,
    p_reason,
    p_expires_at,
    p_now,
    p_now
  )
  ON CONFLICT (user_id, recipient_digest, reason)
  DO UPDATE SET
    expires_at = GREATEST(public.reminder_suppressions.expires_at, EXCLUDED.expires_at),
    updated_at = p_now;

  -- Note: an already accepted delivery stays terminal ('accepted') per ARCHITECTURE.md line 185.
  RETURN QUERY SELECT 200, 'suppressed'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.record_webhook_suppression(text, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
GRANT EXECUTE ON FUNCTION public.record_webhook_suppression(text, text, text, text, timestamptz, timestamptz) TO service_role;

-- 9. Scheduled Job Dispatch, Single-Run Bearer Auth, and Completion (ARCHITECTURE.md line 175)
CREATE OR REPLACE FUNCTION public.create_scheduled_job_run(
  p_job_name text,
  p_scheduled_at timestamptz,
  p_dispatch_token_digest text,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  INSERT INTO public.job_runs (
    job_name,
    scheduled_at,
    dispatch_token_digest,
    dispatch_token_expires_at,
    dispatch_status,
    execution_status,
    created_at,
    updated_at
  )
  VALUES (
    p_job_name,
    p_scheduled_at,
    p_dispatch_token_digest,
    p_now + interval '120 seconds',
    'queued',
    'unclaimed',
    p_now,
    p_now
  )
  ON CONFLICT (job_name, scheduled_at) DO NOTHING
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_job_run_bearer(
  p_run_id uuid,
  p_expected_job_name text,
  p_token_digest text,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.job_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_token_digest IS NULL OR pg_catalog.btrim(p_token_digest) = '' THEN
    RETURN false;
  END IF;

  SELECT jr.*
    INTO v_run
    FROM public.job_runs jr
   WHERE jr.id = p_run_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_run.job_name IS DISTINCT FROM p_expected_job_name
     OR v_run.execution_status <> 'unclaimed'
     OR v_run.dispatch_token_digest IS NULL
     OR v_run.dispatch_token_digest <> p_token_digest
     OR v_run.dispatch_token_expires_at IS NULL
     OR v_run.dispatch_token_expires_at <= p_now
  THEN
    RETURN false;
  END IF;

  UPDATE public.job_runs
     SET dispatch_token_digest = NULL,
         dispatch_status = 'received',
         execution_status = 'running',
         started_at = p_now,
         updated_at = p_now
   WHERE id = p_run_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job_run(
  p_run_id uuid,
  p_execution_status text,
  p_counts jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_execution_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'INVALID_JOB_STATUS: %', p_execution_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.job_runs
     SET execution_status = p_execution_status,
         finished_at = p_now,
         counts = COALESCE(p_counts, '{}'::jsonb),
         error_code = p_error_code,
         updated_at = p_now
   WHERE id = p_run_id;
END;
$$;

-- Reconcile stale/missing dispatch or execution evidence after 2 minutes (ARCHITECTURE.md line 175)
CREATE OR REPLACE FUNCTION public.reconcile_stale_job_runs(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flagged integer;
BEGIN
  UPDATE public.job_runs
     SET dispatch_status = CASE
           WHEN dispatch_status = 'queued' THEN 'missing'
           ELSE dispatch_status
         END,
         execution_status = CASE
           WHEN execution_status = 'unclaimed' THEN 'failed'
           ELSE execution_status
         END,
         error_code = COALESCE(error_code, 'DISPATCH_MISSING_TIMEOUT'),
         finished_at = COALESCE(finished_at, p_now),
         dispatch_token_digest = NULL,
         updated_at = p_now
   WHERE scheduled_at <= p_now - interval '2 minutes'
     AND (dispatch_status = 'queued' OR execution_status = 'unclaimed');

  GET DIAGNOSTICS v_flagged = ROW_COUNT;
  RETURN v_flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.create_scheduled_job_run(text, timestamptz, text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.consume_job_run_bearer(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.complete_job_run(uuid, text, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.reconcile_stale_job_runs(timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;

GRANT EXECUTE ON FUNCTION public.create_scheduled_job_run(text, timestamptz, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_job_run_bearer(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_job_run(uuid, text, jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_job_runs(timestamptz) TO service_role;

-- 10. Reminder Worker Materialize, Claim, Freeze, and Attempt-Checked Finalize (ARCHITECTURE.md lines 179-188)

-- 10.1 Materialize eligible due deliveries (Smoke Check #1 at candidate selection)
CREATE OR REPLACE FUNCTION public.materialize_due_reminder_deliveries(
  p_delivery_mode text,
  p_smoke_allowlist jsonb,
  p_digest_key text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  materialized_count integer,
  expired_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_materialized integer := 0;
  v_expired integer := 0;
BEGIN
  -- Expire unleased rows past expires_at or past 23h retry horizon, preserving ambiguity as 'unknown'
  UPDATE public.reminder_deliveries rd
     SET status = CASE WHEN rd.may_have_sent THEN 'unknown' ELSE 'expired' END,
         lease_until = NULL,
         pending_payload = NULL,
         error_code = COALESCE(rd.error_code, 'WINDOW_EXPIRED'),
         updated_at = p_now
   WHERE rd.status IN ('pending', 'retry', 'leased')
     AND (rd.lease_until IS NULL OR rd.lease_until <= p_now)
     AND (
       rd.expires_at <= p_now
       OR (rd.first_attempt_at IS NOT NULL AND p_now >= rd.first_attempt_at + interval '23 hours')
     );

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- If delivery_mode is invalid or smoke allowlist is missing/empty in smoke mode, materialize 0 rows
  IF p_delivery_mode NOT IN ('smoke', 'live') THEN
    RETURN QUERY SELECT 0, v_expired;
    RETURN;
  END IF;

  IF p_delivery_mode = 'smoke' AND (
    p_smoke_allowlist IS NULL
    OR pg_catalog.jsonb_typeof(p_smoke_allowlist) <> 'array'
    OR pg_catalog.jsonb_array_length(p_smoke_allowlist) = 0
  ) THEN
    RETURN QUERY SELECT 0, v_expired;
    RETURN;
  END IF;

  INSERT INTO public.reminder_deliveries (
    user_id,
    event_id,
    kind,
    target_at,
    due_at,
    expires_at,
    status,
    created_at,
    updated_at
  )
  SELECT
    ue.user_id,
    ue.event_id,
    elig.kind,
    elig.anchor_at,
    elig.due_at,
    elig.expires_at,
    'pending',
    p_now,
    p_now
  FROM public.user_events ue
  JOIN public.events e ON e.id = ue.event_id
  JOIN auth.users u ON u.id = ue.user_id
  LEFT JOIN public.account_controls ac ON ac.user_id = ue.user_id
  LEFT JOIN public.user_preferences up ON up.user_id = ue.user_id
  CROSS JOIN LATERAL public.evaluate_reminder_eligibility(
    ue.state,
    e.status,
    COALESCE(up.email_reminders_enabled, false),
    e.reminder_hold,
    (ac.user_id IS NULL OR ac.adult_confirmed_at IS NULL OR ac.deletion_requested_at IS NOT NULL),
    (u.email IS NOT NULL AND pg_catalog.btrim(u.email) <> '' AND u.email_confirmed_at IS NOT NULL),
    EXISTS (
      SELECT 1
      FROM public.reminder_suppressions rs
      WHERE rs.user_id = ue.user_id
        AND u.email IS NOT NULL
        AND rs.recipient_digest = private.compute_recipient_digest(u.email, p_digest_key)
        AND rs.expires_at > p_now
    ),
    e.is_all_day,
    e.starts_at,
    e.ends_at,
    e.start_on,
    e.end_on,
    e.event_timezone,
    e.registration_deadline_at,
    e.registration_deadline_on,
    e.registration_closed,
    p_now
  ) elig
  WHERE elig.eligible IS TRUE
    AND elig.due_at < elig.expires_at
    AND private.matches_smoke_allowlist(
      p_delivery_mode,
      p_smoke_allowlist,
      ue.user_id,
      ue.event_id,
      elig.kind
    )
  ON CONFLICT (user_id, event_id, kind, target_at) DO NOTHING;

  GET DIAGNOSTICS v_materialized = ROW_COUNT;
  RETURN QUERY SELECT v_materialized, v_expired;
END;
$$;

-- 10.2 Claim at most 10 due rows using FOR UPDATE SKIP LOCKED, 90s lease, incremented attempt_count
-- Smoke Check #2 at claim; recovered lease preserves first_attempt_at so retry horizon never resets.
CREATE OR REPLACE FUNCTION public.claim_due_reminder_deliveries(
  p_delivery_mode text,
  p_smoke_allowlist jsonb,
  p_digest_key text,
  p_max_rows integer DEFAULT 10,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  delivery_id uuid,
  user_id uuid,
  event_id uuid,
  kind text,
  target_at timestamptz,
  due_at timestamptz,
  expires_at timestamptz,
  attempt_count integer,
  first_attempt_at timestamptz,
  may_have_sent boolean,
  pending_payload jsonb,
  unsubscribe_token_digest text,
  unsubscribe_expires_at timestamptz,
  consent_version_at_send bigint,
  current_verified_email text,
  has_verified_recipient boolean,
  deletion_or_ineligible_account boolean,
  has_active_suppression boolean,
  opt_in_enabled boolean,
  current_consent_version bigint,
  tracking_state text,
  event_status public.event_status,
  event_title text,
  event_organizer text,
  event_timezone text,
  event_is_all_day boolean,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_start_on date,
  event_end_on date,
  event_registration_deadline_at timestamptz,
  event_registration_deadline_on date,
  event_registration_closed boolean,
  event_reminder_hold boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap integer := LEAST(GREATEST(COALESCE(p_max_rows, 10), 1), 10);
BEGIN
  IF p_delivery_mode NOT IN ('smoke', 'live') THEN
    RETURN;
  END IF;

  IF p_delivery_mode = 'smoke' AND (
    p_smoke_allowlist IS NULL
    OR pg_catalog.jsonb_typeof(p_smoke_allowlist) <> 'array'
    OR pg_catalog.jsonb_array_length(p_smoke_allowlist) = 0
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT rd.id
    FROM public.reminder_deliveries rd
    WHERE rd.due_at <= p_now
      AND p_now < rd.expires_at
      AND (rd.first_attempt_at IS NULL OR p_now < rd.first_attempt_at + interval '23 hours')
      AND (
        rd.status = 'pending'
        OR (rd.status = 'retry' AND (rd.next_attempt_at IS NULL OR rd.next_attempt_at <= p_now))
        OR (rd.status = 'leased' AND rd.lease_until IS NOT NULL AND rd.lease_until <= p_now)
      )
      AND private.matches_smoke_allowlist(
        p_delivery_mode,
        p_smoke_allowlist,
        rd.user_id,
        rd.event_id,
        rd.kind
      )
    ORDER BY rd.due_at ASC, rd.id ASC
    LIMIT v_cap
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.reminder_deliveries rd
       SET status = 'leased',
           lease_until = p_now + interval '90 seconds',
           attempt_count = rd.attempt_count + 1,
           first_attempt_at = COALESCE(rd.first_attempt_at, p_now),
           updated_at = p_now
      FROM candidates c
     WHERE rd.id = c.id
     RETURNING rd.*
  )
  SELECT
    cl.id AS delivery_id,
    cl.user_id,
    cl.event_id,
    cl.kind,
    cl.target_at,
    cl.due_at,
    cl.expires_at,
    cl.attempt_count,
    cl.first_attempt_at,
    cl.may_have_sent,
    cl.pending_payload,
    cl.unsubscribe_token_digest,
    cl.unsubscribe_expires_at,
    cl.consent_version_at_send,
    CASE
      WHEN u.email IS NOT NULL AND pg_catalog.btrim(u.email) <> '' AND u.email_confirmed_at IS NOT NULL
      THEN pg_catalog.lower(pg_catalog.btrim(u.email))
      ELSE NULL
    END AS current_verified_email,
    (u.email IS NOT NULL AND pg_catalog.btrim(u.email) <> '' AND u.email_confirmed_at IS NOT NULL) AS has_verified_recipient,
    (ac.user_id IS NULL OR ac.adult_confirmed_at IS NULL OR ac.deletion_requested_at IS NOT NULL) AS deletion_or_ineligible_account,
    EXISTS (
      SELECT 1
      FROM public.reminder_suppressions rs
      WHERE rs.user_id = cl.user_id
        AND u.email IS NOT NULL
        AND rs.recipient_digest = private.compute_recipient_digest(u.email, p_digest_key)
        AND rs.expires_at > p_now
    ) AS has_active_suppression,
    COALESCE(up.email_reminders_enabled, false) AS opt_in_enabled,
    COALESCE(up.consent_version, 0) AS current_consent_version,
    ue.state AS tracking_state,
    e.status AS event_status,
    e.title AS event_title,
    e.organizer AS event_organizer,
    e.event_timezone,
    e.is_all_day AS event_is_all_day,
    e.starts_at AS event_starts_at,
    e.ends_at AS event_ends_at,
    e.start_on AS event_start_on,
    e.end_on AS event_end_on,
    e.registration_deadline_at AS event_registration_deadline_at,
    e.registration_deadline_on AS event_registration_deadline_on,
    e.registration_closed AS event_registration_closed,
    e.reminder_hold AS event_reminder_hold
  FROM claimed cl
  JOIN public.events e ON e.id = cl.event_id
  LEFT JOIN auth.users u ON u.id = cl.user_id
  LEFT JOIN public.account_controls ac ON ac.user_id = cl.user_id
  LEFT JOIN public.user_preferences up ON up.user_id = cl.user_id
  LEFT JOIN public.user_events ue ON ue.user_id = cl.user_id AND ue.event_id = cl.event_id;
END;
$$;

-- 10.3 Freeze payload, unsubscribe digest, and may_have_sent=true immediately before provider dispatch
CREATE OR REPLACE FUNCTION public.prepare_reminder_provider_attempt(
  p_delivery_id uuid,
  p_attempt_count integer,
  p_pending_payload jsonb,
  p_unsubscribe_token_digest text,
  p_consent_version_at_send bigint,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  prepared boolean,
  prior_may_have_sent boolean,
  frozen_payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.reminder_deliveries%ROWTYPE;
  v_prior_ambiguous boolean;
BEGIN
  SELECT rd.*
    INTO v_row
    FROM public.reminder_deliveries rd
   WHERE rd.id = p_delivery_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_row.status <> 'leased'
     OR v_row.attempt_count <> p_attempt_count
     OR v_row.lease_until IS NULL
     OR v_row.lease_until <= p_now
  THEN
    RETURN QUERY SELECT false, false, NULL::jsonb;
    RETURN;
  END IF;

  v_prior_ambiguous := v_row.may_have_sent;

  UPDATE public.reminder_deliveries rd
     SET pending_payload = COALESCE(rd.pending_payload, p_pending_payload),
         unsubscribe_token_digest = COALESCE(rd.unsubscribe_token_digest, p_unsubscribe_token_digest),
         unsubscribe_expires_at = COALESCE(rd.unsubscribe_expires_at, p_now + interval '90 days'),
         consent_version_at_send = COALESCE(rd.consent_version_at_send, p_consent_version_at_send),
         may_have_sent = true,
         updated_at = p_now
   WHERE rd.id = p_delivery_id
   RETURNING * INTO v_row;

  RETURN QUERY SELECT true, v_prior_ambiguous, v_row.pending_payload;
END;
$$;

-- 10.4 Attempt-number & active-lease checked finalization
-- Enforces expired_lease_cannot_finalize_new_attempt and clears pending_payload on terminal completion.
CREATE OR REPLACE FUNCTION public.finalize_reminder_delivery_attempt(
  p_delivery_id uuid,
  p_attempt_count integer,
  p_outcome text,
  p_may_have_sent boolean,
  p_provider_message_id text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.reminder_deliveries%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('pending', 'retry', 'accepted', 'expired', 'suppressed', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_OUTCOME: %', p_outcome USING ERRCODE = '22023';
  END IF;

  SELECT rd.*
    INTO v_row
    FROM public.reminder_deliveries rd
   WHERE rd.id = p_delivery_id
   FOR UPDATE;

  -- Must still be leased with matching attempt_count AND active lease_until > p_now
  IF NOT FOUND
     OR v_row.status <> 'leased'
     OR v_row.attempt_count <> p_attempt_count
     OR v_row.lease_until IS NULL
     OR v_row.lease_until <= p_now
  THEN
    RETURN false;
  END IF;

  IF p_outcome = 'accepted' THEN
    UPDATE public.reminder_deliveries
       SET status = 'accepted',
           lease_until = NULL,
           provider_message_id = p_provider_message_id,
           may_have_sent = true,
           pending_payload = NULL,
           error_code = NULL,
           updated_at = p_now
     WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  IF p_outcome = 'retry' THEN
    UPDATE public.reminder_deliveries
       SET status = 'retry',
           lease_until = NULL,
           next_attempt_at = p_next_attempt_at,
           may_have_sent = p_may_have_sent,
           error_code = p_error_code,
           updated_at = p_now
     WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  IF p_outcome = 'pending' THEN
    -- Temporary eligibility loss before the first provider attempt leaves candidate pending
    UPDATE public.reminder_deliveries
       SET status = 'pending',
           lease_until = NULL,
           first_attempt_at = CASE WHEN pending_payload IS NULL THEN NULL ELSE first_attempt_at END,
           may_have_sent = p_may_have_sent,
           error_code = p_error_code,
           updated_at = p_now
     WHERE id = p_delivery_id;
    RETURN true;
  END IF;

  -- Terminal non-accepted states: expired, suppressed, failed, unknown -> clear pending_payload!
  UPDATE public.reminder_deliveries
     SET status = p_outcome,
         lease_until = NULL,
         may_have_sent = p_may_have_sent,
         pending_payload = NULL,
         error_code = p_error_code,
         updated_at = p_now
   WHERE id = p_delivery_id;

  RETURN true;
END;
$$;

-- 10.5 Retention sweep & health metrics helper (ARCHITECTURE.md lines 219, 225)
CREATE OR REPLACE FUNCTION public.get_reminder_health_summary(
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  oldest_actionable_due_at timestamptz,
  actionable_backlog_over_10m_count integer,
  unknown_outcome_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    MIN(rd.due_at) FILTER (
      WHERE rd.status IN ('pending', 'retry', 'leased')
        AND rd.due_at <= p_now
        AND p_now < rd.expires_at
        AND (rd.next_attempt_at IS NULL OR rd.next_attempt_at <= p_now)
    ) AS oldest_actionable_due_at,
    COUNT(*)::integer FILTER (
      WHERE rd.status IN ('pending', 'retry', 'leased')
        AND rd.due_at <= p_now - interval '10 minutes'
        AND p_now < rd.expires_at
        AND (rd.next_attempt_at IS NULL OR rd.next_attempt_at <= p_now)
    ) AS actionable_backlog_over_10m_count,
    COUNT(*)::integer FILTER (
      WHERE rd.status = 'unknown'
    ) AS unknown_outcome_count
  FROM public.reminder_deliveries rd;
$$;

CREATE OR REPLACE FUNCTION public.sweep_r2_retention(
  p_now timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Clear temporary request payload at terminal completion or earlier of expiry and 23h after first attempt
  UPDATE public.reminder_deliveries
     SET pending_payload = NULL,
         updated_at = p_now
   WHERE pending_payload IS NOT NULL
     AND (
       status IN ('accepted', 'expired', 'suppressed', 'failed', 'unknown')
       OR expires_at <= p_now
       OR (first_attempt_at IS NOT NULL AND p_now >= first_attempt_at + interval '23 hours')
     );

  DELETE FROM public.reminder_suppressions WHERE expires_at <= p_now;
  DELETE FROM public.job_runs WHERE created_at <= p_now - interval '30 days';
  DELETE FROM public.reminder_deliveries
   WHERE target_at <= p_now - interval '90 days'
     AND (unsubscribe_expires_at IS NULL OR unsubscribe_expires_at <= p_now);
  DELETE FROM public.deleted_accounts WHERE requested_at <= p_now - interval '35 days';
  DELETE FROM public.curator_audit WHERE recorded_at <= p_now - interval '180 days';
  DELETE FROM public.rate_limit_buckets WHERE window_start <= p_now - interval '24 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_due_reminder_deliveries(text, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.claim_due_reminder_deliveries(text, jsonb, text, integer, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.prepare_reminder_provider_attempt(uuid, integer, jsonb, text, bigint, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.finalize_reminder_delivery_attempt(uuid, integer, text, boolean, text, timestamptz, text, timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.get_reminder_health_summary(timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON FUNCTION public.sweep_r2_retention(timestamptz) FROM PUBLIC, anon, authenticated, catalog_reader;

GRANT EXECUTE ON FUNCTION public.materialize_due_reminder_deliveries(text, jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_reminder_deliveries(text, jsonb, text, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_reminder_provider_attempt(uuid, integer, jsonb, text, bigint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_reminder_delivery_attempt(uuid, integer, text, boolean, text, timestamptz, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reminder_health_summary(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_r2_retention(timestamptz) TO service_role;

COMMIT;
