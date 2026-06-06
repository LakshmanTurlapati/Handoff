/**
 * Authoritative outcome derivation (Plan 10-02, Task 2).
 *
 * Pitfall #17 owner: this function decides success vs. failure for a
 * Claude Code turn using ONLY:
 *
 *   1. the child process exit code (or `null` when killed by a signal),
 *   2. the list of `tool_use_id`s that produced a `tool_result` with
 *      `is_error === true` during the turn,
 *   3. an explicit `cancelled` flag set by Plan 10-03's cancel() flow.
 *
 * It NEVER inspects LLM-narrated text. The Phase 10 success criterion 4
 * regression — the model says "I successfully read the file" while a
 * tool_result.is_error=true was emitted — is enforced here by treating
 * `toolErrors.length > 0` as a failure regardless of exit code.
 *
 * Priority order on multiple failure signals:
 *
 *   cancelled  > tool_error  > exit_code
 *
 * Rationale:
 *   - Cancellation is the most user-meaningful attribution: the user
 *     intentionally interrupted, so neither tool-call failures nor
 *     non-zero exit codes attribute the outcome to the work itself.
 *   - tool_error is more specific than exit_code: a non-zero exit may be
 *     a follow-on consequence of a tool failure, so we name the root
 *     cause rather than the surface symptom.
 *   - exit_code is the residual fallback.
 *
 * Phase 12's spoken-completion routing consumes the {@link ClaudeOutcome}
 * shape to choose between the standard "I finished" and the honest
 * "I ran into a problem" override (PROMPT-05). See ./types.ts for the
 * surface type.
 */

import type { ClaudeOutcome } from "./types.js";

/** Cap on the number of tool_use_ids included in the `details` string
 * to keep telemetry / log payloads bounded even on pathological turns. */
const TOOL_ERROR_ID_DISPLAY_CAP = 5;

export interface DeriveOutcomeInput {
  /** Process exit code at the time the outcome is computed; `null` when
   * the child was killed by a signal before producing a code. */
  exitCode: number | null;
  /** List of `tool_use_id`s that produced a `tool_result` with
   * `is_error === true` during the turn. The order is the order of
   * observation; only the first {@link TOOL_ERROR_ID_DISPLAY_CAP} are
   * surfaced in the human-readable `details` string. */
  toolErrors: string[];
  /** Set to `true` when Plan 10-03's cancel() flow produced the exit.
   * Overrides every other failure attribution so the user-facing reason
   * is "cancelled" rather than "exit_code" or "tool_error". */
  cancelled?: boolean;
}

/**
 * Derive the authoritative outcome of a Claude Code turn.
 *
 * @param input the authoritative signals (exit code, tool errors,
 *              cancellation flag) collected by Plan 10-02's session.
 * @returns the {@link ClaudeOutcome} Phase 12 reads to choose the
 *          spoken-completion variant.
 */
export function deriveOutcome(input: DeriveOutcomeInput): ClaudeOutcome {
  if (input.cancelled === true) {
    return { kind: "failure", reason: "cancelled" };
  }
  if (input.toolErrors.length > 0) {
    const head = input.toolErrors.slice(0, TOOL_ERROR_ID_DISPLAY_CAP);
    const ellipsis =
      input.toolErrors.length > TOOL_ERROR_ID_DISPLAY_CAP ? "..." : "";
    const details =
      `${input.toolErrors.length} tool_result with is_error=true ` +
      `(ids: ${head.join(", ")}${ellipsis})`;
    return { kind: "failure", reason: "tool_error", details };
  }
  if (input.exitCode !== 0) {
    return {
      kind: "failure",
      reason: "exit_code",
      exitCode: input.exitCode,
    };
  }
  return { kind: "success" };
}
