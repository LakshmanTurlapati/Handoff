/**
 * Achilles main-process entry point.
 *
 * On `app.whenReady()`:
 *   - Instantiates the electron-store wrapper.
 *   - Reads persisted windowPosition + hotkeyMode + hotkeyKey.
 *   - Creates the locked BrowserWindow via createAchillesWindow.
 *   - Spins up the mocked state controller wired to the IPC bridge.
 *   - Registers the global hotkey (mode-aware).
 *
 * On `will-quit`:
 *   - Unregisters the hotkey.
 *   - Disposes the IPC bridge.
 *
 * NEVER logs raw audio, transcripts, or keys (defence in depth —
 * none of these are wired in Phase 11 yet; the log discipline is set
 * here so Phase 12 doesn't have to retrofit it).
 *
 * This file is consumed by electron-vite's main entry; it is NOT
 * loaded by the unit test suite. The unit tests cover the individual
 * modules (window, store, hotkey, state-machine, mock-amplitude,
 * ipc-bridge) directly with injected stubs.
 */
import { createClaudeSession } from "@achilles/claude-code-bridge";
import { companionPromptPath } from "@achilles/achilles-skill";
import { mintSttToken } from "@achilles/voice-stt/token-mint";
import { createTtsStreamClient } from "@achilles/voice-tts";
import {
  ACHILLES_MODE_INIT,
  DEFAULT_VOICE_ID,
  IPC_INCIDENT_TTS_FAIL,
  IPC_INIT_API_KEY_SUBMIT,
  IPC_INIT_MIC_PERMISSION_REQUEST,
  IPC_INIT_SMOKE_START,
  IPC_INIT_WIZARD_DONE,
  IPC_MIC_AMPLITUDE,
  IPC_STATE_CHANGED,
  IPC_TRANSCRIPT_PERSISTENCE_STATE,
  IPC_TTS_AMPLITUDE,
  SMOKE_TEST_CANNED_PHRASE,
} from "../shared/constants.js";
import type { AchillesState, PermissionState } from "../shared/constants.js";
import { registerAchillesHotkey, unregisterAchillesHotkey } from "./hotkey.js";
import {
  classifyHttpError,
  createCircuitBreaker,
  type CircuitBreaker,
} from "./incident-detection.js";
import {
  createInitWizardSession,
  createInitWizardWindow,
  type RunSmokeTestResult,
} from "./init-wizard.js";
import { wireIpcBridge } from "./ipc-bridge.js";
import { readApiKey, MissingApiKeyError } from "./key-source.js";
import { createLatencyProbe, type LatencyProbe } from "./latency-probe.js";
import { createMockAmplitudeStream } from "./mock-amplitude.js";
import {
  createMockClaude,
  createMockStt,
  createMockTts,
} from "./mock-loop-clients.js";
import {
  openSystemSettings as openSystemSettingsHelper,
  probePermission,
  schedulePermissionPoll,
} from "./permission.js";
import { createSession, type AchillesSession } from "./session.js";
import {
  createSessionStateController,
  type MockStateController,
} from "./state-machine.js";
import { createAchillesStore } from "./store.js";
import {
  createStuckThinkingWatchdog,
  STUCK_THINKING_DEFAULT_TIMEOUT_MS,
} from "./stuck-thinking-watchdog.js";
import { wireSuspendResume } from "./suspend-resume-handler.js";
import {
  createTranscriptStore,
  DEFAULT_RETENTION_DAYS,
  type TranscriptStore,
} from "./transcript-store.js";
import { createAchillesWindow } from "./window.js";

process.title = "achilles";

// eslint-disable-next-line no-console
console.log("[achilles] main process started");

async function bootstrap(): Promise<void> {
  // Lazy-import Electron so this module can be parsed without the
  // Electron binary present (e.g., during the Vite headless renderer
  // build pipeline). The real Electron import surface only exists
  // when this file is loaded by the Electron main process.
  const electron = await import("electron");
  const Store = (await import("electron-store")).default;

  const { app, BrowserWindow, ipcMain, globalShortcut, screen, safeStorage } =
    electron;

  // CR-03 fix: safeStorage.isEncryptionAvailable() may only be called
  // after app.whenReady() per Electron docs. Constructing the store
  // before whenReady previously froze the encryption verdict at false
  // for the process lifetime (and could throw on linux without a keyring).
  await app.whenReady();

  const store = createAchillesStore({
    storeCtor: Store as never,
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (buf: Buffer) => safeStorage.decryptString(buf),
    },
  });

  // ─── Plan 13-03 init wizard routing (DIST-04) ───────────────────────
  //
  // When the CLI's `achilles init` command spawned this process, the
  // `ACHILLES_MODE` env var equals 'init'. In that case we route to the
  // InitWizard child window INSTEAD of the floating shell, skip the
  // hotkey registration + permission poll + session orchestrator, and
  // return early so the regular Plan 11/12 bootstrap below does NOT run.
  //
  // Pitfall #3 (macOS TCC): the wizard's Step 2 calls probePermission
  // INSIDE this main process, so the OS attributes the prompt to the
  // Achilles app, not to the iTerm/Terminal that launched the CLI.
  //
  // The wizard signals completion via the IPC_INIT_WIZARD_DONE channel
  // which calls markWizardDone() → app.quit(); the CLI process (which
  // is attached, NOT detached) propagates the exit code to the user.
  if (process.env.ACHILLES_MODE === ACHILLES_MODE_INIT) {
    const wizardWindow = createInitWizardWindow({
      BrowserWindowCtor: BrowserWindow as never,
      screenRef: screen as never,
    });

    // Load the renderer entry — main.tsx routes on window.achilles.mode
    // to mount the InitWizard component instead of the floating shell.
    if (process.env.ELECTRON_RENDERER_URL !== undefined) {
      void wizardWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      const { join, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const here = dirname(fileURLToPath(import.meta.url));
      void wizardWindow.loadFile(join(here, "../renderer/index.html"));
    }

    // Smoke round-trip factory selection. MOCK_LOOP=1 routes through
    // the Plan 12-04 deterministic fakes (offline-friendly default for
    // a fresh-install user who has not yet validated their key); the
    // unset path wires the real ElevenLabs + Claude Code composition.
    //
    // The real-path composition is intentionally minimal — the wizard
    // only needs ONE round-trip to validate the loop, and a misordered
    // event-stream consumer would be over-engineering for a one-shot.
    // A future Plan 13-04+ may expand to drive the full session.ts
    // orchestrator; for now the mocked path is the only one CI exercises.
    function buildCreateSmokeRoundTrip(): () => Promise<RunSmokeTestResult> {
      if (process.env.MOCK_LOOP === "1") {
        return async (): Promise<RunSmokeTestResult> => {
          // Run a minimal mock loop: STT commit → Claude bridge → TTS.
          // The mock TTS chunks are not played back here (the renderer
          // owns the audio surface); the success criterion is that the
          // mocks chain together without throwing.
          const stt = createMockStt({
            committedTranscripts: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                text: "Hello",
                committedAt: 1,
              },
            ],
          });
          const claude = createMockClaude({
            ackText: SMOKE_TEST_CANNED_PHRASE,
            spokenSummaryBody: SMOKE_TEST_CANNED_PHRASE,
            exitCode: 0,
            sessionId: "smoke-test-mock-session",
          });
          const tts = createMockTts({ chunksPerSegment: 1 });
          stt.commit();
          claude.send(SMOKE_TEST_CANNED_PHRASE);
          await tts.open();
          tts.appendText(SMOKE_TEST_CANNED_PHRASE);
          await tts.flush();
          await tts.close();
          await claude.close();
          stt.close();
          return { status: "ok", spokenPhrase: SMOKE_TEST_CANNED_PHRASE };
        };
      }
      // Production path: returns 'error' rather than wiring a real
      // network call here. The wizard's `--live` opt-in is a Phase 14
      // follow-up (deferred per CONTEXT.md "NO live ElevenLabs / Claude
      // in CI"); the wizard exits cleanly on 'error' so the user can
      // still proceed to launch.
      return async (): Promise<RunSmokeTestResult> => {
        return { status: "error" };
      };
    }

    const wizardSession = createInitWizardSession({
      store,
      ipc: {
        send: (channel: string, payload: unknown) => {
          if (!wizardWindow.isDestroyed()) {
            wizardWindow.webContents.send(channel, payload);
          }
        },
      },
      probePermissionImpl: (opts) =>
        probePermission({
          platform: process.platform,
          triggerAskForMediaAccess: opts.triggerAskForMediaAccess,
          systemPreferencesRef: electron.systemPreferences as never,
        }),
      createSmokeRoundTrip: buildCreateSmokeRoundTrip(),
      appQuitImpl: () => app.quit(),
      // WR-09 fix: inject the logger seam explicitly so the diagnostic
      // stream is honest about its sink. The init-wizard module's
      // default falls back to console.error with an inline disable —
      // production wiring should provide the seam rather than rely on
      // the fallback, per the module docstring.
      logger: (msg) => {
        // eslint-disable-next-line no-console
        console.error(msg);
      },
    });

    // Wire the four inbound IPC handlers (Plan 13-03 W2 contract). The
    // handlers are removed in will-quit to release listener slots.
    const onApiKeySubmit = (_evt: unknown, payload: { key: string }) => {
      void wizardSession.submitApiKey(payload.key);
    };
    const onMicPermissionRequest = () => {
      void wizardSession.requestMicPermission();
    };
    const onSmokeStart = () => {
      void wizardSession.runSmokeTest();
    };
    const onWizardDone = () => {
      wizardSession.markWizardDone();
    };
    (ipcMain as never as {
      on(channel: string, listener: (evt: unknown, payload: unknown) => void): void;
    }).on(IPC_INIT_API_KEY_SUBMIT, onApiKeySubmit as never);
    (ipcMain as never as {
      on(channel: string, listener: () => void): void;
    }).on(IPC_INIT_MIC_PERMISSION_REQUEST, onMicPermissionRequest);
    (ipcMain as never as {
      on(channel: string, listener: () => void): void;
    }).on(IPC_INIT_SMOKE_START, onSmokeStart);
    (ipcMain as never as {
      on(channel: string, listener: () => void): void;
    }).on(IPC_INIT_WIZARD_DONE, onWizardDone);

    app.on("will-quit", () => {
      (ipcMain as never as {
        removeAllListeners(channel: string): void;
      }).removeAllListeners(IPC_INIT_API_KEY_SUBMIT);
      (ipcMain as never as {
        removeAllListeners(channel: string): void;
      }).removeAllListeners(IPC_INIT_MIC_PERMISSION_REQUEST);
      (ipcMain as never as {
        removeAllListeners(channel: string): void;
      }).removeAllListeners(IPC_INIT_SMOKE_START);
      (ipcMain as never as {
        removeAllListeners(channel: string): void;
      }).removeAllListeners(IPC_INIT_WIZARD_DONE);
      wizardSession.dispose();
    });

    // Early return — the floating shell + hotkey + session orchestrator
    // are NOT initialised in init mode. Plan 11/12 default bootstrap
    // continues below this branch ONLY when ACHILLES_MODE is unset or
    // set to anything other than 'init'.
    return;
  }
  // ─── End Plan 13-03 init wizard routing ─────────────────────────────

  const initialPosition = store.readWindowPosition();
  const initialMode = store.readHotkeyMode();
  const initialKey = store.readHotkeyKey();
  const workArea = screen.getPrimaryDisplay().workArea;
  // CR-05: enumerate every attached display so the off-screen guard
  // accepts positions on the secondary monitor when one is attached.
  const allDisplays = (
    screen as unknown as {
      getAllDisplays(): Array<{
        workArea: { x: number; y: number; width: number; height: number };
      }>;
    }
  ).getAllDisplays();

  const window = createAchillesWindow({
    BrowserWindowCtor: BrowserWindow as never,
    appRef: app as never,
    initialPosition,
    platform: process.platform,
    workArea,
    allDisplays,
  });

  // Load the renderer bundle. electron-vite writes the renderer to
  // out/renderer; the dev server URL is consulted when MAIN_VITE_DEV
  // is set.
  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // The packaged path looks like out/renderer/index.html relative
    // to the main entry's directory.
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    void window.loadFile(join(here, "../renderer/index.html"));
  }

  // State machine wiring. We need to compose the controller's
  // broadcast with the amplitude swap so we set everything up here
  // and pass the resulting hook into createMockStateController.
  let bridgeHandle: {
    dispose(): void;
    broadcastPermissionState(state: PermissionState): void;
  } | null = null;
  let activeAmplitudeStop: (() => void) | null = null;

  function startAmplitudeForState(state: AchillesState): void {
    if (activeAmplitudeStop !== null) {
      activeAmplitudeStop();
      activeAmplitudeStop = null;
    }
    if (state === "listening") {
      const stream = createMockAmplitudeStream("listening");
      activeAmplitudeStop = stream.emit((rms) => {
        window.webContents.send(IPC_MIC_AMPLITUDE, { rms });
      });
    } else if (state === "speaking") {
      const stream = createMockAmplitudeStream("speaking");
      activeAmplitudeStop = stream.emit((rms) => {
        window.webContents.send(IPC_TTS_AMPLITUDE, { rms });
      });
    }
  }

  // State machine wiring (Plan 12-04). createSessionStateController
  // replaces the Plan 11 createMockStateController surface in the
  // production path. The underlying reducer is unchanged; the
  // production controller's setTimeout is a no-op so the orchestrator
  // (session.ts) drives every transition via the production tags
  // (STT_COMMITTED / CLAUDE_RESULT_READY / TTS_PLAYBACK_DRAINED).
  //
  // The mock-amplitude streams are PRESERVED for now: until the
  // renderer-side audio capture is wired into App.tsx (Plan 12-04 ships
  // the orchestrator + renderer audio modules; the App composition
  // root that feeds AnalyserNode into the Waveform lands as part of
  // the renderer wiring done elsewhere in this plan or Phase 13), the
  // visible amplitude in the UI still comes from the fixture streams.
  let controller: MockStateController;
  controller = createSessionStateController({
    broadcast: (state) => {
      window.webContents.send(IPC_STATE_CHANGED, { state });
      startAmplitudeForState(state);
    },
    getMode: () => store.readHotkeyMode(),
  });

  // Track latest permission state so the first-hotkey-press flow can
  // decide whether to call systemPreferences.askForMediaAccess.
  let currentPermissionState: PermissionState = "granted";

  // ─── Plan 12-04 session orchestrator construction ────────────────
  //
  // Read the ElevenLabs API key via the single read point. On
  // MissingApiKeyError we proceed in degraded mode: the session is
  // null, the bridge is constructed without the Phase 12 handlers,
  // and the renderer's mic + TTS surfaces will surface an STT auth
  // error path. Phase 13's first-run wizard owns the UX for resolving
  // the missing key state.
  let session: AchillesSession | null = null;
  let apiKey: string | null = null;
  // CR-01 fix: hoist stuckThinkingWatchdog to the outer bootstrap scope so the
  // will-quit handler can reach it. Previously the watchdog was declared inside
  // the `if (apiKey !== null)` branch and was never disposed at app teardown,
  // leaking the captured sessionRef closure and any in-flight setTimeout token
  // (Phase 11 WR-04 invariant).
  let stuckThinkingWatchdogRef: ReturnType<
    typeof createStuckThinkingWatchdog
  > | null = null;
  try {
    apiKey = readApiKey({ store, env: process.env });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      // eslint-disable-next-line no-console
      console.error(`[achilles] ${err.message}`);
    } else {
      throw err;
    }
  }
  // ─── Plan 14-01 latency probe construction ─────────────────────────
  //
  // When the CLI was invoked with `--debug`, the spawned Electron child
  // receives `ACHILLES_DEBUG=1` in its env (cli.ts/launchCommand wiring).
  // The probe captures stage timestamps + writes the rolling window to
  // disk so the offline `achilles latency --report` subcommand can read
  // them without an IPC round-trip. When the env var is unset, the
  // probe is undefined and session.ts's pre-14-01 behaviour is bit-for-
  // bit preserved (SE17 invariant).
  //
  // The sample file path mirrors the CLI's production reportPath
  // (`~/.achilles/latency-samples.json`) — both surfaces use the same
  // location so the offline subcommand does not need to discover
  // anything about the Electron app's storage layout. We ensure the
  // parent directory exists before the first write to avoid a
  // permission error masking a missing-dir condition.
  let latencyProbe: LatencyProbe | undefined;
  if (process.env.ACHILLES_DEBUG === "1") {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join: pathJoin } = await import("node:path");
    const sampleFilePath = pathJoin(
      homedir(),
      ".achilles",
      "latency-samples.json",
    );
    try {
      mkdirSync(pathJoin(homedir(), ".achilles"), { recursive: true });
    } catch {
      // Best-effort — the writeFileImpl below also swallows write
      // failures so the probe degrades gracefully if the path is not
      // writable.
    }
    latencyProbe = createLatencyProbe({
      debugEnabled: true,
      writeSampleFile: true,
      sampleFilePath,
      writeFileImpl: (path, contents) => {
        writeFileSync(path, contents);
      },
      // The default logger writes to console.log — we keep that for
      // production so the operator sees `[achilles-latency]` lines on
      // the launching terminal. No transcript content is included.
    });
  }
  // ─── Plan 14-02 transcript store construction (SAFE-02) ────────────
  //
  // When the CLI was invoked with `--save-transcripts`, the spawned
  // Electron child receives `ACHILLES_SAVE_TRANSCRIPTS=1` in its env
  // (cli.ts/launchCommand wiring via makeLaunchEnv). The store
  // captures user + assistant turns to ~/.achilles/transcripts/. When
  // the env var is unset, the store is constructed with enabled=false
  // — every appendTurn is a SYNC no-op that NEVER touches the
  // filesystem (TS2 / TS10 SAFE-02 invariant). Either way the store
  // is non-null so session.ts's transcriptStore wiring is uniform.
  //
  // The TranscriptStore is ALWAYS constructed — even when disabled —
  // because the optional-chain semantics in session.ts means a present
  // store with `enabled=false` is equivalent to an absent store, and
  // constructing the store unconditionally keeps the broadcast +
  // dispose wiring simpler (no branching on the env var here).
  const transcriptsEnabled = process.env.ACHILLES_SAVE_TRANSCRIPTS === "1";
  const retentionDaysRaw = process.env.ACHILLES_TRANSCRIPT_RETENTION_DAYS;
  const retentionDaysParsed =
    retentionDaysRaw !== undefined && retentionDaysRaw.length > 0
      ? Number.parseInt(retentionDaysRaw, 10)
      : DEFAULT_RETENTION_DAYS;
  // WR-02 fix: clamp the retention window to >= 1 day. Without the lower
  // bound a negative value (e.g. ACHILLES_TRANSCRIPT_RETENTION_DAYS=-5)
  // would pass the isFinite guard and reach applyRetention where
  // `ageDays > retentionDays` would delete every transcript file (any
  // positive age > a negative threshold). This is a privacy issue: a
  // misconfigured retention setting wipes the user's transcripts. We
  // also fall back to the default on NaN.
  const retentionDays =
    Number.isFinite(retentionDaysParsed) && retentionDaysParsed >= 1
      ? retentionDaysParsed
      : DEFAULT_RETENTION_DAYS;
  if (
    retentionDaysRaw !== undefined &&
    retentionDaysRaw.length > 0 &&
    retentionDays !== retentionDaysParsed
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[achilles] ignoring invalid ACHILLES_TRANSCRIPT_RETENTION_DAYS=${retentionDaysRaw}; using default ${DEFAULT_RETENTION_DAYS}`,
    );
  }
  let transcriptStore: TranscriptStore;
  {
    const {
      appendFileSync,
      mkdirSync,
      readdirSync,
      readFileSync,
      statSync,
      unlinkSync,
    } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join: pathJoin } = await import("node:path");
    const transcriptsDir = pathJoin(homedir(), ".achilles", "transcripts");
    transcriptStore = createTranscriptStore({
      enabled: transcriptsEnabled,
      dirPath: transcriptsDir,
      // WR-02 fix: retentionDays is already clamped to a finite >= 1
      // value above; passing it directly removes the duplicate guard.
      retentionDays,
      writeFileImpl: (path, data, options) => {
        appendFileSync(path, data, { flag: options.flag });
      },
      readDirImpl: (p) => readdirSync(p),
      statFileImpl: (p) => {
        const st = statSync(p);
        return { size: st.size, mtime: st.mtime };
      },
      deleteFileImpl: (p) => unlinkSync(p),
      mkdirImpl: (p, options) => {
        mkdirSync(p, { recursive: options.recursive });
      },
      readFileImpl: (p, enc) => readFileSync(p, enc),
      nowImpl: () => new Date(),
      logger: (msg) => {
        // eslint-disable-next-line no-console
        console.error(msg);
      },
    });
  }
  // SAFE-02 visibility: broadcast the persistence enabled state to the
  // renderer on did-finish-load. The renderer's App.tsx mirrors the
  // boolean into local state; the RecordingIndicator mounts when
  // enabled=true. We re-broadcast on every load so a future window
  // reload (e.g. via DevTools) does not orphan the renderer with a
  // stale value.
  (window as never as {
    webContents: { on(channel: string, listener: () => void): void };
  }).webContents.on("did-finish-load", () => {
    window.webContents.send(IPC_TRANSCRIPT_PERSISTENCE_STATE, {
      enabled: transcriptsEnabled,
    });
  });
  // ─── Plan 14-03 SAFE-05 circuit-breaker construction ───────────────
  //
  // Two CircuitBreaker instances wrap the two ElevenLabs surfaces
  // (STT token-mint + TTS open()). The locked v1.2 thresholds match
  // the plan's <interfaces> section:
  //
  //   maxConsecutiveFailures = 3
  //   windowMs               = 60_000
  //   cooldownMs             = 30_000
  //   backoffBaseMs          = 250
  //   backoffCapMs           = 5_000
  //
  // Both breakers share the classifier (HTTP-shape + Node-shape
  // recognition) and the Math.random randomImpl. Production logger
  // routes to console.error with the [achilles] prefix; no transcript
  // text and no API key is logged (verified by ID10 test).
  const sttCircuit: CircuitBreaker = createCircuitBreaker({
    label: "stt",
    classifyError: classifyHttpError,
    logger: (msg) => {
      // eslint-disable-next-line no-console
      console.error(msg);
    },
  });
  const ttsCircuit: CircuitBreaker = createCircuitBreaker({
    label: "tts",
    classifyError: classifyHttpError,
    logger: (msg) => {
      // eslint-disable-next-line no-console
      console.error(msg);
    },
  });

  if (apiKey !== null) {
    // The mic-capture handle lives in the renderer (Phase 09 design).
    // The orchestrator gates the renderer-side mic by toggling state
    // via the IPC_STATE_CHANGED broadcast: the renderer's mic-capture
    // module subscribes and applies pauseFrameDelivery on 'speaking'.
    // The closure here is a no-op pair so the orchestrator's
    // deterministic behaviour mirrors the renderer mode without
    // re-implementing the gate.
    const micCaptureProxy = {
      pauseFrameDelivery: (): void => {
        // State-driven: the IPC_STATE_CHANGED broadcast above already
        // signals 'speaking' so the renderer's mic-capture pauses.
      },
      resumeFrameDelivery: (): void => {
        // Same: the state broadcast back to 'idle' resumes the
        // renderer's mic-capture.
      },
    };
    const capturedApiKey = apiKey;
    // Plan 14-03 SAFE-05 stderr tap. Wrap the renderer-bound sendIpc
    // so when session.ts broadcasts IPC_INCIDENT_TTS_FAIL, the main
    // process ALSO writes the spoken-summary text to process.stderr.
    // The launching terminal receives the text — PITFALLS #18 "print
    // the completion text to the launching terminal so the user does
    // not lose it" contract. We do NOT log the API key, NOT log the
    // raw transcript, NOT log any other channel's payload; only the
    // normalised summary text routes to stderr.
    const sendIpcWithStderrTap = (
      channel: string,
      payload: unknown,
    ): void => {
      window.webContents.send(channel, payload);
      if (channel === IPC_INCIDENT_TTS_FAIL) {
        // WR-05 fix: when summaryText is empty (e.g. the TTS circuit
        // opens during the ack path before any summary is computed) the
        // prior implementation silently skipped the stderr write. The
        // user — whose TTS just died — got NO terminal output AND NO
        // audio. PITFALLS #18 requires "print the completion text to the
        // launching terminal so the user does not lose it"; even an
        // empty completion warrants a minimal log line so the user knows
        // the TTS failed. We now always emit a line and surface the
        // classified kind for diagnostic clarity.
        const p =
          payload as { summaryText?: string; kind?: string } | null | undefined;
        const summaryText = p?.summaryText ?? "";
        const kind = p?.kind ?? "unknown";
        process.stderr.write(
          summaryText.length > 0
            ? `[achilles] TTS unavailable (${kind}): ${summaryText}\n`
            : `[achilles] TTS unavailable (${kind}); no completion summary cached.\n`,
        );
      }
    };
    // Plan 14-04 SAFE-06 stuck-thinking watchdog construction. The
    // onTimeout callback routes into session.announceStuckThinking
    // which owns the TTS appendText + IPC_STUCK_THINKING_ANNOUNCE
    // fan-out. The watchdog itself is a pure timer module. The
    // timeoutMs reads from ACHILLES_STUCK_TIMEOUT_MS if set; otherwise
    // defaults to STUCK_THINKING_DEFAULT_TIMEOUT_MS (60_000).
    let sessionRef: AchillesSession | null = null;
    const stuckTimeoutRaw = process.env.ACHILLES_STUCK_TIMEOUT_MS;
    const stuckTimeoutParsed =
      stuckTimeoutRaw !== undefined && stuckTimeoutRaw.length > 0
        ? Number.parseInt(stuckTimeoutRaw, 10)
        : STUCK_THINKING_DEFAULT_TIMEOUT_MS;
    // WR-02 fix: clamp the stuck-thinking timeout to >= 1000 ms.
    // A negative or zero value would resolve to setTimeout(cb, -5) which
    // Node coerces to 1 ms, firing the watchdog instantly on every
    // utterance and flooding the user with stuck-thinking announcements.
    // We also fall back to the default on NaN.
    const stuckTimeoutMs =
      Number.isFinite(stuckTimeoutParsed) && stuckTimeoutParsed >= 1000
        ? stuckTimeoutParsed
        : STUCK_THINKING_DEFAULT_TIMEOUT_MS;
    if (
      stuckTimeoutRaw !== undefined &&
      stuckTimeoutRaw.length > 0 &&
      stuckTimeoutMs !== stuckTimeoutParsed
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[achilles] ignoring invalid ACHILLES_STUCK_TIMEOUT_MS=${stuckTimeoutRaw}; using default ${STUCK_THINKING_DEFAULT_TIMEOUT_MS}`,
      );
    }
    const stuckThinkingWatchdog = createStuckThinkingWatchdog({
      timeoutMs: stuckTimeoutMs,
      onTimeout: ({ waitedMs }): void => {
        sessionRef?.announceStuckThinking({ waitedMs });
      },
      logger: (msg) => {
        // eslint-disable-next-line no-console
        console.error(msg);
      },
    });
    // CR-01 fix: hold the watchdog handle in the outer-scope ref so the
    // will-quit handler can dispose it. Without this hoist the watchdog stayed
    // alive after the orchestrator disposed (sessionRef + onTimeoutRef leaked).
    stuckThinkingWatchdogRef = stuckThinkingWatchdog;
    session = createSession({
      stateController: controller,
      claudeFactory: (opts) =>
        createClaudeSession({
          systemPromptFile: opts.systemPromptFile,
          resumeSessionId: opts.resumeSessionId,
        }),
      ttsFactory: (opts) =>
        createTtsStreamClient({
          keySource: async () => capturedApiKey,
          voiceId: opts.voiceId,
        }) as never,
      mintSttToken: async () => {
        const minted = await mintSttToken({ apiKey: capturedApiKey });
        return { token: minted.token, expiresAt: minted.expiresAt };
      },
      micCapture: micCaptureProxy,
      sendIpc: sendIpcWithStderrTap,
      readApiKey: () => capturedApiKey,
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      systemPromptFile: companionPromptPath,
      logger: (msg) => {
        // eslint-disable-next-line no-console
        console.error(msg);
      },
      // Plan 14-01: pass the optional probe iff ACHILLES_DEBUG=1.
      // When undefined, session.ts behaviour is preserved (SE17).
      ...(latencyProbe !== undefined ? { latencyProbe } : {}),
      // Plan 14-02 SAFE-02: pass the transcript store always. When
      // ACHILLES_SAVE_TRANSCRIPTS is unset the store's enabled=false
      // collapses every appendTurn call to a SYNC no-op (TS2 / TS10
      // structural invariant) so session.ts behaviour is preserved.
      transcriptStore,
      // Plan 14-03 SAFE-05: pass both circuit breakers. The
      // orchestrator routes mintSttToken and tts.open() through the
      // breakers; on exhausted=true the matching IPC_INCIDENT_*
      // broadcast fires and the stderr tap above writes the TTS
      // summary to the launching terminal.
      sttCircuit,
      ttsCircuit,
      // Plan 14-04 SAFE-06: pass the stuck-thinking watchdog. The
      // orchestrator wires arm/observe/clear at the consumeClaudeEvents
      // boundaries; the watchdog's onTimeout routes back here via
      // sessionRef.announceStuckThinking.
      stuckThinkingWatchdog,
    });
    sessionRef = session;
  }
  // Plan 14-04 SAFE-06 — wire the powerMonitor 'suspend' / 'resume'
  // events to the session orchestrator. The handler module owns the
  // listener registration + dispose round-trip; we route the callbacks
  // into session.onSuspend() and session.onResume() so the session
  // tears down bridge + TTS + mic on suspend and logs on resume. The
  // dispose handle is added to the will-quit cleanup below. When
  // session is null (degraded mode), the handler is still wired so the
  // log lines surface power-event activity for post-mortem debugging.
  const suspendResumeHandle = wireSuspendResume({
    powerMonitorRef: electron.powerMonitor as never,
    onSuspend: (): void => {
      session?.onSuspend();
    },
    onResume: (): void => {
      session?.onResume();
    },
    logger: (msg) => {
      // eslint-disable-next-line no-console
      console.error(msg);
    },
  });

  // Adapter that exposes the underlying BrowserWindow's 'move' /
  // 'moved' events to wireDragPersistence. The createAchillesWindow
  // interface is narrow on purpose; here we widen to the surface
  // drag-persist needs without leaking it to other consumers.
  const dragWindowAdapter = {
    on(
      channel: "move" | "moved",
      cb: (...args: unknown[]) => void,
    ): void {
      (
        window as unknown as {
          on(c: string, l: (...args: unknown[]) => void): void;
        }
      ).on(channel, cb);
    },
    getPosition(): [number, number] {
      return (
        window as unknown as { getPosition(): [number, number] }
      ).getPosition();
    },
  };

  bridgeHandle = wireIpcBridge({
    window,
    controller,
    store,
    ipcMainRef: ipcMain as never,
    dragWindowAdapter,
    screenRef: screen as never,
    // Plan 12-04: pass the session orchestrator so the bridge wires
    // the Phase 12 inbound handlers (utterance-commit, mic-frame,
    // tts-playback-complete, stt-token-request). When session is null
    // (MissingApiKeyError graceful-degradation path) the handlers are
    // NOT registered — the bridge collapses to the Phase 11 surface.
    ...(session !== null ? { session } : {}),
    resetWindowPosition: (pos) => {
      window.setPosition(pos.x, pos.y);
    },
    openSystemSettings: () => {
      void openSystemSettingsHelper({
        platform: process.platform,
        shellRef: electron.shell as never,
        dialogRef: electron.dialog as never,
      });
    },
  });

  // Hotkey wiring — use the persisted accelerator and the persisted
  // mode. The webContentsKeySource forwards 'before-input-event'
  // from the renderer into our key-up watcher (PTT only).
  const keySource = {
    onBeforeInputEvent(
      cb: (event: { type: "keyDown" | "keyUp"; key: string }) => void,
    ) {
      window.webContents &&
        (
          window as unknown as {
            webContents: {
              on(
                channel: string,
                listener: (event: unknown, input: { type: string; key: string }) => void,
              ): void;
            };
          }
        ).webContents.on(
          "before-input-event",
          (_event, input) => {
            cb({
              type: input.type === "keyUp" ? "keyUp" : "keyDown",
              key: input.key,
            });
          },
        );
    },
  };

  registerAchillesHotkey(
    initialKey,
    initialMode,
    async () => {
      // On the FIRST hotkey press while permission is 'not-determined',
      // invoke probePermission with triggerAskForMediaAccess=true (per
      // CONTEXT.md "On first press, call systemPreferences.askForMediaAccess").
      // The follow-up state is broadcast through IPC_PERMISSION_STATE so
      // the renderer dismisses the overlay (on 'granted') or mounts it
      // (on 'denied').
      if (currentPermissionState === "not-determined") {
        const asked = await probePermission({
          platform: process.platform,
          triggerAskForMediaAccess: true,
          systemPreferencesRef: electron.systemPreferences as never,
        });
        currentPermissionState = asked;
        bridgeHandle?.broadcastPermissionState(asked);
        if (asked !== "granted") return;
      }
      // Plan 12-04 production path: dispatch via session.onHotkeyPress
      // so the orchestrator owns the per-utterance lifecycle (token
      // mint + IPC_STT_TOKEN broadcast + state transitions). When the
      // session is null (degraded mode), fall back to the Phase 11
      // controller dispatch so the visual state still advances.
      if (session !== null) {
        await session.onHotkeyPress();
      } else {
        controller.dispatch({ type: "HOTKEY_PRESS" });
      }
    },
    () => controller.dispatch({ type: "HOTKEY_RELEASE" }),
    {
      globalShortcutRef: globalShortcut as never,
      webContentsKeySource: keySource,
    },
  );

  // Boot-time permission probe — silent (does NOT trigger ask). On
  // 'denied' / 'restricted' the renderer mounts the PermissionOverlay
  // on first paint. On 'not-determined' nothing renders; the first
  // hotkey press triggers the ask flow above.
  const bootPermission = await probePermission({
    platform: process.platform,
    triggerAskForMediaAccess: false,
    systemPreferencesRef: electron.systemPreferences as never,
  });
  currentPermissionState = bootPermission;
  bridgeHandle.broadcastPermissionState(bootPermission);

  // Permission poll — UI-SPEC §6 re-poll cadence (2000ms) so the overlay
  // dismisses without a restart when the user grants in System Settings.
  // The schedule is alive for the app's lifetime; the bridge dedupes
  // identical consecutive states (T-11-16 mitigation).
  const cancelPermissionPoll = schedulePermissionPoll(
    (state) => {
      currentPermissionState = state;
      bridgeHandle?.broadcastPermissionState(state);
    },
    {
      probeOptions: {
        platform: process.platform,
        systemPreferencesRef: electron.systemPreferences as never,
      },
    },
  );

  app.on("will-quit", () => {
    unregisterAchillesHotkey({ globalShortcutRef: globalShortcut as never });
    cancelPermissionPoll();
    bridgeHandle?.dispose();
    session?.dispose();
    // Plan 14-01: tear down the LOOP-06 probe so the rolling window
    // and the file-write seam are released before the process exits.
    latencyProbe?.dispose();
    // Plan 14-02 SAFE-02: dispose the transcript store so the fs seam
    // references are released. Subsequent appendTurn calls after
    // dispose are safe no-ops (disposed guard).
    transcriptStore.dispose();
    // Plan 14-04 SAFE-06: remove the powerMonitor listeners so the
    // global Electron event bus does not hold a reference to the
    // session that just disposed. Idempotent.
    suspendResumeHandle.dispose();
    // CR-01 fix: dispose the stuck-thinking watchdog so any in-flight
    // setTimeout token is cleared and the captured sessionRef closure is
    // dropped. Without this, the orchestrator's disposed AchillesSession
    // is reachable through the watchdog's onTimeoutRef and the timer
    // token survives until the host eventually clears it.
    stuckThinkingWatchdogRef?.dispose();
    if (activeAmplitudeStop !== null) {
      activeAmplitudeStop();
      activeAmplitudeStop = null;
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[achilles] main bootstrap failed:", (err as Error).message);
  process.exit(1);
});
