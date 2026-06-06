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
import { describe, expect, it } from "vitest";
import { ACHILLES_STATES } from "../shared/constants.js";
import type { AchillesEvent } from "./state-machine.js";
import { transition } from "./state-machine.js";

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
