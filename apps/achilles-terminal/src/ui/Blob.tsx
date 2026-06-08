/**
 * TUI-01 — 7x7 reactive blob component (Phase 16, Plan 03, Task 2).
 *
 * Renders a 7-row by 7-column grid of Unicode block-shade characters from a
 * single `amplitude` scalar in [0, 1]. The intensity ramp is the 5-step
 * sequence space / light-shade / medium-shade / dark-shade / full-block per
 * 16-RESEARCH.md §"Unicode block ramp for the blob" lines 624-672:
 *
 *   Codepoint  Glyph   Name              Intensity
 *   U+0020     " "     space             0.0
 *   U+2591     "░"     light shade       0.25
 *   U+2592     "▒"     medium shade      0.5
 *   U+2593     "▓"     dark shade        0.75
 *   U+2588     "█"     full block        1.0
 *
 * Pixel intensity uses a center-weighted ring kernel per CONTEXT.md
 * `<specifics>` row 1 + 16-RESEARCH.md kernel:
 *
 *   center cell (3, 3)      intensity = amplitude * 1.0
 *   ring 1 (distance 1)     intensity = amplitude * 0.75
 *   ring 2 (distance 2)     intensity = amplitude * 0.5
 *   ring 3 (distance >= 3)  intensity = amplitude * 0.25
 *
 * blobFrame() is a pure function — pre-computing the 7-line string outside
 * the React tree per Pitfall 1 (Ink reconciliation thrash). The Blob
 * component just renders 7 <Text> rows wrapped in a vertical <Box>.
 *
 * Screen-reader suppression: when isScreenReader=true, Blob returns null so
 * the Ink reconciler removes the entire subtree (CONTEXT.md `<decisions>`
 * Accessibility row "don't render them at all — not just hide").
 *
 * NOTE on Unicode block chars vs emojis: U+2580-U+259F is the Unicode Block
 * Elements range, NOT a pictograph emoji range. The CLAUDE.md "no emojis"
 * rule targets pictograph ranges U+1F300-U+1FAFF and U+2600-U+27BF; the
 * block characters used here are physically and semantically distinct.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge.
 */

import type { JSX } from "react";
import { Box, Text } from "ink";

/**
 * 5-step intensity ramp. The codepoints are the verbatim characters from
 * RESEARCH.md — space, light shade, medium shade, dark shade, full block.
 */
export const RAMP = [" ", "░", "▒", "▓", "█"] as const;

/**
 * Map a [0, 1] intensity to one of the 5 ramp characters. Out-of-range
 * inputs are clamped via Math.min/Math.max so any finite number produces a
 * defined output. The intermediate `idx = round(intensity * 4)` is the
 * canonical bucketing — quartiles around 0.125 / 0.375 / 0.625 / 0.875.
 */
export function rampChar(intensity: number): string {
  const idx = Math.min(4, Math.max(0, Math.round(intensity * 4)));
  return RAMP[idx]!;
}

/**
 * Build a 7-row blob frame from a single amplitude scalar. Pure function —
 * deterministic per input, no side effects. Pre-computed outside the React
 * tree on each tick per the Pitfall 1 perf guidance.
 *
 * Kernel:
 *   ring = min(3, floor(distance from center))
 *   ringScale = ring === 0 ? 1.0 : ring === 1 ? 0.75 : ring === 2 ? 0.5 : 0.25
 *   cell intensity = amplitude * ringScale
 */
export function blobFrame(amplitude: number): readonly string[] {
  const cx = 3;
  const cy = 3;
  const rows: string[] = [];
  for (let y = 0; y < 7; y++) {
    let row = "";
    for (let x = 0; x < 7; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const ring = Math.min(3, Math.floor(dist));
      const ringScale =
        ring === 0 ? 1.0 : ring === 1 ? 0.75 : ring === 2 ? 0.5 : 0.25;
      row += rampChar(amplitude * ringScale);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Blob component props.
 *
 * `amplitude` is a scalar in [0, 1] driven by the orchestrator's tick loop
 * (idle breathing curve, processing pulse curve, live mic RMS, or 0 in
 * speaking state until Phase 17 wires real TTS amplitude).
 *
 * `isScreenReader` is the resolved boolean from `isScreenReaderActive()` in
 * colors.ts. When true, the component renders null and the subtree disappears.
 */
export interface BlobProps {
  amplitude: number;
  isScreenReader?: boolean;
}

export function Blob({
  amplitude,
  isScreenReader = false,
}: BlobProps): JSX.Element | null {
  if (isScreenReader) {
    return null;
  }
  const rows = blobFrame(amplitude);
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Text key={i}>{row}</Text>
      ))}
    </Box>
  );
}
