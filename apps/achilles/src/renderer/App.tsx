/**
 * App — composition root joining the Plan 11-02 FloatingShell with the
 * Plan 11-03 overlay slots (PermissionOverlay, ErrorBanner, SettingsPopover).
 *
 * Render contract (UI-SPEC §9 + Plan 11-03 slot wiring):
 *
 *   - The PermissionOverlay mounts when permissionState in
 *     {'denied', 'restricted'} — regardless of `state`. UI-07 says the
 *     overlay takes the full window, so the FloatingShell receives it
 *     as the `permissionOverlay` slot.
 *
 *   - The ErrorBanner mounts when state === 'error'. App.tsx looks up
 *     the locked UI-SPEC §8 copy from the error kind stored in the
 *     reducer (`error.message` already contains the resolved copy
 *     because the mock-bridge / preload pre-resolves the message
 *     before dispatching ERROR).
 *
 *   - The SettingsPopover mounts when local `popoverOpen` state is true.
 *     The onSettingsOpen callback (passed by FloatingShell when the
 *     user right-clicks the circle) updates `popoverOpen` here.
 *
 * IPC wiring (all callbacks → `getBridge()`):
 *   - PermissionOverlay CTA → bridge.openSystemSettings()
 *   - ErrorBanner dismiss → bridge.requestState('idle')
 *   - SettingsPopover mode/key change → bridge.updateHotkeyConfig({...})
 *   - SettingsPopover reset → bridge.updateWindowPosition({ x: -1, y: -1 })
 *
 * The reset uses the documented { x: -1, y: -1 } sentinel that
 * ipc-bridge.ts (Plan 11-03 update) translates to applyDefaultTopRight.
 *
 * Platform detection — best-effort via window.navigator.userAgent. We
 * only need 3 buckets ('darwin' | 'win32' | 'linux') for the overlay /
 * popover. Production wires the real Electron platform; in headless
 * tests the renderer falls back to navigator parsing.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import type { HotkeyMode } from "../shared/constants.js";
import { getBridge } from "./bridge.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { FloatingShell } from "./components/FloatingShell.js";
import { PermissionOverlay } from "./components/PermissionOverlay.js";
import { RecordingIndicator } from "./components/RecordingIndicator.js";
import { SettingsPopover } from "./components/SettingsPopover.js";
import { useAchillesState } from "./state/useAchillesState.js";

// Plan 11-03 overlay styles. Imported at the App composition root so
// the styles ship with the renderer bundle without modifying main.tsx
// (Plan 11-02 owns the renderer entry's CSS import order).
import "./styles/overlays.css";

/**
 * Resolves the renderer-side platform bucket. Production reads the
 * real platform via the preload bridge (Plan 11-01 attaches it to
 * `window.achilles.platform` in Phase 12 once the preload exposes it);
 * headless tests use navigator.userAgent.
 */
function detectPlatform(): "darwin" | "win32" | "linux" {
  if (typeof navigator === "undefined") return "darwin";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "darwin";
  if (ua.includes("win")) return "win32";
  return "linux";
}

/**
 * Default hotkey shown when the renderer-side reducer has not yet
 * received a config push (the preload bridge will broadcast the
 * persisted value once main wires it; until then, render the locked
 * Phase 11 default).
 */
const DEFAULT_HOTKEY = "CommandOrControl+Shift+A";

export function App(): ReactElement {
  const {
    state,
    permissionState,
    error,
    dispatch,
  } = useAchillesState();
  const [popoverOpen, setPopoverOpen] = useState<boolean>(false);
  // UI BLOCKER 2 fix: anchor coordinates captured from
  // onSettingsOpen(clientX, clientY). When the user triggers the
  // popover via right-click on the circle or via the settings
  // affordance, the anchor flows to SettingsPopover so the surface
  // renders near the trigger point.
  const [popoverAnchor, setPopoverAnchor] = useState<
    { x: number; y: number } | null
  >(null);

  // The persisted hotkey config is owned by main (electron-store) and
  // currently not surfaced via IPC. Plan 11-03 wires the change path
  // through the IPC bridge; the displayed values default to the
  // locked Phase 11 defaults until main pushes the persisted state.
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>("toggle");
  const [hotkeyKey, setHotkeyKey] = useState<string>(DEFAULT_HOTKEY);
  const platform = useMemo<"darwin" | "win32" | "linux">(detectPlatform, []);

  // Plan 14-02 SAFE-02: subscribe to the transcript persistence
  // broadcast. The default (until the first broadcast lands) is
  // `false` — the indicator does not flash on a fresh boot before
  // main reports the resolved flag.
  const [persistenceEnabled, setPersistenceEnabled] = useState<boolean>(false);
  useEffect(() => {
    const bridge = getBridge();
    if (bridge.onTranscriptPersistenceState === undefined) return;
    const off = bridge.onTranscriptPersistenceState((enabled) => {
      setPersistenceEnabled(enabled);
    });
    return () => {
      off();
    };
  }, []);

  const handleOpenSystemSettings = useCallback(() => {
    getBridge().openSystemSettings();
  }, []);

  const handleErrorDismiss = useCallback(() => {
    dispatch({ type: "ERROR_DISMISS" });
    getBridge().requestState("idle");
  }, [dispatch]);

  const handleHotkeyModeChange = useCallback(
    (mode: HotkeyMode) => {
      setHotkeyMode(mode);
      getBridge().updateHotkeyConfig({ mode });
    },
    [],
  );

  const handleHotkeyKeyChange = useCallback(
    (accelerator: string) => {
      setHotkeyKey(accelerator);
      getBridge().updateHotkeyConfig({ key: accelerator });
    },
    [],
  );

  const handleResetWindowPosition = useCallback(() => {
    // { x: -1, y: -1 } is the reset sentinel — main translates this to
    // `applyDefaultTopRight()` and calls window.setPosition + persists.
    getBridge().updateWindowPosition({ x: -1, y: -1 });
    setPopoverOpen(false);
  }, []);

  const handlePopoverClose = useCallback(() => {
    setPopoverOpen(false);
  }, []);

  const handleSettingsOpen = useCallback(
    (clientX: number, clientY: number) => {
      // UI BLOCKER 2 fix: persist the trigger coordinates so
      // SettingsPopover renders anchored to the affordance / circle.
      // The popover applies the UI-SPEC §7 offset internally.
      setPopoverAnchor({ x: clientX, y: clientY });
      setPopoverOpen(true);
    },
    [],
  );

  const showPermissionOverlay =
    permissionState === "denied" || permissionState === "restricted";

  const permissionOverlayNode = showPermissionOverlay ? (
    <PermissionOverlay
      permissionState={permissionState}
      platform={platform}
      onOpenSystemSettings={handleOpenSystemSettings}
    />
  ) : null;

  const errorBannerNode =
    state === "error" && error !== null ? (
      <ErrorBanner message={error.message} onDismiss={handleErrorDismiss} />
    ) : null;

  const settingsPopoverNode = popoverOpen ? (
    <SettingsPopover
      hotkeyMode={hotkeyMode}
      hotkeyKey={hotkeyKey}
      platform={platform}
      anchor={popoverAnchor}
      onHotkeyModeChange={handleHotkeyModeChange}
      onHotkeyKeyChange={handleHotkeyKeyChange}
      onResetWindowPosition={handleResetWindowPosition}
      onClose={handlePopoverClose}
    />
  ) : null;

  // Plan 14-02 SAFE-02: the RecordingIndicator renders as a sibling
  // overlay of the FloatingShell composition. The indicator is
  // positioned (top-right corner) inside the floating-shell coordinate
  // space; the CSS .floating-shell .recording-indicator selector
  // anchors it via absolute positioning so it never disrupts the
  // existing UI-SPEC s2 pixel grid for the circle / waveform /
  // transcript region. When persistence is OFF the component returns
  // null so no DOM is produced.
  return (
    <>
      <FloatingShell
        permissionOverlay={permissionOverlayNode}
        errorBanner={errorBannerNode}
        settingsPopover={settingsPopoverNode}
        onSettingsOpen={handleSettingsOpen}
      />
      <RecordingIndicator visible={persistenceEnabled} />
    </>
  );
}
