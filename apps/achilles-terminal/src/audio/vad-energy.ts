/**
 * CAP-02 + CAP-04 — adaptive-EWMA energy VAD (Phase 16, Plan 01, Task 2).
 *
 * Observes RMS-per-frame from mic-sox.ts (or the mock generator) and emits
 * "speech_start" / "speech_end" events through pure-function classification.
 * No I/O, no timers, no React — the entire surface is a closure-state
 * reducer keyed off observe(rms, dt) calls.
 *
 * Pipeline (per RESEARCH.md §"EWMA noise floor + warmup + self-trigger guard"):
 *
 *   1. EWMA noise-floor update — gated by `rms < noiseFloor * 1.5 OR
 *      warmupRemaining > 0` so a startup mic-test spike or in-utterance
 *      energy peak cannot poison the running estimate (anti-poisoning,
 *      RESEARCH.md line 717).
 *
 *   2. Hard minimum noiseFloor >= 0.001 so VOICE_THRESHOLD never drops to
 *      zero on a perfectly silent ADC.
 *
 *   3. Warmup (25 frames @ 20ms hop = 500ms) — observe but do not classify.
 *      EWMA still updates so the noise estimate has converged before the
 *      first speech_start can fire.
 *
 *   4. Mute / self-trigger guard — when either flag is set, classification
 *      is suppressed at the VAD layer (NOT the state machine layer). The
 *      EWMA update still runs in step 1, so the floor stays current while
 *      the orchestrator is talking back to the user during TTS playback.
 *
 *   5. Voice-hold (60ms) — three consecutive above-threshold frames open
 *      the speech_start gate exactly once. State transitions to "voice".
 *
 *   6. Silence-hold (300ms) — 15 consecutive below-threshold frames in the
 *      "voice" state close it. State transitions to "silence". If voicedMs
 *      (cumulative time spent in the voice state) is below minUtteranceMs
 *      (default 300ms), speech_end is SUPPRESSED — short utterances are
 *      discarded as noise.
 *
 * The handle exposes `setMuted`, `setSelfTriggerGuard`, `reset`, and
 * `snapshot` so the orchestrator can drive the four behaviour flags and
 * stream JSON-line VAD telemetry to stderr via `--debug-vad` (Plan 04).
 *
 * DEFAULT_VAD_CONFIG carries the locked CONTEXT.md + RESEARCH.md values.
 * Plan 04's session.ts will spread settings from the (stubbed) loader over
 * the defaults before constructing the handle.
 */

/** Configuration knobs for the EWMA VAD. */
export interface VadConfig {
  /** EWMA smoothing factor. Lower = slower adaptation. CONTEXT.md locks 0.05. */
  alpha: number;
  /** VOICE_THRESHOLD = noiseFloor * voiceThresholdRatio. CONTEXT.md locks 3. */
  voiceThresholdRatio: number;
  /** Consecutive above-threshold ms required to enter "voice". CONTEXT.md locks 60. */
  voiceHoldMs: number;
  /** Consecutive below-threshold ms required to leave "voice". CONTEXT.md locks 300. */
  silenceHoldMs: number;
  /** Minimum total voiced ms before speech_end may fire. CONTEXT.md locks 300. */
  minUtteranceMs: number;
  /** Frames during which observe() returns null while EWMA converges. RESEARCH.md locks 25. */
  warmupFrames: number;
  /** Starting noise floor before warmup converges. RESEARCH.md locks 0.005. */
  initialNoiseFloor: number;
}

/** Event emitted from observe(). null = no transition this frame. */
export type VadEvent = "speech_start" | "speech_end" | null;

/** Public handle returned by {@link createEnergyVad}. */
export interface VadHandle {
  /**
   * Push one frame's RMS into the VAD. `dt` is the elapsed milliseconds
   * since the previous observe() call (typically 20ms for the 16kHz, 320-
   * sample frames produced by mic-sox.ts).
   */
  observe(rms: number, dt: number): VadEvent;
  /** Suppress speech_start while the user has muted the mic (CAP-03). */
  setMuted(active: boolean): void;
  /** Suppress speech_start while the orchestrator is in "speaking" state. */
  setSelfTriggerGuard(active: boolean): void;
  /** Restore all closure state to construction-time values. */
  reset(): void;
  /** Read-only snapshot for the --debug-vad JSON-line emitter. */
  snapshot(): {
    rms: number;
    noiseFloor: number;
    threshold: number;
    state: "silence" | "voice";
    warmupRemaining: number;
  };
}

/** Locked defaults — see module-level doc-comment for source of each value. */
export const DEFAULT_VAD_CONFIG: Readonly<VadConfig> = Object.freeze({
  alpha: 0.05,
  voiceThresholdRatio: 3,
  voiceHoldMs: 60,
  silenceHoldMs: 300,
  minUtteranceMs: 300,
  warmupFrames: 25,
  initialNoiseFloor: 0.005,
});

/**
 * Create a fresh VAD with the given configuration. Each handle owns
 * independent closure state — multiple VADs can coexist without
 * cross-talk.
 */
export function createEnergyVad(config: VadConfig): VadHandle {
  let state: "silence" | "voice" = "silence";
  let noiseFloor = config.initialNoiseFloor;
  let consecutiveMs = 0;
  let voicedMs = 0;
  let warmupRemaining = config.warmupFrames;
  let muted = false;
  let selfTriggerGuard = false;
  let lastRms = 0;

  function observe(rms: number, dt: number): VadEvent {
    lastRms = rms;
    // 1. EWMA noise-floor update — anti-poisoning guard from RESEARCH.md
    //    line 717. Skip update when RMS is much larger than current floor
    //    UNLESS warmup is still active.
    if (rms < noiseFloor * 1.5 || warmupRemaining > 0) {
      noiseFloor = config.alpha * rms + (1 - config.alpha) * noiseFloor;
    }
    // 2. Hard minimum on noiseFloor — VOICE_THRESHOLD never collapses.
    if (noiseFloor < 0.001) noiseFloor = 0.001;

    // 3. Warmup — observe-only window.
    if (warmupRemaining > 0) {
      warmupRemaining -= 1;
      return null;
    }
    // 4. Mute / self-trigger guard — suppress at VAD layer per CONTEXT.md
    //    <decisions> "Self-trigger guard: VAD must not fire speech_start
    //    while state machine is in speaking".
    if (muted || selfTriggerGuard) {
      state = "silence";
      consecutiveMs = 0;
      voicedMs = 0;
      return null;
    }

    const threshold = noiseFloor * config.voiceThresholdRatio;

    if (state === "silence") {
      // 5. Voice-hold gate.
      if (rms > threshold) {
        consecutiveMs += dt;
        if (consecutiveMs >= config.voiceHoldMs) {
          state = "voice";
          consecutiveMs = 0;
          voicedMs = 0;
          return "speech_start";
        }
      } else {
        consecutiveMs = 0;
      }
    } else {
      // In "voice" state: accumulate voicedMs and watch for silence-hold.
      voicedMs += dt;
      if (rms < threshold) {
        consecutiveMs += dt;
        // 6. Silence-hold + minimum-utterance floor.
        if (consecutiveMs >= config.silenceHoldMs) {
          state = "silence";
          consecutiveMs = 0;
          if (voicedMs < config.minUtteranceMs) {
            voicedMs = 0;
            return null; // suppress speech_end for too-short utterances
          }
          voicedMs = 0;
          return "speech_end";
        }
      } else {
        consecutiveMs = 0;
      }
    }
    return null;
  }

  return {
    observe,
    setMuted(active: boolean): void {
      muted = active;
    },
    setSelfTriggerGuard(active: boolean): void {
      selfTriggerGuard = active;
    },
    reset(): void {
      state = "silence";
      noiseFloor = config.initialNoiseFloor;
      consecutiveMs = 0;
      voicedMs = 0;
      warmupRemaining = config.warmupFrames;
      muted = false;
      selfTriggerGuard = false;
      lastRms = 0;
    },
    snapshot() {
      return {
        rms: lastRms,
        noiseFloor,
        threshold: noiseFloor * config.voiceThresholdRatio,
        state,
        warmupRemaining,
      };
    },
  };
}
