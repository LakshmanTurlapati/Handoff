// Phase 11 Plan 11-02 — proves UI-03 against the headless renderer bundle. No real Electron app launches in CI.
/**
 * E2E2 — circle-amplitude.
 *
 * Drives the reactive circle through deterministic mic + TTS RMS values
 * (LISTENING_FIXTURE + SPEAKING_FIXTURE) and asserts that the inline
 * `--circle-scale` custom property tracks `0.9 + amplitude * 0.5` within
 * a 0.001 tolerance.
 *
 * The fixture arrays are imported from `test/fixtures/amplitude-fixtures.ts`
 * so the same bytes used by the e2e suite match the bytes Plan 11-01's
 * `createMockAmplitudeStream` would produce in seed 42 — meaning the
 * mocked main process and the headless renderer agree on the signal.
 *
 * Only the first 5 samples are exercised per state so the spec stays
 * fast; the fixture file contains 100 samples for any future expansion.
 */
import { expect, test } from "@playwright/test";

import {
  LISTENING_FIXTURE,
  SPEAKING_FIXTURE,
} from "../fixtures/amplitude-fixtures.js";

async function readCircleScale(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="reactive-circle"]',
    ) as HTMLElement | null;
    if (el === null) return NaN;
    const raw = el.style.getPropertyValue("--circle-scale");
    return parseFloat(raw);
  });
}

test.describe("UI-03 — reactive circle amplitude tracking (Plan 11-02)", () => {
  test("listening: --circle-scale tracks 0.9 + micAmplitude * 0.5", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: { setState: (n: string) => void };
        }
      ).__mockBridge;
      mock!.setState("listening");
    });

    const samples = LISTENING_FIXTURE.slice(0, 5);
    for (const v of samples) {
      await page.evaluate((rms) => {
        const mock = (
          window as {
            __mockBridge?: { emitMicAmplitude: (r: number) => void };
          }
        ).__mockBridge;
        mock!.emitMicAmplitude(rms);
      }, v);

      // Poll for the expected scale (React batches the state update;
      // expect.poll waits for the next render tick).
      await expect.poll(() => readCircleScale(page), {
        message: `--circle-scale for v=${v}`,
        timeout: 2000,
      }).toBeGreaterThanOrEqual(0.9 + v * 0.5 - 0.001);
      const scale = await readCircleScale(page);
      expect(scale).toBeGreaterThanOrEqual(0.9 + v * 0.5 - 0.001);
      expect(scale).toBeLessThanOrEqual(0.9 + v * 0.5 + 0.001);
    }
  });

  test("speaking: --circle-scale tracks 0.9 + ttsAmplitude * 0.5", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: { setState: (n: string) => void };
        }
      ).__mockBridge;
      mock!.setState("speaking");
    });

    const samples = SPEAKING_FIXTURE.slice(0, 5);
    for (const v of samples) {
      await page.evaluate((rms) => {
        const mock = (
          window as {
            __mockBridge?: { emitTtsAmplitude: (r: number) => void };
          }
        ).__mockBridge;
        mock!.emitTtsAmplitude(rms);
      }, v);

      await expect.poll(() => readCircleScale(page), {
        message: `--circle-scale for v=${v}`,
        timeout: 2000,
      }).toBeGreaterThanOrEqual(0.9 + v * 0.5 - 0.001);
      const scale = await readCircleScale(page);
      expect(scale).toBeGreaterThanOrEqual(0.9 + v * 0.5 - 0.001);
      expect(scale).toBeLessThanOrEqual(0.9 + v * 0.5 + 0.001);
    }
  });
});
