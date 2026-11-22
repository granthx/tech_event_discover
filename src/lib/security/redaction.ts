const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_OR_TOKEN_REGEX =
  /\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|[0-9a-f]{32,128})\b/gi;
const OTP_CODE_REGEX = /\b\d{6}\b/g;

const SENSITIVE_KEY_PATTERN =
  /email|otp|code|token|password|secret|authorization|cookie|feed_url|invite|unsubscribe|payload/i;

export function redactString(input: string): string {
  return input
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(BEARER_OR_TOKEN_REGEX, "[REDACTED_TOKEN]")
    .replace(OTP_CODE_REGEX, "[REDACTED_OTP]");
}

export function sanitizeDiagnosticRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safe[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "string") {
      safe[key] = redactString(value);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = { count: value.length };
    } else if (typeof value === "object" && value !== null) {
      safe[key] = sanitizeDiagnosticRecord(value as Record<string, unknown>);
    }
  }
  return safe;
}
