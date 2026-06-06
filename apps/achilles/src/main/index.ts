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
import {
  IPC_MIC_AMPLITUDE,
  IPC_PERMISSION_STATE,
  IPC_STATE_CHANGED,
  IPC_TTS_AMPLITUDE,
} from "../shared/constants.js";
import type { AchillesState } from "../shared/constants.js";
import { registerAchillesHotkey, unregisterAchillesHotkey } from "./hotkey.js";
import { wireIpcBridge } from "./ipc-bridge.js";
import { createMockAmplitudeStream } from "./mock-amplitude.js";
import { createMockStateController } from "./state-machine.js";
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

  const store = createAchillesStore({
    storeCtor: Store as never,
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (buf: Buffer) => safeStorage.decryptString(buf),
    },
  });

  await app.whenReady();

  const initialPosition = store.readWindowPosition();
  const initialMode = store.readHotkeyMode();
  const initialKey = store.readHotkeyKey();
  const workArea = screen.getPrimaryDisplay().workArea;

  const window = createAchillesWindow({
    BrowserWindowCtor: BrowserWindow as never,
    appRef: app as never,
    initialPosition,
    platform: process.platform,
    workArea,
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
  let bridgeHandle: { dispose(): void } | null = null;
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

  const controller = createMockStateController({
    broadcast: (state) => {
      window.webContents.send(IPC_STATE_CHANGED, { state });
      startAmplitudeForState(state);
    },
    getMode: () => store.readHotkeyMode(),
  });

  bridgeHandle = wireIpcBridge({
    window,
    controller,
    store,
    ipcMainRef: ipcMain as never,
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
    () => controller.dispatch({ type: "HOTKEY_PRESS" }),
    () => controller.dispatch({ type: "HOTKEY_RELEASE" }),
    {
      globalShortcutRef: globalShortcut as never,
      webContentsKeySource: keySource,
    },
  );

  // Permission-state surfacing — emit once on boot so the renderer
  // can compose against the current mic permission. Phase 11 uses the
  // mocked 'not-determined' status; Plan 11-03 / Phase 12 swap in
  // systemPreferences.getMediaAccessStatus('microphone') once that
  // surface lands.
  window.webContents.send(IPC_PERMISSION_STATE, { state: "not-determined" });

  app.on("will-quit", () => {
    unregisterAchillesHotkey({ globalShortcutRef: globalShortcut as never });
    bridgeHandle?.dispose();
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
