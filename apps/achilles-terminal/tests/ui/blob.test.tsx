/**
 * TUI-01 + TUI-03 + ACC-01 + ACC-02 substrate tests (Phase 16, Plan 03, Task 2).
 *
 * Covers:
 *   - STATE_COLORS palette (6 keys) — Test 1
 *   - SCREEN_READER_WORDING table (6 keys) — Test 2
 *   - isScreenReaderActive() strict "true" check (RESEARCH A1) — Test 3
 *   - NO_COLOR + FORCE_COLOR honored via chalk — Test 4
 *   - idleBreathingAmplitude + processingPulseAmplitude envelope helpers — Test 5
 *   - blobFrame center-weighted ring kernel — Test 6
 *   - blobFrame at amplitude 0 (all spaces) — Test 7
 *   - Ink renders the 7 rows with the correct strings — Test 8
 *   - Blob suppression in screen-reader mode — Test 9
 *
 * No emojis (CLAUDE.md global). The Unicode block characters U+2580-U+259F
 * and braille codepoints U+2800-U+28FF are Unicode block characters, not
 * pictograph emojis; the regex grep ranges in the plan's acceptance criteria
 * confirm they are not in the emoji ranges.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "ink-testing-library";

import {
  STATE_COLORS,
  SCREEN_READER_WORDING,
  isScreenReaderActive,
  idleBreathingAmplitude,
  processingPulseAmplitude,
} from "../../src/ui/colors.js";
import { Blob, blobFrame, rampChar, RAMP } from "../../src/ui/Blob.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("STATE_COLORS palette", () => {
  it("Test 1: deep-equals the 6-entry locked palette", () => {
    expect(STATE_COLORS).toEqual({
      idle: "gray",
      listening: "green",
      processing: "yellow",
      speaking: "blue",
      error: "red",
      muted: "redBright",
    });
    expect(Object.keys(STATE_COLORS)).toHaveLength(6);
  });
});

describe("SCREEN_READER_WORDING table", () => {
  it("Test 2: deep-equals the 6-entry locked wording table", () => {
    expect(SCREEN_READER_WORDING).toEqual({
      idle: "Achilles ready.",
      listening: "Achilles listening.",
      processing: "Achilles processing your request.",
      speaking: "Achilles speaking.",
      error: "Achilles encountered an error.",
      muted: "Achilles muted.",
    });
    expect(Object.keys(SCREEN_READER_WORDING)).toHaveLength(6);
  });
});

describe("isScreenReaderActive - A1 strict 'true' check", () => {
  it("Test 3a: returns true ONLY for INK_SCREEN_READER === 'true' (the literal string)", () => {
    vi.stubEnv("INK_SCREEN_READER", "true");
    expect(isScreenReaderActive()).toBe(true);
  });

  it("Test 3b: returns false for '1' (the A1 corrected value)", () => {
    vi.stubEnv("INK_SCREEN_READER", "1");
    expect(isScreenReaderActive()).toBe(false);
  });

  it("Test 3c: returns false for 'TRUE' (case-sensitive)", () => {
    vi.stubEnv("INK_SCREEN_READER", "TRUE");
    expect(isScreenReaderActive()).toBe(false);
  });

  it("Test 3d: returns false for 'false'", () => {
    vi.stubEnv("INK_SCREEN_READER", "false");
    expect(isScreenReaderActive()).toBe(false);
  });

  it("Test 3e: returns false for empty string", () => {
    vi.stubEnv("INK_SCREEN_READER", "");
    expect(isScreenReaderActive()).toBe(false);
  });
});

describe("colorize honors NO_COLOR / FORCE_COLOR (ACC-01)", () => {
  it("Test 4a: chalk.level=0 produces plain text (NO_COLOR contract)", async () => {
    // chalk natively respects NO_COLOR by setting chalk.level=0 at import time.
    // The runtime check here verifies the colorize() function passes through
    // chalk's level-driven decision: when level=0, output is plain text with
    // no ANSI escape codes. This is the ACC-01 invariant guaranteed by chalk.
    const chalkModule = await import("chalk");
    const originalLevel = chalkModule.default.level;
    chalkModule.default.level = 0;
    const { colorize } = await import("../../src/ui/colors.js");
    const out = colorize("error", "x");
    chalkModule.default.level = originalLevel;
    expect(out).toBe("x");
    // No ANSI escape (ESC = ) anywhere
    expect(out).not.toMatch(/\[/);
  });

  it("Test 4b: chalk.level=3 emits ANSI escape codes (FORCE_COLOR contract)", async () => {
    // chalk respects FORCE_COLOR by setting chalk.level=1..3 at import time.
    // The runtime check here verifies that when colors are enabled, the
    // colorize() function emits ANSI escape codes through chalk. This is the
    // ACC-01 invariant for users who explicitly request colors via FORCE_COLOR.
    const chalkModule = await import("chalk");
    const originalLevel = chalkModule.default.level;
    chalkModule.default.level = 3;
    const { colorize } = await import("../../src/ui/colors.js");
    const out = colorize("error", "x");
    chalkModule.default.level = originalLevel;
    // ANSI escape (ESC =  followed by [) must be present
    expect(out).toMatch(/\[/);
  });

  it("Test 4c: isScreenReaderActive uses strict 'true' check per A1", () => {
    // A1 invariant: setting INK_SCREEN_READER=1 must NOT activate SR mode.
    // Source file contains literal  (not ).
    // (full validation in Test 3a-e above; this is a defence-in-depth read.)
    vi.stubEnv("INK_SCREEN_READER", "1");
    expect(isScreenReaderActive()).toBe(false);
  });
});

describe("envelope helpers (TUI-03)", () => {
  it("Test 5a: idleBreathingAmplitude(0) === 0.3 (sin(0) === 0)", () => {
    expect(idleBreathingAmplitude(0)).toBeCloseTo(0.3, 10);
  });

  it("Test 5b: idleBreathingAmplitude(600 * PI) within 0.001 of 0.3", () => {
    // sin(PI) = 0
    expect(idleBreathingAmplitude(600 * Math.PI)).toBeCloseTo(0.3, 3);
  });

  it("Test 5c: processingPulseAmplitude(0) === 0.5", () => {
    expect(processingPulseAmplitude(0)).toBeCloseTo(0.5, 10);
  });

  it("Test 5d: processingPulseAmplitude(200 * PI) within 0.001 of 0.5", () => {
    expect(processingPulseAmplitude(200 * Math.PI)).toBeCloseTo(0.5, 3);
  });
});

describe("Blob.tsx blobFrame center-weighted kernel (TUI-01)", () => {
  it("Test 6a: blobFrame(1.0) returns 7 strings of length 7", () => {
    const frame = blobFrame(1.0);
    expect(frame).toHaveLength(7);
    for (const row of frame) {
      expect(row).toHaveLength(7);
    }
  });

  it("Test 6b: center cell (3,3) is full block at amplitude=1.0", () => {
    const frame = blobFrame(1.0);
    expect(frame[3]![3]).toBe("█");
  });

  it("Test 6c: ring-1 cells (distance 1) are dark shade (0.75 intensity rounds to 3)", () => {
    const frame = blobFrame(1.0);
    // ring 1 cells: (3,2), (3,4), (2,3), (4,3) - direct neighbors of center
    expect(frame[3]![2]).toBe("▓");
    expect(frame[3]![4]).toBe("▓");
    expect(frame[2]![3]).toBe("▓");
    expect(frame[4]![3]).toBe("▓");
  });

  it("Test 6d: corner cells (distance sqrt(18)~4.24 -> floor 4 -> ring 3 -> 0.25) are light shade", () => {
    const frame = blobFrame(1.0);
    expect(frame[0]![0]).toBe("░");
    expect(frame[0]![6]).toBe("░");
    expect(frame[6]![0]).toBe("░");
    expect(frame[6]![6]).toBe("░");
  });

  it("Test 7: blobFrame(0) returns 7 rows of 7 space characters", () => {
    const frame = blobFrame(0);
    expect(frame).toHaveLength(7);
    for (const row of frame) {
      expect(row).toBe(" ".repeat(7));
    }
  });

  it("Test 7b: rampChar maps intensity correctly", () => {
    expect(rampChar(0)).toBe(" ");
    expect(rampChar(0.25)).toBe("░");
    expect(rampChar(0.5)).toBe("▒");
    expect(rampChar(0.75)).toBe("▓");
    expect(rampChar(1.0)).toBe("█");
    // Out-of-range clamps
    expect(rampChar(-1)).toBe(" ");
    expect(rampChar(2)).toBe("█");
  });

  it("Test 7c: RAMP exports the 5-step shade array verbatim", () => {
    expect(RAMP).toEqual([" ", "░", "▒", "▓", "█"]);
  });
});

describe("Blob.tsx Ink rendering (TUI-01)", () => {
  it("Test 8: render(<Blob amplitude=0.5 />) lastFrame() contains the 7 blob rows", () => {
    const { lastFrame } = render(<Blob amplitude={0.5} />);
    const frame = lastFrame() ?? "";
    const expected = blobFrame(0.5);
    for (const row of expected) {
      expect(frame).toContain(row);
    }
  });

  it("Test 9: render(<Blob amplitude=0.5 isScreenReader />) suppresses all block chars", () => {
    const { lastFrame } = render(<Blob amplitude={0.5} isScreenReader />);
    const frame = lastFrame() ?? "";
    // None of the four shaded block chars must appear
    expect(frame).not.toMatch(/[█▓▒░]/);
  });
});
