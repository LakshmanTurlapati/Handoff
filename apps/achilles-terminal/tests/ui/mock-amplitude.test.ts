/**
 * Mock amplitude stream tests (Phase 16, Plan 03, Task 3).
 *
 * Verifies createMockAmplitudeStream emits a deterministic seeded
 * 1.5s speech-like ramp + 1.5s silence loop at 20ms cadence, per
 * CONTEXT.md `<specifics>` row 5.
 *
 * No emojis (CLAUDE.md global). No application launches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockAmplitudeStream } from "../../src/ui/mock-amplitude.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMockAmplitudeStream", () => {
  it("Test 10: deterministic given a seed (two streams with same seed emit same frames)", () => {
    const aFrames: number[] = [];
    const bFrames: number[] = [];
    const a = createMockAmplitudeStream({
      seed: 42,
      onFrame: (amp) => aFrames.push(amp),
    });
    const b = createMockAmplitudeStream({
      seed: 42,
      onFrame: (amp) => bFrames.push(amp),
    });
    // Advance 60 frames (1.2s) for each stream — they should produce
    // identical sequences because the PRNG is seeded identically.
    vi.advanceTimersByTime(20 * 60);
    a.stop();
    b.stop();
    expect(aFrames.length).toBeGreaterThan(0);
    expect(aFrames).toEqual(bFrames);
  });

  it("Test 11: speech window peaks > 0.4, silence window levels < 0.1", () => {
    const frames: number[] = [];
    const stream = createMockAmplitudeStream({
      seed: 1,
      onFrame: (amp) => frames.push(amp),
    });
    // Advance through 60 frames (the full speech + silence loop period).
    vi.advanceTimersByTime(20 * 60);
    stream.stop();
    expect(frames).toHaveLength(60);
    // First 30 frames are the speech window — must include at least one peak > 0.4
    const speechWindow = frames.slice(0, 30);
    expect(Math.max(...speechWindow)).toBeGreaterThan(0.4);
    // Frames 30-59 are the silence window — all must be < 0.1
    const silenceWindow = frames.slice(30, 60);
    for (const v of silenceWindow) {
      expect(v).toBeLessThan(0.1);
    }
  });

  it("Test 12: stop() ceases frame emission within 100ms after stop", () => {
    const frames: number[] = [];
    const stream = createMockAmplitudeStream({
      seed: 7,
      onFrame: (amp) => frames.push(amp),
    });
    vi.advanceTimersByTime(20 * 10); // 10 frames worth
    const before = frames.length;
    stream.stop();
    vi.advanceTimersByTime(100);
    const after = frames.length;
    expect(after).toBe(before);
  });
});
