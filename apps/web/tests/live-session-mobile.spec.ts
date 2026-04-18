import { test, expect } from "@playwright/test";

test.skip(
  !process.env.CODEX_MOBILE_E2E_LIVE,
  "Live mobile smoke requires the apps/web dev server. Set CODEX_MOBILE_E2E_LIVE=1 to enable.",
);

test.use({
  viewport: { width: 390, height: 844 },
});

test.describe("Phase 3 · live session mobile shell", () => {
  test("composer controls stay visible on a phone viewport", async ({
    page,
    baseURL,
  }) => {
    const target = new URL("/session/session-mobile-smoke", baseURL).toString();
    await page.goto(target, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Send Prompt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Steer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Interrupt" })).toBeVisible();
    await expect(page.getByText("Waiting for approval")).toBeVisible();
    await expect(page.getByText("Collapsed turn preview")).toBeVisible();
  });
});
