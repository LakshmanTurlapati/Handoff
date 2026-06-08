/**
 * TUI-02 substrate — canonical Unicode braille encoder (Phase 16, Plan 01, Task 3).
 *
 * Pure-function helpers consumed by Plan 03's Sparkline.tsx to render the
 * 40-cell rolling RMS waveform across an 80-sample Float32Array ring buffer.
 *
 * Canonical dot map (RESEARCH.md §"Braille bit encoding (CORRECTED from
 * CONTEXT.md)" lines 546-619 — cites en.wikipedia.org/wiki/Braille_Patterns):
 *
 *   Visual position    Dot    Bit added to U+2800
 *   ---------------    ---    -------------------
 *   top-left            1     0x01
 *   middle-left         2     0x02
 *   bottom-left         3     0x04
 *   top-right           4     0x08
 *   middle-right        5     0x10
 *   bottom-right        6     0x20
 *   very-bottom-left    7     0x40
 *   very-bottom-right   8     0x80
 *
 * So a four-pixel vertical column on the LEFT side maps to dots 1, 2, 3, 7
 * (bits 0x01, 0x02, 0x04, 0x40 — note the 7 at the BOTTOM, not the loose
 * CONTEXT.md "upper half / lower half" wording).
 *
 * Intensity fills BOTTOM UP. intensity=1 lights only the very-bottom dot
 * (7 for left, 8 for right); intensity=4 lights all four dots in that
 * column. brailleCell(left, right) accepts arbitrary numeric inputs and
 * clamps to [0, 4] via Math.min/Math.max/Math.round.
 *
 * NOTE on emoji policy: U+2800-U+28FF braille code points are Unicode
 * block characters, NOT pictograph emojis. The global CLAUDE.md "no emojis"
 * rule targets the pictograph ranges U+1F300-U+1FAFF / U+2600-U+27BF which
 * are physically distinct from braille. The acceptance criteria grep
 * confirms no pictographs are present in this file.
 */

/** Start of the Unicode braille patterns block (U+2800). */
export const BRAILLE_BASE = 0x2800;

/** Bit added to BRAILLE_BASE for each left-column dot (bottom-up fill order). */
const LEFT_DOT_BITS: readonly number[] = [0x40, 0x04, 0x02, 0x01];
/** Bit added to BRAILLE_BASE for each right-column dot (bottom-up fill order). */
const RIGHT_DOT_BITS: readonly number[] = [0x80, 0x20, 0x10, 0x08];

/**
 * Encode a single braille cell from two intensities in [0, 4].
 *
 * Inputs are clamped via Math.min(4, Math.max(0, Math.round(value))) so any
 * finite number produces a defined output. NaN rounds to NaN -> clamps to 0
 * via the Math.max guard (because Math.max(0, NaN) is NaN, but the final
 * Math.min(4, NaN) is also NaN — so for resilience we explicitly handle the
 * non-finite case below).
 */
export function brailleCell(left: number, right: number): string {
  const l = Math.min(4, Math.max(0, Math.round(left)));
  const r = Math.min(4, Math.max(0, Math.round(right)));
  // Defend against NaN slipping through (Math.min/max do not coerce NaN to 0).
  const lSafe = Number.isFinite(l) ? l : 0;
  const rSafe = Number.isFinite(r) ? r : 0;
  let code = 0;
  // Fill from the bottom up — dot 7 (left) and dot 8 (right) light first.
  for (let i = 0; i < lSafe; i++) {
    code |= LEFT_DOT_BITS[i]!;
  }
  for (let i = 0; i < rSafe; i++) {
    code |= RIGHT_DOT_BITS[i]!;
  }
  return String.fromCharCode(BRAILLE_BASE + code);
}

/**
 * Build a 40-cell braille sparkline from a Float32Array(80) ring buffer.
 *
 * The render walks from (writeIndex + 1) mod 80 (the OLDEST sample —
 * because writeIndex points at the NEXT slot to be written) through
 * writeIndex mod 80 in oldest-to-newest, left-to-right order. Sample pairs
 * (2i, 2i+1) within that walk become the left and right halves of cell i.
 *
 * Each sample is multiplied by 4 to map the [0, 1] amplitude range to the
 * [0, 4] intensity range expected by {@link brailleCell}; the clamp+round
 * inside brailleCell handles out-of-range or non-integer values cleanly.
 */
export function sparklineFromRing(
  ring: Float32Array,
  writeIndex: number,
): string {
  const cells: string[] = [];
  for (let i = 0; i < 40; i++) {
    const leftIdx = (writeIndex + 1 + 2 * i) % 80;
    const rightIdx = (writeIndex + 1 + 2 * i + 1) % 80;
    const l = (ring[leftIdx] ?? 0) * 4;
    const r = (ring[rightIdx] ?? 0) * 4;
    cells.push(brailleCell(l, r));
  }
  return cells.join("");
}
