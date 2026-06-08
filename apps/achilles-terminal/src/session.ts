/**
 * In-process composition root — Session class + runVoice entry point
 * (Phase 16, Plan 04, Task 1).
 *
 * Owns the orchestrator state machine (Plan 02 createSessionStateController),
 * the mic source (Plan 01 createMicSox in real mode OR Plan 03
 * createMockAmplitudeStream in --mock mode), and the energy VAD (Plan 01
 * createEnergyVad). Fans out state-change / amplitude / rms-sample /
 * error-message events via EventEmitter for the React UI tier
 * (Plan 04 useAchillesState).
 *
 * LOOP-02 invariant (Phase 16's hardest line): zero runtime imports from
 *   - @achilles/voice-protocol
 *   - @achilles/voice-stt
 *   - @achilles/voice-tts
 *   - @achilles/claude-code-bridge
 *   - @achilles/achilles-skill
 *
 * Phase 17 will add `sttFactory`, `ttsFactory`, `claudeBridgeFactory`
 * parameters to SessionOptions (currently typed `unknown` — Plan 04 ignores
 * them) so the factory-injection shape is ready without a constructor
 * refactor at Phase 17 time.
 *
 * Per RESEARCH.md A3 (CRITICAL) — runVoice() does NOT pass
 * `{ exitOnCtrlC: false }` to render(). Ink's default true is preserved.
 *
 * Pattern source: 16-RESEARCH.md §"Pattern 1" lines 305-322 (composition
 * root EventEmitter), §"TTY detection precedence" lines 854-893 (--plain /
 * isTTY routing), §"Pitfall 6" lines 520-529 (process.once SIGINT minimum
 * handler), §"Pitfall 7" lines 531-540 (sox onExit error path).
 *
 * No emojis (CLAUDE.md global). No application launches outside of vitest.
 */
import { EventEmitter } from "node:events";
import { execSync, type spawn as spawnFn } from "node:child_process";

import {
  createSessionStateController,
  type MockStateController,
} from "./state/state-machine.js";
import type { AchillesState, HotkeyMode } from "./state/constants.js";
import { createMicSox, type MicSoxHandle } from "./audio/mic-sox.js";
import { createEnergyVad, type VadHandle } from "./audio/vad-energy.js";
import { createMockAmplitudeStream } from "./ui/mock-amplitude.js";
import { loadSettings, type AchillesSettings } from "./store-stub.js";

/**
 * Event channels the Session fans out to the React UI tier (Plan 04
 * useAchillesState hooks). Shape source: 16-RESEARCH.md §"Pattern 1" lines
 * 312-317. The `error-message` channel is a Plan 04 addition surfaced to
 * Phase 17 / Phase 19 banner consumers; Phase 16 has no UI consumer.
 */
export interface SessionEvents {
  "state-change": [AchillesState];
  "transcript-partial": [string];
  amplitude: [number];
  "rms-sample": [number];
  "error-message": [string];
}

/**
 * Construction options for the Session composition root.
 *
 *   mock: when true, swap the sox child for the deterministic
 *     createMockAmplitudeStream from Plan 03 — `achilles voice --mock`
 *     renders the full TUI without sox / mic / network access.
 *   debugVad: when true, emit one JSON-line snapshot to process.stderr per
 *     VAD observe() call. Shape locked by CONTEXT.md `<specifics>` row 4.
 *   settings: optional override for the loader stub (test seam). Production
 *     callers leave undefined; loadSettings() returns DEFAULT_VAD_CONFIG.
 *   spawnImpl: deterministic node:child_process.spawn injection seam for
 *     vitest. Production callers leave undefined.
 *   mockSeed: seed for the mock-amplitude PRNG when mock === true.
 *   vadOverride: deterministic VAD injection seam for vitest. Production
 *     callers leave undefined; createEnergyVad(settings.vad) is constructed.
 *
 *   sttFactory / ttsFactory / claudeBridgeFactory: Phase 17 hooks typed
 *     `unknown` so the factory-injection shape is ready without a
 *     constructor refactor at Phase 17 time. Plan 04 ignores them
 *     completely — the LOOP-02 invariant means Phase 16 must NOT touch the
 *     voice packages at runtime.
 */
export interface SessionOptions {
  mock?: boolean;
  debugVad?: boolean;
  settings?: AchillesSettings;
  spawnImpl?: typeof spawnFn;
  mockSeed?: number;
  vadOverride?: VadHandle;
  sttFactory?: unknown;
  ttsFactory?: unknown;
  claudeBridgeFactory?: unknown;
}

/**
 * Composition root. Extends EventEmitter so the React tier can subscribe
 * via the useAchillesState / useAmplitude / useRingBuffer hooks (Plan 04
 * src/ui/useAchillesState.ts).
 */
export class Session extends EventEmitter {
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
      },
      getMode: (): HotkeyMode => "toggle",
    });

    this.vad = opts.vadOverride ?? createEnergyVad(settings.vad);
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
   * mock-amplitude stream from Plan 03. In real mode, spawns sox via
   * Plan 01 createMicSox.
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
      return;
    }
    // Production: spawn sox via Plan 01 wrapper.
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
  }

  /**
   * Toggle mute substate. Dispatches MUTE_TOGGLE to the state machine then
   * propagates the resulting muted boolean to the VAD layer (CAP-03).
   */
  toggleMute(): void {
    const next = this.controller.dispatch({ type: "MUTE_TOGGLE" });
    this.vad.setMuted(next === "muted");
  }

  /**
   * Tear down the mic source and any pending state-machine timer. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.micSox !== undefined) {
      await this.micSox.stop();
      this.micSox = undefined;
    }
    if (this.mockStream !== undefined) {
      this.mockStream.stop();
      this.mockStream = undefined;
    }
    this.controller.cancelScheduledTransitions();
  }

  /**
   * Mock-amplitude frame handler (--mock mode). The mock generator emits
   * an amplitude scalar directly (no PCM); we feed it AS the RMS into the
   * pipeline so the VAD can still fire speech_start on the speech-window
   * peaks (frames 0-29 of the 60-frame loop).
   */
  private handleMockFrame(amplitude: number): void {
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
    } else if (event === "speech_end") {
      this.controller.dispatch({ type: "STT_COMMITTED", transcript: "" });
    }
  }

  /**
   * Real-mode PCM frame handler. Computes the RMS of the 320-sample Int16
   * frame and feeds it through the same VAD + state machine pipeline as
   * the mock-mode handler.
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
    if (event === "speech_start") {
      this.controller.dispatch({ type: "HOTKEY_PRESS" });
    } else if (event === "speech_end") {
      this.controller.dispatch({ type: "STT_COMMITTED", transcript: "" });
    }
  }

  /**
   * sox exit handler (Pitfall 7 — fail visibly).
   *
   * On non-zero exit: resolve the parent emulator name via `ps -p $PPID
   * -o comm=` (best-effort; failure is non-fatal), write a per-emulator
   * hint to process.stderr, dispatch INJECT_ERROR to the state machine so
   * the UI tier transitions to error, and emit an `error-message` event
   * for Phase 17 / Phase 19 banner consumers.
   *
   * Do NOT restart sox in Phase 16 — that is Phase 19 ERR-03 territory.
   * Phase 16's job is to FAIL VISIBLY, not silently swallow.
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
 * callers prefer this over `new Session(...)` so future Phase 17 changes
 * stay encapsulated.
 */
export function createSession(opts: SessionOptions = {}): Session {
  return new Session(opts);
}

/**
 * Voice subcommand entry point invoked from cli.ts via dynamic import.
 *
 *   `if (argv[0] === "voice") {
 *      const { runVoice } = await import("./session.js");
 *      await runVoice(argv.slice(1));
 *    }`
 *
 * The dynamic-import gate preserves the INIT-07 invariant: cli.ts only
 * loads node:fs/promises + node:url + node:path statically; everything
 * else (commander, ink, react, sox, VAD) loads lazily inside this
 * function. `achilles --version` never pays the cost of loading any of
 * those modules.
 *
 * Parses the three Phase 16 flags via commander (`--mock`, `--debug-vad`,
 * `--plain`), constructs the Session, registers a minimum SIGINT handler
 * (Pitfall 6 — Phase 17 replaces with the full gracefulShutdown chain),
 * and routes to plain mode OR mounts Ink per the TTY-detection precedence.
 */
export async function runVoice(argv: string[]): Promise<void> {
  // Lazy-load commander to keep cli.ts's static import budget at the
  // INIT-07 minimum (node:fs/promises + node:url + node:path).
  const { Command } = await import("commander");
  const program = new Command();
  program
    .command("voice", { isDefault: true })
    .option("--mock", "render the TUI with a deterministic mock amplitude stream (no sox / mic)")
    .option("--debug-vad", "stream per-frame VAD snapshots to stderr as JSON lines")
    .option("--plain", "force ANSI-free plain-text fallback even on a TTY")
    .action(
      async (opts: { mock?: boolean; debugVad?: boolean; plain?: boolean }) => {
        const usePlain =
          (opts.plain ?? false) || !process.stdout.isTTY;

        const session = createSession({
          mock: opts.mock ?? false,
          debugVad: opts.debugVad ?? false,
        });
        session.start();

        // Pitfall 6 minimum SIGINT handler — Phase 17 will replace with the
        // full gracefulShutdown chain. `process.once` so re-entrant signals
        // do not double-dispatch the cleanup.
        process.once("SIGINT", () => {
          void session.stop().then(() => {
            process.exit(0);
          });
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
          // Keep the process alive until SIGINT; the teardown call is the
          // symmetry hook for Phase 17 lifecycle wiring.
          await new Promise<void>((resolve) => {
            process.once("SIGINT", () => {
              teardown();
              resolve();
            });
          });
          return;
        }

        // TTY mode: mount Ink. CRITICAL — do NOT pass `{ exitOnCtrlC: false }`
        // to render(). Ink's default true is what we want; Phase 17 will wrap
        // Ink's default handler in the gracefulShutdown chain.
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

  // Commander expects argv[0..1] to be node + script path; we synthesize
  // those so the user's argv slice starts at the voice subcommand level.
  await program.parseAsync(["dummy-node", "dummy-cli", "voice", ...argv]);
}
