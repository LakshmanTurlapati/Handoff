/**
 * Achilles renderer state container — Plan 11-02.
 *
 * The renderer is a pure projection of main's state (CONTEXT.md
 * decision). This module:
 *
 *   1. Defines the discriminated `AchillesAction` union that every
 *      renderer component dispatches against.
 *   2. Ships the pure `reducer(state, action)` function so unit tests
 *      can exercise transition logic without React rendering.
 *   3. Exports the `AchillesStateProvider` React component that wires
 *      the reducer to `getBridge()` (production or headless mock) via
 *      `useEffect` subscriptions on every Main→Renderer channel.
 *   4. Exports the `useAchillesState()` hook that returns
 *      `{ state, permissionState, micAmplitude, ttsAmplitude, partial,
 *        committed, error, dispatch }` to component consumers.
 *
 * Defence in depth (Threat T-11-08): the reducer clamps mic/TTS RMS
 * values into `[0, 1]` regardless of source so a future malicious or
 * buggy bridge cannot drive the circle's scale beyond the documented
 * range.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactElement,
  type ReactNode,
} from "react";

import type {
  AchillesState,
  PermissionState,
} from "../../shared/constants.js";
import { getBridge } from "../bridge.js";

/**
 * Maximum number of committed transcript lines retained by the
 * reducer. UI-SPEC §1 (listening row) caps the visible lines at 3 so
 * the reducer trims its committed buffer to the same length — anything
 * beyond is dropped at the source rather than rendered off-screen.
 */
const MAX_COMMITTED_VISIBLE = 3;

/**
 * Committed transcript entry shape — mirrors the IPC payload from
 * `IPC_TRANSCRIPT_COMMITTED` (constants.ts) so the reducer state is
 * round-trippable with the bridge surface.
 */
export interface CommittedTranscriptEntry {
  id: string;
  text: string;
  committedAt: number;
}

/**
 * Error envelope. Plan 11-03 surfaces this via the ErrorBanner; Plan
 * 11-02 only stores the message and clears it on `ERROR_DISMISS` or on
 * a transition back to `'idle'` (the user has moved past the error).
 */
export interface AchillesError {
  message: string;
}

export interface AchillesReducerState {
  state: AchillesState;
  permissionState: PermissionState;
  micAmplitude: number;
  ttsAmplitude: number;
  partial: string;
  committed: readonly CommittedTranscriptEntry[];
  error: AchillesError | null;
}

/**
 * Initial reducer state per US1 behaviour:
 *
 *   { state: 'idle', permissionState: 'granted', micAmplitude: 0,
 *     ttsAmplitude: 0, partial: '', committed: [], error: null }
 *
 * `'granted'` default keeps the headless tests simple — the real
 * preload bridge will fire a `PERMISSION_CHANGED` action on boot to
 * reflect the OS status.
 */
export const initialAchillesReducerState: AchillesReducerState = {
  state: "idle",
  permissionState: "granted",
  micAmplitude: 0,
  ttsAmplitude: 0,
  partial: "",
  committed: [],
  error: null,
};

/**
 * Discriminated action union. Every action originates from either:
 *
 *   - A bridge subscription (`STATE_CHANGED`, `TRANSCRIPT_*`,
 *     `*_AMPLITUDE`, `PERMISSION_CHANGED`, `ERROR`).
 *   - A user interaction handled in the component layer
 *     (`ERROR_DISMISS`).
 */
export type AchillesAction =
  | { type: "STATE_CHANGED"; state: AchillesState }
  | { type: "TRANSCRIPT_PARTIAL"; text: string }
  | { type: "TRANSCRIPT_COMMITTED"; entry: CommittedTranscriptEntry }
  | { type: "MIC_AMPLITUDE"; rms: number }
  | { type: "TTS_AMPLITUDE"; rms: number }
  | { type: "PERMISSION_CHANGED"; permission: PermissionState }
  | { type: "ERROR"; message: string }
  | { type: "ERROR_DISMISS" };

/**
 * Clamps `value` into the closed interval `[0, 1]`. Reused for both
 * mic and TTS amplitude — defence in depth against threat T-11-08
 * (Spoofing — amplitude streams).
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Pure reducer. No React, no IPC, no timers. Returns a new state
 * object on every dispatch (immutability is required because React's
 * `useReducer` uses reference equality to decide whether to re-render).
 */
export function reducer(
  state: AchillesReducerState,
  action: AchillesAction,
): AchillesReducerState {
  switch (action.type) {
    case "STATE_CHANGED": {
      // US2: A STATE_CHANGED to 'listening' resets micAmplitude to 0
      // (fresh stream — the previous run's tail value is stale).
      // Same defensive reset applies to 'speaking' for the TTS amp.
      // Transitioning to 'idle' clears any standing error (US7).
      const isFreshListening = action.state === "listening";
      const isFreshSpeaking = action.state === "speaking";
      const clearError = action.state === "idle" ? null : state.error;
      return {
        ...state,
        state: action.state,
        micAmplitude: isFreshListening ? 0 : state.micAmplitude,
        ttsAmplitude: isFreshSpeaking ? 0 : state.ttsAmplitude,
        error: clearError,
      };
    }

    case "TRANSCRIPT_PARTIAL":
      // US3: partial REPLACES the previous partial, never appends.
      return {
        ...state,
        partial: action.text,
      };

    case "TRANSCRIPT_COMMITTED": {
      // US4: append committed, clear partial. US5: cap at the most
      // recent MAX_COMMITTED_VISIBLE entries so the buffer cannot
      // grow unboundedly (the UI can only show 3 lines anyway).
      const next = [...state.committed, action.entry];
      const trimmed =
        next.length > MAX_COMMITTED_VISIBLE
          ? next.slice(-MAX_COMMITTED_VISIBLE)
          : next;
      return {
        ...state,
        partial: "",
        committed: trimmed,
      };
    }

    case "MIC_AMPLITUDE":
      // US6: clamp into [0, 1] regardless of source.
      return {
        ...state,
        micAmplitude: clamp01(action.rms),
      };

    case "TTS_AMPLITUDE":
      return {
        ...state,
        ttsAmplitude: clamp01(action.rms),
      };

    case "PERMISSION_CHANGED":
      return {
        ...state,
        permissionState: action.permission,
      };

    case "ERROR":
      // US7: An ERROR action sets error: { message }.
      return {
        ...state,
        error: { message: action.message },
      };

    case "ERROR_DISMISS":
      return {
        ...state,
        error: null,
      };

    default: {
      const _exhaustive: never = action;
      const tag =
        (action as { type?: unknown }).type === undefined
          ? "<missing type>"
          : String((action as { type?: unknown }).type);
      throw new Error(
        `Unknown AchillesAction: ${tag} (exhaustiveness gap: ${String(_exhaustive)})`,
      );
    }
  }
}

/**
 * Context value exposed to consumers of `useAchillesState`. Includes
 * the reducer's `dispatch` so child components can fire
 * `ERROR_DISMISS` (and Plan 11-03 can wire settings-driven actions).
 */
export interface AchillesContextValue extends AchillesReducerState {
  dispatch: Dispatch<AchillesAction>;
}

const AchillesContext = createContext<AchillesContextValue | null>(null);

export interface AchillesStateProviderProps {
  children: ReactNode;
}

/**
 * Wraps a subtree with the Achilles state context. On mount, subscribes
 * to every Main→Renderer channel on the bridge and forwards each event
 * through `dispatch`. On unmount, unsubscribes all listeners so React
 * Strict Mode's double-mount doesn't leak handlers.
 *
 * The bridge identity (`getBridge()` returns `window.__mockBridge` in
 * headless tests or `window.achilles` in real preload) is opaque to
 * this provider — it composes against the unified `AchillesBridge`
 * surface from `renderer/bridge.ts`.
 */
export function AchillesStateProvider({
  children,
}: AchillesStateProviderProps): ReactElement {
  const [state, dispatch] = useReducer(reducer, initialAchillesReducerState);

  useEffect(() => {
    const bridge = getBridge();
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      bridge.onStateChanged((s) => dispatch({ type: "STATE_CHANGED", state: s })),
    );
    unsubscribers.push(
      bridge.onTranscriptPartial((text) =>
        dispatch({ type: "TRANSCRIPT_PARTIAL", text }),
      ),
    );
    unsubscribers.push(
      bridge.onTranscriptCommitted((entry) =>
        dispatch({ type: "TRANSCRIPT_COMMITTED", entry }),
      ),
    );
    unsubscribers.push(
      bridge.onMicAmplitude((rms) =>
        dispatch({ type: "MIC_AMPLITUDE", rms }),
      ),
    );
    unsubscribers.push(
      bridge.onTtsAmplitude((rms) =>
        dispatch({ type: "TTS_AMPLITUDE", rms }),
      ),
    );
    unsubscribers.push(
      bridge.onPermissionState((permission) =>
        dispatch({ type: "PERMISSION_CHANGED", permission }),
      ),
    );
    unsubscribers.push(
      bridge.onError((message) => dispatch({ type: "ERROR", message })),
    );

    return () => {
      for (const off of unsubscribers) off();
    };
  }, []);

  const value = useMemo<AchillesContextValue>(
    () => ({ ...state, dispatch }),
    [state],
  );

  return createElement(
    AchillesContext.Provider,
    { value },
    children,
  );
}

/**
 * Hook returning the current Achilles state + dispatch. Throws if used
 * outside an `AchillesStateProvider` — components that need the state
 * MUST be wrapped.
 */
export function useAchillesState(): AchillesContextValue {
  const value = useContext(AchillesContext);
  if (value === null) {
    throw new Error(
      "useAchillesState must be used within an <AchillesStateProvider>",
    );
  }
  return value;
}
