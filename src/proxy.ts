import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";

const PRIVATE_ROUTE_PREFIXES = [
  "/my-events",
  "/settings",
  "/admin",
  "/api/me",
  "/api/admin",
];

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Session refresh proxy for private routes only (`src/proxy.ts` per ARCHITECTURE.md).
 * Public catalog JSON (`/api/catalog/discover`) and static Discover shell (`/discover`)
 * deliberately bypass session refresh and emit no Set-Cookie headers.
 */
export async function refreshPrivateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!isPrivateRoute(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  response.headers.set("Cache-Control", "private, no-store");

  const env = getPublicEnv();
  const isPlaceholderEnv =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("test_key");

  if (isPlaceholderEnv) {
    return response;
  }

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({
            request,
          });
          response.headers.set("Cache-Control", "private, no-store");
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  await supabase.auth.getUser();
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  return refreshPrivateSession(request);
}
