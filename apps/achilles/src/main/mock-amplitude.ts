/**
 * Deterministic mocked amplitude stream.
 *
 * Phase 11 needs to drive the renderer's circle + waveform without
 * touching a real microphone or TTS playback path. The stream below
 * emits an RMS value in [0, 1] per tick using a tiny LCG (linear
 * congruential generator) so two runs with the same seed produce
 * identical sequences — important for screenshot diff testing in
 * Plan 11-02's Playwright suite.
 *
 * 'listening' mode emits a sin-wave-shaped pattern in [0.2, 0.95].
 * 'speaking'  mode emits a slower-modulated pattern in [0.15, 0.85]
 *              that is provably distinct from 'listening' (see MA2
 *              behaviour test).
 * Other states emit a constant 0 — the renderer ignores amplitude
 *              outside listening/speaking but the stream still works
 *              so callers don't need to branch.
 */
import {
  AMPLITUDE_TICK_MS,
} from "../shared/constants.js";
import type { AchillesState } from "../shared/constants.js";

export interface MockAmplitudeStream {
  next(): number;
  reset(): void;
  stop(): void;
  emit(cb: (rms: number) => void): () => void;
}

export interface CreateMockAmplitudeStreamOptions {
  seed?: number;
  tickMs?: number;
}

/**
 * Tiny LCG — Numerical Recipes constants. The output is normalised
 * to [0, 1) by dividing by 2^32. We use this purely to add jitter
 * on top of the deterministic sin-wave so the visual doesn't look
 * synthetic.
 */
function makeLcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createMockAmplitudeStream(
  state: AchillesState,
  opts: CreateMockAmplitudeStreamOptions = {},
): MockAmplitudeStream {
  const initialSeed = opts.seed ?? 0xa5a5a5a5;
  const tickMs = opts.tickMs ?? AMPLITUDE_TICK_MS;

  let rng = makeLcg(initialSeed);
  let counter = 0;
  let emitTimer: ReturnType<typeof setInterval> | null = null;

  function compute(): number {
    if (state === "listening") {
      // Sin wave 0.5 base + 0.4 amplitude + 0.05 jitter; range
      // ≈ [0.2, 0.95]. Period ~ 30 ticks (1.5 s at 50 ms cadence).
      const sin = Math.sin(counter / 5) * 0.4 + 0.5;
      const jitter = (rng() - 0.5) * 0.1;
      counter++;
      return Math.max(0, Math.min(1, sin + jitter));
    }
    if (state === "speaking") {
      // Slower modulation (period ~ 60 ticks = 3 s), smaller jitter,
      // lower peak. Range ≈ [0.15, 0.85].
      const sin = Math.sin(counter / 10) * 0.3 + 0.45;
      const jitter = (rng() - 0.5) * 0.05;
      counter++;
      return Math.max(0, Math.min(1, sin + jitter));
    }
    // idle, processing, error → silent
    counter++;
    return 0;
  }

  function reset(): void {
    rng = makeLcg(initialSeed);
    counter = 0;
  }

  function stop(): void {
    if (emitTimer !== null) {
      clearInterval(emitTimer);
      emitTimer = null;
    }
  }

  function emit(cb: (rms: number) => void): () => void {
    stop();
    emitTimer = setInterval(() => {
      cb(compute());
    }, tickMs);
    return stop;
  }

  return {
    next: compute,
    reset,
    stop,
    emit,
  };
}
