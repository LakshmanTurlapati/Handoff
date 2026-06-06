// Phase 11 Plan 11-03 — proves UI-07 against the headless renderer bundle.
// No real Electron app launches; the macOS systemPreferences flow is owned
// by main/permission.ts (covered by the Plan 11-03 vitest suite).
//
// What this spec proves:
//   - 'denied'     → PermissionOverlay mounts with locked UI-SPEC §6 copy
//                    AND the CTA button is present
//   - CTA click    → emits the IPC_OPEN_SYSTEM_SETTINGS envelope
//   - 'restricted' → PermissionOverlay mounts with the organisation copy
//                    AND the CTA is structurally absent
//   - 'granted'    → PermissionOverlay dismisses (the overlay unmounts)
import { expect, test } from "@playwright/test";

const HEADING_COPY = "Achilles needs microphone access";
const BODY_COPY_DENIED =
  "Open System Settings → Privacy & Security → Microphone and enable Achilles.";
const BODY_COPY_RESTRICTED =
  "Microphone access is restricted by your organization. Contact your administrator to enable Achilles.";
const CTA_COPY = "Open System Settings";

test.describe("Plan 11-03 permission-overlay (UI-07)", () => {
  test("'denied' renders heading + body + CTA with the locked UI-SPEC §6 copy", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();

    await page.evaluate(() => {
      (
        window as { __mockBridge?: { setPermission(p: string): void } }
      ).__mockBridge!.setPermission("denied");
    });

    const overlay = page.locator('[data-testid="permission-overlay"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("h2")).toHaveText(HEADING_COPY);
    await expect(overlay.locator("p")).toHaveText(BODY_COPY_DENIED);

    const cta = page.locator('[data-testid="permission-overlay-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(CTA_COPY);
  });

  test("CTA click emits achilles:open-system-settings via the bridge", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (
        window as { __mockBridge?: { setPermission(p: string): void } }
      ).__mockBridge!.setPermission("denied");
    });

    const cta = page.locator('[data-testid="permission-overlay-cta"]');
    await expect(cta).toBeVisible();
    await cta.click();

    const ipcEntries = await page.evaluate(() => {
      return (
        window as {
          __mockBridge?: {
            getLastEmittedIPC(): Array<{ type: string; payload: unknown }>;
          };
        }
      ).__mockBridge!.getLastEmittedIPC();
    });

    const found = ipcEntries.some(
      (e) => e.type === "open-system-settings",
    );
    expect(found).toBe(true);
  });

  test("'restricted' renders the organisation copy and hides the CTA", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (
        window as { __mockBridge?: { setPermission(p: string): void } }
      ).__mockBridge!.setPermission("restricted");
    });

    const overlay = page.locator('[data-testid="permission-overlay"]');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("h2")).toHaveText(HEADING_COPY);
    await expect(overlay.locator("p")).toHaveText(BODY_COPY_RESTRICTED);

    // CTA absent for restricted state.
    await expect(
      page.locator('[data-testid="permission-overlay-cta"]'),
    ).toHaveCount(0);
  });

  test("'granted' dismisses the overlay (component unmounts)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (
        window as { __mockBridge?: { setPermission(p: string): void } }
      ).__mockBridge!.setPermission("denied");
    });
    const overlay = page.locator('[data-testid="permission-overlay"]');
    await expect(overlay).toBeVisible();

    await page.evaluate(() => {
      (
        window as { __mockBridge?: { setPermission(p: string): void } }
      ).__mockBridge!.setPermission("granted");
    });

    await expect(overlay).toHaveCount(0);
  });
});
