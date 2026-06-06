/**
 * FloatingShell — top-level composition root for the Achilles
 * renderer.
 *
 * Plan 11-02 Task 2: wires together the ReactiveCircle, Waveform, and
 * TranscriptOverlay against the renderer state container
 * (`useAchillesState`). The slot props (`permissionOverlay`,
 * `errorBanner`, `settingsPopover`) are how Plan 11-03 plugs in its
 * overlays without touching this component again.
 *
 * Layout pattern: every region is absolutely positioned per UI-SPEC §2
 * pixel grid. The component does NOT prop-drill state — children read
 * what they need from `useAchillesState()`. This keeps FloatingShell's
 * own props limited to the slot wiring.
 *
 * Behaviour rules (Plan 11-02 Task 2 FS1-FS4):
 *
 *   FS1: When state is 'listening' and partial is set, the partial
 *        element renders.
 *   FS2: Optional slot props render as sibling regions of the layout.
 *   FS3: When state === 'error', the transcript-overlay is hidden.
 *        When state === 'speaking' the transcript region gets its
 *        speaking-hide treatment via the overlay's own internal timer.
 *   FS4: When permissionState is denied or restricted AND a
 *        permissionOverlay slot is supplied, the core regions are
 *        hidden — the overlay takes the full window.
 */
import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from "react";

import { getBridge } from "../bridge.js";
import { useAchillesState } from "../state/useAchillesState.js";
import { DragHandle } from "./DragHandle.js";
import { MockAnalyser } from "./MockAnalyser.js";
import { ReactiveCircle } from "./ReactiveCircle.js";
import { TranscriptOverlay } from "./TranscriptOverlay.js";
import { Waveform } from "./Waveform.js";

export interface FloatingShellProps {
  /**
   * Overlay slot supplied by Plan 11-03's PermissionOverlay
   * component. Rendered as a sibling so it can stretch over the
   * window when the permission state requires it.
   */
  permissionOverlay?: ReactNode;

  /**
   * Error banner slot supplied by Plan 11-03's ErrorBanner. Rendered
   * above the core layout when `state === 'error'`.
   */
  errorBanner?: ReactNode;

  /**
   * Settings popover slot supplied by Plan 11-03's SettingsPopover.
   * The shell does not own the popover's positioning — the parent
   * passes the rendered element when it is open.
   */
  settingsPopover?: ReactNode;

  /**
   * Optional callback fired when the user right-clicks the circle.
   * Plan 11-03 wires this to open the settings popover anchored at
   * the click coordinates.
   */
  onSettingsOpen?: (clientX: number, clientY: number) => void;
}

export function FloatingShell({
  permissionOverlay,
  errorBanner,
  settingsPopover,
  onSettingsOpen,
}: FloatingShellProps): ReactElement {
  const {
    state,
    permissionState,
    micAmplitude,
    ttsAmplitude,
    partial,
    committed,
  } = useAchillesState();

  // Build the analyser once per state transition. The MockAnalyser is
  // the Phase 11 testability seam — Phase 12 replaces it with a real
  // AnalyserNode wired off getUserMedia / TTS playback. The renderer
  // never branches on which: the WaveformProps `analyser` slot accepts
  // both shapes.
  //
  // We feed the analyser the amplitude that matches the active state
  // so the bars track the same signal as the circle's scale.
  const amplitudeSourceRef = useRef<{ mic: number; tts: number }>({
    mic: 0,
    tts: 0,
  });
  amplitudeSourceRef.current.mic = micAmplitude;
  amplitudeSourceRef.current.tts = ttsAmplitude;

  const analyser = useMemo<MockAnalyser | null>(() => {
    if (state === "idle" || state === "error") return null;
    const source = (): number => {
      if (state === "listening") return amplitudeSourceRef.current.mic;
      if (state === "speaking") return amplitudeSourceRef.current.tts;
      return 0;
    };
    return new MockAnalyser({ state, amplitudeSource: source });
    // The analyser owns its own internal tick; we recreate it per
    // state transition so the previous instance's tick is GC'd via
    // its stop() call in the cleanup below.
  }, [state]);

  // When the analyser instance changes, stop the previous one.
  useMemoStopAnalyser(analyser);

  // Headless debug seam — Plan 11-02 e2e specs read this to assert
  // structural contracts (UI-04 waveform). Vite tree-shakes the branch
  // when MODE !== 'headless' or 'development', so the surface never
  // ships in production builds.
  if (typeof window !== "undefined") {
    const mode =
      typeof import.meta !== "undefined" && import.meta.env
        ? import.meta.env.MODE
        : "";
    if (mode === "headless" || mode === "development" || mode === "test") {
      (window as unknown as { __achilles_debug?: unknown }).__achilles_debug = {
        analyser,
        state,
        micAmplitude,
        ttsAmplitude,
        partial,
        committed,
      };
    }
  }

  function handleCircleClick(): void {
    // UI-SPEC §4 click semantics: in listening, click commits the
    // in-flight utterance (transition to processing). The bridge
    // request travels through the IPC schema validator.
    const bridge = getBridge();
    if (state === "listening") {
      bridge.requestState("processing");
    } else if (state === "idle") {
      bridge.requestState("listening");
    } else if (state === "processing" || state === "speaking") {
      bridge.requestState("idle");
    }
  }

  function handleRightClick(event: React.MouseEvent): void {
    onSettingsOpen?.(event.clientX, event.clientY);
  }

  function handleSettingsAffordanceClick(event: React.MouseEvent): void {
    // UI BLOCKER 1 fix: forward the affordance's screen coords so the
    // SettingsPopover anchors next to the dot button when triggered via
    // the visible fallback path (the right-click path uses
    // handleRightClick above).
    event.preventDefault();
    event.stopPropagation();
    onSettingsOpen?.(event.clientX, event.clientY);
  }

  // FS4: permission overlay full-screen replacement. When the
  // permissionOverlay slot is supplied AND permissionState is denied
  // or restricted, the core regions are hidden.
  const fullScreenPermission =
    permissionOverlay !== undefined &&
    permissionOverlay !== null &&
    (permissionState === "denied" || permissionState === "restricted");

  // FS3: transcript visibility — hidden in error, shown otherwise
  // (TranscriptOverlay applies its own speaking-hide internally).
  const showTranscript =
    state !== "error" &&
    !fullScreenPermission &&
    permissionState === "granted";

  // Pick the amplitude to feed the circle.
  const circleAmplitude =
    state === "listening"
      ? micAmplitude
      : state === "speaking"
        ? ttsAmplitude
        : 0;

  return (
    <div className="floating-shell" data-testid="floating-shell">
      {!fullScreenPermission && (
        <>
          {/*
            WR-13 fix: compose the canonical <DragHandle/> component
            instead of an inline div stub. The drag handle owns the
            `data-app-region="drag"` test seam and the `.drag-handle`
            class that applies `-webkit-app-region: drag` in Electron.
          */}
          <DragHandle />
          <ReactiveCircle
            state={state}
            amplitude={circleAmplitude}
            onClick={handleCircleClick}
            onRightClick={handleRightClick}
          />
          <Waveform state={state} analyser={analyser} />
          {showTranscript && (
            <TranscriptOverlay
              state={state}
              partial={partial}
              committed={committed}
            />
          )}
          {/*
            UI BLOCKER 1 fix: visible settings affordance (three-dot
            button) at bottom: 8, right: 12 per UI-SPEC §2. Provides a
            discoverable fallback for users who do not find the
            right-click trigger. The `.no-drag` class opts out of the
            drag region so the click reaches the button. The screen
            coordinates of the click flow through `onSettingsOpen` so
            App.tsx can anchor the popover.
          */}
          <button
            type="button"
            data-testid="settings-affordance"
            className="settings-affordance no-drag"
            aria-label="Open settings"
            onClick={handleSettingsAffordanceClick}
          >
            <span className="settings-affordance-dot" />
            <span className="settings-affordance-dot" />
            <span className="settings-affordance-dot" />
          </button>
        </>
      )}
      {permissionOverlay}
      {state === "error" && errorBanner}
      {settingsPopover}
    </div>
  );
}

/**
 * Helper that arranges to call `analyser.stop()` when the analyser
 * reference changes (or when the component unmounts). React's
 * useEffect cleanup runs after the effect is replaced — perfect for
 * the previous instance.
 */
function useMemoStopAnalyser(analyser: MockAnalyser | null): void {
  const ref = useRef<MockAnalyser | null>(analyser);
  useMemoCleanup(analyser, ref);
}

function useMemoCleanup(
  next: MockAnalyser | null,
  ref: MutableRefObject<MockAnalyser | null>,
): void {
  useEffect(() => {
    // CR-07 fix: on mount/remount restart `next` so the React.StrictMode
    // double-invocation (mount -> cleanup -> mount) does not leave the
    // analyser permanently stopped. MockAnalyser.start() is idempotent
    // when the tick is already alive, so toggle-mode never restarts
    // a running tick. The previous instance is stopped explicitly when
    // `next` changes; the cleanup below stops on both StrictMode probe
    // unmount AND real unmount — the next mount's start() restores the
    // live tick under StrictMode, while the real-unmount path stays
    // stopped because no remount runs.
    const previous = ref.current;
    if (previous !== null && previous !== next) {
      previous.stop();
    }
    ref.current = next;
    if (next !== null) {
      next.start();
    }
    return () => {
      if (next !== null) next.stop();
    };
  }, [next, ref]);
}
