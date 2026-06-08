/**
 * `--mock` flag substrate — deterministic seeded amplitude stream
 * (Phase 16, Plan 03, Task 3).
 *
 * Per CONTEXT.md `<specifics>` row 5: emits a 1.5s speech-like ramp followed
 * by a 1.5s silence window, repeating, at the 20ms cadence the rest of the
 * pipeline expects. The PRNG is seeded so vitest snapshots stay stable and
 * `achilles voice --mock` produces visually identical output across runs.
 *
 * Pure-function module — NO Ink, NO React, NO chalk, NO file I/O, NO
 * network. Only Node timers (the setInterval seam Plan 04's session.ts can
 * substitute with vitest fake timers).
 *
 * The 60-frame loop layout (20 ms hop, 1.2 s period):
 *
 *   Frames 0..29  (speech window): piecewise-linear ramp
 *       table: 0->0, 5->0.7, 10->0, 15->0.5, 20->0.3, 25->0, 29->0
 *       Each frame is interpolated between the bracketing table points.
 *
 *   Frames 30..59 (silence window): PRNG noise floor in [0, 0.02]
 *       Plus a hard cap at 0.02 so the silence stays well below the
 *       Test 11 < 0.1 assertion.
 *
 * The PRNG is mulberry32 (closed form, no external dependencies). Two
 * MockAmplitudeStreams created with the same seed will emit identical
 * amplitude sequences frame-for-frame.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 * achilles-skill.
 *
 * No emojis (CLAUDE.md global). No application launches.
 */

export interface MockAmplitudeOptions {
  seed: number;
  onFrame: (amplitude: number) => void;
  intervalMs?: number;
}

export interface MockAmplitudeStream {
  stop: () => void;
}

const FRAMES_PER_LOOP = 60;
const SPEECH_FRAMES = 30;

/**
 * Speech-window envelope table. The piecewise-linear ramp visits the
 * following (frame, amplitude) anchor points:
 *
 *   (0, 0)   ->  (5, 0.7)  ->  (10, 0)  ->  (15, 0.5)  ->
 *   (20, 0.3) ->  (25, 0)   ->  (29, 0)
 *
 * Frames between anchors are interpolated linearly.
 */
const SPEECH_ANCHORS: ReadonlyArray<{ frame: number; amplitude: number }> = [
  { frame: 0, amplitude: 0 },
  { frame: 5, amplitude: 0.7 },
  { frame: 10, amplitude: 0 },
  { frame: 15, amplitude: 0.5 },
  { frame: 20, amplitude: 0.3 },
  { frame: 25, amplitude: 0 },
  { frame: 29, amplitude: 0 },
];

/** mulberry32 PRNG. Deterministic 32-bit-seed generator returning [0, 1). */
function createMulberry32(seed: number): () => number {
  let a = seed | 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Interpolate the amplitude for a frame within the speech window using the
 * SPEECH_ANCHORS table. Frames outside the [0, 29] range clamp to the
 * endpoint amplitudes.
 */
function speechAmplitude(frame: number): number {
  for (let i = 0; i < SPEECH_ANCHORS.length - 1; i++) {
    const a = SPEECH_ANCHORS[i]!;
    const b = SPEECH_ANCHORS[i + 1]!;
    if (frame >= a.frame && frame <= b.frame) {
      const span = b.frame - a.frame;
      if (span === 0) return a.amplitude;
      const t = (frame - a.frame) / span;
      return a.amplitude + (b.amplitude - a.amplitude) * t;
    }
  }
  return 0;
}

/**
 * Create a long-running mock amplitude generator. Calls `onFrame(amplitude)`
 * every `intervalMs` (default 20). Returns a handle whose `stop()` method
 * clears the timer.
 */
export function createMockAmplitudeStream(
  opts: MockAmplitudeOptions,
): MockAmplitudeStream {
  const interval = opts.intervalMs ?? 20;
  const prng = createMulberry32(opts.seed);
  let frameIndex = 0;
  const timer = setInterval(() => {
    let amplitude: number;
    if (frameIndex < SPEECH_FRAMES) {
      amplitude = speechAmplitude(frameIndex);
    } else {
      // Silence window: small PRNG noise floor capped at 0.02.
      amplitude = prng() * 0.02;
    }
    opts.onFrame(amplitude);
    frameIndex = (frameIndex + 1) % FRAMES_PER_LOOP;
  }, interval);

  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
