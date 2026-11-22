-- =============================================================================
-- Tech Event Discover · R1-MUST Foundation and Discover Migration
-- Tier: R1-MUST ONLY. No R2-MUST or LATER-HARDENING relations or columns.
-- =============================================================================

BEGIN;

-- 1. Extensions & Private Schema
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- 2. Dedicated Catalog Reader Role (NOLOGIN, non-bypass)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_reader') THEN
    CREATE ROLE catalog_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE catalog_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, catalog_reader, service_role;

-- 3. R1-MUST Enums
CREATE TYPE public.event_status AS ENUM ('draft', 'published', 'canceled', 'archived');
CREATE TYPE public.event_type AS ENUM ('hackathon', 'workshop', 'seminar', 'meetup', 'conference', 'other');
CREATE TYPE public.event_mode AS ENUM ('online', 'in_person', 'hybrid');
CREATE TYPE public.price_status AS ENUM ('free', 'paid', 'unknown');
CREATE TYPE public.cancellation_reason AS ENUM ('organizer_canceled', 'venue_unavailable', 'other_confirmed');

-- 4. Timezone & Effective Schedule Helpers
CREATE OR REPLACE FUNCTION private.is_valid_iana_timezone(p_tz text)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    pg_catalog.btrim(p_tz) <> ''
    AND p_tz !~ '^[+-]?[0-9]'
    AND (p_tz = 'UTC' OR p_tz ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)+$')
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names tzn
      WHERE tzn.name = p_tz
    );
$$;

CREATE OR REPLACE FUNCTION public.event_effective_start_at(
  p_is_all_day boolean,
  p_starts_at timestamptz,
  p_start_on date,
  p_event_timezone text
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_is_all_day IS TRUE THEN
      CASE
        WHEN p_start_on IS NOT NULL AND p_event_timezone IS NOT NULL THEN
          (p_start_on::timestamp AT TIME ZONE p_event_timezone)
        ELSE NULL
      END
    WHEN p_is_all_day IS FALSE THEN p_starts_at
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.event_effective_end_at(
  p_is_all_day boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_start_on date,
  p_end_on date,
  p_event_timezone text
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_is_all_day IS TRUE THEN
      CASE
        WHEN p_end_on IS NOT NULL AND p_event_timezone IS NOT NULL THEN
          (p_end_on::timestamp AT TIME ZONE p_event_timezone)
        ELSE NULL
      END
    WHEN p_is_all_day IS FALSE THEN
      CASE
        WHEN p_starts_at IS NOT NULL THEN
          COALESCE(p_ends_at, p_starts_at + interval '2 hours')
        ELSE NULL
      END
    ELSE NULL
  END;
$$;

-- 5. R1-MUST Tables

-- 5.1 cities
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (pg_catalog.btrim(slug) <> ''),
  name text NOT NULL CHECK (pg_catalog.btrim(name) <> ''),
  state text NOT NULL CHECK (pg_catalog.btrim(state) <> ''),
  center extensions.geography(Point, 4326) NOT NULL
);

CREATE INDEX cities_center_gist_idx ON public.cities USING GIST (center);

-- 5.2 sources
CREATE TABLE public.sources (
  slug text PRIMARY KEY CHECK (pg_catalog.btrim(slug) <> ''),
  display_name text NOT NULL,
  attribution_text text NOT NULL,
  permission_basis text,
  evidence_ref text,
  allowed_fields text[] NOT NULL DEFAULT '{}'::text[],
  reviewed_on date,
  permission_status text NOT NULL DEFAULT 'pending'
    CHECK (permission_status IN ('pending', 'approved', 'withdrawn')),
  CONSTRAINT sources_approval_requirements CHECK (
    permission_status <> 'approved' OR (
      pg_catalog.btrim(COALESCE(display_name, '')) <> '' AND
      pg_catalog.btrim(COALESCE(attribution_text, '')) <> '' AND
      pg_catalog.btrim(COALESCE(permission_basis, '')) <> '' AND
      pg_catalog.btrim(COALESCE(evidence_ref, '')) <> '' AND
      COALESCE(pg_catalog.array_length(allowed_fields, 1), 0) > 0 AND
      reviewed_on IS NOT NULL
    )
  )
);

-- 5.3 events (R1-MUST columns only; no reminder_hold in R1)
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  status public.event_status NOT NULL DEFAULT 'draft',
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  title text,
  organizer text,
  summary text,
  event_type public.event_type,
  mode public.event_mode,
  price_status public.price_status NOT NULL DEFAULT 'unknown',
  city_id uuid REFERENCES public.cities(id),
  venue text,
  online_india_access_confirmed boolean NOT NULL DEFAULT false,
  event_timezone text,
  is_all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  start_on date,
  end_on date,
  registration_deadline_at timestamptz,
  registration_deadline_on date,
  registration_closed boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  cancellation_reason public.cancellation_reason,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_cancellation_iff_canceled CHECK (
    (status = 'canceled' AND canceled_at IS NOT NULL AND cancellation_reason IS NOT NULL) OR
    (status <> 'canceled' AND canceled_at IS NULL AND cancellation_reason IS NULL)
  ),
  CONSTRAINT events_schedule_exclusivity CHECK (
    (is_all_day IS NULL AND starts_at IS NULL AND ends_at IS NULL AND start_on IS NULL AND end_on IS NULL) OR
    (is_all_day = false AND start_on IS NULL AND end_on IS NULL AND (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)) OR
    (is_all_day = true AND starts_at IS NULL AND ends_at IS NULL AND (start_on IS NULL OR end_on IS NULL OR end_on > start_on))
  ),
  CONSTRAINT events_deadline_exclusivity CHECK (
    NOT (registration_deadline_at IS NOT NULL AND registration_deadline_on IS NOT NULL)
  ),
  CONSTRAINT events_published_or_canceled_complete CHECK (
    status NOT IN ('published', 'canceled') OR (
      pg_catalog.btrim(COALESCE(title, '')) <> '' AND
      pg_catalog.btrim(COALESCE(organizer, '')) <> '' AND
      event_type IS NOT NULL AND
      mode IS NOT NULL AND
      is_all_day IS NOT NULL AND
      pg_catalog.btrim(COALESCE(event_timezone, '')) <> '' AND
      (
        (is_all_day = false AND starts_at IS NOT NULL) OR
        (is_all_day = true AND start_on IS NOT NULL AND end_on IS NOT NULL AND end_on > start_on)
      ) AND
      (
        (mode IN ('in_person', 'hybrid') AND city_id IS NOT NULL) OR
        (mode = 'online' AND city_id IS NULL AND online_india_access_confirmed = true)
      )
    )
  )
);

CREATE INDEX events_status_idx ON public.events (status);
CREATE INDEX events_city_id_idx ON public.events (city_id);
CREATE INDEX events_facets_idx ON public.events (status, event_type, mode, price_status);
CREATE INDEX events_fts_gin_idx ON public.events USING GIN (
  pg_catalog.to_tsvector(
    'english',
    COALESCE(title, '') || ' ' || COALESCE(organizer, '') || ' ' || COALESCE(summary, '')
  )
);
CREATE INDEX events_title_trgm_idx ON public.events USING GIN (
  (pg_catalog.lower(COALESCE(title, ''))) extensions.gin_trgm_ops
);

-- 5.4 event_sources
CREATE TABLE public.event_sources (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source_slug text NOT NULL REFERENCES public.sources(slug),
  public_url text NOT NULL CHECK (pg_catalog.btrim(public_url) <> '' AND pg_catalog.char_length(public_url) <= 2048),
  url_key text NOT NULL UNIQUE CHECK (pg_catalog.btrim(url_key) <> '' AND pg_catalog.char_length(url_key) <= 2048),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX event_sources_one_primary_per_event_idx
  ON public.event_sources (event_id)
  WHERE is_primary;

CREATE INDEX event_sources_event_id_idx ON public.event_sources (event_id);
CREATE INDEX event_sources_source_slug_idx ON public.event_sources (source_slug);

-- 5.5 account_controls
CREATE TABLE public.account_controls (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  adult_confirmed_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5.6 user_events
CREATE TABLE public.user_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id),
  state text NOT NULL CHECK (state IN ('saved', 'registered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX user_events_event_id_idx ON public.user_events (event_id);

-- 5.7 curator_access (authoritative table in public + synonym view in private)
CREATE TABLE public.curator_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW private.curator_access AS
  SELECT user_id, active, updated_at
  FROM public.curator_access;

-- 5.8 curator_audit
CREATE TABLE public.curator_audit (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_id text NOT NULL CHECK (pg_catalog.btrim(target_id) <> ''),
  action text NOT NULL CHECK (pg_catalog.btrim(action) <> ''),
  prior_version bigint,
  new_version bigint,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason_code text NOT NULL CHECK (pg_catalog.btrim(reason_code) <> ''),
  archived_url_keys text[] NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT curator_audit_archived_keys_only_on_archive CHECK (
    action = 'archive' OR COALESCE(pg_catalog.array_length(archived_url_keys, 1), 0) = 0
  )
);

-- 5.9 deleted_accounts (35-day tombstones, explicitly NO Auth FK)
CREATE TABLE public.deleted_accounts (
  user_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);

-- 5.10 rate_limit_buckets
CREATE TABLE public.rate_limit_buckets (
  scope text NOT NULL CHECK (pg_catalog.btrim(scope) <> ''),
  key_digest text NOT NULL CHECK (pg_catalog.btrim(key_digest) <> ''),
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  PRIMARY KEY (scope, key_digest, window_start)
);

-- 6. Triggers for Invariants

-- 6.1 Validate event timezone & deadline bounds
CREATE OR REPLACE FUNCTION private.trg_validate_event_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_effective_start timestamptz;
  v_local_start_date date;
BEGIN
  IF NEW.event_timezone IS NOT NULL THEN
    IF NOT private.is_valid_iana_timezone(NEW.event_timezone) THEN
      RAISE EXCEPTION 'INVALID_TIMEZONE: % is not a valid IANA timezone', NEW.event_timezone
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_effective_start := public.event_effective_start_at(
    NEW.is_all_day,
    NEW.starts_at,
    NEW.start_on,
    NEW.event_timezone
  );

  IF NEW.registration_deadline_at IS NOT NULL AND v_effective_start IS NOT NULL THEN
    IF NEW.registration_deadline_at > v_effective_start THEN
      RAISE EXCEPTION 'INVALID_DEADLINE: exact deadline cannot be after effective start'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.registration_deadline_on IS NOT NULL AND NEW.is_all_day IS NOT NULL THEN
    IF NEW.is_all_day IS TRUE AND NEW.start_on IS NOT NULL THEN
      v_local_start_date := NEW.start_on;
    ELSIF NEW.is_all_day IS FALSE AND NEW.starts_at IS NOT NULL AND NEW.event_timezone IS NOT NULL THEN
      v_local_start_date := (NEW.starts_at AT TIME ZONE NEW.event_timezone)::date;
    END IF;

    IF v_local_start_date IS NOT NULL AND NEW.registration_deadline_on > v_local_start_date THEN
      RAISE EXCEPTION 'INVALID_DEADLINE: date-only deadline cannot be after local start date'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.updated_at := COALESCE(NEW.updated_at, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_validate_invariants_trg
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION private.trg_validate_event_invariants();

-- 6.2 Require an approved source record before linking in event_sources
CREATE OR REPLACE FUNCTION private.trg_validate_event_source_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT s.permission_status
    INTO v_status
    FROM public.sources s
   WHERE s.slug = NEW.source_slug;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'SOURCE_NOT_APPROVED: source % is not approved for linking', NEW.source_slug
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER event_sources_require_approved_source_trg
BEFORE INSERT OR UPDATE ON public.event_sources
FOR EACH ROW
EXECUTE FUNCTION private.trg_validate_event_source_approved();

-- 6.3 Deferred constraint trigger ensuring published events have one primary source
CREATE OR REPLACE FUNCTION private.trg_check_published_has_primary_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id uuid;
  v_status public.event_status;
BEGIN
  v_event_id := CASE
    WHEN TG_TABLE_NAME = 'events' THEN COALESCE(NEW.id, OLD.id)
    ELSE COALESCE(NEW.event_id, OLD.event_id)
  END;

  SELECT e.status INTO v_status
    FROM public.events e
   WHERE e.id = v_event_id;

  IF v_status = 'published' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.event_sources es
      WHERE es.event_id = v_event_id
        AND es.is_primary = true
    ) THEN
      RAISE EXCEPTION 'MISSING_PRIMARY_SOURCE: published event % must have one primary source', v_event_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER events_published_requires_primary_source_trg
AFTER INSERT OR UPDATE ON public.events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_check_published_has_primary_source();

CREATE CONSTRAINT TRIGGER event_sources_published_requires_primary_source_trg
AFTER DELETE OR UPDATE ON public.event_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.trg_check_published_has_primary_source();

-- 6.4 Enforce immutable adult_confirmed_at once recorded
CREATE OR REPLACE FUNCTION private.trg_account_controls_immutable_adult_ts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.adult_confirmed_at IS NOT NULL AND NEW.adult_confirmed_at IS DISTINCT FROM OLD.adult_confirmed_at THEN
    RAISE EXCEPTION 'ADULT_ATTESTATION_IMMUTABLE: adult_confirmed_at cannot be modified once set'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_controls_immutable_adult_ts_trg
BEFORE UPDATE ON public.account_controls
FOR EACH ROW
EXECUTE FUNCTION private.trg_account_controls_immutable_adult_ts();

-- 7. Account Eligibility & Source Visibility Helpers (Narrowly Privileged)
CREATE OR REPLACE FUNCTION private.is_user_eligible(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.account_controls ac
      WHERE ac.user_id = p_user_id
        AND ac.adult_confirmed_at IS NOT NULL
        AND ac.deletion_requested_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION private.is_source_visible_for_public(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sources s
    JOIN public.event_sources es ON es.source_slug = s.slug
    JOIN public.events e ON e.id = es.event_id
    WHERE s.slug = p_slug
      AND s.permission_status = 'approved'
      AND e.status IN ('published', 'canceled')
  );
$$;

CREATE OR REPLACE FUNCTION private.is_source_visible_for_catalog(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sources s
    JOIN public.event_sources es ON es.source_slug = s.slug
    JOIN public.events e ON e.id = es.event_id
    WHERE s.slug = p_slug
      AND s.permission_status = 'approved'
      AND e.status = 'published'
  );
$$;

REVOKE ALL ON FUNCTION private.is_user_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_user_eligible(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.is_source_visible_for_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_source_visible_for_public(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.is_source_visible_for_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_source_visible_for_catalog(text) TO catalog_reader, service_role;

-- 8. Row Level Security & Column-Level Grants

-- Revoke all default table privileges from PUBLIC, anon, authenticated, catalog_reader
REVOKE ALL ON public.cities FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.sources FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.events FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.event_sources FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.user_events FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.account_controls FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.curator_access FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.curator_audit FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.deleted_accounts FROM PUBLIC, anon, authenticated, catalog_reader;
REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated, catalog_reader;

-- Enable and force RLS on every relation
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curator_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curator_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Grant narrow column SELECTs per ARCHITECTURE.md
-- cities: id, name, state, slug, center are public reference data
GRANT SELECT (id, name, state, slug, center)
  ON public.cities TO anon, authenticated, catalog_reader;

-- sources: ONLY public columns slug, display_name, attribution_text
GRANT SELECT (slug, display_name, attribution_text)
  ON public.sources TO anon, authenticated, catalog_reader;

-- events: public output columns
GRANT SELECT (
  id, status, version, title, organizer, summary, event_type, mode, price_status,
  city_id, venue, online_india_access_confirmed, event_timezone, is_all_day,
  starts_at, ends_at, start_on, end_on, registration_deadline_at,
  registration_deadline_on, registration_closed, canceled_at, cancellation_reason,
  created_at, updated_at
) ON public.events TO anon, authenticated, catalog_reader;

-- event_sources: public projection excludes url_key
GRANT SELECT (id, event_id, source_slug, public_url, is_primary, verified_at, created_at, updated_at)
  ON public.event_sources TO anon, authenticated, catalog_reader;

-- user_events: authenticated only (anon and catalog_reader denied)
GRANT SELECT (user_id, event_id, state, created_at, updated_at)
  ON public.user_events TO authenticated;

-- RLS Policies
-- 8.1 cities
CREATE POLICY cities_select_all
  ON public.cities
  FOR SELECT
  TO anon, authenticated, catalog_reader
  USING (true);

-- 8.2 events
CREATE POLICY events_public_select
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (status IN ('published', 'canceled'));

CREATE POLICY events_catalog_reader_select
  ON public.events
  FOR SELECT
  TO catalog_reader
  USING (status = 'published');

-- 8.3 event_sources
CREATE POLICY event_sources_public_select
  ON public.event_sources
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_sources.event_id
        AND e.status IN ('published', 'canceled')
    )
  );

CREATE POLICY event_sources_catalog_reader_select
  ON public.event_sources
  FOR SELECT
  TO catalog_reader
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_sources.event_id
        AND e.status = 'published'
    )
  );

-- 8.4 sources
CREATE POLICY sources_public_select
  ON public.sources
  FOR SELECT
  TO anon, authenticated
  USING (private.is_source_visible_for_public(slug));

CREATE POLICY sources_catalog_reader_select
  ON public.sources
  FOR SELECT
  TO catalog_reader
  USING (private.is_source_visible_for_catalog(slug));

-- 8.5 user_events
CREATE POLICY user_events_authenticated_owner_eligible_select
  ON public.user_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
    AND private.is_user_eligible((SELECT auth.uid()))
  );

-- Note: account_controls, curator_access, curator_audit, deleted_accounts,
-- and rate_limit_buckets have zero policies for anon/authenticated/catalog_reader,
-- denying all direct SELECT and writes.

-- 9. Full-Text Search Query Builder (Stemmed Plurals + Last-Token Prefix + Websearch)
CREATE OR REPLACE FUNCTION public.build_catalog_tsquery(p_q text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_trimmed text;
  v_base_q tsquery;
  v_tokens text[];
  v_token_count integer;
  v_last_token text;
  v_last_lexemes text[];
  v_prefix_q tsquery;
  v_earlier_text text;
  v_earlier_q tsquery;
BEGIN
  IF p_q IS NULL THEN
    RETURN NULL;
  END IF;

  v_trimmed := pg_catalog.btrim(p_q);
  IF v_trimmed = '' THEN
    RETURN NULL;
  END IF;

  IF pg_catalog.char_length(v_trimmed) > 100 THEN
    RAISE EXCEPTION 'QUERY_TOO_LONG: search query exceeds 100 characters'
      USING ERRCODE = '22023';
  END IF;

  v_base_q := pg_catalog.websearch_to_tsquery('english', v_trimmed);

  -- Check if plain word query (only alphanumeric tokens and whitespace, no quotes or negation operators)
  IF v_trimmed ~ '^[A-Za-z0-9]+([[:space:]]+[A-Za-z0-9]+)*$' THEN
    v_tokens := pg_catalog.regexp_split_to_array(v_trimmed, '[[:space:]]+');
    v_token_count := COALESCE(pg_catalog.array_length(v_tokens, 1), 0);

    IF v_token_count >= 1 THEN
      v_last_token := v_tokens[v_token_count];

      -- Last token stemmed prefix match when >= 3 chars and yields a single lexeme
      IF pg_catalog.char_length(v_last_token) >= 3 AND pg_catalog.lower(v_last_token) <> 'or' THEN
        v_last_lexemes := pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('english', v_last_token));

        IF COALESCE(pg_catalog.array_length(v_last_lexemes, 1), 0) = 1 THEN
          v_prefix_q := pg_catalog.to_tsquery('english', v_last_lexemes[1] || ':*');

          IF v_token_count = 1 THEN
            IF v_base_q IS NOT NULL AND v_base_q::text <> '' THEN
              RETURN v_base_q || v_prefix_q;
            ELSE
              RETURN v_prefix_q;
            END IF;
          ELSE
            v_earlier_text := pg_catalog.array_to_string(v_tokens[1:v_token_count - 1], ' ');
            v_earlier_q := pg_catalog.websearch_to_tsquery('english', v_earlier_text);

            IF v_earlier_q IS NOT NULL AND v_earlier_q::text <> '' THEN
              IF v_base_q IS NOT NULL AND v_base_q::text <> '' THEN
                RETURN v_base_q || (v_earlier_q && v_prefix_q);
              ELSE
                RETURN v_earlier_q && v_prefix_q;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_base_q;
END;
$$;

-- 10. Catalog Search RPC (SECURITY DEFINER owned by catalog_reader)
CREATE OR REPLACE FUNCTION public.search_catalog_discover(
  p_as_of timestamptz DEFAULT now(),
  p_q text DEFAULT NULL,
  p_type public.event_type DEFAULT NULL,
  p_mode public.event_mode DEFAULT NULL,
  p_price public.price_status DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_distance text DEFAULT NULL,
  p_sort text DEFAULT 'start',
  p_cursor_ongoing_rank integer DEFAULT NULL,
  p_cursor_deadline_at timestamptz DEFAULT NULL,
  p_cursor_deadline_is_null boolean DEFAULT NULL,
  p_cursor_effective_start_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  title text,
  organizer text,
  event_type public.event_type,
  mode public.event_mode,
  price_status public.price_status,
  city_slug text,
  city_name text,
  city_state text,
  venue text,
  event_timezone text,
  is_all_day boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  start_on date,
  end_on date,
  effective_start_at timestamptz,
  effective_end_at timestamptz,
  is_ongoing boolean,
  registration_deadline_at timestamptz,
  registration_deadline_on date,
  registration_closed boolean,
  sortable_deadline_at timestamptz,
  primary_source_slug text,
  primary_source_name text,
  primary_source_attribution text,
  primary_source_url text,
  distance_Center_estimate_km numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tsquery tsquery;
  v_origin_center extensions.geography(Point, 4326);
  v_bounded_limit integer;
  v_sort text;
BEGIN
  v_sort := COALESCE(p_sort, 'start');
  IF v_sort NOT IN ('start', 'deadline') THEN
    RAISE EXCEPTION 'INVALID_SORT: sort must be start or deadline'
      USING ERRCODE = '22023';
  END IF;

  IF p_distance IS NOT NULL THEN
    IF p_distance NOT IN ('nearby', 'farther') THEN
      RAISE EXCEPTION 'INVALID_DISTANCE: distance must be nearby or farther'
        USING ERRCODE = '22023';
    END IF;
    IF p_city IS NULL OR pg_catalog.btrim(p_city) = '' THEN
      RAISE EXCEPTION 'DISTANCE_REQUIRES_CITY: distance filter requires a city'
        USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'online' THEN
      RAISE EXCEPTION 'ONLINE_DISTANCE_CONFLICT: mode=online cannot be combined with distance'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_city IS NOT NULL AND pg_catalog.btrim(p_city) <> '' THEN
    SELECT c.center
      INTO v_origin_center
      FROM public.cities c
     WHERE c.slug = p_city;

    IF v_origin_center IS NULL THEN
      RAISE EXCEPTION 'INVALID_CITY: unknown city slug %', p_city
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_tsquery := public.build_catalog_tsquery(p_q);
  v_bounded_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25);

  RETURN QUERY
  WITH candidate_events AS (
    SELECT
      e.id,
      e.title,
      e.organizer,
      e.event_type,
      e.mode,
      e.price_status,
      c.slug AS city_slug,
      c.name AS city_name,
      c.state AS city_state,
      e.venue,
      e.event_timezone,
      e.is_all_day,
      e.starts_at,
      e.ends_at,
      e.start_on,
      e.end_on,
      public.event_effective_start_at(e.is_all_day, e.starts_at, e.start_on, e.event_timezone) AS eff_start_at,
      public.event_effective_end_at(e.is_all_day, e.starts_at, e.ends_at, e.start_on, e.end_on, e.event_timezone) AS eff_end_at,
      e.registration_deadline_at,
      e.registration_deadline_on,
      e.registration_closed,
      CASE
        WHEN e.registration_deadline_at IS NOT NULL
         AND NOT e.registration_closed
         AND e.registration_deadline_at > p_as_of
        THEN e.registration_deadline_at
        ELSE NULL
      END AS sort_deadline_at,
      ps.source_slug AS primary_source_slug,
      ps.display_name AS primary_source_name,
      ps.attribution_text AS primary_source_attribution,
      ps.public_url AS primary_source_url,
      CASE
        WHEN v_origin_center IS NOT NULL AND c.center IS NOT NULL THEN
          pg_catalog.round((extensions.ST_Distance(c.center, v_origin_center) / 1000.0)::numeric, 1)
        ELSE NULL
      END AS distance_km,
      c.center AS city_center
    FROM public.events e
    LEFT JOIN public.cities c
      ON c.id = e.city_id
    JOIN LATERAL (
      SELECT
        es.source_slug,
        s.display_name,
        s.attribution_text,
        es.public_url
      FROM public.event_sources es
      JOIN public.sources s
        ON s.slug = es.source_slug
      WHERE es.event_id = e.id
        AND es.is_primary = true
      LIMIT 1
    ) ps ON true
    WHERE e.status = 'published'
      AND public.event_effective_end_at(e.is_all_day, e.starts_at, e.ends_at, e.start_on, e.end_on, e.event_timezone) > p_as_of
      AND (
        v_tsquery IS NULL
        OR pg_catalog.to_tsvector(
          'english',
          COALESCE(e.title, '') || ' ' || COALESCE(e.organizer, '') || ' ' || COALESCE(e.summary, '')
        ) @@ v_tsquery
      )
      AND (p_type IS NULL OR e.event_type = p_type)
      AND (
        p_mode IS NULL
        OR (p_mode = 'online' AND e.mode IN ('online', 'hybrid'))
        OR (p_mode = 'in_person' AND e.mode IN ('in_person', 'hybrid'))
        OR (p_mode = 'hybrid' AND e.mode = 'hybrid')
      )
      AND (p_price IS NULL OR e.price_status = p_price)
      AND (
        p_source IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.event_sources es_filter
          JOIN public.sources s_filter
            ON s_filter.slug = es_filter.source_slug
          WHERE es_filter.event_id = e.id
            AND es_filter.source_slug = p_source
        )
      )
      AND (
        p_city IS NULL
        OR (
          p_distance IS NULL AND c.slug = p_city
        )
        OR (
          p_distance = 'nearby'
          AND e.mode IN ('in_person', 'hybrid')
          AND c.center IS NOT NULL
          AND extensions.ST_DWithin(c.center, v_origin_center, 50000)
        )
        OR (
          p_distance = 'farther'
          AND e.mode IN ('in_person', 'hybrid')
          AND c.center IS NOT NULL
          AND NOT extensions.ST_DWithin(c.center, v_origin_center, 50000)
        )
      )
  ),
  ranked_events AS (
    SELECT
      ce.*,
      (ce.eff_start_at <= p_as_of) AS ongoing_flag,
      CASE WHEN ce.eff_start_at <= p_as_of THEN 0 ELSE 1 END AS ongoing_rank
    FROM candidate_events ce
  )
  SELECT
    re.id,
    re.title,
    re.organizer,
    re.event_type,
    re.mode,
    re.price_status,
    re.city_slug,
    re.city_name,
    re.city_state,
    re.venue,
    re.event_timezone,
    re.is_all_day,
    re.starts_at,
    re.ends_at,
    re.start_on,
    re.end_on,
    re.eff_start_at AS effective_start_at,
    re.eff_end_at AS effective_end_at,
    re.ongoing_flag AS is_ongoing,
    re.registration_deadline_at,
    re.registration_deadline_on,
    re.registration_closed,
    re.sort_deadline_at AS sortable_deadline_at,
    re.primary_source_slug,
    re.primary_source_name,
    re.primary_source_attribution,
    re.primary_source_url,
    re.distance_km AS distance_center_estimate_km
  FROM ranked_events re
  WHERE (
    p_cursor_id IS NULL
    OR (
      v_sort = 'start'
      AND (re.ongoing_rank, re.eff_start_at, re.id) >
          (p_cursor_ongoing_rank, p_cursor_effective_start_at, p_cursor_id)
    )
    OR (
      v_sort = 'deadline'
      AND (
        (
          COALESCE(p_cursor_deadline_is_null, true) = false
          AND (
            (
              re.sort_deadline_at IS NOT NULL
              AND (re.sort_deadline_at, re.eff_start_at, re.id) >
                  (p_cursor_deadline_at, p_cursor_effective_start_at, p_cursor_id)
            )
            OR re.sort_deadline_at IS NULL
          )
        )
        OR (
          COALESCE(p_cursor_deadline_is_null, true) = true
          AND re.sort_deadline_at IS NULL
          AND (re.eff_start_at, re.id) > (p_cursor_effective_start_at, p_cursor_id)
        )
      )
    )
  )
  ORDER BY
    CASE WHEN v_sort = 'start' THEN re.ongoing_rank ELSE NULL END ASC,
    CASE WHEN v_sort = 'deadline' THEN re.sort_deadline_at ELSE NULL END ASC NULLS LAST,
    re.eff_start_at ASC,
    re.id ASC
  LIMIT v_bounded_limit;
END;
$$;

ALTER FUNCTION public.search_catalog_discover(
  timestamptz, text, public.event_type, public.event_mode, public.price_status,
  text, text, text, text, integer, timestamptz, boolean, timestamptz, uuid, integer
) OWNER TO catalog_reader;

-- Server-only EXECUTE per ARCHITECTURE.md (with catalog_reader allowed for pgTAP verification)
REVOKE ALL ON FUNCTION public.search_catalog_discover(
  timestamptz, text, public.event_type, public.event_mode, public.price_status,
  text, text, text, text, integer, timestamptz, boolean, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_catalog_discover(
  timestamptz, text, public.event_type, public.event_mode, public.price_status,
  text, text, text, text, integer, timestamptz, boolean, timestamptz, uuid, integer
) TO service_role, catalog_reader;

COMMIT;
