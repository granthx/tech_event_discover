import { describe, expect, it } from "vitest";
import { normalizeSourceUrl } from "@/features/curation/url-normalization";

describe("Source URL normalization and validation (ARCHITECTURE.md Source links 1-4)", () => {
  it("normalizes host to lowercase ASCII, omits port 443, strips tracking params, and sorts unique query keys for urlKey", () => {
    const res = normalizeSourceUrl(
      "https://FOSSUnited.org:443/events/India-Hackathon/?b=2&utm_source=twitter&a=1&fbclid=xyz123#schedule"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.publicUrl).toBe(
        "https://fossunited.org/events/India-Hackathon/?b=2&a=1#schedule"
      );
      expect(res.urlKey).toBe(
        "https://fossunited.org/events/India-Hackathon/?a=1&b=2"
      );
    }
  });

  it("retains router fragments beginning with / or !/ in urlKey and treats lu.ma and luma.com as distinct hosts", () => {
    const routerUrl = normalizeSourceUrl("https://lu.ma/events#!/register");
    const lumaComUrl = normalizeSourceUrl("https://luma.com/events#!/register");
    expect(routerUrl.ok).toBe(true);
    expect(lumaComUrl.ok).toBe(true);
    if (routerUrl.ok && lumaComUrl.ok) {
      expect(routerUrl.urlKey).toBe("https://lu.ma/events#!/register");
      expect(lumaComUrl.urlKey).toBe("https://luma.com/events#!/register");
      expect(routerUrl.urlKey).not.toBe(lumaComUrl.urlKey);
    }
  });

  it("preserves repeated parameter ordering in urlKey when parameter names are not unique", () => {
    const res = normalizeSourceUrl(
      "https://example.org/events?tag=rust&a=1&tag=systems"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.urlKey).toBe(
        "https://example.org/events?tag=rust&a=1&tag=systems"
      );
    }
  });

  it("rejects http://, credentials, localhost, IP literals, non-443 ports, and signed access parameters", () => {
    expect(normalizeSourceUrl("http://example.org/event").ok).toBe(false);
    expect(normalizeSourceUrl("https://user:pass@example.org/event").ok).toBe(false);
    expect(normalizeSourceUrl("https://localhost/event").ok).toBe(false);
    expect(normalizeSourceUrl("https://127.0.0.1/event").ok).toBe(false);
    expect(normalizeSourceUrl("https://[::1]/event").ok).toBe(false);
    expect(normalizeSourceUrl("https://example.org:8443/event").ok).toBe(false);
    expect(
      normalizeSourceUrl("https://example.org/event?X-Amz-Signature=secret").ok
    ).toBe(false);
    expect(
      normalizeSourceUrl("https://example.org/event?access_token=secret").ok
    ).toBe(false);
  });
});
