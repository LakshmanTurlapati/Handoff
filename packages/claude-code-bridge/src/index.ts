/**
 * @achilles/claude-code-bridge
 *
 * Subprocess wrapper around `claude -p --output-format stream-json` for
 * Achilles. This package owns the stable type surface that the Wave 2
 * runtime tasks (Plans 10-02 and 10-03) and the Phase 12 prompt wiring
 * consume.
 *
 * The barrel below is the single supported import surface for downstream
 * code; submodule boundaries (`./constants.js`, `./errors.js`,
 * `./event-schemas.js`, `./extractor.js`, `./types.js`) are an
 * implementation detail and may change without a major version bump.
 *
 * Contracts owned here (Plan 10-01):
 *
 *   - Constants:  MIN_CLAUDE_VERSION, MAX_LINE_BYTES, LOCKED_FLAGS,
 *                 SKIP_VERSION_CHECK_ENV_VAR
 *   - Errors:     ClaudeVersionError (carries actualVersion +
 *                 requiredVersion readonly fields)
 *   - Wire schema: ClaudeStreamEventSchema — Zod discriminated union over
 *                  9 NDJSON event variants (session_init,
 *                  assistant_text_delta, assistant_text_done, tool_use,
 *                  tool_result, permission_request, assistant_done,
 *                  parse_error, unknown_event)
 *   - Types:      ClaudeBridgeEvent (wire union + ProcessExitEvent),
 *                 CreateClaudeSessionOptions, ClaudeOutcome
 *   - Extractors: extractAck, extractSpokenSummary — pure functions over
 *                 accumulated assistant text, used by Phase 12 to drive
 *                 the voice-loop ack and the spoken-summary TTS routing
 *
 * Contracts intentionally NOT shipped here (deferred to Wave 2):
 *
 *   - createClaudeSession() runtime spawn (Plan 10-02)
 *   - NDJSON line parser + watchdog (Plan 10-02)
 *   - Cancellation primitive + SIGINT escalation (Plan 10-03)
 *   - Embedded companion system prompt body (Phase 12)
 *
 * Each Zod schema is paired with its companion `type X = z.infer<...>`
 * alias so callers can use the runtime guard and the static type from
 * the same import.
 */
export * from "./constants.js";
export * from "./errors.js";
export * from "./event-schemas.js";
export * from "./extractor.js";
export * from "./types.js";
// Wave 2 runtime spine (Plan 10-02):
export * from "./line-parser.js";
export * from "./wire-mapper.js";
export * from "./version-check.js";
export * from "./outcome.js";
export * from "./session.js";
