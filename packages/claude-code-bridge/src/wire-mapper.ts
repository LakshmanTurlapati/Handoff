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
 * Maintained for backward compatibility with callers that expect a
 * single event per wire line. New callers SHOULD prefer
 * {@link mapWireEvents}, which preserves multi-block assistant content
 * by emitting one event per content block (CR-fix WR-01).
 *
 * Behaviour for multi-block assistant content: returns ONLY the FIRST
 * block's event. Subsequent blocks are silently dropped. This is the
 * pre-WR-01 behaviour preserved for callers that have not yet migrated.
 *
 * @param wire the raw parsed JSON object from one NDJSON line.
 * @returns the Achilles-side event variant, or UnknownEvent on any
 *          mapping failure (preserving the raw input for forensics).
 */
export function mapWireEvent(wire: unknown): ClaudeStreamEvent {
  const all = mapWireEvents(wire);
  // mapWireEvents returns at least one event for every input (it falls
  // back to UnknownEvent rather than returning an empty array).
  return all[0] as ClaudeStreamEvent;
}

/**
 * Map a single Claude Code wire-format object into ONE OR MORE typed
 * {@link ClaudeStreamEvent}s (CR-fix WR-01).
 *
 * The Claude Code stream-json wire format routinely emits assistant
 * messages whose `content` array contains multiple blocks — e.g. a
 * "thinking aloud" text block FOLLOWED by a tool_use block. Before
 * WR-01, this mapper only inspected `content[0]`; subsequent blocks
 * were silently dropped. After WR-01, this function iterates the full
 * content array and returns one mapped event per block, preserving
 * document order.
 *
 * Behaviour:
 *
 *   - For multi-block assistant messages, returns an event per block in
 *     document order. The `partial` flag (delta vs. done) applies to
 *     ALL text blocks in the same message — `partial:true` -> all text
 *     blocks emit as `assistant_text_delta`; `partial` absent or false
 *     -> all text blocks emit as `assistant_text_done`. Multiple
 *     non-text blocks (tool_use, etc.) emit as their respective
 *     events.
 *   - For single-block messages, returns a one-element array. The
 *     single element is identical to what {@link mapWireEvent} returns.
 *   - For non-assistant types and for failed construction, returns a
 *     one-element array containing an UnknownEvent wrapping the raw
 *     wire input. The schema guard runs per emitted event so a drifted
 *     wire shape on one block does not poison the whole array.
 *
 * Order is preserved: callers can rely on `events[0]` being the first
 * `content` block, etc.
 *
 * @param wire the raw parsed JSON object from one NDJSON line.
 * @returns array of one or more Achilles-side event variants. Never
 *          empty; UnknownEvent is the universal fallback.
 */
export function mapWireEvents(wire: unknown): ClaudeStreamEvent[] {
  // Defensive: non-object / null / array inputs cannot be mapped.
  if (!isRecord(wire)) {
    return [makeUnknown(wire)];
  }
  const type = wire["type"];
  if (typeof type !== "string") {
    return [makeUnknown(wire)];
  }
  // Assistant content is the only variant with a multi-block surface.
  // All other types map to exactly one event.
  if (type === "assistant") {
    const expanded = constructAssistantVariants(wire);
    if (expanded === null) {
      return [makeUnknown(wire)];
    }
    // Per-event schema guard: if any block fails to validate, fall
    // back to UnknownEvent for THAT block only (not the whole line).
    // This preserves as much fidelity as possible while still
    // satisfying ClaudeStreamEventSchema.
    return expanded.map((candidate) => {
      const parsed = ClaudeStreamEventSchema.safeParse(candidate);
      if (!parsed.success) {
        return makeUnknown(wire);
      }
      return parsed.data;
    });
  }
  // Non-assistant types use the single-event construction path.
  const candidate = constructVariant(type, wire);
  if (candidate === null) {
    return [makeUnknown(wire)];
  }
  const parsed = ClaudeStreamEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return [makeUnknown(wire)];
  }
  return [parsed.data];
}

/**
 * Expand an assistant wire object into one event per content block.
 * Returns null when the message lacks the minimum shape the assistant
 * variant requires (no message object, empty content, etc.). The
 * caller falls back to UnknownEvent.
 *
 * CR-fix WR-01: iterates every block in `content[]` rather than only
 * reading `content[0]`.
 */
function constructAssistantVariants(
  wire: Record<string, unknown>,
): ClaudeStreamEvent[] | null {
  const message = wire["message"];
  if (!isRecord(message)) {
    return null;
  }
  const content = message["content"];
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  const isPartial = wire["partial"] === true;
  const out: ClaudeStreamEvent[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      // A non-object content entry is not a recoverable shape; surface
      // it as UnknownEvent so the call-site schema guard can flag it.
      out.push(makeUnknown(block));
      continue;
    }
    const blockType = block["type"];
    if (blockType === "text") {
      const text = block["text"];
      if (typeof text !== "string") {
        out.push(makeUnknown(block));
        continue;
      }
      if (isPartial) {
        out.push({ type: "assistant_text_delta", text });
      } else {
        out.push({ type: "assistant_text_done", full_text: text });
      }
      continue;
    }
    if (blockType === "tool_use") {
      const id = block["id"];
      const name = block["name"];
      if (typeof id !== "string" || typeof name !== "string") {
        out.push(makeUnknown(block));
        continue;
      }
      // `input` is z.unknown() in the schema — pass through verbatim.
      out.push({ type: "tool_use", id, name, input: block["input"] });
      continue;
    }
    // Unknown content-block type within an assistant message — surface
    // as UnknownEvent so downstream consumers can log the unexpected
    // shape without losing the rest of the line.
    out.push(makeUnknown(block));
  }
  if (out.length === 0) {
    return null;
  }
  return out;
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
