import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Phase 3A · Reminders UI, Unsubscribe, Webhooks & WCAG 2.2 AA", () => {
  test("Settings shows initially unchecked reminder consent wording and passes axe WCAG 2.2 AA + 320px reflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/settings");

    const checkbox = page.getByLabel(
      "Email me before a saved event’s registration deadline and before events I mark Registered. I can turn this off at any time."
    );
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    const hasOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(hasOverflow).toBe(false);
  });

  test("Unsubscribe GET page is read-only, strips query token from URL bar, and passes axe WCAG 2.2 AA + 320px reflow", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/unsubscribe?token=sample_unsubscribe_test_token_123456");

    await expect(
      page.getByRole("heading", { name: "Unsubscribe from Email Reminders" })
    ).toBeVisible();
    await expect(
      page.getByText("Opening this page has not changed your settings yet.")
    ).toBeVisible();

    // Verify token was stripped from window.location.search in browser history
    await expect
      .poll(() => new URL(page.url()).search)
      .toBe("");

    const confirmBtn = page.getByRole("button", {
      name: "Confirm unsubscribe",
    });
    await expect(confirmBtn).toBeEnabled();

    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    const hasOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(hasOverflow).toBe(false);

    // Verify invalid webhook signature and missing job bearer return 401
    const webhookRes = await request.post("/api/webhooks/resend", {
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_invalid",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,invalidsig",
      },
      data: { type: "email.bounced", data: {} },
    });
    expect(webhookRes.status()).toBe(401);

    const jobRes = await request.post("/api/internal/jobs/reminders", {
      headers: { "Content-Type": "application/json" },
      data: { runId: "22222222-2222-4222-8222-222222222201" },
    });
    expect(jobRes.status()).toBe(401);
  });
});
