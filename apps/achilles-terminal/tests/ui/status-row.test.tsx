/**
 * TUI-04 substrate tests (Phase 16, Plan 03, Task 3).
 *
 * Verifies StatusRow renders:
 *   - Test 1: bracketed state name "[idle]" when state=idle + no transcript + no REC + no muted
 *   - Test 2: transcript is truncated to the last 60 characters
 *   - Test 3: "[REC]" appears when transcriptsActive=true
 *   - Test 4: "[MUTED]" appears when state="muted"
 *   - Test 5: both "[REC]" and "[MUTED]" appear when both conditions apply
 *
 * NO_COLOR is set via chalk.level=0 so substring assertions can be made
 * against plain text without ANSI escape interference.
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import chalk, { type ChalkInstance } from "chalk";
import { render } from "ink-testing-library";

import { StatusRow } from "../../src/ui/StatusRow.js";

type ChalkLevel = ChalkInstance["level"];

let originalLevel: ChalkLevel;

beforeEach(() => {
  // Disable chalk so we can assert substring content without ANSI interference.
  originalLevel = chalk.level;
  chalk.level = 0;
});

afterEach(() => {
  chalk.level = originalLevel;
});

describe("StatusRow (TUI-04)", () => {
  it("Test 1: idle state, no transcript, no REC, no MUTED", () => {
    const { lastFrame } = render(
      <StatusRow state="idle" transcript="" transcriptsActive={false} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[idle]");
    expect(frame).not.toContain("[REC]");
    expect(frame).not.toContain("[MUTED]");
  });

  it("Test 2: transcript truncated to last 60 characters", () => {
    const longTranscript = "a".repeat(140) + "b".repeat(60); // 200 chars
    const { lastFrame } = render(
      <StatusRow
        state="listening"
        transcript={longTranscript}
        transcriptsActive={false}
      />,
    );
    const frame = lastFrame() ?? "";
    // Last 60 chars = 60 "b"s
    expect(frame).toContain("b".repeat(60));
    // The first portion (140 "a"s) must not be present in full
    expect(frame).not.toContain("a".repeat(140));
    // A short prefix of "a"s must also not appear contiguously
    expect(frame).not.toContain("a".repeat(61));
  });

  it("Test 3: REC tag appears when transcriptsActive=true", () => {
    const { lastFrame } = render(
      <StatusRow state="idle" transcript="hi" transcriptsActive={true} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[REC]");
  });

  it("Test 4: MUTED tag appears when state='muted'", () => {
    const { lastFrame } = render(
      <StatusRow state="muted" transcript="" transcriptsActive={false} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[MUTED]");
  });

  it("Test 5: REC and MUTED both appear when state='muted' + transcriptsActive=true", () => {
    const { lastFrame } = render(
      <StatusRow state="muted" transcript="" transcriptsActive={true} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[REC]");
    expect(frame).toContain("[MUTED]");
  });
});
