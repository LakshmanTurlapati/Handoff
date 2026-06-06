/**
 * MockAnalyser — Phase 11 testability seam.
 *
 * Shape-matches the Web Audio API's AnalyserNode by exposing:
 *
 *   - `frequencyBinCount: number`         — count of bins (default 32)
 *   - `getByteFrequencyData(array: Uint8Array): void` — fills array with
 *                                                       current bin
 *                                                       magnitudes in
 *                                                       [0, 255]
 *
 * The class is consumed by `Waveform` in the renderer. In Phase 12 a
 * real `AnalyserNode` driven off `getUserMedia` (listening) or the TTS
 * playback graph (speaking) will replace this stub — the Waveform's
 * interface stays identical because it only reads the two shape members
 * named above.
 *
 * Determinism: every internal value flows from a seeded LCG so two
 * MockAnalyser instances with identical constructor options produce
 * identical sequences. This is critical for e2e visual regression
 * assertions in Plan 11-02's Playwright suite.
 *
 * The renderer-side MockAnalyser is intentionally INDEPENDENT of the
 * Plan 11-01 `createMockAmplitudeStream` (which lives in the main
 * process directory). The renderer process must not reach across the
 * process boundary into the main process source tree — process
 * separation lock. This module inlines an equivalent LCG-driven
 * generator using the same seed convention so the two streams can be
 * compared by the e2e suite without crossing the process boundary.
 */
import type { AchillesState } from "../../shared/constants.js";

/**
 * Public shape — matches AnalyserNode's subset used by Waveform.
 */
export interface AnalyserLike {
  readonly frequencyBinCount: number;
  getByteFrequencyData(array: Uint8Array): void;
}

/**
 * Constructor options.
 *
 *   - state         — current AchillesState. Drives the pattern shape
 *                     (listening + speaking track the supplied source,
 *                     processing emits a shimmer, idle/error emit a
 *                     flat baseline).
 *   - amplitudeSource — optional callback returning an RMS in [0, 1].
 *                       When provided AND state is 'listening' or
 *                       'speaking', the bars track the supplied value.
 *                       When absent, an internal LCG-driven sin wave
 *                       fills the slot (deterministic).
 *   - barCount      — count of frequency bins (default 32, matches the
 *                     Waveform's bar count).
 *   - seed          — LCG seed for jitter (default 42 — same seed as
 *                     the Plan 11-01 createMockAmplitudeStream so the
 *                     two streams pair up for fixture comparisons).
 *   - tickMs        — internal sampling period (default 50ms = 20fps,
 *                     matches UI-SPEC §1 RMS tick).
 */
export interface MockAnalyserOptions {
  state: AchillesState;
  amplitudeSource?: () => number;
  barCount?: number;
  seed?: number;
  tickMs?: number;
}

const DEFAULT_BAR_COUNT = 32;
const DEFAULT_SEED = 42;
const DEFAULT_TICK_MS = 50;

/**
 * Tiny LCG matching Plan 11-01's `mock-amplitude.ts` Numerical Recipes
 * constants. The output is normalised to `[0, 1)` for downstream math.
 */
function makeLcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * MockAnalyser class. Constructed once per (state, source) pair; the
 * Waveform's `useMemo` keys on `state` so transitions tear down and
 * rebuild the analyser (which resets internal counters cleanly).
 */
export class MockAnalyser implements AnalyserLike {
  public readonly frequencyBinCount: number;

  private readonly state: AchillesState;
  private readonly amplitudeSource?: () => number;
  private readonly rng: () => number;
  private readonly tickMs: number;
  private buffer: Uint8Array;
  private counter: number;
  private tickHandle: ReturnType<typeof setInterval> | null;
  private stopped: boolean;

  public constructor(opts: MockAnalyserOptions) {
    this.frequencyBinCount = opts.barCount ?? DEFAULT_BAR_COUNT;
    this.state = opts.state;
    this.amplitudeSource = opts.amplitudeSource;
    this.rng = makeLcg(opts.seed ?? DEFAULT_SEED);
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.buffer = new Uint8Array(this.frequencyBinCount);
    this.counter = 0;
    this.tickHandle = null;
    this.stopped = false;
    // Seed the buffer with one initial snapshot so getByteFrequencyData
    // returns a meaningful pattern before the first tick fires.
    this.tickInternal();
    this.startTicking();
  }

  /**
   * Internal sampling tick — recomputes the bar magnitudes from the
   * current source and seed. Idempotent: callable any number of times
   * even after `stop()` (the last snapshot is preserved either way).
   */
  private tickInternal(): void {
    if (this.stopped) return;

    if (this.state === "listening" || this.state === "speaking") {
      // Drive bars from the supplied amplitude source. The RMS value
      // is shared across all bins but jittered per bin so the wave
      // does not look flat.
      const rms =
        this.amplitudeSource !== undefined
          ? Math.max(0, Math.min(1, this.amplitudeSource()))
          : 0.5 + Math.sin(this.counter / 5) * 0.4;
      for (let i = 0; i < this.frequencyBinCount; i++) {
        // Apply a per-bin curve so the centre bins peak higher than
        // the edges (matches what a real AnalyserNode looks like on a
        // human voice). Add small LCG jitter.
        const binCurve =
          1 - Math.abs(i - this.frequencyBinCount / 2) /
            (this.frequencyBinCount / 2);
        const jitter = (this.rng() - 0.5) * 0.1;
        const magnitude = Math.max(
          0,
          Math.min(1, rms * (0.5 + binCurve * 0.5) + jitter),
        );
        this.buffer[i] = Math.floor(magnitude * 255);
      }
    } else if (this.state === "processing") {
      // Shimmer: low fixed base height with subtle staggered phase
      // offset per bin. Deterministic for tests.
      for (let i = 0; i < this.frequencyBinCount; i++) {
        const phase = this.counter / 16 + i / 4;
        const magnitude = 0.08 + Math.sin(phase) * 0.04 + 0.04;
        this.buffer[i] = Math.floor(
          Math.max(0, Math.min(1, magnitude)) * 255,
        );
      }
    } else {
      // idle, error → flat baseline at 2/255 ≈ value 2 (matches
      // UI-SPEC §1 idle waveform row: "32 bars at 2px height").
      this.buffer.fill(2);
    }

    this.counter++;
  }

  /**
   * Starts the internal tick interval. Called once from the
   * constructor; idempotent on subsequent calls.
   */
  private startTicking(): void {
    if (this.tickHandle !== null) return;
    if (this.stopped) return;
    if (typeof setInterval === "undefined") return;
    this.tickHandle = setInterval(() => this.tickInternal(), this.tickMs);
  }

  /**
   * AnalyserNode-shaped data accessor. Copies the current internal
   * buffer into the supplied `array` slot-for-slot. If the array is
   * shorter than `frequencyBinCount`, only the first `array.length`
   * bins are copied (matches Web Audio spec).
   */
  public getByteFrequencyData(array: Uint8Array): void {
    const n = Math.min(array.length, this.frequencyBinCount);
    for (let i = 0; i < n; i++) {
      array[i] = this.buffer[i]!;
    }
  }

  /**
   * Halts the internal tick. After `stop()` is called,
   * `getByteFrequencyData` returns the last-emitted snapshot without
   * further mutation. Safe to call multiple times.
   */
  public stop(): void {
    this.stopped = true;
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }
}
