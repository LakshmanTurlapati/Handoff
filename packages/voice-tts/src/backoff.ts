/**
 * Exponential backoff with full jitter for the @achilles/voice-tts WS
 * reconnect loop.
 *
 * NOTE (CONTEXT.md): this module is duplicated from
 * `@achilles/voice-stt/src/backoff.ts` intentionally — the two packages
 * are distinct dependencies of separate consumers and CONTEXT.md does
 * not require extraction for v1.2. Refactor candidate for v1.3 once
 * both packages have stabilised their constants and shape.
 *
 * Citations:
 *   - PITFALLS #4 — WebSocket lifecycle, exponential backoff with full
 *     jitter, distinguish 429 classes, cap reconnect attempts
 *   - 09-CONTEXT.md decisions — cap 5 attempts; reuse the STT shape
 */

import { RECONNECT_MAX_ATTEMPTS } from "./constants.js";

/**
 * Base interval (in milliseconds) for the exponential backoff. The
 * ceiling for attempt `n` is `BACKOFF_BASE_MS * 2^n`, the actual
 * sleep is sampled uniformly from `[0, ceiling]` (full jitter).
 */
const BACKOFF_BASE_MS = 250;

/**
 * Compute the next reconnect delay (in milliseconds) for the given
 * attempt index. Implements exponential backoff with full jitter —
 * the actual delay is uniform in `[0, BACKOFF_BASE_MS * 2^attempt]`.
 *
 * Returns `Infinity` once the attempt index reaches
 * `RECONNECT_MAX_ATTEMPTS`. Callers SHOULD treat the Infinity return
 * as "give up; emit the final error event and stop". This matches
 * the cap documented in CONTEXT.md and tested in `backoff.test.ts`.
 */
export function computeBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) {
    throw new Error(
      `computeBackoffMs: attempt must be a non-negative finite number, got ${attempt}`,
    );
  }
  if (attempt >= RECONNECT_MAX_ATTEMPTS) {
    return Infinity;
  }
  const ceiling = BACKOFF_BASE_MS * Math.pow(2, attempt);
  return Math.random() * ceiling;
}
