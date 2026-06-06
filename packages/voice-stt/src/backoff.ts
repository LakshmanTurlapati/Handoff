/**
 * Exponential backoff with full jitter for the Achilles STT realtime
 * client (PITFALLS #4).
 *
 * Why full jitter:
 *   On a network blip every client backs off at the same time. With a
 *   deterministic exponential backoff (`base * 2^attempt`) clients
 *   reconnect in a thundering herd that immediately re-triggers the
 *   429-class limit. With full jitter (`random(0, base * 2^attempt)`)
 *   the reconnect distribution is uniform across the cap window, which
 *   spreads the load.
 *
 * Why a cap of 5 attempts:
 *   Beyond a handful of retries the ElevenLabs server has had time to
 *   stabilise; further retries just burn quota. The wrapper surfaces a
 *   terminal `network` error event once the cap is reached so the UI
 *   can present an actionable state.
 *
 * Attempt indexing:
 *   `attempt` is the zero-based count of *previous* failed attempts.
 *   `computeBackoffMs(0)` is the delay before the first retry,
 *   `computeBackoffMs(1)` before the second, and so on through
 *   `computeBackoffMs(RECONNECT_MAX_ATTEMPTS - 1)`. Passing
 *   `attempt >= RECONNECT_MAX_ATTEMPTS` returns `Infinity` as the
 *   sentinel "do not retry".
 */
import { RECONNECT_MAX_ATTEMPTS } from "./constants.js";

/**
 * Base delay in milliseconds for the first retry window. The window
 * doubles per attempt:
 *
 *   attempt 0 -> [0, 250]
 *   attempt 1 -> [0, 500]
 *   attempt 2 -> [0, 1000]
 *   attempt 3 -> [0, 2000]
 *   attempt 4 -> [0, 4000]
 *
 * Caller draws a uniform random number from the window.
 */
export const BACKOFF_BASE_MS = 250;

/**
 * Returns the milliseconds to wait before the next reconnect attempt.
 *
 * Implements `random(0, BACKOFF_BASE_MS * 2^attempt)` with the full-jitter
 * formulation. Returns `Infinity` once `attempt >= RECONNECT_MAX_ATTEMPTS`
 * so the caller treats it as "give up".
 *
 * @param attempt Zero-based count of previous failed attempts.
 */
export function computeBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) {
    throw new Error(
      `computeBackoffMs: attempt must be a non-negative finite number (got ${String(attempt)})`,
    );
  }
  if (attempt >= RECONNECT_MAX_ATTEMPTS) {
    return Infinity;
  }
  const upperBound = BACKOFF_BASE_MS * Math.pow(2, attempt);
  return Math.random() * upperBound;
}
