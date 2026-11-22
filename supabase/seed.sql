-- =============================================================================
-- Tech Event Discover · R1-MUST Local Seed Data
-- Approved Indian cities, approved sources, and representative beta events
-- =============================================================================

BEGIN;

-- 1. Indian reference cities with accurate city-center coordinates
INSERT INTO public.cities (id, slug, name, state, center)
VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    'bengaluru',
    'Bengaluru',
    'Karnataka',
    extensions.ST_SetSRID(extensions.ST_MakePoint(77.5946, 12.9716), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    'hosur',
    'Hosur',
    'Tamil Nadu',
    -- ~39 km from Bengaluru city center (inside 50 km nearby cutoff)
    extensions.ST_SetSRID(extensions.ST_MakePoint(77.8253, 12.7409), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    'mysuru',
    'Mysuru',
    'Karnataka',
    -- ~128 km from Bengaluru city center (outside 50 km cutoff)
    extensions.ST_SetSRID(extensions.ST_MakePoint(76.6394, 12.2958), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111104',
    'mumbai',
    'Mumbai',
    'Maharashtra',
    extensions.ST_SetSRID(extensions.ST_MakePoint(72.8777, 19.0760), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111105',
    'delhi',
    'New Delhi',
    'Delhi',
    extensions.ST_SetSRID(extensions.ST_MakePoint(77.2090, 28.6139), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111106',
    'hyderabad',
    'Hyderabad',
    'Telangana',
    extensions.ST_SetSRID(extensions.ST_MakePoint(78.4867, 17.3850), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111107',
    'chennai',
    'Chennai',
    'Tamil Nadu',
    extensions.ST_SetSRID(extensions.ST_MakePoint(80.2707, 13.0827), 4326)::extensions.geography
  ),
  (
    '11111111-1111-4111-8111-111111111108',
    'pune',
    'Pune',
    'Maharashtra',
    extensions.ST_SetSRID(extensions.ST_MakePoint(73.8567, 18.5204), 4326)::extensions.geography
  )
ON CONFLICT (slug) DO NOTHING;

-- 2. Approved source registry records
INSERT INTO public.sources (
  slug,
  display_name,
  attribution_text,
  permission_basis,
  evidence_ref,
  allowed_fields,
  reviewed_on,
  permission_status
)
VALUES
  (
    'foss-united',
    'FOSS United',
    'Listed via FOSS United community events',
    'Organizer permitted public factual listing and direct registration link',
    'seed-approval-foss-united-2026-11',
    ARRAY['title', 'organizer', 'schedule', 'city', 'public_url'],
    '2026-11-22',
    'approved'
  ),
  (
    'rust-india',
    'Rust India Community',
    'Listed via Rust India Community',
    'Organizer permitted public factual listing and direct registration link',
    'seed-approval-rust-india-2026-11',
    ARRAY['title', 'organizer', 'schedule', 'city', 'public_url'],
    '2026-11-22',
    'approved'
  ),
  (
    'pending-partner',
    'Pending Partner',
    'Pending Partner Attribution',
    NULL,
    NULL,
    '{}'::text[],
    NULL,
    'pending'
  )
ON CONFLICT (slug) DO NOTHING;

-- 3. Sample published events (with primary sources in same transaction)
INSERT INTO public.events (
  id,
  status,
  version,
  title,
  organizer,
  summary,
  event_type,
  mode,
  price_status,
  city_id,
  venue,
  online_india_access_confirmed,
  event_timezone,
  is_all_day,
  starts_at,
  ends_at,
  registration_deadline_at,
  registration_closed
)
VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    'published',
    1,
    'India Systems Hackathon 2026',
    'FOSS United',
    'A weekend systems programming hackathon focused on distributed databases and developer tooling.',
    'hackathon',
    'in_person',
    'free',
    '11111111-1111-4111-8111-111111111101',
    'Indiranagar Community Hall',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '7 days',
    now() + interval '8 days',
    now() + interval '5 days',
    false
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'published',
    1,
    'Async Rust Workshop for Early-Career Engineers',
    'Rust India Community',
    'Hands-on online workshop covering Tokio, async traits, and structured concurrency accessible across India.',
    'workshop',
    'online',
    'free',
    NULL,
    NULL,
    true,
    'UTC',
    false,
    now() + interval '10 days',
    NULL,
    now() + interval '8 days',
    false
  ),
  (
    '22222222-2222-4222-8222-222222222203',
    'published',
    1,
    'Hosur Hardware & Embedded Meetup',
    'FOSS United',
    'Hybrid meetup on embedded Linux and RISC-V boards near the Bengaluru-Hosur corridor.',
    'meetup',
    'hybrid',
    'unknown',
    '11111111-1111-4111-8111-111111111102',
    'Hosur Tech Park Auditorium',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '14 days',
    now() + interval '14 days 3 hours',
    NULL,
    false
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sources (
  id,
  event_id,
  source_slug,
  public_url,
  url_key,
  is_primary
)
VALUES
  (
    '33333333-3333-4333-8333-333333333301',
    '22222222-2222-4222-8222-222222222201',
    'foss-united',
    'https://fossunited.org/events/india-systems-hackathon-2026',
    'https://fossunited.org/events/india-systems-hackathon-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '22222222-2222-4222-8222-222222222202',
    'rust-india',
    'https://rustindia.org/workshops/async-rust-2026',
    'https://rustindia.org/workshops/async-rust-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '22222222-2222-4222-8222-222222222203',
    'foss-united',
    'https://fossunited.org/events/hosur-embedded-meetup-2026',
    'https://fossunited.org/events/hosur-embedded-meetup-2026',
    true
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
