/**
 * Plan 11-01 scaffold spec.
 *
 * Plan 11-02 will add the full state-distinctness spec (screenshot diffs,
 * waveform pixel reads, transcript opacity). This file only proves the
 * Wave-1 substrate is wired:
 *
 *   - The floating-shell root renders.
 *   - window.__mockBridge exposes the documented API surface.
 *   - setState for each AchillesState updates `data-state` on the
 *     reactive-circle stub.
 *
 * Playwright drives the headless Vite preview on port 5174 — NO
 * Electron is launched (per CONTEXT.md test strategy + the CLAUDE.md
 * global "never run applications automatically").
 */
import { expect, test } from "@playwright/test";

test.describe("apps/achilles scaffold (Plan 11-01)", () => {
  test("floating-shell renders and reactive-circle stub is present", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="floating-shell"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="reactive-circle"]'),
    ).toBeVisible();
  });

  test("window.__mockBridge exposes the documented API surface", async ({
    page,
  }) => {
    await page.goto("/");
    const surface = await page.evaluate(() => {
      const mock = (window as { __mockBridge?: Record<string, unknown> })
        .__mockBridge;
      if (mock === undefined) return null;
      return {
        hasSetState: typeof mock.setState === "function",
        hasSetPermission: typeof mock.setPermission === "function",
        hasEmitPartialTranscript:
          typeof mock.emitPartialTranscript === "function",
        hasEmitCommittedTranscript:
          typeof mock.emitCommittedTranscript === "function",
        hasEmitMicAmplitude: typeof mock.emitMicAmplitude === "function",
        hasEmitTtsAmplitude: typeof mock.emitTtsAmplitude === "function",
        hasEmitError: typeof mock.emitError === "function",
        hasInjectError: typeof mock.__test_inject_error === "function",
        hasGetLastEmittedIPC:
          typeof mock.getLastEmittedIPC === "function",
      };
    });
    expect(surface).not.toBeNull();
    expect(surface).toEqual({
      hasSetState: true,
      hasSetPermission: true,
      hasEmitPartialTranscript: true,
      hasEmitCommittedTranscript: true,
      hasEmitMicAmplitude: true,
      hasEmitTtsAmplitude: true,
      hasEmitError: true,
      hasInjectError: true,
      hasGetLastEmittedIPC: true,
    });
  });

  test("setState for each AchillesState updates the reactive-circle data-state", async ({
    page,
  }) => {
    await page.goto("/");

    for (const state of [
      "idle",
      "listening",
      "processing",
      "speaking",
      "error",
    ] as const) {
      await page.evaluate((s) => {
        (
          window as {
            __mockBridge?: { setState: (next: string) => void };
          }
        ).__mockBridge!.setState(s);
      }, state);
      await expect(
        page.locator('[data-testid="reactive-circle"]'),
      ).toHaveAttribute("data-state", state);
    }
  });
});
