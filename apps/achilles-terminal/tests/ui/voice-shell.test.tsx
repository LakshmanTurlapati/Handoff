/**
 * Phase 16 Plan 04 Task 2 — VoiceShell.tsx tests.
 *
 * Covers behavior tests 1-9 from 16-04-PLAN.md:
 *
 *   T1  default tree composition: Blob + Sparkline + StatusRow rendered;
 *       no ScreenReader; block + braille characters present
 *   T2  screen-reader-mode composition: ScreenReader + StatusRow only;
 *       no block / braille characters
 *   T3  m-key dispatches session.toggleMute exactly once
 *   T4  Ctrl-M (carriage return / non-"m" literal) is ignored
 *   T5  uppercase M is ignored (case-sensitive `input === "m"`)
 *   T6  20fps tick increments amplitude over time (idle breathing)
 *   T7  processing pulse envelope drives non-empty blob at t=100ms
 *   T8  StatusRow always mounted (both default + screen-reader modes
 *       contain "[idle]")
 *   T9  workspace-wide grep: zero RESEARCH A3 disabled-flag references
 *       anywhere under apps/achilles-terminal/src and
 *       apps/achilles-terminal/tests (the literal flag name is built from
 *       substrings inside the test so this file itself contributes zero
 *       false-positive matches)
 *
 * No emojis (CLAUDE.md global). LOOP-02 invariant: no voice-* imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render } from "ink-testing-library";
import chalk from "chalk";

import { VoiceShell } from "../../src/ui/VoiceShell.js";
import type { Session } from "../../src/session.js";
import type { AchillesState } from "../../src/state/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICE_SHELL_SRC = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "ui",
  "VoiceShell.tsx",
);
const SRC_DIR = resolve(__dirname, "..", "..", "src");
const TESTS_DIR = resolve(__dirname, "..", "..", "tests");

/**
 * Build a deterministic stub Session that mimics the EventEmitter contract
 * the VoiceShell hooks subscribe to (state-change, amplitude, rms-sample).
 * toggleMute is a vi.fn so tests can assert the m-key dispatch path.
 */
function createStubSession(initial: {
  state: AchillesState;
  amplitude: number;
}): Session & {
  toggleMute: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter() as unknown as Session & {
    toggleMute: ReturnType<typeof vi.fn>;
  };
  const ring = new Float32Array(80);
  let writeIndex = 0;
  let ringSnapshot = { ring, writeIndex };
  Object.defineProperty(emitter, "currentState", {
    get: () => initial.state,
  });
  Object.defineProperty(emitter, "currentAmplitude", {
    get: () => initial.amplitude,
  });
  Object.defineProperty(emitter, "currentRingBuffer", {
    get: () => ringSnapshot,
  });
  emitter.toggleMute = vi.fn();
  // Cast helpers to satisfy the Session shape consumed by the hooks.
  (emitter as unknown as { setState: (s: AchillesState) => void }).setState = (
    s,
  ) => {
    initial.state = s;
    (emitter as EventEmitter).emit("state-change", s);
  };
  (
    emitter as unknown as {
      pushSample: (rms: number) => void;
    }
  ).pushSample = (rms) => {
    ring[writeIndex] = rms;
    writeIndex = (writeIndex + 1) % 80;
    ringSnapshot = { ring, writeIndex };
    initial.amplitude = rms;
    (emitter as EventEmitter).emit("amplitude", rms);
    (emitter as EventEmitter).emit("rms-sample", rms);
  };
  return emitter;
}

let originalLevel: number;

beforeEach(() => {
  originalLevel = chalk.level;
  // Disable chalk so we can assert substring content (e.g. "[idle]") without
  // ANSI escape interference.
  chalk.level = 0;
});

afterEach(() => {
  chalk.level = originalLevel as 0 | 1 | 2 | 3;
});

describe("VoiceShell.tsx (Phase 16 Plan 04 Task 2)", () => {
  it("T1: default tree composition — Blob + Sparkline + StatusRow rendered with block + braille characters", () => {
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { lastFrame } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      const frame = lastFrame() ?? "";
      // Block character from U+2580-U+259F
      expect(frame).toMatch(/[▀-▟]/);
      // Braille character from U+2800-U+28FF
      expect(frame).toMatch(/[⠀-⣿]/);
      // StatusRow tag
      expect(frame).toContain("[idle]");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T2: screen-reader-mode composition — ScreenReader + StatusRow only; no block / braille characters", () => {
    vi.stubEnv("INK_SCREEN_READER", "true");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { lastFrame } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      const frame = lastFrame() ?? "";
      // Screen-reader announcement string
      expect(frame).toContain("Achilles ready.");
      // No block characters
      expect(frame).not.toMatch(/[▀-▟]/);
      // No braille characters
      expect(frame).not.toMatch(/[⠀-⣿]/);
      // StatusRow is still mounted
      expect(frame).toContain("[idle]");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T3: m-key dispatches session.toggleMute exactly once", async () => {
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { stdin } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      stdin.write("m");
      // Yield to let Ink process the input event.
      await new Promise<void>((r) => setImmediate(r));
      expect(session.toggleMute).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T4: carriage-return / non-'m' literal is ignored — toggleMute NOT called", async () => {
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { stdin } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      stdin.write("\r");
      await new Promise<void>((r) => setImmediate(r));
      expect(session.toggleMute).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T5: uppercase M is ignored — case-sensitive `input === \"m\"`", async () => {
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { stdin } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      stdin.write("M");
      await new Promise<void>((r) => setImmediate(r));
      expect(session.toggleMute).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("T6: 20fps tick increments amplitude over time — idle breathing differs t=0 vs t=900", async () => {
    vi.useFakeTimers();
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "idle", amplitude: 0 });
      const { lastFrame } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      const initialFrame = lastFrame() ?? "";
      // Advance 900ms (18 ticks at 50ms each). idleBreathingAmplitude(0)
      // = 0.3; idleBreathingAmplitude(900) = 0.3 + 0.1*sin(1.5) ~= 0.3997.
      // The center cell intensity moves from 0.3*4=1.2 (round=1, "░") to
      // 0.3997*4=1.5988 (round=2, "▒"), so frames should differ.
      await vi.advanceTimersByTimeAsync(900);
      const laterFrame = lastFrame() ?? "";
      expect(laterFrame).not.toBe(initialFrame);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it("T7: processing pulse envelope drives a denser blob at t=100ms", async () => {
    vi.useFakeTimers();
    vi.stubEnv("INK_SCREEN_READER", "");
    try {
      const session = createStubSession({ state: "processing", amplitude: 0 });
      const { lastFrame } = render(
        <VoiceShell session={session} debugVad={false} />,
      );
      // At t=100ms: processingPulseAmplitude(100) = 0.5 + 0.3*sin(0.5) =
      // 0.5 + 0.3*0.479 ~= 0.644. With center-weighted ring kernel, the
      // center cell intensity is ~0.644 -> ramp index round(2.576) = 3 ->
      // dark shade "▓" (U+2593) or denser.
      await vi.advanceTimersByTimeAsync(100);
      const frame = lastFrame() ?? "";
      // Assert at least one medium-or-denser block character is present
      // (U+2592, U+2593, or U+2588).
      expect(frame).toMatch(/[▒▓█]/);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it("T8: StatusRow always mounted — both default and screen-reader modes contain '[idle]'", () => {
    // Default mode
    vi.stubEnv("INK_SCREEN_READER", "");
    const sessionDefault = createStubSession({ state: "idle", amplitude: 0 });
    const { lastFrame: defaultFrame } = render(
      <VoiceShell session={sessionDefault} debugVad={false} />,
    );
    expect(defaultFrame() ?? "").toContain("[idle]");
    vi.unstubAllEnvs();

    // Screen-reader mode
    vi.stubEnv("INK_SCREEN_READER", "true");
    const sessionSr = createStubSession({ state: "idle", amplitude: 0 });
    const { lastFrame: srFrame } = render(
      <VoiceShell session={sessionSr} debugVad={false} />,
    );
    expect(srFrame() ?? "").toContain("[idle]");
    vi.unstubAllEnvs();
  });

  it("T9: workspace-wide grep — zero RESEARCH A3 disabled-flag references under src/ and tests/", () => {
    // RESEARCH A3 invariant: render() must NOT receive the option that
    // disables Ink's default Ctrl-C handler. Verified by grepping for the
    // literal flag name across src/ and tests/. Build the flag string from
    // substrings here so this file does not itself contribute a match.
    const flag = "exit" + "OnCtrl" + "C";
    let result = "";
    try {
      result = execSync(
        `grep -rF '${flag}' ${SRC_DIR} ${TESTS_DIR} 2>/dev/null || true`,
        { encoding: "utf8" },
      ).trim();
    } catch (err) {
      throw err;
    }
    const lines = result.split("\n").filter((line) => line.length > 0);
    expect(lines).toEqual([]);
  });

  it("T9b: VoiceShell.tsx source contains literal !key.ctrl, !key.meta, and `input === \"m\"`", () => {
    const source = readFileSync(VOICE_SHELL_SRC, "utf8");
    expect(source).toContain("!key.ctrl");
    expect(source).toContain("!key.meta");
    expect(source).toContain('input === "m"');
  });
});
