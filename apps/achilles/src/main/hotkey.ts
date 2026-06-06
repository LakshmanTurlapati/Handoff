/**
 * Achilles global hotkey substrate.
 *
 * UI-06 requires both press-to-toggle AND push-to-talk modes. Electron's
 * `globalShortcut.register` API only fires on key-down (this is a
 * documented limitation — see PITFALLS.md and the Electron API docs),
 * so PTT mode requires a separate key-up watcher. We use the renderer's
 * `webContents.on('before-input-event')` channel for the key-up source
 * in production; tests inject a fake watcher that emits synthetic
 * key-down/key-up events.
 *
 * Mode + accelerator state is persisted to electron-store under
 * `hotkeyMode` / `hotkeyKey` so the user's choice survives restarts.
 * Plan 11-03 wires the settings popover that mutates these keys; this
 * plan ships only the persistence + registration substrate.
 */
import type { HotkeyMode } from "../shared/constants.js";

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
 *   - In 'pushToTalk' mode: registers the same accelerator for the
 *     down edge, AND wires a key-up watcher via the injected
 *     `WebContentsKeySource`. The watcher invokes onRelease when the
 *     accelerator's non-modifier component sees a key-up.
 *
 * The implementation guarantees onRelease is wired only for PTT —
 * the toggle-mode caller never sees a synthetic release.
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

  const ok = gs.register(accelerator, onPress);
  registeredAccelerator = accelerator;

  if (mode === "pushToTalk") {
    const keySource = opts.webContentsKeySource;
    if (keySource === undefined) {
      // Defence in depth — PTT mode without a key-up source means the
      // user holds the key but the reducer will never see
      // HOTKEY_RELEASE. Loudly log instead of silently degrading.
      // eslint-disable-next-line no-console
      console.warn(
        "[achilles] PTT mode requested but no webContentsKeySource provided; key-up will not fire (UI-06 substrate)",
      );
    } else {
      const targetKey = extractKeyComponent(accelerator);
      keySource.onBeforeInputEvent((event) => {
        if (event.type !== "keyUp") return;
        if (event.key !== targetKey) return;
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
