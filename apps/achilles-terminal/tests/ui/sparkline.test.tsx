/**
 * TUI-02 substrate tests (Phase 16, Plan 03, Task 2).
 *
 * Verifies the 40-cell braille sparkline component reads from a Float32Array(80)
 * ring buffer + writeIndex, delegates to Plan 01's sparklineFromRing, and
 * suppresses entirely in screen-reader mode (ACC-02).
 *
 * No emojis (CLAUDE.md global). Braille codepoints U+2800-U+28FF are Unicode
 * block characters, not pictograph emojis.
 */

import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";

import { Sparkline } from "../../src/ui/Sparkline.js";
import { sparklineFromRing } from "../../src/audio/braille.js";

describe("Sparkline.tsx (TUI-02)", () => {
  it("Test 10: render(<Sparkline ring writeIndex=0 />) lastFrame contains 40 braille cells matching sparklineFromRing", () => {
    const ring = new Float32Array(80);
    for (let i = 0; i < 80; i++) ring[i] = 0.5;
    const expected = sparklineFromRing(ring, 0);
    const { lastFrame } = render(<Sparkline ring={ring} writeIndex={0} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(expected);
    // Strip ANSI / whitespace and confirm at least 40 braille characters
    const brailleCount = (frame.match(/[⠀-⣿]/g) ?? []).length;
    expect(brailleCount).toBeGreaterThanOrEqual(40);
    // Each braille codepoint is in the expected range
    for (const ch of expected) {
      const code = ch.charCodeAt(0);
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28ff);
    }
    expect(expected).toHaveLength(40);
  });

  it("Test 11: render(<Sparkline ring writeIndex=0 isScreenReader />) suppresses all braille", () => {
    const ring = new Float32Array(80);
    for (let i = 0; i < 80; i++) ring[i] = 0.5;
    const { lastFrame } = render(
      <Sparkline ring={ring} writeIndex={0} isScreenReader />,
    );
    const frame = lastFrame() ?? "";
    // No braille codepoints in the rendered output
    expect(frame).not.toMatch(/[⠀-⣿]/);
  });
});
