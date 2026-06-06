/**
 * Tests for the wire-format mapper (Plan 10-02, Task 2).
 *
 * Coverage map (10 behaviours from the plan's <behavior> block):
 *
 *   1.  system+init -> SessionInit
 *   2.  assistant text with partial:true -> AssistantTextDelta
 *   3.  assistant text without partial -> AssistantTextDone (full_text)
 *   4.  assistant tool_use -> ToolUse
 *   5.  user tool_result is_error:false -> ToolResult (is_error false)
 *   6.  user tool_result is_error:true  -> ToolResult (is_error true)
 *   7.  result subtype:success -> AssistantDone
 *   8.  result subtype:error_during_execution -> AssistantDone
 *   9.  unknown wire type -> UnknownEvent { raw }
 *   10. every mapped event round-trips through ClaudeStreamEventSchema
 */
import { describe, it, expect } from "vitest";

import { mapWireEvent } from "./wire-mapper.js";
import { ClaudeStreamEventSchema } from "./event-schemas.js";

describe("mapWireEvent", () => {
  it("behaviour 1: maps system+init to SessionInit", () => {
    const out = mapWireEvent({
      type: "system",
      subtype: "init",
      session_id: "sid-1",
      model: "claude-sonnet-4-5",
      claude_code_version: "2.0.5",
    });
    expect(out.type).toBe("session_init");
    if (out.type !== "session_init") throw new Error("type narrowing");
    expect(out.session_id).toBe("sid-1");
    expect(out.model).toBe("claude-sonnet-4-5");
    expect(out.claude_code_version).toBe("2.0.5");
  });

  it("behaviour 2: maps partial assistant text to AssistantTextDelta", () => {
    const out = mapWireEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
      partial: true,
    });
    expect(out.type).toBe("assistant_text_delta");
    if (out.type !== "assistant_text_delta") throw new Error("type narrowing");
    expect(out.text).toBe("Hello");
  });

  it("behaviour 3: maps non-partial assistant text to AssistantTextDone", () => {
    const out = mapWireEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello." }] },
    });
    expect(out.type).toBe("assistant_text_done");
    if (out.type !== "assistant_text_done") throw new Error("type narrowing");
    expect(out.full_text).toBe("Hello.");
  });

  it("behaviour 4: maps assistant tool_use to ToolUse", () => {
    const out = mapWireEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu-1", name: "Read", input: { x: 1 } },
        ],
      },
    });
    expect(out.type).toBe("tool_use");
    if (out.type !== "tool_use") throw new Error("type narrowing");
    expect(out.id).toBe("tu-1");
    expect(out.name).toBe("Read");
    expect(out.input).toEqual({ x: 1 });
  });

  it("behaviour 5: maps tool_result is_error:false to ToolResult", () => {
    const out = mapWireEvent({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: "OK",
            is_error: false,
          },
        ],
      },
    });
    expect(out.type).toBe("tool_result");
    if (out.type !== "tool_result") throw new Error("type narrowing");
    expect(out.tool_use_id).toBe("tu-1");
    expect(out.content).toBe("OK");
    expect(out.is_error).toBe(false);
  });

  it("behaviour 6: maps tool_result is_error:true to ToolResult", () => {
    const out = mapWireEvent({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: "ENOENT",
            is_error: true,
          },
        ],
      },
    });
    expect(out.type).toBe("tool_result");
    if (out.type !== "tool_result") throw new Error("type narrowing");
    expect(out.is_error).toBe(true);
    expect(out.content).toBe("ENOENT");
  });

  it("behaviour 7: maps result subtype:success to AssistantDone", () => {
    const out = mapWireEvent({ type: "result", subtype: "success" });
    expect(out.type).toBe("assistant_done");
  });

  it("behaviour 8: maps result subtype:error_during_execution to AssistantDone (outcome handles errors separately)", () => {
    const out = mapWireEvent({
      type: "result",
      subtype: "error_during_execution",
    });
    expect(out.type).toBe("assistant_done");
  });

  it("behaviour 9: maps an unknown future wire type to UnknownEvent { raw } preserving the original", () => {
    const wire = { type: "future_event_2030", payload: { new_field: "x" } };
    const out = mapWireEvent(wire);
    expect(out.type).toBe("unknown_event");
    if (out.type !== "unknown_event") throw new Error("type narrowing");
    expect(out.raw).toEqual(wire);
  });

  it("behaviour 9b: non-object wire input becomes UnknownEvent { raw }", () => {
    const out = mapWireEvent("not-an-object");
    expect(out.type).toBe("unknown_event");
    if (out.type !== "unknown_event") throw new Error("type narrowing");
    expect(out.raw).toBe("not-an-object");
  });

  it("behaviour 9c: object with no string `type` discriminator becomes UnknownEvent", () => {
    const out = mapWireEvent({ no_type: true });
    expect(out.type).toBe("unknown_event");
  });

  it("behaviour 9d: permission_request wire is mapped to PermissionRequest", () => {
    const out = mapWireEvent({
      type: "permission_request",
      id: "pr-1",
      action: "Write",
      details: { path: "/tmp/x" },
    });
    expect(out.type).toBe("permission_request");
    if (out.type !== "permission_request") throw new Error("type narrowing");
    expect(out.id).toBe("pr-1");
    expect(out.action).toBe("Write");
  });

  it("behaviour 10: every mapped event round-trips through ClaudeStreamEventSchema.safeParse", () => {
    const candidates: unknown[] = [
      {
        type: "system",
        subtype: "init",
        session_id: "sid-1",
        model: "m",
        claude_code_version: "2.0.5",
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
        partial: true,
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi." }] },
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "u", name: "n", input: {} }],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "u", content: "x", is_error: true },
          ],
        },
      },
      { type: "result", subtype: "success" },
      {
        type: "permission_request",
        id: "pr-1",
        action: "Write",
        details: { path: "/tmp/x" },
      },
      { type: "future_event_2030", x: 1 },
    ];
    for (const wire of candidates) {
      const out = mapWireEvent(wire);
      const parsed = ClaudeStreamEventSchema.safeParse(out);
      expect(parsed.success).toBe(true);
    }
  });
});
