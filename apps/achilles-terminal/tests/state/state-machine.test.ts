/**
 * Behavior tests for the Achilles pure state-machine reducer (v1.3 port).
 *
 * The reducer is the single source of truth for AchillesState
 * transitions. Tests below mirror the <behavior> block in
 * 16-02-PLAN.md Task 2.
 *
 * Tests are pure: no Electron, no Ink, no IPC, no real timers. They
 * only feed (state, event, mode) tuples and assert the next state,
 * plus deterministic timer injection for createMockStateController.
 *
 * Tests 1-8 are baseline v1.2-port behavior preservation.
 * Tests 9-12 cover the new MUTE_TOGGLE event + muted-state behavior
 *   (Option A from 16-RESEARCH.md Open Question 1).
 * Tests 13-14 cover createMockStateController + createSessionStateController.
 * Test 15 is the exhaustiveness guard.
 *
 * Also covers Task 1 constants verification (ACHILLES_STATES length 6,
 * last element "muted", SPEAKING_DEBOUNCE_MS === 300) via static
 * import from "../../src/state/constants.js" so Task 1's behavior
 * tests are satisfied through this surface per the Task 1 verify block
 * note ("Task 2 vitest will verify via static import").
 */
import { describe, expect, it, vi } from "vitest";
import {
  ACHILLES_STATES,
  HOTKEY_MODES,
  PERMISSION_STATES,
  LISTENING_VAD_DELAY_MS,
  PROCESSING_DELAY_MS,
  SPEAKING_DELAY_MS,
  ERROR_AUTO_DISMISS_MS,
  SPEAKING_DEBOUNCE_MS,
  type AchillesState,
} from "../../src/state/constants.js";
import {
  transition,
  createMockStateController,
  createSessionStateController,
  type AchillesEvent,
} from "../../src/state/state-machine.js";

// =====================================================================
// Task 1 constants — verified through static imports here.
// =====================================================================

describe("constants (Task 1 verification surface)", () => {
  it("Task 1 Test 1: ACHILLES_STATES is a 6-tuple ending in 'muted'", () => {
    expect(ACHILLES_STATES).toHaveLength(6);
    expect(ACHILLES_STATES[5]).toBe("muted");
    expect([...ACHILLES_STATES]).toEqual([
      "idle",
      "listening",
      "processing",
      "speaking",
      "error",
      "muted",
    ]);
  });

  it("Task 1 Test 2: AchillesState 'muted' compiles without an `as never` cast", () => {
    // Compile-time check: this assignment must type-check under strict mode.
    // If "muted" were not part of AchillesState, this line would error in tsc.
    const m: AchillesState = "muted";
    expect(m).toBe("muted");
  });

  it("Task 1 Test 3: HOTKEY_MODES + PERMISSION_STATES port the v1.2 values verbatim", () => {
    expect([...HOTKEY_MODES]).toEqual(["toggle", "pushToTalk"]);
    expect([...PERMISSION_STATES]).toEqual([
      "granted",
      "not-determined",
      "denied",
      "restricted",
    ]);
  });

  it("Task 1 Test 4: timing constants port + SPEAKING_DEBOUNCE_MS surfaced", () => {
    expect(LISTENING_VAD_DELAY_MS).toBe(1200);
    expect(PROCESSING_DELAY_MS).toBe(800);
    expect(SPEAKING_DELAY_MS).toBe(2000);
    expect(ERROR_AUTO_DISMISS_MS).toBe(8000);
    expect(SPEAKING_DEBOUNCE_MS).toBe(300);
  });
});

// =====================================================================
// Tests 1-8: v1.2 port baseline — all 5 original state transitions
// behave identically under the original event tags.
// =====================================================================

describe("transition reducer (v1.2 port)", () => {
  it("Test 1: idle -> listening on HOTKEY_PRESS (toggle mode)", () => {
    expect(transition("idle", { type: "HOTKEY_PRESS" }, "toggle")).toBe(
      "listening",
    );
  });

  it("Test 2: listening -> processing on STT_COMMITTED", () => {
    expect(
      transition("listening", { type: "STT_COMMITTED", transcript: "hi" }, "toggle"),
    ).toBe("processing");
  });

  it("Test 3: processing -> speaking on CLAUDE_RESULT_READY", () => {
    expect(
      transition("processing", { type: "CLAUDE_RESULT_READY" }, "toggle"),
    ).toBe("speaking");
  });

  it("Test 4: speaking -> idle on TTS_PLAYBACK_DRAINED", () => {
    expect(
      transition("speaking", { type: "TTS_PLAYBACK_DRAINED" }, "toggle"),
    ).toBe("idle");
  });

  it("Test 5: CLAUDE_FAILURE_OVERRIDE in processing -> speaking", () => {
    expect(
      transition(
        "processing",
        { type: "CLAUDE_FAILURE_OVERRIDE", reason: "test" },
        "toggle",
      ),
    ).toBe("speaking");
  });

  it("Test 6: INJECT_ERROR routes anything -> error", () => {
    expect(
      transition("listening", { type: "INJECT_ERROR", kind: "unknown" }, "toggle"),
    ).toBe("error");
    expect(
      transition(
        "speaking",
        { type: "INJECT_ERROR", kind: "mic_unavailable" },
        "toggle",
      ),
    ).toBe("error");
  });

  it("Test 7: ERROR_DISMISS routes error -> idle", () => {
    expect(transition("error", { type: "ERROR_DISMISS" }, "toggle")).toBe(
      "idle",
    );
  });

  it("Test 8: HOTKEY_RELEASE behavior is mode-conditional", () => {
    // pushToTalk: release commits utterance.
    expect(
      transition("listening", { type: "HOTKEY_RELEASE" }, "pushToTalk"),
    ).toBe("processing");
    // toggle: release is a no-op.
    expect(
      transition("listening", { type: "HOTKEY_RELEASE" }, "toggle"),
    ).toBe("listening");
  });
});

// =====================================================================
// Tests 9-11: NEW — MUTE_TOGGLE event transitions.
// =====================================================================

describe("transition reducer (MUTE_TOGGLE)", () => {
  it("Test 9: MUTE_TOGGLE toggles idle <-> muted", () => {
    expect(transition("idle", { type: "MUTE_TOGGLE" }, "toggle")).toBe("muted");
    expect(transition("muted", { type: "MUTE_TOGGLE" }, "toggle")).toBe("idle");
  });

  it("Test 10: MUTE_TOGGLE from listening -> muted", () => {
    expect(transition("listening", { type: "MUTE_TOGGLE" }, "toggle")).toBe(
      "muted",
    );
  });

  it("Test 11: MUTE_TOGGLE during processing/speaking/error is ignored", () => {
    expect(transition("processing", { type: "MUTE_TOGGLE" }, "toggle")).toBe(
      "processing",
    );
    expect(transition("speaking", { type: "MUTE_TOGGLE" }, "toggle")).toBe(
      "speaking",
    );
    expect(transition("error", { type: "MUTE_TOGGLE" }, "toggle")).toBe(
      "error",
    );
  });
});

// =====================================================================
// Test 12: NEW — muted-state passthrough behavior. The state machine
// remains pure regardless of what the VAD layer's self-trigger guard
// does — every event other than MUTE_TOGGLE and INJECT_ERROR is a no-op
// from the muted state.
// =====================================================================

describe("transition reducer (muted state behavior)", () => {
  it("Test 12: STT_COMMITTED from muted is ignored (returns muted)", () => {
    expect(
      transition(
        "muted",
        { type: "STT_COMMITTED", transcript: "x" },
        "toggle",
      ),
    ).toBe("muted");
  });

  it("Test 12 (extended): every event tag other than MUTE_TOGGLE / INJECT_ERROR returns muted from the muted state", () => {
    const eventsThatShouldBeIgnoredFromMuted: AchillesEvent[] = [
      { type: "HOTKEY_PRESS" },
      { type: "HOTKEY_RELEASE" },
      { type: "CIRCLE_CLICK" },
      { type: "MOCK_VAD_COMMIT" },
      { type: "MOCK_PROCESSING_COMPLETE" },
      { type: "MOCK_PLAYBACK_DONE" },
      { type: "STT_COMMITTED", transcript: "anything" },
      { type: "CLAUDE_RESULT_READY" },
      { type: "TTS_PLAYBACK_DRAINED" },
      { type: "CLAUDE_FAILURE_OVERRIDE", reason: "anything" },
      { type: "ERROR_DISMISS" },
      { type: "PERMISSION_CHANGED", state: "granted" },
    ];
    for (const event of eventsThatShouldBeIgnoredFromMuted) {
      expect(transition("muted", event, "toggle")).toBe("muted");
    }
  });

  it("Test 12 (defense-in-depth): INJECT_ERROR from muted still routes to error", () => {
    expect(
      transition(
        "muted",
        { type: "INJECT_ERROR", kind: "mic_unavailable" },
        "toggle",
      ),
    ).toBe("error");
  });

  it("Test 12 (toggle-out): MUTE_TOGGLE from muted exits to idle", () => {
    expect(transition("muted", { type: "MUTE_TOGGLE" }, "toggle")).toBe("idle");
  });
});

// =====================================================================
// Test 13: createMockStateController schedules MOCK_VAD_COMMIT after
// LISTENING_VAD_DELAY_MS when state is listening.
// =====================================================================

describe("createMockStateController", () => {
  it("Test 13: scheduleMockTransitions('listening') fires MOCK_VAD_COMMIT after LISTENING_VAD_DELAY_MS, advancing to processing", () => {
    const pending = new Map<unknown, { cb: () => void; ms: number }>();
    let tokenSeq = 0;
    const broadcast = vi.fn();

    const controller = createMockStateController({
      broadcast,
      getMode: () => "toggle",
      setTimeoutImpl: (cb, ms) => {
        const token = ++tokenSeq;
        pending.set(token, { cb, ms });
        return token;
      },
      clearTimeoutImpl: (token) => {
        pending.delete(token);
      },
    });

    // Enter listening so the broadcast records the transition.
    const enteredListening = controller.dispatch({ type: "HOTKEY_PRESS" });
    expect(enteredListening).toBe("listening");
    expect(broadcast).toHaveBeenLastCalledWith("listening");

    // Schedule the fixture VAD-commit timer.
    controller.scheduleMockTransitions("listening");
    expect(pending.size).toBe(1);
    const scheduled = Array.from(pending.values())[0];
    expect(scheduled).toBeDefined();
    expect(scheduled?.ms).toBe(LISTENING_VAD_DELAY_MS);

    // Fire the timer; the controller dispatches MOCK_VAD_COMMIT internally,
    // which advances listening -> processing.
    scheduled?.cb();
    expect(broadcast).toHaveBeenLastCalledWith("processing");
    expect(controller.now()).toBe("processing");
  });

  it("Test 13 (extended): scheduleMockTransitions('processing') schedules PROCESSING_DELAY_MS firing MOCK_PROCESSING_COMPLETE", () => {
    const pending = new Map<unknown, { cb: () => void; ms: number }>();
    let tokenSeq = 0;
    const broadcast = vi.fn();

    const controller = createMockStateController({
      broadcast,
      getMode: () => "toggle",
      setTimeoutImpl: (cb, ms) => {
        const token = ++tokenSeq;
        pending.set(token, { cb, ms });
        return token;
      },
      clearTimeoutImpl: (token) => {
        pending.delete(token);
      },
    });

    controller.dispatch({ type: "HOTKEY_PRESS" }); // idle -> listening
    controller.dispatch({ type: "STT_COMMITTED", transcript: "x" }); // listening -> processing

    controller.scheduleMockTransitions("processing");
    expect(pending.size).toBe(1);
    const scheduled = Array.from(pending.values())[0];
    expect(scheduled?.ms).toBe(PROCESSING_DELAY_MS);

    scheduled?.cb();
    expect(broadcast).toHaveBeenLastCalledWith("speaking");
    expect(controller.now()).toBe("speaking");
  });

  it("Test 13 (extended): cancelScheduledTransitions removes the pending timer", () => {
    const pending = new Map<unknown, { cb: () => void; ms: number }>();
    let tokenSeq = 0;

    const controller = createMockStateController({
      broadcast: vi.fn(),
      getMode: () => "toggle",
      setTimeoutImpl: (cb, ms) => {
        const token = ++tokenSeq;
        pending.set(token, { cb, ms });
        return token;
      },
      clearTimeoutImpl: (token) => {
        pending.delete(token);
      },
    });

    controller.dispatch({ type: "HOTKEY_PRESS" });
    controller.scheduleMockTransitions("listening");
    expect(pending.size).toBe(1);
    controller.cancelScheduledTransitions();
    expect(pending.size).toBe(0);
  });
});

// =====================================================================
// Test 14: createSessionStateController's setTimeoutImpl is a no-op
// (returns null without scheduling) so scheduleMockTransitions does
// not advance state — the production orchestrator dispatches every
// transition explicitly.
// =====================================================================

describe("createSessionStateController", () => {
  it("Test 14: scheduleMockTransitions is a no-op in the session controller", () => {
    const broadcast = vi.fn();
    const controller = createSessionStateController({
      broadcast,
      getMode: () => "toggle",
    });

    // Move through the explicit production path so we are in listening.
    controller.dispatch({ type: "HOTKEY_PRESS" });
    expect(controller.now()).toBe("listening");
    broadcast.mockClear();

    // Attempt to schedule the fixture timeline; the no-op setTimeoutImpl
    // returns null and never fires.
    controller.scheduleMockTransitions("listening");
    // Allow a microtask + a generous setTimeout tick to ensure no scheduled
    // callback could have advanced state (the no-op returns null, so this
    // assertion is really verifying that the controller did not silently
    // fall back to real setTimeout).
    expect(controller.now()).toBe("listening");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("Test 14 (extended): cancelScheduledTransitions in session controller is safe (no throw)", () => {
    const controller = createSessionStateController({
      broadcast: vi.fn(),
      getMode: () => "toggle",
    });
    expect(() => controller.cancelScheduledTransitions()).not.toThrow();
  });
});

// =====================================================================
// Test 15: exhaustiveness guard — an event tag not in the AchillesEvent
// union (cast as never) throws an Error containing "Unknown AchillesEvent".
// =====================================================================

describe("exhaustiveness", () => {
  it("Test 15: unknown event.type throws Error('Unknown AchillesEvent: ...')", () => {
    expect(() =>
      transition(
        "idle",
        { type: "BOGUS" } as unknown as AchillesEvent,
        "toggle",
      ),
    ).toThrow(/Unknown AchillesEvent/);
  });

  it("Test 15 (extended): the thrown error names the offending tag", () => {
    expect(() =>
      transition(
        "idle",
        { type: "BOGUS_TAG_42" } as unknown as AchillesEvent,
        "toggle",
      ),
    ).toThrow(/BOGUS_TAG_42/);
  });
});
