/**
 * Phase 19, Plan 02, Task 1 — ERR-01 Banner.tsx behavior tests.
 *
 * Covers 7 behaviors per 19-02-PLAN.md Task 1 <behavior> + RESEARCH
 * §Pattern 3 + §Pitfall 7:
 *
 *   T-BAN-01 renders nothing when classification === null
 *   T-BAN-02 renders "[error] <class> -- <suggestedAction>" text shape
 *            when classification is set
 *   T-BAN-03 source contains aria-role="timer" + aria-label
 *            (A8 + D-11 screen-reader announcement)
 *   T-BAN-04 auto-dismisses after BANNER_AUTO_DISMISS_MS (8_000ms)
 *   T-BAN-05 dismisses early on successNonce bump
 *   T-BAN-06 errorNonce bump mid-display resets the 8s timer
 *            (Pitfall 7 — errorNonce-in-deps guard)
 *   T-BAN-07 integration: VoiceShell renders Banner as FIRST child
 *            of the root <Box flexDirection="column"> (D-10 layout)
 *
 * Test discipline:
 *   - vi.useFakeTimers() so the 8s auto-dismiss is observable in a
 *     unit-test budget
 *   - ink-testing-library render() per ScreenReader/VoiceShell test
 *     precedent
 *   - chalk.level=0 so we can assert literal substrings without ANSI
 *     interference
 *
 * No emojis (CLAUDE.md global). LOOP-02 invariant: no voice-* imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { render } from "ink-testing-library";
import chalk from "chalk";

import {
  Banner,
  BANNER_AUTO_DISMISS_MS,
  type BannerProps,
} from "../../src/ui/Banner.js";
import type { ClassifiedBanner } from "../../src/error-classifier.js";
import { VoiceShell } from "../../src/ui/VoiceShell.js";
import type { Session } from "../../src/session.js";
import type { AchillesState } from "../../src/state/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANNER_SRC = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "ui",
  "Banner.tsx",
);
const VOICE_SHELL_SRC = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "ui",
  "VoiceShell.tsx",
);

const SOX_CLASS: ClassifiedBanner = {
  class: "sox",
  suggestedAction: "Audio device lost -- restart Achilles",
};

let originalLevel: number;

beforeEach(() => {
  originalLevel = chalk.level;
  chalk.level = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  chalk.level = originalLevel as 0 | 1 | 2 | 3;
});

describe("Banner.tsx (ERR-01) — Phase 19 Plan 02 Task 1", () => {
  it("T-BAN-01: renders nothing when classification === null", () => {
    const { lastFrame } = render(
      <Banner classification={null} errorNonce={0} successNonce={0} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toBe("");
  });

  it("T-BAN-02: renders '[error] <class> -- <suggestedAction>' text when classification is set + errorNonce bumps", () => {
    const props: BannerProps = {
      classification: SOX_CLASS,
      errorNonce: 1,
      successNonce: 0,
    };
    const { lastFrame } = render(<Banner {...props} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[error] sox -- Audio device lost -- restart Achilles");
  });

  it("T-BAN-03: source contains aria-role=\"timer\" + aria-label (A8 + D-11)", () => {
    const source = readFileSync(BANNER_SRC, "utf8");
    expect(source).toContain('aria-role="timer"');
    expect(source).toContain("aria-label");
  });

  it("T-BAN-04: auto-dismisses after BANNER_AUTO_DISMISS_MS (8_000ms)", async () => {
    const { lastFrame, rerender } = render(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    // Initial render shows the banner.
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance to just-before the 8s threshold; banner still visible.
    await vi.advanceTimersByTimeAsync(BANNER_AUTO_DISMISS_MS - 1);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance past the threshold; banner dismisses (renders null).
    await vi.advanceTimersByTimeAsync(2);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    expect(lastFrame() ?? "").not.toContain("[error] sox --");
  });

  it("T-BAN-05: dismisses early on successNonce bump", async () => {
    const { lastFrame, rerender } = render(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance partway, then bump successNonce.
    await vi.advanceTimersByTimeAsync(2_000);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={1} />,
    );
    // Allow React's commit to settle.
    await vi.advanceTimersByTimeAsync(0);
    expect(lastFrame() ?? "").not.toContain("[error] sox --");
  });

  it("T-BAN-06: errorNonce bump mid-display resets the 8s timer (Pitfall 7 guard)", async () => {
    const { lastFrame, rerender } = render(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance 4s; banner still visible.
    await vi.advanceTimersByTimeAsync(4_000);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={1} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Bump errorNonce -> timer resets.
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={2} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance another 6s (total 10s, but only 6s since the reset);
    // banner should STILL be visible because the timer reset at t=4s.
    await vi.advanceTimersByTimeAsync(6_000);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={2} successNonce={0} />,
    );
    expect(lastFrame() ?? "").toContain("[error] sox --");
    // Advance another 3s (total 13s since first render, 9s since reset);
    // banner dismisses.
    await vi.advanceTimersByTimeAsync(3_000);
    rerender(
      <Banner classification={SOX_CLASS} errorNonce={2} successNonce={0} />,
    );
    expect(lastFrame() ?? "").not.toContain("[error] sox --");
  });

  it("T-BAN-07: VoiceShell.tsx source places <Banner ... /> as the FIRST child of the root <Box flexDirection=\"column\"> (D-10 layout)", () => {
    const source = readFileSync(VOICE_SHELL_SRC, "utf8");
    // Banner import present.
    expect(source).toMatch(/import\s*\{\s*Banner\s*\}\s*from\s*["']\.\/Banner\.js["']/);
    // Banner element present.
    expect(source).toMatch(/<Banner\b/);
    // Banner appears between the root Box opening tag and the
    // {sr ? ... : ...} screen-reader ternary — i.e. it is the first
    // child of the root flex column.
    const rootBoxIdx = source.indexOf('<Box flexDirection="column">');
    const bannerIdx = source.indexOf("<Banner");
    const srTernaryIdx = source.indexOf("{sr ?");
    const statusRowIdx = source.indexOf("<StatusRow");
    expect(rootBoxIdx).toBeGreaterThan(0);
    expect(bannerIdx).toBeGreaterThan(rootBoxIdx);
    expect(bannerIdx).toBeLessThan(srTernaryIdx);
    expect(srTernaryIdx).toBeLessThan(statusRowIdx);
  });
});

/**
 * Integration sanity check: VoiceShell rendered with a stub session
 * produces a tree whose first text line is the Banner (when an error
 * is pending) sitting ABOVE the StatusRow line.
 */
describe("Banner + VoiceShell integration (D-10 pre-empt layout)", () => {
  it("renders the banner ABOVE the [idle] status row when the session emits an error event", async () => {
    chalk.level = 0;
    const session = createStubSession({ state: "idle", amplitude: 0 });
    const { lastFrame, rerender } = render(
      <VoiceShell session={session} debugVad={false} />,
    );
    // Initial: no banner, status row present.
    let frame = lastFrame() ?? "";
    expect(frame).toContain("[idle]");
    expect(frame).not.toContain("[error]");
    // Emit an error event.
    session.emitSessionEvent({
      type: "error",
      payload: {
        classification: "mic_unavailable",
        message: "Audio device lost -- restart Achilles",
      },
      timestamp: Date.now(),
    });
    // Allow React's commit to settle.
    await vi.advanceTimersByTimeAsync(0);
    // Re-render to capture the post-state-update frame.
    rerender(<VoiceShell session={session} debugVad={false} />);
    frame = lastFrame() ?? "";
    expect(frame).toContain("[error] sox -- Audio device lost -- restart Achilles");
    expect(frame).toContain("[idle]");
    // The banner sits above the status row.
    const bannerLineIdx = frame.indexOf("[error]");
    const statusLineIdx = frame.indexOf("[idle]");
    expect(bannerLineIdx).toBeLessThan(statusLineIdx);
  });
});

/**
 * Build a stub Session that exposes the Phase 16 properties
 * (currentState, currentAmplitude, currentRingBuffer) AND an
 * emitSessionEvent helper for the Banner integration test. Mirrors
 * the createStubSession helper in voice-shell.test.tsx.
 */
function createStubSession(initial: {
  state: AchillesState;
  amplitude: number;
}): Session & {
  toggleMute: ReturnType<typeof vi.fn>;
  emitSessionEvent: (ev: unknown) => void;
} {
  const emitter = new EventEmitter() as unknown as Session & {
    toggleMute: ReturnType<typeof vi.fn>;
    emitSessionEvent: (ev: unknown) => void;
  };
  const ring = new Float32Array(80);
  const writeIndex = 0;
  const ringSnapshot = { ring, writeIndex };
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
  emitter.emitSessionEvent = (ev: unknown) => {
    (emitter as EventEmitter).emit("event", ev);
  };
  // Silence unused vars warnings.
  void writeIndex;
  void ringSnapshot;
  return emitter;
}
