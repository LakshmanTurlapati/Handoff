/**
 * Ink root component (Phase 16, Plan 04, Task 2 + Phase 19 Plan 02 Task 1).
 *
 * Composes Banner (Phase 19) + Blob + Sparkline + StatusRow + ScreenReader
 * (from Plan 03) into a single Ink tree, driven by:
 *
 *   - useAchillesState(session)  -> AchillesState
 *   - useAmplitude(session)      -> live mic / mock RMS
 *   - useRingBuffer(session)     -> { ring, writeIndex } for Sparkline
 *   - setInterval(50ms) tick     -> drives idle breathing + processing pulse
 *   - useInput('m')              -> dispatches session.toggleMute() with the
 *                                   RESEARCH A3 callback signature (no Ctrl-C
 *                                   swallowing, no Meta-M false-fire)
 *
 * CRITICAL — RESEARCH Assumption A3 + Pitfall 6:
 *   - This component does NOT override Ink's default Ctrl-C handler — the
 *     render() call in session.ts omits the disable option so Ink's default
 *     true is preserved. Phase 17 will wrap Ink's default handler in the
 *     gracefulShutdown chain.
 *   - useInput's callback explicitly guards `!key.ctrl && !key.meta` so a
 *     Ctrl-M (carriage-return literal) or Cmd-M does NOT toggle mute.
 *   - The check `input === "m"` is case-sensitive per CONTEXT.md `<decisions>`
 *     Mute control row "Key: m (lowercase)" — uppercase M does NOT toggle.
 *
 * Screen-reader branching (CONTEXT.md `<decisions>` Accessibility row):
 *   - When isScreenReaderActive() === true, suppress Blob and Sparkline
 *     entirely (don't just hide — drop the subtree). Mount ScreenReader.
 *   - StatusRow stays mounted in both modes for sighted co-watchers (CONTEXT
 *     does not explicitly suppress it).
 *
 * Tick loop (CONTEXT.md `<decisions>` Visual surface row):
 *   - 20fps via setInterval(50ms). Each tick bumps a tickMs counter that
 *     drives idleBreathingAmplitude(tickMs) and processingPulseAmplitude(tickMs)
 *     when the state warrants a synthetic envelope (idle, muted, processing).
 *   - In listening state, the live mic RMS (useAmplitude) drives the blob;
 *     in speaking state, the amplitude is 0 (Phase 17 will wire real TTS
 *     amplitude from the synthesizer events stream).
 *
 * Phase 17 hook — `debugVad` prop is currently a void (the debug-vad emission
 * lives in session.ts's handleFrame methods). Kept on the component signature
 * so Phase 17 can wire UI-side debug display if needed without a refactor.
 *
 * Phase 19 Plan 02 Task 1 (D-10 / D-11 / ERR-01):
 *   - The Banner component renders ABOVE the screen-reader/sighted branch
 *     as the FIRST child of the root <Box flexDirection="column">. This
 *     ensures error rows pre-empt the visual surface during cascading
 *     failures while StatusRow continues to render below.
 *   - useErrorBanner(session) maps session error events through the
 *     error-classifier and bumps errorNonce / successNonce so Banner's
 *     internal timer logic is purely state-driven.
 *
 * LOOP-02 invariant: zero imports from the four voice runtime packages,
 * the claude bridge package, or the achilles skill package. Only Ink +
 * React + local components.
 *
 * No emojis (CLAUDE.md global).
 */
import type { JSX } from "react";
import { Box, useInput } from "ink";
import { useEffect, useState } from "react";

import { Blob } from "./Blob.js";
import { Sparkline } from "./Sparkline.js";
import { StatusRow } from "./StatusRow.js";
import { ScreenReader } from "./ScreenReader.js";
import { Banner } from "./Banner.js";
import {
  isScreenReaderActive,
  idleBreathingAmplitude,
  processingPulseAmplitude,
} from "./colors.js";
import {
  useAchillesState,
  useAmplitude,
  useErrorBanner,
  useRingBuffer,
} from "./useAchillesState.js";
import type { Session } from "../session.js";

export interface VoiceShellProps {
  session: Session;
  debugVad?: boolean;
}

export function VoiceShell({
  session,
  debugVad = false,
}: VoiceShellProps): JSX.Element {
  // Phase 17 hook (currently unused at the UI layer — debug-vad emission
  // happens in session.ts's handleFrame methods). Explicit void usage so
  // the unused-parameter lint rule stays satisfied.
  void debugVad;

  const state = useAchillesState(session);
  const liveAmplitude = useAmplitude(session);
  const { ring, writeIndex } = useRingBuffer(session);
  const { errorClass, errorNonce, successNonce } = useErrorBanner(session);
  const [tickMs, setTickMs] = useState(0);

  // Single 50ms interval per VoiceShell mount per Pitfall 1 perf guidance.
  // The pure helpers blobFrame and sparklineFromRing pre-compute strings
  // outside the React tree — here we just bump tick state once per tick so
  // the synthetic envelopes (idle breathing, processing pulse) advance.
  useEffect(() => {
    const id = setInterval(() => {
      setTickMs((t) => t + 50);
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, []);

  // useInput callback per RESEARCH A3 verbatim shape. The !key.ctrl +
  // !key.meta guards prevent Ctrl-M / Cmd-M from false-firing the mute
  // toggle. The literal `input === "m"` is case-sensitive (uppercase M
  // does not toggle).
  useInput((input, key) => {
    if (input === "m" && !key.ctrl && !key.meta) {
      session.toggleMute();
    }
  });

  // Compute the effective amplitude per CONTEXT.md `<decisions>` Visual
  // surface row mapping:
  //   idle    -> idle breathing curve (period 1.2s, range [0.2, 0.4])
  //   muted   -> idle breathing curve (treat muted as idle visually)
  //   listening / error -> live mic RMS
  //   processing -> processing pulse (period 0.4s, range [0.2, 0.8])
  //   speaking -> 0 (Phase 17 wires real TTS amplitude)
  let amp = liveAmplitude;
  if (state === "idle" || state === "muted") {
    amp = idleBreathingAmplitude(tickMs);
  } else if (state === "processing") {
    amp = processingPulseAmplitude(tickMs);
  } else if (state === "speaking") {
    amp = 0;
  }

  const sr = isScreenReaderActive();
  // StatusRow always mounts; Blob + Sparkline suppress under screen-reader
  // mode per CONTEXT.md Accessibility row "don't render them at all".
  return (
    <Box flexDirection="column">
      <Banner
        classification={errorClass}
        errorNonce={errorNonce}
        successNonce={successNonce}
      />
      {sr ? (
        <ScreenReader state={state} />
      ) : (
        <>
          <Blob amplitude={amp} />
          <Sparkline ring={ring} writeIndex={writeIndex} />
        </>
      )}
      <StatusRow state={state} transcript="" transcriptsActive={false} />
    </Box>
  );
}
