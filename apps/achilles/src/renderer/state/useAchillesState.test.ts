/**
 * Pure-reducer tests for `useAchillesState`.
 *
 * The reducer is colocated with the React hook so unit tests can
 * exercise transition logic without rendering. US1 through US7 mirror
 * the `<behavior>` block in 11-02-PLAN.md (Task 1).
 *
 * No React, no Electron, no IPC. Each test feeds a (state, action)
 * tuple and asserts the next state. The reducer is the single source
 * of truth for amplitude clamping (T-11-08), partial replacement, and
 * committed buffer trimming.
 */
import { describe, expect, it } from "vitest";

import {
  initialAchillesReducerState,
  reducer,
  type AchillesAction,
  type CommittedTranscriptEntry,
} from "./useAchillesState.js";

const COMMITTED_BASE: CommittedTranscriptEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  text: "first",
  committedAt: 1000,
};

const COMMITTED_NEXT: CommittedTranscriptEntry = {
  id: "00000000-0000-4000-8000-000000000002",
  text: "second",
  committedAt: 2000,
};

describe("useAchillesState reducer — US1: initial state", () => {
  it("US1: matches the documented initial state shape", () => {
    expect(initialAchillesReducerState).toEqual({
      state: "idle",
      permissionState: "granted",
      micAmplitude: 0,
      ttsAmplitude: 0,
      partial: "",
      committed: [],
      error: null,
    });
  });
});

describe("useAchillesState reducer — US2: STATE_CHANGED to listening resets mic amplitude", () => {
  it("US2: STATE_CHANGED listening resets micAmplitude to 0 (fresh stream)", () => {
    const dirty = {
      ...initialAchillesReducerState,
      state: "speaking" as const,
      micAmplitude: 0.7,
    };
    const next = reducer(dirty, { type: "STATE_CHANGED", state: "listening" });
    expect(next.state).toBe("listening");
    expect(next.micAmplitude).toBe(0);
  });

  it("US2 parallel: STATE_CHANGED speaking resets ttsAmplitude to 0", () => {
    const dirty = {
      ...initialAchillesReducerState,
      state: "listening" as const,
      ttsAmplitude: 0.5,
    };
    const next = reducer(dirty, { type: "STATE_CHANGED", state: "speaking" });
    expect(next.ttsAmplitude).toBe(0);
  });
});

describe("useAchillesState reducer — US3: TRANSCRIPT_PARTIAL replaces (not appends)", () => {
  it("US3: TRANSCRIPT_PARTIAL replaces the previous partial entirely", () => {
    const dirty = {
      ...initialAchillesReducerState,
      partial: "hello wor",
    };
    const next = reducer(dirty, {
      type: "TRANSCRIPT_PARTIAL",
      text: "hello world this is final partial",
    });
    expect(next.partial).toBe("hello world this is final partial");
    // The previous string is gone — not appended.
    expect(next.partial.startsWith("hello wor")).toBe(true);
    expect(next.partial).not.toContain("hello worhello world");
  });
});

describe("useAchillesState reducer — US4: TRANSCRIPT_COMMITTED appends + clears partial", () => {
  it("US4: TRANSCRIPT_COMMITTED appends to committed and clears partial", () => {
    const dirty = {
      ...initialAchillesReducerState,
      partial: "in-flight transcript",
      committed: [COMMITTED_BASE],
    };
    const next = reducer(dirty, {
      type: "TRANSCRIPT_COMMITTED",
      entry: COMMITTED_NEXT,
    });
    expect(next.partial).toBe("");
    expect(next.committed).toEqual([COMMITTED_BASE, COMMITTED_NEXT]);
  });
});

describe("useAchillesState reducer — US5: committed buffer trims to 3 entries", () => {
  it("US5: when committed.length > 3, reducer keeps the most recent 3", () => {
    const e1: CommittedTranscriptEntry = { ...COMMITTED_BASE, id: "id-1", text: "1" };
    const e2: CommittedTranscriptEntry = { ...COMMITTED_BASE, id: "id-2", text: "2" };
    const e3: CommittedTranscriptEntry = { ...COMMITTED_BASE, id: "id-3", text: "3" };
    const e4: CommittedTranscriptEntry = { ...COMMITTED_BASE, id: "id-4", text: "4" };
    const dirty = {
      ...initialAchillesReducerState,
      committed: [e1, e2, e3],
    };
    const next = reducer(dirty, { type: "TRANSCRIPT_COMMITTED", entry: e4 });
    expect(next.committed).toHaveLength(3);
    expect(next.committed.map((e) => e.text)).toEqual(["2", "3", "4"]);
  });
});

describe("useAchillesState reducer — US6: MIC_AMPLITUDE clamps to [0, 1]", () => {
  it("US6a: MIC_AMPLITUDE with negative value clamps to 0", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "MIC_AMPLITUDE",
      rms: -0.5,
    });
    expect(next.micAmplitude).toBe(0);
  });

  it("US6b: MIC_AMPLITUDE with value > 1 clamps to 1", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "MIC_AMPLITUDE",
      rms: 1.7,
    });
    expect(next.micAmplitude).toBe(1);
  });

  it("US6c: MIC_AMPLITUDE with NaN clamps to 0", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "MIC_AMPLITUDE",
      rms: Number.NaN,
    });
    expect(next.micAmplitude).toBe(0);
  });

  it("US6d: MIC_AMPLITUDE with in-range value passes through unchanged", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "MIC_AMPLITUDE",
      rms: 0.42,
    });
    expect(next.micAmplitude).toBe(0.42);
  });

  it("US6e: TTS_AMPLITUDE clamps with the same rule", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "TTS_AMPLITUDE",
      rms: 2.0,
    });
    expect(next.ttsAmplitude).toBe(1);
  });
});

describe("useAchillesState reducer — US7: ERROR set + clear semantics", () => {
  it("US7a: ERROR action sets { message }", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "ERROR",
      message: "Mic not available",
    });
    expect(next.error).toEqual({ message: "Mic not available" });
  });

  it("US7b: STATE_CHANGED to 'idle' clears any standing error", () => {
    const dirty = {
      ...initialAchillesReducerState,
      state: "error" as const,
      error: { message: "Something broke" },
    };
    const next = reducer(dirty, { type: "STATE_CHANGED", state: "idle" });
    expect(next.error).toBeNull();
  });

  it("US7c: STATE_CHANGED to a non-idle state preserves the error", () => {
    const dirty = {
      ...initialAchillesReducerState,
      state: "error" as const,
      error: { message: "Standing error" },
    };
    const next = reducer(dirty, { type: "STATE_CHANGED", state: "listening" });
    expect(next.error).toEqual({ message: "Standing error" });
  });

  it("US7d: ERROR_DISMISS clears the error envelope", () => {
    const dirty = {
      ...initialAchillesReducerState,
      error: { message: "Dismiss me" },
    };
    const next = reducer(dirty, { type: "ERROR_DISMISS" });
    expect(next.error).toBeNull();
  });
});

describe("useAchillesState reducer — defensive", () => {
  it("PERMISSION_CHANGED updates only permissionState", () => {
    const next = reducer(initialAchillesReducerState, {
      type: "PERMISSION_CHANGED",
      permission: "denied",
    });
    expect(next.permissionState).toBe("denied");
    expect(next.state).toBe("idle");
  });

  it("unknown action tag throws an Error naming the tag", () => {
    expect(() =>
      reducer(initialAchillesReducerState, {
        type: "BOGUS",
      } as unknown as AchillesAction),
    ).toThrow(/BOGUS/);
  });
});
