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
  ACHILLES_MODE_INIT,
  IPC_ERROR,
  IPC_INIT_API_KEY_RESULT,
  IPC_INIT_API_KEY_SUBMIT,
  IPC_INIT_MIC_PERMISSION_REQUEST,
  IPC_INIT_MIC_PERMISSION_RESULT,
  IPC_INIT_SMOKE_RESULT,
  IPC_INIT_SMOKE_START,
  IPC_INIT_WIZARD_DONE,
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

/**
 * Init wizard routing flag. The CLI's `achilles init` command spawns
 * the Electron binary with `ACHILLES_MODE=init` in the env; the preload
 * reads this value at module load and exposes it as `window.achilles.mode`
 * so the renderer's main.tsx can branch on it (InitWizard vs the regular
 * floating UI).
 *
 * The default is 'launch' so a fresh boot without ACHILLES_MODE in the
 * env routes to the floating shell as before (Plan 11/12 default).
 */
const mode: "init" | "launch" =
  (process as { env: Record<string, string | undefined> }).env.ACHILLES_MODE ===
  ACHILLES_MODE_INIT
    ? "init"
    : "launch";

const api = {
  /**
   * Plan 13-03: routing flag for the renderer's main.tsx. Read once at
   * preload load time from process.env.ACHILLES_MODE; the value never
   * changes within a process lifetime.
   */
  mode,
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
  // ─── Plan 13-03 init wizard surface (DIST-04) ─────────────────────
  /**
   * Renderer → Main. Submit the user-typed ElevenLabs API key from
   * Step 1 of the wizard. The bytes cross the trust boundary ONCE; the
   * matching result subscription (onInitWizardApiKeyResult) NEVER echoes
   * them back (T-13-13 mitigation pinned by the InitApiKeyResultPayloadSchema
   * which has no `key` field).
   */
  sendInitWizardApiKeySubmit(key: string): void {
    send(IPC_INIT_API_KEY_SUBMIT, { key });
  },
  /**
   * Main → Renderer. Subscribe to the API-key validation result.
   * Returns an unsubscribe function.
   */
  onInitWizardApiKeyResult(
    cb: (
      r:
        | { accepted: true }
        | { accepted: true; warning: "unexpected-prefix" }
        | { accepted: false; reason: "too-short" },
    ) => void,
  ): () => void {
    return subscribe<{
      accepted: boolean;
      reason?: "too-short";
      warning?: "unexpected-prefix";
    }>(IPC_INIT_API_KEY_RESULT, (p) => {
      if (p.accepted === false) {
        cb({ accepted: false, reason: p.reason ?? "too-short" });
        return;
      }
      if (p.warning === "unexpected-prefix") {
        cb({ accepted: true, warning: "unexpected-prefix" });
        return;
      }
      cb({ accepted: true });
    });
  },
  /**
   * Renderer → Main. Empty signal — Step 2's "Request microphone
   * access" button was clicked. Main responds by invoking the Plan
   * 11-03 probePermission helper INSIDE the Electron host (Pitfall #3:
   * macOS TCC attributes the prompt to Achilles, not the terminal).
   */
  sendInitWizardMicPermissionRequest(): void {
    send(IPC_INIT_MIC_PERMISSION_REQUEST, {});
  },
  /**
   * Main → Renderer. Subscribe to the mic permission result.
   */
  onInitWizardMicPermissionResult(
    cb: (r: { status: PermissionState }) => void,
  ): () => void {
    return subscribe<{ status: PermissionState }>(
      IPC_INIT_MIC_PERMISSION_RESULT,
      (p) => cb({ status: p.status }),
    );
  },
  /**
   * Renderer → Main. Empty signal — Step 3's "Start smoke test" button
   * was clicked.
   */
  sendInitWizardSmokeStart(): void {
    send(IPC_INIT_SMOKE_START, {});
  },
  /**
   * Main → Renderer. Subscribe to the smoke test outcome.
   */
  onInitWizardSmokeResult(
    cb: (
      r:
        | { status: "ok"; spokenPhrase: string }
        | { status: "timed-out" }
        | { status: "error" },
    ) => void,
  ): () => void {
    return subscribe<{
      status: "ok" | "timed-out" | "error";
      spokenPhrase?: string;
    }>(IPC_INIT_SMOKE_RESULT, (p) => {
      if (p.status === "ok") {
        cb({ status: "ok", spokenPhrase: p.spokenPhrase ?? "" });
      } else if (p.status === "timed-out") {
        cb({ status: "timed-out" });
      } else {
        cb({ status: "error" });
      }
    });
  },
  /**
   * Renderer → Main. Empty signal — Step 3's "Exit wizard" button was
   * clicked. Main responds by calling app.quit().
   */
  sendInitWizardDone(): void {
    send(IPC_INIT_WIZARD_DONE, {});
  },
};

contextBridge.exposeInMainWorld("achilles", api);

export type AchillesPreloadApi = typeof api;
