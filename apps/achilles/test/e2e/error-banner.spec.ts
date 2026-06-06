// Phase 11 Plan 11-03 — proves the four mocked error kinds surface the
// locked UI-SPEC §8 copy via the ErrorBanner. No real Electron app
// launches; the renderer is driven against the Vite preview at port 5174.
import { expect, test } from "@playwright/test";

const ERROR_COPY: Record<string, string> = {
  mic_unavailable: "Microphone not available. Check your input device.",
  hotkey_collision: "Hotkey is in use by another app. Change it in Settings.",
  persistence_failure:
    "Could not save window position. Settings may not persist.",
  unknown: "Something went wrong. Try again in a moment.",
};

test.describe("Plan 11-03 error-banner (UI-SPEC §8)", () => {
  for (const [kind, message] of Object.entries(ERROR_COPY)) {
    test(`'${kind}' surfaces the locked banner copy AND data-state='error'`, async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();

      await page.evaluate((errorKind) => {
        (
          window as {
            __mockBridge?: {
              __test_inject_error(k: string): void;
            };
          }
        ).__mockBridge!.__test_inject_error(errorKind);
      }, kind);

      const banner = page.locator('[data-testid="error-banner"]');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(message);

      const circle = page.locator('[data-testid="reactive-circle"]');
      await expect(circle).toHaveAttribute("data-state", "error");
    });
  }

  test("dismiss button returns the UI to 'idle' and unmounts the banner", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (
        window as {
          __mockBridge?: {
            __test_inject_error(k: string): void;
          };
        }
      ).__mockBridge!.__test_inject_error("mic_unavailable");
    });

    const banner = page.locator('[data-testid="error-banner"]');
    await expect(banner).toBeVisible();

    await page.locator('[data-testid="error-banner-dismiss"]').click();

    await expect(banner).toHaveCount(0);

    // Confirm a request-state envelope for 'idle' was emitted by the
    // banner's onDismiss callback.
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
        e.type === "request-state" &&
        (e.payload as { state: string }).state === "idle",
    );
    expect(found).toBe(true);
  });
});
