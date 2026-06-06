---
phase: 11-floating-ui-shell
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/achilles/src/main/window.ts
  - apps/achilles/src/main/state-machine.ts
  - apps/achilles/src/main/hotkey.ts
  - apps/achilles/src/main/store.ts
  - apps/achilles/src/main/drag-persist.ts
  - apps/achilles/src/main/permission.ts
  - apps/achilles/src/main/mock-amplitude.ts
  - apps/achilles/src/main/ipc-bridge.ts
  - apps/achilles/src/main/settings-popover-window.ts
  - apps/achilles/src/main/index.ts
  - apps/achilles/src/preload/index.ts
  - apps/achilles/src/preload/global.ts
  - apps/achilles/src/shared/ipc-schemas.ts
  - apps/achilles/src/shared/constants.ts
  - apps/achilles/src/renderer/main.tsx
  - apps/achilles/src/renderer/App.tsx
  - apps/achilles/src/renderer/bridge.ts
  - apps/achilles/src/renderer/state/useAchillesState.ts
  - apps/achilles/src/renderer/components/FloatingShell.tsx
  - apps/achilles/src/renderer/components/ReactiveCircle.tsx
  - apps/achilles/src/renderer/components/Waveform.tsx
  - apps/achilles/src/renderer/components/TranscriptOverlay.tsx
  - apps/achilles/src/renderer/components/PermissionOverlay.tsx
  - apps/achilles/src/renderer/components/SettingsPopover.tsx
  - apps/achilles/src/renderer/components/ErrorBanner.tsx
  - apps/achilles/src/renderer/components/DragHandle.tsx
  - apps/achilles/src/renderer/components/MockAnalyser.ts
  - apps/achilles/src/renderer/styles/tokens.css
  - apps/achilles/src/renderer/styles/components.css
  - apps/achilles/src/renderer/styles/overlays.css
  - apps/achilles/package.json
  - apps/achilles/electron.vite.config.ts
  - apps/achilles/vite.headless.config.ts
  - apps/achilles/playwright.config.ts
  - apps/achilles/tsconfig.json
  - apps/achilles/tsconfig.node.json
  - apps/achilles/tsconfig.web.json
findings:
  critical: 8
  warning: 13
  info: 5
  total: 26
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

The floating UI shell ships the locked window contract, IPC schemas, state-machine reducer, and React composition root — and the unit-tested seams (window factory, schemas, reducer, store fallback) are clean. However the production wiring in `apps/achilles/src/main/index.ts` between the controller, the IPC bridge, and the renderer has substantial integration defects:

1. The mock state machine never auto-advances in production. `controller.scheduleMockTransitions(state)` is referenced inside `ipc-bridge.ts` (via the dead `handleStateChanged` / `_onStateChange` plumb) and inside the exported `buildBroadcastHook`, but `main/index.ts` does NOT call either. Once the user presses the hotkey, the window enters `listening` and never advances. listening → processing → speaking → idle is broken at the integration layer. The Plan 11-02 e2e tests presumably pass because they drive the mock bridge directly; production drives the real controller and never schedules a single timer.
2. The state-machine error path is broken end-to-end. `IPC_REQUEST_STATE` with `state: 'error'` dispatches `INJECT_ERROR` which moves state to `error` and broadcasts `state-changed`. Nothing emits `IPC_ERROR` with the kind-mapped copy, so the renderer's `error` reducer field stays `null` and the `ErrorBanner` never mounts. The Plan 11-03 test seam (`mock-bridge.__test_inject_error`) emits both channels; the production bridge emits neither.
3. `safeStorage.isEncryptionAvailable()` is consulted at store construction, BEFORE `app.whenReady()`. The Electron docs explicitly forbid this and the call will either throw on linux without a keyring or always return `false` until ready. The encryption verdict is then frozen for the process lifetime even after the app is ready.
4. PTT mode is fundamentally unimplementable through the current wiring: the floating window has `focusable: false`, so `before-input-event` never fires on its `webContents`. The PTT key-up branch never triggers, but the code silently registers the watcher and walks past the documented PITFALLS.md #15 mitigation.
5. The persisted window position is restored verbatim with no bounds check against the current `workArea`. A position from a now-disconnected monitor traps the window off-screen on the next launch. The Settings popover anchor is computed from the parent window's position, so the Reset action is itself off-screen.
6. The processing → idle cancel path silently no-ops because `bridge.requestState('idle')` from `processing` routes to `MOCK_PLAYBACK_DONE` which the reducer only accepts from `speaking`.
7. `useMemoCleanup` in `FloatingShell.tsx` stops the `MockAnalyser` from inside the cleanup closure on every effect tear-down. Under React.StrictMode the analyser is stopped after the first cleanup pass, freezing the waveform's internal buffer for the lifetime of that memo instance.
8. The settings popover registers a `parent.on('focus', …)` listener and never removes it via `parent.off`. Every open/close cycle stacks another listener on the floating window.

Several smaller defects sit beneath these: hotkey re-registration leaks the old accelerator binding, the PTT key-component comparison is case-sensitive against `event.key` (so non-shifted single-letter accelerators never match), the duplicate `<div data-testid="floating-shell">` in `index.html` and `FloatingShell.tsx` will fail Playwright `getByTestId` strict matching, the duplicate `startAmplitudeForState` / `stopAmplitudeStreams` / `dragHandle` blocks in `ipc-bridge.ts` are dead code (unused), and the renderer HTML lacks a CSP meta tag.

The IPC schemas, store roundtrip, state-machine reducer, mock-amplitude generator, permission deep-link constants, and BrowserWindow `webPreferences` security flags all hold up. Nothing reaches `eval`, `innerHTML`, or `dangerouslySetInnerHTML`; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are correctly set on both BrowserWindow and the SettingsPopover child window; `shell.openExternal` is invoked only from main with hard-coded URLs.

## Critical Issues

### CR-01: Mock state machine never auto-advances in production

**File:** `apps/achilles/src/main/index.ts:122-129`
**Issue:** `createMockStateController` is constructed with a broadcast that emits `IPC_STATE_CHANGED` and starts the amplitude stream, but does NOT call `controller.scheduleMockTransitions(state)`. The fixture timeline (listening → processing → speaking → idle) defined in `state-machine.ts` `scheduleMockTransitions` therefore never fires. The same wiring is correctly implemented inside `ipc-bridge.ts::handleStateChanged` (lines 326-330) and the exported `buildBroadcastHook` (lines 366-376), but neither is invoked from `main/index.ts`. As a result, the user presses the hotkey, the window enters `listening`, and it stays there forever. The Plan 11-02 unit tests pass because the controller is tested with explicit `dispatch` calls; the production composition fails the LISTENING_VAD_DELAY_MS → PROCESSING_DELAY_MS → SPEAKING_DELAY_MS chain.
**Fix:**
```ts
const controller = createMockStateController({
  broadcast: (state) => {
    window.webContents.send(IPC_STATE_CHANGED, { state });
    startAmplitudeForState(state);
    controller.scheduleMockTransitions(state); // MISSING
  },
  getMode: () => store.readHotkeyMode(),
});
```
Better: import `buildBroadcastHook` from `./ipc-bridge.js` and use it directly so the wiring stays in one place.

### CR-02: Error state transition broadcasts state but never the banner copy

**File:** `apps/achilles/src/main/ipc-bridge.ts:200-227`
**Issue:** When the renderer (or any test) emits `IPC_REQUEST_STATE` with `state: 'error'`, the handler dispatches `INJECT_ERROR` (line 204). The reducer transitions to `error`; the broadcast emits `IPC_STATE_CHANGED { state: 'error' }`. Nothing emits `IPC_ERROR { message: <kind-mapped copy> }`. The renderer's `useAchillesState` reducer therefore only fires `STATE_CHANGED`, leaving `state.error = null`. In `App.tsx:144-147`, the `ErrorBanner` mounts only when `state === 'error' AND error !== null` — so the banner is silently skipped while the floating UI turns red. The mock bridge's `__test_inject_error` correctly emits both channels (`test/mocks/mock-bridge.ts:125-126`), which is why Plan 11-03 e2e tests likely pass against the mock — but production gets only half the payload.
**Fix:** Bind the error kind to the documented UI-SPEC §8 copy in `ipc-bridge.ts` and emit `IPC_ERROR` alongside the state transition:
```ts
const ERROR_COPY: Record<AchillesErrorKind, string> = {
  mic_unavailable: "Microphone not available. Check your input device.",
  hotkey_collision: "Hotkey is in use by another app. Change it in Settings.",
  persistence_failure: "Could not save window position. Settings may not persist.",
  unknown: "Something went wrong. Try again in a moment.",
};
// inside the IPC_REQUEST_STATE handler:
if (parsed.state === "error") {
  controller.dispatch({ type: "INJECT_ERROR", kind: "unknown" });
  window.webContents.send(IPC_ERROR, { message: ERROR_COPY.unknown });
}
```
Centralise the copy map in `shared/constants.ts` so renderer + main share the strings.

### CR-03: safeStorage is consulted before `app.whenReady()`

**File:** `apps/achilles/src/main/index.ts:58-67`
**Issue:** `createAchillesStore` is invoked before `await app.whenReady()`. The store factory probes encryption availability at construction (`store.ts:116-121`), calling `safeStorage.isEncryptionAvailable()`. Electron's docs explicitly say `safeStorage` is only usable after the app is ready; on linux without a keyring service the call can throw, and on darwin pre-ready it returns false. The encryption verdict is then captured for the process lifetime — even after `whenReady` resolves, the store believes encryption is unavailable and silently writes plaintext. This is a defence-in-depth regression even though Phase 11 persists only non-secret values: Phase 12's SAFE-01 contract relies on this code path.
**Fix:** Move the store factory call below `await app.whenReady()`:
```ts
await app.whenReady();
const store = createAchillesStore({
  storeCtor: Store as never,
  safeStorage: { ... },
});
```

### CR-04: PTT key-up watcher is bound to a `focusable: false` window

**File:** `apps/achilles/src/main/index.ts:179-203` (paired with `window.ts:152`)
**Issue:** The floating window is constructed with `focusable: false` (locked UI-01 contract — required so the window does not steal focus from the terminal). `before-input-event` only fires on a `webContents` when its `BrowserWindow` has keyboard focus. With `focusable: false`, the window never receives focus, the input event never fires, and the PTT key-up handler is a no-op forever. The `console.warn` defence-in-depth in `hotkey.ts:115-118` is bypassed because `webContentsKeySource` is provided — the substrate looks wired but emits no events. The CONTEXT.md "Push-to-talk uses key-up workaround per CONTEXT.md" promise is unmet. PTT mode is silently broken.
**Fix:** Two viable options:
1. Use OS-level key-up detection (e.g., `iohook`, native macOS event taps via a small native module) — outside Phase 11 scope and would require a re-plan.
2. Document PTT as Phase 14 (matching the deferred Win/Linux polish) and remove the PTT setting from the Phase 11 settings popover until the workaround lands.
At minimum, fail loudly during boot when `mode === 'pushToTalk'` on a `focusable: false` window so the user gets an immediate signal rather than a silent dead-key.

### CR-05: Persisted window position is restored with no on-screen bounds check

**File:** `apps/achilles/src/main/window.ts:191-201`
**Issue:** `createAchillesWindow` calls `win.setPosition(opts.initialPosition.x, opts.initialPosition.y)` directly when a persisted position exists. If the user previously had the floating window on a second monitor that is now disconnected — or if the persisted X/Y is negative (sentinel `{ x: -1, y: -1 }` reset path could accidentally persist) — the window appears off-screen and the user cannot drag it back. The Reset Window Position button is inside the Settings popover; the popover's anchor (`settings-popover-window.ts:143-145`) is derived from the parent's position, so the popover is also off-screen.
**Fix:** Clamp the restored position to the current `workArea`. The screen-bounds check must allow the window to be at least partially visible:
```ts
function clampToWorkArea(pos: { x: number; y: number }, wa: WorkArea, w: number, h: number): { x: number; y: number } {
  const VISIBLE_PX = 40; // require this many pixels of overlap
  const minX = wa.x - w + VISIBLE_PX;
  const maxX = wa.x + wa.width - VISIBLE_PX;
  const minY = wa.y;
  const maxY = wa.y + wa.height - VISIBLE_PX;
  return {
    x: Math.min(Math.max(pos.x, minX), maxX),
    y: Math.min(Math.max(pos.y, minY), maxY),
  };
}
```
Apply this to the persisted `initialPosition` before calling `setPosition`. Also enumerate all displays via `screen.getAllDisplays()` and accept positions inside any display's workArea, not just the primary's.

### CR-06: Circle click "cancel from processing" silently no-ops

**File:** `apps/achilles/src/renderer/components/FloatingShell.tsx:140-152` (paired with `apps/achilles/src/main/ipc-bridge.ts:209-219` and `state-machine.ts:137-139`)
**Issue:** `handleCircleClick` calls `bridge.requestState('idle')` when the state is `processing`. `IPC_REQUEST_STATE` with `state: 'idle'` routes to `MOCK_PLAYBACK_DONE` (line 212) which the reducer only accepts from `speaking` — the transition is a no-op from `processing`. UI-SPEC §4 row 3 explicitly says "processing → idle (cancel)" is the documented behaviour, but the wiring does not deliver it. The `CIRCLE_CLICK` reducer event in `state-machine.ts:122-127` DOES handle processing → idle correctly; the bridge just never routes through it.
**Fix:** Have `IPC_REQUEST_STATE` dispatch `CIRCLE_CLICK` (the semantic event) rather than guessing at the timer event by state name, OR add a dedicated cancel channel. The simplest fix:
```ts
} else if (parsed.state === "idle") {
  // Dispatch CIRCLE_CLICK from non-speaking states so the cancel
  // semantics in state-machine.ts apply.
  if (controller.now() === "speaking") {
    controller.dispatch({ type: "MOCK_PLAYBACK_DONE" });
  } else {
    controller.dispatch({ type: "CIRCLE_CLICK" });
  }
}
```
A cleaner refactor: replace `IPC_REQUEST_STATE` with a dispatch-event channel that carries the AchillesEvent tag verbatim.

### CR-07: MockAnalyser stopped by React.StrictMode cleanup; waveform freezes

**File:** `apps/achilles/src/renderer/components/FloatingShell.tsx:235-249` (paired with `MockAnalyser.ts:196-202` and `main.tsx:41`)
**Issue:** `useMemoCleanup` registers a cleanup `() => { if (next !== null) next.stop(); }`. Under React.StrictMode (active per `main.tsx:41`), every effect runs twice: mount → cleanup → mount. The cleanup pass calls `analyser.stop()` which sets `this.stopped = true` and clears the `tickHandle`. On the re-mount the same `next` (memoized analyser) is recorded again — but `tickInternal` early-returns on `this.stopped` and the `tickHandle` is gone, so the internal buffer never updates again. The Waveform's rAF loop calls `getByteFrequencyData(buffer)` which copies the dead buffer for the rest of the memo's lifetime. The visual freezes on the analyser's constructor-time snapshot.
**Fix:** Either drop the `next !== null && next.stop()` from the cleanup body (the previous-instance teardown at line 241-243 is sufficient) or move analyser ownership to a `useRef` + manual lifecycle outside React's effect double-fire semantics:
```ts
function useMemoCleanup(next: MockAnalyser | null, ref: MutableRefObject<MockAnalyser | null>): void {
  useEffect(() => {
    const previous = ref.current;
    if (previous !== null && previous !== next) {
      previous.stop();
    }
    ref.current = next;
    // No cleanup that stops `next` — React.StrictMode would
    // double-fire and permanently stop the live analyser.
    return undefined;
  }, [next, ref]);
}
```
The previous-instance stop on the next effect run still cleans up old analysers; final-unmount cleanup can live in a separate effect keyed on the same ref.

### CR-08: SettingsPopover parent focus listener never removed

**File:** `apps/achilles/src/main/settings-popover-window.ts:178-183`
**Issue:** `createSettingsPopoverWindow` calls `parent.on('focus', onParentFocus)` to dismiss the popover on outside click. The parent ref exposes both `on` and `off` (lines 40-41 of the same file), but the focus listener is never removed. Every time the user opens the settings popover (right-click on the circle), a new listener stacks onto the parent's `focus` event. After N open/close cycles, the parent has N listeners, each trying to `close()` an already-destroyed child window. The `isDestroyed()` guard prevents a crash, but the listener array grows unboundedly. Combined with Electron's per-process EventEmitter default max listeners warning at 10, the user will see "MaxListenersExceededWarning" after a small number of cycles.
**Fix:** Detach on popover close:
```ts
const onParentFocus = (): void => {
  if (!popover.isDestroyed()) popover.close();
};
parent.on("focus", onParentFocus);

// New: remove the listener when the popover closes.
const detachOnClose = (): void => {
  parent.off("focus", onParentFocus);
};
// Wire detachOnClose to the popover's 'closed' event. The
// SettingsPopoverChild interface needs a `once('closed', cb)` member.
```
Update `SettingsPopoverChild` to expose `on('closed', cb)` so production can hook it. The unit test should assert `parent.off` is called when the popover closes.

## Warnings

### WR-01: Duplicate `data-testid="floating-shell"` on root div and FloatingShell

**File:** `apps/achilles/src/renderer/index.html:34` (paired with `FloatingShell.tsx:182`)
**Issue:** `<div id="root" data-testid="floating-shell">` in `index.html` and `<div className="floating-shell" data-testid="floating-shell">` in `FloatingShell.tsx` both have the same test id. Playwright's `page.getByTestId('floating-shell')` resolves to the first match in DOM order (the root div), not the FloatingShell component's container. Strict-mode locators (with `strict: true`) will throw on the duplicate. Selectors that test the floating shell's children may match the wrong element.
**Fix:** Drop the `data-testid` from `index.html`'s root div — the FloatingShell component owns the test id.

### WR-02: Hotkey re-registration leaks the previous OS-level binding

**File:** `apps/achilles/src/main/hotkey.ts:106-107`
**Issue:** `registerAchillesHotkey` calls `gs.register(accelerator, onPress)` and overwrites the module-level `registeredAccelerator`. If the user changes their hotkey via Settings and `registerAchillesHotkey` is called again without first calling `unregisterAchillesHotkey`, the previous accelerator stays registered at the OS level (Electron's `globalShortcut` does not unregister implicitly). The user now has TWO global hotkeys (old + new) both triggering `onPress`. The module-level state guard does not protect against this.
**Fix:** Unregister the previous accelerator before registering the new one:
```ts
export function registerAchillesHotkey(accelerator: string, mode: HotkeyMode, ...) {
  // Defensive unregister of any prior binding.
  if (registeredAccelerator !== null) {
    gs.unregister(registeredAccelerator);
    registeredAccelerator = null;
  }
  const ok = gs.register(accelerator, onPress);
  if (ok) registeredAccelerator = accelerator;
  ...
}
```

### WR-03: PTT key-up comparison is case-sensitive against `event.key`

**File:** `apps/achilles/src/main/hotkey.ts:120-125`
**Issue:** `extractKeyComponent` returns the accelerator's suffix verbatim (e.g., `'A'` for `'CommandOrControl+Shift+A'`). The handler compares `event.key !== targetKey`. Electron's `before-input-event` `input.key` follows the Web KeyboardEvent.key spec — for un-shifted alphabetic keys it is lowercase. For the default `CommandOrControl+Shift+A`, both the suffix and the produced key are `'A'`, so the comparison happens to work — but the default is the only configuration that works. For any user-configured single-letter accelerator without Shift (e.g., `CommandOrControl+B`), `input.key === 'b'` while `targetKey === 'B'`, and the release never fires.
**Fix:** Normalise both sides to a single case before compare:
```ts
const targetKey = extractKeyComponent(accelerator).toLowerCase();
keySource.onBeforeInputEvent((event) => {
  if (event.type !== "keyUp") return;
  if (event.key.toLowerCase() !== targetKey) return;
  onRelease();
});
```
Also use `event.code` (`KeyA`) for layout-independent matching where possible.

### WR-04: `ipc-bridge.ts` contains dead amplitude and broadcast plumbing

**File:** `apps/achilles/src/main/ipc-bridge.ts:162-191, 314-339`
**Issue:** `wireIpcBridge` defines `micAmplitudeStop`, `ttsAmplitudeStop`, `stopAmplitudeStreams`, `startAmplitudeForState`, and a `handleStateChanged` function that is stored on `opts._onStateChange` via an `as unknown as { _onStateChange?: ... }` cast — none of which is consumed from outside the file. `main/index.ts` re-implements `startAmplitudeForState` (lines 105-121) and ignores the bridge's hook. The duplicated logic means a change to the amplitude policy must be made in two places, and the bridge's `dispose` (lines 341-350) calls `stopAmplitudeStreams()` on locals that are never started, then calls `controller.cancelScheduledTransitions()` which is the only meaningful cleanup. The `buildBroadcastHook` export at line 366-376 is similarly never imported.
**Fix:** Pick one owner. The cleanest path is to delete the amplitude / `handleStateChanged` / `_onStateChange` / `buildBroadcastHook` blocks from `ipc-bridge.ts` and let `main/index.ts` keep the wiring (after fixing CR-01). Alternatively, have `main/index.ts` import `buildBroadcastHook` and stop duplicating.

### WR-05: Permission poll runs forever even after `granted`

**File:** `apps/achilles/src/main/permission.ts:264-292` (paired with `main/index.ts:250-261`)
**Issue:** `schedulePermissionPoll` ticks every 2000ms for the app's lifetime; `main/index.ts` installs it and never tears it down except on `will-quit`. The docstring at `permission.ts:259-261` says "UI-SPEC §6 documents the 2000ms cadence — the overlay re-checks while visible, dismisses on 'granted'", but the implementation does not honour "while visible". Every 2 seconds a native macOS TCC query fires for the rest of the session even when the permission state is settled. This is not a security issue but it touches the platform's privacy subsystem more often than necessary.
**Fix:** Have the poll stop on `granted` and restart only when the renderer re-broadcasts a non-granted permission state from the overlay's mount. Either expose start/stop on the poll handle, or have `main/index.ts` install the poll lazily off the permission-overlay mount IPC.

### WR-06: IPC bridge does not validate sender identity

**File:** `apps/achilles/src/main/ipc-bridge.ts:195-310`
**Issue:** Every `ipcMain.on` handler accepts the payload from any frame without checking `event.senderFrame.url` or `event.sender.id`. In Electron, a compromised iframe or child window in the same app process can fire on any registered channel. The current Phase 11 setup loads only the floating window's own bundle, so the practical exposure is low — but the `webPreferences.preload` is shared by main + popover BrowserWindows, and the popover's `webContents` would also be allowed to fire these channels. Future phases that add additional renderers must not allow them to drive `IPC_UPDATE_HOTKEY_CONFIG` or `IPC_REQUEST_STATE`.
**Fix:** Check `event.sender.id === window.webContents.id` (or `event.senderFrame.url.startsWith(EXPECTED_ORIGIN)`) before dispatching:
```ts
ipcMainRef.on(IPC_REQUEST_STATE, (event, payload) => {
  if (event.sender.id !== window.webContents.id) {
    log(`[achilles] rejecting ${IPC_REQUEST_STATE} from unexpected sender id=${event.sender.id}`);
    return;
  }
  ...
});
```
Bake the check into a small `withSenderCheck` helper so every handler benefits.

### WR-07: Reset sentinel `{ x: -1, y: -1 }` collides with legitimate window coordinates

**File:** `apps/achilles/src/main/ipc-bridge.ts:267-279` (paired with `shared/ipc-schemas.ts:149-154`)
**Issue:** `UpdateWindowPositionPayloadSchema` accepts any integer x/y, and the bridge handler treats `{ -1, -1 }` as "reset to default top-right". A renderer that genuinely wants to set the window to `(-1, -1)` (e.g., to nudge slightly off-screen) would accidentally trigger a reset. The comment in `ipc-bridge.ts:270-274` claims Electron rejects negative coordinates, but Electron actually accepts negative coordinates on multi-monitor setups where the secondary display has negative X relative to the primary's origin. The "reset" semantics should not share the same channel as positional updates.
**Fix:** Add a dedicated `IPC_RESET_WINDOW_POSITION` channel with an empty payload (mirroring `IPC_OPEN_SYSTEM_SETTINGS`), and route the SettingsPopover's reset action through that. Keep `IPC_UPDATE_WINDOW_POSITION` strictly for x/y persistence.

### WR-08: SettingsPopover accelerator capture mishandles shifted symbol keys

**File:** `apps/achilles/src/renderer/components/SettingsPopover.tsx:121-148`
**Issue:** `acceleratorFromEvent` does `key.length === 1 ? key.toUpperCase() : key`. For `Cmd+Shift+1`, `event.key === '!'` (the shifted symbol) and `length === 1`, so the captured suffix is `!`. Electron accelerators expect `'1'` for numeric keys; `'!'` is not a valid suffix. The user-captured accelerator silently fails when the user later relaunches and `globalShortcut.register` rejects it. The captured config is persisted to the store, so the rejection on next launch leaves the user with no working hotkey.
**Fix:** Use `event.code` for layout-aware matching:
```ts
function suffixFromCode(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3); // KeyA -> A
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 -> 1
  if (code.startsWith("Numpad")) return `Numpad${code.slice(6)}`;
  if (code === "Space") return "Space";
  if (code.startsWith("Arrow")) return code.replace("Arrow", "");
  // …extend per Electron Accelerator docs.
  return null;
}
```
Validate the resulting accelerator with a registered Electron accelerator parser (or a lookup table) before persisting; reject capture if the suffix is unmapped.

### WR-09: Main window's `close` event is not handled; cleanup only fires on `will-quit`

**File:** `apps/achilles/src/main/index.ts:263-271`
**Issue:** All cleanup (`unregisterAchillesHotkey`, `cancelPermissionPoll`, `bridgeHandle.dispose`, `activeAmplitudeStop`) is wired to `app.on('will-quit')`. The main floating BrowserWindow's `close` event is not wired. If the user closes the window without quitting (uncommon for a panel but possible programmatically), the timers and listeners remain alive. Combined with WR-02 hotkey leak, repeated close+open cycles via dev tooling can leave global shortcuts ghosted.
**Fix:** Bind the same cleanup to the floating window's `closed` event so window-level teardown matches app-level teardown.

### WR-10: Preload silently drops invalid payloads on both ends

**File:** `apps/achilles/src/preload/index.ts:45-69`
**Issue:** Both `subscribe` and `send` catch parse failures and swallow them. The comment justifies the silent drop ("the renderer will see no effect, which surfaces the contract violation in the next state observation cycle") — but a malformed payload is rarely self-evident and the absent feedback makes debugging extremely difficult. For dev/test modes the failure should at minimum log via `console.debug('[achilles-renderer]', ...)`.
**Fix:**
```ts
try {
  const parsed = parseEnvelope(channel, raw);
  cb(parsed as T);
} catch (err) {
  console.debug(`[achilles-renderer] dropping invalid ${channel} payload`, err);
}
```
Same for `send`. The `[achilles-renderer]` prefix matches the CONTEXT.md logging convention.

### WR-11: `ELECTRON_RENDERER_URL` is loaded into the floating window without origin allow-list

**File:** `apps/achilles/src/main/index.ts:85-94`
**Issue:** `window.loadURL(process.env.ELECTRON_RENDERER_URL)` reads the URL from the environment. In dev this is set by electron-vite to localhost. In production, the env var should be unset, but a malicious or accidentally-set env var would load arbitrary remote content into the floating window. The webPreferences (sandbox, contextIsolation, nodeIntegration:false) limit blast radius, but the loaded content can still phish credentials, abuse the preload IPC channels, or impersonate the floating UI.
**Fix:** Restrict accepted URLs to `localhost` / `127.0.0.1` schemes:
```ts
const url = process.env.ELECTRON_RENDERER_URL;
if (url !== undefined) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`[achilles] refusing to load non-local renderer URL: ${url}`);
  }
  void window.loadURL(url);
}
```

### WR-12: Renderer HTML has no Content-Security-Policy

**File:** `apps/achilles/src/renderer/index.html:3-32`
**Issue:** The renderer's `<head>` does not declare a CSP meta tag. The renderer is the only piece of the floating shell that runs untrusted-shaped code; defence in depth says it should declare a strict CSP forbidding remote scripts, inline scripts (other than the entry module), and remote images. Even though the preload is sandboxed, an XSS via a future transcript injection would have free reign.
**Fix:** Add a strict CSP meta tag:
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data:;
               connect-src 'none';
               object-src 'none';
               base-uri 'none';
               frame-ancestors 'none';">
```
Tighten `style-src` once the build stops emitting inline styles.

### WR-13: DragHandle component is unused; FloatingShell ships its own inline stub

**File:** `apps/achilles/src/renderer/components/DragHandle.tsx` (paired with `FloatingShell.tsx:196-200`)
**Issue:** The `DragHandle` component (with its `no-drag` opt-out for children) is fully implemented, tested (`DragHandle.test.tsx`), and styled. But `FloatingShell.tsx` renders an inline stub `<div className="drag-handle" ...>` and never imports `DragHandle`. The comment at `FloatingShell.tsx:192-194` acknowledges Plan 11-03 was expected to swap the stub. It wasn't. The DragHandle component is dead production code — only the tests reach it.
**Fix:** Import and use `DragHandle` in `FloatingShell.tsx`:
```tsx
import { DragHandle } from "./DragHandle.js";
// ...
<DragHandle />
// or, if children needed:
<DragHandle><SettingsAffordance /></DragHandle>
```

## Info

### IN-01: `void WINDOW_WIDTH` to suppress noUnusedLocals on dead import

**File:** `apps/achilles/src/main/settings-popover-window.ts:27, 193`
**Issue:** `WINDOW_WIDTH` is imported but never referenced; the `void WINDOW_WIDTH;` statement at line 193 exists only to satisfy `noUnusedLocals`. The comment at line 191-193 says the import "exists because callers may want it for anchor math" — but no caller references it, and the file doesn't use it for its own anchor math (which uses `CIRCLE_CENTER_X` / `POPOVER_WIDTH` instead).
**Fix:** Delete the import and the `void` statement.

### IN-02: ErrorBanner docstring says `undefined` means Infinity (it doesn't)

**File:** `apps/achilles/src/renderer/components/ErrorBanner.tsx:25-29`
**Issue:** "Tests inject 0 (or `Infinity` via undefined override) to disable" — but `autoDismissMs = DEFAULT_AUTO_DISMISS_MS` (line 57) means `undefined` falls through to 8000, not Infinity. The effect's `if (autoDismissMs <= 0) return;` (line 60) is the disable mechanism. The docstring should say "pass `0` to disable".
**Fix:** Update the docstring:
```ts
/**
 * Auto-dismiss timeout in milliseconds. Default 8000 per UI-SPEC §8.
 * Pass `0` to disable the timer (tests use this to assert the
 * dismiss button is the only path).
 */
```

### IN-03: SettingsPopover keydown comment says "popover root", listener is on window

**File:** `apps/achilles/src/renderer/components/SettingsPopover.tsx:163-164, 189`
**Issue:** Comment "Attached to the popover root so the captured key does not bubble to the host page" mismatches the implementation `window.addEventListener("keydown", onKeyDown, true)`. The capture-phase listener on window actually fires BEFORE the host page; the comment's intent is preserved but the implementation describes a different mechanism.
**Fix:** Update the comment to reflect the global listener with capture-phase precedence, or attach the listener to `rootRef.current` (the popover root) and remove the unused `rootRef`.

### IN-04: `if (window.webContents && (...).webContents.on(...))` smells

**File:** `apps/achilles/src/main/index.ts:183-202`
**Issue:** The `keySource.onBeforeInputEvent` body uses `window.webContents && (...).webContents.on(...)` for side-effect short-circuit. This is a known JavaScript pattern but considered an anti-pattern in TypeScript; an explicit `if (window.webContents) { ... }` block is clearer and easier to type. The double-cast through `as unknown as { webContents: { on(...) } }` further obfuscates intent.
**Fix:** Rewrite as a clear conditional:
```ts
const keySource = {
  onBeforeInputEvent(cb) {
    if (window.webContents === undefined) return;
    window.webContents.on("before-input-event", (_event, input) => {
      cb({ type: input.type === "keyUp" ? "keyUp" : "keyDown", key: input.key });
    });
  },
};
```
Widen the `AchillesBrowserWindow` interface to include `webContents.on` so the cast goes away.

### IN-05: `colorWithOpacity` short-hex branch fails on `noUncheckedIndexedAccess`

**File:** `apps/achilles/src/renderer/components/Waveform.tsx:97-99`
**Issue:** `trimmed[1]`, `trimmed[2]`, `trimmed[3]` return `string | undefined` under strict TypeScript. The template-string coercion `${trimmed[1]}` emits the literal `"undefined"` if the index is out of range. The runtime is safe because `trimmed.length === 4` is checked, but the type-level safety relies on the implicit invariant.
**Fix:** Use explicit non-null assertion or destructure with bounds check:
```ts
const [, c1, c2, c3] = trimmed; // c1..c3: string | undefined
if (c1 === undefined || c2 === undefined || c3 === undefined) return fallback;
const hex = `#${c1}${c1}${c2}${c2}${c3}${c3}`;
```
Avoids the `noUncheckedIndexedAccess` smell.

---

_Reviewed: 2026-06-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
