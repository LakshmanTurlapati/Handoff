// @vitest-environment jsdom
/**
 * Downsample worklet — pure helper + locked-constants tests.
 *
 * The 7 tests assert the LOOP-01 contract (PITFALLS #1):
 *   T1: sample rate ratio (960 → 320)
 *   T2: Int16 conversion bounds (clamp + scale)
 *   T3: resampling preserves shape (1 kHz sine round-trip)
 *   T4: deterministic output for identical input
 *   T5: input-length contract (throws TypeError)
 *   T6: locked constants
 *   T7: DOWNSAMPLE_WORKLET_NAME literal
 *
 * The AudioWorklet runtime path is NOT exercised here (jsdom has no
 * worklet realm). Plan 12-04's MOCK_LOOP integration smoke test
 * covers the end-to-end behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  DOWNSAMPLE_WORKLET_NAME,
  FRAME_DURATION_MS,
  FRAME_SAMPLES,
  FRAME_SAMPLES_48K,
  SOURCE_SAMPLE_RATE,
  TARGET_SAMPLE_RATE,
  downsample48kTo16kInt16,
} from "./downsample-worklet.js";

describe("downsample48kTo16kInt16 — pure resampling helper", () => {
  it("T1: returns a 320-sample frame for a 960-sample input (sample rate ratio)", () => {
    const input = new Float32Array(FRAME_SAMPLES_48K);
    const output = downsample48kTo16kInt16(input);
    expect(output.length).toBe(FRAME_SAMPLES);
    expect(output.length).toBe(320);
  });

  it("T2: clamps values outside [-1, 1] and scales to Int16 bounds", () => {
    const input = new Float32Array(FRAME_SAMPLES_48K);
    // Repeating triplet [+2.0, -2.0, 0.0] — the +2.0 / -2.0 should clamp.
    for (let i = 0; i < FRAME_SAMPLES_48K; i += 3) {
      input[i] = 2.0; // clamps to +1.0
      input[i + 1] = -2.0; // clamps to -1.0
      input[i + 2] = 0.0;
    }
    const output = downsample48kTo16kInt16(input);
    // Average of (1, -1, 0) is 0 → Int16 value 0.
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBe(0);
    }

    // Pure +1.0 sustained: average 1.0 → scaled to +32767.
    const allOnes = new Float32Array(FRAME_SAMPLES_48K);
    allOnes.fill(1.0);
    const outOnes = downsample48kTo16kInt16(allOnes);
    expect(outOnes[0]).toBe(32767);
    expect(outOnes[FRAME_SAMPLES - 1]).toBe(32767);

    // Pure -1.0 sustained: average -1.0 → scaled to -32767 (symmetric edge).
    const allNegOnes = new Float32Array(FRAME_SAMPLES_48K);
    allNegOnes.fill(-1.0);
    const outNegOnes = downsample48kTo16kInt16(allNegOnes);
    expect(outNegOnes[0]).toBe(-32767);

    // Pure +0.5 sustained: average 0.5 → scaled to round(0.5 * 32767) = 16384.
    const allHalf = new Float32Array(FRAME_SAMPLES_48K);
    allHalf.fill(0.5);
    const outHalf = downsample48kTo16kInt16(allHalf);
    expect(outHalf[0]).toBe(Math.round(0.5 * 32767));

    // Confirm clamping for an upper spike above +1.0 (e.g., +1.5):
    // average is 1.5 / 1.0 / 1.0 depending on triplet; pure +1.5 → clamps to +1.0 → +32767.
    const allOnePointFive = new Float32Array(FRAME_SAMPLES_48K);
    allOnePointFive.fill(1.5);
    const outClampHigh = downsample48kTo16kInt16(allOnePointFive);
    expect(outClampHigh[0]).toBe(32767);

    // Confirm clamping for a lower spike below -1.0 (e.g., -1.5).
    const allMinusOnePointFive = new Float32Array(FRAME_SAMPLES_48K);
    allMinusOnePointFive.fill(-1.5);
    const outClampLow = downsample48kTo16kInt16(allMinusOnePointFive);
    expect(outClampLow[0]).toBe(-32767);
  });

  it("T3: a 1 kHz sine at 48 kHz round-trips to the same approximate frequency at 16 kHz (zero-crossing count within ±10%)", () => {
    // Generate a 1 kHz sine wave sampled at 48 kHz across the 960-sample
    // frame. 1 kHz × 20 ms = 20 full cycles → 40 zero crossings expected
    // at both rates.
    const input = new Float32Array(FRAME_SAMPLES_48K);
    for (let i = 0; i < FRAME_SAMPLES_48K; i++) {
      input[i] = Math.sin((2 * Math.PI * 1000 * i) / SOURCE_SAMPLE_RATE);
    }

    function countZeroCrossings16(arr: Int16Array): number {
      let n = 0;
      for (let i = 1; i < arr.length; i++) {
        // noUncheckedIndexedAccess: read with `!` after bounds-check above.
        const prev = arr[i - 1]!;
        const curr = arr[i]!;
        if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
          n++;
        }
      }
      return n;
    }
    function countZeroCrossings32(arr: Float32Array): number {
      let n = 0;
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1]!;
        const curr = arr[i]!;
        if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
          n++;
        }
      }
      return n;
    }

    const sourceZeros = countZeroCrossings32(input);
    const output = downsample48kTo16kInt16(input);
    const outZeros = countZeroCrossings16(output);

    // 1 kHz × 20 ms = 20 cycles → ~40 zero crossings. The 3-tap box
    // filter introduces minor smoothing but should not change the
    // crossing count by more than ±10%.
    expect(sourceZeros).toBeGreaterThan(35);
    expect(sourceZeros).toBeLessThan(45);
    const tolerance = Math.max(2, Math.floor(sourceZeros * 0.1));
    expect(outZeros).toBeGreaterThanOrEqual(sourceZeros - tolerance);
    expect(outZeros).toBeLessThanOrEqual(sourceZeros + tolerance);
  });

  it("T4: deterministic — two calls with the same input produce byte-equal output", () => {
    const input = new Float32Array(FRAME_SAMPLES_48K);
    for (let i = 0; i < FRAME_SAMPLES_48K; i++) {
      input[i] = Math.sin(i / 7) * 0.5;
    }
    const a = downsample48kTo16kInt16(input);
    const b = downsample48kTo16kInt16(input);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it("T5: rejects inputs whose length is not FRAME_SAMPLES_48K with a TypeError naming the constant", () => {
    // Too short.
    expect(() => downsample48kTo16kInt16(new Float32Array(959))).toThrow(
      TypeError,
    );
    expect(() => downsample48kTo16kInt16(new Float32Array(959))).toThrow(
      /FRAME_SAMPLES_48K/,
    );
    // Too long.
    expect(() => downsample48kTo16kInt16(new Float32Array(961))).toThrow(
      /FRAME_SAMPLES_48K/,
    );
    // Empty.
    expect(() => downsample48kTo16kInt16(new Float32Array(0))).toThrow(
      /FRAME_SAMPLES_48K/,
    );
  });

  it("T6: locked constants — sample rates + frame sizes pin LOOP-01", () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
    expect(FRAME_SAMPLES).toBe(320);
    expect(FRAME_SAMPLES_48K).toBe(960);
    expect(FRAME_DURATION_MS).toBe(20);
    expect(SOURCE_SAMPLE_RATE).toBe(48000);
    // Cross-check: the duration math holds.
    expect((TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000).toBe(FRAME_SAMPLES);
    expect((SOURCE_SAMPLE_RATE * FRAME_DURATION_MS) / 1000).toBe(
      FRAME_SAMPLES_48K,
    );
  });

  it("T7: DOWNSAMPLE_WORKLET_NAME is the literal Plan 12-04 wires against", () => {
    expect(DOWNSAMPLE_WORKLET_NAME).toBe("achilles-downsample-processor");
  });
});
