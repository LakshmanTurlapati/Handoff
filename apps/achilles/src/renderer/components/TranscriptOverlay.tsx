/**
 * TranscriptOverlay — LOOP-02 partial + committed transcript renderer.
 *
 * Plan 11-02 Task 2: enforces the documented opacity + visibility +
 * fade rules from UI-SPEC §1 and §10:
 *
 *   - partial   → opacity 0.7 (via the `transcript-partial` class)
 *   - committed → opacity 1.0 (via the `transcript-committed` class)
 *   - newest at the bottom (DOM order matches chronological order)
 *   - max 3 visible lines (slice the last `maxVisibleLines` entries)
 *   - committed lines fade to 0 over 1500ms after `fadeAfterMs` of
 *     idle (default 15000ms — LOOP-02)
 *   - when state === 'speaking' for > 1000ms, fade transcripts out
 *     (user is hearing the response, not reading)
 *   - empty partial string renders NO partial element (avoid the
 *     0.7-opacity orphan box)
 *
 * The component is display-only: no edit affordances, no copy button.
 * That matches CONTEXT.md decision and the LOOP-02 contract.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import type { AchillesState } from "../../shared/constants.js";
import type { CommittedTranscriptEntry } from "../state/useAchillesState.js";

export interface TranscriptOverlayProps {
  state: AchillesState;
  /** Empty string when no in-flight partial. */
  partial: string;
  committed: readonly CommittedTranscriptEntry[];
  /** Default 3 (UI-SPEC §1 listening row). */
  maxVisibleLines?: number;
  /** Default 15000ms (LOOP-02). */
  fadeAfterMs?: number;
  /**
   * Default 1000ms — when state is 'speaking', delay the
   * `speaking-hide` class so the previous transcript stays visible
   * for the first second of speaking (matches UI-SPEC §1 speaking row
   * "fades out 1 second into speaking state").
   */
  speakingHideDelayMs?: number;
}

const DEFAULT_MAX_VISIBLE = 3;
const DEFAULT_FADE_AFTER_MS = 15000;
const DEFAULT_SPEAKING_HIDE_DELAY_MS = 1000;
const FADE_CHECK_INTERVAL_MS = 1000;

export function TranscriptOverlay({
  state,
  partial,
  committed,
  maxVisibleLines = DEFAULT_MAX_VISIBLE,
  fadeAfterMs = DEFAULT_FADE_AFTER_MS,
  speakingHideDelayMs = DEFAULT_SPEAKING_HIDE_DELAY_MS,
}: TranscriptOverlayProps): ReactElement | null {
  const [now, setNow] = useState<number>(() => Date.now());
  const [speakingHide, setSpeakingHide] = useState<boolean>(false);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Idle fade-check ticker. Runs only while state === 'idle' so
  // CPU is bounded outside the LOOP-02 trigger window.
  useEffect(() => {
    if (state !== "idle") {
      return undefined;
    }
    const interval = setInterval(() => {
      setNow(Date.now());
    }, FADE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state]);

  // Speaking-hide timer — when state flips to 'speaking', the
  // transcripts fade out after speakingHideDelayMs. When state leaves
  // 'speaking', cancel the timer and clear the hide flag immediately.
  useEffect(() => {
    if (state === "speaking") {
      if (speakingTimerRef.current !== null) {
        clearTimeout(speakingTimerRef.current);
      }
      speakingTimerRef.current = setTimeout(() => {
        setSpeakingHide(true);
        speakingTimerRef.current = null;
      }, speakingHideDelayMs);
      return () => {
        if (speakingTimerRef.current !== null) {
          clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = null;
        }
      };
    }
    // Not speaking — clear the hide flag and any pending timer.
    if (speakingTimerRef.current !== null) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    setSpeakingHide(false);
    return undefined;
  }, [state, speakingHideDelayMs]);

  // Slice committed to the most recent maxVisibleLines.
  const visible =
    committed.length > maxVisibleLines
      ? committed.slice(-maxVisibleLines)
      : committed;

  // Decide which committed lines are in the LOOP-02 fade window: when
  // state === 'idle' AND (now - committedAt) > fadeAfterMs, the line
  // gets the 'fading' class (the CSS keyframe animates opacity to 0).
  function isFading(entry: CommittedTranscriptEntry): boolean {
    if (state !== "idle") return false;
    return now - entry.committedAt > fadeAfterMs;
  }

  const containerClass = speakingHide
    ? "transcript-overlay speaking-hide"
    : "transcript-overlay";

  const hasPartial = partial.length > 0;

  return (
    <div className={containerClass} data-testid="transcript-overlay">
      {visible.map((entry) => (
        <div
          key={entry.id}
          data-testid="transcript-committed"
          className={`transcript-committed${isFading(entry) ? " fading" : ""}`}
        >
          {entry.text}
        </div>
      ))}
      {hasPartial && (
        <div
          data-testid="transcript-partial"
          className="transcript-partial"
        >
          {partial}
        </div>
      )}
    </div>
  );
}
