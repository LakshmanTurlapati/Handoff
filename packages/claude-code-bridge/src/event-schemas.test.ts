import { describe, expect, it } from "vitest";
import {
  AssistantDoneSchema,
  AssistantTextDeltaSchema,
  AssistantTextDoneSchema,
  CLAUDE_STREAM_EVENT_TYPES,
  ClaudeStreamEventSchema,
  ParseErrorSchema,
  PermissionRequestSchema,
  SessionInitSchema,
  ToolResultSchema,
  ToolUseSchema,
  UnknownEventSchema,
} from "./event-schemas.js";

describe("CLAUDE_STREAM_EVENT_TYPES", () => {
  it("is a 9-element tuple of the wire-format discriminator literals in spec order", () => {
    expect(CLAUDE_STREAM_EVENT_TYPES).toEqual([
      "session_init",
      "assistant_text_delta",
      "assistant_text_done",
      "tool_use",
      "tool_result",
      "permission_request",
      "assistant_done",
      "parse_error",
      "unknown_event",
    ]);
    expect(CLAUDE_STREAM_EVENT_TYPES).toHaveLength(9);
  });
});

describe("SessionInitSchema", () => {
  it("accepts a well-formed session_init event", () => {
    const value = {
      type: "session_init",
      session_id: "sid-1",
      model: "claude-sonnet-4-5",
      claude_code_version: "2.0.1",
    };
    const parsed = SessionInitSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("session_init");
    }
  });

  it("rejects a session_init missing required fields", () => {
    const parsed = SessionInitSchema.safeParse({ type: "session_init" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("session_id");
    }
  });

  it("rejects a session_init with the wrong discriminator", () => {
    const parsed = SessionInitSchema.safeParse({
      type: "wrong",
      session_id: "sid-1",
      model: "claude-sonnet-4-5",
      claude_code_version: "2.0.1",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("AssistantTextDeltaSchema", () => {
  it("accepts a well-formed assistant_text_delta event", () => {
    const value = { type: "assistant_text_delta", text: "Got" };
    const parsed = AssistantTextDeltaSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("assistant_text_delta");
    }
  });

  it("rejects an assistant_text_delta missing the text field", () => {
    const parsed = AssistantTextDeltaSchema.safeParse({
      type: "assistant_text_delta",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("text");
    }
  });

  it("rejects an assistant_text_delta with the wrong discriminator", () => {
    const parsed = AssistantTextDeltaSchema.safeParse({
      type: "wrong",
      text: "Got",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("AssistantTextDoneSchema", () => {
  it("accepts a well-formed assistant_text_done event", () => {
    const value = { type: "assistant_text_done", full_text: "Done." };
    const parsed = AssistantTextDoneSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("assistant_text_done");
    }
  });

  it("rejects an assistant_text_done missing the full_text field", () => {
    const parsed = AssistantTextDoneSchema.safeParse({
      type: "assistant_text_done",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("full_text");
    }
  });

  it("rejects an assistant_text_done with the wrong discriminator", () => {
    const parsed = AssistantTextDoneSchema.safeParse({
      type: "wrong",
      full_text: "Done.",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ToolUseSchema", () => {
  it("accepts a well-formed tool_use event (with input as unknown record)", () => {
    const value = {
      type: "tool_use",
      id: "toolu_1",
      name: "Bash",
      input: { command: "ls" },
    };
    const parsed = ToolUseSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("tool_use");
    }
  });

  it("rejects a tool_use missing the name field", () => {
    const parsed = ToolUseSchema.safeParse({
      type: "tool_use",
      id: "toolu_1",
      input: {},
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("name");
    }
  });

  it("rejects a tool_use with the wrong discriminator", () => {
    const parsed = ToolUseSchema.safeParse({
      type: "wrong",
      id: "toolu_1",
      name: "Bash",
      input: {},
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ToolResultSchema", () => {
  it("accepts a well-formed tool_result without the optional is_error", () => {
    const value = {
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: "ok",
    };
    const parsed = ToolResultSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("tool_result");
      // CR: is_error is optional; absence MUST NOT coerce to a default
      // (Plan 10-02 derives success/failure from presence + value).
      expect(parsed.data.is_error).toBeUndefined();
    }
  });

  it("accepts a well-formed tool_result with is_error: true", () => {
    const value = {
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: "error message",
      is_error: true,
    };
    const parsed = ToolResultSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.is_error).toBe(true);
    }
  });

  it("rejects a tool_result missing the tool_use_id field", () => {
    const parsed = ToolResultSchema.safeParse({
      type: "tool_result",
      content: "ok",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("tool_use_id");
    }
  });

  it("rejects a tool_result with the wrong discriminator", () => {
    const parsed = ToolResultSchema.safeParse({
      type: "wrong",
      tool_use_id: "toolu_1",
      content: "ok",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("PermissionRequestSchema", () => {
  it("accepts a well-formed permission_request (with optional details)", () => {
    const value = {
      type: "permission_request",
      id: "perm_1",
      action: "WriteFile",
      details: { path: "/tmp/x" },
    };
    const parsed = PermissionRequestSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("permission_request");
    }
  });

  it("rejects a permission_request missing the action field", () => {
    const parsed = PermissionRequestSchema.safeParse({
      type: "permission_request",
      id: "perm_1",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("action");
    }
  });

  it("rejects a permission_request with the wrong discriminator", () => {
    const parsed = PermissionRequestSchema.safeParse({
      type: "wrong",
      id: "perm_1",
      action: "WriteFile",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("AssistantDoneSchema", () => {
  it("accepts a well-formed assistant_done event (discriminator only)", () => {
    const value = { type: "assistant_done" };
    const parsed = AssistantDoneSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("assistant_done");
    }
  });

  it("rejects an empty object — the type discriminator is itself a required field", () => {
    const parsed = AssistantDoneSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("type");
    }
  });

  it("rejects an assistant_done with the wrong discriminator", () => {
    const parsed = AssistantDoneSchema.safeParse({ type: "wrong" });
    expect(parsed.success).toBe(false);
  });
});

describe("ParseErrorSchema", () => {
  it("accepts a well-formed parse_error (with the optional raw_line)", () => {
    const value = {
      type: "parse_error",
      error: "unexpected token",
      raw_line: "{ broken",
    };
    const parsed = ParseErrorSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("parse_error");
    }
  });

  it("rejects a parse_error missing the error field", () => {
    const parsed = ParseErrorSchema.safeParse({ type: "parse_error" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("error");
    }
  });

  it("rejects a parse_error with the wrong discriminator", () => {
    const parsed = ParseErrorSchema.safeParse({
      type: "wrong",
      error: "unexpected token",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("UnknownEventSchema", () => {
  it("accepts a well-formed unknown_event (raw is unknown)", () => {
    const value = { type: "unknown_event", raw: { future: "shape" } };
    const parsed = UnknownEventSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("unknown_event");
    }
  });

  it("rejects an empty object — the type discriminator is itself a required field", () => {
    // Note: `raw` is z.unknown(), which accepts the implicit-undefined
    // case (omitted field). The required field on this variant is the
    // `type` discriminator itself; omitting `type` is what makes the
    // empty-object case fail.
    const parsed = UnknownEventSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("type");
    }
  });

  it("rejects an unknown_event with the wrong discriminator", () => {
    const parsed = UnknownEventSchema.safeParse({
      type: "wrong",
      raw: { future: "shape" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ClaudeStreamEventSchema (discriminated union)", () => {
  it("parses a session_init variant and narrows on the type discriminator", () => {
    const value = {
      type: "session_init",
      session_id: "sid-1",
      model: "claude-sonnet-4-5",
      claude_code_version: "2.0.1",
    };
    const parsed = ClaudeStreamEventSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "session_init") {
      // The TS narrowing on `type` exposes session_id; the runtime
      // value matches the input.
      expect(parsed.data.session_id).toBe("sid-1");
    }
  });

  it("rejects an event whose discriminator is not in the 9-variant union", () => {
    const parsed = ClaudeStreamEventSchema.safeParse({
      type: "not_in_union",
      x: 1,
    });
    expect(parsed.success).toBe(false);
  });
});
