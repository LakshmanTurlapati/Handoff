import { describe, expect, it } from "vitest";
import { BACKOFF_BASE_MS, computeBackoffMs } from "./backoff.js";
import { RECONNECT_MAX_ATTEMPTS } from "./constants.js";

describe("computeBackoffMs (PITFALLS #4 — exponential + full jitter)", () => {
  it("attempt 0 returns a value in [0, BACKOFF_BASE_MS]", () => {
    for (let i = 0; i < 50; i += 1) {
      const ms = computeBackoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(BACKOFF_BASE_MS);
    }
  });

  it("attempt 1 returns a value in [0, 2 * BACKOFF_BASE_MS]", () => {
    for (let i = 0; i < 50; i += 1) {
      const ms = computeBackoffMs(1);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(BACKOFF_BASE_MS * 2);
    }
  });

  it("attempts 2, 3, 4 stay within their doubling caps", () => {
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const cap = BACKOFF_BASE_MS * Math.pow(2, attempt);
      for (let i = 0; i < 30; i += 1) {
        const ms = computeBackoffMs(attempt);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("returns Infinity when attempt >= RECONNECT_MAX_ATTEMPTS (give-up sentinel)", () => {
    expect(computeBackoffMs(RECONNECT_MAX_ATTEMPTS)).toBe(Infinity);
    expect(computeBackoffMs(RECONNECT_MAX_ATTEMPTS + 1)).toBe(Infinity);
    expect(computeBackoffMs(99)).toBe(Infinity);
  });

  it("produces actually random values across 100 invocations (jitter sanity)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(computeBackoffMs(2));
    }
    // At least 80 distinct values means the jitter is functioning;
    // a constant or near-constant generator would produce far fewer.
    expect(seen.size).toBeGreaterThanOrEqual(80);
  });

  it("rejects a negative attempt", () => {
    expect(() => computeBackoffMs(-1)).toThrow();
  });

  it("rejects NaN", () => {
    expect(() => computeBackoffMs(Number.NaN)).toThrow();
  });
});
