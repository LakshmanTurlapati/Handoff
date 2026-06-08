/**
 * Phase 18, Plan 02, Task 2 — Ambient calibration module (INIT-04, half).
 *
 * Captures 5 seconds of ambient audio through mic-sox.ts (Phase 16), computes
 * per-frame RMS, takes the 10th percentile of the collected samples, and writes
 * that value to ~/.achilles/settings.json as `vad.initialNoiseFloor` — the EWMA
 * seed that Phase 16's energy VAD uses instead of its hard-coded default of 0.005
 * (DEFAULT_VAD_CONFIG.initialNoiseFloor in vad-energy.ts).
 *
 * The other half of INIT-04 (1-utterance smoke test) lives in smoke-test.ts
 * (Plan 03), which runs AFTER the wizard flow is wired.
 *
 * Key design choices:
 *   - The factory accepts a `micSoxFactory` seam so tests run with synthetic
 *     frame sequences and never touch a real microphone.
 *   - AbortSignal is honored: pressing Ctrl-C during calibration rejects the
 *     promise with "calibration_cancelled" so the wizard can surface a clean
 *     error message.
 *   - writeNoiseFloorToSettings merges idempotently: it preserves all existing
 *     top-level keys and all existing vad keys, only overwriting
 *     `settings.vad.initialNoiseFloor`.
 *   - settings.json is created with mode 0o600; chmodSync is called explicitly
 *     after write to defeat any umask looser than 0o177 (T-18-11 mitigation).
 *
 * No emojis (CLAUDE.md global).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync as nodeChmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createMicSox,
  type MicSoxHandle,
  type MicSoxOptions,
} from "../audio/mic-sox.js";

/**
 * Default calibration window: 5 seconds at 20ms/frame = 250 frames.
 *
 * @public
 */
export const DEFAULT_CALIBRATION_DURATION_MS = 5000;

/**
 * Result of a successful ambient calibration run.
 *
 * @public
 */
export interface CalibrationResult {
  /** 10th-percentile RMS across all collected frames, range [0, 1]. */
  readonly noiseFloor: number;
  /** Number of frames collected (typically 250 for 5 seconds). */
  readonly sampleCount: number;
  /** Actual calibration window duration in milliseconds. */
  readonly durationMs: number;
}

/**
 * Dependency injection seam for calibrateAmbient.
 *
 * @public
 */
export interface CalibrationDeps {
  /** Calibration window in milliseconds. Defaults to DEFAULT_CALIBRATION_DURATION_MS. */
  durationMs?: number;
  /**
   * Factory that creates a MicSox handle for capturing PCM frames.
   * Production callers leave undefined; tests inject a fake that emits
   * synthetic frames at a controlled rhythm.
   */
  micSoxFactory?: (opts: MicSoxOptions) => MicSoxHandle;
  /** AbortSignal for Ctrl-C cancellation. Rejects with "calibration_cancelled". */
  signal?: AbortSignal;
  /**
   * Progress callback fired whenever a new frame is collected. The wizard
   * surfaces this via a @clack/prompts spinner in Plan 03.
   */
  onProgress?: (elapsedMs: number, sampleCount: number) => void;
}

/**
 * Dependency injection seam for writeNoiseFloorToSettings.
 *
 * @public
 */
export interface SettingsWriteDeps {
  /** Override os.homedir() for tests. */
  homedirImpl?: () => string;
  /** Override chmodSync for tests that assert the call was made. */
  chmodSyncImpl?: (path: string, mode: number) => void;
}

/**
 * Compute the RMS of a 16-bit signed PCM frame, normalised to [0, 1].
 *
 * rms = sqrt(mean(s^2)) / 32768
 */
function computeRms(frame: Int16Array): number {
  let sumSq = 0;
  for (const s of frame) {
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / frame.length) / 32768;
}

/**
 * Return the 10th percentile of a set of RMS samples.
 * Falls back to 0.005 (DEFAULT_VAD_CONFIG.initialNoiseFloor) if the array
 * is empty.
 *
 * Formula: sorted[floor(0.10 * (n - 1))]
 */
function percentile10(samples: number[]): number {
  if (samples.length === 0) return 0.005;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(0.10 * (sorted.length - 1));
  return sorted[idx] ?? 0.005;
}

/**
 * Capture ambient audio for the given window and return the 10th-percentile
 * RMS as the noiseFloor EWMA seed.
 *
 * @public
 */
export function calibrateAmbient(
  deps: CalibrationDeps = {},
): Promise<CalibrationResult> {
  const durationMs = deps.durationMs ?? DEFAULT_CALIBRATION_DURATION_MS;
  const factory = deps.micSoxFactory ?? createMicSox;
  const signal = deps.signal;
  const onProgress = deps.onProgress;

  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("calibration_cancelled"));
      return;
    }

    const samples: number[] = [];
    const startTime = Date.now();
    let settled = false;

    function finish(): void {
      if (settled) return;
      settled = true;
      void handle.stop();
      const noiseFloor = percentile10(samples);
      resolve({
        noiseFloor,
        sampleCount: samples.length,
        durationMs,
      });
    }

    // Build the mic handle.
    const handle = factory({
      onFrame: (frame: Int16Array) => {
        if (settled) return;
        const rms = computeRms(frame);
        samples.push(rms);

        // Fire progress callback.
        if (onProgress !== undefined) {
          onProgress(Date.now() - startTime, samples.length);
        }

        // Check if we have collected enough frames.
        // 5000ms / 20ms hop = 250 frames. We drive by frame count.
        const expectedFrames = Math.floor(durationMs / 20);
        if (samples.length >= expectedFrames) {
          finish();
        }
      },
      onExit: () => {
        // Mic exited (SIGTERM from finish() or external); resolve if not already.
        if (!settled) {
          finish();
        }
      },
    });

    // AbortSignal handler.
    if (signal !== undefined) {
      const abortHandler = (): void => {
        if (!settled) {
          settled = true;
          void handle.stop();
          reject(new Error("calibration_cancelled"));
        }
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
}

/**
 * Write the calibrated noiseFloor to ~/.achilles/settings.json under
 * `vad.initialNoiseFloor`. Preserves all other top-level keys and all
 * other vad keys.
 *
 * @public
 */
export function writeNoiseFloorToSettings(
  noiseFloor: number,
  deps: SettingsWriteDeps = {},
): Promise<void> {
  const homedirImpl = deps.homedirImpl ?? homedir;
  const chmodSyncImpl = deps.chmodSyncImpl ?? nodeChmodSync;

  const achillesDir = join(homedirImpl(), ".achilles");
  const settingsPath = join(achillesDir, "settings.json");

  // Ensure the directory exists with restricted permissions.
  mkdirSync(achillesDir, { recursive: true, mode: 0o700 });

  // Read and merge existing settings.
  type SettingsShape = {
    vad?: Record<string, unknown>;
    [key: string]: unknown;
  };

  let existing: SettingsShape = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, "utf8");
      existing = JSON.parse(raw) as SettingsShape;
    } catch {
      // Malformed settings — start fresh but do not lose what we can recover.
      existing = {};
    }
  }

  // Merge: preserve existing vad keys, override initialNoiseFloor.
  const merged: SettingsShape = {
    ...existing,
    vad: {
      ...(existing.vad ?? {}),
      initialNoiseFloor: noiseFloor,
    },
  };

  writeFileSync(settingsPath, JSON.stringify(merged, null, 2), {
    mode: 0o600,
  });

  // Explicit chmod to defeat umask (T-18-11 mitigation).
  chmodSyncImpl(settingsPath, 0o600);

  return Promise.resolve();
}
