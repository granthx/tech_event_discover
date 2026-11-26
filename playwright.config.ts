import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    url: `${baseURL}/discover`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_TEST_MODE: "1",
      APP_ORIGIN: baseURL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_test_key",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_service_role_test_key",
      RATE_LIMIT_DIGEST_KEY:
        process.env.RATE_LIMIT_DIGEST_KEY ??
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      PUBLIC_OWNER_NAME: process.env.PUBLIC_OWNER_NAME ?? "Tech Event Discover Beta",
      PUBLIC_CONTACT_EMAIL: process.env.PUBLIC_CONTACT_EMAIL ?? "contact@example.org",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY:
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY:
        process.env.TURNSTILE_SECRET_KEY ?? "1x0000000000000000000000000000000AA",
    },
  },
});
