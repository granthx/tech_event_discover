import type {
  CancellationReason,
  EventMode,
  EventStatus,
  EventType,
  PriceStatus,
} from "@/lib/database.types";

export interface CityFixture {
  id: string;
  slug: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface SourceFixture {
  slug: string;
  displayName: string;
  attributionText: string;
  permissionStatus: "pending" | "approved" | "withdrawn";
}

export interface EventFixture {
  id: string;
  status: EventStatus;
  version: number;
  title: string;
  organizer: string;
  summary: string | null;
  eventType: EventType;
  mode: EventMode;
  priceStatus: PriceStatus;
  citySlug: string | null;
  venue: string | null;
  onlineIndiaAccessConfirmed: boolean;
  eventTimezone: string;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  registrationDeadlineAt: string | null;
  registrationDeadlineOn: string | null;
  registrationClosed: boolean;
  canceledAt: string | null;
  cancellationReason: CancellationReason | null;
  sources: Array<{
    id: string;
    sourceSlug: string;
    publicUrl: string;
    isPrimary: boolean;
  }>;
}

export const REFERENCE_CITIES: CityFixture[] = [
  {
    id: "11111111-1111-4111-8111-111111111101",
    slug: "bengaluru",
    name: "Bengaluru",
    state: "Karnataka",
    lat: 12.9716,
    lon: 77.5946,
  },
  {
    id: "11111111-1111-4111-8111-111111111102",
    slug: "hosur",
    name: "Hosur",
    state: "Tamil Nadu",
    lat: 12.7409,
    lon: 77.8253, // ~35.9 km from Bengaluru center (<= 50 km)
  },
  {
    id: "11111111-1111-4111-8111-111111111103",
    slug: "mysuru",
    name: "Mysuru",
    state: "Karnataka",
    lat: 12.2958,
    lon: 76.6394, // ~128 km from Bengaluru center (> 50 km)
  },
  {
    id: "11111111-1111-4111-8111-111111111104",
    slug: "mumbai",
    name: "Mumbai",
    state: "Maharashtra",
    lat: 19.076,
    lon: 72.8777,
  },
  {
    id: "11111111-1111-4111-8111-111111111105",
    slug: "delhi",
    name: "New Delhi",
    state: "Delhi",
    lat: 28.6139,
    lon: 77.209,
  },
  {
    id: "11111111-1111-4111-8111-111111111106",
    slug: "hyderabad",
    name: "Hyderabad",
    state: "Telangana",
    lat: 17.385,
    lon: 78.4867,
  },
  {
    id: "11111111-1111-4111-8111-111111111107",
    slug: "chennai",
    name: "Chennai",
    state: "Tamil Nadu",
    lat: 13.0827,
    lon: 80.2707,
  },
  {
    id: "11111111-1111-4111-8111-111111111108",
    slug: "pune",
    name: "Pune",
    state: "Maharashtra",
    lat: 18.5204,
    lon: 73.8567,
  },
];

export const APPROVED_SOURCES: SourceFixture[] = [
  {
    slug: "foss-united",
    displayName: "FOSS United",
    attributionText: "Listed via FOSS United community events",
    permissionStatus: "approved",
  },
  {
    slug: "rust-india",
    displayName: "Rust India Community",
    attributionText: "Listed via Rust India Community",
    permissionStatus: "approved",
  },
  {
    slug: "react-india-community",
    displayName: "React & Web India",
    attributionText: "Listed via React & Web India",
    permissionStatus: "approved",
  },
];

export function buildCatalogFixtureEvents(referenceNow: Date = new Date()): EventFixture[] {
  const isoOffsetHours = (hours: number) =>
    new Date(referenceNow.getTime() + hours * 3600_000).toISOString();
  const isoOffsetDays = (days: number) =>
    new Date(referenceNow.getTime() + days * 86_400_000).toISOString();

  return [
    {
      id: "22222222-2222-4222-8222-222222222201",
      status: "published",
      version: 1,
      title: "India Systems Hackathon 2026",
      organizer: "FOSS United",
      summary:
        "A weekend systems programming hackathon focused on distributed databases and open source developer tooling.",
      eventType: "hackathon",
      mode: "in_person",
      priceStatus: "free",
      citySlug: "bengaluru",
      venue: "Indiranagar Community Hall",
      onlineIndiaAccessConfirmed: false,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(5),
      endsAt: isoOffsetDays(6),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: isoOffsetDays(3),
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333301",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/india-systems-hackathon-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      status: "published",
      version: 1,
      title: "Async Rust Workshop for Early-Career Engineers",
      organizer: "Rust India Community",
      summary:
        "Hands-on online workshop covering Tokio, async traits, and structured concurrency accessible across India.",
      eventType: "workshop",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "UTC",
      isAllDay: false,
      startsAt: isoOffsetDays(7),
      endsAt: null,
      startOn: null,
      endOn: null,
      registrationDeadlineAt: isoOffsetDays(6),
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333302",
          sourceSlug: "rust-india",
          publicUrl: "https://rustindia.org/workshops/async-rust-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      status: "published",
      version: 1,
      title: "Hosur Hardware & Embedded Meetup",
      organizer: "FOSS United",
      summary:
        "Hybrid meetup on embedded Linux and RISC-V boards near the Bengaluru-Hosur corridor.",
      eventType: "meetup",
      mode: "hybrid",
      priceStatus: "unknown",
      citySlug: "hosur",
      venue: "Hosur Tech Park Auditorium",
      onlineIndiaAccessConfirmed: false,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(10),
      endsAt: isoOffsetHours(10 * 24 + 3),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333303",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/hosur-embedded-meetup-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222204",
      status: "published",
      version: 1,
      title: "Mysuru Open Source Hackathons & Mentorship Day",
      organizer: "FOSS United",
      summary:
        "Full-day student mentorship and hackathons kickoff in Mysuru for first-time contributors.",
      eventType: "hackathon",
      mode: "in_person",
      priceStatus: "free",
      citySlug: "mysuru",
      venue: "Mysuru Engineering Campus",
      onlineIndiaAccessConfirmed: false,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(12),
      endsAt: isoOffsetHours(12 * 24 + 8),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: isoOffsetDays(2),
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333304",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/mysuru-open-source-day-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222205",
      status: "published",
      version: 1,
      title: "Mumbai Web Performance & Accessibility Conference",
      organizer: "React & Web India",
      summary:
        "Deep-dive talks on WCAG 2.2 AA compliance, Core Web Vitals, and Next.js App Router architecture.",
      eventType: "conference",
      mode: "in_person",
      priceStatus: "paid",
      citySlug: "mumbai",
      venue: "BKC Convention Centre",
      onlineIndiaAccessConfirmed: false,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(15),
      endsAt: isoOffsetHours(15 * 24 + 7),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: isoOffsetDays(11),
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333305",
          sourceSlug: "react-india-community",
          publicUrl: "https://reactindia.example.org/events/mumbai-web-perf-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222206",
      status: "published",
      version: 1,
      title: "Live Ongoing Compiler Office Hours",
      organizer: "Rust India Community",
      summary:
        "Interactive compiler internals Q&A session currently in progress with a two-hour discovery window.",
      eventType: "seminar",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetHours(-1), // started 1 hour ago, endsAt null -> active for 1 more hour!
      endsAt: null,
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333306",
          sourceSlug: "rust-india",
          publicUrl: "https://rustindia.org/seminars/compiler-office-hours-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222207",
      status: "canceled",
      version: 2,
      title: "Canceled Cloud Native Seminar",
      organizer: "FOSS United",
      summary: "This seminar was canceled by the organizer due to speaker unavailability.",
      eventType: "seminar",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(9),
      endsAt: isoOffsetHours(9 * 24 + 2),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: isoOffsetHours(-12),
      cancellationReason: "organizer_canceled",
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333307",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/canceled-cloud-seminar-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222208",
      status: "draft",
      version: 1,
      title: "Unpublished Draft Event",
      organizer: "FOSS United",
      summary: "Draft listing that must never appear in Discover or public details.",
      eventType: "meetup",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(20),
      endsAt: isoOffsetHours(20 * 24 + 2),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [
        {
          id: "33333333-3333-4333-8333-333333333308",
          sourceSlug: "foss-united",
          publicUrl: "https://fossunited.org/events/draft-hidden-2026",
          isPrimary: true,
        },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222209",
      status: "archived",
      version: 3,
      title: "Archived Event Listing",
      organizer: "Rust India Community",
      summary: "Archived listing that returns 404 on detail.",
      eventType: "meetup",
      mode: "online",
      priceStatus: "free",
      citySlug: null,
      venue: null,
      onlineIndiaAccessConfirmed: true,
      eventTimezone: "Asia/Kolkata",
      isAllDay: false,
      startsAt: isoOffsetDays(22),
      endsAt: isoOffsetHours(22 * 24 + 2),
      startOn: null,
      endOn: null,
      registrationDeadlineAt: null,
      registrationDeadlineOn: null,
      registrationClosed: false,
      canceledAt: null,
      cancellationReason: null,
      sources: [],
    },
  ];
}
