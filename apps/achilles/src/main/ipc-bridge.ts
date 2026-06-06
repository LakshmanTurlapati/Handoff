/**
 * IPC bridge — wires the renderer ↔ main channels to the state
 * machine, store, and mock amplitude stream.
 *
 *   Renderer → Main handlers:
 *     IPC_REQUEST_STATE        — drive the reducer with explicit state
 *                                requests (test seam + cancel paths)
 *     IPC_REGISTER_HOTKEY      — accept a new accelerator
 *     IPC_OPEN_SYSTEM_SETTINGS — Phase 11 stub; Plan 11-03 wires the
 *                                real `shell.openExternal` call
 *     IPC_UPDATE_WINDOW_POSITION — persist drag results
 *     IPC_UPDATE_HOTKEY_CONFIG — persist mode/key updates
 *
 *   Main → Renderer broadcasts:
 *     IPC_STATE_CHANGED        — every state transition
 *     IPC_MIC_AMPLITUDE        — emitted only during 'listening'
 *     IPC_TTS_AMPLITUDE        — emitted only during 'speaking'
 *
 * Every IPC payload is parsed through `IPC_PAYLOAD_SCHEMAS` before
 * dispatch; unknown channels and invalid payloads are dropped with a
 * `[achilles]` warning log.
 */
import {
  IPC_ERROR,
  IPC_MIC_AMPLITUDE,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_TTS_AMPLITUDE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
} from "../shared/constants.js";
import { parseEnvelope } from "../shared/ipc-schemas.js";
import type { AchillesState, PermissionState } from "../shared/constants.js";
import {
  applyDefaultTopRight,
  wireDragPersistence,
} from "./drag-persist.js";
import type {
  DragPersistClock,
  WireDragPersistenceHandle,
} from "./drag-persist.js";
import { createMockAmplitudeStream } from "./mock-amplitude.js";
import type { MockStateController } from "./state-machine.js";
import type { AchillesStore } from "./store.js";
import type { AchillesBrowserWindow } from "./window.js";

/**
 * Minimal subset of Electron's `ipcMain.on` surface we need.
 */
export interface IpcMainLike {
  on(
    channel: string,
    listener: (event: { sender: { id: number } }, ...args: unknown[]) => void,
  ): void;
  removeAllListeners(channel?: string): void;
}

export interface WireIpcBridgeOptions {
  window: AchillesBrowserWindow;
  controller: MockStateController;
  store: AchillesStore;
  ipcMainRef: IpcMainLike;
  /**
   * Hook the IPC bridge calls when the renderer requests the system
   * mic settings panel. Plan 11-03 wires the real
   * `shell.openExternal(...)` implementation through this seam by
   * supplying a callback that defers to `permission.openSystemSettings`.
   * Defaults to a no-op so the channel is wired end-to-end without
   * launching anything in unit tests.
   */
  openSystemSettings?: () => void;
  /**
   * Optional dragPersistence injection seam — by default the bridge
   * wires `wireDragPersistence` against the supplied window + store on
   * init. Tests can suppress drag wiring by passing `enableDragPersistence: false`.
   */
  enableDragPersistence?: boolean;
  /**
   * Window adapter that exposes `on('move' | 'moved')` for the drag
   * persistence helper. AchillesBrowserWindow does not include these
   * in its narrow interface; the main entry passes a structural adapter.
   * Tests pass a fake.
   */
  dragWindowAdapter?: {
    on(channel: "move" | "moved", cb: (...args: unknown[]) => void): void;
    getPosition(): [number, number];
  };
  /**
   * Hook invoked by IPC_UPDATE_WINDOW_POSITION when the renderer sends
   * the `{ x: -1, y: -1 }` sentinel (reset to default top-right). The
   * callback receives the computed default position and is expected to
   * call `BrowserWindow.setPosition`. Tests inject a spy.
   */
  resetWindowPosition?: (pos: { x: number; y: number }) => void;
  /**
   * Screen ref used by the reset-window-position default computation.
   * Defaults to a 1920x1080 origin-zero workArea when undefined.
   */
  screenRef?: {
    getPrimaryDisplay(): {
      workArea: { x: number; y: number; width: number; height: number };
    };
  };
  /**
   * Optional clock injection forwarded to `wireDragPersistence`. Tests
   * pass a deterministic clock so the debounce path is verifiable
   * without sleeping.
   */
  dragClock?: DragPersistClock;
  /**
   * Optional logger for invalid IPC payloads. Defaults to
   * `console.warn`. Tests inject a recording stub.
   */
  logger?: (msg: string) => void;
}

export interface IpcBridgeHandle {
  /**
   * Tear down all handlers + amplitude timers. Called from `will-quit`
   * in the main entry point.
   */
  dispose(): void;
  /**
   * Forwards a permission state to the renderer via IPC_PERMISSION_STATE.
   * Used by the boot probe + the schedulePermissionPoll callback so the
   * renderer mounts / dismisses the PermissionOverlay.
   */
  broadcastPermissionState(state: PermissionState): void;
}

export function wireIpcBridge(opts: WireIpcBridgeOptions): IpcBridgeHandle {
  const { window, controller, store, ipcMainRef } = opts;
  const log = opts.logger ?? ((msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  });

  // Track recently broadcast permission states so the schedulePermissionPoll
  // tick can deduplicate identical states (T-11-16 mitigation against a
  // permission poll storm flooding the renderer).
  let lastBroadcastPermission: PermissionState | null = null;

  // Drag persistence wiring — defaults to ON when a dragWindowAdapter is
  // supplied so the bridge owns the move→persist pipeline. Tests can opt
  // out via `enableDragPersistence: false`.
  let dragHandle: WireDragPersistenceHandle | null = null;
  if (opts.enableDragPersistence !== false && opts.dragWindowAdapter !== undefined) {
    dragHandle = wireDragPersistence({
      window: opts.dragWindowAdapter,
      store,
      emitError: (msg) => {
        window.webContents.send(IPC_ERROR, { message: msg });
      },
      logger: opts.logger,
      clock: opts.dragClock,
    });
  }

  // Amplitude streams — created lazily on state transitions so they
  // don't tick during idle/processing/error.
  let micAmplitudeStop: (() => void) | null = null;
  let ttsAmplitudeStop: (() => void) | null = null;

  function stopAmplitudeStreams(): void {
    if (micAmplitudeStop !== null) {
      micAmplitudeStop();
      micAmplitudeStop = null;
    }
    if (ttsAmplitudeStop !== null) {
      ttsAmplitudeStop();
      ttsAmplitudeStop = null;
    }
  }

  function startAmplitudeForState(state: AchillesState): void {
    stopAmplitudeStreams();
    if (state === "listening") {
      const stream = createMockAmplitudeStream("listening");
      micAmplitudeStop = stream.emit((rms) => {
        window.webContents.send(IPC_MIC_AMPLITUDE, { rms });
      });
    } else if (state === "speaking") {
      const stream = createMockAmplitudeStream("speaking");
      ttsAmplitudeStop = stream.emit((rms) => {
        window.webContents.send(IPC_TTS_AMPLITUDE, { rms });
      });
    }
  }

  // ─── Renderer → Main handlers ─────────────────────────────────────

  ipcMainRef.on(IPC_REQUEST_STATE, (_event, payload) => {
    try {
      const parsed = parseEnvelope(IPC_REQUEST_STATE, payload) as {
        state: AchillesState;
      };
      // Drive the reducer via INJECT_ERROR for 'error', ERROR_DISMISS
      // for return-to-idle on error; otherwise it's an explicit state
      // request from the renderer (cancel path).
      if (parsed.state === "error") {
        controller.dispatch({ type: "INJECT_ERROR", kind: "unknown" });
      } else if (parsed.state === "idle" && controller.now() === "error") {
        controller.dispatch({ type: "ERROR_DISMISS" });
      } else {
        // Generic fallthrough — Plan 11-02/03 may expose richer
        // request-state semantics; for now we accept the channel as
        // a test seam to drive deterministic transitions.
        if (parsed.state === "idle") {
          controller.dispatch({ type: "MOCK_PLAYBACK_DONE" });
        } else if (parsed.state === "listening") {
          controller.dispatch({ type: "HOTKEY_PRESS" });
        } else if (parsed.state === "processing") {
          controller.dispatch({ type: "MOCK_VAD_COMMIT" });
        } else if (parsed.state === "speaking") {
          controller.dispatch({ type: "MOCK_PROCESSING_COMPLETE" });
        }
      }
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_REQUEST_STATE} payload: ${
          (err as Error).message
        }`,
      );
    }
  });

  ipcMainRef.on(IPC_REGISTER_HOTKEY, (_event, payload) => {
    try {
      const parsed = parseEnvelope(IPC_REGISTER_HOTKEY, payload) as {
        accelerator: string;
      };
      store.writeHotkeyKey(parsed.accelerator);
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_REGISTER_HOTKEY} payload: ${
          (err as Error).message
        }`,
      );
    }
  });

  ipcMainRef.on(IPC_OPEN_SYSTEM_SETTINGS, (_event, payload) => {
    try {
      parseEnvelope(IPC_OPEN_SYSTEM_SETTINGS, payload);
      // Plan 11-03 swaps this stub for shell.openExternal(...). For
      // Plan 11-01 we wire the channel end-to-end without launching
      // anything (per CLAUDE.md global "never run applications
      // automatically").
      opts.openSystemSettings?.();
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_OPEN_SYSTEM_SETTINGS} payload: ${
          (err as Error).message
        }`,
      );
    }
  });

  ipcMainRef.on(IPC_UPDATE_WINDOW_POSITION, (_event, payload) => {
    try {
      const parsed = parseEnvelope(IPC_UPDATE_WINDOW_POSITION, payload) as {
        x: number;
        y: number;
      };
      // Reset sentinel: { x: -1, y: -1 } means "reset to default
      // top-right" — used by the SettingsPopover's reset button. The
      // sentinel was chosen because Electron rejects negative window
      // coordinates as invalid positions, so it cannot collide with a
      // legitimate drag result.
      if (parsed.x === -1 && parsed.y === -1) {
        const defaultPos = applyDefaultTopRight({
          screenRef: opts.screenRef,
        });
        opts.resetWindowPosition?.(defaultPos);
        store.writeWindowPosition(defaultPos);
        return;
      }
      store.writeWindowPosition({ x: parsed.x, y: parsed.y });
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_UPDATE_WINDOW_POSITION} payload: ${
          (err as Error).message
        }`,
      );
    }
  });

  ipcMainRef.on(IPC_UPDATE_HOTKEY_CONFIG, (_event, payload) => {
    try {
      const parsed = parseEnvelope(IPC_UPDATE_HOTKEY_CONFIG, payload) as {
        mode?: "toggle" | "pushToTalk";
        key?: string;
      };
      if (parsed.mode !== undefined) {
        store.writeHotkeyMode(parsed.mode);
      }
      if (parsed.key !== undefined) {
        store.writeHotkeyKey(parsed.key);
      }
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_UPDATE_HOTKEY_CONFIG} payload: ${
          (err as Error).message
        }`,
      );
    }
  });

  // ─── Main → Renderer wiring ───────────────────────────────────────

  // Patch the controller's broadcast so every transition emits the
  // state-changed channel AND swaps amplitude streams. The controller
  // was constructed with a broadcast function; we wrap it by
  // monkey-patching the state observer here. We do it via a wrapper
  // dispatch instead of mutating the original ctor to keep the seam
  // narrow.
  //
  // We listen to broadcasts by re-dispatching `controller.dispatch`
  // through a thin wrapper. For Phase 11 we instead drive the wiring
  // via initialisation order: callers wire `broadcast` directly when
  // they construct the controller (see main/index.ts). We expose a
  // helper for that here:
  function handleStateChanged(state: AchillesState): void {
    window.webContents.send(IPC_STATE_CHANGED, { state });
    startAmplitudeForState(state);
    controller.scheduleMockTransitions(state);
  }

  // Hand-rolled "observer" — the controller's broadcast callback was
  // configured by the main entry. We expose `handleStateChanged` so
  // the entry can forward state transitions here.
  (
    opts as unknown as {
      _onStateChange?: (state: AchillesState) => void;
    }
  )._onStateChange = handleStateChanged;

  function dispose(): void {
    stopAmplitudeStreams();
    controller.cancelScheduledTransitions();
    dragHandle?.dispose();
    ipcMainRef.removeAllListeners(IPC_REQUEST_STATE);
    ipcMainRef.removeAllListeners(IPC_REGISTER_HOTKEY);
    ipcMainRef.removeAllListeners(IPC_OPEN_SYSTEM_SETTINGS);
    ipcMainRef.removeAllListeners(IPC_UPDATE_WINDOW_POSITION);
    ipcMainRef.removeAllListeners(IPC_UPDATE_HOTKEY_CONFIG);
  }

  function broadcastPermissionState(state: PermissionState): void {
    if (state === lastBroadcastPermission) return;
    lastBroadcastPermission = state;
    window.webContents.send(IPC_PERMISSION_STATE, { state });
  }

  return { dispose, broadcastPermissionState };
}

/**
 * Helper for the main entry to wire the controller's broadcast +
 * amplitude swap + scheduled transition in one place. Equivalent to
 * doing it inline in main/index.ts.
 */
export function buildBroadcastHook(
  window: AchillesBrowserWindow,
  scheduleMockTransitions: (state: AchillesState) => void,
  startAmplitudeForState: (state: AchillesState) => void,
): (state: AchillesState) => void {
  return (state) => {
    window.webContents.send(IPC_STATE_CHANGED, { state });
    startAmplitudeForState(state);
    scheduleMockTransitions(state);
  };
}
