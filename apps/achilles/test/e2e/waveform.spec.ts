// Phase 11 Plan 11-02 — proves UI-04 against the headless renderer bundle. No real Electron app launches in CI.
/**
 * E2E3 — waveform.
 *
 * Asserts the structural waveform contract:
 *
 *   (a) `[data-testid="waveform"]` is a <canvas> with width=190 and
 *       height=22 (UI-SPEC §2 pixel grid).
 *   (b) The renderer has instantiated a MockAnalyser with
 *       frequencyBinCount === 32 (UI-04 — 32-bar Canvas2D visualizer
 *       driven by an AnalyserNode-shaped source).
 *
 * The headless renderer attaches `window.__achilles_debug.analyser` to
 * expose the live analyser reference (gated by `import.meta.env.MODE`
 * so the surface never ships in production builds — see
 * FloatingShell.tsx and the Vite tree-shaking note there).
 *
 * Pixel sampling via getImageData is intentionally NOT used: the
 * headless preview's Canvas2D pixel readback path is unreliable in
 * jsdom and not guaranteed in Playwright's Chromium when the renderer
 * draws with non-default CSS variables. The structural assertion above
 * is the sufficient proof of UI-04.
 */
import { expect, test } from "@playwright/test";

test.describe("UI-04 — 32-bar Canvas2D waveform (Plan 11-02)", () => {
  test("listening renders a 190×22 <canvas> driven by a 32-bin MockAnalyser", async ({
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

    // Wait for the waveform to render (the state transition triggers a
    // re-render that swaps in the listening analyser).
    const waveform = page.locator('[data-testid="waveform"]');
    await expect(waveform).toBeVisible();

    // (a) Structural: canvas dimensions match UI-SPEC §2.
    const dims = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="waveform"]',
      ) as HTMLCanvasElement | null;
      if (el === null) return null;
      return { tag: el.tagName.toLowerCase(), width: el.width, height: el.height };
    });
    expect(dims).not.toBeNull();
    expect(dims!.tag).toBe("canvas");
    expect(dims!.width).toBe(190);
    expect(dims!.height).toBe(22);

    // (b) Analyser contract: MockAnalyser instantiated with 32 bins.
    const binCount = await page.evaluate(() => {
      const dbg = (
        window as {
          __achilles_debug?: { analyser?: { frequencyBinCount?: number } };
        }
      ).__achilles_debug;
      return dbg?.analyser?.frequencyBinCount ?? null;
    });
    expect(binCount).toBe(32);
  });

  test("idle skips the rAF loop (analyser is null per renderer contract)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: { setState: (n: string) => void };
        }
      ).__mockBridge;
      mock!.setState("idle");
    });
    const waveform = page.locator('[data-testid="waveform"]');
    await expect(waveform).toBeVisible();
    // FloatingShell sets analyser=null for 'idle' and 'error' to keep
    // CPU bounded (T-11-09 mitigation). The debug surface reflects
    // this nullity. We probe explicitly for the presence of the
    // analyser key (vs. an absent debug surface) so the assertion is
    // unambiguous.
    const probe = await page.evaluate(() => {
      const dbg = (
        window as {
          __achilles_debug?: { analyser?: unknown };
        }
      ).__achilles_debug;
      if (dbg === undefined) {
        return { debugMissing: true, analyser: undefined };
      }
      return { debugMissing: false, analyser: dbg.analyser };
    });
    expect(probe.debugMissing).toBe(false);
    expect(probe.analyser).toBeNull();
  });
});
