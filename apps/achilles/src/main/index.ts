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
  IPC_STATE_CHANGED,
  IPC_TTS_AMPLITUDE,
} from "../shared/constants.js";
import type { AchillesState, PermissionState } from "../shared/constants.js";
import { registerAchillesHotkey, unregisterAchillesHotkey } from "./hotkey.js";
import { wireIpcBridge } from "./ipc-bridge.js";
import { createMockAmplitudeStream } from "./mock-amplitude.js";
import {
  openSystemSettings as openSystemSettingsHelper,
  probePermission,
  schedulePermissionPoll,
} from "./permission.js";
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

  // Declare the controller binding first so the broadcast closure
  // can reference it; assigned below via createMockStateController.
  // CR-01 fix: every committed transition schedules the next mock
  // timer so listening -> processing -> speaking -> idle auto-advances
  // in production (the unit tests drove this explicitly; the real
  // composition root missed it).
  let controller: ReturnType<typeof createMockStateController>;
  controller = createMockStateController({
    broadcast: (state) => {
      window.webContents.send(IPC_STATE_CHANGED, { state });
      startAmplitudeForState(state);
      controller.scheduleMockTransitions(state);
    },
    getMode: () => store.readHotkeyMode(),
  });

  // Track latest permission state so the first-hotkey-press flow can
  // decide whether to call systemPreferences.askForMediaAccess.
  let currentPermissionState: PermissionState = "granted";

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
      controller.dispatch({ type: "HOTKEY_PRESS" });
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
