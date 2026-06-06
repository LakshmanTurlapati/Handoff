// Phase 11 Plan 11-02 — proves UI-02 against the headless renderer bundle. No real Electron app launches in CI.
/**
 * E2E1 — state-distinctness.
 *
 * For each of the 5 AchillesStates ['idle','listening','processing',
 * 'speaking','error'], call `window.__mockBridge.setState(s)` then
 * confirm:
 *
 *   (a) the reactive-circle root carries data-state=s (DOM contract).
 *   (b) the circle's computed accent indicator (the
 *       --circle-color-current custom property, set per data-state in
 *       components.css) is pairwise distinct across the 5 states.
 *
 * Together these assertions verify UI-02 distinctness: not just the
 * data attribute but the visual treatment differs per state.
 */
import { expect, test } from "@playwright/test";

const STATES = [
  "idle",
  "listening",
  "processing",
  "speaking",
  "error",
] as const;

test.describe("UI-02 — state distinctness (Plan 11-02)", () => {
  test("each of the 5 states sets data-state and a distinct --circle-color-current", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.locator('[data-testid="reactive-circle"]'),
    ).toBeVisible();

    const accents = new Set<string>();

    for (const s of STATES) {
      await page.evaluate((next) => {
        const mock = (
          window as {
            __mockBridge?: { setState: (n: string) => void };
          }
        ).__mockBridge;
        mock!.setState(next);
      }, s);

      const circle = page.locator('[data-testid="reactive-circle"]');
      await expect(circle).toHaveAttribute("data-state", s);

      // Read the resolved CSS custom property for the per-state accent.
      const accent = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="reactive-circle"]',
        ) as HTMLElement | null;
        if (el === null) return "";
        return getComputedStyle(el)
          .getPropertyValue("--circle-color-current")
          .trim();
      });
      expect(accent).not.toBe("");
      accents.add(accent);
    }

    // The 5 states must produce 5 distinct accent colors.
    expect(accents.size).toBe(5);
  });
});
