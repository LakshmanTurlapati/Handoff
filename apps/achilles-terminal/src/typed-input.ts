/**
 * Phase 18, Plan 03, Task 3 — Typed-input fallback module.
 *
 * Requirements:
 *   - ERR-04: typed-input fallback via inline @clack/prompts.text() activates
 *     when STT circuit breaker opens; typed transcript flows through the same
 *     sandwich-wrap single-pipeline entry as voice transcripts.
 *   - T-18-17 mitigate: default pollIntervalMs = 1000ms (1s, minimum perceptible
 *     to the user). The seam is configurable but tests MUST keep it above 100ms.
 *
 * The fallback polls circuit-breaker.status() every pollIntervalMs. When
 * status.state === "open" AND no prompt is active, presents @clack/prompts.text().
 * On user input (non-cancel), calls onTyped(transcript). After onTyped resolves,
 * the next poll determines whether to re-prompt (breaker still open) or stand
 * down (breaker closed/half-open).
 *
 * The handle returned by createTypedInputFallback has a single method:
 *   dispose(): void — stops the poll interval and cancels any in-flight prompt.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import type { CircuitBreaker } from "./circuit-breaker.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Handle returned by createTypedInputFallback.
 *
 * @public
 */
export interface TypedInputHandle {
  dispose(): void;
}

/**
 * Dependency injection seam for createTypedInputFallback.
 *
 * @public
 */
export interface TypedInputDeps {
  /** Poll interval in milliseconds. Default 1000 (T-18-17 mitigate). */
  pollIntervalMs?: number;
  /**
   * @clack/prompts.text()-compatible function. Defaults to lazily imported
   * @clack/prompts.text in production.
   */
  promptText?: (msg: string) => Promise<string | symbol>;
  /**
   * @clack/prompts.isCancel()-compatible function. Defaults to lazily imported
   * @clack/prompts.isCancel in production.
   */
  isCancel?: (v: unknown) => boolean;
  /** setInterval seam. Defaults to globalThis.setInterval. */
  setIntervalImpl?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** clearInterval seam. Defaults to globalThis.clearInterval. */
  clearIntervalImpl?: (id: ReturnType<typeof setInterval>) => void;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a typed-input fallback handle that polls the supplied circuit breaker
 * and presents @clack/prompts.text() when the STT circuit opens.
 *
 * @public
 */
export function createTypedInputFallback(
  circuitBreaker: CircuitBreaker,
  onTyped: (transcript: string) => Promise<void>,
  deps: TypedInputDeps = {},
): TypedInputHandle {
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;

  let disposed = false;
  let promptActive = false;

  // Lazy-load @clack/prompts in production; tests inject directly.
  async function resolvePromptText(): Promise<(msg: string) => Promise<string | symbol>> {
    if (deps.promptText !== undefined) {
      return deps.promptText;
    }
    const clack = await import("@clack/prompts");
    return (msg: string): Promise<string | symbol> =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      clack.text({ message: msg }) as unknown as Promise<string | symbol>;
  }

  async function resolveIsCancel(): Promise<(v: unknown) => boolean> {
    if (deps.isCancel !== undefined) {
      return deps.isCancel;
    }
    const clack = await import("@clack/prompts");
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return clack.isCancel as unknown as (v: unknown) => boolean;
  }

  async function onPoll(): Promise<void> {
    if (disposed) return;
    if (promptActive) return;

    const status = circuitBreaker.status();
    if (status.state !== "open") return;

    promptActive = true;
    try {
      const [promptText, isCancel] = await Promise.all([
        resolvePromptText(),
        resolveIsCancel(),
      ]);

      if (disposed) return;

      const result = await promptText("STT unavailable — type your message:");

      if (disposed) return;

      if (!isCancel(result) && typeof result === "string" && result.length > 0) {
        await onTyped(result);
      }
    } finally {
      promptActive = false;
    }
  }

  const intervalId = setIntervalImpl(() => {
    void onPoll();
  }, pollIntervalMs);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearIntervalImpl(intervalId);
  }

  return { dispose };
}
