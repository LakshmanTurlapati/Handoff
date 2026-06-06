/**
 * Behaviour tests for the mocked amplitude stream.
 *
 * The stream is deterministic so e2e tests can reason about the
 * mic / TTS amplitude IPC traffic without launching real audio.
 */
import { describe, expect, it } from "vitest";
import { createMockAmplitudeStream } from "./mock-amplitude.js";

describe("createMockAmplitudeStream — listening (MA1)", () => {
  it("returns values in [0, 1]", () => {
    const stream = createMockAmplitudeStream("listening", { seed: 42 });
    for (let i = 0; i < 100; i++) {
      const v = stream.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = createMockAmplitudeStream("listening", { seed: 7 });
    const b = createMockAmplitudeStream("listening", { seed: 7 });
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBeCloseTo(b.next(), 12);
    }
  });
});

describe("createMockAmplitudeStream — speaking (MA2)", () => {
  it("produces a different sequence than listening for the same seed", () => {
    const listening = createMockAmplitudeStream("listening", { seed: 1 });
    const speaking = createMockAmplitudeStream("speaking", { seed: 1 });

    let diff = 0;
    for (let i = 0; i < 50; i++) {
      if (Math.abs(listening.next() - speaking.next()) > 1e-6) diff++;
    }
    // At least half of the samples should differ — speaking has a
    // distinct deterministic pattern (slower modulation, lower peak).
    expect(diff).toBeGreaterThan(25);
  });

  it("values stay in [0, 1]", () => {
    const stream = createMockAmplitudeStream("speaking", { seed: 99 });
    for (let i = 0; i < 100; i++) {
      const v = stream.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("createMockAmplitudeStream — silent states (MA3)", () => {
  for (const state of ["idle", "processing", "error"] as const) {
    it(`returns constant 0 for state '${state}'`, () => {
      const stream = createMockAmplitudeStream(state);
      for (let i = 0; i < 10; i++) {
        expect(stream.next()).toBe(0);
      }
    });
  }
});

describe("createMockAmplitudeStream — emit() lifecycle", () => {
  it("emit() invokes the callback at the configured tick rate", async () => {
    const samples: number[] = [];
    const stream = createMockAmplitudeStream("listening", {
      seed: 1,
      tickMs: 1,
    });
    const stop = stream.emit((rms) => samples.push(rms));

    await new Promise((resolve) => setTimeout(resolve, 10));
    stop();
    const after = samples.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    // No additional samples after stop()
    expect(samples.length).toBe(after);
    expect(after).toBeGreaterThan(2);
  });

  it("reset() restarts the deterministic sequence", () => {
    const stream = createMockAmplitudeStream("listening", { seed: 11 });
    const first = [stream.next(), stream.next(), stream.next()];
    stream.reset();
    const second = [stream.next(), stream.next(), stream.next()];
    expect(first).toEqual(second);
  });
});
