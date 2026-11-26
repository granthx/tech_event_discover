import { NextResponse } from "next/server";
import { z } from "zod";
import { computeTokenSha256Hex } from "@/features/reminders/crypto";
import { jsonError } from "@/lib/security/http";
import { createSupabaseServiceServerClient } from "@/lib/supabase/server";

const tokenSchema = z.string().trim().min(16).max(512);

/**
 * POST /api/reminders/unsubscribe
 * Supports BOTH:
 * 1) RFC 8058 one-click mail-client POST (`List-Unsubscribe=One-Click` with `?token=...` or form field)
 * 2) Explicit confirmation POST (`application/json` `{ token }`) from `/unsubscribe`
 *
 * Never logs raw tokens or token-bearing URLs (ARCHITECTURE.md line 183).
 * Returns 204 for success, already opted-out, or preserved newer opt-in;
 * rejects invalid/expired tokens generically with 400.
 */
export async function POST(request: Request) {
  let candidateToken = "";

  try {
    const url = new URL(request.url);
    candidateToken = url.searchParams.get("token")?.trim() ?? "";
  } catch {
    return jsonError(400, "INVALID_REQUEST", "Invalid or expired unsubscribe link.");
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  if (!candidateToken) {
    try {
      const rawText = await request.text();
      if (rawText.length > 16_384) {
        return jsonError(413, "PAYLOAD_TOO_LARGE", "Request body too large.");
      }

      if (contentType.includes("application/json") && rawText.trim()) {
        const body = JSON.parse(rawText) as { token?: unknown };
        if (typeof body.token === "string") {
          candidateToken = body.token.trim();
        }
      } else if (
        contentType.includes("application/x-www-form-urlencoded") &&
        rawText.trim()
      ) {
        const params = new URLSearchParams(rawText);
        candidateToken = params.get("token")?.trim() ?? "";
      }
    } catch {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Invalid or expired unsubscribe link."
      );
    }
  }

  const parsedToken = tokenSchema.safeParse(candidateToken);
  if (!parsedToken.success) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Invalid or expired unsubscribe link."
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const isPlaceholderEnv =
    !serviceKey ||
    serviceKey.includes("placeholder") ||
    serviceKey.includes("test_key");

  if (isPlaceholderEnv) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Invalid or expired unsubscribe link."
    );
  }

  const digest = computeTokenSha256Hex(parsedToken.data);
  const supabase = createSupabaseServiceServerClient();

  const { data, error } = await supabase.rpc(
    "apply_reminder_unsubscribe_token" as never,
    { p_token_digest: digest } as never
  );

  if (error) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Invalid or expired unsubscribe link."
    );
  }

  const rows = (data ?? []) as Array<{
    http_status: number;
    outcome: string;
  }>;
  const result = rows[0];

  if (!result || result.http_status !== 204) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "Invalid or expired unsubscribe link."
    );
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
}
