/**
 * Phase 16 Plan 04 Task 1 — Session composition root tests.
 *
 * Covers behavior tests 1-7, 9, 10 from 16-04-PLAN.md (test 8 lives in
 * tests/ui/voice-shell.test.tsx where it requires a React mount):
 *
 *   T1  loadSettings returns DEFAULT_VAD_CONFIG defaults; distinct refs per call
 *   T2  Session construction default state idle
 *   T3  Session.toggleMute round-trip emits state-change "muted" then "idle"
 *   T4  Session.toggleMute drives VAD setMuted(true/false)
 *   T5  Session.start --mock mode emits amplitude > 0.4 within 30 frames
 *   T6  Session.start real mode wires mic-sox + VAD; speech_start -> listening
 *   T7  sox onExit triggers error state + stderr emission
 *   T9  --debug-vad emits locked JSON shape per frame
 *   T10 LOOP-02 invariant — session.ts source has no voice-* imports
 *
 * No emojis (CLAUDE.md global). LOOP-02 invariant: no voice-* imports.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { spawn as spawnFn } from "node:child_process";

import { loadSettings } from "../src/store-stub.js";
import { createSession } from "../src/session.js";
import { DEFAULT_VAD_CONFIG, type VadHandle } from "../src/audio/vad-energy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_SRC = resolve(__dirname, "..", "src", "session.ts");

type SpawnArgs = Parameters<typeof spawnFn>;

/**
 * Minimal stand-in for a node:child_process child — same shape used by the
 * Plan 01 mic-sox.test.ts (EventEmitter + stdout/stderr EventEmitters + a
 * vi.fn kill).
 */
function makeFakeChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/**
 * Build a deterministic VAD stub for testability. Default observe returns
 * null so the orchestrator stays in idle; tests override the implementation
 * to return "speech_start" / "speech_end" as needed.
 */
function makeStubVad(): VadHandle & {
  observe: ReturnType<typeof vi.fn>;
  setMuted: ReturnType<typeof vi.fn>;
  setSelfTriggerGuard: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
} {
  const stub = {
    observe: vi.fn(() => null),
    setMuted: vi.fn(),
    setSelfTriggerGuard: vi.fn(),
    reset: vi.fn(),
    snapshot: vi.fn(() => ({
      rms: 0,
      noiseFloor: 0.005,
      threshold: 0.015,
      state: "silence" as const,
      warmupRemaining: 25,
    })),
  };
  return stub;
}

describe("Session composition root (Phase 16 Plan 04 Task 1)", () => {
  it("T1: loadSettings returns DEFAULT_VAD_CONFIG defaults with fresh object reference per call", () => {
    const a = loadSettings();
    const b = loadSettings();
    // Equal by value
    expect(a.vad).toEqual(DEFAULT_VAD_CONFIG);
    expect(b.vad).toEqual(DEFAULT_VAD_CONFIG);
    // Distinct references — mutating a.vad must not affect b.vad
    expect(a.vad).not.toBe(b.vad);
    (a.vad as unknown as { alpha: number }).alpha = 999;
    expect(b.vad.alpha).toBe(DEFAULT_VAD_CONFIG.alpha);
  });

  it("T2: Session construction defaults to idle state", () => {
    const session = createSession({ vadOverride: makeStubVad() });
    expect(session.currentState).toBe("idle");
  });

  it("T3: Session.toggleMute round-trips idle <-> muted with state-change emissions", () => {
    const session = createSession({ vadOverride: makeStubVad() });
    const events: string[] = [];
    session.on("state-change", (s: string) => {
      events.push(s);
    });
    expect(session.currentState).toBe("idle");
    session.toggleMute();
    expect(session.currentState).toBe("muted");
    expect(events).toEqual(["muted"]);
    session.toggleMute();
    expect(session.currentState).toBe("idle");
    expect(events).toEqual(["muted", "idle"]);
  });

  it("T4: Session.toggleMute drives VAD setMuted(true) then setMuted(false)", () => {
    const vad = makeStubVad();
    const session = createSession({ vadOverride: vad });
    session.toggleMute();
    expect(vad.setMuted).toHaveBeenCalledWith(true);
    session.toggleMute();
    expect(vad.setMuted).toHaveBeenLastCalledWith(false);
    expect(vad.setMuted).toHaveBeenCalledTimes(2);
  });

  it("T5: Session.start in --mock mode emits amplitude > 0.4 within speech-window peak", () => {
    vi.useFakeTimers();
    try {
      const vad = makeStubVad();
      const session = createSession({
        mock: true,
        mockSeed: 42,
        vadOverride: vad,
      });
      const amplitudes: number[] = [];
      session.on("amplitude", (amp: number) => {
        amplitudes.push(amp);
      });
      session.start();
      // Advance 600ms = 30 frames at 20ms — covers the full speech window.
      vi.advanceTimersByTime(600);
      const peak = Math.max(...amplitudes);
      expect(peak).toBeGreaterThan(0.4);
      void session.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("T6: Session.start real mode wires mic-sox + VAD; speech_start -> listening", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const vad = makeStubVad();
    // Make the VAD return speech_start on the first observe call.
    vad.observe.mockImplementationOnce(() => "speech_start");
    const session = createSession({
      mock: false,
      spawnImpl: fakeSpawn as never,
      vadOverride: vad,
    });
    const states: string[] = [];
    session.on("state-change", (s: string) => {
      states.push(s);
    });
    session.start();
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    // Emit a 640-byte PCM frame (320 Int16 samples).
    fakeChild.stdout.emit("data", Buffer.alloc(640, 0x12));
    expect(vad.observe).toHaveBeenCalledTimes(1);
    expect(states).toContain("listening");
  });

  it("T7: sox onExit (non-zero) triggers error state + stderr hint emission", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const vad = makeStubVad();
      const session = createSession({
        mock: false,
        spawnImpl: fakeSpawn as never,
        vadOverride: vad,
      });
      const states: string[] = [];
      session.on("state-change", (s: string) => {
        states.push(s);
      });
      session.start();
      // Simulate sox writing to stderr then exiting non-zero.
      fakeChild.stderr.emit("data", Buffer.from("no default device", "utf8"));
      fakeChild.emit("exit", 1, null);
      // The session should write a hint string to process.stderr.
      const writeCalls = stderrSpy.mock.calls.map((call) =>
        typeof call[0] === "string" ? call[0] : call[0].toString(),
      );
      const combined = writeCalls.join("");
      expect(combined).toContain("no default device");
      expect(states).toContain("error");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("T9: --debug-vad emits the locked JSON-line shape on every VAD observe", () => {
    vi.useFakeTimers();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const vad = makeStubVad();
      const session = createSession({
        mock: true,
        debugVad: true,
        mockSeed: 42,
        vadOverride: vad,
      });
      session.start();
      // Drive one mock-amplitude tick (20ms hop).
      vi.advanceTimersByTime(20);
      const writeCalls = stderrSpy.mock.calls.map((call) =>
        typeof call[0] === "string" ? call[0] : call[0].toString(),
      );
      const combined = writeCalls.join("");
      // The locked CONTEXT.md <specifics> row 4 shape:
      //   {"t":<ts>,"energy":<rms>,"noiseFloor":<num>,"threshold":<num>,
      //    "state":"silence"|"voice","warmupRemaining":<num>}
      expect(combined).toMatch(
        /\{"t":\d+,"energy":[\d.]+,"noiseFloor":[\d.]+,"threshold":[\d.]+,"state":"(silence|voice)","warmupRemaining":\d+\}/,
      );
      void session.stop();
    } finally {
      stderrSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("T10: LOOP-02 invariant — session.ts contains no voice-* / claude-code-bridge / achilles-skill imports", () => {
    const source = readFileSync(SESSION_SRC, "utf8");
    // Capture every import statement line.
    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s+/.test(line));
    const violations: string[] = [];
    const blocked = [
      "@achilles/voice-protocol",
      "@achilles/voice-stt",
      "@achilles/voice-tts",
      "@achilles/claude-code-bridge",
      "@achilles/achilles-skill",
    ];
    for (const line of importLines) {
      for (const pkg of blocked) {
        if (line.includes(pkg)) {
          violations.push(`${pkg}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
