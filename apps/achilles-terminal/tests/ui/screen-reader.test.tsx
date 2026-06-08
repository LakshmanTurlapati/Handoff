/**
 * ACC-02 substrate tests (Phase 16, Plan 03, Task 3).
 *
 * Verifies ScreenReader.tsx:
 *   - Test 6: renders the locked SCREEN_READER_WORDING text for each state
 *   - Test 6b: source file contains aria-label AND aria-role (RESEARCH A2 corrected shape)
 *   - Test 6c: source file does NOT contain aria-live (RESEARCH A2 — Ink 7 unsupported)
 *   - Test 7: 200ms debounce on state transitions per CONTEXT.md <specifics> row 3
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render } from "ink-testing-library";

import { ScreenReader } from "../../src/ui/ScreenReader.js";
import { SCREEN_READER_WORDING } from "../../src/ui/colors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREEN_READER_SRC = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "ui",
  "ScreenReader.tsx",
);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScreenReader.tsx (ACC-02)", () => {
  it("Test 6: renders the locked SCREEN_READER_WORDING text for state=listening", () => {
    const { lastFrame } = render(<ScreenReader state="listening" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(SCREEN_READER_WORDING.listening);
  });

  it("Test 6b: source contains literal 'aria-label' AND 'aria-role' (A2 corrected shape)", () => {
    const source = readFileSync(SCREEN_READER_SRC, "utf8");
    expect(source).toContain("aria-label");
    expect(source).toContain("aria-role");
  });

  it("Test 6c: source does NOT contain 'aria-live' (A2 — Ink 7 unsupported)", () => {
    const source = readFileSync(SCREEN_READER_SRC, "utf8");
    expect(source).not.toContain("aria-live");
  });

  it("Test 7: state transition triggers re-render with 200ms debounce", async () => {
    const { lastFrame, rerender } = render(<ScreenReader state="idle" />);
    expect(lastFrame() ?? "").toContain(SCREEN_READER_WORDING.idle);
    // Switch to processing state
    rerender(<ScreenReader state="processing" />);
    // Before the 200ms debounce elapses, the displayed text should NOT have changed
    await vi.advanceTimersByTimeAsync(199);
    expect(lastFrame() ?? "").toContain(SCREEN_READER_WORDING.idle);
    // After 1 more ms (total 200), the timer fires and React schedules a
    // re-render. Allow Ink's reconciler a tick to flush by yielding control
    // through a microtask + advancing fake timers a hair to drain queued
    // work that the React scheduler may park on a setTimeout(0).
    await vi.advanceTimersByTimeAsync(1);
    // Drain any pending microtasks + Ink's scheduler queue.
    await vi.advanceTimersByTimeAsync(0);
    expect(lastFrame() ?? "").toContain(SCREEN_READER_WORDING.processing);
  });
});
