import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Anonymous, session-independent client for public catalog and public detail reads.
 * Does NOT read or write cookies and never refreshes user sessions.
 */
export function createSupabaseAnonymousServerClient() {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

/**
 * Session-bound client for authenticated member and curator operations.
 * Curator mutations MUST pass this verified user session client so auth.uid() and JWT aal='aal2' reach SQL RPCs.
 */
export async function createSupabaseSessionServerClient(): Promise<
  SupabaseClient<Database>
> {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component read context cannot mutate response cookies directly; proxy handles refresh.
          }
        },
      },
    }
  ) as unknown as SupabaseClient<Database>;
}

/**
 * Restricted server-only service-role client.
 * Used ONLY for server-only catalog_reader RPC execution and restricted account admission/deletion tasks.
 * Never used to bypass curator session checks.
 */
export function createSupabaseServiceServerClient() {
  const env = getServerEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
