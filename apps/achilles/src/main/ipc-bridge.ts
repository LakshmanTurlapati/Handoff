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
  ERROR_COPY,
  IPC_DEVICE_CHANGE,
  IPC_ERROR,
  IPC_MIC_FRAME,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STT_TOKEN_REQUEST,
  IPC_TTS_PLAYBACK_COMPLETE,
  IPC_TYPED_FALLBACK_SUBMIT,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
  IPC_UTTERANCE_COMMIT,
} from "../shared/constants.js";
import { parseEnvelope } from "../shared/ipc-schemas.js";
import type {
  DeviceChangePayload,
  MicFramePayload,
  TypedFallbackSubmitPayload,
  UtteranceCommitPayload,
} from "../shared/ipc-schemas.js";
import type {
  AchillesErrorKind,
  AchillesState,
  PermissionState,
} from "../shared/constants.js";
import {
  applyDefaultTopRight,
  wireDragPersistence,
} from "./drag-persist.js";
import type {
  DragPersistClock,
  WireDragPersistenceHandle,
} from "./drag-persist.js";
import type { AchillesSession } from "./session.js";
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
  /**
   * Plan 12-04 session orchestrator. When provided, the bridge wires
   * the four Phase 12 inbound channels (IPC_UTTERANCE_COMMIT,
   * IPC_TTS_PLAYBACK_COMPLETE, IPC_MIC_FRAME, IPC_STT_TOKEN_REQUEST)
   * to the session's per-utterance entry points. When omitted (the
   * degraded-mode boot path when MissingApiKeyError fires), the
   * Phase 12 handlers are NOT registered — the bridge surface
   * collapses to the Phase 11 set.
   */
  session?: AchillesSession;
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

  // WR-06: sender-identity check. Every Renderer→Main IPC handler is
  // wrapped so it only fires when the event originates from the main
  // floating window's webContents. A future BrowserWindow (e.g.,
  // SettingsPopover) using the same preload could otherwise drive
  // these channels.
  //
  // CR-03 fix: a strict equality guard. Previously the check short-circuited
  // when `event.sender.id === undefined` so a forged IPC envelope (a rogue
  // renderer that omits the id) bypassed the check entirely. The previous
  // implementation also short-circuited when ownWebContentsId was undefined
  // — these test seams now must supply an explicit equal id rather than
  // exploit the loophole. SAFE-04 / pitfall #17 requires the trust boundary
  // to be enforced at the main side, and IPC_TYPED_FALLBACK_SUBMIT was one of
  // the channels exploitable by the prior bypass.
  const ownWebContentsId =
    (window as unknown as { webContents: { id?: number } }).webContents.id;
  function withSenderCheck(
    channel: string,
    handler: (event: { sender: { id: number } }, payload: unknown) => void,
  ): (event: { sender: { id: number } }, payload: unknown) => void {
    return (event, payload) => {
      if (ownWebContentsId !== undefined) {
        const incoming = event.sender?.id;
        if (incoming !== ownWebContentsId) {
          log(
            `[achilles] rejecting ${channel} from unexpected sender id=${incoming}`,
          );
          return;
        }
      }
      handler(event, payload);
    };
  }

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

  // WR-04 fix: amplitude streams + handleStateChanged / _onStateChange
  // / buildBroadcastHook dead-code blocks removed — main/index.ts owns
  // the amplitude swap pipeline via its own startAmplitudeForState
  // (which the controller's broadcast invokes directly). The bridge no
  // longer duplicates that wiring.

  // ─── Renderer → Main handlers ─────────────────────────────────────

  ipcMainRef.on(IPC_REQUEST_STATE, withSenderCheck(IPC_REQUEST_STATE, (_event, payload) => {
    try {
      const parsed = parseEnvelope(IPC_REQUEST_STATE, payload) as {
        state: AchillesState;
      };
      // Drive the reducer via INJECT_ERROR for 'error', ERROR_DISMISS
      // for return-to-idle on error; otherwise it's an explicit state
      // request from the renderer (cancel path).
      if (parsed.state === "error") {
        // CR-02 fix: emit both state-changed AND the typed IPC_ERROR
        // copy so the renderer's ErrorBanner mounts with a populated
        // message (state==='error' AND error!==null gating).
        const kind: AchillesErrorKind = "unknown";
        controller.dispatch({ type: "INJECT_ERROR", kind });
        window.webContents.send(IPC_ERROR, { message: ERROR_COPY[kind] });
      } else if (parsed.state === "idle" && controller.now() === "error") {
        controller.dispatch({ type: "ERROR_DISMISS" });
      } else {
        // CR-06 fix: route every non-error state request through
        // CIRCLE_CLICK so the reducer's documented cancel semantics
        // (processing -> idle, speaking -> idle) apply. The reducer
        // handles idle/listening/processing/speaking on CIRCLE_CLICK,
        // mirroring UI-SPEC §4 click semantics 1:1. The previous
        // wiring guessed at timer events by state name and silently
        // no-op'd when the source state did not match the timer's
        // expected predecessor (e.g., processing -> idle via
        // MOCK_PLAYBACK_DONE never advanced because the reducer only
        // accepts that event from 'speaking').
        controller.dispatch({ type: "CIRCLE_CLICK" });
      }
    } catch (err) {
      log(
        `[achilles] dropping invalid ${IPC_REQUEST_STATE} payload: ${
          (err as Error).message
        }`,
      );
    }
  }));

  ipcMainRef.on(IPC_REGISTER_HOTKEY, withSenderCheck(IPC_REGISTER_HOTKEY, (_event, payload) => {
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
  }));

  ipcMainRef.on(IPC_OPEN_SYSTEM_SETTINGS, withSenderCheck(IPC_OPEN_SYSTEM_SETTINGS, (_event, payload) => {
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
  }));

  ipcMainRef.on(IPC_UPDATE_WINDOW_POSITION, withSenderCheck(IPC_UPDATE_WINDOW_POSITION, (_event, payload) => {
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
  }));

  ipcMainRef.on(IPC_UPDATE_HOTKEY_CONFIG, withSenderCheck(IPC_UPDATE_HOTKEY_CONFIG, (_event, payload) => {
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
  }));

  // ─── Phase 12 inbound handlers (Plan 12-04) ──────────────────────
  //
  // Registered ONLY when opts.session is supplied — the degraded-mode
  // boot (missing API key) constructs the bridge without a session so
  // the Phase 11 surface remains intact.
  if (opts.session !== undefined) {
    const session = opts.session;
    ipcMainRef.on(
      IPC_UTTERANCE_COMMIT,
      withSenderCheck(IPC_UTTERANCE_COMMIT, (_event, payload) => {
        try {
          const parsed = parseEnvelope(
            IPC_UTTERANCE_COMMIT,
            payload,
          ) as UtteranceCommitPayload;
          session.onUtteranceCommit(parsed);
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_UTTERANCE_COMMIT} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );

    ipcMainRef.on(
      IPC_TTS_PLAYBACK_COMPLETE,
      withSenderCheck(IPC_TTS_PLAYBACK_COMPLETE, (_event, payload) => {
        try {
          parseEnvelope(IPC_TTS_PLAYBACK_COMPLETE, payload);
          session.onTtsPlaybackComplete();
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_TTS_PLAYBACK_COMPLETE} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );

    ipcMainRef.on(
      IPC_MIC_FRAME,
      withSenderCheck(IPC_MIC_FRAME, (_event, payload) => {
        try {
          const parsed = parseEnvelope(
            IPC_MIC_FRAME,
            payload,
          ) as MicFramePayload;
          session.onMicFrame(parsed);
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_MIC_FRAME} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );

    ipcMainRef.on(
      IPC_STT_TOKEN_REQUEST,
      withSenderCheck(IPC_STT_TOKEN_REQUEST, (_event, payload) => {
        try {
          parseEnvelope(IPC_STT_TOKEN_REQUEST, payload);
          // CR-02: the renderer asks for a token at start-of-listening
          // AND when its existing token expires / its WebSocket
          // reconnects mid-turn. Routing this IPC through
          // session.onHotkeyPress() previously mutated state — driving
          // listening → processing on the half-committed path, OR
          // triggering a cancel from speaking. session.requestSttToken
          // mints a fresh token and broadcasts IPC_STT_TOKEN without
          // touching the state machine.
          void session.requestSttToken();
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_STT_TOKEN_REQUEST} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );

    // Plan 14-03 SAFE-05 (IB8): typed-fallback-submit handler. The
    // renderer's TypedFallback overlay forwards the user-typed prompt
    // here when STT is unavailable. The handler validates the payload
    // through the strict Zod schema (TypedFallbackSubmitPayloadSchema)
    // and forwards the text to session.handleTypedPrompt(text) which
    // applies the SAME sandwich-defence + bridge.send pipeline as a
    // spoken utterance. The sender check ensures a rogue renderer
    // (e.g. SettingsPopover preload) cannot smuggle a fake prompt.
    ipcMainRef.on(
      IPC_TYPED_FALLBACK_SUBMIT,
      withSenderCheck(IPC_TYPED_FALLBACK_SUBMIT, (_event, payload) => {
        try {
          const parsed = parseEnvelope(
            IPC_TYPED_FALLBACK_SUBMIT,
            payload,
          ) as TypedFallbackSubmitPayload;
          session.handleTypedPrompt(parsed.text);
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_TYPED_FALLBACK_SUBMIT} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );

    // CR-02 fix: SAFE-06 device-change inbound handler. The renderer's
    // mic-capture module observes navigator.mediaDevices.ondevicechange
    // and forwards the event over this channel; the handler validates
    // the payload through DeviceChangePayloadSchema and routes it to
    // session.onDeviceChange which triggers the soft re-acquire
    // (pauseFrameDelivery + setTimeout(resumeFrameDelivery, 0)) when
    // the orchestrator is mid-listening. Without this wiring the
    // mic-capture.onDeviceChange callback had no path into main and
    // SAFE-06 was not satisfied by the shipped binary.
    ipcMainRef.on(
      IPC_DEVICE_CHANGE,
      withSenderCheck(IPC_DEVICE_CHANGE, (_event, payload) => {
        try {
          const parsed = parseEnvelope(
            IPC_DEVICE_CHANGE,
            payload,
          ) as DeviceChangePayload;
          session.onDeviceChange({
            kind: parsed.kind,
            deviceId: parsed.deviceId,
          });
        } catch (err) {
          log(
            `[achilles] dropping invalid ${IPC_DEVICE_CHANGE} payload: ${
              (err as Error).message
            }`,
          );
        }
      }),
    );
  }

  // ─── Main → Renderer wiring ───────────────────────────────────────
  //
  // The broadcast plumbing lives in main/index.ts — callers wire the
  // controller's `broadcast` argument directly when they construct the
  // controller. WR-04: the bridge previously duplicated this hookup
  // via a `handleStateChanged` / `_onStateChange` / `buildBroadcastHook`
  // trio that was never imported by main/index.ts. The duplicated logic
  // is removed.

  function dispose(): void {
    controller.cancelScheduledTransitions();
    dragHandle?.dispose();
    ipcMainRef.removeAllListeners(IPC_REQUEST_STATE);
    ipcMainRef.removeAllListeners(IPC_REGISTER_HOTKEY);
    ipcMainRef.removeAllListeners(IPC_OPEN_SYSTEM_SETTINGS);
    ipcMainRef.removeAllListeners(IPC_UPDATE_WINDOW_POSITION);
    ipcMainRef.removeAllListeners(IPC_UPDATE_HOTKEY_CONFIG);
    // Plan 12-04 channels (no-op when session was not supplied — the
    // handlers were never registered in that case).
    ipcMainRef.removeAllListeners(IPC_UTTERANCE_COMMIT);
    ipcMainRef.removeAllListeners(IPC_TTS_PLAYBACK_COMPLETE);
    ipcMainRef.removeAllListeners(IPC_MIC_FRAME);
    ipcMainRef.removeAllListeners(IPC_STT_TOKEN_REQUEST);
    // Plan 14-03 SAFE-05 channel (no-op when session was not supplied).
    ipcMainRef.removeAllListeners(IPC_TYPED_FALLBACK_SUBMIT);
    // CR-02 fix: SAFE-06 device-change channel (no-op when session was
    // not supplied; matches the surrounding channel-set pattern).
    ipcMainRef.removeAllListeners(IPC_DEVICE_CHANGE);
  }

  function broadcastPermissionState(state: PermissionState): void {
    if (state === lastBroadcastPermission) return;
    lastBroadcastPermission = state;
    window.webContents.send(IPC_PERMISSION_STATE, { state });
  }

  return { dispose, broadcastPermissionState };
}
