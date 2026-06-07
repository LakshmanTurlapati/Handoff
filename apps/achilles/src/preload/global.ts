/**
 * Renderer-side ambient declarations for window.achilles and
 * window.__mockBridge.
 *
 * The preload's `contextBridge.exposeInMainWorld('achilles', api)`
 * call attaches the typed API to `window`; this module re-exports the
 * shape so the renderer + tests get typed access without `any`.
 *
 * NOTE: this file uses `.ts` (not `.d.ts`) by design — the Phase 11
 * CR-07 hygiene guard (`src/.gitignore`) excludes any `*.d.ts` inside
 * src/. TypeScript accepts `declare global` inside a regular `.ts`
 * module file as long as the module contains at least one top-level
 * import or export (the `export {}` at the end of this file is that
 * marker).
 */
import type { AchillesPreloadApi } from "./index.js";
import type {
  AchillesState,
  PermissionState,
} from "../shared/constants.js";

export interface MockAchillesBridge {
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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Window {
    /**
     * The preload exposes the full Phase 11/12 surface PLUS the Plan
     * 13-03 init wizard surface on the same `achilles` namespace. The
     * `mode` field at the top of the namespace lets the renderer's
     * main.tsx route between the floating shell (mode === 'launch') and
     * the InitWizard component (mode === 'init').
     */
    achilles?: AchillesPreloadApi;
    __mockBridge?: MockAchillesBridge;
  }
}

export {};
