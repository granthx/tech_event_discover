import { NextResponse } from "next/server";

export const MAX_BROWSER_JSON_BYTES = 16 * 1024; // 16 KiB per ARCHITECTURE.md

export type SafeErrorCode =
  | "INVALID_REQUEST"
  | "CURSOR_INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "SIGNUP_DISABLED"
  | "ADULT_ATTESTATION_REQUIRED"
  | "NOT_FOUND"
  | "EVENT_INACTIVE"
  | "INVALID_TRANSITION"
  | "VERSION_CONFLICT"
  | "SOURCE_URL_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "CORRELATION_PENDING"
  | "WORKER_EXECUTION_FAILED"
  | "INTERNAL_ERROR";

export function jsonError(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
  code: SafeErrorCode,
  message: string,
  extraHeaders?: Record<string, string>
) {
  return NextResponse.json(
    { code, message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(extraHeaders ?? {}),
      },
    }
  );
}

export function verifySameOriginMutation(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

export async function parseBoundedJsonBody<T>(
  request: Request
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BROWSER_JSON_BYTES) {
    return {
      ok: false,
      response: jsonError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB limit."),
    };
  }

  const rawText = await request.text();
  if (Buffer.byteLength(rawText, "utf8") > MAX_BROWSER_JSON_BYTES) {
    return {
      ok: false,
      response: jsonError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB limit."),
    };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) as T };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "INVALID_REQUEST", "Malformed JSON request body."),
    };
  }
}

export function validateSameOriginReturnPath(rawPath: string | null | undefined): string {
  if (!rawPath || typeof rawPath !== "string") {
    return "/discover";
  }
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/discover";
  }
  try {
    const parsed = new URL(trimmed, "http://127.0.0.1:3000");
    if (parsed.origin !== "http://127.0.0.1:3000") {
      return "/discover";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/discover";
  }
}
