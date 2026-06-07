/**
 * Per-utterance orchestrator for the Achilles voice loop.
 *
 * Plan 12-04 — composes every Phase 09/10/11/12-01/12-02/12-03 module
 * into the real production state machine:
 *
 *   - @achilles/voice-stt (renderer-side; main mints tokens here)
 *   - @achilles/claude-code-bridge (createClaudeSession + extractAck +
 *     extractSpokenSummary + deriveOutcome)
 *   - @achilles/voice-tts (createTtsStreamClient)
 *   - @achilles/achilles-skill (companionPromptPath)
 *   - apps/achilles/src/main/sandwich-defence.ts (wrapTranscript +
 *     detectManipulationTokens) — SAFE-04 + PITFALLS #9
 *   - apps/achilles/src/main/normalisation.ts (normaliseForTts) —
 *     PITFALLS #16 + #21
 *   - apps/achilles/src/main/state-machine.ts (the pure reducer +
 *     production STT_COMMITTED / CLAUDE_RESULT_READY / TTS_PLAYBACK_DRAINED /
 *     CLAUDE_FAILURE_OVERRIDE tags Plan 12-04 added)
 *
 * Pitfalls owned by session.ts:
 *
 *   - #2  echo loop — pauseFrameDelivery() + MIC_FRAME drop during
 *         speaking + 300 ms debounce after playback drain
 *   - #9  prompt injection — sandwich-defence wraps every transcript
 *         before bridge.send; detectManipulationTokens warns on shape
 *         without silently stripping
 *   - #10 re-utterance race — onCancel() drains the in-flight TTS and
 *         cancels the bridge child before the orchestrator accepts the
 *         next hotkey press
 *   - #16 long completion — normaliseForTts caps the TTS body at 600 chars
 *   - #17 hallucinated success — PROMPT-05 runtime override: when
 *         deriveOutcome returns failure, the spoken summary becomes
 *         "I ran into a problem. <humanReason>" regardless of the LLM's
 *         <spoken-summary> body
 *   - #21 secrets in TTS — pre-TTS normalisation masks paths + secret
 *         prefixes; ANSI escapes stripped; fenced code dropped
 *
 * Half-duplex contract (LOOP-05):
 *
 *   - On the first ack delta: micCapture.pauseFrameDelivery() AND
 *     dispatch CLAUDE_RESULT_READY (state → speaking)
 *   - On TTS_PLAYBACK_COMPLETE: schedule SPEAKING_DEBOUNCE_MS (300 ms)
 *     timer; on fire dispatch TTS_PLAYBACK_DRAINED + resume mic
 *   - The state machine returns to idle, NOT listening — the user must
 *     explicitly press hotkey for the next turn (per CONTEXT.md
 *     half-duplex section).
 *
 * Logging discipline:
 *
 *   - Every log call uses the injected logger; default goes to
 *     console.error with the [achilles] prefix.
 *   - Log statements include state name + outcome.kind + counts.
 *   - NEVER include payload.text, accumulatedText, TTS bytes, the API
 *     key, or any user transcript fragment. The SE13 test pins this.
 *
 * SAFE-01: the ElevenLabs API key is captured ONCE at construction time
 * via deps.readApiKey() and held in the closure. It is never logged,
 * never returned, never crosses IPC. The renderer receives single-use
 * STT tokens minted via deps.mintSttToken — not the key.
 */
import {
  deriveOutcome,
  extractAck,
  extractSpokenSummary,
} from "@achilles/claude-code-bridge";
import type {
  ClaudeBridgeEvent,
  ClaudeOutcome,
  ClaudeSession,
  ProcessExitEvent,
} from "@achilles/claude-code-bridge";

import {
  IPC_INCIDENT_STATUS,
  IPC_INCIDENT_STT_FAIL,
  IPC_INCIDENT_TTS_FAIL,
  IPC_STT_TOKEN,
  IPC_STUCK_THINKING_ANNOUNCE,
  IPC_TTS_CHUNK,
} from "../shared/constants.js";
import type {
  AchillesState,
  PermissionState,
} from "../shared/constants.js";
import type {
  MicFramePayload,
  UtteranceCommitPayload,
} from "./../shared/ipc-schemas.js";
import type {
  CircuitBreaker,
  ClassifiedErrorKind,
} from "./incident-detection.js";
import {
  detectManipulationTokens,
  wrapTranscript,
} from "./sandwich-defence.js";
import type { LatencyProbe } from "./latency-probe.js";
import { normaliseForTts } from "./normalisation.js";
import type { AchillesEvent } from "./state-machine.js";
import {
  STUCK_THINKING_ANNOUNCEMENT,
  type StuckThinkingWatchdog,
} from "./stuck-thinking-watchdog.js";
import type { TranscriptStoreLike } from "./transcript-store.js";

/**
 * Locked half-duplex tail timer per CONTEXT.md "Half-duplex turn-taking"
 * + PITFALLS #2 ("After TTS playback finishes: wait 300 ms debounce,
 * then transition back to idle"). The constant value is asserted by
 * session.test.ts SE4/SE10 and the verification grep in 12-04-PLAN.md.
 */
export const SPEAKING_DEBOUNCE_MS = 300;

/**
 * Locked PROMPT-05 override prefix. Plan 12-01's prompt-content.test.ts
 * pins the same phrase inside companion.md; the matching constant here
 * is the runtime enforcement. A drift between the two locations would
 * cause Plan 12-01's prompt test OR the SE6/SE7 runtime tests to fail,
 * so a future contributor cannot silently rephrase the override.
 */
const FAILURE_OVERRIDE_PREFIX = "I ran into a problem.";

/**
 * Minimal TTS client surface the orchestrator depends on. Mirrors
 * @achilles/voice-tts's TtsStreamClient AND the MockTtsHandle from
 * mock-loop-clients.ts so production and test both satisfy this type.
 *
 * The orchestrator drains chunks from events$ and broadcasts each
 * chunk on IPC_TTS_CHUNK; the renderer's playback-queue handles the
 * actual audio rendering.
 */
export interface OrchestratorTtsClient {
  /**
   * Opens the underlying TTS stream. Idempotent for the orchestrator's
   * purposes — calling open() twice on the production client awaits
   * the same socket-open promise.
   */
  open(): Promise<void>;
  /**
   * Appends a text fragment to the TTS stream. The production client
   * buffers and forwards; the mock client triggers chunk synthesis.
   */
  appendText(text: string): void;
  /**
   * Flush + close the stream. The orchestrator calls this after the
   * spoken summary has been written.
   */
  flush(): Promise<void> | void;
  /**
   * Forceful close — cancels the stream and drops the buffer.
   */
  close(): Promise<void> | void;
  /**
   * Async iterable of TTS events (chunks + complete). The orchestrator
   * uses these to fan out IPC_TTS_CHUNK payloads to the renderer.
   *
   * Each value is one of:
   *   {type:'chunk', chunk:{seq, mime, bytes, isFinal}}
   *   {type:'complete'}
   *
   * The shape is intentionally narrow — the mock client emits exactly
   * this shape, and the real client adapts its TtsEvent variants into
   * this shape via a thin adapter at the deps boundary.
   */
  readonly events$: AsyncIterable<TtsChunkLike | TtsCompleteLike>;
}

/**
 * Single TTS chunk event surfaced on the orchestrator's TTS iterable.
 * The `chunk` shape matches the IPC_TTS_CHUNK payload bit-for-bit.
 */
export interface TtsChunkLike {
  type: "chunk";
  chunk: {
    seq: number;
    mime: "audio/mpeg" | "audio/pcm";
    bytes: ArrayBuffer;
    isFinal: boolean;
  };
}

/**
 * Terminal TTS event.
 */
export interface TtsCompleteLike {
  type: "complete";
}

/**
 * Minimal mic-capture handle the orchestrator depends on. Mirrors a
 * subset of @achilles/app/renderer/audio/mic-capture.ts (which lives
 * in the renderer process). In production main calls these via an IPC
 * indirection — the state-changed broadcast triggers the renderer-side
 * mic gate. In tests we inject a direct stub.
 */
export interface MicCaptureLike {
  pauseFrameDelivery(): void;
  resumeFrameDelivery(): void;
}

/**
 * Subset of MockStateController surface the orchestrator depends on.
 * The Plan 11 createMockStateController already returns this shape.
 */
export interface OrchestratorStateController {
  dispatch(event: AchillesEvent): AchillesState;
  now(): AchillesState;
  cancelScheduledTransitions(): void;
}

/**
 * Per-utterance metrics surfaced on the AchillesSession handle.
 *
 * WR-07: the half-duplex gate runs in BOTH `processing` AND
 * `speaking` (between STT_COMMITTED and the 300 ms post-playback tail).
 * The previous single counter `framesDroppedDuringSpeaking` was a
 * misnomer that masked the actual state distribution of dropped
 * frames. The metric is split into two counters with the legacy
 * name kept as the SUM so the SE9 test and any external monitoring
 * continue to read what they expect.
 */
export interface AchillesSessionMetrics {
  /**
   * Number of mic frames the orchestrator dropped while the session
   * was in the `speaking` state. Useful for verifying the half-duplex
   * gate at runtime; SE9 asserts this increments under simulation.
   */
  framesDroppedDuringSpeaking: number;
  /**
   * Number of mic frames the orchestrator dropped while the session
   * was in the `processing` state.
   */
  framesDroppedDuringProcessing: number;
  /**
   * Total mic frames dropped by the half-duplex gate
   * (framesDroppedDuringSpeaking + framesDroppedDuringProcessing).
   * Convenience accessor for callers that previously read the single
   * counter under the misleading name.
   */
  framesDroppedDuringHalfDuplexGate: number;
}

/**
 * Construction-time dependencies for the orchestrator. Every external
 * surface is behind a callable so tests inject deterministic fakes
 * without monkey-patching imports.
 */
export interface AchillesSessionDeps {
  /**
   * The state-machine controller. Plan 11-01's createMockStateController
   * satisfies this in production (the controller is the same in both
   * modes — only the timer scheduling differs). Plan 12-04's
   * createSessionStateController in main/index.ts is the production
   * construction site.
   */
  stateController: OrchestratorStateController;
  /**
   * Constructor for a Claude bridge session. In production this is a
   * wrapper around @achilles/claude-code-bridge's createClaudeSession;
   * in tests it returns a MockClaudeHandle (mock-loop-clients.ts).
   * Called once per utterance with resumeSessionId set to the previous
   * utterance's sid so context accumulates within an Achilles run.
   */
  claudeFactory: (opts: {
    systemPromptFile: string;
    resumeSessionId?: string;
  }) => ClaudeBridgeLike;
  /**
   * Constructor for the TTS stream client. Production wraps
   * @achilles/voice-tts's createTtsStreamClient with the captured API
   * key; tests inject MockTtsHandle.
   */
  ttsFactory: (opts: { voiceId: string }) => OrchestratorTtsClient;
  /**
   * Single-use STT token mint. In production this is a wrapper around
   * @achilles/voice-stt/token-mint's mintSttToken bound with the
   * captured API key; in tests it returns a deterministic fixture.
   *
   * SAFE-01: the renderer NEVER receives the raw API key — only the
   * single-use token from this callback.
   */
  mintSttToken: () => Promise<{ token: string; expiresAt: string }>;
  /**
   * Mic-capture gate. In production main drives the renderer mic gate
   * via the IPC_STATE_CHANGED broadcast (the renderer subscribes and
   * applies the gate locally); the closure here is a thin no-op shim
   * so the orchestrator's deterministic behaviour mirrors the renderer
   * mode. In tests the stub records call counts.
   */
  micCapture: MicCaptureLike;
  /**
   * Fan-out point for IPC payloads. Production wires this to
   * window.webContents.send; tests pass a recording spy.
   */
  sendIpc: (channel: string, payload: unknown) => void;
  /**
   * One-shot read of the ElevenLabs API key. The orchestrator captures
   * the result in its closure and never reads it again — but the
   * indirection keeps the AchillesSessionDeps shape testable without
   * spawning a real keystore.
   */
  readApiKey: () => string;
  /**
   * The default voice id for the TTS client. Production reads from
   * process.env.ELEVENLABS_VOICE_ID with the locked v1.2 fallback;
   * tests pass a fixed string.
   */
  voiceId: string;
  /**
   * Absolute filesystem path to the embedded companion.md system prompt.
   * Production passes companionPromptPath from @achilles/achilles-skill;
   * tests pass a mock path so the claudeFactory never reads disk.
   */
  systemPromptFile: string;
  /**
   * Optional logger sink. Defaults to console.error with the [achilles]
   * prefix. The logger MUST NOT receive raw transcript content, raw key
   * bytes, or TTS audio bytes — the SE13 test pins this invariant.
   */
  logger?: (msg: string) => void;
  /**
   * Optional clock override for the 300 ms debounce timer. Tests inject
   * an explicit map so the timer fires deterministically.
   */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  /**
   * Optional clear-timer override. Paired with setTimeoutImpl.
   */
  clearTimeoutImpl?: (token: unknown) => void;
  /**
   * Plan 14-01 — optional LOOP-06 latency probe. When provided, the
   * orchestrator records stage timestamps at six well-known transition
   * points:
   *
   *   onUtteranceCommit           → 'stt_committed' + markSpeechEnd
   *   first assistant_text_delta  → 'claude_first_text_delta'
   *   process_exit                → 'claude_assistant_done'
   *   tts.open() resolves         → 'tts_first_chunk'
   *   first IPC_TTS_CHUNK fan-out → 'tts_playback_start' + finalizeSample
   *   onTtsPlaybackComplete       → 'tts_playback_complete'
   *
   * The probe is undefined by default — Plan 12-04 callers (and the
   * Plan 14-01 tests that do not exercise the probe) pass nothing and
   * the orchestrator's behaviour is bit-for-bit identical to its pre-
   * 14-01 surface (verified by SE17). Production index.ts wires this
   * field iff ACHILLES_DEBUG=1.
   */
  latencyProbe?: LatencyProbe;
  /**
   * Plan 14-02 — optional SAFE-02 transcript store. When provided
   * (production wiring: only when ACHILLES_SAVE_TRANSCRIPTS=1), the
   * orchestrator calls `store.appendTurn` at two utterance
   * boundaries:
   *
   *   - onUtteranceCommit success path → `{role:"user", text: payload.text}`
   *     (the RAW user text, NOT the sandwich-wrapped form — we
   *     persist the user's actual utterance, not the bridge envelope)
   *   - consumeClaudeEvents process_exit branch → `{role:"assistant",
   *     text: summaryBody}` (the post-normalisation,
   *     post-PROMPT-05-override text — i.e., what the user heard)
   *
   * The store is undefined by default — Plan 12-04 callers (and the
   * Plan 14-01 / 14-02 tests that do not exercise the store) pass
   * nothing and the orchestrator's behaviour is bit-for-bit identical
   * to its pre-14-02 surface. SAFE-02 invariant: when the store is
   * undefined OR its `isEnabled()` returns false, the appendTurn
   * optional-chain is a SYNC no-op that NEVER touches the filesystem
   * (verified structurally by transcript-store.test.ts TS2 + TS10).
   */
  transcriptStore?: TranscriptStoreLike;
  /**
   * Plan 14-03 — optional SAFE-05 STT circuit breaker. When provided,
   * onHotkeyPress + requestSttToken route their mintSttToken() call
   * through `sttCircuit.attempt(...)`. On exhausted=true the
   * orchestrator broadcasts IPC_INCIDENT_STT_FAIL and dispatches
   * INJECT_ERROR; the renderer's TypedFallback overlay mounts so the
   * user can continue by typing. When undefined the orchestrator's
   * behaviour is bit-for-bit identical to its pre-14-03 surface.
   */
  sttCircuit?: CircuitBreaker;
  /**
   * Plan 14-03 — optional SAFE-05 TTS circuit breaker. When provided,
   * openTtsClient routes `tts.open()` through
   * `ttsCircuit.attempt(...)`. On exhausted=true the orchestrator
   * broadcasts IPC_INCIDENT_TTS_FAIL with the cached spoken-summary
   * text; the renderer surfaces the text visibly and main writes it
   * to process.stderr (via the index.ts sendIpc tap). When undefined
   * the orchestrator's behaviour is bit-for-bit identical to its
   * pre-14-03 surface.
   */
  ttsCircuit?: CircuitBreaker;
  /**
   * Plan 14-04 — optional SAFE-06 stuck-thinking watchdog. When
   * provided, consumeClaudeEvents calls watchdog.armForTurn() at the
   * start of the loop, watchdog.observeProgress() on every progress
   * event (assistant_text_delta / tool_use / tool_result /
   * session_init), and watchdog.clearForTurn() on process_exit. When
   * the timer fires (no progress for the configured timeoutMs window —
   * default 60 s), the orchestrator broadcasts
   * IPC_STUCK_THINKING_ANNOUNCE AND routes the locked
   * STUCK_THINKING_ANNOUNCEMENT through normaliseForTts +
   * appendText so the user hears the affordance. The state machine
   * does NOT transition (Claude is still working); the user must
   * still press the hotkey to cancel. When undefined, the
   * orchestrator's behaviour is bit-for-bit identical to its
   * pre-14-04 surface.
   */
  stuckThinkingWatchdog?: StuckThinkingWatchdog;
}

/**
 * Subset of the @achilles/claude-code-bridge ClaudeSession surface the
 * orchestrator depends on. We keep the shape minimal so the mock client
 * in mock-loop-clients.ts can satisfy it without claiming full parity.
 */
export interface ClaudeBridgeLike {
  readonly sessionId: string | null;
  readonly lastTurnText: string;
  readonly outcome: ClaudeOutcome | null;
  readonly events$: AsyncIterable<ClaudeBridgeEvent>;
  send(text: string): void;
  cancel(): Promise<ProcessExitEvent>;
  close(): Promise<void> | void;
}

/**
 * Public per-utterance orchestrator surface. The session is constructed
 * ONCE at app boot; the lifecycle methods drive the per-utterance state
 * transitions.
 */
export interface AchillesSession {
  /**
   * Entry point — usually called by the global hotkey handler. Drives
   * idle → listening, mints the STT token, and broadcasts IPC_STT_TOKEN
   * so the renderer's STT client can open its WebSocket. If currently
   * speaking, behaves as a cancel (per CONTEXT.md "During TTS: if user
   * presses hotkey, treat as cancel").
   */
  onHotkeyPress(): Promise<void>;
  /**
   * CR-02: stateless STT token refresh. The renderer's STT client may
   * need to re-mint the single-use token after a network reconnect or
   * after the token has expired. Calling onHotkeyPress() to refresh the
   * token would mutate the state machine (listening → processing, or
   * cancel from speaking). This method mints a fresh token and
   * broadcasts IPC_STT_TOKEN WITHOUT touching the reducer.
   */
  requestSttToken(): Promise<void>;
  /**
   * The renderer's STT client commit. Drives listening → processing,
   * wraps the transcript via SAFE-04, and forwards to the Claude
   * bridge.
   */
  onUtteranceCommit(payload: UtteranceCommitPayload): void;
  /**
   * One downsampled mic frame from the renderer (16 kHz mono Int16).
   * Dropped during speaking/processing per the half-duplex contract;
   * otherwise the production wiring is a no-op in v1.2 (the renderer's
   * STT client owns the WebSocket directly per Phase 09; this channel
   * exists for MOCK_LOOP=1 paths and Phase 14 diagnostic capture).
   */
  onMicFrame(payload: MicFramePayload): void;
  /**
   * Renderer signal that the playback-queue drained the last
   * (isFinal:true) chunk. Schedules the SPEAKING_DEBOUNCE_MS timer.
   */
  onTtsPlaybackComplete(): void;
  /**
   * Cancel an in-flight utterance — sends SIGINT to the Claude child,
   * closes the TTS stream, drains pending timers, resumes the mic gate,
   * and drives the state machine back to idle via CIRCLE_CLICK.
   */
  onCancel(): void;
  /**
   * Tear-down. Cancels any pending debounce timer + closes the current
   * bridge + closes the current TTS client. Idempotent — calling twice
   * is a no-op.
   */
  dispose(): void;
  /**
   * Plan 14-03 SAFE-05 — typed-fallback entry point. The renderer's
   * TypedFallback overlay calls bridge.sendTypedFallbackSubmit({text})
   * when STT is unavailable; the IPC handler in ipc-bridge.ts forwards
   * the text to this method. The implementation routes the text
   * through detectManipulationTokens + wrapTranscript + bridge.send
   * IDENTICALLY to onUtteranceCommit's success path — there is no
   * parallel code path. The latency probe (Plan 14-01) treats the
   * typed prompt as a zero-STT-cost utterance (markSpeechEnd at now,
   * stt_committed recorded immediately).
   */
  handleTypedPrompt(text: string): void;
  /**
   * Plan 14-04 SAFE-06 — stuck-thinking watchdog onTimeout callback.
   * The dep-boundary wiring (index.ts constructs the watchdog with
   * `onTimeout: ({waitedMs}) => session.announceStuckThinking({waitedMs})`)
   * routes the timer fire here so the orchestrator owns the TTS +
   * IPC fan-out side effects, not the pure watchdog module.
   *
   * Behaviour: open (or REUSE) the existing TTS stream, normalise
   * STUCK_THINKING_ANNOUNCEMENT via normaliseForTts (PITFALLS #16 +
   * #21 still apply), call tts.appendText(normalised), AND broadcast
   * IPC_STUCK_THINKING_ANNOUNCE({text: STUCK_THINKING_ANNOUNCEMENT,
   * waitedMs}) so the renderer's TranscriptOverlay shows the same
   * text. The state machine does NOT transition (Claude is still
   * working). The user can still cancel via the existing hotkey /
   * onCancel path; SE26 asserts no CIRCLE_CLICK / HOTKEY_PRESS is
   * dispatched here.
   */
  announceStuckThinking(event: { waitedMs: number }): void;
  /**
   * Plan 14-04 SAFE-06 — OS suspend handler.
   *
   * Fires BEFORE the OS suspends (Electron's powerMonitor 'suspend'
   * event, wired via wireSuspendResume at index.ts). The orchestrator:
   *
   *   - Cancels any pending debounce timer (clearDebounce).
   *   - Cancels the in-flight Claude bridge if any (best-effort; we
   *     do NOT throw because the session is about to be suspended).
   *   - Closes the TTS client if any so the AudioContext is released.
   *   - Calls deps.micCapture.pauseFrameDelivery so the renderer's
   *     worklet drops any frames the OS may flush during the
   *     suspend boundary.
   *   - Dispatches CIRCLE_CLICK to drive the state machine back to
   *     idle. From `idle` this is a no-op; from `listening` /
   *     `processing` / `speaking` the reducer drives back to idle so
   *     the next hotkey press starts a fresh utterance.
   *   - Logs `[achilles] suspend: state -> idle`.
   *
   * onSuspend during state == 'idle' is a no-op aside from the
   * defensive clearDebounce + pauseFrameDelivery + log. SE28 verifies
   * this via spy.
   */
  onSuspend(): void;
  /**
   * Plan 14-04 SAFE-06 — OS resume handler.
   *
   * Fires AFTER the OS resumes (Electron's powerMonitor 'resume'
   * event, wired via wireSuspendResume at index.ts). The orchestrator:
   *
   *   - Logs `[achilles] resume: ready for next utterance`.
   *   - Does NOT dispatch any state event. The state machine is
   *     already at idle (onSuspend drove it there); the next hotkey
   *     press starts a fresh utterance with the next --resume sid.
   *
   * The renderer-side audio context is re-acquired by the
   * device-change-handler when the OS reports the default device
   * (per CONTEXT.md "On resume: re-acquire the default audio device").
   * Plan 14-04 does NOT re-open the bridge or TTS client here — those
   * are per-utterance and are constructed lazily on the next hotkey
   * press.
   */
  onResume(): void;
  /**
   * Plan 14-04 SAFE-06 — device-change handler. The renderer's
   * mic-capture module subscribes to navigator.mediaDevices.ondevicechange
   * and notifies main via the existing bridge surface; main routes the
   * notification into this method.
   *
   * Behaviour:
   *   - log `[achilles] device change: deviceId=<id> kind=<kind>`
   *   - when `mirroredState === 'listening'`: trigger a soft re-acquire
   *     by calling deps.micCapture.pauseFrameDelivery() then
   *     setTimeout(resumeFrameDelivery, 0) via the injected setTimeoutImpl
   *     (allows the renderer's worklet to restart)
   *   - when `mirroredState !== 'listening'`: the method is a no-op
   *     beyond the log
   *
   * The kind 'hfp-downgrade' is informational — the orchestrator logs
   * a warning but the response is identical to 'device-switch'.
   */
  onDeviceChange(event: {
    deviceId?: string;
    kind?: "hfp-downgrade" | "device-switch";
  }): void;
  readonly metrics: AchillesSessionMetrics;
}

/**
 * Construct a session orchestrator. The returned handle is reusable
 * across many utterances within an Achilles run — each utterance
 * advances the state machine and resumes the same Claude session via
 * --resume <sid>.
 */
export function createSession(deps: AchillesSessionDeps): AchillesSession {
  const log =
    deps.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });
  const setT =
    deps.setTimeoutImpl ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
  const clearT =
    deps.clearTimeoutImpl ??
    ((token: unknown): void => {
      clearTimeout(token as ReturnType<typeof setTimeout>);
    });

  // Capture the API key in the closure ONCE. The closure is the only
  // place the key lives at runtime; SAFE-01 + PITFALLS #21 invariant.
  // We do NOT log it; we do NOT broadcast it; we do NOT return it.
  // The key is consumed by mintSttToken (token round-trip) and by
  // ttsFactory (TTS stream client). No other surface receives it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _apiKey = deps.readApiKey();
  // The disposition above ensures the variable is captured + held; we
  // do not surface it on the public handle. Touching the value once
  // also lets the readApiKey side effect (the [achilles] info log
  // recording which source supplied the key) happen at session
  // construction time, not lazily on the first hotkey press.
  void _apiKey;

  // ─── per-utterance mutable state ──────────────────────────────────
  let currentClaudeSession: ClaudeBridgeLike | null = null;
  let currentTtsClient: OrchestratorTtsClient | null = null;
  let debounceToken: unknown | null = null;
  let lastSessionId: string | null = null;
  // Accumulated assistant text for the current utterance. Each delta
  // is appended; we feed extractAck + extractSpokenSummary off this.
  let accumulatedText = "";
  // Whether the orchestrator has already emitted the ack for the
  // current utterance. The ack is the FIRST thing routed to TTS;
  // subsequent extractAck() calls are no-ops for the rest of the turn.
  let ackEmitted = false;
  // CR-01 guard: whether the orchestrator has already transitioned
  // processing → speaking for the current turn. process_exit must
  // synthesise the transition when the ack path never fired (e.g. the
  // bridge emitted no delta with a sentence terminator before exit).
  // Without this, state stays pinned in `processing` forever and the
  // mic gate is never engaged — PITFALLS #2 echo loop opens wide.
  let speakingEnteredForTurn = false;
  // WR-01 side-channel tool-error accumulator. We observe every
  // `tool_result` event with `is_error:true` and pass the captured
  // tool_use_ids into the fallback `deriveOutcome` call on process_exit
  // when `session.outcome` is unexpectedly null. Defence-in-depth:
  // the orchestrator does NOT trust ANY one source for outcome
  // attribution. The previous fallback passed `toolErrors: []` which
  // could mask a real failure as success and route the LLM's
  // hallucinated success body verbatim (PITFALLS #17).
  let observedToolErrors: string[] = [];
  // Flag tracking whether the orchestrator opened TTS for this turn.
  // Used to gate the close() in onCancel + dispose().
  let ttsOpenedForTurn = false;
  // Pending consumer-loop promise per turn. Captured so the orchestrator
  // can detect a stale consumer when an utterance is cancelled.
  let activeConsumerPromise: Promise<void> | null = null;
  let disposed = false;
  // Plan 14-03 SAFE-05: cached spoken-summary text for the current
  // turn. Populated inside consumeClaudeEvents process_exit branch
  // BEFORE the (potentially failing) openTtsClient call so when the
  // TTS circuit opens, the IPC_INCIDENT_TTS_FAIL payload carries the
  // text the user did NOT hear. The cache is reset every turn via
  // resetTurnLocals() so a stale prior summary cannot bleed into the
  // next turn's incident payload.
  let cachedSummaryText = "";
  // CR-04 fix: PITFALLS #18 "cache MOST RECENT completion text locally"
  // invariant. cachedSummaryText is per-turn and gets reset by
  // resetTurnLocals() at the start of every turn — but if the TTS circuit
  // opens BEFORE the new turn's summary has been computed (e.g. the ack
  // path's openTtsClient call fails on circuit-exhausted), the
  // IPC_INCIDENT_TTS_FAIL payload would carry "" and the user would lose
  // the last summary they actually completed. lastSuccessfulSummary
  // survives across turns and is updated only when a NEW summary is
  // successfully spoken; it acts as the fallback for the empty-cache case.
  let lastSuccessfulSummary = "";
  // Mirror of the controller's current state — accessed in the hot
  // path of onMicFrame to gate frames without round-tripping through
  // controller.now() every frame. Updated on every dispatch.
  let mirroredState: AchillesState = "idle";

  // WR-07: split the drop counters by state so the metric name
  // matches the increment site. framesDroppedDuringHalfDuplexGate is
  // exposed as a derived read-only sum.
  const metrics: AchillesSessionMetrics = {
    framesDroppedDuringSpeaking: 0,
    framesDroppedDuringProcessing: 0,
    get framesDroppedDuringHalfDuplexGate(): number {
      return (
        this.framesDroppedDuringSpeaking +
        this.framesDroppedDuringProcessing
      );
    },
  } as AchillesSessionMetrics;

  function syncMirroredState(next: AchillesState): void {
    mirroredState = next;
  }

  function dispatch(event: AchillesEvent): AchillesState {
    const next = deps.stateController.dispatch(event);
    syncMirroredState(next);
    return next;
  }

  function clearDebounce(): void {
    if (debounceToken !== null) {
      clearT(debounceToken);
      debounceToken = null;
    }
  }

  function resetTurnLocals(): void {
    accumulatedText = "";
    ackEmitted = false;
    ttsOpenedForTurn = false;
    speakingEnteredForTurn = false;
    observedToolErrors = [];
    cachedSummaryText = "";
  }

  /**
   * Plan 14-03 SAFE-05 helper. Maps a CircuitBreaker.status() snapshot
   * into the IncidentHealth bucket used by the renderer:
   *
   *   - closed  -> 'ok'
   *   - half-open OR closed-with-failures -> 'degraded'
   *   - open    -> 'failed'
   *
   * Pure. No side effects. When the breaker is undefined (no SAFE-05
   * wiring), the surface is treated as 'ok' so a downgraded boot path
   * still produces a sane initial status broadcast.
   */
  function bucketCircuitHealth(
    breaker: CircuitBreaker | undefined,
  ): "ok" | "degraded" | "failed" {
    if (breaker === undefined) return "ok";
    const status = breaker.status();
    if (status.state === "open") return "failed";
    if (status.state === "half-open") return "degraded";
    if (status.consecutiveFailures > 0) return "degraded";
    return "ok";
  }

  /**
   * Compose the per-surface health snapshot + broadcast it to the
   * renderer via IPC_INCIDENT_STATUS. The renderer mirrors the
   * snapshot into its IncidentStatus dot. Idempotent at the IPC layer
   * — the renderer dedupes identical consecutive payloads if it
   * chooses; main does not bother because the volume is bounded by
   * circuit-breaker state transitions (rare).
   */
  function broadcastIncidentStatus(): void {
    const sttHealth = bucketCircuitHealth(deps.sttCircuit);
    const ttsHealth = bucketCircuitHealth(deps.ttsCircuit);
    deps.sendIpc(IPC_INCIDENT_STATUS, { sttHealth, ttsHealth });
  }

  /**
   * CR-01 helper: ensure the orchestrator has transitioned
   * processing → speaking AND gated the mic before TTS playback begins
   * for this turn. Both the happy-path ack branch and the defensive
   * process_exit branch route through this so the half-duplex contract
   * is honoured even when the ack is missing / malformed.
   *
   * WR-09: when `failureReason` is supplied, dispatch the dedicated
   * CLAUDE_FAILURE_OVERRIDE tag instead of CLAUDE_RESULT_READY. The
   * reducer treats both identically at the state-transition layer
   * (processing → speaking) but the distinct tag lets downstream
   * loggers / future hardening attribute the speaking transition to
   * a failure-override path rather than the LLM's ack body. Without
   * this dispatch the CLAUDE_FAILURE_OVERRIDE tag was never used in
   * production code and the reducer's distinction was meaningless at
   * runtime.
   *
   * Idempotent — repeated calls within a single turn are no-ops.
   */
  function enterSpeakingForTurn(failureReason?: string): void {
    if (speakingEnteredForTurn) return;
    if (mirroredState === "speaking") {
      speakingEnteredForTurn = true;
      return;
    }
    speakingEnteredForTurn = true;
    deps.micCapture.pauseFrameDelivery();
    if (failureReason !== undefined) {
      dispatch({
        type: "CLAUDE_FAILURE_OVERRIDE",
        reason: failureReason,
      });
    } else {
      dispatch({ type: "CLAUDE_RESULT_READY" });
    }
  }

  function buildFailureSummary(outcome: ClaudeOutcome): string {
    if (outcome.kind !== "failure") {
      // Defensive — callers must check first.
      return FAILURE_OVERRIDE_PREFIX;
    }
    // Human-readable, deterministic reason format. Mirrored by SE6/SE7.
    // The reason vocabulary is closed (exit_code | tool_error |
    // cancelled), so we can keep this a fixed switch.
    if (outcome.reason === "exit_code") {
      const code =
        outcome.exitCode === null || outcome.exitCode === undefined
          ? "unknown"
          : String(outcome.exitCode);
      return `${FAILURE_OVERRIDE_PREFIX} exit_code: ${code}`;
    }
    if (outcome.reason === "tool_error") {
      // Drop the bridge's details body — the tool_use_ids do not belong
      // in a spoken summary. The locked human-facing string is just
      // "tool_error".
      return `${FAILURE_OVERRIDE_PREFIX} tool_error`;
    }
    if (outcome.reason === "cancelled") {
      return `${FAILURE_OVERRIDE_PREFIX} cancelled`;
    }
    return FAILURE_OVERRIDE_PREFIX;
  }

  /**
   * Open the TTS stream lazily on the first ack emission, fan out the
   * orchestrator's TTS consumer that broadcasts each chunk via
   * IPC_TTS_CHUNK to the renderer playback-queue.
   *
   * Plan 14-03 SAFE-05 — when deps.ttsCircuit is supplied, the
   * tts.open() call is routed through `ttsCircuit.attempt(...)`. On
   * exhausted=true the orchestrator broadcasts IPC_INCIDENT_TTS_FAIL
   * carrying the cached spoken-summary text + the classified kind, AND
   * throws so the caller observes the failure on the same path the
   * pre-14-03 catch handled. The breaker also re-broadcasts the
   * composed IncidentStatus snapshot so the renderer's dot tracks the
   * state change.
   */
  async function openTtsClient(): Promise<OrchestratorTtsClient> {
    if (currentTtsClient !== null) return currentTtsClient;
    const tts = deps.ttsFactory({ voiceId: deps.voiceId });
    // WR-04: do NOT assign currentTtsClient until open() succeeds.
    // Previously the orchestrator set currentTtsClient BEFORE await
    // tts.open(); on a failed open the failed handle stayed
    // referenced AND ttsOpenedForTurn stayed false, so dispose()'s
    // guard `currentTtsClient !== null && ttsOpenedForTurn` skipped
    // close() and the underlying WebSocket / pending fetch leaked.
    try {
      if (deps.ttsCircuit !== undefined) {
        const outcome = await deps.ttsCircuit.attempt(() => tts.open());
        if ("error" in outcome) {
          if (outcome.exhausted) {
            // Broadcast the incident BEFORE the throw so the renderer
            // surfaces the affordance even if the catch below logs the
            // failure and best-effort-closes the handle.
            const kind: ClassifiedErrorKind = outcome.error.kind;
            // CR-04 fix: prefer the current turn's cached summary, but
            // fall back to the LAST successfully completed summary when
            // the current turn cleared it (e.g. circuit opens during the
            // ack path before the summary is computed). PITFALLS #18:
            // "cache MOST RECENT completion text locally so the user can
            // re-read it if TTS dropped".
            const fallbackSummary =
              cachedSummaryText.length > 0
                ? cachedSummaryText
                : lastSuccessfulSummary;
            deps.sendIpc(IPC_INCIDENT_TTS_FAIL, {
              kind,
              summaryText: fallbackSummary,
              attemptCount: outcome.attemptCount,
            });
            broadcastIncidentStatus();
          }
          // Always re-throw so the original failure path (the
          // try/catch below) does its best-effort close + log.
          throw outcome.error.cause ?? new Error(`tts ${outcome.error.kind}`);
        }
      } else {
        await tts.open();
      }
    } catch (err) {
      log(
        `[achilles] tts open failed: ${(err as Error).message}`,
      );
      // Best-effort close of the unopened handle so the factory's
      // internal resources do not leak.
      try {
        const closed = tts.close();
        if (closed instanceof Promise) {
          closed.catch(() => undefined);
        }
      } catch {
        // best-effort
      }
      throw err;
    }
    // Plan 14-01: stamp the LOOP-06 'tts_first_chunk' stage the moment
    // the TTS stream is ready to accept appendText. The actual first
    // chunk is fanned out later in the consumer loop below; for the
    // CONTEXT.md stage taxonomy this is the documented anchor for "the
    // TTS pipeline is connected and ready".
    deps.latencyProbe?.recordStage("tts_first_chunk");
    currentTtsClient = tts;
    ttsOpenedForTurn = true;
    // Spawn the chunk-fanout consumer. We do NOT await it — the
    // consumer runs until the TTS client signals 'complete' or close().
    // Errors are swallowed at the boundary so a misbehaving TTS client
    // does not crash the orchestrator; they surface via the [achilles]
    // log line.
    void (async (): Promise<void> => {
      try {
        // Plan 14-01: first-chunk guard. The LOOP-06 metric anchor is
        // the moment the FIRST audible byte leaves main via IPC; we
        // stamp 'tts_playback_start' + finalizeSample exactly once
        // per turn (the consumer keeps running for subsequent chunks
        // + the 'complete' event but those do not re-stamp).
        let firstChunkFanned = false;
        for await (const ev of tts.events$) {
          if (disposed) break;
          if (ev.type === "chunk") {
            deps.sendIpc(IPC_TTS_CHUNK, {
              seq: ev.chunk.seq,
              mime: ev.chunk.mime,
              bytes: ev.chunk.bytes,
              isFinal: ev.chunk.isFinal,
            });
            if (!firstChunkFanned) {
              firstChunkFanned = true;
              deps.latencyProbe?.recordStage("tts_playback_start");
              deps.latencyProbe?.finalizeSample();
            }
          }
          // 'complete' is observed but does NOT trigger the debounce —
          // the renderer's playback-queue is the authoritative source
          // for "the listener heard the last byte". We wait for
          // onTtsPlaybackComplete() to schedule the 300 ms tail.
        }
      } catch (err) {
        log(
          `[achilles] tts consumer error: ${(err as Error).message}`,
        );
      }
    })();
    return tts;
  }

  /**
   * Consume the bridge event stream for one utterance. Drives ack
   * extraction, spoken-summary extraction, outcome derivation, and TTS
   * routing. Returns when the bridge emits process_exit and the spoken
   * summary has been queued.
   *
   * Plan 14-04 SAFE-06: armForTurn at the start of the loop;
   * observeProgress on every progress event (assistant_text_delta /
   * tool_use / tool_result / session_init); clearForTurn on
   * process_exit so a turn that completes does not produce a stale
   * stuck-thinking announcement. The watchdog's onTimeout (wired at
   * createSession boundary) opens TTS + appendText
   * (STUCK_THINKING_ANNOUNCEMENT) + broadcasts
   * IPC_STUCK_THINKING_ANNOUNCE.
   */
  async function consumeClaudeEvents(
    session: ClaudeBridgeLike,
  ): Promise<void> {
    // Plan 14-04 SAFE-06: arm the watchdog at the start of each
    // utterance turn. The watchdog factory is idempotent on re-arm so
    // a leftover token from a prior cancelled turn is automatically
    // cleared.
    deps.stuckThinkingWatchdog?.armForTurn();
    for await (const ev of session.events$) {
      if (disposed) break;
      if (ev.type === "assistant_text_delta") {
        // Plan 14-04 SAFE-06: assistant_text_delta is the canonical
        // heartbeat path — every observed delta resets the watchdog.
        deps.stuckThinkingWatchdog?.observeProgress();
        accumulatedText += ev.text;
        // Try to emit the ack on every delta until we've succeeded.
        if (!ackEmitted) {
          const ack = extractAck(accumulatedText);
          if (ack !== null) {
            ackEmitted = true;
            // Plan 14-01: stamp 'claude_first_text_delta' the moment
            // we have a parseable ack — this is the LOOP-06 stage
            // anchor for "the bridge produced its first usable
            // assistant text". The probe ignores subsequent ack
            // attempts in the same turn (first-fire semantics).
            deps.latencyProbe?.recordStage("claude_first_text_delta");
            // Normalise + open + appendText + dispatch.
            const norm = normaliseForTts(ack);
            // Pre-open TTS for the turn so the spoken summary later
            // appends to the same stream.
            await openTtsClient();
            // The mic gate fires on the first ack — half-duplex
            // entry per PITFALLS #2. enterSpeakingForTurn() dispatches
            // CLAUDE_RESULT_READY (processing → speaking) AND pauses
            // the mic; CR-01 routes the same helper through the
            // process_exit branch for the null-ack path.
            enterSpeakingForTurn();
            currentTtsClient!.appendText(norm.normalised);
            log(
              `[achilles] tts normalisation report ack: ` +
                `ansi=${norm.report.ansi.count}, ` +
                `paths=${norm.report.paths.count}, ` +
                `secrets=${norm.report.secrets.count}, ` +
                `fences=${norm.report.fences.count}, ` +
                `truncated=${norm.report.truncated}`,
            );
          }
        }
      } else if (ev.type === "tool_use") {
        // Plan 14-04 SAFE-06: tool_use is a progress event — every
        // tool invocation resets the watchdog. The orchestrator does
        // not otherwise act on tool_use (we trust Claude Code to
        // decide tool routing); the heartbeat is the only side effect.
        deps.stuckThinkingWatchdog?.observeProgress();
      } else if (ev.type === "tool_result") {
        // Plan 14-04 SAFE-06: tool_result is also a progress event —
        // a tool returned, the watchdog resets. This runs ahead of
        // the is_error branch so even an errored tool_result counts
        // as progress.
        deps.stuckThinkingWatchdog?.observeProgress();
        if (ev.is_error === true) {
          // WR-01 side-channel: accumulate tool_use_ids so the
          // fallback deriveOutcome below sees the real tool-error
          // list when session.outcome is unexpectedly null. The
          // accumulator is scoped to this turn via resetTurnLocals().
          observedToolErrors.push(ev.tool_use_id);
        }
      } else if (ev.type === "session_init") {
        // Plan 14-04 SAFE-06: session_init is a progress event — the
        // bridge has confirmed the child is alive and has a sid.
        deps.stuckThinkingWatchdog?.observeProgress();
        // Capture sessionId for the next turn's --resume.
        lastSessionId = ev.session_id;
      } else if (ev.type === "process_exit") {
        // Plan 14-01: stamp 'claude_assistant_done' as the bridge
        // signals the child has exited. The probe uses this to
        // measure the claude-side end-to-end portion of the LOOP-06
        // budget.
        deps.latencyProbe?.recordStage("claude_assistant_done");
        // Plan 14-04 SAFE-06: clear the watchdog at process_exit so
        // a turn that completes does NOT produce a spurious
        // stuck-thinking announcement after the fact. Idempotent —
        // if the timer already fired, clearForTurn is a no-op.
        deps.stuckThinkingWatchdog?.clearForTurn();
        // End of the bridge stream. session.outcome is now populated
        // (the bridge computes it synchronously inside the exit
        // listener). Determine the spoken summary body.
        //
        // WR-01: the fallback when session.outcome is null preserves
        // the side-channel toolErrors observed during the turn rather
        // than passing an empty array. A defective bridge that does
        // not populate outcome but DID emit tool_result.is_error events
        // would otherwise mask a real failure as success and route the
        // LLM's hallucinated success body verbatim (PITFALLS #17).
        const outcome = session.outcome ?? deriveOutcome({
          exitCode: ev.exit_code,
          toolErrors: observedToolErrors,
        });
        // Authoritative outcome path — PITFALLS #17 + PROMPT-05.
        let summaryBody: string;
        if (outcome.kind === "failure") {
          summaryBody = buildFailureSummary(outcome);
        } else {
          // WR-05: extract from the bridge's authoritative
          // lastTurnText rather than the orchestrator's local
          // accumulator. The bridge documents
          // `assistant_text_done.full_text` as the canonical
          // accumulated string and updates lastTurnText synchronously
          // before process_exit. The local accumulator could drift if
          // upstream drops / reorders deltas.
          const extracted = extractSpokenSummary(session.lastTurnText);
          if (extracted !== null && extracted.length > 0) {
            summaryBody = extracted;
          } else {
            // Fallback when markers absent: take the lastTurnText
            // capped at ~40 words. This guards against an LLM that
            // forgot the marker contract on a success run.
            summaryBody = capWords(session.lastTurnText, 40);
          }
        }
        const norm = normaliseForTts(summaryBody);
        // Plan 14-03 SAFE-05: cache the spoken-summary text BEFORE
        // the (potentially failing) openTtsClient call. When the TTS
        // circuit opens during the catch path, the
        // IPC_INCIDENT_TTS_FAIL payload carries this text so the
        // renderer can surface it visibly + the main process can
        // print it to the launching terminal's stderr (via the
        // index.ts sendIpc tap). PITFALLS #18 "cache most recent
        // completion text locally" invariant.
        cachedSummaryText = norm.normalised;
        // CR-04 fix: also retain the summary across turns so a subsequent
        // turn whose TTS circuit opens before its own summary is computed
        // can still surface the previous completion text. Updated only on
        // a successfully computed summary; survives resetTurnLocals().
        if (norm.normalised.length > 0) {
          lastSuccessfulSummary = norm.normalised;
        }
        // Plan 14-02 SAFE-02: persist the assistant summary body —
        // the post-normalisation, post-PROMPT-05-override text the
        // user actually hears. We use summaryBody (NOT norm.normalised)
        // because the user's transcript record should match the
        // semantic content of the turn, not the TTS-normalised body
        // with paths masked and ANSI stripped. The optional chain
        // collapses to a SYNC no-op when the store is undefined or
        // enabled=false (TS2 + TS10 invariant).
        deps.transcriptStore?.appendTurn({
          role: "assistant",
          text: summaryBody,
        });
        // Ensure TTS is open — defensive, since extractAck may have
        // missed the marker for a defective stream.
        await openTtsClient();
        // CR-01: synthesise the speaking transition if the ack path
        // never fired. Without this, state stays pinned in `processing`
        // forever and the mic gate is never engaged — the failure
        // summary then plays through TTS into a live mic (PITFALLS #2).
        // enterSpeakingForTurn() is idempotent so the happy-path ack
        // branch above is unaffected.
        //
        // WR-09: when outcome is failure, dispatch
        // CLAUDE_FAILURE_OVERRIDE so the reducer's distinction between
        // failure-driven and success-driven speaking is meaningful at
        // runtime. The dispatch happens ONLY here (not via the ack
        // branch above) because the ack branch fires before outcome
        // is known.
        if (outcome.kind === "failure") {
          enterSpeakingForTurn(outcome.reason ?? "unknown");
        } else {
          enterSpeakingForTurn();
        }
        currentTtsClient!.appendText(norm.normalised);
        log(
          `[achilles] tts normalisation report summary: ` +
            `outcome=${outcome.kind}` +
            (outcome.kind === "failure" && outcome.reason
              ? `/${outcome.reason}`
              : "") +
            `, ansi=${norm.report.ansi.count}, ` +
            `paths=${norm.report.paths.count}, ` +
            `secrets=${norm.report.secrets.count}, ` +
            `fences=${norm.report.fences.count}, ` +
            `truncated=${norm.report.truncated}`,
        );
        // Best-effort flush so the TTS stream completes its
        // synthesise + emit-final-chunk pipeline.
        try {
          await currentTtsClient!.flush();
        } catch (err) {
          log(
            `[achilles] tts flush failed: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Word-cap fallback used when extractSpokenSummary returns null/empty.
   * Splits on whitespace, takes the first `n` words, joins with a
   * single space.
   */
  function capWords(text: string, n: number): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= n) return text.trim();
    return words.slice(0, n).join(" ");
  }

  // ─── public surface ───────────────────────────────────────────────

  async function onHotkeyPress(): Promise<void> {
    if (disposed) return;
    const cur = deps.stateController.now();
    syncMirroredState(cur);
    // CONTEXT.md "During TTS: if user presses hotkey, treat as cancel".
    if (cur === "speaking" || cur === "processing") {
      onCancel();
      return;
    }
    if (cur !== "idle") {
      // Either listening (toggle commits the in-flight utterance) or
      // error (caller drives ERROR_DISMISS separately). Defer to the
      // reducer.
      const next = dispatch({ type: "HOTKEY_PRESS" });
      log(`[achilles] hotkey press: state=${next}`);
      return;
    }
    // idle → listening: mint token + broadcast.
    const next = dispatch({ type: "HOTKEY_PRESS" });
    log(`[achilles] hotkey press: state=${next}`);
    // Plan 14-03 SAFE-05: route the mintSttToken() call through the
    // STT circuit-breaker when configured. On exhausted=true the
    // orchestrator broadcasts IPC_INCIDENT_STT_FAIL + dispatches
    // INJECT_ERROR; the renderer's TypedFallback overlay mounts so
    // the user can continue by typing. When the breaker is undefined
    // (degraded boot / tests that do not exercise SAFE-05), the
    // legacy try/catch path is preserved bit-for-bit.
    if (deps.sttCircuit !== undefined) {
      const outcome = await deps.sttCircuit.attempt(() => deps.mintSttToken());
      if ("error" in outcome) {
        if (outcome.exhausted) {
          deps.sendIpc(IPC_INCIDENT_STT_FAIL, {
            kind: outcome.error.kind,
            attemptCount: outcome.attemptCount,
          });
          broadcastIncidentStatus();
          dispatch({ type: "INJECT_ERROR", kind: "unknown" });
          log(
            `[achilles] stt circuit open: kind=${outcome.error.kind}`,
          );
        } else {
          log(
            `[achilles] stt token mint failed: ` +
              `${(outcome.error.cause as Error | undefined)?.message ?? outcome.error.kind}`,
          );
        }
        return;
      }
      deps.sendIpc(IPC_STT_TOKEN, {
        token: outcome.result.token,
        expiresAt: outcome.result.expiresAt,
      });
      return;
    }
    try {
      const minted = await deps.mintSttToken();
      deps.sendIpc(IPC_STT_TOKEN, {
        token: minted.token,
        expiresAt: minted.expiresAt,
      });
    } catch (err) {
      log(
        `[achilles] stt token mint failed: ${(err as Error).message}`,
      );
      // The orchestrator does not rollback the state — the renderer
      // will surface an STT auth error path. Phase 14 owns the
      // graceful-degradation UX.
    }
  }

  /**
   * CR-02: stateless STT token refresh. The renderer's STT client
   * calls this when its single-use token expires or its WebSocket
   * reconnects mid-turn. The method mints a fresh token and broadcasts
   * IPC_STT_TOKEN; it does NOT touch the state machine. Calling
   * onHotkeyPress() here would dispatch HOTKEY_PRESS — driving
   * listening → processing on the half-committed path, OR triggering a
   * cancel from speaking — neither of which the renderer's refresh
   * code intends.
   *
   * Errors are logged; the renderer surfaces the user-facing STT auth
   * banner separately (Phase 14 graceful degradation).
   */
  async function requestSttToken(): Promise<void> {
    if (disposed) return;
    // Plan 14-03 SAFE-05: route the mintSttToken() call through the
    // STT circuit-breaker when configured. The refresh path is
    // identical to onHotkeyPress's mint path — same incident
    // broadcast, same status broadcast — except we do NOT dispatch
    // INJECT_ERROR because the refresh is a mid-turn token rotation
    // and the user-facing state should not flip to 'error' just
    // because a token refresh exhausted (the in-flight turn continues
    // until its own boundary fires).
    if (deps.sttCircuit !== undefined) {
      const outcome = await deps.sttCircuit.attempt(() => deps.mintSttToken());
      if ("error" in outcome) {
        if (outcome.exhausted) {
          deps.sendIpc(IPC_INCIDENT_STT_FAIL, {
            kind: outcome.error.kind,
            attemptCount: outcome.attemptCount,
          });
          broadcastIncidentStatus();
        }
        log(
          `[achilles] stt token refresh failed: kind=${outcome.error.kind}`,
        );
        return;
      }
      deps.sendIpc(IPC_STT_TOKEN, {
        token: outcome.result.token,
        expiresAt: outcome.result.expiresAt,
      });
      return;
    }
    try {
      const minted = await deps.mintSttToken();
      deps.sendIpc(IPC_STT_TOKEN, {
        token: minted.token,
        expiresAt: minted.expiresAt,
      });
    } catch (err) {
      log(
        `[achilles] stt token refresh failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Plan 14-03 SAFE-05 shared commit pipeline. Both onUtteranceCommit
   * (spoken path) AND handleTypedPrompt (typed-fallback path) route
   * through this helper so there is exactly ONE pipeline:
   *
   *   1. detectManipulationTokens (passive warn-only)
   *   2. wrapTranscript (SAFE-04 sandwich-defence wrap)
   *   3. transcriptStore.appendTurn (raw text, role=user)
   *   4. STT_COMMITTED dispatch
   *   5. claudeFactory + bridge.send (CR-04 wrapped)
   *   6. consumeClaudeEvents drain (consumer promise captured)
   *
   * The single-pipeline invariant is verified by SE20: the typed
   * prompt's bridge.send captured-payload starts with DELIM_START +
   * contains REMINDER_LINE — bit-for-bit identical to a spoken
   * utterance.
   */
  function commitText(rawText: string): void {
    // SAFE-04 sandwich-defence. Wrap BEFORE forwarding to the bridge.
    // The detector is the passive-observer warning path — log + warn
    // but do NOT silently strip (per CONTEXT.md + SAFE-04).
    const manipulation = detectManipulationTokens(rawText);
    if (manipulation.detected) {
      log(
        `[achilles] manipulation patterns detected: ` +
          `${manipulation.matchedPatterns.join(",")}`,
      );
    }
    let wrapped: string;
    try {
      wrapped = wrapTranscript(rawText);
    } catch (err) {
      log(
        `[achilles] sandwich-defence wrap failed: ${(err as Error).message}`,
      );
      // We do NOT forward an unwrapped transcript to the bridge.
      // Drive state back to idle so the user can retry.
      dispatch({ type: "CIRCLE_CLICK" });
      return;
    }
    // Plan 14-02 SAFE-02: persist the RAW user utterance (NOT the
    // sandwich-wrapped form) when the transcript store is configured
    // and enabled. The optional chain collapses to a SYNC no-op when
    // the store is undefined or enabled=false (verified structurally
    // by transcript-store.test.ts TS2 + TS10). We persist rawText
    // because the user wants their own words back when they re-open
    // their transcripts, not the DELIM_START / DELIM_END envelope.
    deps.transcriptStore?.appendTurn({
      role: "user",
      text: rawText,
    });
    // Drive the production STT_COMMITTED tag. The reducer's
    // STT_COMMITTED case ignores the event when state is not
    // `listening`, so the toggle-mode race path (state already
    // `processing`) is a no-op for the reducer — exactly the desired
    // semantics. We still dispatch so the event trace is uniform. For
    // the typed-prompt path, the renderer state may be 'idle' (the
    // user hit Enter without ever pressing the hotkey) — the reducer
    // ignores the tag in that case but the bridge send proceeds.
    dispatch({ type: "STT_COMMITTED", transcript: rawText });
    // CR-04: wrap bridge construction + send in try/catch so a
    // ClaudeVersionError (from the real createClaudeSession's
    // runVersionCheck) or an EPIPE-shaped exception (from child.stdin
    // after the child has already exited) does not pin state in
    // `processing`. On failure we surface a user-facing error via
    // INJECT_ERROR (drives the state machine to `error`) and log the
    // attribution. Without this wrap, the exception propagates up to
    // the IPC handler, which swallows it — and state is stuck.
    let bridge: ClaudeBridgeLike;
    try {
      bridge = deps.claudeFactory({
        systemPromptFile: deps.systemPromptFile,
        resumeSessionId: lastSessionId ?? undefined,
      });
    } catch (err) {
      log(
        `[achilles] bridge construction failed: ${(err as Error).message}`,
      );
      dispatch({ type: "INJECT_ERROR", kind: "unknown" });
      currentClaudeSession = null;
      return;
    }
    currentClaudeSession = bridge;
    try {
      bridge.send(wrapped);
    } catch (err) {
      log(
        `[achilles] bridge send failed: ${(err as Error).message}`,
      );
      // Close the bridge best-effort so the child process does not
      // linger.
      try {
        const closed = bridge.close();
        if (closed instanceof Promise) {
          closed.catch(() => undefined);
        }
      } catch {
        // best-effort
      }
      currentClaudeSession = null;
      dispatch({ type: "INJECT_ERROR", kind: "unknown" });
      return;
    }
    activeConsumerPromise = consumeClaudeEvents(bridge).catch((err) => {
      log(
        `[achilles] claude consumer error: ${(err as Error).message}`,
      );
    });
  }

  function onUtteranceCommit(payload: UtteranceCommitPayload): void {
    if (disposed) return;
    // CR-03 toggle-mode commit race: in toggle mode the user's second
    // hotkey press dispatches HOTKEY_PRESS (listening → processing) BEFORE
    // the renderer's IPC_UTTERANCE_COMMIT lands. Previously the guard
    // here was `mirroredState !== "listening"`, which silently dropped
    // the commit and the user's voice never reached Claude.
    //
    // Relax the guard to accept commits from BOTH `listening` AND
    // `processing`. The toggle-hotkey path has already advanced the
    // visible state but the commit is still in-flight, and the user
    // clearly intends to commit. From `speaking` / `idle` / `error` the
    // commit is still dropped — those states are out-of-band for a
    // valid utterance-commit IPC.
    if (mirroredState !== "listening" && mirroredState !== "processing") {
      log(
        `[achilles] dropping utterance-commit: state=${mirroredState}`,
      );
      return;
    }
    // Reset per-turn locals before we start.
    resetTurnLocals();
    accumulatedText = "";
    // Plan 14-01: anchor the LOOP-06 sample at the renderer's
    // committedAt epoch (the STT WebSocket's commit timestamp — the
    // documented "speech-end" boundary) and record the first stage
    // 'stt_committed' at the current nowImpl tick. markSpeechEnd
    // resets any prior in-flight slot so a cancelled previous turn
    // does not contaminate this sample.
    deps.latencyProbe?.markSpeechEnd(payload.committedAt, payload.id);
    deps.latencyProbe?.recordStage("stt_committed");
    commitText(payload.text);
  }

  /**
   * Plan 14-03 SAFE-05 — typed-fallback entry point. The renderer's
   * TypedFallback overlay calls bridge.sendTypedFallbackSubmit({text})
   * when STT is unavailable; the IPC handler in ipc-bridge.ts forwards
   * the text here. The implementation routes the text through the
   * SAME commitText helper as onUtteranceCommit — there is no parallel
   * code path. The latency probe (Plan 14-01) treats the typed prompt
   * as a zero-STT-cost utterance: markSpeechEnd is anchored at the
   * current nowImpl tick (the user has just pressed Enter so
   * speech_end ≡ commit) and stt_committed is recorded immediately
   * because there is no STT round-trip.
   *
   * The typed prompt is accepted regardless of state — the user's
   * STT is broken; refusing the prompt because the state machine
   * thinks we are still 'idle' would defeat the SAFE-05 contract.
   */
  function handleTypedPrompt(text: string): void {
    if (disposed) return;
    // Reset per-turn locals before we start so a stale prior turn
    // does not bleed into the typed-prompt cycle.
    resetTurnLocals();
    accumulatedText = "";
    // Plan 14-01: anchor the LOOP-06 sample at the current tick. The
    // typed prompt has no STT phase so speech_end ≡ commit; the
    // probe records both stages at the same tick. We synthesise a
    // utterance id from the wall-clock to keep the probe's per-
    // utterance correlation surface uniform.
    const nowMs = Date.now();
    const utteranceId = `typed-${nowMs}`;
    deps.latencyProbe?.markSpeechEnd(nowMs, utteranceId);
    deps.latencyProbe?.recordStage("stt_committed");
    commitText(text);
  }

  function onMicFrame(_payload: MicFramePayload): void {
    if (disposed) return;
    // Half-duplex: drop the frame when we are not actively listening.
    // WR-07: attribute the drop to the actual state so future debug
    // sessions see whether the gate is holding frames during
    // processing or speaking (or both).
    if (mirroredState === "speaking") {
      metrics.framesDroppedDuringSpeaking += 1;
      return;
    }
    if (mirroredState === "processing") {
      metrics.framesDroppedDuringProcessing += 1;
      return;
    }
    // Production path: the renderer's STT client writes the frame to
    // the ElevenLabs WebSocket directly (Phase 09 design); the main
    // process does NOT relay frames in the happy path. This channel
    // exists for the MOCK_LOOP=1 integration test which shares an
    // in-process composition, and for the Phase 14 diagnostic capture
    // gated behind --debug-audio. The orchestrator's purpose here is
    // the gating action; forwarding (or not) is a renderer concern.
  }

  function onTtsPlaybackComplete(): void {
    if (disposed) return;
    if (mirroredState !== "speaking") {
      // Stale event — the orchestrator may have cancelled between
      // last chunk and the renderer signalling.
      return;
    }
    // Plan 14-01: stamp 'tts_playback_complete' as a diagnostic
    // post-LOOP-06 stage. The sample for the current turn has
    // already been finalized on the first chunk (the LOOP-06 metric
    // anchor); this call records the trailing duration into the now-
    // empty in-flight slot, which the probe silently ignores. That
    // is intentional — the call is uniform across all six stages
    // and the probe's semantics handle the no-op cleanly.
    deps.latencyProbe?.recordStage("tts_playback_complete");
    clearDebounce();
    debounceToken = setT(() => {
      debounceToken = null;
      dispatch({ type: "TTS_PLAYBACK_DRAINED" });
      deps.micCapture.resumeFrameDelivery();
      log(`[achilles] half-duplex tail elapsed: state=${mirroredState}`);
      // Reset turn locals on success drain so the next utterance
      // starts clean. We deliberately reset AFTER the dispatch so
      // log lines that read state see the correct value.
      resetTurnLocals();
    }, SPEAKING_DEBOUNCE_MS);
  }

  function onCancel(): void {
    if (disposed) return;
    clearDebounce();
    if (currentClaudeSession !== null) {
      try {
        // Cancel returns a Promise but we deliberately do not await it
        // here — onCancel is a synchronous edge so the state machine
        // can advance immediately. The bridge's exit listener fires
        // asynchronously and the consumer loop terminates naturally.
        void currentClaudeSession.cancel();
      } catch (err) {
        log(
          `[achilles] claude cancel error: ${(err as Error).message}`,
        );
      }
    }
    if (currentTtsClient !== null) {
      try {
        const closed = currentTtsClient.close();
        if (closed instanceof Promise) {
          closed.catch((err) => {
            log(
              `[achilles] tts close error: ${(err as Error).message}`,
            );
          });
        }
      } catch (err) {
        log(
          `[achilles] tts close error: ${(err as Error).message}`,
        );
      }
    }
    // WR-06: apply the same SPEAKING_DEBOUNCE_MS half-duplex tail to
    // the cancel path. The renderer-side playback-queue is still
    // finishing the currently-playing chunk for ~50-150 ms after
    // close() returns; resuming the mic immediately would let it pick
    // up the cancellation tail (PITFALLS #2 echo loop). Push the mic
    // resume to the natural tail boundary, mirroring the success path.
    debounceToken = setT(() => {
      debounceToken = null;
      deps.micCapture.resumeFrameDelivery();
    }, SPEAKING_DEBOUNCE_MS);
    // CIRCLE_CLICK drives speaking → idle and processing → idle per the
    // Plan 11-01 reducer behaviour.
    dispatch({ type: "CIRCLE_CLICK" });
    log(`[achilles] cancel: state=${mirroredState}`);
    resetTurnLocals();
    currentClaudeSession = null;
    currentTtsClient = null;
  }

  /**
   * Plan 14-04 SAFE-06: OS suspend handler. See AchillesSession.onSuspend
   * docstring for the full contract; the implementation runs the
   * tear-down list (debounce, bridge cancel, TTS close, mic pause,
   * CIRCLE_CLICK dispatch) in the order documented there. Idempotent —
   * subsequent suspends from a stuck powerMonitor are safe because
   * each tear-down step guards on its own state.
   */
  function onSuspend(): void {
    if (disposed) return;
    clearDebounce();
    // Best-effort cancel the in-flight bridge. We do NOT throw because
    // the session is about to be suspended; a stuck bridge handle here
    // is exactly the case where we want to drop it on the floor.
    if (currentClaudeSession !== null) {
      try {
        void currentClaudeSession.cancel();
      } catch (err) {
        log(`[achilles] suspend bridge cancel error: ${(err as Error).message}`);
      }
    }
    // Close TTS so the AudioContext is released back to the OS during
    // suspend. The renderer's playback queue will see a closed stream
    // on resume; PITFALLS #25 calls this out explicitly.
    if (currentTtsClient !== null) {
      try {
        const closed = currentTtsClient.close();
        if (closed instanceof Promise) {
          closed.catch((err) => {
            log(`[achilles] suspend tts close error: ${(err as Error).message}`);
          });
        }
      } catch (err) {
        log(`[achilles] suspend tts close error: ${(err as Error).message}`);
      }
    }
    // Pause the renderer's mic worklet so any frames the OS flushes
    // through the suspend boundary are dropped.
    try {
      deps.micCapture.pauseFrameDelivery();
    } catch (err) {
      log(`[achilles] suspend mic pause error: ${(err as Error).message}`);
    }
    // CIRCLE_CLICK drives processing/speaking/listening → idle. The
    // reducer's CIRCLE_CLICK from idle would advance idle → listening
    // (the user-action pointer-click semantics), which is the WRONG
    // direction for suspend. Guard the dispatch on non-idle states so
    // the suspend path is a true no-op when already idle (SE28
    // invariant) and a tear-down driver when in listening / processing
    // / speaking (SE27 invariant).
    if (mirroredState !== "idle") {
      dispatch({ type: "CIRCLE_CLICK" });
    }
    log(`[achilles] suspend: state -> idle`);
    resetTurnLocals();
    currentClaudeSession = null;
    currentTtsClient = null;
  }

  /**
   * Plan 14-04 SAFE-06: OS resume handler. See AchillesSession.onResume
   * docstring for the full contract; the implementation only logs and
   * trusts the renderer-side device-change-handler to re-acquire the
   * mic stream when the OS reports the default device. The next
   * hotkey press starts a fresh utterance with the next --resume sid.
   */
  function onResume(): void {
    if (disposed) return;
    log(`[achilles] resume: ready for next utterance`);
    // WR-08 fix: trigger a defensive soft re-acquire so the renderer's
    // mic stream is refreshed even if the OS does not emit a
    // devicechange on resume (Linux/Pipewire does not guarantee one).
    // The orchestrator's onDeviceChange handler runs the
    // pauseFrameDelivery + setTimeout(resumeFrameDelivery, 0) sequence
    // uniformly; calling it here means the mic stream is never bound
    // to a stale audio device after a long suspend. onDeviceChange is
    // a no-op when mirroredState !== 'listening' so the resume path
    // from an idle state does not surface any spurious mic-gate
    // activity.
    onDeviceChange({ kind: "device-switch" });
  }

  /**
   * Plan 14-04 SAFE-06: device-change handler. See
   * AchillesSession.onDeviceChange docstring for the full contract;
   * the implementation logs the event + (when state === 'listening')
   * triggers a soft re-acquire via pauseFrameDelivery +
   * setTimeout(resumeFrameDelivery, 0). When the state is not
   * 'listening', the method is a no-op beyond the log — there is no
   * active capture to gate.
   */
  function onDeviceChange(event: {
    deviceId?: string;
    kind?: "hfp-downgrade" | "device-switch";
  }): void {
    if (disposed) return;
    const deviceId = event.deviceId ?? "unknown";
    const kind = event.kind ?? "device-switch";
    log(`[achilles] device change: deviceId=${deviceId} kind=${kind}`);
    if (mirroredState !== "listening") {
      // No active capture to soft-re-acquire — the device change will
      // be picked up by getUserMedia the next time the user presses
      // the hotkey.
      return;
    }
    // Soft re-acquire: pause the worklet, then resume on the next tick
    // so the renderer's worklet has a chance to detach + reattach.
    // We use the injected setTimeoutImpl so tests can drive the
    // re-acquire deterministically without vi.useFakeTimers.
    try {
      deps.micCapture.pauseFrameDelivery();
    } catch (err) {
      log(`[achilles] device change pause error: ${(err as Error).message}`);
    }
    setT(() => {
      if (disposed) return;
      try {
        deps.micCapture.resumeFrameDelivery();
      } catch (err) {
        log(`[achilles] device change resume error: ${(err as Error).message}`);
      }
    }, 0);
  }

  /**
   * Plan 14-04 SAFE-06: handle the stuck-thinking watchdog onTimeout
   * event. The dep-boundary wiring (index.ts) constructs the watchdog
   * with `onTimeout: ({waitedMs}) => session.announceStuckThinking(...)`
   * so the orchestrator owns the side effects (TTS append + IPC
   * broadcast) and the watchdog stays a pure timer module.
   *
   * Behaviour:
   *   - normalise STUCK_THINKING_ANNOUNCEMENT via normaliseForTts
   *     (PITFALLS #16 + #21 still apply — the announcement is short
   *     plaintext so the normaliser is largely a no-op, but we go
   *     through the same path uniformly)
   *   - open (or REUSE) the TTS stream and appendText(normalised);
   *     swallow any open() failure so the broadcast still fires
   *     (the renderer's TranscriptOverlay is the no-audio backstop)
   *   - broadcast IPC_STUCK_THINKING_ANNOUNCE so the renderer surfaces
   *     the text visibly
   *   - log the [achilles] line carrying waitedMs only — no transcript
   *     fragments
   *
   * The state machine does NOT transition (Claude is still working;
   * we are only narrating). The next progress event or process_exit
   * drives state transitions as normal. SE26 verifies no
   * CIRCLE_CLICK / HOTKEY_PRESS is dispatched as a side effect.
   */
  function announceStuckThinking(event: { waitedMs: number }): void {
    if (disposed) return;
    const norm = normaliseForTts(STUCK_THINKING_ANNOUNCEMENT);
    log(`[achilles] stuck-thinking announce: waitedMs=${event.waitedMs}`);
    // Open / reuse TTS — swallow failures so the IPC broadcast still
    // fires. The TTS path is best-effort here; the renderer's
    // TranscriptOverlay is the no-audio backstop.
    void (async (): Promise<void> => {
      try {
        const tts = await openTtsClient();
        tts.appendText(norm.normalised);
      } catch (err) {
        log(
          `[achilles] stuck-thinking tts append failed: ${(err as Error).message}`,
        );
      }
    })();
    // Broadcast the announcement to the renderer so the
    // TranscriptOverlay shows the same text visibly. The payload
    // carries the locked STUCK_THINKING_ANNOUNCEMENT constant — never
    // a transcript fragment (T-14-20 mitigation).
    deps.sendIpc(IPC_STUCK_THINKING_ANNOUNCE, {
      text: STUCK_THINKING_ANNOUNCEMENT,
      waitedMs: event.waitedMs,
    });
    // SE26: the state machine does NOT transition here. The orchestrator
    // must NOT dispatch CIRCLE_CLICK / HOTKEY_PRESS as a side effect
    // of the watchdog firing. The user must still press the hotkey to
    // cancel. This invariant is verified by SE26's spy assertion.
    //
    // WR-09 fix: re-arm the watchdog after firing so a Claude that
    // resumes work briefly then stalls again produces another
    // affordance. Without this re-arm the watchdog stayed dormant after
    // the first fire and a stuck Claude could run for 30+ minutes with
    // the user receiving exactly one 'still working' message. The
    // re-arm is also a no-op when the watchdog is disposed (SW7), so a
    // late-fire-during-teardown is safe.
    deps.stuckThinkingWatchdog?.armForTurn();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearDebounce();
    deps.stateController.cancelScheduledTransitions();
    if (currentClaudeSession !== null) {
      try {
        const closed = currentClaudeSession.close();
        if (closed instanceof Promise) {
          closed.catch(() => undefined);
        }
      } catch {
        // best-effort
      }
      currentClaudeSession = null;
    }
    if (currentTtsClient !== null && ttsOpenedForTurn) {
      try {
        const closed = currentTtsClient.close();
        if (closed instanceof Promise) {
          closed.catch(() => undefined);
        }
      } catch {
        // best-effort
      }
      currentTtsClient = null;
    }
  }

  // Reference the consumer promise to satisfy noUnusedLocals; it is
  // intentionally captured so dispose() COULD await it in a future
  // hardening pass without re-plumbing the state.
  void activeConsumerPromise;
  // Reference the lastSessionId reader to satisfy noUnusedLocals before
  // the next utterance's onUtteranceCommit reads it; the production
  // path uses it as resumeSessionId for the next bridge spawn.
  void lastSessionId;
  // Reference syncMirroredState for the controller-driven path; it is
  // invoked from onHotkeyPress and dispatch().
  void syncMirroredState;

  // Suppress unused locals on PermissionState; the type import is kept
  // for the AchillesSessionDeps documentation surface.
  void (null as unknown as PermissionState);
  // Suppress unused for ClaudeSession import; it documents the shape
  // the production claudeFactory satisfies (the orchestrator depends
  // on the narrower ClaudeBridgeLike but the comments reference the
  // full type).
  void (null as unknown as ClaudeSession | null);

  return {
    onHotkeyPress,
    requestSttToken,
    onUtteranceCommit,
    onMicFrame,
    onTtsPlaybackComplete,
    onCancel,
    dispose,
    handleTypedPrompt,
    announceStuckThinking,
    onSuspend,
    onResume,
    onDeviceChange,
    metrics,
  };
}
