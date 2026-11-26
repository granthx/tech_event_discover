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
    'react-india-community',
    'React & Web India',
    'Listed via React & Web India',
    'Organizer permitted public factual listing and direct registration link',
    'seed-approval-react-india-2026-11',
    ARRAY['title', 'organizer', 'schedule', 'city', 'public_url'],
    '2026-11-26',
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

-- 3. Verified R1 beta catalog (12 upcoming events within 45 days across 3 approved sources;
--    4 online, 5 in-person, 3 hybrid)
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
  start_on,
  end_on,
  registration_deadline_at,
  registration_deadline_on,
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
    NULL,
    NULL,
    now() + interval '5 days',
    NULL,
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
    NULL,
    NULL,
    now() + interval '8 days',
    NULL,
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
    NULL,
    NULL,
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222204',
    'published',
    1,
    'Mysuru Open Source Mentorship & Hack Day',
    'FOSS United',
    'Full-day student mentorship and open-source sprint in Mysuru for first-time contributors.',
    'hackathon',
    'in_person',
    'free',
    '11111111-1111-4111-8111-111111111103',
    'Mysuru Engineering Campus Auditorium',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '12 days',
    now() + interval '12 days 8 hours',
    NULL,
    NULL,
    now() + interval '9 days',
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222205',
    'published',
    1,
    'Web Accessibility & WCAG 2.2 Clinic',
    'React & Web India',
    'Interactive online clinic auditing keyboard navigation, focus states, and screen-reader semantics.',
    'workshop',
    'online',
    'free',
    NULL,
    NULL,
    true,
    'Asia/Kolkata',
    false,
    now() + interval '15 days',
    now() + interval '15 days 2 hours 30 minutes',
    NULL,
    NULL,
    now() + interval '13 days',
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222206',
    'published',
    1,
    'Mumbai Web Performance & Next.js Conference',
    'React & Web India',
    'Single-track engineering conference on Core Web Vitals, edge caching, and modern React server patterns.',
    'conference',
    'in_person',
    'paid',
    '11111111-1111-4111-8111-111111111104',
    'BKC Civic Tech Hall',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '18 days',
    now() + interval '18 days 8 hours',
    NULL,
    NULL,
    now() + interval '14 days',
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222207',
    'published',
    1,
    'Hyderabad Cloud Native & eBPF Meetup',
    'FOSS United',
    'Community talks and live demos on Linux observability, eBPF tracing, and container networking.',
    'meetup',
    'hybrid',
    'free',
    '11111111-1111-4111-8111-111111111106',
    'HITEC City Open Auditorium',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '20 days',
    now() + interval '20 days 3 hours',
    NULL,
    NULL,
    NULL,
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222208',
    'published',
    1,
    'Systems Safety & Borrow Checker Seminar',
    'Rust India Community',
    'Deep-dive online seminar exploring ownership lifetimes, pin projections, and zero-copy parsing.',
    'seminar',
    'online',
    'free',
    NULL,
    NULL,
    true,
    'Asia/Kolkata',
    false,
    now() + interval '23 days',
    now() + interval '23 days 2 hours',
    NULL,
    NULL,
    now() + interval '21 days',
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222209',
    'published',
    1,
    'Delhi Winter Open Source Code Sprint',
    'FOSS United',
    'Two-day all-day collaborative sprint in New Delhi fixing upstream issues across public-good repositories.',
    'hackathon',
    'in_person',
    'free',
    '11111111-1111-4111-8111-111111111105',
    'Connaught Place Community Commons',
    false,
    'Asia/Kolkata',
    true,
    NULL,
    NULL,
    (current_date + 25),
    (current_date + 27),
    NULL,
    (current_date + 23),
    false
  ),
  (
    '22222222-2222-4222-8222-222222222210',
    'published',
    1,
    'Chennai Modern Frontend & State Architecture Meetup',
    'React & Web India',
    'Morning hybrid meetup covering resilient forms, URL state design, and browser testing workflows.',
    'meetup',
    'hybrid',
    'free',
    '11111111-1111-4111-8111-111111111107',
    'OMR Developer Hub',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '28 days',
    now() + interval '28 days 3 hours 30 minutes',
    NULL,
    NULL,
    now() + interval '26 days',
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222211',
    'published',
    1,
    'Embedded Rust on Microcontrollers Lab',
    'Rust India Community',
    'Live online lab session programming RP2040 and ESP32 targets with no_std Rust toolchains.',
    'workshop',
    'online',
    'unknown',
    NULL,
    NULL,
    true,
    'UTC',
    false,
    now() + interval '32 days',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222212',
    'published',
    1,
    'Pune Systems & DevTools Summit 2026',
    'Rust India Community',
    'Full-day engineering summit in Pune featuring talks on compilers, storage engines, and developer productivity.',
    'conference',
    'in_person',
    'paid',
    '11111111-1111-4111-8111-111111111108',
    'Baner Convention Studio',
    false,
    'Asia/Kolkata',
    false,
    now() + interval '38 days',
    now() + interval '38 days 8 hours',
    NULL,
    NULL,
    now() + interval '34 days',
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
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '22222222-2222-4222-8222-222222222204',
    'foss-united',
    'https://fossunited.org/events/mysuru-open-source-day-2026',
    'https://fossunited.org/events/mysuru-open-source-day-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333305',
    '22222222-2222-4222-8222-222222222205',
    'react-india-community',
    'https://reactindia.org/workshops/wcag-22-clinic-2026',
    'https://reactindia.org/workshops/wcag-22-clinic-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333306',
    '22222222-2222-4222-8222-222222222206',
    'react-india-community',
    'https://reactindia.org/conferences/mumbai-web-perf-2026',
    'https://reactindia.org/conferences/mumbai-web-perf-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333307',
    '22222222-2222-4222-8222-222222222207',
    'foss-united',
    'https://fossunited.org/events/hyderabad-cloud-ebpf-2026',
    'https://fossunited.org/events/hyderabad-cloud-ebpf-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333308',
    '22222222-2222-4222-8222-222222222208',
    'rust-india',
    'https://rustindia.org/seminars/borrow-checker-deep-dive-2026',
    'https://rustindia.org/seminars/borrow-checker-deep-dive-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333309',
    '22222222-2222-4222-8222-222222222209',
    'foss-united',
    'https://fossunited.org/events/delhi-winter-sprint-2026',
    'https://fossunited.org/events/delhi-winter-sprint-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333310',
    '22222222-2222-4222-8222-222222222210',
    'react-india-community',
    'https://reactindia.org/meetups/chennai-frontend-2026',
    'https://reactindia.org/meetups/chennai-frontend-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333311',
    '22222222-2222-4222-8222-222222222211',
    'rust-india',
    'https://rustindia.org/workshops/embedded-rust-lab-2026',
    'https://rustindia.org/workshops/embedded-rust-lab-2026',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333312',
    '22222222-2222-4222-8222-222222222212',
    'rust-india',
    'https://rustindia.org/conferences/pune-systems-summit-2027',
    'https://rustindia.org/conferences/pune-systems-summit-2027',
    true
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
