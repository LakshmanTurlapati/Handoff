/**
 * ReactiveCircle — 96px SVG circle with state-driven color tokens.
 *
 * Plan 11-02 Task 1: the dominant state cue. Each AchillesState gets a
 * distinct treatment (UI-SPEC §1):
 *
 *   - idle       — solid fill at 0.4 opacity, breathing 0.95↔1.05 over
 *                  --breathing-period (2000ms default), PAUSED when
 *                  document.visibilityState !== 'visible' (CPU save)
 *   - listening  — radial-gradient fill, scale = 0.9 + amplitude * 0.5,
 *                  glow ring tracking amplitude
 *   - processing — transparent fill, 270deg rotating ring at 1200ms per
 *                  rotation, NO amplitude scaling (visually distinct
 *                  from listening/speaking)
 *   - speaking   — radial-gradient fill, scale = 0.9 + amplitude * 0.5,
 *                  glow ring tracking amplitude
 *   - error      — stroke-only red circle with 600ms dampened shake;
 *                  shake fires once per error entry (controlled by a
 *                  setTimeout that removes the class after the
 *                  animation completes)
 *
 * The class list is derived from the props + a local visibility hook so
 * Playwright (UI-02) and unit tests (RC1-RC5) can both assert it from
 * the DOM without reading internal state.
 */
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";

import type { AchillesState } from "../../shared/constants.js";

export interface ReactiveCircleProps {
  state: AchillesState;
  /**
   * Smoothed RMS in `[0, 1]`. Only consumed when state is `'listening'`
   * or `'speaking'`; ignored otherwise (the reducer also clamps the
   * value, but the component is defensive — clamp again here so a
   * future caller that bypasses the reducer cannot drive an
   * out-of-range transform).
   */
  amplitude: number;
  onClick?: () => void;
  onRightClick?: (event: ReactMouseEvent) => void;
}

const SHAKE_DURATION_MS = 600;

/**
 * Subscribes to `visibilitychange` and returns the current
 * `document.visibilityState === 'visible'` boolean. SSR-safe — returns
 * `true` in non-browser environments so the breathing animation runs
 * during SSR-warmup (the document hasn't asked us to pause yet).
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    function handler(): void {
      setVisible(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
    };
  }, []);

  return visible;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Builds the className for the circle's root element. The class list
 * is the public surface the test suite reads (RC2).
 */
function classNamesFor(
  state: AchillesState,
  documentVisible: boolean,
  shakeActive: boolean,
): string {
  const classes: string[] = ["reactive-circle"];
  if (state === "idle" && documentVisible) {
    classes.push("breathing");
  } else if (state === "processing") {
    classes.push("spinning");
  } else if (state === "listening" || state === "speaking") {
    classes.push("amplitude-driven");
  } else if (state === "error" && shakeActive) {
    classes.push("shake");
  }
  return classes.join(" ");
}

export function ReactiveCircle({
  state,
  amplitude,
  onClick,
  onRightClick,
}: ReactiveCircleProps): ReactElement {
  const documentVisible = useDocumentVisible();
  const [shakeActive, setShakeActive] = useState<boolean>(state === "error");
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStateRef = useRef<AchillesState>(state);

  // Re-trigger the shake whenever state TRANSITIONS into 'error'. The
  // setTimeout removes the class after the keyframe completes so a
  // second error entry replays the shake from the start.
  useEffect(() => {
    if (state === "error" && previousStateRef.current !== "error") {
      setShakeActive(true);
      if (shakeTimerRef.current !== null) {
        clearTimeout(shakeTimerRef.current);
      }
      shakeTimerRef.current = setTimeout(() => {
        setShakeActive(false);
        shakeTimerRef.current = null;
      }, SHAKE_DURATION_MS);
    } else if (state !== "error") {
      if (shakeTimerRef.current !== null) {
        clearTimeout(shakeTimerRef.current);
        shakeTimerRef.current = null;
      }
      setShakeActive(false);
    }
    previousStateRef.current = state;
    return () => {
      // Cleanup on unmount.
      if (shakeTimerRef.current !== null) {
        clearTimeout(shakeTimerRef.current);
        shakeTimerRef.current = null;
      }
    };
  }, [state]);

  // Initial mount: if the consumer renders ReactiveCircle directly in
  // the error state, kick off the shake exactly once.
  useEffect(() => {
    if (state === "error") {
      setShakeActive(true);
      if (shakeTimerRef.current !== null) {
        clearTimeout(shakeTimerRef.current);
      }
      shakeTimerRef.current = setTimeout(() => {
        setShakeActive(false);
        shakeTimerRef.current = null;
      }, SHAKE_DURATION_MS);
    }
    // Run only on initial mount — subsequent state changes go through
    // the previous-state effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeAmplitude = clamp01(amplitude);
  const isAmplitudeState = state === "listening" || state === "speaking";
  const scale = isAmplitudeState ? 0.9 + safeAmplitude * 0.5 : 1;

  // Inline custom property: the components.css `.amplitude-driven`
  // selector reads --circle-scale to apply `transform: scale(var(...))`.
  // We set it inline so the value is observable via getComputedStyle /
  // style attribute in both unit and e2e tests (RC3).
  const inlineStyle = isAmplitudeState
    ? ({ ["--circle-scale" as string]: String(scale) } as React.CSSProperties)
    : undefined;

  function handleClick(_event: ReactMouseEvent): void {
    onClick?.();
  }

  function handleContextMenu(event: ReactMouseEvent): void {
    // Suppress the native context menu so the floating UI feels
    // app-like rather than browser-like.
    event.preventDefault();
    onRightClick?.(event);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Achilles ${state}`}
      data-testid="reactive-circle"
      data-state={state}
      className={classNamesFor(state, documentVisible, shakeActive)}
      style={inlineStyle}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
        <circle cx="48" cy="48" r="46" />
      </svg>
    </div>
  );
}
