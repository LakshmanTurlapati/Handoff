/**
 * Achilles preload bridge.
 *
 * `contextBridge.exposeInMainWorld('achilles', api)` exposes a typed
 * surface the renderer can call without `nodeIntegration` ever being
 * on. Every outbound payload is parsed through its matching schema
 * before crossing the boundary; every inbound subscription is wired
 * to `ipcRenderer.on` and returns an unsubscribe function so callers
 * cannot leak listeners.
 *
 * Defence in depth (SAFE-01 boundary precedent):
 *   - The schemas reject unknown fields (`.strict()` everywhere).
 *   - A compromised renderer cannot smuggle extra fields into
 *     Renderer→Main payloads — they're stripped by the parse step.
 *   - Inbound payloads are also parsed before invoking the renderer's
 *     callback, so a buggy main process cannot ship malformed data.
 */
import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_ERROR,
  IPC_MIC_AMPLITUDE,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_TRANSCRIPT_COMMITTED,
  IPC_TRANSCRIPT_PARTIAL,
  IPC_TTS_AMPLITUDE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
} from "../shared/constants.js";
import type {
  AchillesState,
  HotkeyMode,
  PermissionState,
} from "../shared/constants.js";
import { parseEnvelope } from "../shared/ipc-schemas.js";

function subscribe<T>(
  channel: string,
  cb: (payload: T) => void,
): () => void {
  const listener = (_event: unknown, raw: unknown): void => {
    try {
      const parsed = parseEnvelope(channel, raw);
      cb(parsed as T);
    } catch {
      // Drop malformed Main→Renderer payloads; the main process is
      // expected to send valid envelopes (defence in depth).
    }
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

function send(channel: string, payload: unknown): void {
  try {
    const parsed = parseEnvelope(channel, payload);
    ipcRenderer.send(channel, parsed);
  } catch {
    // Drop malformed Renderer→Main payloads; the renderer will see
    // no effect, which surfaces the contract violation in the next
    // state observation cycle.
  }
}

const api = {
  onStateChanged(cb: (s: AchillesState) => void): () => void {
    return subscribe<{ state: AchillesState }>(IPC_STATE_CHANGED, (p) =>
      cb(p.state),
    );
  },
  onTranscriptPartial(cb: (text: string) => void): () => void {
    return subscribe<{ text: string }>(IPC_TRANSCRIPT_PARTIAL, (p) =>
      cb(p.text),
    );
  },
  onTranscriptCommitted(
    cb: (entry: { id: string; text: string; committedAt: number }) => void,
  ): () => void {
    return subscribe<{ id: string; text: string; committedAt: number }>(
      IPC_TRANSCRIPT_COMMITTED,
      (p) => cb(p),
    );
  },
  onMicAmplitude(cb: (rms: number) => void): () => void {
    return subscribe<{ rms: number }>(IPC_MIC_AMPLITUDE, (p) => cb(p.rms));
  },
  onTtsAmplitude(cb: (rms: number) => void): () => void {
    return subscribe<{ rms: number }>(IPC_TTS_AMPLITUDE, (p) => cb(p.rms));
  },
  onPermissionState(cb: (p: PermissionState) => void): () => void {
    return subscribe<{ state: PermissionState }>(IPC_PERMISSION_STATE, (p) =>
      cb(p.state),
    );
  },
  onError(cb: (msg: string) => void): () => void {
    return subscribe<{ message: string }>(IPC_ERROR, (p) => cb(p.message));
  },
  requestState(state: AchillesState): void {
    send(IPC_REQUEST_STATE, { state });
  },
  registerHotkey(accelerator: string): void {
    send(IPC_REGISTER_HOTKEY, { accelerator });
  },
  openSystemSettings(): void {
    send(IPC_OPEN_SYSTEM_SETTINGS, {});
  },
  updateWindowPosition(pos: { x: number; y: number }): void {
    send(IPC_UPDATE_WINDOW_POSITION, pos);
  },
  updateHotkeyConfig(cfg: { mode?: HotkeyMode; key?: string }): void {
    send(IPC_UPDATE_HOTKEY_CONFIG, cfg);
  },
};

contextBridge.exposeInMainWorld("achilles", api);

export type AchillesPreloadApi = typeof api;
