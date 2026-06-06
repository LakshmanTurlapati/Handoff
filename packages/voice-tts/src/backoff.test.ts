/**
 * Unit tests for @achilles/voice-tts/backoff.
 *
 * Mirrors the STT package's backoff test shape (CONTEXT.md leaves
 * extraction to v1.3). Exercises:
 *
 *   - Each attempt is bounded by the documented exponential ceiling.
 *   - Attempt index >= RECONNECT_MAX_ATTEMPTS returns Infinity so the
 *     caller treats it as "stop reconnecting".
 *   - Full jitter is actually random across many calls (sanity check).
 *
 * Citations:
 *   - PITFALLS #4 — WebSocket reconnect lifecycle + exponential backoff
 *     with full jitter + 429 distinctions
 */
import { describe, expect, it } from "vitest";

import { computeBackoffMs } from "./backoff.js";
import { RECONNECT_MAX_ATTEMPTS } from "./constants.js";

describe("voice-tts/backoff — exponential with full jitter, capped at RECONNECT_MAX_ATTEMPTS", () => {
  it("attempt 0 returns a value in [0, 250]", () => {
    for (let i = 0; i < 50; i += 1) {
      const ms = computeBackoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(250);
    }
  });

  it("attempt 1 returns a value in [0, 500]", () => {
    for (let i = 0; i < 50; i += 1) {
      const ms = computeBackoffMs(1);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(500);
    }
  });

  it("attempts 2..4 return values within their exponential ceilings", () => {
    for (let i = 0; i < 50; i += 1) {
      const a2 = computeBackoffMs(2);
      const a3 = computeBackoffMs(3);
      const a4 = computeBackoffMs(4);
      expect(a2).toBeGreaterThanOrEqual(0);
      expect(a2).toBeLessThanOrEqual(1000);
      expect(a3).toBeGreaterThanOrEqual(0);
      expect(a3).toBeLessThanOrEqual(2000);
      expect(a4).toBeGreaterThanOrEqual(0);
      expect(a4).toBeLessThanOrEqual(4000);
    }
  });

  it("attempt RECONNECT_MAX_ATTEMPTS returns Infinity (give-up signal)", () => {
    expect(computeBackoffMs(RECONNECT_MAX_ATTEMPTS)).toBe(Infinity);
    expect(computeBackoffMs(RECONNECT_MAX_ATTEMPTS + 1)).toBe(Infinity);
    expect(computeBackoffMs(100)).toBe(Infinity);
  });

  it("produces sufficiently varied values across 100 invocations (jitter is actually random)", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      samples.add(computeBackoffMs(2));
    }
    // Jitter is `Math.random() * 1000` for attempt 2 — at least 80 of
    // the 100 samples should differ (statistical sanity check).
    expect(samples.size).toBeGreaterThanOrEqual(80);
  });
});
