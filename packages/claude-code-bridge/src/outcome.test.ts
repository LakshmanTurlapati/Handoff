/**
 * Tests for the authoritative outcome derivation (Plan 10-02, Task 2).
 *
 * Pitfall #17 owner: deriveOutcome ignores LLM narration entirely; only
 * the exit code, the list of tool_result ids that carried is_error=true,
 * and an explicit cancellation flag feed the decision.
 *
 * Coverage map (Tests 24-30 from the plan's <behavior> block):
 *
 *   24. exit=0, no tool errors -> success
 *   25. exit=1, no tool errors -> failure (exit_code)
 *   26. exit=0, one tool error -> failure (tool_error) (exit 0 alone is not success)
 *   27. exit=0, two tool errors -> failure with "2 tool_result" detail
 *   28. exit=1, one tool error -> failure (tool_error) — tool_error wins over exit_code
 *   29. exit=null (signal kill), no tool errors -> failure (exit_code) with exitCode null
 *   30. cancelled:true overrides everything -> failure (cancelled)
 */
import { describe, it, expect } from "vitest";

import { deriveOutcome } from "./outcome.js";

describe("deriveOutcome", () => {
  it("test 24: exit=0 + no tool errors -> success", () => {
    expect(deriveOutcome({ exitCode: 0, toolErrors: [] })).toEqual({
      kind: "success",
    });
  });

  it("test 25: exit=1 + no tool errors -> failure (exit_code) with exitCode 1", () => {
    expect(deriveOutcome({ exitCode: 1, toolErrors: [] })).toEqual({
      kind: "failure",
      reason: "exit_code",
      exitCode: 1,
    });
  });

  it("test 26: exit=0 but one tool error -> failure (tool_error) regardless of exit code", () => {
    const out = deriveOutcome({ exitCode: 0, toolErrors: ["tu-1"] });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("tool_error");
    expect(out.details).toBeDefined();
    expect(out.details).toMatch(/1 tool_result/);
    expect(out.details).toMatch(/tu-1/);
  });

  it("test 27: exit=0 with two tool errors -> details mentions '2 tool_result'", () => {
    const out = deriveOutcome({ exitCode: 0, toolErrors: ["tu-1", "tu-2"] });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("tool_error");
    expect(out.details).toMatch(/2 tool_result/);
    expect(out.details).toMatch(/tu-1/);
    expect(out.details).toMatch(/tu-2/);
  });

  it("test 28: exit=1 + one tool error -> reason prefers tool_error over exit_code (more specific signal)", () => {
    const out = deriveOutcome({ exitCode: 1, toolErrors: ["tu-1"] });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("tool_error");
  });

  it("test 29: exit=null (signal kill) + no tool errors -> failure (exit_code) with exitCode null", () => {
    const out = deriveOutcome({ exitCode: null, toolErrors: [] });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("exit_code");
    expect(out.exitCode).toBe(null);
  });

  it("test 30: cancelled:true overrides everything -> failure (cancelled)", () => {
    const out = deriveOutcome({
      exitCode: 0,
      toolErrors: [],
      cancelled: true,
    });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("cancelled");
  });

  it("cancellation overrides even when a tool error is also present", () => {
    const out = deriveOutcome({
      exitCode: 1,
      toolErrors: ["tu-1"],
      cancelled: true,
    });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("cancelled");
  });

  it("more than 5 tool errors truncates the id list with '...'", () => {
    const out = deriveOutcome({
      exitCode: 0,
      toolErrors: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(out.kind).toBe("failure");
    expect(out.reason).toBe("tool_error");
    expect(out.details).toMatch(/7 tool_result/);
    expect(out.details).toMatch(/\.\.\./);
  });
});
