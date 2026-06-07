/**
 * Behaviour tests for the Achilles pure state-machine reducer.
 *
 * The reducer is the single source of truth for `AchillesState`
 * transitions. The 10 behaviour tests below mirror the
 * `<behavior>` block in 11-01-PLAN.md.
 *
 * Tests are pure — no Electron, no timers, no IPC. They only feed
 * (state, event, mode) tuples and assert the next state.
 */
import { describe, expect, it, vi } from "vitest";
import { ACHILLES_STATES } from "../shared/constants.js";
import type { AchillesEvent } from "./state-machine.js";
import { createMockStateController, transition } from "./state-machine.js";

describe("transition() — UI-06 entry transitions", () => {
  it("S1: toggle mode — HOTKEY_PRESS in idle → listening", () => {
    expect(
      transition("idle", { type: "HOTKEY_PRESS" }, "toggle"),
    ).toBe("listening");
  });

  it("S2: toggle mode — HOTKEY_PRESS in listening → processing (commit utterance)", () => {
    expect(
      transition("listening", { type: "HOTKEY_PRESS" }, "toggle"),
    ).toBe("processing");
  });

  it("S3: pushToTalk mode — HOTKEY_RELEASE in listening → processing (release commits)", () => {
    expect(
      transition("listening", { type: "HOTKEY_RELEASE" }, "pushToTalk"),
    ).toBe("processing");
  });

  it("S4: toggle mode — HOTKEY_RELEASE in listening is a no-op (stays listening)", () => {
    expect(
      transition("listening", { type: "HOTKEY_RELEASE" }, "toggle"),
    ).toBe("listening");
  });

  it("S5: MOCK_PROCESSING_COMPLETE in processing → speaking", () => {
    expect(
      transition(
        "processing",
        { type: "MOCK_PROCESSING_COMPLETE" },
        "toggle",
      ),
    ).toBe("speaking");
  });

  it("S6: MOCK_PLAYBACK_DONE in speaking → idle", () => {
    expect(
      transition("speaking", { type: "MOCK_PLAYBACK_DONE" }, "toggle"),
    ).toBe("idle");
  });

  it("S7: INJECT_ERROR from any state → error", () => {
    for (const start of ACHILLES_STATES) {
      const next = transition(
        start,
        { type: "INJECT_ERROR", kind: "unknown" },
        "toggle",
      );
      expect(next).toBe("error");
    }
  });

  it("S8: ERROR_DISMISS in error → idle", () => {
    expect(
      transition("error", { type: "ERROR_DISMISS" }, "toggle"),
    ).toBe("idle");
  });

  it("S9: CIRCLE_CLICK in speaking → idle (UI-SPEC s4 cancel)", () => {
    expect(
      transition("speaking", { type: "CIRCLE_CLICK" }, "toggle"),
    ).toBe("idle");
  });

  it("S10: unknown event tag throws an Error naming the tag", () => {
    expect(() =>
      transition("idle", { type: "BOGUS" } as unknown as AchillesEvent, "toggle"),
    ).toThrow(/BOGUS/);
  });
});

describe("transition() — defensive coverage", () => {
  it("HOTKEY_PRESS in pushToTalk mode also enters listening from idle", () => {
    expect(
      transition("idle", { type: "HOTKEY_PRESS" }, "pushToTalk"),
    ).toBe("listening");
  });

  it("CIRCLE_CLICK in idle behaves like HOTKEY_PRESS in toggle mode", () => {
    expect(
      transition("idle", { type: "CIRCLE_CLICK" }, "toggle"),
    ).toBe("listening");
  });

  it("MOCK_VAD_COMMIT in listening → processing", () => {
    expect(
      transition("listening", { type: "MOCK_VAD_COMMIT" }, "toggle"),
    ).toBe("processing");
  });

  it("PERMISSION_CHANGED leaves state unchanged (permission is a side band)", () => {
    expect(
      transition(
        "idle",
        { type: "PERMISSION_CHANGED", state: "granted" },
        "toggle",
      ),
    ).toBe("idle");
  });
});

describe("transition() — Plan 12-04 production event tags", () => {
  it("S1 (P12): STT_COMMITTED transitions listening → processing", () => {
    expect(
      transition(
        "listening",
        { type: "STT_COMMITTED", transcript: "hello world" },
        "toggle",
      ),
    ).toBe("processing");
  });

  it("S1 (P12): STT_COMMITTED is a no-op from non-listening states", () => {
    expect(
      transition(
        "idle",
        { type: "STT_COMMITTED", transcript: "hello" },
        "toggle",
      ),
    ).toBe("idle");
    expect(
      transition(
        "processing",
        { type: "STT_COMMITTED", transcript: "hello" },
        "toggle",
      ),
    ).toBe("processing");
    expect(
      transition(
        "speaking",
        { type: "STT_COMMITTED", transcript: "hello" },
        "toggle",
      ),
    ).toBe("speaking");
  });

  it("S2 (P12): CLAUDE_RESULT_READY transitions processing → speaking", () => {
    expect(
      transition("processing", { type: "CLAUDE_RESULT_READY" }, "toggle"),
    ).toBe("speaking");
  });

  it("S2 (P12): CLAUDE_RESULT_READY is a no-op from non-processing states", () => {
    expect(
      transition("idle", { type: "CLAUDE_RESULT_READY" }, "toggle"),
    ).toBe("idle");
    expect(
      transition("listening", { type: "CLAUDE_RESULT_READY" }, "toggle"),
    ).toBe("listening");
    expect(
      transition("speaking", { type: "CLAUDE_RESULT_READY" }, "toggle"),
    ).toBe("speaking");
  });

  it("S3 (P12): TTS_PLAYBACK_DRAINED transitions speaking → idle", () => {
    expect(
      transition("speaking", { type: "TTS_PLAYBACK_DRAINED" }, "toggle"),
    ).toBe("idle");
  });

  it("S3 (P12): TTS_PLAYBACK_DRAINED is a no-op from non-speaking states", () => {
    expect(
      transition("idle", { type: "TTS_PLAYBACK_DRAINED" }, "toggle"),
    ).toBe("idle");
    expect(
      transition("listening", { type: "TTS_PLAYBACK_DRAINED" }, "toggle"),
    ).toBe("listening");
    expect(
      transition("processing", { type: "TTS_PLAYBACK_DRAINED" }, "toggle"),
    ).toBe("processing");
  });

  it("S5 (P12): CLAUDE_FAILURE_OVERRIDE transitions processing → speaking with reason payload preserved", () => {
    // The reducer's return type is AchillesState (a string literal); the
    // failure-override signal travels in the EVENT PAYLOAD, which the
    // orchestrator inspects separately (Plan 12-04 session.ts owns the
    // "next spoken summary is the override" flag).
    const next = transition(
      "processing",
      { type: "CLAUDE_FAILURE_OVERRIDE", reason: "exit_code" },
      "toggle",
    );
    expect(next).toBe("speaking");
  });

  it("S5 (P12): CLAUDE_FAILURE_OVERRIDE is a no-op from non-processing states", () => {
    expect(
      transition(
        "idle",
        { type: "CLAUDE_FAILURE_OVERRIDE", reason: "exit_code" },
        "toggle",
      ),
    ).toBe("idle");
    expect(
      transition(
        "speaking",
        { type: "CLAUDE_FAILURE_OVERRIDE", reason: "exit_code" },
        "toggle",
      ),
    ).toBe("speaking");
  });

  it("S4 (P12): MOCK_* tags remain functional for back-compat", () => {
    // The Phase 11 Playwright e2e specs drive the timeline through the
    // MOCK_* tags. Plan 12-04 adds the production tags ALONGSIDE them
    // without changing or deleting any MOCK_* behaviour.
    expect(
      transition("listening", { type: "MOCK_VAD_COMMIT" }, "toggle"),
    ).toBe("processing");
    expect(
      transition("processing", { type: "MOCK_PROCESSING_COMPLETE" }, "toggle"),
    ).toBe("speaking");
    expect(
      transition("speaking", { type: "MOCK_PLAYBACK_DONE" }, "toggle"),
    ).toBe("idle");
  });
});

describe("createMockStateController — CR-01 production broadcast hook auto-advances the timeline", () => {
  it("when the broadcast wires scheduleMockTransitions, listening -> processing -> speaking -> idle auto-fires (mirrors main/index.ts wiring)", () => {
    type TimerCb = () => void;
    const timers: Array<{ id: number; cb: TimerCb }> = [];
    let nextTokenId = 1;
    const setTimeoutImpl = vi.fn((cb: TimerCb, _ms: number) => {
      const id = nextTokenId++;
      timers.push({ id, cb });
      return id as unknown;
    });
    const clearTimeoutImpl = vi.fn((token: unknown) => {
      const idx = timers.findIndex((t) => t.id === token);
      if (idx >= 0) timers.splice(idx, 1);
    });

    // Replicate main/index.ts production wiring: the broadcast closure
    // forwards every transition to scheduleMockTransitions. This is
    // the wiring CR-01 added — pre-fix the wiring was missing and the
    // timeline froze in listening forever.
    let controller: ReturnType<typeof createMockStateController>;
    const broadcastSpy = vi.fn();
    controller = createMockStateController({
      broadcast: (state) => {
        broadcastSpy(state);
        controller.scheduleMockTransitions(state);
      },
      getMode: () => "toggle",
      setTimeoutImpl,
      clearTimeoutImpl,
    });

    // Press the hotkey: idle -> listening AND timer scheduled.
    controller.dispatch({ type: "HOTKEY_PRESS" });
    expect(controller.now()).toBe("listening");
    expect(timers.length).toBe(1);

    // Fire the listening timer: -> processing AND timer scheduled.
    const fire = (): void => {
      const t = timers.shift();
      t!.cb();
    };
    fire();
    expect(controller.now()).toBe("processing");
    expect(timers.length).toBe(1);

    // Fire processing timer: -> speaking AND timer scheduled.
    fire();
    expect(controller.now()).toBe("speaking");
    expect(timers.length).toBe(1);

    // Fire speaking timer: -> idle. No further timer for idle.
    fire();
    expect(controller.now()).toBe("idle");
    expect(timers.length).toBe(0);

    // Broadcast was called for each transition.
    expect(broadcastSpy).toHaveBeenCalledWith("listening");
    expect(broadcastSpy).toHaveBeenCalledWith("processing");
    expect(broadcastSpy).toHaveBeenCalledWith("speaking");
    expect(broadcastSpy).toHaveBeenCalledWith("idle");
  });
});
