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
  DEFAULT_VOICE_ID,
  IPC_MIC_AMPLITUDE,
  IPC_STATE_CHANGED,
  IPC_TTS_AMPLITUDE,
} from "../shared/constants.js";
import type { AchillesState, PermissionState } from "../shared/constants.js";
import { registerAchillesHotkey, unregisterAchillesHotkey } from "./hotkey.js";
import { wireIpcBridge } from "./ipc-bridge.js";
import { readApiKey, MissingApiKeyError } from "./key-source.js";
import { createMockAmplitudeStream } from "./mock-amplitude.js";
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
      sendIpc: (channel, payload) => {
        window.webContents.send(channel, payload);
      },
      readApiKey: () => capturedApiKey,
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      systemPromptFile: companionPromptPath,
      logger: (msg) => {
        // eslint-disable-next-line no-console
        console.error(msg);
      },
    });
  }

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
