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
  IPC_STT_TOKEN,
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
import {
  detectManipulationTokens,
  wrapTranscript,
} from "./sandwich-defence.js";
import { normaliseForTts } from "./normalisation.js";
import type { AchillesEvent } from "./state-machine.js";

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
 */
export interface AchillesSessionMetrics {
  /**
   * Number of mic frames the orchestrator dropped because the session
   * was in the speaking state. Useful for verifying the half-duplex
   * gate at runtime; SE9 asserts this increments under simulation.
   */
  framesDroppedDuringSpeaking: number;
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
  // Flag tracking whether the orchestrator opened TTS for this turn.
  // Used to gate the close() in onCancel + dispose().
  let ttsOpenedForTurn = false;
  // Pending consumer-loop promise per turn. Captured so the orchestrator
  // can detect a stale consumer when an utterance is cancelled.
  let activeConsumerPromise: Promise<void> | null = null;
  let disposed = false;
  // Mirror of the controller's current state — accessed in the hot
  // path of onMicFrame to gate frames without round-tripping through
  // controller.now() every frame. Updated on every dispatch.
  let mirroredState: AchillesState = "idle";

  const metrics: AchillesSessionMetrics = {
    framesDroppedDuringSpeaking: 0,
  };

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
  }

  /**
   * CR-01 helper: ensure the orchestrator has transitioned
   * processing → speaking AND gated the mic before TTS playback begins
   * for this turn. Both the happy-path ack branch and the defensive
   * process_exit branch route through this so the half-duplex contract
   * is honoured even when the ack is missing / malformed.
   *
   * Idempotent — repeated calls within a single turn are no-ops.
   */
  function enterSpeakingForTurn(): void {
    if (speakingEnteredForTurn) return;
    if (mirroredState === "speaking") {
      speakingEnteredForTurn = true;
      return;
    }
    speakingEnteredForTurn = true;
    deps.micCapture.pauseFrameDelivery();
    dispatch({ type: "CLAUDE_RESULT_READY" });
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
   */
  async function openTtsClient(): Promise<OrchestratorTtsClient> {
    if (currentTtsClient !== null) return currentTtsClient;
    const tts = deps.ttsFactory({ voiceId: deps.voiceId });
    currentTtsClient = tts;
    try {
      await tts.open();
    } catch (err) {
      log(
        `[achilles] tts open failed: ${(err as Error).message}`,
      );
      throw err;
    }
    ttsOpenedForTurn = true;
    // Spawn the chunk-fanout consumer. We do NOT await it — the
    // consumer runs until the TTS client signals 'complete' or close().
    // Errors are swallowed at the boundary so a misbehaving TTS client
    // does not crash the orchestrator; they surface via the [achilles]
    // log line.
    void (async (): Promise<void> => {
      try {
        for await (const ev of tts.events$) {
          if (disposed) break;
          if (ev.type === "chunk") {
            deps.sendIpc(IPC_TTS_CHUNK, {
              seq: ev.chunk.seq,
              mime: ev.chunk.mime,
              bytes: ev.chunk.bytes,
              isFinal: ev.chunk.isFinal,
            });
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
   */
  async function consumeClaudeEvents(
    session: ClaudeBridgeLike,
  ): Promise<void> {
    for await (const ev of session.events$) {
      if (disposed) break;
      if (ev.type === "assistant_text_delta") {
        accumulatedText += ev.text;
        // Try to emit the ack on every delta until we've succeeded.
        if (!ackEmitted) {
          const ack = extractAck(accumulatedText);
          if (ack !== null) {
            ackEmitted = true;
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
      } else if (ev.type === "session_init") {
        // Capture sessionId for the next turn's --resume.
        lastSessionId = ev.session_id;
      } else if (ev.type === "process_exit") {
        // End of the bridge stream. session.outcome is now populated
        // (the bridge computes it synchronously inside the exit
        // listener). Determine the spoken summary body.
        const outcome = session.outcome ?? deriveOutcome({
          exitCode: ev.exit_code,
          toolErrors: [],
        });
        // Authoritative outcome path — PITFALLS #17 + PROMPT-05.
        let summaryBody: string;
        if (outcome.kind === "failure") {
          summaryBody = buildFailureSummary(outcome);
        } else {
          const extracted = extractSpokenSummary(accumulatedText);
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
        // Ensure TTS is open — defensive, since extractAck may have
        // missed the marker for a defective stream.
        await openTtsClient();
        // CR-01: synthesise the speaking transition if the ack path
        // never fired. Without this, state stays pinned in `processing`
        // forever and the mic gate is never engaged — the failure
        // summary then plays through TTS into a live mic (PITFALLS #2).
        // enterSpeakingForTurn() is idempotent so the happy-path ack
        // branch above is unaffected.
        enterSpeakingForTurn();
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
    // SAFE-04 sandwich-defence. Wrap BEFORE forwarding to the bridge.
    // The detector is the passive-observer warning path — log + warn
    // but do NOT silently strip (per CONTEXT.md + SAFE-04).
    const manipulation = detectManipulationTokens(payload.text);
    if (manipulation.detected) {
      log(
        `[achilles] manipulation patterns detected: ` +
          `${manipulation.matchedPatterns.join(",")}`,
      );
    }
    let wrapped: string;
    try {
      wrapped = wrapTranscript(payload.text);
    } catch (err) {
      log(
        `[achilles] sandwich-defence wrap failed: ${(err as Error).message}`,
      );
      // We do NOT forward an unwrapped transcript to the bridge.
      // Drive state back to idle so the user can retry.
      dispatch({ type: "CIRCLE_CLICK" });
      return;
    }
    // Drive the production STT_COMMITTED tag. The reducer's
    // STT_COMMITTED case ignores the event when state is not
    // `listening`, so the toggle-mode race path (state already
    // `processing`) is a no-op for the reducer — exactly the desired
    // semantics. We still dispatch so the event trace is uniform.
    dispatch({ type: "STT_COMMITTED", transcript: payload.text });
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

  function onMicFrame(_payload: MicFramePayload): void {
    if (disposed) return;
    // Half-duplex: drop the frame when we are not actively listening.
    if (mirroredState === "speaking" || mirroredState === "processing") {
      metrics.framesDroppedDuringSpeaking += 1;
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
    deps.micCapture.resumeFrameDelivery();
    // CIRCLE_CLICK drives speaking → idle and processing → idle per the
    // Plan 11-01 reducer behaviour.
    dispatch({ type: "CIRCLE_CLICK" });
    log(`[achilles] cancel: state=${mirroredState}`);
    resetTurnLocals();
    currentClaudeSession = null;
    currentTtsClient = null;
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
    metrics,
  };
}
