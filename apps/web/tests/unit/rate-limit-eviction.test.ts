/**
 * WR-GAP-01 regression test: the in-memory rate-limit bucket map
 * must not grow past RATE_LIMIT_MAX_BUCKETS under IP rotation.
 *
 * The test drives `checkPairingCreateRateLimit` with synthetic
 * unique keys past the cap and asserts the Map size never
 * exceeds the limit. It also asserts the oldest bucket is the
 * one evicted (FIFO-by-windowStart).
 *
 * Runs under `phase-01-unit` via the `apps/web/tests/unit/**`
 * include glob in vitest.workspace.ts. No Next.js server, no
 * Auth.js, no mocks — pure in-process state.
 */
import { beforeEach, describe, it, expect } from "vitest";
import {
  RATE_LIMIT_MAX_BUCKETS,
  __resetRateLimitBuckets,
  checkPairingCreateRateLimit,
} from "../../lib/rate-limit";

// The bucket Map is module-private by design, so we probe its
// behavior through the public surface: after driving the limiter
// past RATE_LIMIT_MAX_BUCKETS, the earliest keys must behave as
// fresh buckets on re-entry (remaining = limit - 1) while the
// surviving keys must behave as existing buckets (remaining
// decrements on the second hit).

describe("rate-limit · WR-GAP-01 hard-cap eviction", () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
  });

  it("never exposes a buckets map size larger than RATE_LIMIT_MAX_BUCKETS after saturation", () => {
    const cap = RATE_LIMIT_MAX_BUCKETS;
    const overfill = cap + 50;

    // Insert `overfill` unique keys with monotonically increasing
    // `now` values so windowStart is strictly ordered.
    for (let i = 0; i < overfill; i += 1) {
      const res = checkPairingCreateRateLimit(`ip-${i}`, {
        now: 1_700_000_000_000 + i,
        limit: 10,
        windowMs: 60_000,
      });
      expect(res.allowed).toBe(true);
    }

    // After overfill, the earliest 50 keys must have been evicted.
    // Probe by re-calling with a much later `now` that is still
    // inside the surviving buckets' windows: if a bucket survived
    // the count increments and remaining decrements; if it was
    // evicted the limiter creates a fresh bucket and remaining
    // equals limit - 1.
    //
    // The later `now` is picked so it is within the window of the
    // surviving buckets (whose windowStart is 1_700_000_000_000 +
    // 50 .. 1_700_000_000_000 + overfill - 1), which are all well
    // within 60_000 ms of this probe time.

    const probeNow = 1_700_000_000_000 + overfill + 1_000;

    // The first 50 keys (indices 0..49) should have been evicted.
    for (let i = 0; i < 50; i += 1) {
      const res = checkPairingCreateRateLimit(`ip-${i}`, {
        now: probeNow,
        limit: 10,
        windowMs: 60_000,
      });
      // Fresh bucket after eviction → first call this window,
      // remaining = limit - 1 = 9.
      expect(res.remaining).toBe(9);
    }

    // The last 50 keys (indices overfill-50 .. overfill-1) should
    // still exist — a second call advances their count so
    // remaining becomes limit - 2 = 8.
    for (let i = overfill - 50; i < overfill; i += 1) {
      const res = checkPairingCreateRateLimit(`ip-${i}`, {
        now: probeNow,
        limit: 10,
        windowMs: 60_000,
      });
      // Surviving bucket → count incremented → remaining = 8.
      expect(res.remaining).toBe(8);
    }
  });

  it("RATE_LIMIT_MAX_BUCKETS is exported as a finite positive integer", () => {
    expect(Number.isFinite(RATE_LIMIT_MAX_BUCKETS)).toBe(true);
    expect(RATE_LIMIT_MAX_BUCKETS).toBeGreaterThan(0);
    expect(Number.isInteger(RATE_LIMIT_MAX_BUCKETS)).toBe(true);
  });
});
