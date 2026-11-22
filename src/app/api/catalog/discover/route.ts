import { NextResponse } from "next/server";
import { parseDiscoverSearchParams } from "@/features/catalog/filters";
import { queryDiscoverCatalog } from "@/features/catalog/service";
import { jsonError } from "@/lib/security/http";

/**
 * GET /api/catalog/discover
 * - Returns 200 { items, nextCursor } for a valid public query.
 * - Published active rows only, with no session data.
 * - Ignores cookies, emits no Set-Cookie, bypasses Auth session refresh.
 * - Shared cache headers on 200:
 *     Cache-Control: public, max-age=0, must-revalidate
 *     Vercel-CDN-Cache-Control: public, s-maxage=30
 * - No shared-cache directive on errors (Cache-Control: no-store).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedFilters = parseDiscoverSearchParams(url.searchParams);

  if (!parsedFilters.ok) {
    return jsonError(400, parsedFilters.code, parsedFilters.message);
  }

  const result = await queryDiscoverCatalog(parsedFilters.filters);
  if (!result.ok) {
    return jsonError(result.status, result.code, result.message);
  }

  return NextResponse.json(result.data, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "public, s-maxage=30",
    },
  });
}
