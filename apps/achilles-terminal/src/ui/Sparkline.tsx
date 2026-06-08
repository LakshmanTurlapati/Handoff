/**
 * TUI-02 — 40-cell braille sparkline component (Phase 16, Plan 03, Task 2).
 *
 * Consumes a Float32Array(80) ring buffer + writeIndex cursor from Plan 04's
 * session.ts. Delegates the per-cell braille encoding to Plan 01's pure
 * helper `sparklineFromRing` (`apps/achilles-terminal/src/audio/braille.ts`)
 * so the rendering tier stays projection-only — orchestrator owns ring
 * buffer state, UI owns the projection to braille glyphs.
 *
 * Screen-reader suppression: when isScreenReader=true, returns null so the
 * Ink reconciler removes the subtree (ACC-02 + CONTEXT.md `<decisions>`
 * Accessibility row).
 *
 * NOTE on braille codepoints vs emojis: U+2800-U+28FF is the Unicode Braille
 * Patterns block, NOT a pictograph emoji range. The CLAUDE.md "no emojis"
 * rule targets pictograph ranges U+1F300-U+1FAFF and U+2600-U+27BF; braille
 * patterns are physically and semantically distinct.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 * achilles-skill.
 */

import type { JSX } from "react";
import { Text } from "ink";
import { sparklineFromRing } from "../audio/braille.js";

export interface SparklineProps {
  ring: Float32Array;
  writeIndex: number;
  isScreenReader?: boolean;
}

export function Sparkline({
  ring,
  writeIndex,
  isScreenReader = false,
}: SparklineProps): JSX.Element | null {
  if (isScreenReader) {
    return null;
  }
  return <Text>{sparklineFromRing(ring, writeIndex)}</Text>;
}
