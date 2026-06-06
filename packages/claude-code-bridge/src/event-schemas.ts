/**
 * Claude Code wire-format event contracts (LOOP-04).
 *
 * These Zod schemas describe the 9-variant typed union the
 * @achilles/claude-code-bridge package emits per NDJSON line read from
 * the spawned `claude -p --output-format stream-json` subprocess. Plan
 * 10-02 owns the actual line parser and the mapping from Claude Code's
 * wire field names INTO these Achilles-side stable names; Plan 10-01
 * only ships the schemas and the inferred TypeScript types.
 *
 * Variants (in CLAUDE_STREAM_EVENT_TYPES order):
 *
 *   - session_init        — first event of every session; carries the
 *                           Claude session_id used by the --resume
 *                           primitive and the detected
 *                           claude_code_version surfaced for telemetry
 *   - assistant_text_delta — incremental assistant token chunk; only
 *                           emitted when --include-partial-messages is
 *                           passed, which is why Pitfall #7 forces
 *                           non-interactive `-p` over PTY
 *   - assistant_text_done — terminal full_text for the assistant turn
 *   - tool_use            — the model requested a tool call; carries
 *                           the opaque id and the raw input payload
 *   - tool_result         — a tool call returned; the optional is_error
 *                           flag is the source-of-truth signal Plan
 *                           10-02 derives the authoritative
 *                           success/failure ClaudeOutcome from (Pitfall
 *                           #17 — never trust the LLM's narration)
 *   - permission_request  — Claude is asking permission for an action;
 *                           Achilles auto-declines in v1.2
 *   - assistant_done      — terminal marker for the assistant message
 *   - parse_error         — Plan 10-02's LDJSON watchdog (Pitfall #8)
 *                           emits this when a line exceeds
 *                           MAX_LINE_BYTES or fails Zod validation
 *   - unknown_event       — Claude Code added a new wire event type
 *                           after this schema was written; emitted as a
 *                           warning rather than fatal so the bridge
 *                           remains forward-compatible
 *
 * Note on the discriminated-union surface: the runtime-emitted
 * `process_exit` event ({ type: "process_exit", exit_code, signal }) is
 * intentionally NOT in this Zod union. It is synthesised by the bridge
 * runtime (Plan 10-02) from Node's child_process exit signal, not
 * parsed from an NDJSON line. The TypeScript union in ./types.ts adds
 * it to ClaudeBridgeEvent so callers can switch over a single shape;
 * the Zod schema below validates wire-format NDJSON lines only.
 *
 * Pitfall ties:
 *   - #7  non-interactive `-p` mode (stdin newline is a literal char)
 *   - #8  LDJSON line buffer watchdog (per-line cap, this schema is the
 *         validation step after split-on-newline)
 *   - #17 authoritative success/failure derived from tool_result and
 *         exit_code, never from LLM narration
 */
import { z } from "zod";

/**
 * Discriminator literals for the 9 wire-format variants. Order is the
 * intended emission sequence: session_init first, then any mix of the
 * intermediate variants, terminated by assistant_done. parse_error and
 * unknown_event can appear at any point and are non-fatal.
 */
export const CLAUDE_STREAM_EVENT_TYPES = [
  "session_init",
  "assistant_text_delta",
  "assistant_text_done",
  "tool_use",
  "tool_result",
  "permission_request",
  "assistant_done",
  "parse_error",
  "unknown_event",
] as const;

export type ClaudeStreamEventType = (typeof CLAUDE_STREAM_EVENT_TYPES)[number];

/**
 * First wire event of every session. Carries the session_id Plan 10-02
 * persists for the `--resume` primitive plus the Claude Code version
 * string surfaced for telemetry / debugging.
 */
export const SessionInitSchema = z
  .object({
    type: z.literal("session_init"),
    session_id: z.string(),
    model: z.string(),
    claude_code_version: z.string(),
  })
  .strict();

export type SessionInit = z.infer<typeof SessionInitSchema>;

/**
 * Incremental assistant token chunk. Only emitted when
 * --include-partial-messages is passed (the bridge always passes it).
 * Plan 10-02 accumulates these into lastTurnText for Phase 12 to feed
 * extractAck / extractSpokenSummary.
 */
export const AssistantTextDeltaSchema = z
  .object({
    type: z.literal("assistant_text_delta"),
    text: z.string(),
  })
  .strict();

export type AssistantTextDelta = z.infer<typeof AssistantTextDeltaSchema>;

/**
 * Terminal full assistant text for the turn. Phase 12 uses this as a
 * defensive double-read for the spoken-summary extractor in case the
 * live delta stream missed a marker boundary.
 */
export const AssistantTextDoneSchema = z
  .object({
    type: z.literal("assistant_text_done"),
    full_text: z.string(),
  })
  .strict();

export type AssistantTextDone = z.infer<typeof AssistantTextDoneSchema>;

/**
 * The assistant requested a tool call. The `input` payload is left as
 * unknown because the tool surface is defined by Claude Code, not by
 * Achilles; downstream consumers narrow on `name` if they need to
 * inspect the payload.
 */
export const ToolUseSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  })
  .strict();

export type ToolUse = z.infer<typeof ToolUseSchema>;

/**
 * A tool call returned. The optional `is_error` flag is the
 * source-of-truth Plan 10-02 derives the authoritative ClaudeOutcome
 * from — Pitfall #17 mandates the bridge ignores the LLM's narration
 * when deciding success vs. failure. The flag is optional so
 * tool_result lines without it parse cleanly (most successful tools
 * omit it).
 */
export const ToolResultSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.string(),
    is_error: z.boolean().optional(),
  })
  .strict();

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Claude is asking permission for an action. Achilles auto-declines in
 * v1.2 (the bridge replies with a denied permission_response and
 * surfaces a permission_denied event). The `details` payload is left as
 * an unknown record because the permission surface is defined by
 * Claude Code.
 */
export const PermissionRequestSchema = z
  .object({
    type: z.literal("permission_request"),
    id: z.string(),
    action: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/**
 * Terminal marker for the assistant message. Plan 10-02 uses this as
 * the signal to finalise lastTurnText and compute the ClaudeOutcome
 * for Phase 12 to consume.
 */
export const AssistantDoneSchema = z
  .object({
    type: z.literal("assistant_done"),
  })
  .strict();

export type AssistantDone = z.infer<typeof AssistantDoneSchema>;

/**
 * Emitted by the bridge's LDJSON line buffer (Plan 10-02) when a line
 * exceeds MAX_LINE_BYTES or fails Zod validation against any of the
 * sibling variants. Non-fatal — the bridge logs the error and
 * continues. The optional `raw_line` carries the offending bytes
 * (truncated as needed) for post-mortem debugging.
 */
export const ParseErrorSchema = z
  .object({
    type: z.literal("parse_error"),
    error: z.string(),
    raw_line: z.string().optional(),
  })
  .strict();

export type ParseError = z.infer<typeof ParseErrorSchema>;

/**
 * Emitted when Claude Code introduced a new wire event type after this
 * schema was written. Forward-compat surface — the bridge logs a
 * warning and continues. Plan 10-02 uses this branch as the catch-all
 * for shapes that have a `type` discriminator the union does not yet
 * recognise.
 */
export const UnknownEventSchema = z
  .object({
    type: z.literal("unknown_event"),
    raw: z.unknown(),
  })
  .strict();

export type UnknownEvent = z.infer<typeof UnknownEventSchema>;

/**
 * Discriminated union over every wire-format NDJSON event. Downstream
 * code SHOULD `switch` on `event.type` rather than introspecting
 * individual schemas. The runtime-emitted `process_exit` event is NOT
 * in this union — see the top-of-file note and ./types.ts for the
 * TypeScript-level surface that adds it.
 */
export const ClaudeStreamEventSchema = z.discriminatedUnion("type", [
  SessionInitSchema,
  AssistantTextDeltaSchema,
  AssistantTextDoneSchema,
  ToolUseSchema,
  ToolResultSchema,
  PermissionRequestSchema,
  AssistantDoneSchema,
  ParseErrorSchema,
  UnknownEventSchema,
]);

export type ClaudeStreamEvent = z.infer<typeof ClaudeStreamEventSchema>;
