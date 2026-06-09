/**
 * Phase 19, Plan 02, Task 1 — ERR-01 inline error banner.
 *
 * Per CONTEXT.md `<decisions>` D-10 (banner pre-empts above status row)
 * + D-11 (screen-reader assertive priority via aria-role) + RESEARCH
 * Section Pattern 3 + Section Pitfall 7 (errorNonce-in-deps guard so the auto-dismiss
 * timer resets cleanly across cascading errors):
 *
 *   - Renders a SINGLE-LINE red text row "[error] <class> -- <suggestedAction>"
 *     as the FIRST child of the root <Box flexDirection="column"> in
 *     VoiceShell.tsx, ABOVE the screen-reader / sighted branch and
 *     the StatusRow.
 *   - Auto-dismisses after BANNER_AUTO_DISMISS_MS (8_000 ms). The
 *     timer resets on every errorNonce bump so a new error mid-display
 *     is given a full 8s window (Pitfall 7).
 *   - Dismisses early on successNonce bump (the parent useErrorBanner
 *     hook bumps successNonce on any non-error event from session).
 *   - Returns null when classification === null OR the visible flag is
 *     false (so the surrounding Box collapses with zero footprint when
 *     no error is pending).
 *
 * Ink 7 API NOTE (D-16-03-02 deviation, A8 carryover):
 *   Ink 7's `<Text>` only supports `aria-label` and `aria-hidden`.
 *   `aria-role` is supported only on `<Box>`, and the role enum does
 *   NOT include "status"; the closest live-region role available in
 *   Ink 7 is "timer" (semantic match: announces state changes over
 *   time). ScreenReader.tsx lines 14-24 documents the same precedent.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 *   achilles-skill. Only Ink + React + local types.
 *
 * No emojis (CLAUDE.md global).
 */

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";

import type { ClassifiedBanner } from "../error-classifier.js";

/**
 * Auto-dismiss timer, in milliseconds. Exported so the test file can
 * import the locked value rather than duplicating it.
 *
 * @public
 */
export const BANNER_AUTO_DISMISS_MS = 8_000;

/**
 * Props for the Banner component.
 *
 *   classification — the pre-mapped ClassifiedBanner payload to render,
 *                    or null when no error is pending. The Banner does
 *                    NOT classify; the useErrorBanner hook in
 *                    useAchillesState.ts owns that mapping.
 *   errorNonce     — bump each time a NEW error event fires. The
 *                    Banner shows itself on bump (when classification
 *                    is non-null) AND resets its auto-dismiss timer.
 *                    Pitfall 7 guard: include in useEffect deps.
 *   successNonce   — bump on any session event that should clear the
 *                    banner early (e.g. stt_committed, claude_ack).
 *
 * @public
 */
export interface BannerProps {
  readonly classification: ClassifiedBanner | null;
  readonly errorNonce: number;
  readonly successNonce: number;
}

/**
 * Banner component. Renders a single red line ABOVE the rest of the
 * VoiceShell tree when an error is pending; otherwise returns null.
 *
 * @public
 */
export function Banner({
  classification,
  errorNonce,
  successNonce,
}: BannerProps): JSX.Element | null {
  // Initial visibility: if the Banner mounts with a non-null
  // classification AND errorNonce > 0, the parent has already
  // observed an error event before the banner was attached — treat
  // this as a pending error and render visible from the first frame.
  // Otherwise start hidden and wait for a bump.
  const [visible, setVisible] = useState<boolean>(
    classification !== null && errorNonce > 0,
  );
  // Mirror lastErrNonce one BEHIND errorNonce when we are starting
  // visible (so the next bump fires the show-effect again). When we
  // start hidden, mirror equals errorNonce (no diff -> no fire on
  // first render; the first real bump fires the effect).
  const [lastErrNonce, setLastErrNonce] = useState<number>(() =>
    classification !== null && errorNonce > 0 ? errorNonce : errorNonce,
  );
  const [lastSuccessNonce, setLastSuccessNonce] =
    useState<number>(successNonce);

  // Show banner when errorNonce bumps (and a classification is
  // available). The classification-null guard prevents a spurious
  // visible-true if the parent hook bumps the nonce before setting the
  // classification.
  useEffect(() => {
    if (errorNonce !== lastErrNonce && classification !== null) {
      setVisible(true);
      setLastErrNonce(errorNonce);
    }
  }, [errorNonce, lastErrNonce, classification]);

  // Auto-dismiss after BANNER_AUTO_DISMISS_MS. Pitfall 7 guard:
  // errorNonce is in the deps so a new error mid-display resets the
  // timer cleanly (the cleanup tears down the old timer; the next
  // effect run starts a fresh one).
  useEffect(() => {
    if (!visible) return;
    const handle = setTimeout(() => {
      setVisible(false);
    }, BANNER_AUTO_DISMISS_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [visible, errorNonce]);

  // Dismiss on next successful event (successNonce bump). The
  // lastSuccessNonce mirror prevents the dismiss from firing in
  // response to its own state update on the next render.
  useEffect(() => {
    if (successNonce !== lastSuccessNonce) {
      setVisible(false);
      setLastSuccessNonce(successNonce);
    }
  }, [successNonce, lastSuccessNonce]);

  if (!visible || classification === null) return null;

  const ariaLabel = `error ${classification.class} ${classification.suggestedAction}`;
  const line = `[error] ${classification.class} -- ${classification.suggestedAction}`;
  return (
    <Box aria-label={ariaLabel} aria-role="timer">
      <Text color="red">{line}</Text>
    </Box>
  );
}
