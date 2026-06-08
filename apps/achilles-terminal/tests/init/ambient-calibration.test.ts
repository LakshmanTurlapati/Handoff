/**
 * Phase 18, Plan 02, Task 2 — RED tests for ambient-calibration.ts
 *
 * Tests for calibrateAmbient and writeNoiseFloorToSettings.
 * All tests inject deps seams — no real mic, no real ~/.achilles touch.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calibrateAmbient,
  writeNoiseFloorToSettings,
  DEFAULT_CALIBRATION_DURATION_MS,
  type CalibrationDeps,
  type SettingsWriteDeps,
} from "../../src/init/ambient-calibration.js";
import type { MicSoxHandle, MicSoxOptions } from "../../src/audio/mic-sox.js";

/**
 * Build a fake MicSox factory that emits `frameCount` frames with the given
 * amplitude (int16 signed, range 0..32767), then resolves stop() on call.
 */
function makeFakeMicFactory(
  sampleAmplitude: number,
  frameCount: number,
): CalibrationDeps["micSoxFactory"] {
  return (opts: MicSoxOptions): MicSoxHandle => {
    let stopped = false;
    let stopResolve: (() => void) | null = null;

    // Emit frames on next tick so the caller can attach the handle first.
    process.nextTick(() => {
      for (let i = 0; i < frameCount && !stopped; i++) {
        const frame = new Int16Array(320).fill(sampleAmplitude);
        opts.onFrame(frame);
      }
      // Signal stop.
      if (stopResolve) stopResolve();
    });

    return {
      stop: () =>
        new Promise<void>((resolve) => {
          stopped = true;
          if (stopResolve === null) {
            stopResolve = resolve;
          } else {
            resolve();
          }
        }),
      get currentStatus() {
        return stopped ? "exited" : "running" as const;
      },
    };
  };
}

/**
 * Build a fake that emits silent (all-zeros) frames.
 */
function makeSilentFactory(frameCount: number): CalibrationDeps["micSoxFactory"] {
  return makeFakeMicFactory(0, frameCount);
}

describe("calibrateAmbient — low amplitude noise", () => {
  it("with a fake micSoxFactory emitting 250 frames of low-amplitude noise returns noiseFloor between 0.001 and 0.05", async () => {
    // 1000 amplitude / 32768 ≈ 0.030 RMS — typical for a quiet office.
    const result = await calibrateAmbient({
      durationMs: 5000,
      micSoxFactory: makeFakeMicFactory(1000, 250),
      // Use fast-forward: we don't actually wait 5 seconds — frames are emitted synchronously.
      // The factory emits all frames on next tick, so the abort path is not needed here.
      // Use signal=undefined and rely on the frame-count ending.
    });
    expect(result.noiseFloor).toBeGreaterThanOrEqual(0.001);
    expect(result.noiseFloor).toBeLessThanOrEqual(0.05);
    expect(result.sampleCount).toBe(250);
  });
});

describe("calibrateAmbient — silent frames", () => {
  it("with a fake emitting silent (all zeros) frames returns noiseFloor close to 0", async () => {
    const result = await calibrateAmbient({
      durationMs: 5000,
      micSoxFactory: makeSilentFactory(250),
    });
    expect(result.noiseFloor).toBeCloseTo(0, 4);
  });
});

describe("calibrateAmbient — default duration", () => {
  it("duration defaults to 5000ms and sampleCount matches durationMs / 20ms hop", async () => {
    expect(DEFAULT_CALIBRATION_DURATION_MS).toBe(5000);
    const result = await calibrateAmbient({
      durationMs: DEFAULT_CALIBRATION_DURATION_MS,
      micSoxFactory: makeFakeMicFactory(500, 250),
    });
    // 5000ms / 20ms hop = 250 expected frames.
    expect(result.sampleCount).toBe(250);
    expect(result.durationMs).toBe(5000);
  });
});

describe("calibrateAmbient — onProgress callback", () => {
  it("onProgress callback fires at least once across the sample window", async () => {
    const progressCalls: number[] = [];
    await calibrateAmbient({
      durationMs: 5000,
      micSoxFactory: makeFakeMicFactory(500, 250),
      onProgress: (elapsedMs, sampleCount) => {
        progressCalls.push(sampleCount);
        void elapsedMs;
      },
    });
    expect(progressCalls.length).toBeGreaterThan(0);
  });
});

describe("calibrateAmbient — abort signal", () => {
  it("rejects with 'calibration_cancelled' when abort signal fires before duration elapses", async () => {
    const ac = new AbortController();
    const promise = calibrateAmbient({
      durationMs: 60000, // Very long — should be cancelled
      micSoxFactory: (opts) => {
        const handle: MicSoxHandle = {
          stop: () => Promise.resolve(),
          get currentStatus() { return "running" as const; },
        };
        // Abort immediately.
        process.nextTick(() => ac.abort());
        void opts;
        return handle;
      },
      signal: ac.signal,
    });
    await expect(promise).rejects.toMatch(/calibration_cancelled/);
  });
});

describe("calibrateAmbient — stop called", () => {
  it("stops the micSoxHandle when duration elapses (assert handle.stop called)", async () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    await calibrateAmbient({
      durationMs: 5000,
      micSoxFactory: (opts) => {
        process.nextTick(() => {
          for (let i = 0; i < 250; i++) {
            opts.onFrame(new Int16Array(320).fill(500));
          }
        });
        return {
          stop: stopSpy,
          get currentStatus() { return "running" as const; },
        };
      },
    });
    expect(stopSpy).toHaveBeenCalledOnce();
  });
});

describe("writeNoiseFloorToSettings — creates settings.json", () => {
  it("creates settings.json with { vad: { initialNoiseFloor: 0.012 } } when the file does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "achilles-calib-test-"));
    try {
      const deps: SettingsWriteDeps = {
        homedirImpl: () => dir,
      };
      await writeNoiseFloorToSettings(0.012, deps);
      const path = join(dir, ".achilles", "settings.json");
      expect(existsSync(path)).toBe(true);
      const content = JSON.parse(readFileSync(path, "utf8")) as {
        vad?: { initialNoiseFloor?: number };
      };
      expect(content.vad?.initialNoiseFloor).toBe(0.012);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeNoiseFloorToSettings — preserves other top-level keys", () => {
  it("PRESERVES other top-level keys when the file already has them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "achilles-calib-test-"));
    try {
      // Pre-write settings with an extra key.
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const achillesDir = join(dir, ".achilles");
      mkdirSync(achillesDir, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(achillesDir, "settings.json"),
        JSON.stringify({ debug_mode: true, vad: { voiceThresholdRatio: 3 } }),
        { mode: 0o600 },
      );
      const deps: SettingsWriteDeps = {
        homedirImpl: () => dir,
      };
      await writeNoiseFloorToSettings(0.015, deps);
      const content = JSON.parse(
        readFileSync(join(achillesDir, "settings.json"), "utf8"),
      ) as { debug_mode?: boolean; vad?: { initialNoiseFloor?: number; voiceThresholdRatio?: number } };
      expect(content.debug_mode).toBe(true);
      expect(content.vad?.initialNoiseFloor).toBe(0.015);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeNoiseFloorToSettings — preserves other vad keys", () => {
  it("PRESERVES other vad keys when settings.vad already has voice_threshold etc.", async () => {
    const dir = mkdtempSync(join(tmpdir(), "achilles-calib-test-"));
    try {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const achillesDir = join(dir, ".achilles");
      mkdirSync(achillesDir, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(achillesDir, "settings.json"),
        JSON.stringify({ vad: { voiceHoldMs: 60, silenceHoldMs: 300 } }),
        { mode: 0o600 },
      );
      const deps: SettingsWriteDeps = {
        homedirImpl: () => dir,
      };
      await writeNoiseFloorToSettings(0.008, deps);
      const content = JSON.parse(
        readFileSync(join(achillesDir, "settings.json"), "utf8"),
      ) as { vad?: { voiceHoldMs?: number; silenceHoldMs?: number; initialNoiseFloor?: number } };
      expect(content.vad?.voiceHoldMs).toBe(60);
      expect(content.vad?.silenceHoldMs).toBe(300);
      expect(content.vad?.initialNoiseFloor).toBe(0.008);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeNoiseFloorToSettings — 0o600 perms", () => {
  it("enforces 0o600 perms via chmodSync", async () => {
    const dir = mkdtempSync(join(tmpdir(), "achilles-calib-test-"));
    try {
      const chmodSpy = vi.fn();
      const deps: SettingsWriteDeps = {
        homedirImpl: () => dir,
        chmodSyncImpl: chmodSpy,
      };
      await writeNoiseFloorToSettings(0.012, deps);
      expect(chmodSpy).toHaveBeenCalledWith(expect.any(String), 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("percentile10 helper", () => {
  it("returns sorted[floor(0.1 * (n - 1))] for 100 values (fixture assertion)", async () => {
    // Build an array of 100 values where the 10th percentile is known.
    // sorted[floor(0.1 * 99)] = sorted[9]
    // If array is [0, 1, 2, ..., 99] / 100, the 10th element (0-indexed) is 0.09.
    const micFactory: CalibrationDeps["micSoxFactory"] = (opts) => {
      process.nextTick(() => {
        // Emit 100 frames where each frame's rms corresponds to index/100.
        // RMS of a constant-value int16 frame: amplitude / 32768.
        // We emit 100 frames with increasing amplitude.
        for (let i = 0; i < 100; i++) {
          // amplitude = i * 328 (roughly i/100 * 32768)
          const amp = Math.round((i / 100) * 32768);
          opts.onFrame(new Int16Array(320).fill(amp));
        }
      });
      return {
        stop: () => Promise.resolve(),
        get currentStatus() { return "running" as const; },
      };
    };

    const result = await calibrateAmbient({
      durationMs: 5000,
      micSoxFactory: micFactory,
    });

    // The 10th percentile of 100 values: floor(0.1 * 99) = index 9.
    // The 10th value in sorted ascending order (index 9 of 100 values starting from ~0).
    // amplitude index 9 => amp = round(9/100 * 32768) = round(2949.12) = 2949
    // rms = 2949 / 32768 ≈ 0.09
    expect(result.noiseFloor).toBeGreaterThan(0.08);
    expect(result.noiseFloor).toBeLessThan(0.12);
  });
});
