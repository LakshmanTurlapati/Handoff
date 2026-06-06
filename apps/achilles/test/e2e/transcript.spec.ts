// Phase 11 Plan 11-02 — proves LOOP-02 against the headless renderer bundle. No real Electron app launches in CI.
/**
 * E2E4 — transcript.
 *
 * Verifies the LOOP-02 contract end-to-end against the headless
 * renderer bundle:
 *
 *   (a) emitPartialTranscript('...') renders
 *       [data-testid="transcript-partial"] at computed opacity 0.7.
 *   (b) emitCommittedTranscript('...') renders
 *       [data-testid="transcript-committed"] at computed opacity 1.0
 *       with the expected text.
 *   (c) After 15s of idle, every committed line picks up the 'fading'
 *       class so the CSS keyframe drives opacity to 0 over the next
 *       1500ms (LOOP-02 auto-fade).
 *
 * (c) uses Playwright's page.clock API to fast-forward the page's
 * `Date.now()` + `setInterval` without a wall-clock 15s wait. The
 * page.clock API is available in Playwright 1.45+; our pinned version
 * (1.58.2 per apps/achilles/package.json) supports it.
 */
import { expect, test } from "@playwright/test";

test.describe("LOOP-02 — partial + committed transcript contract (Plan 11-02)", () => {
  test("emitPartialTranscript renders at opacity 0.7 (--achilles-text-dim)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: {
            setState: (n: string) => void;
            emitPartialTranscript: (t: string) => void;
          };
        }
      ).__mockBridge;
      mock!.setState("listening");
      mock!.emitPartialTranscript("hello wor");
    });

    const partial = page.locator('[data-testid="transcript-partial"]');
    await expect(partial).toBeVisible();
    await expect(partial).toHaveText("hello wor");
    await expect(partial).toHaveCSS("opacity", "0.7");
  });

  test("emitCommittedTranscript renders at opacity 1.0 with the supplied text", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: {
            setState: (n: string) => void;
            emitCommittedTranscript: (t: string) => void;
          };
        }
      ).__mockBridge;
      mock!.setState("listening");
      mock!.emitCommittedTranscript("hello world");
    });

    const committed = page.locator('[data-testid="transcript-committed"]').last();
    await expect(committed).toBeVisible();
    await expect(committed).toHaveText("hello world");
    await expect(committed).toHaveCSS("opacity", "1");
  });

  test("after 15s of idle the committed line picks up the 'fading' class", async ({
    page,
  }) => {
    // Install the Playwright clock BEFORE any page evaluation so the
    // page's Date.now() + setInterval are virtualised.
    await page.clock.install({ time: 1_000_000_000_000 });
    await page.goto("/");

    await page.evaluate(() => {
      const mock = (
        window as {
          __mockBridge?: {
            setState: (n: string) => void;
            emitCommittedTranscript: (t: string) => void;
          };
        }
      ).__mockBridge;
      mock!.setState("listening");
      mock!.emitCommittedTranscript("committed at T0");
      mock!.setState("idle");
    });

    const committed = page.locator('[data-testid="transcript-committed"]').last();
    await expect(committed).toBeVisible();
    await expect(committed).not.toHaveClass(/\bfading\b/);

    // Fast-forward 16 seconds — the TranscriptOverlay's 1s ticker
    // updates `now` to a value > committedAt + 15000, the isFading()
    // check returns true, and the class lands on the element.
    await page.clock.fastForward(16_000);

    await expect(committed).toHaveClass(/\bfading\b/);
  });
});
