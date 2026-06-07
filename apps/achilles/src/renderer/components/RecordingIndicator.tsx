/**
 * RecordingIndicator — Plan 14-02 SAFE-02 visible affordance.
 *
 * When `--save-transcripts` is active (the renderer learns via the
 * IPC_TRANSCRIPT_PERSISTENCE_STATE broadcast), App.tsx renders this
 * component with `visible={true}`. The result is a small positioned
 * region containing a pulsing red dot AND the locked label
 * "Recording transcripts". The user cannot miss the affordance —
 * SAFE-02 mandates that the active state is unambiguous so the
 * privacy-sensitive opt-in cannot be forgotten.
 *
 * Behaviour contract (Plan 14-02 RI1 / RI2):
 *
 *   - When `visible === false`, returns `null` (no DOM produced).
 *   - When `visible === true`, renders the dot + label inside a
 *     positioned region tagged `data-testid="recording-indicator"`.
 *   - The dot has the CSS class `recording-dot` which the
 *     components.css declares with a `pulse` keyframe animation so
 *     the visual is obviously moving — the user cannot mistake it for
 *     a static graphic.
 *   - The component is CONTROLLED — it subscribes to NOTHING. The
 *     visible boolean is supplied by the App composition root, which
 *     itself subscribes to the IPC channel. This keeps the indicator
 *     trivially testable and reusable.
 *
 * Threat model: T-14-06 (information disclosure) is mitigated by the
 * combination of (a) the default-off invariant in transcript-store.ts
 * (verified structurally) AND (b) the indicator's visible presence
 * whenever persistence is active. The two together mean a user cannot
 * have files written without seeing the affordance.
 *
 * NO emojis (CLAUDE.md global). NO transcript content surfaces here.
 */
import type { ReactElement } from "react";

export interface RecordingIndicatorProps {
  /**
   * Whether the indicator is currently visible. When false, the
   * component renders nothing (returns null). When true, the pulsing
   * red dot + label render.
   *
   * Driven by App.tsx state which mirrors the
   * IPC_TRANSCRIPT_PERSISTENCE_STATE broadcast from main.
   */
  visible: boolean;
}

/**
 * Locked label string. The wording is part of the SAFE-02 user-
 * facing contract — a future contributor should NOT change this
 * without revisiting the threat-model dispositions in 14-02-PLAN.md.
 */
const RECORDING_LABEL = "Recording transcripts";

export function RecordingIndicator(
  props: RecordingIndicatorProps,
): ReactElement | null {
  if (!props.visible) return null;
  return (
    <div
      className="recording-indicator"
      data-testid="recording-indicator"
      role="status"
      aria-label={RECORDING_LABEL}
    >
      <span
        className="recording-dot"
        data-testid="recording-indicator-dot"
        aria-hidden="true"
      />
      <span
        className="recording-indicator-label"
        data-testid="recording-indicator-label"
      >
        {RECORDING_LABEL}
      </span>
    </div>
  );
}
