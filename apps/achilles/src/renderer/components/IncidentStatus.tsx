/**
 * IncidentStatus — Plan 14-03 SAFE-05 voice-service health dot.
 *
 * Renders a small circular dot in the floating-window corner whose
 * colour reflects the composed STT + TTS circuit-breaker health.
 *
 * Health composition (Plan 14-03 IS1):
 *
 *   both 'ok'                        -> green  (--achilles-status-ok)
 *   one 'degraded' OR
 *   one 'failed' with other 'ok'     -> yellow (--achilles-status-degraded)
 *   both 'failed' OR any 'failed'
 *   with the other 'degraded'        -> red    (--achilles-status-failed)
 *
 * The component is CONTROLLED — it subscribes to NOTHING. The two
 * health props are supplied by App.tsx which itself subscribes to
 * IPC_INCIDENT_STATUS. This keeps the dot trivially testable and
 * reusable; the dispatch boundary is the App, not the dot.
 *
 * Threat model: T-14-18 (status dot misleading user) is accepted —
 * the dot is informational; the truth source is the main-side
 * circuit-breaker state. The hover tooltip surfaces the actual
 * per-surface state so a user investigating a yellow dot can see
 * which surface is degraded.
 *
 * NO emojis (CLAUDE.md global).
 */
import type { ReactElement } from "react";

/**
 * Per-surface health bucket. The vocabulary is shared with
 * incident-detection.ts's CircuitState semantics — 'ok' maps to
 * closed; 'degraded' maps to a non-trivial consecutive-failure count
 * before the breaker opens; 'failed' maps to open.
 */
export type IncidentHealth = "ok" | "degraded" | "failed";

export interface IncidentStatusProps {
  /** Current STT circuit health composition bucket. */
  sttHealth: IncidentHealth;
  /** Current TTS circuit health composition bucket. */
  ttsHealth: IncidentHealth;
}

/**
 * Derived overall status. The composition rule maps both per-surface
 * states into a single 'ok' / 'degraded' / 'failed' kind that the
 * dot's CSS class consumes.
 */
type StatusKind = "ok" | "degraded" | "failed";

/**
 * Compose two per-surface health values into a single status kind.
 *
 * Pure helper exported so the App test (which composes the same
 * vocabulary on the IPC payload) can call it directly without
 * duplicating the rule.
 */
export function composeIncidentStatus(
  stt: IncidentHealth,
  tts: IncidentHealth,
): StatusKind {
  // Both ok -> ok
  if (stt === "ok" && tts === "ok") return "ok";
  // Both failed -> failed
  if (stt === "failed" && tts === "failed") return "failed";
  // Any failed paired with degraded -> failed (per IS1)
  if (
    (stt === "failed" && tts === "degraded") ||
    (stt === "degraded" && tts === "failed")
  ) {
    return "failed";
  }
  // All other compositions are 'degraded':
  //   - one degraded, one ok
  //   - one failed, one ok
  return "degraded";
}

export function IncidentStatus(props: IncidentStatusProps): ReactElement {
  const status = composeIncidentStatus(props.sttHealth, props.ttsHealth);
  const className = `incident-status-dot incident-status-${status}`;
  const title = `STT: ${props.sttHealth}; TTS: ${props.ttsHealth}`;
  return (
    <div
      className={className}
      data-testid="incident-status-dot"
      data-status={status}
      role="status"
      aria-label={title}
      title={title}
    />
  );
}
