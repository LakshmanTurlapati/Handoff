/**
 * Public TypeScript surface for @achilles/claude-code-bridge.
 *
 * The Zod schemas in ./event-schemas.ts validate the 9 wire-format
 * NDJSON variants the bridge parses from `claude -p --output-format
 * stream-json`. This file extends that surface with two pieces the
 * Zod schema intentionally does NOT cover:
 *
 *   1. ProcessExitEvent — synthesised by the bridge runtime (Plan
 *      10-02) from Node's child_process exit signal. Not parsed from
 *      an NDJSON line, so not validated by ClaudeStreamEventSchema;
 *      added at the TypeScript layer so callers can `switch` over a
 *      single ClaudeBridgeEvent shape.
 *   2. CreateClaudeSessionOptions, ClaudeOutcome — the v1.2 public
 *      options the bridge `createClaudeSession()` factory accepts and
 *      the authoritative outcome shape Phase 12 consumes to decide
 *      between the standard "I finished" spoken completion and the
 *      Pitfall #17 honest "I ran into a problem" override.
 *
 * Per CONVENTIONS.md: the options + outcome objects are declared as
 * `interface` rather than `type` so downstream callers can declare
 * additional fields via module augmentation if Phase 14 hardening
 * needs to attach telemetry hooks.
 */
import type { ClaudeStreamEvent } from "./event-schemas.js";

/**
 * Emitted by the bridge runtime (Plan 10-02) once the spawned
 * `claude` child exits. Not parsed from NDJSON; the bridge listens on
 * Node's child_process `exit` event and emits this synthesised event
 * on the same `events$` async iterable as the wire-format events.
 *
 * - `exit_code`: the process exit code, or `null` when the child was
 *   killed by a signal before producing an exit code.
 * - `signal`: the signal name (e.g. `"SIGINT"`, `"SIGTERM"`, `"SIGKILL"`),
 *   or `null` when the child exited cleanly via an exit code.
 *
 * Plan 10-02's authoritative ClaudeOutcome derivation: success when
 * exit_code === 0 AND no observed tool_result.is_error === true; all
 * other shapes are a failure with `reason` set to `"exit_code"`,
 * `"tool_error"`, or `"cancelled"` (the latter when Plan 10-03's
 * SIGINT-driven cancel() flow produced the exit).
 */
export interface ProcessExitEvent {
  type: "process_exit";
  exit_code: number | null;
  signal: string | null;
}

/**
 * TypeScript-level event surface emitted on the bridge's `events$`
 * async iterable. Combines the wire-format NDJSON union with the
 * runtime-synthesised ProcessExitEvent. Downstream code SHOULD
 * `switch` on `event.type` and rely on TS narrowing to access
 * variant-specific fields.
 */
export type ClaudeBridgeEvent = ClaudeStreamEvent | ProcessExitEvent;

/**
 * v1.2 public options for the bridge's `createClaudeSession()` factory
 * (Plan 10-02). Field semantics:
 *
 * - `systemPromptFile`: absolute path to the companion.md file the
 *   bridge passes via `--append-system-prompt-file <path>`. Phase 12
 *   owns the prompt body; this scaffold ships only the type.
 * - `resumeSessionId`: optional Claude session_id captured from a
 *   previous turn's `session_init` event. When present the bridge
 *   appends `--resume <sid>`; when absent the bridge starts a new
 *   session.
 * - `cwd`: optional working-directory override for the spawned child.
 *   When omitted the child inherits from the parent (Achilles main
 *   process cwd).
 * - `env`: optional environment-variable overlay merged onto the
 *   parent process env before spawn. Callers MUST NOT include the
 *   API key here in v1.2; Phase 14 owns the Claude Code authentication
 *   surface.
 */
export interface CreateClaudeSessionOptions {
  systemPromptFile: string;
  resumeSessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Authoritative outcome shape Plan 10-02 derives once `assistant_done`
 * or `process_exit` fires. Phase 12 reads this to choose the spoken
 * completion: the standard "I finished" or the Pitfall #17 honest
 * "I ran into a problem" override.
 *
 * - `kind`: success or failure. The bridge MUST NOT trust the LLM's
 *   narration to populate this field — success is derived from
 *   exit_code === 0 AND no tool_result.is_error === true observed
 *   during the turn.
 * - `reason`: only present on failure. `"exit_code"` when the child
 *   exited non-zero; `"tool_error"` when a tool_result reported
 *   is_error: true; `"cancelled"` when the cancel() primitive
 *   (Plan 10-03) produced the exit.
 * - `exitCode`: the raw process exit code at the time the outcome was
 *   computed; null when the child was killed by a signal.
 * - `details`: optional human-readable detail surfaced for telemetry
 *   and UI; MUST NOT contain the prompt body, the transcript, or any
 *   API key (security note carried forward from CONTEXT.md "Logging").
 */
export interface ClaudeOutcome {
  kind: "success" | "failure";
  reason?: "exit_code" | "tool_error" | "cancelled";
  exitCode?: number | null;
  details?: string;
}
