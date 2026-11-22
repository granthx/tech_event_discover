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
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder_key",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
  });
}

export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse({
    APP_ORIGIN: process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder_key",
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_service_role_placeholder_key",
    RATE_LIMIT_DIGEST_KEY:
      process.env.RATE_LIMIT_DIGEST_KEY ??
      "0000000000000000000000000000000000000000000000000000000000000000",
    PUBLIC_OWNER_NAME:
      process.env.PUBLIC_OWNER_NAME ?? "Tech Event Discover (Curated Beta)",
    PUBLIC_CONTACT_EMAIL:
      process.env.PUBLIC_CONTACT_EMAIL ?? "contact@example.org",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY:
      process.env.TURNSTILE_SECRET_KEY ?? "1x0000000000000000000000000000000AA",
  });
}
