/**
 * Achilles global hotkey substrate.
 *
 * UI-06 requires both press-to-toggle AND push-to-talk modes. Electron's
 * `globalShortcut.register` API only fires on key-down (this is a
 * documented limitation — see PITFALLS.md and the Electron API docs),
 * so PTT mode requires a separate key-up workaround.
 *
 * CR-04 PTT WORKAROUND (v1.2 pragmatic):
 *   The floating window is `focusable: false` so `before-input-event`
 *   on its webContents never fires (the window cannot receive
 *   keyboard focus, and the input event only flows through focused
 *   webContents). A native OS-level key-up tap (iohook, native macOS
 *   event taps) is out of scope for v1.2.
 *
 *   v1.2 implements a HOLD-DURATION HEURISTIC: every press starts a
 *   timer. If a SECOND press arrives before the heuristic threshold
 *   (default 500 ms), we interpret the first press as a momentary
 *   tap (no synthetic release). If no second press arrives by the
 *   threshold AND the consumer indicated PTT mode, we fire the
 *   synthetic release after `PTT_RELEASE_TIMEOUT_MS`. The injected
 *   webContentsKeySource is preserved for completeness — tests still
 *   exercise it, and Phase 14 may swap in a native module that fires
 *   real key-up events.
 *
 * Mode + accelerator state is persisted to electron-store under
 * `hotkeyMode` / `hotkeyKey` so the user's choice survives restarts.
 */
import type { HotkeyMode } from "../shared/constants.js";

/**
 * CR-04: heuristic hold duration. After this many milliseconds of no
 * follow-up press, the synthetic key-up fires in PTT mode. The value
 * matches the documented "best effort PTT" guarantee.
 */
export const PTT_RELEASE_TIMEOUT_MS = 500;

/**
 * Minimal interface for the Electron `globalShortcut` module. Tests
 * inject a fake; production wires the real `electron.globalShortcut`.
 */
export interface GlobalShortcutRef {
  register(accelerator: string, cb: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered(accelerator: string): boolean;
}

/**
 * Minimal interface for the renderer key-up source used in PTT mode.
 * In production this is a thin wrapper over
 * `BrowserWindow.webContents.on('before-input-event', ...)`. Tests
 * inject a fake whose `onBeforeInputEvent` callback can be invoked
 * synchronously to simulate key-up events.
 */
export interface WebContentsKeySource {
  onBeforeInputEvent(
    cb: (event: { type: "keyDown" | "keyUp"; key: string }) => void,
  ): void;
}

/**
 * Storage abstraction passed to `setHotkeyMode`. Tests inject an
 * in-memory mock; production wires `apps/achilles/src/main/store.ts`.
 */
export interface HotkeyStoreRef {
  writeHotkeyMode(mode: HotkeyMode): void;
  readHotkeyMode(): HotkeyMode;
}

interface RegisterOptions {
  globalShortcutRef?: GlobalShortcutRef;
  webContentsKeySource?: WebContentsKeySource;
  /**
   * CR-04: timer seam for the PTT hold-duration heuristic. Tests
   * inject a deterministic timer; production uses global setTimeout.
   */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (token: unknown) => void;
  /**
   * CR-04: override the PTT release timeout. Defaults to
   * PTT_RELEASE_TIMEOUT_MS (500 ms).
   */
  pttReleaseTimeoutMs?: number;
}

interface UnregisterOptions {
  globalShortcutRef?: GlobalShortcutRef;
}

// Module-level state tracks the currently registered accelerator so
// `unregisterAchillesHotkey` can clean up without the caller knowing
// the accelerator string.
let registeredAccelerator: string | null = null;

/**
 * Extracts the non-modifier suffix component from an Electron
 * accelerator string. Used by the PTT key-up watcher to decide
 * whether a given key-up event maps to the currently bound hotkey.
 *
 * Example: 'CommandOrControl+Shift+A' → 'A'
 *          'Cmd+Alt+Space'            → 'Space'
 */
function extractKeyComponent(accelerator: string): string {
  const parts = accelerator.split("+");
  return parts[parts.length - 1]!.trim();
}

/**
 * Registers the Achilles global hotkey.
 *
 *   - In 'toggle' mode: `globalShortcut.register(accelerator, onPress)`.
 *     onRelease is never invoked.
 *
 *   - In 'pushToTalk' mode (CR-04 v1.2 best-effort):
 *       1. The down-edge fires onPress and starts a hold-duration
 *          timer. If a SECOND press arrives before
 *          `PTT_RELEASE_TIMEOUT_MS` we treat the first as a
 *          momentary tap — no synthetic release.
 *       2. If no second press arrives by the threshold the synthetic
 *          release fires.
 *       3. If a `webContentsKeySource` is supplied AND it emits a
 *          real `keyUp` for the accelerator's non-modifier component,
 *          that real release pre-empts the heuristic timer. The
 *          floating window is currently `focusable: false`, so the
 *          input event never fires in production — the heuristic is
 *          the only real path. Phase 14 may swap in a native module.
 *
 *  WR-02 mitigation: any prior registration is unregistered first so
 *  changing the hotkey via Settings does not leak the previous OS-level
 *  binding.
 *  WR-03 mitigation: the key-up comparison is case-insensitive.
 */
export function registerAchillesHotkey(
  accelerator: string,
  mode: HotkeyMode,
  onPress: () => void,
  onRelease: () => void,
  opts: RegisterOptions = {},
): boolean {
  const gs = opts.globalShortcutRef;
  if (gs === undefined) {
    throw new Error(
      "registerAchillesHotkey requires globalShortcutRef in this build",
    );
  }

  // WR-02 fix: defensive unregister of any prior accelerator. Without
  // this, changing the hotkey via Settings stacks a second registration
  // at the OS level so both old and new accelerators trigger onPress.
  if (registeredAccelerator !== null) {
    gs.unregister(registeredAccelerator);
    registeredAccelerator = null;
  }

  // CR-04 PTT heuristic state. Reused across every fire of onPress so
  // the second press cancels the pending synthetic release.
  const setT =
    opts.setTimeoutImpl ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
  const clearT =
    opts.clearTimeoutImpl ??
    ((token: unknown) => clearTimeout(token as ReturnType<typeof setTimeout>));
  const pttReleaseMs = opts.pttReleaseTimeoutMs ?? PTT_RELEASE_TIMEOUT_MS;
  let pttPendingReleaseToken: unknown = null;

  function clearPttPending(): void {
    if (pttPendingReleaseToken !== null) {
      clearT(pttPendingReleaseToken);
      pttPendingReleaseToken = null;
    }
  }

  function schedulePttSyntheticRelease(): void {
    clearPttPending();
    pttPendingReleaseToken = setT(() => {
      pttPendingReleaseToken = null;
      onRelease();
    }, pttReleaseMs);
  }

  const wrappedOnPress = (): void => {
    if (mode === "pushToTalk") {
      // CR-04 v1.2: every press cancels a pending synthetic release
      // (the user is still holding / re-pressing) and schedules a
      // fresh one. The reducer sees HOTKEY_PRESS first; the synthetic
      // HOTKEY_RELEASE fires after the threshold.
      schedulePttSyntheticRelease();
    }
    onPress();
  };

  const ok = gs.register(accelerator, wrappedOnPress);
  registeredAccelerator = accelerator;

  if (mode === "pushToTalk") {
    const keySource = opts.webContentsKeySource;
    if (keySource === undefined) {
      // No real key-up source supplied — the heuristic timer is the
      // only release path. This is the production case (floating
      // window is focusable:false). Surface the limitation through a
      // single startup log so the user knows PTT is best-effort.
      // eslint-disable-next-line no-console
      console.warn(
        "[achilles] PTT mode active; using hold-duration heuristic (CR-04 v1.2 best-effort).",
      );
    } else {
      // WR-03 fix: case-insensitive key comparison so a single-letter
      // accelerator without Shift (e.g., 'CommandOrControl+B' where
      // event.key === 'b' but extractKeyComponent yields 'B') still
      // matches the real key-up.
      const targetKey = extractKeyComponent(accelerator).toLowerCase();
      keySource.onBeforeInputEvent((event) => {
        if (event.type !== "keyUp") return;
        if (event.key.toLowerCase() !== targetKey) return;
        // A real keyUp pre-empts the heuristic timer.
        clearPttPending();
        onRelease();
      });
    }
  }

  return ok;
}

/**
 * Tears down the currently registered hotkey. Safe to call when no
 * hotkey is registered (no-op).
 */
export function unregisterAchillesHotkey(opts: UnregisterOptions = {}): void {
  const gs = opts.globalShortcutRef;
  if (gs === undefined || registeredAccelerator === null) {
    registeredAccelerator = null;
    return;
  }
  gs.unregister(registeredAccelerator);
  registeredAccelerator = null;
}

/**
 * Persists the hotkey mode to the injected store. Used by the
 * settings popover IPC handler (`update-hotkey-config`) and surfaced
 * here so unit tests can verify the persistence boundary without
 * pulling in electron-store directly.
 */
export function setHotkeyMode(
  mode: HotkeyMode,
  opts: { store: HotkeyStoreRef },
): void {
  opts.store.writeHotkeyMode(mode);
}
