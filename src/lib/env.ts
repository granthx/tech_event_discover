import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
});

const serverEnvSchema = publicEnvSchema.extend({
  APP_ORIGIN: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RATE_LIMIT_DIGEST_KEY: z.string().min(32),
  PUBLIC_OWNER_NAME: z.string().min(1),
  PUBLIC_CONTACT_EMAIL: z.string().email(),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  AUTH_SIGNUP_ENABLED: z.boolean(),
  RESEND_API_KEY: z.string().min(1),
  REMINDER_FROM_EMAIL: z.string().email(),
  RESEND_WEBHOOK_SECRET: z.string().min(1),
  RECIPIENT_DIGEST_KEY: z.string().min(32),
  REMINDER_CONSENT_NOTICE_VERSION: z.string().min(1),
  REMINDER_SEND_ENABLED: z.boolean(),
  REMINDER_DELIVERY_MODE: z.enum(["smoke", "live"]),
  REMINDER_SMOKE_ALLOWLIST: z.string(),
  REMINDER_HEARTBEAT_URL: z.string().url().nullable(),
  JOB_ALERT_RECIPIENT: z.string().email(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  return defaultValue;
}

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL:
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() ||
      "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim() ||
      "sb_publishable_placeholder_key",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim() ||
      "1x00000000000000000000AA",
  });
}

export function getServerEnv(): ServerEnv {
  const rawDeliveryMode = (process.env.REMINDER_DELIVERY_MODE ?? "")
    .trim()
    .toLowerCase();
  const rawHeartbeatUrl = (process.env.REMINDER_HEARTBEAT_URL ?? "").trim();

  return serverEnvSchema.parse({
    APP_ORIGIN:
      (process.env.APP_ORIGIN ?? "").trim() || "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL:
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() ||
      "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim() ||
      "sb_publishable_placeholder_key",
    SUPABASE_SERVICE_ROLE_KEY:
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
      "sb_secret_service_role_placeholder_key",
    RATE_LIMIT_DIGEST_KEY:
      (process.env.RATE_LIMIT_DIGEST_KEY ?? "").trim() ||
      "0000000000000000000000000000000000000000000000000000000000000000",
    PUBLIC_OWNER_NAME:
      (process.env.PUBLIC_OWNER_NAME ?? "").trim() ||
      "Tech Event Discover (Curated Beta)",
    PUBLIC_CONTACT_EMAIL:
      (process.env.PUBLIC_CONTACT_EMAIL ?? "").trim() || "contact@example.org",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim() ||
      "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY:
      (process.env.TURNSTILE_SECRET_KEY ?? "").trim() ||
      "1x0000000000000000000000000000000AA",
    AUTH_SIGNUP_ENABLED: parseBooleanFlag(process.env.AUTH_SIGNUP_ENABLED, false),
    RESEND_API_KEY:
      (process.env.RESEND_API_KEY ?? "").trim() || "re_placeholder_api_key",
    REMINDER_FROM_EMAIL:
      (process.env.REMINDER_FROM_EMAIL ?? "").trim() || "reminders@example.org",
    RESEND_WEBHOOK_SECRET:
      (process.env.RESEND_WEBHOOK_SECRET ?? "").trim() ||
      "whsec_placeholder_secret",
    RECIPIENT_DIGEST_KEY:
      (process.env.RECIPIENT_DIGEST_KEY ?? "").trim() ||
      "0000000000000000000000000000000000000000000000000000000000000000",
    REMINDER_CONSENT_NOTICE_VERSION:
      (process.env.REMINDER_CONSENT_NOTICE_VERSION ?? "").trim() ||
      "2026-11-r2-v1",
    REMINDER_SEND_ENABLED: parseBooleanFlag(
      process.env.REMINDER_SEND_ENABLED,
      false
    ),
    REMINDER_DELIVERY_MODE:
      rawDeliveryMode === "live" ? "live" : "smoke",
    REMINDER_SMOKE_ALLOWLIST: (
      process.env.REMINDER_SMOKE_ALLOWLIST ?? ""
    ).trim(),
    REMINDER_HEARTBEAT_URL: rawHeartbeatUrl || null,
    JOB_ALERT_RECIPIENT:
      (process.env.JOB_ALERT_RECIPIENT ?? "").trim() || "alerts@example.org",
  });
}
