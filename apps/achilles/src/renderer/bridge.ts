/**
 * Renderer bridge adapter.
 *
 * The renderer never branches on bridge identity. `getBridge()`
 * returns a single typed surface — backed by `window.achilles` in
 * production (real preload) OR by `window.__mockBridge` in headless
 * Playwright tests. Plans 11-02 + 11-03 import only `getBridge`.
 */
import type {
  AchillesState,
  PermissionState,
} from "../shared/constants.js";

export interface AchillesBridge {
  onStateChanged(cb: (s: AchillesState) => void): () => void;
  onTranscriptPartial(cb: (text: string) => void): () => void;
  onTranscriptCommitted(
    cb: (entry: { id: string; text: string; committedAt: number }) => void,
  ): () => void;
  onMicAmplitude(cb: (rms: number) => void): () => void;
  onTtsAmplitude(cb: (rms: number) => void): () => void;
  onPermissionState(cb: (p: PermissionState) => void): () => void;
  onError(cb: (msg: string) => void): () => void;
  requestState(state: AchillesState): void;
  openSystemSettings(): void;
  updateWindowPosition(pos: { x: number; y: number }): void;
  updateHotkeyConfig(cfg: {
    mode?: "toggle" | "pushToTalk";
    key?: string;
  }): void;
}

interface MockBridgeShape {
  setState(s: AchillesState): void;
  setPermission(p: PermissionState): void;
  emitPartialTranscript(text: string): void;
  emitCommittedTranscript(text: string): void;
  emitMicAmplitude(rms: number): void;
  emitTtsAmplitude(rms: number): void;
  emitError(message: string): void;
  __test_inject_error(
    kind:
      | "mic_unavailable"
      | "hotkey_collision"
      | "persistence_failure"
      | "unknown",
  ): void;
  getLastEmittedIPC(): Array<{ type: string; payload: unknown }>;
  _subscribers?: {
    state: Array<(s: AchillesState) => void>;
    permission: Array<(p: PermissionState) => void>;
    partial: Array<(text: string) => void>;
    committed: Array<(entry: {
      id: string;
      text: string;
      committedAt: number;
    }) => void>;
    micAmp: Array<(rms: number) => void>;
    ttsAmp: Array<(rms: number) => void>;
    err: Array<(msg: string) => void>;
  };
}

function mockBridgeAdapter(mock: MockBridgeShape): AchillesBridge {
  // The mock-bridge.ts module is responsible for populating the
  // `_subscribers` arrays; the adapter here just pushes/pulls from
  // them.
  const subs = mock._subscribers!;

  function subscribeArr<T>(
    arr: Array<(value: T) => void>,
    cb: (value: T) => void,
  ): () => void {
    arr.push(cb);
    return () => {
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  function recordIPC(type: string, payload: unknown): void {
    mock.getLastEmittedIPC().push({ type, payload });
  }

  return {
    onStateChanged: (cb) => subscribeArr(subs.state, cb),
    onTranscriptPartial: (cb) => subscribeArr(subs.partial, cb),
    onTranscriptCommitted: (cb) => subscribeArr(subs.committed, cb),
    onMicAmplitude: (cb) => subscribeArr(subs.micAmp, cb),
    onTtsAmplitude: (cb) => subscribeArr(subs.ttsAmp, cb),
    onPermissionState: (cb) => subscribeArr(subs.permission, cb),
    onError: (cb) => subscribeArr(subs.err, cb),
    requestState: (state) => recordIPC("request-state", { state }),
    openSystemSettings: () => recordIPC("open-system-settings", {}),
    updateWindowPosition: (pos) => recordIPC("update-window-position", pos),
    updateHotkeyConfig: (cfg) => recordIPC("update-hotkey-config", cfg),
  };
}

export function getBridge(): AchillesBridge {
  const mock = (
    window as unknown as { __mockBridge?: MockBridgeShape }
  ).__mockBridge;
  if (mock !== undefined) {
    return mockBridgeAdapter(mock);
  }
  const real = (
    window as unknown as {
      achilles?: AchillesBridge;
    }
  ).achilles;
  if (real !== undefined) {
    return real;
  }
  throw new Error(
    "[achilles-renderer] no bridge available — neither window.achilles nor window.__mockBridge is defined",
  );
}
