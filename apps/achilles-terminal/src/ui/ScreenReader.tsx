/**
 * ACC-02 substrate — screen-reader-only state announcer
 * (Phase 16, Plan 03, Task 3).
 *
 * Per CONTEXT.md `<decisions>` Accessibility row + RESEARCH A2 correction:
 *
 *   - Renders the locked SCREEN_READER_WORDING text for the current state
  *   - Uses the (aria-label + aria-role) shape instead of the polite-live-
 *     region attribute (which Ink 7 does not support — see RESEARCH A2)
 *   - Debounces state changes by 200ms per CONTEXT.md `<specifics>` row 3 so
 *     a noisy transition flurry (idle -> listening -> idle within 100ms)
 *     announces only the most recent stable state
 *
 * Ink 7 API NOTE (D-16-03-02 deviation):
 *   Ink 7's `<Text>` only supports `aria-label` and `aria-hidden`. `aria-role`
 *   is supported only on `<Box>`, and the role enum does NOT include "status";
 *   the closest live-region role available in Ink 7 is "timer" (semantic
 *   match: announces state changes over time). The PLAN.md asked for a
 *   single `<Text aria-label aria-role>` element, but Ink 7 requires wrapping
 *   the announcement in a `<Box aria-label aria-role="timer">` with a child
 *   `<Text>` rendering the actual string. Both literal strings appear in this
 *   file's source (satisfying the plan's acceptance criteria) and the
 *   semantic intent — a screen reader announces the state-change text on
 *   each tick — is preserved.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge.
 *
 * No emojis (CLAUDE.md global).
 */

import { useEffect, useState, type JSX } from "react";
import { Box, Text } from "ink";
import { SCREEN_READER_WORDING } from "./colors.js";
import type { AchillesState } from "../state/constants.js";

const ANNOUNCEMENT_DEBOUNCE_MS = 200;

export interface ScreenReaderProps {
  state: AchillesState;
}

export function ScreenReader({ state }: ScreenReaderProps): JSX.Element {
  const [displayedState, setDisplayedState] = useState<AchillesState>(state);
  useEffect(() => {
    if (state === displayedState) {
      // No transition — nothing to schedule.
      return;
    }
    const handle = setTimeout(() => {
      setDisplayedState(state);
    }, ANNOUNCEMENT_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [state, displayedState]);
  const text = SCREEN_READER_WORDING[displayedState];
  return (
    <Box aria-label={text} aria-role="timer">
      <Text>{text}</Text>
    </Box>
  );
}
