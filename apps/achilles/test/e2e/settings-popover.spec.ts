// Phase 11 Plan 11-03 — proves the SettingsPopover surface against the
// headless renderer bundle. No real Electron app launches; the popover
// is rendered as a sibling of the FloatingShell rather than as a child
// BrowserWindow (main/settings-popover-window.ts owns the child window
// in production; vitest covers that surface in the Plan 11-03 unit suite).
import { expect, test } from "@playwright/test";

test.describe("Plan 11-03 settings-popover (UI-SPEC §7)", () => {
  test("right-clicking the circle opens the popover with the locked heading", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();

    // Right-click on the reactive circle to open the popover.
    const circle = page.locator('[data-testid="reactive-circle"]');
    // The idle-state breathing animation keeps the circle visually
    // moving; force the click so Playwright does not refuse the
    // actionability check on the moving element.
    await circle.click({ button: "right", force: true });

    const popover = page.locator('[data-testid="settings-popover"]');
    await expect(popover).toBeVisible();
    await expect(popover.locator("h2")).toHaveText("Settings");
  });

  test("clicking 'Push-To-Talk' emits update-hotkey-config with mode='pushToTalk'", async ({
    page,
  }) => {
    await page.goto("/");
    const circle = page.locator('[data-testid="reactive-circle"]');
    // The idle-state breathing animation keeps the circle visually
    // moving; force the click so Playwright does not refuse the
    // actionability check on the moving element.
    await circle.click({ button: "right", force: true });
    await expect(page.locator('[data-testid="settings-popover"]')).toBeVisible();

    await page
      .locator('[data-testid="hotkey-mode-toggle-pushtotalk"]')
      .click({ force: true });

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
      (e) =>
        e.type === "update-hotkey-config" &&
        (e.payload as { mode?: string }).mode === "pushToTalk",
    );
    expect(found).toBe(true);
  });

  test("Escape dismisses the popover", async ({ page }) => {
    await page.goto("/");
    const circle = page.locator('[data-testid="reactive-circle"]');
    // The idle-state breathing animation keeps the circle visually
    // moving; force the click so Playwright does not refuse the
    // actionability check on the moving element.
    await circle.click({ button: "right", force: true });
    const popover = page.locator('[data-testid="settings-popover"]');
    await expect(popover).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(popover).toHaveCount(0);
  });
});
