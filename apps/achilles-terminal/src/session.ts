/**
 * Phase 17, Plan 04, Task 1 — Composition root + runVoice entry point.
 *
 * Replaces the Phase 16 stub at apps/achilles-terminal/src/session.ts
 * with the ported v1.2 orchestration. v1.2 source: apps/achilles/src/
 * main/session.ts (1820 LOC). The port:
 *
 *   - PRESERVES: class Session extends EventEmitter; the Phase 16
 *     SessionEvents back-compat channels (state-change, amplitude,
 *     rms-sample, error-message, transcript-partial); createSession
 *     factory; runVoice(argv) entry point.
 *   - REPLACES: the stub orchestration with the real wiring — mic-sox
 *     -> VAD -> stt-bridge -> claude-bridge -> tts-playback -> state
 *     machine.
 *   - STRIPS: every IPC envelope wrapper (broadcast, sendIpc, IPC_*
 *     constants). The v1.2 renderer/main boundary collapses to a
 *     single in-process EventEmitter fan-out using the
 *     session-events.ts SessionEvent discriminated union.
 *   - EXTENDS: SessionEvents with the new SessionEvent stream so
 *     Phase 16 useAchillesState consumers continue to work unchanged
 *     AND Phase 17 consumers can subscribe to the new typed channels.
 *
 * Invariants (Phase 17 ContextMD `<critical_invariants>`):
 *
 *   - LOOP-02: no modifications to packages/voice-*, packages/claude-
 *     code-bridge/, packages/achilles-skill/skill/prompts/companion.md.
 *     Runtime imports of those packages are PERMITTED in Phase 17 (the
 *     LOOP-02 rule applies to file modifications, not imports).
 *   - INIT-07: cli.ts top-level static imports stay { node:fs/promises,
 *     node:url, node:path }. session.ts owns all the heavy imports —
 *     commander, ink, react, voice packages — because session.ts is
 *     loaded lazily via `await import("./session.js")` from cli.ts.
 *   - LOOP-07: claude subprocess detached via { detached: true } in the
 *     Plan 03 claude-bridge spawn wrapper. Phase 17 wires it here.
 *
 * Half-duplex contract (LOOP-05 — load-bearing):
 *
 *   - On VAD speech_start: dispatch HOTKEY_PRESS (idle -> listening) +
 *     lazy-start sttBridge (mint token + open WSS).
 *   - On VAD speech_end: call sttBridge.commit() so Scribe flushes its
 *     buffer.
 *   - On real STT committed event: emit stt_committed SessionEvent +
 *     drive claudeBridge.send(rawTranscript). The sandwich-wrap happens
 *     INSIDE claude-bridge.ts (Plan 03).
 *   - On claude_ack: dispatch CLAUDE_RESULT_READY (processing ->
 *     speaking) + ttsPlayback.appendText(payload.text).
 *   - On claude_summary: ttsPlayback.appendText(payload.text).
 *   - On claude_done with outcome.kind === "success": no state
 *     transition needed (ttsPlayback's tts_drained event schedules the
 *     speaking-tail debounce).
 *   - On claude_failed: emit error event with classification
 *     "claude_failed"; the SPEAKING_DEBOUNCE_MS path still runs.
 *   - On tts_drained: schedule setTimeout(() => dispatch
 *     TTS_PLAYBACK_DRAINED + resetTurnLocals, SPEAKING_DEBOUNCE_MS) —
 *     the PLAY-02 half-duplex tail.
 *
 * Mic gating (WR-07): when state in {processing, speaking}, drop frames
 * at the mic source. The metrics object splits the drop counters by
 * state so debug sessions see whether the gate is holding frames
 * during processing or speaking (or both). Ported verbatim from v1.2
 * session.ts lines 222-241.
 *
 * No emojis (CLAUDE.md global). No application launches outside of
 * vitest.
 */
import { EventEmitter } from "node:events";
import { execSync, type spawn as spawnFn } from "node:child_process";

import {
  createSessionStateController,
  type MockStateController,
} from "./state/state-machine.js";
import type { AchillesState, HotkeyMode } from "./state/constants.js";
import { SPEAKING_DEBOUNCE_MS } from "./state/constants.js";
import { createMicSox, type MicSoxHandle } from "./audio/mic-sox.js";
import { createEnergyVad, type VadHandle } from "./audio/vad-energy.js";
import { createMockAmplitudeStream } from "./ui/mock-amplitude.js";
import { loadSettings, type AchillesSettings } from "./store-stub.js";

import {
  createTtsPlayback,
  type TtsPlaybackHandle,
  type CreateTtsPlaybackDeps,
} from "./audio/tts-playback.js";
import {
  createSttBridge,
  type SttBridgeHandle,
  type CreateSttBridgeDeps,
} from "./audio/stt-bridge.js";
import {
  createClaudeBridge,
  type ClaudeBridgeHandle,
  type CreateClaudeBridgeDeps,
  FAILURE_OVERRIDE_PHRASE,
} from "./audio/claude-bridge.js";
import { resolveCompanionPromptPath } from "./audio/companion-md.js";
import {
  createCircuitBreaker,
  type CircuitBreaker,
} from "./circuit-breaker.js";
import {
  createStructuredLogger,
  type StructuredLogger,
} from "./structured-logger.js";
import {
  createStuckThinkingWatchdog,
  STUCK_THINKING_ANNOUNCEMENT,
  type StuckThinkingWatchdog,
} from "./stuck-thinking-watchdog.js";
import type { SessionEvent } from "./session-events.js";

// Type-only imports from the voice packages so type-checking is honest
// without forcing the static-loader to pre-resolve every dependency
// at import-time of session.ts. The values themselves are loaded
// lazily inside runVoice() via `await import` so the
// `import("./session.js")` gate in cli.ts only resolves these packages
// when the user actually invokes the voice subcommand.
import type {
  RealtimeSttClient,
  CreateRealtimeSttClientOptions,
} from "@achilles/voice-stt";
import type {
  TtsStreamClient,
  CreateTtsStreamClientOptions,
} from "@achilles/voice-tts";

/**
 * Event channels the Session fans out to the React UI tier (Phase 16
 * Plan 04 useAchillesState hooks). Phase 17 PRESERVES these for
 * back-compat AND adds the SessionEvent fanout below via the
 * type-erased "any" channel for the discriminated-union variants.
 *
 * The Phase 16 channels stay because Phase 16's tests assert their
 * exact emission patterns (T2-T9 in tests/session.test.ts).
 */
export interface SessionEvents {
  "state-change": [AchillesState];
  "transcript-partial": [string];
  amplitude: [number];
  "rms-sample": [number];
  "error-message": [string];
}

/**
 * Factory shape for the STT client. Production wires
 * `createRealtimeSttClient` from @achilles/voice-stt; tests inject a
 * MOCK_LOOP fake. The factory accepts the subset of options the bridge
 * surface forwards (getToken + webSocketCtor) and returns a
 * RealtimeSttClient.
 *
 * @public
 */
export type SttFactory = (
  opts: Pick<CreateRealtimeSttClientOptions, "getToken" | "webSocketCtor">,
) => RealtimeSttClient;

/**
 * Factory shape for the TTS client. Production wires
 * `createTtsStreamClient` from @achilles/voice-tts; tests inject a
 * MOCK_LOOP fake. The factory receives a voiceId + keySource and
 * returns a TtsStreamClient.
 *
 * @public
 */
export type TtsFactory = (opts: { voiceId: string }) => TtsStreamClient;

/**
 * Factory shape for the claude-bridge handle. Production wires
 * `createClaudeBridge` from ./audio/claude-bridge.js (which itself
 * delegates to @achilles/claude-code-bridge.createClaudeSession);
 * tests inject a MOCK_LOOP fake.
 *
 * @public
 */
export type ClaudeBridgeFactory = (
  deps: CreateClaudeBridgeDeps,
) => ClaudeBridgeHandle;

/**
 * Construction options for the Session composition root.
 *
 * The Phase 16 fields (mock, debugVad, settings, spawnImpl, mockSeed,
 * vadOverride) are preserved BYTE-FOR-BYTE so the Phase 16
 * tests/session.test.ts T1-T10 surface keeps passing unchanged.
 *
 * Phase 17 NEW fields:
 *
 *   sttFactory / ttsFactory / claudeBridgeFactory — DI seams for the
 *     voice loop. Production wires the real factories from the voice
 *     packages; MOCK_LOOP=1 tests inject deterministic fakes.
 *   apiKey — the ElevenLabs API key resolved at runVoice() entry from
 *     process.env.ELEVENLABS_API_KEY. Production callers leave
 *     undefined; runVoice() reads the env var. Tests pass a fixed
 *     string.
 *   voiceId — the ElevenLabs voice id. Defaults to
 *     process.env.ELEVENLABS_VOICE_ID with the v1.2 fallback string.
 *   resume — optional --resume sid hydrating prior session state.
 *   debug — the --debug flag enabling verbose latency-probe + line-
 *     trace logging.
 *   mockLoop — the MOCK_LOOP=1 boolean read by Plan 05's integration
 *     test. When true, the factories MUST be supplied (production
 *     factories are not auto-loaded under MOCK_LOOP).
 *   companionPromptFile — resolved companion.md path. Production
 *     callers leave undefined (resolveCompanionPromptPath() runs at
 *     constructor entry); tests inject a mock path.
 *   logger / latencyProbe — optional structured logger / probe
 *     handles. Defaults to a no-op-equivalent created at constructor
 *     entry.
 *
 * @public
 */
export interface SessionOptions {
  /** Phase 16 — render the TUI with a deterministic mock amplitude stream. */
  mock?: boolean;
  /** Phase 16 — stream per-frame VAD snapshots to stderr as JSON lines. */
  debugVad?: boolean;
  /** Phase 16 — settings loader override (test seam). */
  settings?: AchillesSettings;
  /** Phase 16 — deterministic spawn seam for vitest. */
  spawnImpl?: typeof spawnFn;
  /** Phase 16 — seed for the mock-amplitude PRNG when mock === true. */
  mockSeed?: number;
  /** Phase 16 — deterministic VAD injection seam for vitest. */
  vadOverride?: VadHandle;
  /** Phase 17 — STT realtime client factory. */
  sttFactory?: SttFactory;
  /** Phase 17 — TTS stream client factory. */
  ttsFactory?: TtsFactory;
  /** Phase 17 — claude-bridge handle factory. */
  claudeBridgeFactory?: ClaudeBridgeFactory;
  /** Phase 17 — ElevenLabs API key. */
  apiKey?: string;
  /** Phase 17 — ElevenLabs voice id. */
  voiceId?: string;
  /** Phase 17 — optional --resume sid hydrating prior state. */
  resume?: string;
  /** Phase 17 — --debug flag toggle. */
  debug?: boolean;
  /** Phase 17 — MOCK_LOOP=1 toggle for Plan 05's integration test. */
  mockLoop?: boolean;
  /** Phase 17 — resolved companion.md path (test seam). */
  companionPromptFile?: string;
  /** Phase 17 — structured logger handle. */
  logger?: StructuredLogger;
  /** Phase 17 — STT circuit breaker handle. */
  sttCircuit?: CircuitBreaker;
  /** Phase 17 — TTS circuit breaker handle. */
  ttsCircuit?: CircuitBreaker;
  /** Phase 17 — stuck-thinking watchdog handle. */
  stuckWatchdog?: StuckThinkingWatchdog;
}

/**
 * Per-utterance metrics surfaced on the Session handle. Ports v1.2
 * AchillesSessionMetrics WR-07 split-counter shape verbatim.
 *
 * @public
 */
export interface SessionMetrics {
  framesDroppedDuringSpeaking: number;
  framesDroppedDuringProcessing: number;
  readonly framesDroppedDuringHalfDuplexGate: number;
}

/**
 * Composition root. Extends EventEmitter so the React tier can
 * subscribe via the useAchillesState / useAmplitude / useRingBuffer
 * hooks (Phase 16 src/ui/useAchillesState.ts).
 *
 * Phase 17 EXTENDS the emitter with the SessionEvent discriminated
 * union — every Wave 2 module emits SessionEvent variants via the
 * shared deps.emit callback, which forwards to `this.emit("event",
 * sessionEvent)`. UI consumers subscribe to either the legacy Phase
 * 16 channels OR the new "event" channel; both fire from the same
 * code paths.
 *
 * @public
 */
export class Session extends EventEmitter {
  // Phase 16 fields preserved verbatim.
  private state: AchillesState = "idle";
  private amplitude = 0;
  private readonly ring: Float32Array = new Float32Array(80);
  private writeIndex = 0;
  private ringSnapshot: { ring: Float32Array; writeIndex: number };
  private readonly controller: MockStateController;
  private readonly vad: VadHandle;
  private micSox: MicSoxHandle | undefined;
  private mockStream: { stop: () => void } | undefined;
  private readonly debugVad: boolean;
  private lastFrameTime = 0;
  private readonly opts: SessionOptions;

  // Phase 17 NEW fields.
  /**
   * Per-instance handles wired up by start() when the production
   * factories are supplied (or MOCK_LOOP=1 + injected factories). When
   * the factories are absent (Phase 16 back-compat path), these stay
   * null and the Session behaves identically to its Phase 16 stub.
   */
  public sttBridge: SttBridgeHandle | null = null;
  public ttsPlayback: TtsPlaybackHandle | null = null;
  public claudeBridge: ClaudeBridgeHandle | null = null;
  /** STT circuit breaker (Phase 17 SAFE-05). */
  public readonly sttCircuit: CircuitBreaker;
  /** TTS circuit breaker (Phase 17 SAFE-05). */
  public readonly ttsCircuit: CircuitBreaker;
  /** Structured logger handle (ERR-08; always-on). */
  public readonly logger: StructuredLogger;
  /** Stuck-thinking watchdog handle (ERR-05). */
  public readonly stuckWatchdog: StuckThinkingWatchdog;
  /** Set by gracefulShutdown to block new state transitions. */
  public shuttingDown = false;
  /** SPEAKING_DEBOUNCE_MS tail timer token. */
  private speakingTailToken: ReturnType<typeof setTimeout> | null = null;
  /** Per-utterance metrics. */
  public readonly metrics: SessionMetrics;
  /** Resolved companion.md path. */
  private readonly companionPromptFile: string;

  constructor(opts: SessionOptions = {}) {
    super();
    this.opts = opts;
    this.debugVad = opts.debugVad ?? false;
    this.ringSnapshot = { ring: this.ring, writeIndex: 0 };

    const settings: AchillesSettings = opts.settings ?? loadSettings();

    this.controller = createSessionStateController({
      broadcast: (s: AchillesState) => {
        this.state = s;
        this.emit("state-change", s);
        // Phase 17 — also emit a typed SessionEvent so Wave 2
        // consumers (e.g. latency-probe finalizers, structured
        // logger) can subscribe to a single channel.
        const ev: SessionEvent = {
          type: "state_change",
          payload: { state: s },
          timestamp: Date.now(),
        };
        this.emit("event", ev);
      },
      getMode: (): HotkeyMode => "toggle",
    });

    this.vad = opts.vadOverride ?? createEnergyVad(settings.vad);

    // Phase 17 — initialise the always-on structured logger.
    // Constructor invocation lazily creates ~/.achilles/ on first
    // write (idempotent mkdirSync 0o700). The handle is shared with
    // every Wave 2 module via its logger? dep.
    this.logger = opts.logger ?? createStructuredLogger({});

    // Phase 17 — initialise the two circuit breakers. Defaults follow
    // CONTEXT.md row "Circuit breaker (ERR-02)" — 3 failures in 30s
    // open the breaker; 60s cooldown.
    this.sttCircuit =
      opts.sttCircuit ?? createCircuitBreaker({ label: "stt" });
    this.ttsCircuit =
      opts.ttsCircuit ?? createCircuitBreaker({ label: "tts" });

    // Phase 17 — initialise the stuck-thinking watchdog. The onTimeout
    // callback routes the locked announcement through TTS appendText
    // AND emits an error SessionEvent so the UI status row can
    // surface the "Claude is still working" affordance.
    this.stuckWatchdog =
      opts.stuckWatchdog ??
      createStuckThinkingWatchdog({
        onTimeout: (event) => {
          this.handleStuckThinking(event.waitedMs);
        },
        logger: (msg) => {
          this.logger.warn("stuck_thinking_timer", { msg });
        },
      });

    // Phase 17 — resolve the companion.md path. Tests pass a mock
    // path so the claude-bridge factory never reads the on-disk
    // skill bundle.
    this.companionPromptFile =
      opts.companionPromptFile ?? resolveCompanionPromptPath();

    // Phase 17 — initialise the WR-07 metrics object.
    this.metrics = {
      framesDroppedDuringSpeaking: 0,
      framesDroppedDuringProcessing: 0,
      get framesDroppedDuringHalfDuplexGate(): number {
        return (
          this.framesDroppedDuringSpeaking + this.framesDroppedDuringProcessing
        );
      },
    } as SessionMetrics;
  }

  get currentState(): AchillesState {
    return this.state;
  }

  get currentAmplitude(): number {
    return this.amplitude;
  }

  get currentRingBuffer(): { ring: Float32Array; writeIndex: number } {
    return this.ringSnapshot;
  }

  /**
   * Begin the mic source. In --mock mode, starts the deterministic
   * mock-amplitude stream from Phase 16's createMockAmplitudeStream.
   * In real mode, spawns sox via Phase 16's createMicSox AND wires the
   * Phase 17 audio bridges (stt-bridge, tts-playback, claude-bridge)
   * when their factories are supplied via SessionOptions.
   */
  start(): void {
    if (this.opts.mock) {
      this.mockStream = createMockAmplitudeStream({
        seed: this.opts.mockSeed ?? 42,
        onFrame: (amp: number) => {
          this.handleMockFrame(amp);
        },
        intervalMs: 20,
      });
      this.wireAudioBridges();
      return;
    }
    // Production: spawn sox via Phase 16 wrapper.
    const micOpts: Parameters<typeof createMicSox>[0] = {
      onFrame: (frame: Int16Array) => {
        this.handlePcmFrame(frame);
      },
      onExit: (code: number | null, stderr: string) => {
        this.handleSoxExit(code, stderr);
      },
    };
    if (this.opts.spawnImpl !== undefined) {
      micOpts.spawnImpl = this.opts.spawnImpl;
    }
    this.micSox = createMicSox(micOpts);
    this.wireAudioBridges();
  }

  /**
   * Wire the Phase 17 audio bridges if their factories are supplied.
   * The factories are optional — when omitted, the Session behaves
   * identically to its Phase 16 stub (the wireAudioBridges call is a
   * no-op). This lets Phase 16 tests continue to pass without
   * supplying the new DI seams.
   */
  private wireAudioBridges(): void {
    const emit = (ev: SessionEvent): void => {
      this.emit("event", ev);
      // Phase 16 back-compat fan-out — keep Phase 16 channels firing
      // alongside the new typed channel.
      if (ev.type === "stt_partial" || ev.type === "stt_committed") {
        this.emit("transcript-partial", ev.payload.text);
      } else if (ev.type === "error") {
        this.emit("error-message", ev.payload.message);
      }
    };

    // TTS playback bridge.
    if (this.opts.ttsFactory !== undefined) {
      const voiceId = this.opts.voiceId ?? this.resolveVoiceId();
      const ttsDeps: CreateTtsPlaybackDeps =
        this.opts.spawnImpl !== undefined
          ? {
              ttsFactory: this.opts.ttsFactory,
              voiceId,
              emit,
              logger: this.logger,
              circuitBreaker: this.ttsCircuit,
              spawnImpl: this.opts.spawnImpl,
            }
          : {
              ttsFactory: this.opts.ttsFactory,
              voiceId,
              emit,
              logger: this.logger,
              circuitBreaker: this.ttsCircuit,
            };
      this.ttsPlayback = createTtsPlayback(ttsDeps);
      // Start the playback handle in the background — the consumer
      // loop runs for the session's lifetime and emits tts_drained
      // when the iterator + child both signal.
      void this.ttsPlayback.start();
    }

    // STT realtime client bridge.
    if (this.opts.sttFactory !== undefined) {
      const apiKey = this.opts.apiKey ?? "";
      const sttDeps: CreateSttBridgeDeps = {
        sttFactory: this.opts.sttFactory,
        // mintToken: in v1.3 production wiring, the token mint happens
        // via @achilles/voice-stt/token-mint.mintSttToken with the
        // apiKey closure. The factory accepts the resolved getToken
        // callback (not the apiKey directly) so the bridge surface
        // stays narrow. For tests, the factory returns a stub client
        // whose start() is a no-op.
        mintToken: () => {
          // The api key is captured here in the closure — the bridge
          // calls mintToken on every reconnect; the resolved getToken
          // closure goes through the circuit breaker.
          return this.mintSttToken(apiKey);
        },
        emit,
        logger: this.logger,
        circuitBreaker: this.sttCircuit,
      };
      this.sttBridge = createSttBridge(sttDeps);
    }

    // Claude bridge. The deps interface declares spawnImpl +
    // resumeSessionId as readonly so we construct the object once
    // with every present field.
    if (this.opts.claudeBridgeFactory !== undefined) {
      const baseDeps: CreateClaudeBridgeDeps = {
        systemPromptFile: this.companionPromptFile,
        emit,
        logger: this.logger,
      };
      const withResume: CreateClaudeBridgeDeps =
        this.opts.resume !== undefined
          ? { ...baseDeps, resumeSessionId: this.opts.resume }
          : baseDeps;
      const claudeDeps: CreateClaudeBridgeDeps =
        this.opts.spawnImpl !== undefined
          ? {
              ...withResume,
              spawnImpl: this.opts.spawnImpl as never,
            }
          : withResume;
      this.claudeBridge = this.opts.claudeBridgeFactory(claudeDeps);
    }

    // Subscribe to the typed event channel so the orchestrator can
    // drive state transitions on the claude_* / tts_drained edges
    // emitted by the Wave 2 modules. Each handler is idempotent and
    // guarded by the current mirrored state.
    this.on("event", (ev: SessionEvent) => {
      this.handleSessionEvent(ev);
    });
  }

  /**
   * Mint an STT token via @achilles/voice-stt/token-mint. The api key
   * is captured in the closure ONCE at construction time; this method
   * is the only path the key reaches the network. The result is
   * compatible with the realtime client's getToken contract.
   *
   * When MOCK_LOOP=1 + a fake sttFactory is supplied, this method is
   * not called by the fake factory's getToken — the fake returns a
   * synthetic token directly.
   */
  private mintSttToken(apiKey: string): Promise<{
    token: string;
    expiresAt: string;
  }> {
    // The mint helper lives at @achilles/voice-stt/token-mint (a
    // separate exports subpath per SAFE-01). Lazy-import it so the
    // INIT-07 invariant stays honest — the import only resolves when
    // runVoice actually invokes the bridge.
    return (async () => {
      const { mintSttToken } = await import("@achilles/voice-stt/token-mint");
      return mintSttToken({ apiKey });
    })();
  }

  /**
   * Resolve the ElevenLabs voice id. Production reads
   * process.env.ELEVENLABS_VOICE_ID; tests pass voiceId directly.
   * The fallback "21m00Tcm4TlvDq8ikWAM" matches the v1.2 default
   * from apps/achilles/src/main/index.ts.
   */
  private resolveVoiceId(): string {
    return (
      process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"
    );
  }

  /**
   * Toggle mute substate. Dispatches MUTE_TOGGLE to the state machine
   * then propagates the resulting muted boolean to the VAD layer
   * (CAP-03).
   */
  toggleMute(): void {
    const next = this.controller.dispatch({ type: "MUTE_TOGGLE" });
    this.vad.setMuted(next === "muted");
  }

  /**
   * Tear down the mic source + Phase 17 audio bridges + any pending
   * state-machine timer. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.speakingTailToken !== null) {
      clearTimeout(this.speakingTailToken);
      this.speakingTailToken = null;
    }
    if (this.micSox !== undefined) {
      await this.micSox.stop();
      this.micSox = undefined;
    }
    if (this.mockStream !== undefined) {
      this.mockStream.stop();
      this.mockStream = undefined;
    }
    if (this.ttsPlayback !== null) {
      try {
        await this.ttsPlayback.dispose();
      } catch {
        // best-effort.
      }
    }
    if (this.sttBridge !== null) {
      try {
        await this.sttBridge.stop();
      } catch {
        // best-effort.
      }
    }
    if (this.claudeBridge !== null) {
      try {
        await this.claudeBridge.dispose();
      } catch {
        // best-effort.
      }
    }
    this.stuckWatchdog.dispose();
    this.controller.cancelScheduledTransitions();
  }

  /**
   * Mock-amplitude frame handler (--mock mode). The mock generator
   * emits an amplitude scalar directly (no PCM); we feed it AS the RMS
   * into the pipeline so the VAD can still fire speech_start on the
   * speech-window peaks (frames 0-29 of the 60-frame loop).
   *
   * Phase 17 EXTENDS the Phase 16 handler with the mic-gating metric
   * counters — frames dropped during processing/speaking are tracked
   * so debug sessions see whether the gate is holding.
   */
  private handleMockFrame(amplitude: number): void {
    // Mic gating — Phase 17 WR-07 metrics.
    if (this.state === "speaking") {
      this.metrics.framesDroppedDuringSpeaking += 1;
      return;
    }
    if (this.state === "processing") {
      this.metrics.framesDroppedDuringProcessing += 1;
      return;
    }
    this.amplitude = amplitude;
    this.emit("amplitude", amplitude);
    this.ring[this.writeIndex] = amplitude;
    this.writeIndex = (this.writeIndex + 1) % 80;
    this.ringSnapshot = { ring: this.ring, writeIndex: this.writeIndex };
    this.emit("rms-sample", amplitude);
    const event = this.vad.observe(amplitude, 20);
    if (this.debugVad) {
      const snap = this.vad.snapshot();
      const line = JSON.stringify({
        t: Date.now(),
        energy: snap.rms,
        noiseFloor: snap.noiseFloor,
        threshold: snap.threshold,
        state: snap.state,
        warmupRemaining: snap.warmupRemaining,
      });
      process.stderr.write(line + "\n");
    }
    if (event === "speech_start") {
      this.controller.dispatch({ type: "HOTKEY_PRESS" });
      void this.startSttForUtterance();
    } else if (event === "speech_end") {
      this.handleVadSpeechEnd();
    }
  }

  /**
   * Real-mode PCM frame handler. Computes the RMS of the 320-sample
   * Int16 frame and feeds it through the same VAD + state machine
   * pipeline as the mock-mode handler. Additionally forwards the raw
   * frame to the STT bridge so Scribe sees the audio.
   *
   * Phase 17 EXTENDS the Phase 16 handler with the mic-gating metric
   * counters + the sttBridge.write forward path.
   */
  private handlePcmFrame(frame: Int16Array): void {
    // Compute RMS normalized to [0, 1] from the s16 input.
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i] ?? 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / frame.length) / 32768;
    const now = Date.now();
    const dt = this.lastFrameTime === 0 ? 20 : now - this.lastFrameTime;
    this.lastFrameTime = now;
    // Mic gating — Phase 17 WR-07 metrics. We drop the frame BEFORE
    // any state observation so a frame held during speaking does not
    // contaminate the VAD's noise floor.
    if (this.state === "speaking") {
      this.metrics.framesDroppedDuringSpeaking += 1;
      return;
    }
    if (this.state === "processing") {
      this.metrics.framesDroppedDuringProcessing += 1;
      return;
    }
    this.amplitude = rms;
    this.emit("amplitude", rms);
    this.ring[this.writeIndex] = rms;
    this.writeIndex = (this.writeIndex + 1) % 80;
    this.ringSnapshot = { ring: this.ring, writeIndex: this.writeIndex };
    this.emit("rms-sample", rms);
    const event = this.vad.observe(rms, dt);
    if (this.debugVad) {
      const snap = this.vad.snapshot();
      const line = JSON.stringify({
        t: now,
        energy: snap.rms,
        noiseFloor: snap.noiseFloor,
        threshold: snap.threshold,
        state: snap.state,
        warmupRemaining: snap.warmupRemaining,
      });
      process.stderr.write(line + "\n");
    }
    // Forward to STT if active.
    if (this.sttBridge !== null && this.state === "listening") {
      this.sttBridge.write(frame);
    }
    if (event === "speech_start") {
      this.controller.dispatch({ type: "HOTKEY_PRESS" });
      void this.startSttForUtterance();
    } else if (event === "speech_end") {
      this.handleVadSpeechEnd();
    }
  }

  /**
   * Lazily start the STT bridge at the speech_start edge. Idempotent
   * — the bridge's own start() guards against double-start. Errors
   * surface via the SessionEvent error channel.
   */
  private async startSttForUtterance(): Promise<void> {
    if (this.sttBridge === null) return;
    try {
      await this.sttBridge.start();
      // Drive the events$ iterator in the background. The bridge
      // synchronously fans events out on emit() BEFORE yielding to
      // this loop, so we don't need to do anything inside it — we
      // just keep the consumer alive so the iterator doesn't stall.
      void (async () => {
        const events = this.sttBridge?.events$();
        if (events === undefined) return;
        for await (const ev of events) {
          // Drive claude.send on committed_transcript. The bridge
          // fans out stt_committed via emit() already; this is the
          // production wiring path.
          if (ev.type === "committed" && this.claudeBridge !== null) {
            void this.driveClaudeForUtterance(ev.text);
          }
        }
      })();
    } catch (err) {
      this.logger.error("stt_start_failed_session", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Handle the VAD speech_end edge. Calls sttBridge.commit() so the
   * server flushes its buffer; the state machine transition happens
   * later when the real STT committed_transcript event arrives.
   */
  private handleVadSpeechEnd(): void {
    if (this.sttBridge !== null) {
      this.sttBridge.commit();
    } else {
      // Mock path — dispatch STT_COMMITTED directly so the state
      // machine still advances when no STT bridge is wired (Phase 16
      // back-compat).
      this.controller.dispatch({ type: "STT_COMMITTED", transcript: "" });
    }
  }

  /**
   * Drive claudeBridge.send + consume for an utterance. The send
   * dispatches STT_COMMITTED (listening -> processing) BEFORE the
   * wrapped transcript hits the bridge so the state machine reflects
   * "we are processing" the instant the user finishes speaking.
   */
  private async driveClaudeForUtterance(transcript: string): Promise<void> {
    if (this.claudeBridge === null) return;
    // Dispatch the state-machine transition synchronously.
    this.controller.dispatch({ type: "STT_COMMITTED", transcript });
    try {
      this.stuckWatchdog.armForTurn();
      await this.claudeBridge.send(transcript);
      await this.claudeBridge.consume();
    } catch (err) {
      this.logger.error("claude_drive_failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      this.emit("event", {
        type: "error",
        payload: {
          classification: "claude_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      });
    } finally {
      this.stuckWatchdog.clearForTurn();
    }
  }

  /**
   * Phase 18 Plan 03 (ERR-04) public entry point for typed-input fallback.
   * Routes a typed transcript through the same pipeline as a voice
   * transcript (state-machine dispatch -> sandwich-wrap -> claudeBridge).
   * The typed-input fallback (src/typed-input.ts) calls this when the STT
   * circuit breaker is in "open" state so the typed input flows through
   * the same single-pipeline commit path SC-5 requires.
   *
   * @public
   */
  public async submitTranscript(text: string): Promise<void> {
    await this.driveClaudeForUtterance(text);
  }

  /**
   * Handle SessionEvent variants emitted by the Wave 2 modules. This
   * is the closed-loop that drives the state machine transitions
   * from the typed event stream.
   *
   * The handler is intentionally narrow — it only dispatches the
   * state-machine reducer actions that the orchestrator owns. The UI
   * tier subscribes separately to the same channel for display
   * purposes.
   */
  private handleSessionEvent(ev: SessionEvent): void {
    if (this.shuttingDown) return;
    // Heartbeat — every progress event re-arms the stuck-thinking
    // watchdog. Only the claude_* events qualify as progress.
    if (
      ev.type === "claude_ack" ||
      ev.type === "claude_partial" ||
      ev.type === "claude_summary"
    ) {
      this.stuckWatchdog.observeProgress();
    }
    if (ev.type === "claude_ack") {
      // First ack from the LLM — dispatch CLAUDE_RESULT_READY
      // (processing -> speaking) AND route the ack body through TTS.
      this.controller.dispatch({ type: "CLAUDE_RESULT_READY" });
      this.ttsPlayback?.appendText(ev.payload.text);
    } else if (ev.type === "claude_summary") {
      // Final spoken-summary body — append to TTS. The claude-bridge
      // already normalised the text through normaliseForTts.
      this.ttsPlayback?.appendText(ev.payload.text);
      this.ttsPlayback?.flush();
    } else if (ev.type === "claude_failed") {
      // Authoritative failure path — the bridge has classified this
      // as failure_override. The state machine has already moved to
      // speaking via the prior claude_ack OR will move here via the
      // claude_summary path. We dispatch the dedicated failure-
      // override tag so future hardening can attribute the speaking
      // transition to a failure-override path rather than the LLM's
      // ack body.
      if (this.state === "processing") {
        this.controller.dispatch({
          type: "CLAUDE_FAILURE_OVERRIDE",
          reason: ev.payload.reason,
        });
      }
    } else if (ev.type === "tts_drained") {
      // PLAY-02 half-duplex tail. Schedule SPEAKING_DEBOUNCE_MS
      // timer; on fire dispatch TTS_PLAYBACK_DRAINED. The timer is
      // captured so a cancel path can clear it.
      if (this.speakingTailToken !== null) {
        clearTimeout(this.speakingTailToken);
      }
      this.speakingTailToken = setTimeout(() => {
        this.speakingTailToken = null;
        this.controller.dispatch({ type: "TTS_PLAYBACK_DRAINED" });
      }, SPEAKING_DEBOUNCE_MS);
    } else if (ev.type === "error") {
      // Surface the error message on the Phase 16 channel for the UI
      // status row, but do NOT dispatch INJECT_ERROR on every error
      // event — many error events are transient (network blips) and
      // the circuit breaker handles the threshold logic. Only the
      // mic_unavailable / playback_lost classifications inject an
      // error state because those are unrecoverable without
      // operator intervention.
      if (
        ev.payload.classification === "mic_unavailable" ||
        ev.payload.classification === "playback_lost"
      ) {
        this.controller.dispatch({
          type: "INJECT_ERROR",
          kind: "mic_unavailable",
        });
      }
    }
  }

  /**
   * Handle a stuck-thinking timer fire. Routes the locked
   * announcement through TTS AND emits an error SessionEvent so the
   * UI status row surfaces the "Claude is still working" affordance.
   * The state machine does NOT transition — Claude is still working;
   * the user must still press Ctrl-C to cancel.
   */
  private handleStuckThinking(waitedMs: number): void {
    this.ttsPlayback?.appendText(STUCK_THINKING_ANNOUNCEMENT);
    this.emit("event", {
      type: "error",
      payload: {
        classification: "claude_failed",
        message: `stuck thinking: waitedMs=${String(waitedMs)}`,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * sox exit handler (Phase 16 Pitfall 7 — fail visibly). Preserved
   * verbatim from the Phase 16 stub; the Phase 17 child-exit-watchdog
   * (Plan 02 Task 2) extends this with bounded respawn at the
   * top-level wireAudioBridges path — but Phase 17 ships the
   * passive-listener variant as the back-compat baseline.
   */
  private handleSoxExit(code: number | null, stderr: string): void {
    if (code !== null && code !== 0) {
      let emulator = "unknown";
      try {
        emulator = execSync(`ps -p ${process.ppid} -o comm=`, {
          encoding: "utf8",
          timeout: 1000,
        }).trim();
      } catch {
        // Non-fatal — leave emulator as "unknown".
      }
      const hint =
        "achilles: sox exited (code " +
        String(code) +
        "). On macOS, grant Microphone access to your terminal (parent: " +
        emulator +
        "). Open System Settings > Privacy & Security > Microphone.\n" +
        stderr +
        "\n";
      process.stderr.write(hint);
      this.controller.dispatch({
        type: "INJECT_ERROR",
        kind: "mic_unavailable",
      });
      this.emit("error-message", hint);
    }
  }
}

/**
 * Factory matching the must_haves artifacts entry shape — production
 * callers prefer this over `new Session(...)` so future Phase 18+
 * changes stay encapsulated.
 *
 * @public
 */
export function createSession(opts: SessionOptions = {}): Session {
  return new Session(opts);
}

/**
 * Re-export the FAILURE_OVERRIDE_PHRASE constant from claude-bridge so
 * Phase 20 asciicasts can grep for the locked string at one canonical
 * site.
 *
 * @public
 */
export { FAILURE_OVERRIDE_PHRASE };

/**
 * Lazy-load the resume-session module. Returns the module exports
 * shape OR null when the module is not yet on disk (Phase 17 task
 * ordering: Task 3 ships resume-session.ts after Task 2's graceful-
 * shutdown.ts). The dynamic import uses a string variable expression
 * so the TypeScript compiler does NOT statically resolve the path
 * at compile time — the resolution happens at runtime when the
 * voice subcommand actually runs.
 *
 * @internal
 */
async function loadResumeSessionModule(): Promise<unknown | null> {
  try {
    // Computed specifier — TS treats this as `unknown` at compile
    // time so the missing module does not block typecheck.
    const specifier = "./resume-session.js";
    return (await import(specifier)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Resolve the production sttFactory by lazy-loading
 * @achilles/voice-stt. Returns a factory that accepts the bridge's
 * narrow option shape and constructs the real realtime client.
 *
 * @internal
 */
async function loadProdSttFactory(): Promise<SttFactory> {
  const { createRealtimeSttClient } = await import("@achilles/voice-stt");
  return (
    opts: Pick<CreateRealtimeSttClientOptions, "getToken" | "webSocketCtor">,
  ): RealtimeSttClient => createRealtimeSttClient(opts);
}

/**
 * Resolve the production ttsFactory by lazy-loading
 * @achilles/voice-tts. Returns a factory that accepts a voiceId +
 * keySource closure and constructs the real stream client. The
 * keySource closes over the apiKey captured at runVoice entry.
 *
 * @internal
 */
async function loadProdTtsFactory(apiKey: string): Promise<TtsFactory> {
  const { createTtsStreamClient } = await import("@achilles/voice-tts");
  return (opts: { voiceId: string }): TtsStreamClient => {
    const tttsOpts: CreateTtsStreamClientOptions = {
      voiceId: opts.voiceId,
      keySource: () => Promise.resolve(apiKey),
    };
    return createTtsStreamClient(tttsOpts);
  };
}

/**
 * Voice subcommand entry point invoked from cli.ts via dynamic
 * import.
 *
 *   `if (argv[0] === "voice") {
 *      const { runVoice } = await import("./session.js");
 *      await runVoice(argv.slice(1));
 *    }`
 *
 * The dynamic-import gate preserves the INIT-07 invariant: cli.ts
 * only loads node:fs/promises + node:url + node:path statically;
 * everything else (commander, ink, react, voice packages) loads
 * lazily inside this function. `achilles --version` never pays the
 * cost of loading any of those modules.
 *
 * Phase 17 EXTENDS the Phase 16 commander parser with --resume <sid>
 * and --debug flags AND wires the production audio bridges when the
 * api key is present (or skips them when --mock or --plain is set).
 *
 * @public
 */
export async function runVoice(argv: string[]): Promise<void> {
  // Lazy-load commander to keep cli.ts's static import budget at the
  // INIT-07 minimum.
  const { Command } = await import("commander");
  const program = new Command();
  program
    .command("voice", { isDefault: true })
    .option(
      "--mock",
      "render the TUI with a deterministic mock amplitude stream (no sox / mic)",
    )
    .option(
      "--debug-vad",
      "stream per-frame VAD snapshots to stderr as JSON lines",
    )
    .option(
      "--plain",
      "force ANSI-free plain-text fallback even on a TTY",
    )
    .option(
      "--resume <sid>",
      "resume prior session by sid; reads ~/.achilles/sessions/<sid>.json",
    )
    .option(
      "--debug",
      "enable verbose latency-probe + line-trace logging",
    )
    .option(
      "--save-transcripts",
      "opt in to JSONL transcript recording at ~/.achilles/transcripts/ (SAFE-02 default OFF; 7-regex redacted; 30-day retention)",
    )
    .action(
      async (opts: {
        mock?: boolean;
        debugVad?: boolean;
        plain?: boolean;
        resume?: string;
        debug?: boolean;
        saveTranscripts?: boolean;
      }) => {
        const usePlain = (opts.plain ?? false) || !process.stdout.isTTY;

        // Resolve the api key. In --mock mode the key is optional —
        // the mock factories synthesize tokens. In production mode
        // the key is required; missing surfaces as a fatal stderr
        // line so the user sees a real error.
        const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
        const isMock = opts.mock ?? false;

        if (!isMock && apiKey === "") {
          process.stderr.write(
            "achilles: ELEVENLABS_API_KEY is not set. " +
              "Set it in your environment or pass --mock for a dry-run.\n",
          );
          process.exit(1);
          return;
        }

        // Resolve --resume hydration. The resume-session module
        // (Plan 04 Task 3) reads ~/.achilles/sessions/<sid>.json and
        // returns the prior state for hydration into the new session.
        // The dynamic import is guarded so a Phase 16 mock-mode run
        // that omits --resume never resolves the resume-session
        // module (preserves the INIT-07 lazy-load contract).
        let resumeSid: string | undefined;
        if (opts.resume !== undefined) {
          try {
            const resumeMod = (await loadResumeSessionModule()) as {
              createResumeSession: () => {
                ensureHome: () => void;
                hydrateSession: (sid: string) => unknown | null;
              };
            } | null;
            if (resumeMod !== null) {
              const resume = resumeMod.createResumeSession();
              resume.ensureHome();
              const prior = resume.hydrateSession(opts.resume);
              if (prior !== null) {
                resumeSid = opts.resume;
              }
            }
          } catch {
            // resume-session.js may not exist yet in early task
            // ordering; silently ignore — the session will start
            // fresh without prior state.
          }
        }

        // Resolve the factories. MOCK_LOOP=1 callers (Plan 05's
        // integration test) inject factories via env-var coordination
        // through the createSession options — we don't read the env
        // var here because runVoice is the production entry point
        // and the test exercises the factory seam directly.
        const sessionOpts: SessionOptions = {
          mock: isMock,
          debugVad: opts.debugVad ?? false,
          apiKey,
          debug: opts.debug ?? false,
        };
        if (resumeSid !== undefined) {
          sessionOpts.resume = resumeSid;
        }
        if (!isMock) {
          // Production wiring — resolve the prod factories.
          try {
            const [sttF, ttsF] = await Promise.all([
              loadProdSttFactory(),
              loadProdTtsFactory(apiKey),
            ]);
            sessionOpts.sttFactory = sttF;
            sessionOpts.ttsFactory = ttsF;
            // Claude bridge factory is the local createClaudeBridge
            // which itself wraps createClaudeSession from the package.
            sessionOpts.claudeBridgeFactory = (deps) =>
              createClaudeBridge(deps);
          } catch (err) {
            process.stderr.write(
              `achilles: failed to load voice packages: ${
                err instanceof Error ? err.message : String(err)
              }\n`,
            );
            process.exit(1);
            return;
          }
        }

        const session = createSession(sessionOpts);
        session.start();

        // Phase 18 Plan 03 (SAFE-02) — opt-in JSONL transcripts.
        // INIT-07 preserved: dynamic-imported only when --save-transcripts
        // is set. The store applies the 7-regex DEFAULT_REDACT_PATTERNS to
        // every line and writes to ~/.achilles/transcripts/<sid>.jsonl at
        // 0o600. The dispose() registration into process.once("exit")
        // appends the session_end system entry and stacks with the
        // graceful-shutdown lock-file unlink (both are once-handlers and
        // do not race).
        let transcriptDispose: (() => void) | null = null;
        if (opts.saveTranscripts === true) {
          const { createTranscriptStore } = await import(
            "./transcripts/store.js"
          );
          const transcriptSid =
            resumeSid ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const transcriptStore = createTranscriptStore(transcriptSid);
          // Subscribe via the discriminated SessionEvent channel so we
          // capture committed user transcripts + claude ack + claude
          // spoken-summary at one canonical site.
          const onEvent = (ev: SessionEvent): void => {
            if (ev.type === "stt_committed") {
              transcriptStore.append({
                t: ev.timestamp,
                type: "user",
                text: ev.payload.text,
                session_id: transcriptSid,
              });
            } else if (ev.type === "claude_ack" || ev.type === "claude_summary") {
              transcriptStore.append({
                t: ev.timestamp,
                type: "assistant",
                text: ev.payload.text,
                session_id: transcriptSid,
              });
            }
          };
          session.on("event", onEvent);
          transcriptDispose = (): void => {
            session.off("event", onEvent);
            transcriptStore.dispose();
          };
          process.once("exit", () => {
            transcriptDispose?.();
          });
        }

        // Phase 18 Plan 03 (ERR-04) — typed-input fallback.
        // INIT-07 preserved: dynamic-imported only on the production loop
        // path (mock mode skips it since the mock STT bridge never opens
        // its circuit-breaker). The fallback polls session.sttCircuit
        // every 1s; on open, presents @clack/prompts.text() and routes
        // the typed string through session.submitTranscript() so it
        // shares the sandwich-wrap single-pipeline entry per SC-5.
        let typedInputDispose: (() => void) | null = null;
        if (!isMock) {
          const { createTypedInputFallback } = await import(
            "./typed-input.js"
          );
          const typedInputHandle = createTypedInputFallback(
            session.sttCircuit,
            async (typed: string): Promise<void> => {
              await session.submitTranscript(typed);
            },
          );
          typedInputDispose = (): void => {
            typedInputHandle.dispose();
          };
          process.once("exit", () => {
            typedInputDispose?.();
          });
        }

        // Register the graceful-shutdown handler (Plan 04 Task 2).
        // The handler owns the 7-step teardown in under 1.5s, the
        // second-SIGINT escalation, and the process.once("exit")
        // last-chance lock-file cleanup. The LOCK_FILE constant is
        // owned by Plan 04 Task 3 (resume-session.ts); load lazily
        // so a Phase 16 mock-mode run that does not need the lock
        // can still start cleanly when the resume-session module is
        // missing.
        const { registerGracefulShutdown } = await import(
          "./graceful-shutdown.js"
        );
        let lockFilePath: string;
        const resumeMod = (await loadResumeSessionModule()) as {
          LOCK_FILE: string;
        } | null;
        if (resumeMod !== null) {
          lockFilePath = resumeMod.LOCK_FILE;
        } else {
          const { join } = await import("node:path");
          const { homedir } = await import("node:os");
          lockFilePath = join(homedir(), ".achilles", "voice.lock");
        }
        registerGracefulShutdown({
          session,
          logger: session.logger,
          lockFilePath,
        });

        if (usePlain) {
          const { startPlainMode } = await import("./ui/plain-text.js");
          const teardown = startPlainMode({
            onStateChange: (cb) => {
              session.on("state-change", cb);
              return () => {
                session.off("state-change", cb);
              };
            },
            onTranscriptPartial: (cb) => {
              session.on("transcript-partial", cb);
              return () => {
                session.off("transcript-partial", cb);
              };
            },
            getState: () => session.currentState,
            getTranscript: () => "",
          });
          // Keep the process alive until SIGINT; the teardown call
          // is the symmetry hook for the gracefulShutdown chain.
          await new Promise<void>((resolve) => {
            const handler = (): void => {
              teardown();
              resolve();
            };
            // Use 'once' so a second SIGINT escalates via the
            // gracefulShutdown chain.
            process.once("SIGINT", handler);
          });
          return;
        }

        // TTY mode: mount Ink. CRITICAL — do NOT override Ink's
        // default Ctrl-C handler when calling render(). The default
        // true is what we want; gracefulShutdown wraps Ink's default
        // handler.
        const { render } = await import("ink");
        const { VoiceShell } = await import("./ui/VoiceShell.js");
        const { jsx } = await import("react/jsx-runtime");
        const element = jsx(VoiceShell, {
          session,
          debugVad: opts.debugVad ?? false,
        });
        const { waitUntilExit } = render(element);
        await waitUntilExit();
      },
    );

  // Commander expects argv[0..1] to be node + script path; we
  // synthesize those so the user's argv slice starts at the voice
  // subcommand level.
  await program.parseAsync(["dummy-node", "dummy-cli", "voice", ...argv]);
}
