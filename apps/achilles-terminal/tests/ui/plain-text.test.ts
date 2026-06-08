/**
 * TUI-06 substrate tests (Phase 16, Plan 03, Task 3).
 *
 * Verifies plain-text.ts emits ANSI-free `[ISO][state] transcript` log lines
 * per CONTEXT.md TUI-06 row + 16-VALIDATION.md per-task verification.
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect } from "vitest";
import { formatPlainLine } from "../../src/ui/plain-text.js";

describe("plain-text.ts formatPlainLine (TUI-06)", () => {
  it("Test 8: format string matches [ISO][state] transcript", () => {
    const out = formatPlainLine({
      timestamp: new Date("2026-06-08T12:00:00Z"),
      state: "listening",
      transcript: "hello",
    });
    expect(out).toBe("[2026-06-08T12:00:00.000Z] [listening] hello");
  });

  it("Test 9: output contains no ANSI escape codes", () => {
    const out = formatPlainLine({
      timestamp: new Date("2026-06-08T12:00:00Z"),
      state: "error",
      transcript: "something bad",
    });
    // No ANSI escape (ESC = ) anywhere
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("Test 9b: handles empty transcript", () => {
    const out = formatPlainLine({
      timestamp: new Date("2026-06-08T00:00:00Z"),
      state: "idle",
      transcript: "",
    });
    expect(out).toBe("[2026-06-08T00:00:00.000Z] [idle] ");
  });

  it("Test 9c: handles multi-line transcript (newlines preserved as-is)", () => {
    const out = formatPlainLine({
      timestamp: new Date("2026-06-08T12:00:00Z"),
      state: "processing",
      transcript: "line 1\nline 2",
    });
    expect(out).toBe("[2026-06-08T12:00:00.000Z] [processing] line 1\nline 2");
  });
});
