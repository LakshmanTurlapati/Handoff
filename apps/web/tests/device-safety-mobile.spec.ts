import { expect, test } from "@playwright/test";

test.skip(
  !process.env.CODEX_MOBILE_E2E_LIVE || !process.env.CODEX_MOBILE_E2E_DEVICE_SAFETY,
  "Device safety mobile smoke requires the apps/web dev server, auth, and a live revoke/end-state fixture. Set CODEX_MOBILE_E2E_LIVE=1 and CODEX_MOBILE_E2E_DEVICE_SAFETY=1 to enable.",
);

test.use({
  viewport: { width: 390, height: 844 },
});

test.describe("Phase 4 · device safety mobile shell", () => {
  test("revoke and terminal safety copy stays readable on a phone viewport", async ({
    page,
    baseURL,
  }) => {
    const devicesTarget = new URL("/devices", baseURL).toString();
    await page.goto(devicesTarget, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Revoke device" })).toBeVisible();

    const sessionTarget = new URL("/session/session-mobile-smoke", baseURL).toString();
    await page.goto(sessionTarget, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Device revoked")).toBeVisible();
    await expect(page.getByText("Session ended on your laptop")).toBeVisible();
  });
});
