/**
 * Achilles state-machine reducer + mocked runtime controller (v1.3 port).
 *
 * Ported verbatim from v1.2 apps/achilles/src/main/state-machine.ts with
 * exactly two adjustments per 16-RESEARCH.md "State machine port" section:
 *
 *   Adjustment 1 — Import paths: types and timing constants now resolve
 *   from "./constants.js" (the new canonical site for the v1.3 substrate)
 *   instead of the v1.2 "../shared/constants.js" Electron-app-relative
 *   path. The constants themselves are byte-for-byte identical to v1.2.
 *
 *   Adjustment 2 — `muted` as the 6th AchillesState (Option A from
 *   16-RESEARCH.md Open Question 1). A new MUTE_TOGGLE event tag is
 *   added to AchillesEvent. The reducer handles:
 *     idle  <-> muted    (toggle on/off)
 *     listening -> muted (toggle on while VAD active)
 *     muted -> idle      (returns to rest state; Phase 17 wires real
 *                         listening re-entry separately via the VAD
 *                         re-arm flow — keeping the reducer's
 *                         responsibility narrow)
 *   While the current state is muted, every event tag other than
 *   MUTE_TOGGLE and INJECT_ERROR is a no-op (returns muted unchanged).
 *   This is a defense-in-depth layer above the VAD-layer self-trigger
 *   guard described in 16-CONTEXT.md <decisions>: even if the VAD
 *   layer fails open and dispatches a spurious STT_COMMITTED, the
 *   state machine cannot exit muted via that path. INJECT_ERROR
 *   still routes to error so the user can always surface a fatal.
 *
 * The reducer (`transition`) is a pure function: given the current
 * AchillesState, an AchillesEvent, and the current HotkeyMode, it
 * returns the next AchillesState. No side effects, no timers, no IPC.
 *
 * The runtime wrapper (`createMockStateController`) layers the v1.2
 * mock behavior on top of the pure reducer: deterministic fixture
 * timers for listening -> processing -> speaking -> idle so the
 * state-machine test suite can drive the visible states without a
 * real voice loop. createSessionStateController is the production
 * surface — same shape but the fixture timer scheduling is a no-op
 * so session.ts (Phase 17) drives every transition explicitly.
 *
 * LOOP-02 invariant: zero runtime imports from any of the four voice
 * packages, the bridge wrapper, or the companion skill. The v1.2 source
 * has no such imports either, so the port preserves this property.
 *
 * No emojis (CLAUDE.md global).
 */
import {
  ERROR_AUTO_DISMISS_MS,
  LISTENING_VAD_DELAY_MS,
  PROCESSING_DELAY_MS,
  SPEAKING_DELAY_MS,
} from "./constants.js";
import type {
  AchillesState,
  HotkeyMode,
  PermissionState,
} from "./constants.js";

/**
 * Error kinds the mocked test seam (INJECT_ERROR) can surface. The
 * kinds match the v1.2 UI-SPEC section 8 banner copy map so the
 * Phase 19 inline error banner copy (ERR-01) can wire each kind to
 * its specific string without negotiating a parallel taxonomy.
 */
export type AchillesErrorKind =
  | "mic_unavailable"
  | "hotkey_collision"
  | "persistence_failure"
  | "unknown";

/**
 * Discriminated union over every event the reducer can consume.
 *
 *   - HOTKEY_PRESS / HOTKEY_RELEASE — v1.2 hotkey watcher tags. v1.3
 *     has no hotkey path (CAP-02 removed PTT/toggle), but the tags
 *     remain so the v1.2 reducer ports verbatim. Production callers
 *     in v1.3 never dispatch these; tests dispatch them for behavior
 *     coverage.
 *   - CIRCLE_CLICK — v1.2 click-on-circle tag. v1.3 has no click
 *     surface (terminal-only) but the tag remains for the same reason
 *     HOTKEY_PRESS does — the reducer is supposed to port verbatim.
 *     Deleting it would constitute a behavior change.
 *   - MOCK_VAD_COMMIT / MOCK_PROCESSING_COMPLETE / MOCK_PLAYBACK_DONE
 *     — deterministic timer ticks emitted by createMockStateController.
 *     Phase 17 keeps these for back-compat with the v1.2 test surface;
 *     production session.ts dispatches the four production tags below
 *     instead.
 *   - STT_COMMITTED          listening  -> processing  (production)
 *   - CLAUDE_RESULT_READY    processing -> speaking    (production)
 *   - TTS_PLAYBACK_DRAINED   speaking   -> idle        (production)
 *   - CLAUDE_FAILURE_OVERRIDE processing -> speaking   (production;
 *      session.ts consults the reason payload to know the spoken
 *      summary must be the "I ran into a problem. ..." override
 *      rather than the LLM body. The reducer ignores reason).
 *   - INJECT_ERROR — the __test_inject_error test seam; routes any
 *     state to error.
 *   - ERROR_DISMISS — user dismisses the error banner; error -> idle.
 *   - PERMISSION_CHANGED — sidechannel; the reducer ignores this for
 *     state transitions (permission state is rendered as an overlay
 *     above whatever AchillesState is current).
 *   - MUTE_TOGGLE (NEW, v1.3) — the `m` keypress at the Ink layer
 *     dispatches this. muted is a substate of idle in the v1.3
 *     architecture: VAD is gated off but sox keeps running so unmute
 *     is instant per CONTEXT.md <decisions> Mute control row. Only
 *     idle and listening accept the toggle because mid-utterance mute
 *     would orphan the loop; processing/speaking/error remain
 *     transparent to the toggle (the user must wait for the loop to
 *     drain to idle, OR for the error to dismiss).
 */
export type AchillesEvent =
  | { type: "HOTKEY_PRESS" }
  | { type: "HOTKEY_RELEASE" }
  | { type: "CIRCLE_CLICK" }
  | { type: "MOCK_VAD_COMMIT" }
  | { type: "MOCK_PROCESSING_COMPLETE" }
  | { type: "MOCK_PLAYBACK_DONE" }
  | { type: "STT_COMMITTED"; transcript: string }
  | { type: "CLAUDE_RESULT_READY" }
  | { type: "TTS_PLAYBACK_DRAINED" }
  | { type: "CLAUDE_FAILURE_OVERRIDE"; reason: string }
  | { type: "INJECT_ERROR"; kind: AchillesErrorKind }
  | { type: "ERROR_DISMISS" }
  | { type: "PERMISSION_CHANGED"; state: PermissionState }
  | { type: "MUTE_TOGGLE" };

/**
 * Pure reducer: (current, event, mode) -> next.
 *
 * Exhaustively switches on event.type so adding an event tag without
 * updating this switch is a compile-time error (the trailing
 * `_exhaustive: never` assignment) AND a runtime throw on unknown tags.
 *
 * Behavior table (mirrors the test suite in tests/state/state-machine.test.ts):
 *
 *   - HOTKEY_PRESS:
 *       idle      -> listening
 *       listening -> processing (toggle commits the in-flight utterance)
 *       other     -> unchanged
 *   - HOTKEY_RELEASE:
 *       listening + pushToTalk -> processing
 *       any other              -> unchanged
 *   - CIRCLE_CLICK:
 *       idle       -> listening
 *       listening  -> processing
 *       processing -> idle      (cancel)
 *       speaking   -> idle      (cancel)
 *       error      -> unchanged (use ERROR_DISMISS)
 *   - MOCK_VAD_COMMIT:           listening -> processing
 *   - MOCK_PROCESSING_COMPLETE:  processing -> speaking
 *   - MOCK_PLAYBACK_DONE:        speaking -> idle
 *   - STT_COMMITTED:             listening -> processing
 *   - CLAUDE_RESULT_READY:       processing -> speaking
 *   - TTS_PLAYBACK_DRAINED:      speaking -> idle
 *   - CLAUDE_FAILURE_OVERRIDE:   processing -> speaking
 *                                 (reason is informational only;
 *                                 session.ts inspects it separately
 *                                 to know the spoken summary must
 *                                 be the PROMPT-05 override)
 *   - INJECT_ERROR:              ANY -> error
 *   - ERROR_DISMISS:             error -> idle
 *   - PERMISSION_CHANGED:        unchanged (sidechannel)
 *   - MUTE_TOGGLE (NEW v1.3):
 *       idle      -> muted
 *       listening -> muted
 *       muted     -> idle (returns to rest, NOT to listening — Phase
 *                          17 wires real listening re-entry via the
 *                          VAD re-arm flow)
 *       other     -> unchanged (processing/speaking/error are
 *                               transparent to MUTE_TOGGLE)
 *
 * Muted-state passthrough (NEW v1.3, defense-in-depth): when current
 * is "muted", every event other than MUTE_TOGGLE and INJECT_ERROR
 * returns muted unchanged. Implemented as a single early-return guard
 * at the top of transition() so the rest of the switch stays
 * verbatim-identical to the v1.2 port.
 *
 * Unknown event tags throw — the reducer is exhaustively switched
 * and any unknown tag means a caller broke the contract.
 */
export function transition(
  current: AchillesState,
  event: AchillesEvent,
  hotkeyMode: HotkeyMode,
): AchillesState {
  // ─── Muted-state early-return guard (NEW v1.3) ──────────────────────
  //
  // When current is "muted", every event other than MUTE_TOGGLE and
  // INJECT_ERROR returns muted unchanged. INJECT_ERROR is preserved as
  // an exit because the user must always be able to surface a fatal
  // error from any state, including muted. MUTE_TOGGLE falls through
  // to the switch which routes muted -> idle.
  //
  // This is the v1.3 defense-in-depth layer above the VAD-layer
  // self-trigger guard per CONTEXT.md <decisions> "self-trigger guard
  // at VAD layer, NOT state machine layer". Both layers must fail for
  // a spurious STT_COMMITTED to exit muted.
  if (
    current === "muted" &&
    event.type !== "MUTE_TOGGLE" &&
    event.type !== "INJECT_ERROR"
  ) {
    return current;
  }

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

    // ─── Production event tags (orchestrator-driven) ──────────────────
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
      // CLAUDE_RESULT_READY at the state-transition layer: processing
      // -> speaking. The orchestrator (session.ts) carries the override
      // flag separately so the spoken summary text is the locked
      // "I ran into a problem. <reason>" body rather than the LLM's
      // <spoken-summary> body. The reason payload is informational
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

    case "MUTE_TOGGLE":
      // muted is a substate of idle in the v1.3 architecture — VAD is
      // gated off but sox keeps running so unmute is instant per
      // CONTEXT.md <decisions> Mute control row. Only idle and listening
      // accept the toggle because mid-utterance mute would orphan the
      // loop; processing/speaking/error remain transparent to the
      // toggle (the user must wait for the loop to drain to idle, OR
      // for the error to dismiss). muted -> idle returns to the rest
      // state; Phase 17 wires real listening re-entry on unmute as a
      // separate flow (VAD re-arm dispatches HOTKEY_PRESS or its
      // equivalent), keeping the reducer's responsibility narrow.
      if (current === "idle" || current === "listening") return "muted";
      if (current === "muted") return "idle";
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
 * Constructor options for createMockStateController.
 *
 *   - broadcast: invoked with every committed state change so the
 *     UI layer can fan out to the Ink render tree.
 *   - emitAmplitude: invoked with [0, 1] RMS values during listening
 *     and speaking; ignored by the renderer outside those states.
 *   - getMode: returns the current HotkeyMode; lets the reducer be
 *     PTT-aware without owning persistence. v1.3 always returns
 *     "toggle" in production.
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
 * Production controller. Same surface as createMockStateController
 * but the fixture timer scheduling is a no-op so the orchestrator
 * (session.ts) drives every transition explicitly. Phase 17 wires
 * this into the production session.ts port.
 */
export function createSessionStateController(
  opts: Omit<MockStateControllerOptions, "setTimeoutImpl" | "clearTimeoutImpl">,
): MockStateController {
  // Force the underlying mock controller's timer scheduling to be a
  // no-op: setTimeoutImpl returns null and never fires, clearTimeoutImpl
  // is a no-op. The session orchestrator dispatches the production tags
  // directly so the timer-based MOCK_VAD_COMMIT / MOCK_PROCESSING_COMPLETE
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
    ((cb: () => void, ms: number): unknown => setTimeout(cb, ms));
  const clearT =
    opts.clearTimeoutImpl ??
    ((token: unknown) => {
      clearTimeout(token as ReturnType<typeof setTimeout>);
    });

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
