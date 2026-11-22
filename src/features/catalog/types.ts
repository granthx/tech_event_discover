import type {
  CancellationReason,
  EventMode,
  EventStatus,
  EventType,
  PriceStatus,
  TrackingState,
} from "@/lib/database.types";

export type CatalogSort = "start" | "deadline";
export type DistanceFilter = "nearby" | "farther";

export interface DiscoverFilters {
  q?: string;
  type?: EventType;
  mode?: EventMode;
  price?: PriceStatus;
  source?: string;
  city?: string;
  distance?: DistanceFilter;
  sort: CatalogSort;
  cursor?: string;
}

export interface CatalogCard {
  id: string;
  title: string;
  organizer: string;
  eventType: EventType;
  mode: EventMode;
  priceStatus: PriceStatus;
  citySlug: string | null;
  cityName: string | null;
  cityState: string | null;
  venue: string | null;
  eventTimezone: string;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  effectiveStartAt: string;
  effectiveEndAt: string;
  isOngoing: boolean;
  registrationDeadlineAt: string | null;
  registrationDeadlineOn: string | null;
  registrationClosed: boolean;
  primarySource: {
    slug: string;
    name: string;
    attribution: string;
    url: string;
  };
  distanceEstimateKm: number | null;
}

export interface CatalogDiscoverResponse {
  items: CatalogCard[];
  nextCursor: string | null;
}

export interface EventSourceLink {
  id: string;
  slug: string;
  name: string;
  attribution: string;
  url: string;
  isPrimary: boolean;
}

export interface EventDetailView {
  id: string;
  status: Extract<EventStatus, "published" | "canceled">;
  version: number;
  title: string;
  organizer: string;
  summary: string | null;
  eventType: EventType;
  mode: EventMode;
  priceStatus: PriceStatus;
  citySlug: string | null;
  cityName: string | null;
  cityState: string | null;
  venue: string | null;
  onlineIndiaAccessConfirmed: boolean;
  eventTimezone: string;
  isAllDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startOn: string | null;
  endOn: string | null;
  effectiveStartAt: string;
  effectiveEndAt: string;
  isOngoing: boolean;
  isEnded: boolean;
  registrationDeadlineAt: string | null;
  registrationDeadlineOn: string | null;
  registrationClosed: boolean;
  canceledAt: string | null;
  cancellationReason: CancellationReason | null;
  sources: EventSourceLink[];
}

export type UserTrackingMap = Record<string, TrackingState>;
