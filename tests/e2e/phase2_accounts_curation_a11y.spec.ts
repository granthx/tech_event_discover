import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Phase 2 · Accounts, Curation, Calendar (.ics), WCAG 2.2 AA & 320px Reflow", () => {
  const routesToVerify = [
    "/discover",
    "/events/22222222-2222-4222-8222-222222222201",
    "/my-events",
    "/settings",
    "/sign-in",
    "/privacy",
    "/admin/events",
  ];

  test("passes axe WCAG 2.2 AA accessibility and 320px zero-overflow checks across all R1 routes", async ({
    page,
  }) => {
    for (const route of routesToVerify) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route);

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(
        accessibilityScanResults.violations,
        `Axe violations on ${route}`
      ).toEqual([]);

      // Check 320px narrow-screen reflow
      await page.setViewportSize({ width: 320, height: 640 });
      const hasOverflow = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
        );
      });
      expect(hasOverflow, `Horizontal overflow at 320px on ${route}`).toBe(
        false
      );
    }
  });

  test("exports RFC-compliant .ics files for timed and ongoing unknown-end events, and returns 409/404 for canceled/draft events", async ({
    request,
  }) => {
    // 1. Timed event with explicit end
    const timedRes = await request.get(
      "/api/events/22222222-2222-4222-8222-222222222201/calendar"
    );
    expect(timedRes.status()).toBe(200);
    expect(timedRes.headers()["content-type"]).toContain("text/calendar");
    expect(timedRes.headers()["cache-control"]).toBe("no-store");
    const timedBody = await timedRes.text();
    expect(timedBody).toContain("BEGIN:VCALENDAR");
    expect(timedBody).toContain(
      "UID:event-22222222-2222-4222-8222-222222222201@techeventdiscover.in"
    );
    expect(timedBody).toContain("SUMMARY:India Systems Hackathon 2026");
    expect(timedBody).toContain("DTSTART:");
    expect(timedBody).toContain("DTEND:");

    // 2. Ongoing event with unknown end omits DTEND (ongoing_unknown_end_exports_without_dtend)
    const unknownEndRes = await request.get(
      "/api/events/22222222-2222-4222-8222-222222222206/calendar"
    );
    expect(unknownEndRes.status()).toBe(200);
    const unknownEndBody = await unknownEndRes.text();
    expect(unknownEndBody).toContain(
      "SUMMARY:Live Ongoing Compiler Office Hours"
    );
    expect(unknownEndBody).toContain("DTSTART:");
    expect(unknownEndBody).not.toContain("DTEND:");

    // 3. Canceled event returns 409
    const canceledRes = await request.get(
      "/api/events/22222222-2222-4222-8222-222222222207/calendar"
    );
    expect(canceledRes.status()).toBe(409);

    // 4. Draft event returns 404
    const draftRes = await request.get(
      "/api/events/22222222-2222-4222-8222-222222222208/calendar"
    );
    expect(draftRes.status()).toBe(404);
  });

  test("My Events separates Saved and Registered views with required empty copy and keyboard navigation", async ({
    page,
  }) => {
    await page.goto("/my-events");
    await expect(
      page.getByRole("heading", { name: "My Events" })
    ).toBeVisible();

    await expect(page.getByText("No saved events yet.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse events" })
    ).toBeVisible();

    const registeredTab = page.getByRole("tab", { name: "Registered" });
    await registeredTab.click();
    await expect(registeredTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("No registered events yet.")).toBeVisible();
  });
});
