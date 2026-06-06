/**
 * Shared constants for @achilles/claude-code-bridge.
 *
 * This file is the single source of truth for the locked subprocess
 * surface, the watchdog cap on a single NDJSON line, the minimum
 * supported Claude Code CLI version, and the environment-variable name
 * used to skip the version check in test environments.
 *
 * Notes on LOCKED_FLAGS: this constant captures only the flag NAMES
 * (`-p`, `--output-format`, `stream-json`, `--include-partial-messages`,
 * `--append-system-prompt-file`, `--resume`). The flag VALUES — the
 * filesystem path that follows `--append-system-prompt-file` and the
 * session-id string that follows `--resume` — are caller-provided at
 * runtime and are NOT part of this constant. Plan 10-02 will compose
 * the final argv from this constant plus the runtime values; Phase 12
 * will plumb the companion.md path through `systemPromptFile`.
 */

/**
 * Conservative floor for the Claude Code CLI version Achilles will
 * spawn. Pinned in CONTEXT.md per Pitfall #24 (skill assumes specific
 * Claude Code version). Plan 10-02 runs `claude --version` before
 * spawning the streaming child and throws ClaudeVersionError when the
 * detected version is older than this floor.
 */
export const MIN_CLAUDE_VERSION = "2.0.0";

/**
 * Per-line cap (1 MiB) for the NDJSON line buffer Plan 10-02 will own.
 * Lines exceeding this cap emit a `parse_error` event and the buffer is
 * discarded up to the next `\n`. Defined here so both Plan 10-02's
 * parser and any downstream tests agree on the constant.
 */
export const MAX_LINE_BYTES = 1_048_576;

/**
 * Immutable list of subprocess flag NAMES the Achilles bridge will pass
 * to `claude`. The actual argv composed by Plan 10-02 will interleave
 * caller-provided values (a path after `--append-system-prompt-file`
 * and a session id after `--resume`) between the entries below.
 *
 * Order matches CONTEXT.md "Locked by REQUIREMENTS.md":
 *
 *   claude -p --output-format stream-json --include-partial-messages
 *          --append-system-prompt-file <companion.md> --resume <sid>
 */
export const LOCKED_FLAGS = [
  "-p",
  "--output-format",
  "stream-json",
  "--include-partial-messages",
  "--append-system-prompt-file",
  "--resume",
] as const;

/**
 * Process environment variable name. When set to a truthy value Plan
 * 10-02 will bypass the `claude --version` check before spawning the
 * streaming child. Intended for test environments only.
 */
export const SKIP_VERSION_CHECK_ENV_VAR =
  "ACHILLES_SKIP_CLAUDE_VERSION_CHECK";
