import { domainToASCII } from "node:url";

const MAX_URL_LENGTH = 2048;

const STRIPPED_TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

const FORBIDDEN_SIGNED_PARAMS = new Set([
  "access_token",
  "signature",
  "sig",
  "token",
  "auth_token",
  "id_token",
]);

const IPV4_LITERAL_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const NUMERIC_OR_HEX_IP_REGEX = /^(?:0x[0-9a-f]+|\d+)$/i;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export type NormalizeSourceUrlResult =
  | { ok: true; publicUrl: string; urlKey: string }
  | { ok: false; code: "INVALID_SOURCE_URL"; message: string };

function isForbiddenHost(asciiHost: string): boolean {
  if (!asciiHost) {
    return true;
  }
  if (
    asciiHost === "localhost" ||
    asciiHost.endsWith(".localhost") ||
    asciiHost.endsWith(".local") ||
    asciiHost.endsWith(".internal")
  ) {
    return true;
  }
  // IPv6 literal in brackets
  if (asciiHost.startsWith("[") || asciiHost.endsWith("]") || asciiHost.includes(":")) {
    return true;
  }
  // IPv4 dotted quad or single integer/hex IP literal
  if (IPV4_LITERAL_REGEX.test(asciiHost) || NUMERIC_OR_HEX_IP_REGEX.test(asciiHost)) {
    return true;
  }
  const labels = asciiHost.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0)) {
    return true;
  }
  // Last label (TLD) cannot be all numeric
  const tld = labels[labels.length - 1] ?? "";
  if (/^\d+$/.test(tld)) {
    return true;
  }
  return false;
}

const UNRESERVED_CHAR_REGEX = /^[A-Za-z0-9\-._~]$/;

/**
 * Normalizes percent-encoding without decoding reserved characters:
 * - Uppercases hex digits in %XX
 * - Decodes percent-encoded unreserved characters (RFC 3986 section 2.3: ALPHA / DIGIT / "-" / "." / "_" / "~")
 * - Keeps reserved characters encoded as %XX
 */
function normalizePercentEncoding(input: string): string {
  return input.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const codePoint = parseInt(hex, 16);
    const char = String.fromCharCode(codePoint);
    if (UNRESERVED_CHAR_REGEX.test(char)) {
      return char;
    }
    return `%${hex.toUpperCase()}`;
  });
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || STRIPPED_TRACKING_PARAMS.has(lower);
}

function isForbiddenSignedParam(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FORBIDDEN_SIGNED_PARAMS.has(lower) ||
    lower.startsWith("x-amz-") ||
    lower.startsWith("x-goog-")
  );
}

/**
 * Normalizes and validates source URLs according to ARCHITECTURE.md (Source links 1-4):
 * 1. Absolute HTTPS URLs up to 2,048 chars on standard port 443. Reject credentials, IP literals,
 *    localhost, control characters, and signed-access parameters (access_token, signature, x-amz-*, x-goog-*).
 *    Require actual HTTPS link for HTTP input.
 * 2. Normalize hostname to lowercase ASCII, omit port 443, resolve dot segments, normalize percent escapes
 *    without decoding reserved characters. Preserve path case and non-root trailing slashes.
 *    Treat lu.ma and luma.com as distinct hosts.
 * 3. Strip case-insensitive utm_*, fbclid, gclid, dclid, msclkid, mc_cid, mc_eid. Preserve other query values
 *    and repeated parameters. Sort query parameters for url_key only when names are unique.
 *    Keep safe fragments in public_url; drop ordinary anchors from url_key and retain router fragments beginning / or !/.
 */
export function normalizeSourceUrl(rawInput: string): NormalizeSourceUrlResult {
  if (typeof rawInput !== "string") {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must be a string.",
    };
  }

  const trimmed = rawInput.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must be between 1 and 2,048 characters.",
    };
  }

  if (hasControlCharacter(trimmed)) {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must not contain control characters.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL is not a valid absolute URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must use HTTPS (http:// is not accepted).",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must not contain embedded credentials.",
    };
  }

  if (parsed.port !== "" && parsed.port !== "443") {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL must use standard HTTPS port 443.",
    };
  }

  const asciiHost = domainToASCII(parsed.hostname).toLowerCase();
  if (isForbiddenHost(asciiHost)) {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Source URL hostname must be a public domain name (no localhost or IP literals).",
    };
  }

  // Path normalization: URL constructor resolves dot segments; preserve non-root trailing slashes & path case
  const normalizedPathname =
    parsed.pathname === "/" ? "/" : normalizePercentEncoding(parsed.pathname);

  // Query parameters inspection & filtering
  const rawSearch = parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search;
  const keptPairs: Array<{ key: string; value: string; rawEncoded: string }> = [];

  if (rawSearch.length > 0) {
    for (const part of rawSearch.split("&")) {
      if (!part) continue;
      const eqIdx = part.indexOf("=");
      const rawKey = eqIdx === -1 ? part : part.slice(0, eqIdx);
      const rawVal = eqIdx === -1 ? "" : part.slice(eqIdx + 1);

      let decodedKey: string;
      try {
        decodedKey = decodeURIComponent(rawKey.replace(/\+/g, "%20"));
      } catch {
        decodedKey = rawKey;
      }

      if (isForbiddenSignedParam(decodedKey)) {
        return {
          ok: false,
          code: "INVALID_SOURCE_URL",
          message: `Signed or secret query parameter (${decodedKey}) is not permitted.`,
        };
      }

      if (isTrackingParam(decodedKey)) {
        continue;
      }

      const normKey = normalizePercentEncoding(rawKey);
      const normVal = normalizePercentEncoding(rawVal);
      const encodedPair = eqIdx === -1 ? normKey : `${normKey}=${normVal}`;

      keptPairs.push({
        key: normKey,
        value: normVal,
        rawEncoded: encodedPair,
      });
    }
  }

  const publicQuery =
    keptPairs.length > 0 ? `?${keptPairs.map((p) => p.rawEncoded).join("&")}` : "";

  // Sort query parameters for url_key ONLY when parameter names are unique
  const keyNames = keptPairs.map((p) => p.key);
  const hasUniqueParamNames = new Set(keyNames).size === keyNames.length;
  const keyPairs = hasUniqueParamNames
    ? [...keptPairs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    : keptPairs;
  const keyQuery =
    keyPairs.length > 0 ? `?${keyPairs.map((p) => p.rawEncoded).join("&")}` : "";

  // Fragment handling:
  // "Keep safe fragments in public_url; drop ordinary anchors from url_key and retain router fragments beginning / or !/."
  const rawHash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  const normalizedHashContent = rawHash ? normalizePercentEncoding(rawHash) : "";
  const publicFragment = normalizedHashContent ? `#${normalizedHashContent}` : "";
  const isRouterFragment =
    normalizedHashContent.startsWith("/") || normalizedHashContent.startsWith("!/");
  const keyFragment = isRouterFragment ? `#${normalizedHashContent}` : "";

  const baseAuthorityAndPath = `https://${asciiHost}${
    normalizedPathname === "/" ? "" : normalizedPathname
  }`;

  const publicUrl = `${baseAuthorityAndPath}${publicQuery}${publicFragment}`;
  const urlKey = `${baseAuthorityAndPath}${keyQuery}${keyFragment}`;

  if (publicUrl.length > MAX_URL_LENGTH || urlKey.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      code: "INVALID_SOURCE_URL",
      message: "Normalized source URL exceeds 2,048 characters.",
    };
  }

  return {
    ok: true,
    publicUrl,
    urlKey,
  };
}
