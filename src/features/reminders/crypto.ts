import crypto from "node:crypto";

/**
 * Generates a cryptographically random 32-byte URL-safe base64url token
 * (used for single-run 120s job dispatch bearers and 90-day unsubscribe tokens).
 */
export function generateRandomToken32(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Computes lowercase hex SHA-256 digest of an opaque token.
 */
export function computeTokenSha256Hex(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Computes keyed HMAC-SHA256 hex digest of a normalized email address.
 * Matches `private.compute_recipient_digest` in PostgreSQL.
 */
export function computeRecipientDigestHex(
  email: string,
  digestKey: string
): string {
  const normalized = email.trim().toLowerCase();
  return crypto
    .createHmac("sha256", Buffer.from(digestKey, "utf8"))
    .update(normalized, "utf8")
    .digest("hex");
}

export interface WebhookSignatureHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

/**
 * Verifies Resend / Svix webhook raw body, timestamp freshness, and HMAC-SHA256 signature
 * using the team's `RESEND_WEBHOOK_SECRET` (`whsec_<base64>`).
 */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: WebhookSignatureHeaders,
  webhookSecret: string,
  now: Date = new Date()
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature || !webhookSecret) {
    return false;
  }

  const tsSeconds = Number(svixTimestamp);
  if (!Number.isInteger(tsSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }

  const secretBase64 = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice("whsec_".length)
    : webhookSecret;

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretBase64, "base64");
    if (secretBytes.length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedBase64 = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expectedBase64, "utf8");

  const candidates = svixSignature
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const [version, sig] = candidate.split(",", 2);
    if (version !== "v1" || !sig) {
      continue;
    }
    const sigBuf = Buffer.from(sig, "utf8");
    if (
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Maps Resend webhook event payload to suppression action per ARCHITECTURE.md lines 185 & 237:
 * - Bounce type is treated as an open string: ONLY exact `"Permanent"` suppresses (+90 days).
 *   `Temporary`, `Transient`, `Undetermined`, missing, and unknown bounce types do NOT suppress.
 * - `email.complained` suppresses for +180 days.
 * - Other event types produce a safe diagnostic only.
 */
export interface ParsedResendWebhookOutcome {
  action: "suppress" | "diagnostic";
  reason?: "permanent_bounce" | "complaint";
  providerMessageId?: string;
  recipientEmail?: string;
  expiresAtIso?: string;
  diagnosticCode: string;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_HUNDRED_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;

export function classifyResendWebhookEvent(
  payload: unknown,
  fallbackNow: Date = new Date()
): ParsedResendWebhookOutcome {
  if (!payload || typeof payload !== "object") {
    return { action: "diagnostic", diagnosticCode: "malformed_object" };
  }

  const root = payload as Record<string, unknown>;
  const eventType = typeof root.type === "string" ? root.type : "";
  const createdAtRaw = typeof root.created_at === "string" ? root.created_at : "";
  const eventTimeMs = Date.parse(createdAtRaw);
  const baseMs = Number.isFinite(eventTimeMs)
    ? eventTimeMs
    : fallbackNow.getTime();

  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : null;

  if (!data) {
    return { action: "diagnostic", diagnosticCode: "missing_data" };
  }

  const providerMessageId =
    typeof data.email_id === "string" ? data.email_id.trim() : "";
  const fromField = typeof data.from === "string" ? data.from.trim() : "";

  let recipientEmail = "";
  if (Array.isArray(data.to) && typeof data.to[0] === "string") {
    recipientEmail = data.to[0].trim().toLowerCase();
  } else if (typeof data.to === "string") {
    recipientEmail = data.to.trim().toLowerCase();
  }

  if (eventType === "email.bounced") {
    const bounceObj =
      data.bounce && typeof data.bounce === "object"
        ? (data.bounce as Record<string, unknown>)
        : null;
    const bounceType =
      bounceObj && typeof bounceObj.type === "string" ? bounceObj.type : "";

    // Defensive check (ARCHITECTURE.md line 237): ONLY exact "Permanent" suppresses!
    if (bounceType !== "Permanent") {
      return {
        action: "diagnostic",
        diagnosticCode: "non_permanent_bounce_ignored",
      };
    }

    if (!providerMessageId || !recipientEmail || !fromField) {
      return {
        action: "diagnostic",
        diagnosticCode: "incomplete_permanent_bounce",
      };
    }

    return {
      action: "suppress",
      reason: "permanent_bounce",
      providerMessageId,
      recipientEmail,
      expiresAtIso: new Date(baseMs + NINETY_DAYS_MS).toISOString(),
      diagnosticCode: "permanent_bounce",
    };
  }

  if (eventType === "email.complained") {
    if (!providerMessageId || !recipientEmail || !fromField) {
      return {
        action: "diagnostic",
        diagnosticCode: "incomplete_complaint",
      };
    }

    return {
      action: "suppress",
      reason: "complaint",
      providerMessageId,
      recipientEmail,
      expiresAtIso: new Date(baseMs + ONE_HUNDRED_EIGHTY_DAYS_MS).toISOString(),
      diagnosticCode: "complaint",
    };
  }

  return {
    action: "diagnostic",
    diagnosticCode: "unhandled_event_type",
  };
}
