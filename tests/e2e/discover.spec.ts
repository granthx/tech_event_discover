import { expect, test } from "@playwright/test";

test.describe("Phase 1 · Discover E2E, search, filters, public/private separation & 320px reflow", () => {
  test("renders Discover cards, separates public catalog fetch from tracking fetch, and supports search & empty states", async ({
    page,
  }) => {
    const catalogRequests: string[] = [];
    const trackingRequests: string[] = [];

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/catalog/discover")) {
        catalogRequests.push(url);
      } else if (url.includes("/api/me/events")) {
        trackingRequests.push(url);
      }
    });

    await page.goto("/discover");

    await expect(
      page.getByRole("heading", { name: "Discover Tech Events" })
    ).toBeVisible();

    const cards = page.getByTestId("event-card");
    await expect(cards.first()).toBeVisible();
    const initialCount = await cards.count();
    expect(initialCount).toBeGreaterThanOrEqual(5);

    // Verify public catalog JSON request and separate private tracking request occurred
    expect(catalogRequests.length).toBeGreaterThanOrEqual(1);
    expect(trackingRequests.length).toBeGreaterThanOrEqual(1);

    // Prefix search: "hack" matches hackathon listings
    const searchInput = page.getByLabel(
      "Search events by title, organizer, or topic"
    );
    await searchInput.fill("hack");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page).toHaveURL(/q=hack/);
    await expect(
      page.getByText("India Systems Hackathon 2026")
    ).toBeVisible();

    // Filter combination producing empty state
    await searchInput.fill("nonexistentquantumblockchainxyz");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(
      page.getByText("No events match these filters.")
    ).toBeVisible();

    // Clear filters restores full catalog
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(cards.first()).toBeVisible();
  });

  test("maintains zero horizontal overflow at 320px mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/discover");
    await expect(page.getByTestId("event-card").first()).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("serves published and canceled details and returns 404 for draft and archived events", async ({
    page,
    request,
  }) => {
    // Published event detail
    await page.goto("/events/22222222-2222-4222-8222-222222222201");
    await expect(
      page.getByRole("heading", { name: "India Systems Hackathon 2026" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Report a correction" })
    ).toBeVisible();

    // Canceled event detail shows cancellation banner and reason
    await page.goto("/events/22222222-2222-4222-8222-222222222207");
    await expect(page.getByTestId("canceled-event-banner")).toBeVisible();
    await expect(
      page.getByText("Reason: Canceled by the organizer")
    ).toBeVisible();

    // Draft event returns 404
    const draftRes = await request.get(
      "/events/22222222-2222-4222-8222-222222222208"
    );
    expect(draftRes.status()).toBe(404);

    // Archived event returns 404
    const archivedRes = await request.get(
      "/events/22222222-2222-4222-8222-222222222209"
    );
    expect(archivedRes.status()).toBe(404);
  });
});
