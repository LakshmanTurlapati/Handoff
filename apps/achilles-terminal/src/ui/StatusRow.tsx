/**
 * TUI-04 + CAP-03 substrate — single-line status renderer
 * (Phase 16, Plan 03, Task 3).
 *
 * Renders: `[state] <last 60 chars of transcript> [REC]? [MUTED]?`
 *
 * Rules per CONTEXT.md `<decisions>` Mute control + Visual surface rows:
 *   - state name is colorized via STATE_COLORS palette through the colorize()
 *     helper (chalk auto-no-ops on NO_COLOR)
 *   - transcript is truncated to the trailing 60 characters via slice(-60)
 *     per CONTEXT.md `<domain>` row 1
 *   - [REC] tag appears when `transcriptsActive` prop is true (Plan 18 wires
 *     the real --save-transcripts flag; Phase 16 surface only)
 *   - [MUTED] tag appears when state === "muted"
 *
 * The `m` keypress handler that toggles mute lives in Plan 04's VoiceShell.tsx
 * (where session.toggleMute() is in scope); Plan 03's StatusRow.tsx receives
 * `state` and `transcriptsActive` as props.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge.
 *
 * No emojis (CLAUDE.md global).
 */

import type { JSX } from "react";
import { Text } from "ink";
import { colorize } from "./colors.js";
import type { AchillesState } from "../state/constants.js";

export interface StatusRowProps {
  state: AchillesState;
  transcript: string;
  transcriptsActive: boolean;
}

export function StatusRow({
  state,
  transcript,
  transcriptsActive,
}: StatusRowProps): JSX.Element {
  const stateTag = colorize(state, "[" + state + "]");
  // Truncate to the trailing 60 characters — slice(-60) returns the whole
  // string when length <= 60, otherwise the last 60.
  const truncated = transcript.slice(-60);
  const recTag = transcriptsActive ? " " + colorize("error", "[REC]") : "";
  const mutedTag = state === "muted" ? " " + colorize("muted", "[MUTED]") : "";
  const transcriptSegment = truncated.length > 0 ? " " + truncated : "";
  return (
    <Text>
      {stateTag}
      {transcriptSegment}
      {recTag}
      {mutedTag}
    </Text>
  );
}
