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
  IPC_MIC_AMPLITUDE,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_TTS_AMPLITUDE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
} from "../shared/constants.js";
import { parseEnvelope } from "../shared/ipc-schemas.js";
import type { AchillesState } from "../shared/constants.js";
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
   * Hook the IPC bridge can call when the renderer asks main to open
   * the system mic settings panel. Plan 11-03 ships the real
   * `shell.openExternal(...)` implementation; Plan 11-01 ships a
   * default no-op stub so the channel is wired end-to-end.
   */
  openSystemSettings?: () => void;
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
}

export function wireIpcBridge(opts: WireIpcBridgeOptions): IpcBridgeHandle {
  const { window, controller, store, ipcMainRef } = opts;
  const log = opts.logger ?? ((msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  });

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
    ipcMainRef.removeAllListeners(IPC_REQUEST_STATE);
    ipcMainRef.removeAllListeners(IPC_REGISTER_HOTKEY);
    ipcMainRef.removeAllListeners(IPC_OPEN_SYSTEM_SETTINGS);
    ipcMainRef.removeAllListeners(IPC_UPDATE_WINDOW_POSITION);
    ipcMainRef.removeAllListeners(IPC_UPDATE_HOTKEY_CONFIG);
  }

  return { dispose };
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
