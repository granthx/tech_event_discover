import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { jsonError, verifySameOriginMutation } from "@/lib/security/http";

/**
 * POST /api/auth/signout
 * Revokes the caller's Supabase Auth session and clears all sb-* auth cookies on the response.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!verifySameOriginMutation(request, env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request denied.");
  }

  const pubEnv = getPublicEnv();
  const isPlaceholderEnv =
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") ||
    pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("test_key");

  const cookieStore = await cookies();
  const cookiesToApply: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  if (!isPlaceholderEnv) {
    try {
      const supabase = createServerClient<Database>(
        pubEnv.NEXT_PUBLIC_SUPABASE_URL,
        pubEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(
              nextCookies: Array<{
                name: string;
                value: string;
                options: CookieOptions;
              }>
            ) {
              cookiesToApply.push(...nextCookies);
            },
          },
        }
      );
      await supabase.auth.signOut();
    } catch {
      // Proceed to clear cookies even if upstream token already expired
    }
  }

  const response = NextResponse.json(
    { status: "signed_out" },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );

  for (const c of cookiesToApply) {
    response.cookies.set(c.name, c.value, c.options);
  }

  // Also explicitly expire any remaining sb-* cookies
  for (const existing of cookieStore.getAll()) {
    if (existing.name.startsWith("sb-")) {
      response.cookies.set(existing.name, "", {
        path: "/",
        maxAge: 0,
      });
    }
  }

  return response;
}
