/**
 * Phase 17, Plan 01, Task 1 — Session-scoped EventEmitter event shape.
 *
 * Single discriminated union over every event the Phase 17 Session emitter
 * fans out to Phase 16's UI subscription contract (useAchillesState). The
 * five variant groups mirror the v1.2 IPC envelope channels, stripped of
 * the renderer/main boundary:
 *
 *   - Mic-tier events:    mic_frame, vad_speech_start, vad_speech_end
 *   - STT-tier events:    stt_partial, stt_committed
 *   - Claude-tier events: claude_ack, claude_partial, claude_summary,
 *                         claude_done, claude_failed
 *   - TTS-tier events:    tts_ready, tts_drained
 *   - Lifecycle events:   state_change, error, shutdown
 *
 * The 15 variants are listed in 17-CONTEXT.md `<domain>` row "Session-
 * scoped EventEmitter shape" and are referenced by the Wave 2 audio
 * bridges (stt-bridge, tts-playback, claude-bridge) when they emit on
 * the per-invocation Session emitter.
 *
 * This file is PURE types — no runtime imports, no module-level state,
 * no side effects. The `ClaudeOutcome` import is a type-only import
 * from `@achilles/claude-code-bridge` (LOOP-02: Phase 17 IMPORTS the
 * voice packages but does NOT modify them). The `AchillesState` import
 * is a type-only import from the Phase 16 state-machine constants.
 *
 * No emojis (CLAUDE.md global).
 */

import type { ClaudeOutcome } from "@achilles/claude-code-bridge";
import type { AchillesState } from "./state/constants.js";

/**
 * Classification union for the `error` event variant. The `network`,
 * `auth`, `rate_limit`, `server`, and `unknown` kinds mirror the
 * v1.2 `ClassifiedErrorKind` produced by the circuit-breaker port at
 * apps/achilles-terminal/src/circuit-breaker.ts (Task 2). The
 * `mic_unavailable`, `playback_lost`, and `claude_failed` kinds extend
 * the union to cover the Wave 2 audio-pipeline failure modes that do
 * not originate from a classified HTTP error.
 *
 * @public
 */
export type SessionErrorClassification =
  | "network"
  | "auth"
  | "rate_limit"
  | "server"
  | "unknown"
  | "mic_unavailable"
  | "playback_lost"
  | "claude_failed";

/**
 * Classification union for the `shutdown` event variant. The four
 * reasons cover the LOOP-05 cancel chain entry points: SIGINT,
 * SIGTERM, an internal error escalation, or a programmatic dispose()
 * call from the runVoice() entry point.
 *
 * @public
 */
export type SessionShutdownReason =
  | "sigint"
  | "sigterm"
  | "internal_error"
  | "dispose";

/**
 * Mic-tier event: raw PCM frame from sox after RMS computation. The
 * frame is a 320-sample Int16Array at 16 kHz mono s16le (the v1.3
 * sox lockdown). The rms field is the normalized [0, 1] RMS already
 * computed by the mic-sox handler so subscribers do not have to
 * recompute it.
 *
 * @public
 */
export interface MicFramePayload {
  readonly frame: Int16Array;
  readonly rms: number;
}

/**
 * VAD-tier event payload. Empty — the event identifies the transition
 * and the timestamp; subscribers read state from the Session itself
 * via the `state_change` event.
 *
 * @public
 */
export type VadEdgePayload = Record<string, never>;

/**
 * STT-tier event payload. Carries the text token that ElevenLabs
 * Scribe v2 emitted on its WSS — either a partial (delta) or a
 * committed (final) transcript fragment.
 *
 * @public
 */
export interface SttTextPayload {
  readonly text: string;
}

/**
 * Claude-tier text payload. Carries the extracted ack region
 * (`claude_ack`), the streaming partial assistant text
 * (`claude_partial`), or the final `<spoken-summary>` body
 * (`claude_summary`). The Wave 2 claude-bridge extracts each region
 * via the v1.2 extractors `extractAck` + `extractSpokenSummary`
 * from `@achilles/claude-code-bridge`.
 *
 * @public
 */
export interface ClaudeTextPayload {
  readonly text: string;
}

/**
 * Claude-tier completion payload. `claude_done` fires once when the
 * claude subprocess exits cleanly; the outcome union carries the
 * authoritative success/failure verdict derived from the subprocess
 * exit code + the tool_result event stream.
 *
 * The ClaudeOutcome type is the v1.2 derived verdict exported by
 * `@achilles/claude-code-bridge`; we re-shape it here so subscribers
 * can switch on outcome.kind without re-importing the bridge package
 * directly.
 *
 * @public
 */
export interface ClaudeDonePayload {
  readonly outcome: ClaudeOutcome;
}

/**
 * Claude-tier failure-override payload. `claude_failed` fires when
 * the bridge's failure-override condition triggers — exit code != 0
 * OR tool_result with is_error: true OR any cause the bridge
 * classifies as `claude_failed`. The reason string is the
 * human-readable phrase the Phase 17 buildFailureSummary helper
 * (Plan 03) appends to the "I ran into a problem" FAILURE_OVERRIDE_PHRASE.
 *
 * @public
 */
export interface ClaudeFailedPayload {
  readonly reason: string;
}

/**
 * TTS-tier event payload. `tts_ready` fires when ffplay opens its
 * stdin pipe and is ready to receive MP3 frames; `tts_drained`
 * fires when the voice-tts events$ end-of-stream + ffplay stdin
 * end-of-write combine and the playback queue is empty.
 *
 * @public
 */
export type TtsEdgePayload = Record<string, never>;

/**
 * Lifecycle event payload — state machine transition. The state
 * field carries the new state the reducer transitioned to; the
 * Phase 16 6-state tuple lives at src/state/constants.ts.
 *
 * @public
 */
export interface StateChangePayload {
  readonly state: AchillesState;
}

/**
 * Lifecycle event payload — surfaceable error. The classification
 * field carries the SessionErrorClassification kind; the message
 * field is the redacted human-readable line the structured-logger
 * and the UI status row both consume.
 *
 * @public
 */
export interface SessionErrorPayload {
  readonly classification: SessionErrorClassification;
  readonly message: string;
}

/**
 * Lifecycle event payload — shutdown initiation. The reason field
 * identifies the SessionShutdownReason; subscribers route to the
 * gracefulShutdown chain or the dispose path accordingly.
 *
 * @public
 */
export interface SessionShutdownPayload {
  readonly reason: SessionShutdownReason;
}

/**
 * Discriminated union over the 15 SessionEvent variants. Each variant
 * carries:
 *
 *   - `type`     — the string literal identifying the variant
 *   - `payload`  — the variant-specific payload shape
 *   - `timestamp` — `Date.now()` value captured at emit time
 *
 * Wave 2 audio-bridge modules construct SessionEvent values via
 * `{ type: "stt_committed", payload: { text: "..." }, timestamp: now() }`
 * and emit them through the Session's EventEmitter. The UI tier
 * (Phase 16 useAchillesState) subscribes via the `type` discriminant
 * and narrows the payload via TypeScript's structural-narrowing.
 *
 * @public
 */
export type SessionEvent =
  | { type: "mic_frame"; payload: MicFramePayload; timestamp: number }
  | { type: "vad_speech_start"; payload: VadEdgePayload; timestamp: number }
  | { type: "vad_speech_end"; payload: VadEdgePayload; timestamp: number }
  | { type: "stt_partial"; payload: SttTextPayload; timestamp: number }
  | { type: "stt_committed"; payload: SttTextPayload; timestamp: number }
  | { type: "claude_ack"; payload: ClaudeTextPayload; timestamp: number }
  | { type: "claude_partial"; payload: ClaudeTextPayload; timestamp: number }
  | { type: "claude_summary"; payload: ClaudeTextPayload; timestamp: number }
  | { type: "claude_done"; payload: ClaudeDonePayload; timestamp: number }
  | { type: "claude_failed"; payload: ClaudeFailedPayload; timestamp: number }
  | { type: "tts_ready"; payload: TtsEdgePayload; timestamp: number }
  | { type: "tts_drained"; payload: TtsEdgePayload; timestamp: number }
  | { type: "state_change"; payload: StateChangePayload; timestamp: number }
  | { type: "error"; payload: SessionErrorPayload; timestamp: number }
  | { type: "shutdown"; payload: SessionShutdownPayload; timestamp: number };

/**
 * String-literal union over every SessionEvent `type` value. Wave 2
 * audio-bridge modules can use `SessionEventType` to type a function
 * parameter that takes only a known event type name (e.g. an
 * EventEmitter `on(type, listener)` signature).
 *
 * @public
 */
export type SessionEventType = SessionEvent["type"];
