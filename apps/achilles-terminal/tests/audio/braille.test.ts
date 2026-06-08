/**
 * TUI-02 substrate — canonical Unicode braille encoder tests (Phase 16, Plan 01, Task 3).
 *
 * Pure-function unit tests for the braille bit mapping that the
 * Plan 03 Sparkline.tsx component consumes. The encoder MUST use the
 * canonical Unicode dot map from RESEARCH.md §"Braille bit encoding
 * (CORRECTED from CONTEXT.md)" — NOT the loose CONTEXT.md upper/lower-halves
 * wording. The bit map is:
 *
 *   Left column (top -> bottom): dots 1, 2, 3, 7 -> bits 0x01, 0x02, 0x04, 0x40
 *   Right column (top -> bottom): dots 4, 5, 6, 8 -> bits 0x08, 0x10, 0x20, 0x80
 *
 * Intensity fills from BOTTOM UP: intensity=1 -> dot 7 (bottom) only;
 * intensity=4 -> all four dots in the column.
 */
import { describe, it, expect } from "vitest";
import {
  BRAILLE_BASE,
  brailleCell,
  sparklineFromRing,
} from "../../src/audio/braille.js";

describe("braille — canonical Unicode encoder (TUI-02 substrate)", () => {
  it("Test 1: BRAILLE_BASE === 0x2800 (Unicode braille block start)", () => {
    expect(BRAILLE_BASE).toBe(0x2800);
  });

  it("Test 2: zero cell — brailleCell(0, 0) === U+2800 (empty braille cell)", () => {
    expect(brailleCell(0, 0)).toBe(String.fromCharCode(0x2800));
    expect(brailleCell(0, 0).charCodeAt(0)).toBe(0x2800);
  });

  it("Test 3: left column full — brailleCell(4, 0) === U+2847 (dots 1, 2, 3, 7 set)", () => {
    // 0x2800 + 0x40 + 0x04 + 0x02 + 0x01 = 0x2847
    expect(brailleCell(4, 0).charCodeAt(0)).toBe(0x2847);
  });

  it("Test 4: right column full — brailleCell(0, 4) === U+28B8 (dots 4, 5, 6, 8 set)", () => {
    // 0x2800 + 0x80 + 0x20 + 0x10 + 0x08 = 0x28B8
    expect(brailleCell(0, 4).charCodeAt(0)).toBe(0x28b8);
  });

  it("Test 5: full cell — brailleCell(4, 4) === U+28FF (all 8 dots)", () => {
    expect(brailleCell(4, 4).charCodeAt(0)).toBe(0x28ff);
  });

  it("Test 6: clamping — out-of-range inputs are clamped to [0, 4]; non-integers round", () => {
    expect(brailleCell(-1, 5)).toBe(brailleCell(0, 4));
    expect(brailleCell(99, -99)).toBe(brailleCell(4, 0));
    // Math.round semantics: 2.3 -> 2; 2.7 -> 3.
    expect(brailleCell(2.3, 2.7)).toBe(brailleCell(2, 3));
  });

  it("Test 7: bottom-up fill — left column lights dot 7 first, then 3, 2, 1", () => {
    // intensity=1 -> only dot 7 -> 0x2800 + 0x40 = 0x2840
    expect(brailleCell(1, 0).charCodeAt(0)).toBe(0x2840);
    // intensity=2 -> dots 7 + 3 -> 0x2800 + 0x40 + 0x04 = 0x2844
    expect(brailleCell(2, 0).charCodeAt(0)).toBe(0x2844);
    // intensity=3 -> dots 7 + 3 + 2 -> 0x2800 + 0x40 + 0x04 + 0x02 = 0x2846
    expect(brailleCell(3, 0).charCodeAt(0)).toBe(0x2846);
    // Right-column parallel: intensity=1 -> only dot 8 -> 0x2800 + 0x80 = 0x2880
    expect(brailleCell(0, 1).charCodeAt(0)).toBe(0x2880);
    // intensity=2 -> dots 8 + 6 -> 0x2800 + 0x80 + 0x20 = 0x28A0
    expect(brailleCell(0, 2).charCodeAt(0)).toBe(0x28a0);
  });

  it("Test 8: sparklineFromRing zero ring — returns 40 U+2800 cells", () => {
    const ring = new Float32Array(80);
    const line = sparklineFromRing(ring, 0);
    expect(line.length).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(line.charCodeAt(i)).toBe(0x2800);
    }
  });

  it("Test 9: sparklineFromRing full ring — Float32Array(80).fill(1.0) -> 40 U+28FF cells", () => {
    const ring = new Float32Array(80);
    ring.fill(1.0);
    const line = sparklineFromRing(ring, 0);
    expect(line.length).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(line.charCodeAt(i)).toBe(0x28ff);
    }
  });

  it("Test 10: sparklineFromRing ordering — oldest-to-newest left-to-right", () => {
    // Per RESEARCH.md lines 608-620, render walks from (writeIndex + 1) mod 80
    // through writeIndex, pairing samples (2i, 2i+1) into 40 cells.
    // With writeIndex = 4, the oldest sample is at ring index 5 (the next
    // slot to write). Pairs are (5,6), (7,8), ..., so ring[5] is the LEFT
    // half of cell index 0.
    const ring = new Float32Array(80);
    ring[5] = 0.5; // intensity = 0.5 * 4 = 2; rounded -> 2 -> dots 7 + 3 lit (left column)
    const line = sparklineFromRing(ring, 4);
    expect(line.length).toBe(40);
    // Cell 0: left = ring[5] = 0.5 (intensity 2); right = ring[6] = 0
    // expected codepoint = brailleCell(2, 0) = 0x2844
    expect(line.charCodeAt(0)).toBe(0x2844);
    // Cell 1: left = ring[7] = 0; right = ring[8] = 0 -> empty
    expect(line.charCodeAt(1)).toBe(0x2800);
  });
});
