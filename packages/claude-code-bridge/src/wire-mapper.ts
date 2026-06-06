/**
 * Wire-format mapper (Plan 10-02, Task 2).
 *
 * Translates Claude Code's stream-json wire shapes into Achilles' stable
 * {@link ClaudeStreamEvent} vocabulary. This file is the boundary that
 * absorbs future Claude Code field renames: when the upstream CLI
 * changes a wire field name, only this mapper needs to change — the
 * public ClaudeStreamEventSchema vocabulary stays frozen.
 *
 * Defensive strategy: anything that cannot be cleanly mapped to a
 * specific variant is downgraded to {@link UnknownEvent} with the raw
 * input preserved on `raw`. The mapper NEVER throws. As a final guard,
 * every constructed variant is round-tripped through
 * ClaudeStreamEventSchema.safeParse; if the schema rejects the
 * constructed shape (e.g. because the wire object was missing a field
 * the mapper thought it could read), the mapper falls back to
 * UnknownEvent rather than emitting an invalid variant.
 *
 * Wire-format mapping table (from Plan 10-02 <wire_format_notes>):
 *
 *   wire.type=system + subtype=init     -> session_init
 *   wire.type=assistant text + partial=true -> assistant_text_delta
 *   wire.type=assistant text (no partial)   -> assistant_text_done
 *   wire.type=assistant tool_use             -> tool_use
 *   wire.type=user tool_result               -> tool_result
 *   wire.type=result (any subtype)           -> assistant_done
 *   wire.type=permission_request             -> permission_request
 *   anything else                            -> unknown_event { raw }
 *
 * Pitfall ties:
 *   - #17 (authoritative success/failure): the mapper never inspects LLM
 *     narration. tool_result and exit_code are the only signals
 *     deriveOutcome (./outcome.ts) reads to decide success vs. failure;
 *     this mapper simply preserves the wire structure faithfully.
 */

import { ClaudeStreamEventSchema } from "./event-schemas.js";
import type { ClaudeStreamEvent } from "./event-schemas.js";

/**
 * Narrow guard: true when value is a non-null object (excluding arrays
 * because the wire surface uses arrays only inside `message.content`).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Construct an UnknownEvent wrapping the raw wire input. The wrapper
 * runs the final schema guard at the call site, but UnknownEvent is the
 * universal fallback so we also expose a tiny helper for clarity. */
function makeUnknown(raw: unknown): ClaudeStreamEvent {
  return { type: "unknown_event", raw };
}

/**
 * Map a single Claude Code wire-format object into a typed
 * {@link ClaudeStreamEvent}.
 *
 * @param wire the raw parsed JSON object from one NDJSON line.
 * @returns the Achilles-side event variant, or UnknownEvent on any
 *          mapping failure (preserving the raw input for forensics).
 */
export function mapWireEvent(wire: unknown): ClaudeStreamEvent {
  // Defensive: non-object / null / array inputs cannot be mapped.
  if (!isRecord(wire)) {
    return makeUnknown(wire);
  }
  const type = wire["type"];
  if (typeof type !== "string") {
    return makeUnknown(wire);
  }

  const candidate = constructVariant(type, wire);
  if (candidate === null) {
    return makeUnknown(wire);
  }
  // Final guard: even if construction succeeded, verify the shape
  // round-trips through the schema. Any drift falls back to UnknownEvent.
  const parsed = ClaudeStreamEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return makeUnknown(wire);
  }
  return parsed.data;
}

/**
 * Attempt to build a specific variant from a typed wire object. Returns
 * null when the input lacks the fields required for the discriminator
 * the type implies; the caller then falls back to UnknownEvent.
 */
function constructVariant(
  type: string,
  wire: Record<string, unknown>,
): ClaudeStreamEvent | null {
  switch (type) {
    case "system": {
      if (wire["subtype"] !== "init") {
        return null;
      }
      const session_id = wire["session_id"];
      const model = wire["model"];
      const claude_code_version = wire["claude_code_version"];
      if (
        typeof session_id !== "string" ||
        typeof model !== "string" ||
        typeof claude_code_version !== "string"
      ) {
        return null;
      }
      return {
        type: "session_init",
        session_id,
        model,
        claude_code_version,
      };
    }
    case "assistant": {
      const message = wire["message"];
      if (!isRecord(message)) {
        return null;
      }
      const content = message["content"];
      if (!Array.isArray(content) || content.length === 0) {
        return null;
      }
      const first = content[0];
      if (!isRecord(first)) {
        return null;
      }
      const blockType = first["type"];
      if (blockType === "text") {
        const text = first["text"];
        if (typeof text !== "string") {
          return null;
        }
        if (wire["partial"] === true) {
          return { type: "assistant_text_delta", text };
        }
        return { type: "assistant_text_done", full_text: text };
      }
      if (blockType === "tool_use") {
        const id = first["id"];
        const name = first["name"];
        if (typeof id !== "string" || typeof name !== "string") {
          return null;
        }
        // `input` is z.unknown() in the schema — pass through verbatim.
        return { type: "tool_use", id, name, input: first["input"] };
      }
      return null;
    }
    case "user": {
      const message = wire["message"];
      if (!isRecord(message)) {
        return null;
      }
      const content = message["content"];
      if (!Array.isArray(content) || content.length === 0) {
        return null;
      }
      const first = content[0];
      if (!isRecord(first)) {
        return null;
      }
      if (first["type"] !== "tool_result") {
        return null;
      }
      const tool_use_id = first["tool_use_id"];
      const result_content = first["content"];
      if (typeof tool_use_id !== "string" || typeof result_content !== "string") {
        return null;
      }
      const out: ClaudeStreamEvent = {
        type: "tool_result",
        tool_use_id,
        content: result_content,
      };
      if (typeof first["is_error"] === "boolean") {
        out.is_error = first["is_error"];
      }
      return out;
    }
    case "result": {
      // The outcome derivation handles success-vs-error via exit code
      // and tool_result.is_error, not via this discriminator.
      return { type: "assistant_done" };
    }
    case "permission_request": {
      const id = wire["id"];
      const action = wire["action"];
      if (typeof id !== "string" || typeof action !== "string") {
        return null;
      }
      const out: ClaudeStreamEvent = {
        type: "permission_request",
        id,
        action,
      };
      if (isRecord(wire["details"])) {
        out.details = wire["details"];
      }
      return out;
    }
    default:
      return null;
  }
}
