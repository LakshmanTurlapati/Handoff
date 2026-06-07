/**
 * Achilles state-machine reducer + mocked runtime controller.
 *
 * The reducer (`transition`) is a pure function: given the current
 * `AchillesState`, an `AchillesEvent`, and the current `HotkeyMode`,
 * it returns the next `AchillesState`. No side effects, no timers,
 * no IPC. This is the single source of truth Plans 11-02 and 11-03
 * import from `apps/achilles/src/main/state-machine.ts`.
 *
 * The runtime wrapper (`createMockStateController`) layers the
 * Phase-11 mock behaviour on top of the pure reducer: deterministic
 * fixture timers for listening → processing → speaking → idle so the
 * Playwright suite can drive the visible states without launching a
 * real voice loop. Phase 12 will replace the mock timers with real
 * STT / Claude / TTS transitions but the reducer stays.
 */
import {
  ERROR_AUTO_DISMISS_MS,
  LISTENING_VAD_DELAY_MS,
  PROCESSING_DELAY_MS,
  SPEAKING_DELAY_MS,
} from "../shared/constants.js";
import type {
  AchillesState,
  HotkeyMode,
  PermissionState,
} from "../shared/constants.js";

/**
 * Error kinds the mocked test seam (`__test_inject_error`) can
 * surface. The kinds match the UI-SPEC section 8 banner copy map so
 * Plan 11-03 can wire each kind to its specific banner string without
 * negotiating a parallel taxonomy.
 */
export type AchillesErrorKind =
  | "mic_unavailable"
  | "hotkey_collision"
  | "persistence_failure"
  | "unknown";

/**
 * Discriminated union over every event the reducer can consume.
 *
 *   - HOTKEY_PRESS / HOTKEY_RELEASE — driven by the global hotkey
 *     watcher in main/hotkey.ts; release is meaningful only in PTT.
 *   - CIRCLE_CLICK — pointer-events: auto re-enables the circle as
 *     a click target; UI-SPEC s4 documents the click semantics per
 *     state.
 *   - MOCK_VAD_COMMIT / MOCK_PROCESSING_COMPLETE / MOCK_PLAYBACK_DONE
 *     — the three deterministic timer ticks emitted by the mock
 *     controller below. Phase 12 swaps these for real VAD + Claude
 *     completion + TTS playback signals.
 *   - INJECT_ERROR — the `__test_inject_error` test seam.
 *   - ERROR_DISMISS — the user clicks the error banner's Dismiss
 *     button; reducer returns to idle.
 *   - PERMISSION_CHANGED — sidechannel from the OS mic permission
 *     check. The reducer ignores this event for state transitions
 *     (permission state is rendered as an overlay above whatever
 *     `AchillesState` is current; see UI-SPEC s6).
 */
export type AchillesEvent =
  | { type: "HOTKEY_PRESS" }
  | { type: "HOTKEY_RELEASE" }
  | { type: "CIRCLE_CLICK" }
  | { type: "MOCK_VAD_COMMIT" }
  | { type: "MOCK_PROCESSING_COMPLETE" }
  | { type: "MOCK_PLAYBACK_DONE" }
  // Plan 12-04 production event tags. The MOCK_* variants above remain
  // intact for Phase 11 Playwright back-compat; the production
  // orchestrator (session.ts) dispatches the four tags below instead.
  //
  //   - STT_COMMITTED          listening  → processing
  //   - CLAUDE_RESULT_READY    processing → speaking
  //   - TTS_PLAYBACK_DRAINED   speaking   → idle
  //   - CLAUDE_FAILURE_OVERRIDE processing → speaking with the orchestrator
  //                              consulting `reason` to know the spoken
  //                              summary should be the PROMPT-05 override
  //                              ("I ran into a problem. <reason>") rather
  //                              than the LLM's <spoken-summary> body.
  //                              The reducer itself does NOT carry the
  //                              override flag — it only signals the state
  //                              transition; session.ts owns the flag
  //                              alongside the dispatch call.
  | { type: "STT_COMMITTED"; transcript: string }
  | { type: "CLAUDE_RESULT_READY" }
  | { type: "TTS_PLAYBACK_DRAINED" }
  | { type: "CLAUDE_FAILURE_OVERRIDE"; reason: string }
  | { type: "INJECT_ERROR"; kind: AchillesErrorKind }
  | { type: "ERROR_DISMISS" }
  | { type: "PERMISSION_CHANGED"; state: PermissionState };

/**
 * Pure reducer: (current, event, mode) → next.
 *
 * Exhaustively switches on `event.type` so adding an event tag without
 * updating this switch is a compile-time error (the trailing
 * `_exhaustive: never` assignment).
 *
 * Behaviour table (mirrors the 10 behaviour tests in
 * state-machine.test.ts and UI-SPEC s4):
 *
 *   - HOTKEY_PRESS:
 *       idle      → listening
 *       listening → processing (toggle commits the in-flight utterance)
 *       other     → unchanged
 *   - HOTKEY_RELEASE:
 *       listening + pushToTalk → processing
 *       any other              → unchanged
 *   - CIRCLE_CLICK:
 *       idle       → listening   (UI-SPEC s4 row 1)
 *       listening  → processing  (UI-SPEC s4 row 2, toggle commits)
 *       processing → idle        (UI-SPEC s4 row 3 cancel)
 *       speaking   → idle        (UI-SPEC s4 row 4 cancel)
 *       error      → unchanged   (use the banner Dismiss button)
 *   - MOCK_VAD_COMMIT:           listening → processing
 *   - MOCK_PROCESSING_COMPLETE:  processing → speaking
 *   - MOCK_PLAYBACK_DONE:        speaking → idle
 *   - STT_COMMITTED:             listening → processing  (Plan 12-04 prod)
 *   - CLAUDE_RESULT_READY:       processing → speaking   (Plan 12-04 prod)
 *   - TTS_PLAYBACK_DRAINED:      speaking → idle         (Plan 12-04 prod)
 *   - CLAUDE_FAILURE_OVERRIDE:   processing → speaking   (Plan 12-04 prod)
 *                                 — reason payload is informational only;
 *                                 the orchestrator inspects it separately
 *                                 to know the spoken summary must be the
 *                                 PROMPT-05 override
 *   - INJECT_ERROR:              ANY → error      (test seam)
 *   - ERROR_DISMISS:             error → idle
 *   - PERMISSION_CHANGED:        unchanged        (sidechannel)
 *
 * Unknown event tags throw — the reducer is exhaustively switched
 * and any unknown tag means a caller broke the contract.
 */
export function transition(
  current: AchillesState,
  event: AchillesEvent,
  hotkeyMode: HotkeyMode,
): AchillesState {
  switch (event.type) {
    case "HOTKEY_PRESS":
      if (current === "idle") return "listening";
      if (current === "listening") return "processing";
      return current;

    case "HOTKEY_RELEASE":
      if (current === "listening" && hotkeyMode === "pushToTalk") {
        return "processing";
      }
      return current;

    case "CIRCLE_CLICK":
      if (current === "idle") return "listening";
      if (current === "listening") return "processing";
      if (current === "processing") return "idle";
      if (current === "speaking") return "idle";
      return current;

    case "MOCK_VAD_COMMIT":
      if (current === "listening") return "processing";
      return current;

    case "MOCK_PROCESSING_COMPLETE":
      if (current === "processing") return "speaking";
      return current;

    case "MOCK_PLAYBACK_DONE":
      if (current === "speaking") return "idle";
      return current;

    // ─── Plan 12-04 production tags (orchestrator-driven) ─────────────
    case "STT_COMMITTED":
      if (current === "listening") return "processing";
      return current;

    case "CLAUDE_RESULT_READY":
      if (current === "processing") return "speaking";
      return current;

    case "TTS_PLAYBACK_DRAINED":
      if (current === "speaking") return "idle";
      return current;

    case "CLAUDE_FAILURE_OVERRIDE":
      // The reducer treats the failure-override path identically to
      // CLAUDE_RESULT_READY at the state-transition layer: processing →
      // speaking. The orchestrator (session.ts) carries the override
      // flag separately so the spoken summary text is the locked
      // "I ran into a problem. <reason>" body rather than the LLM's
      // <spoken-summary> body. The `reason` payload is informational
      // for the orchestrator only — the reducer ignores it.
      if (current === "processing") return "speaking";
      return current;

    case "INJECT_ERROR":
      return "error";

    case "ERROR_DISMISS":
      if (current === "error") return "idle";
      return current;

    case "PERMISSION_CHANGED":
      return current;

    default: {
      const _exhaustive: never = event;
      const tag =
        (event as { type?: unknown }).type === undefined
          ? "<missing type>"
          : String((event as { type?: unknown }).type);
      throw new Error(
        `Unknown AchillesEvent: ${tag} (exhaustiveness gap: ${String(_exhaustive)})`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mocked runtime controller
// ─────────────────────────────────────────────────────────────────────

/**
 * Constructor options for `createMockStateController`.
 *
 *   - broadcast: invoked with every committed state change so the
 *     IPC bridge can fan out to the renderer.
 *   - emitAmplitude: invoked with [0, 1] RMS values during listening
 *     and speaking; ignored by the renderer outside those states.
 *   - getMode: returns the current `HotkeyMode`; lets the reducer be
 *     PTT-aware without owning persistence.
 *   - now: optional clock injection for tests (defaults to Date.now).
 *   - setTimeoutImpl / clearTimeoutImpl: optional timer injection so
 *     tests can drive the fixture timeline deterministically.
 */
export interface MockStateControllerOptions {
  broadcast: (state: AchillesState) => void;
  emitAmplitude?: (rms: number) => void;
  getMode: () => HotkeyMode;
  now?: () => number;
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (token: unknown) => void;
}

export interface MockStateController {
  dispatch(event: AchillesEvent): AchillesState;
  now(): AchillesState;
  scheduleMockTransitions(state: AchillesState): void;
  cancelScheduledTransitions(): void;
}

/**
 * Production controller — Plan 12-04. Same surface as
 * createMockStateController but the fixture timer scheduling is a
 * no-op so the orchestrator (session.ts) drives every transition.
 *
 * createSessionStateController is wired by main/index.ts in the
 * production path. The Phase 11 Playwright e2e suite continues to use
 * createMockStateController so the fixture-timer back-compat path is
 * exercised; Plan 12-04 does NOT change createMockStateController.
 */
export function createSessionStateController(
  opts: Omit<MockStateControllerOptions, "setTimeoutImpl" | "clearTimeoutImpl">,
): MockStateController {
  // Force the underlying mock controller's timer scheduling to be a
  // no-op: setTimeout returns a token but never fires, and clearTimeout
  // is a no-op. The session orchestrator dispatches the production
  // tags directly so the timer-based MOCK_VAD_COMMIT / MOCK_PROCESSING_COMPLETE
  // / MOCK_PLAYBACK_DONE sequence never advances in production.
  return createMockStateController({
    ...opts,
    setTimeoutImpl: () => null,
    clearTimeoutImpl: () => undefined,
  });
}

export function createMockStateController(
  opts: MockStateControllerOptions,
): MockStateController {
  let state: AchillesState = "idle";
  let pendingToken: unknown = null;

  const setT =
    opts.setTimeoutImpl ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown);
  const clearT =
    opts.clearTimeoutImpl ??
    ((token: unknown) => clearTimeout(token as ReturnType<typeof setTimeout>));

  function commit(next: AchillesState): void {
    if (next === state) return;
    state = next;
    opts.broadcast(state);
  }

  function dispatch(event: AchillesEvent): AchillesState {
    const next = transition(state, event, opts.getMode());
    commit(next);
    return state;
  }

  function cancelScheduledTransitions(): void {
    if (pendingToken !== null) {
      clearT(pendingToken);
      pendingToken = null;
    }
  }

  function scheduleMockTransitions(forState: AchillesState): void {
    cancelScheduledTransitions();
    if (forState === "listening") {
      pendingToken = setT(() => {
        pendingToken = null;
        dispatch({ type: "MOCK_VAD_COMMIT" });
      }, LISTENING_VAD_DELAY_MS);
    } else if (forState === "processing") {
      pendingToken = setT(() => {
        pendingToken = null;
        dispatch({ type: "MOCK_PROCESSING_COMPLETE" });
      }, PROCESSING_DELAY_MS);
    } else if (forState === "speaking") {
      pendingToken = setT(() => {
        pendingToken = null;
        dispatch({ type: "MOCK_PLAYBACK_DONE" });
      }, SPEAKING_DELAY_MS);
    } else if (forState === "error") {
      pendingToken = setT(() => {
        pendingToken = null;
        dispatch({ type: "ERROR_DISMISS" });
      }, ERROR_AUTO_DISMISS_MS);
    }
  }

  return {
    dispatch,
    now: () => state,
    scheduleMockTransitions,
    cancelScheduledTransitions,
  };
}
