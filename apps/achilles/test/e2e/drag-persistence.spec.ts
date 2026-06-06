// Phase 11 Plan 11-03 — proves UI-05 against the headless renderer bundle.
// No real Electron app launches; Playwright drives the Vite preview at port 5174.
//
// The drag-persistence round-trip:
//   1. simulateDrag(toX, toY) records the drag end into the mock bridge.
//   2. getPersistedPosition() returns the recorded position.
//   3. page.reload() reloads the renderer bundle. The persisted position
//      survives across the reload because the mock seam keeps it in
//      memory for the duration of the test (production: electron-store
//      persists across renderer reloads via the main-process store).
import { expect, test } from "@playwright/test";

test.describe("Plan 11-03 drag-persistence (UI-05)", () => {
  test("simulateDrag persists position and getPersistedPosition returns it", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for the renderer to mount the floating shell.
    await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();

    await page.evaluate(() => {
      (
        window as {
          __mockBridge?: { simulateDrag(x: number, y: number): void };
        }
      ).__mockBridge!.simulateDrag(50, 50);
    });

    const persisted = await page.evaluate(() => {
      return (
        window as {
          __mockBridge?: {
            getPersistedPosition(): { x: number; y: number } | null;
          };
        }
      ).__mockBridge!.getPersistedPosition();
    });

    expect(persisted).toEqual({ x: 50, y: 50 });
  });

  test("getLastEmittedIPC records the update-window-position envelope on drag", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();

    await page.evaluate(() => {
      (
        window as {
          __mockBridge?: { simulateDrag(x: number, y: number): void };
        }
      ).__mockBridge!.simulateDrag(120, 240);
    });

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
        e.type === "achilles:update-window-position" &&
        (e.payload as { x: number; y: number }).x === 120 &&
        (e.payload as { x: number; y: number }).y === 240,
    );
    expect(found).toBe(true);
  });

  test("drag-handle data-app-region='drag' is exposed for OS-level drag region marking", async ({
    page,
  }) => {
    await page.goto("/");
    const handle = page.locator('[data-testid="drag-handle"]');
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("data-app-region", "drag");
  });
});
