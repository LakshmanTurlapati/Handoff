/**
 * MockAnalyser behaviour tests (MA1-MA4).
 *
 * Verifies that the renderer-side MockAnalyser shape-matches an
 * AnalyserNode subset and produces deterministic per-state patterns
 * suitable for Playwright fixture comparisons.
 *
 * No DOM, no React — these tests run in the node environment of the
 * phase-11-unit project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockAnalyser } from "./MockAnalyser.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MockAnalyser — MA1: frequencyBinCount === 32 (default)", () => {
  it("MA1: default barCount is 32 matching the Waveform default", () => {
    const a = new MockAnalyser({ state: "listening" });
    expect(a.frequencyBinCount).toBe(32);
    a.stop();
  });

  it("MA1 variant: custom barCount is honoured", () => {
    const a = new MockAnalyser({ state: "listening", barCount: 64 });
    expect(a.frequencyBinCount).toBe(64);
    a.stop();
  });
});

describe("MockAnalyser — MA2: getByteFrequencyData writes values in [0,255] tracking the source", () => {
  it("MA2a: getByteFrequencyData fills exactly 32 values in [0,255]", () => {
    const a = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.5,
    });
    const buf = new Uint8Array(32);
    a.getByteFrequencyData(buf);
    expect(buf).toHaveLength(32);
    for (const v of buf) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    a.stop();
  });

  it("MA2b: high RMS yields higher mean across bars than low RMS", () => {
    const lowSource = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.05,
      seed: 11,
    });
    const highSource = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.9,
      seed: 11,
    });
    const lowBuf = new Uint8Array(32);
    const highBuf = new Uint8Array(32);
    lowSource.getByteFrequencyData(lowBuf);
    highSource.getByteFrequencyData(highBuf);
    const meanLow = Array.from(lowBuf).reduce((a, b) => a + b, 0) / 32;
    const meanHigh = Array.from(highBuf).reduce((a, b) => a + b, 0) / 32;
    expect(meanHigh).toBeGreaterThan(meanLow);
    lowSource.stop();
    highSource.stop();
  });

  it("MA2c: speaking state with an amplitudeSource also tracks the source", () => {
    const lowSource = new MockAnalyser({
      state: "speaking",
      amplitudeSource: () => 0.1,
      seed: 7,
    });
    const highSource = new MockAnalyser({
      state: "speaking",
      amplitudeSource: () => 0.85,
      seed: 7,
    });
    const lowBuf = new Uint8Array(32);
    const highBuf = new Uint8Array(32);
    lowSource.getByteFrequencyData(lowBuf);
    highSource.getByteFrequencyData(highBuf);
    const meanLow = Array.from(lowBuf).reduce((a, b) => a + b, 0) / 32;
    const meanHigh = Array.from(highBuf).reduce((a, b) => a + b, 0) / 32;
    expect(meanHigh).toBeGreaterThan(meanLow);
    lowSource.stop();
    highSource.stop();
  });
});

describe("MockAnalyser — MA3: idle/processing/error emit state-specific deterministic patterns", () => {
  it("MA3a: idle emits a flat baseline at value 2", () => {
    const a = new MockAnalyser({ state: "idle" });
    const buf = new Uint8Array(32);
    a.getByteFrequencyData(buf);
    for (const v of buf) {
      expect(v).toBe(2);
    }
    a.stop();
  });

  it("MA3b: error emits a flat baseline at value 2", () => {
    const a = new MockAnalyser({ state: "error" });
    const buf = new Uint8Array(32);
    a.getByteFrequencyData(buf);
    for (const v of buf) {
      expect(v).toBe(2);
    }
    a.stop();
  });

  it("MA3c: processing emits a shimmer pattern (not flat, not full-amplitude)", () => {
    const a = new MockAnalyser({ state: "processing", seed: 13 });
    const buf = new Uint8Array(32);
    a.getByteFrequencyData(buf);
    // Not all values equal (shimmer must vary across bars or over time)
    const allSame = buf.every((v) => v === buf[0]);
    // Processing pattern is below 50/255 (low fixed-height bars per
    // UI-SPEC §1).
    let maxValue = 0;
    for (const v of buf) maxValue = Math.max(maxValue, v);
    expect(maxValue).toBeLessThan(50);
    // The shimmer accumulates entropy via the counter; the first
    // tick may or may not produce variation depending on phase, so
    // we tick a few times and compare consecutive snapshots.
    const buf2 = new Uint8Array(32);
    vi.advanceTimersByTime(200); // 4 ticks at 50ms
    a.getByteFrequencyData(buf2);
    // After multiple ticks the snapshot has drifted (shimmer is
    // deterministic but non-static across time).
    let diffCount = 0;
    for (let i = 0; i < 32; i++) {
      if (buf[i] !== buf2[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
    // Defensive: at least one of (initial-snapshot variation, time
    // variation) must yield variation. Belt + braces.
    expect(allSame || diffCount > 0).toBe(true);
    a.stop();
  });
});

describe("MockAnalyser — MA4: stop() halts the internal tick", () => {
  it("MA4: after stop() subsequent getByteFrequencyData calls return the last snapshot unchanged", () => {
    const a = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.7,
      seed: 42,
    });

    const snapBefore = new Uint8Array(32);
    a.getByteFrequencyData(snapBefore);

    a.stop();

    // Advance virtual time — without a running tick the buffer must
    // not change.
    vi.advanceTimersByTime(500);

    const snapAfter = new Uint8Array(32);
    a.getByteFrequencyData(snapAfter);

    for (let i = 0; i < 32; i++) {
      expect(snapAfter[i]).toBe(snapBefore[i]!);
    }
  });

  it("MA4 variant: stop() is idempotent", () => {
    const a = new MockAnalyser({ state: "listening" });
    expect(() => {
      a.stop();
      a.stop();
      a.stop();
    }).not.toThrow();
  });
});
