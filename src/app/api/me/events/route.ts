import { NextResponse } from "next/server";
import { z } from "zod";
import type { UserTrackingMap } from "@/features/catalog/types";
import { jsonError } from "@/lib/security/http";
import { createSupabaseSessionServerClient } from "@/lib/supabase/server";

const idsParamSchema = z
  .array(z.string().uuid())
  .max(24, "Cannot request more than 24 event IDs at once.");

/**
 * GET /api/me/events?ids=uuid1,uuid2,...
 * Accepts up to 24 event IDs and returns the caller's tracking states only.
 * Uses private, no-store cache directive.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawIdsParam = url.searchParams.get("ids");
  const rawList = rawIdsParam
    ? rawIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];

  const parsedIds = idsParamSchema.safeParse(rawList);
  if (!parsedIds.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      parsedIds.error.issues[0]?.message ?? "Invalid event IDs parameter."
    );
  }

  const eventIds = parsedIds.data;
  const items: UserTrackingMap = {};

  if (eventIds.length === 0) {
    return NextResponse.json(
      { items },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }

  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const isPlaceholderEnv =
    !pubKey || pubKey.includes("placeholder") || pubKey.includes("test_key");

  if (!isPlaceholderEnv) {
    try {
      const supabase = await createSupabaseSessionServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: rows } = await supabase
          .from("user_events")
          .select("event_id, state")
          .in("event_id", eventIds);

        for (const row of rows ?? []) {
          items[row.event_id] = row.state;
        }
      }
    } catch {
      // Return empty map if session cannot be verified
    }
  }

  return NextResponse.json(
    { items },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
