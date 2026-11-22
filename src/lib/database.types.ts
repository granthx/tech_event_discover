export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type EventStatus = "draft" | "published" | "canceled" | "archived";
export type EventType =
  | "hackathon"
  | "workshop"
  | "seminar"
  | "meetup"
  | "conference"
  | "other";
export type EventMode = "online" | "in_person" | "hybrid";
export type PriceStatus = "free" | "paid" | "unknown";
export type CancellationReason =
  | "organizer_canceled"
  | "venue_unavailable"
  | "other_confirmed";
export type TrackingState = "saved" | "registered";

export type Database = {
  public: {
    Tables: {
      cities: {
        Row: {
          id: string;
          slug: string;
          name: string;
          state: string;
          center: unknown;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          state: string;
          center: unknown;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          state?: string;
          center?: unknown;
        };
        Relationships: [];
      };
      sources: {
        Row: {
          slug: string;
          display_name: string;
          attribution_text: string;
          permission_basis: string | null;
          evidence_ref: string | null;
          allowed_fields: string[];
          reviewed_on: string | null;
          permission_status: "pending" | "approved" | "withdrawn";
        };
        Insert: {
          slug: string;
          display_name: string;
          attribution_text: string;
          permission_basis?: string | null;
          evidence_ref?: string | null;
          allowed_fields?: string[];
          reviewed_on?: string | null;
          permission_status?: "pending" | "approved" | "withdrawn";
        };
        Update: {
          slug?: string;
          display_name?: string;
          attribution_text?: string;
          permission_basis?: string | null;
          evidence_ref?: string | null;
          allowed_fields?: string[];
          reviewed_on?: string | null;
          permission_status?: "pending" | "approved" | "withdrawn";
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          status: EventStatus;
          version: number;
          title: string | null;
          organizer: string | null;
          summary: string | null;
          event_type: EventType | null;
          mode: EventMode | null;
          price_status: PriceStatus;
          city_id: string | null;
          venue: string | null;
          online_india_access_confirmed: boolean;
          event_timezone: string | null;
          is_all_day: boolean | null;
          starts_at: string | null;
          ends_at: string | null;
          start_on: string | null;
          end_on: string | null;
          registration_deadline_at: string | null;
          registration_deadline_on: string | null;
          registration_closed: boolean;
          canceled_at: string | null;
          cancellation_reason: CancellationReason | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status?: EventStatus;
          version?: number;
          title?: string | null;
          organizer?: string | null;
          summary?: string | null;
          event_type?: EventType | null;
          mode?: EventMode | null;
          price_status?: PriceStatus;
          city_id?: string | null;
          venue?: string | null;
          online_india_access_confirmed?: boolean;
          event_timezone?: string | null;
          is_all_day?: boolean | null;
          starts_at?: string | null;
          ends_at?: string | null;
          start_on?: string | null;
          end_on?: string | null;
          registration_deadline_at?: string | null;
          registration_deadline_on?: string | null;
          registration_closed?: boolean;
          canceled_at?: string | null;
          cancellation_reason?: CancellationReason | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
        Relationships: [];
      };
      event_sources: {
        Row: {
          id: string;
          event_id: string;
          source_slug: string;
          public_url: string;
          url_key?: string;
          is_primary: boolean;
          verified_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          source_slug: string;
          public_url: string;
          url_key: string;
          is_primary?: boolean;
          verified_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_sources"]["Insert"]>;
        Relationships: [];
      };
      user_events: {
        Row: {
          user_id: string;
          event_id: string;
          state: TrackingState;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          event_id: string;
          state: TrackingState;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          state?: TrackingState;
          updated_at?: string;
        };
        Relationships: [];
      };
      account_controls: {
        Row: {
          user_id: string;
          adult_confirmed_at: string | null;
          deletion_requested_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          adult_confirmed_at?: string | null;
          deletion_requested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          adult_confirmed_at?: string | null;
          deletion_requested_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      curator_access: {
        Row: {
          user_id: string;
          active: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          active?: boolean;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      curator_audit: {
        Row: {
          id: string;
          actor_id: string | null;
          target_id: string;
          action: string;
          prior_version: number | null;
          new_version: number | null;
          recorded_at: string;
          reason_code: string;
          archived_url_keys: string[];
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          target_id: string;
          action: string;
          prior_version?: number | null;
          new_version?: number | null;
          recorded_at?: string;
          reason_code: string;
          archived_url_keys?: string[];
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          target_id?: string;
          action?: string;
          prior_version?: number | null;
          new_version?: number | null;
          recorded_at?: string;
          reason_code?: string;
          archived_url_keys?: string[];
        };
        Relationships: [];
      };
      deleted_accounts: {
        Row: {
          user_id: string;
          requested_at: string;
        };
        Insert: {
          user_id: string;
          requested_at?: string;
        };
        Update: {
          user_id?: string;
          requested_at?: string;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: {
          scope: string;
          key_digest: string;
          window_start: string;
          count: number;
        };
        Insert: {
          scope: string;
          key_digest: string;
          window_start: string;
          count?: number;
        };
        Update: {
          count?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      search_catalog_discover: {
        Args: {
          p_as_of?: string;
          p_q?: string | null;
          p_type?: EventType | null;
          p_mode?: EventMode | null;
          p_price?: PriceStatus | null;
          p_source?: string | null;
          p_city?: string | null;
          p_distance?: string | null;
          p_sort?: string;
          p_cursor_ongoing_rank?: number | null;
          p_cursor_deadline_at?: string | null;
          p_cursor_deadline_is_null?: boolean | null;
          p_cursor_effective_start_at?: string | null;
          p_cursor_id?: string | null;
          p_limit?: number;
        };
        Returns: Array<{
          id: string;
          title: string;
          organizer: string;
          event_type: EventType;
          mode: EventMode;
          price_status: PriceStatus;
          city_slug: string | null;
          city_name: string | null;
          city_state: string | null;
          venue: string | null;
          event_timezone: string;
          is_all_day: boolean;
          starts_at: string | null;
          ends_at: string | null;
          start_on: string | null;
          end_on: string | null;
          effective_start_at: string;
          effective_end_at: string;
          is_ongoing: boolean;
          registration_deadline_at: string | null;
          registration_deadline_on: string | null;
          registration_closed: boolean;
          sortable_deadline_at: string | null;
          primary_source_slug: string;
          primary_source_name: string;
          primary_source_attribution: string;
          primary_source_url: string;
          distance_center_estimate_km: number | null;
        }>;
      };
    };
    Enums: {
      event_status: EventStatus;
      event_type: EventType;
      event_mode: EventMode;
      price_status: PriceStatus;
      cancellation_reason: CancellationReason;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
