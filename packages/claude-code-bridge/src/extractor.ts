/**
 * Pure-function extractors for the Achilles voice loop.
 *
 * These two functions consume the assistant text accumulated by the
 * bridge (Plan 10-02 owns the accumulation; Phase 12 owns the call
 * sites) and return the strings the TTS layer should speak. They are
 * the v1.2 scaffolding for LOOP-04: the system prompt body that
 * actually drives Claude to emit the markers ships in Phase 12, but
 * the extractor pattern that finds the markers ships here so the
 * Phase 12 wiring builds against a frozen ABI.
 *
 * Contract references:
 *
 *   - CONTEXT.md "Ack + spoken-summary extractor" — the source of
 *     truth for the two function signatures and the empty-vs-null
 *     semantics for extractSpokenSummary
 *   - REQUIREMENTS.md PROMPT-02 — caps the spoken acknowledgement at
 *     ~12 words (~120 characters); extractAck enforces the 120-char
 *     ceiling
 *   - REQUIREMENTS.md PROMPT-03 — caps the spoken summary at <=40
 *     words. The cap is enforced by the prompt body in Phase 12; this
 *     file enforces only the marker boundary
 *   - PITFALLS.md #16 — long / symbol-heavy spoken completion. The
 *     120-char cap on extractAck is the first defence; Phase 12 will
 *     add normalisation before TTS
 *   - PITFALLS.md #17 — authoritative success/failure. These
 *     extractors are read-only over assistant text and do NOT
 *     contribute to the ClaudeOutcome derivation; the outcome is
 *     derived from process exit code + tool_result.is_error in Plan
 *     10-02
 *
 * Notes on purity:
 *
 *   - No module-level mutable state
 *   - No console.* logging
 *   - No clock or RNG reads
 *   - Inputs are not mutated (JavaScript strings are immutable, so
 *     this is structural — repeated calls with the same input return
 *     identical results)
 *
 * These functions do NOT call ElevenLabs, do NOT call the Claude
 * subprocess, and do NOT interact with the filesystem. Phase 12 wires
 * the outputs into the TTS routing path.
 */

/**
 * Single regex used by extractAck to find the first sentence terminator
 * (`.`, `?`, or `!`). Module-scoped to avoid re-compilation on hot
 * paths; the regex carries no state (no `g`, no `y`), so reuse is
 * safe.
 */
const SENTENCE_TERMINATOR_REGEX = /[.!?]/;

/**
 * Non-greedy match for `<spoken-summary>...</spoken-summary>`. The
 * `[\s\S]*?` body matches across newline boundaries; the absence of the
 * `g` flag means we capture only the first occurrence. Module-scoped
 * for reuse.
 */
const SPOKEN_SUMMARY_REGEX = /<spoken-summary>([\s\S]*?)<\/spoken-summary>/;

/**
 * Hard ceiling on the returned ack length, in code units. Corresponds
 * to the ~12-word PROMPT-02 contract; defined as a module-scoped
 * constant for readability of the slice() call in extractAck.
 */
const MAX_ACK_CHARS = 120;

/**
 * Return the first sentence emitted by the assistant, capped at 120
 * characters. Used by Phase 12 to feed the spoken acknowledgement to
 * the TTS layer (LOOP-04).
 *
 * Behaviour:
 *
 *   - Trims surrounding whitespace from the input
 *   - Returns null when the input is empty or whitespace-only after
 *     trim
 *   - Searches for the first sentence terminator (`.`, `?`, or `!`)
 *     using a single regex match (no String.prototype.split — that
 *     would allocate the full split array on long inputs)
 *   - Returns null when no terminator is present (the caller is still
 *     mid-utterance; Phase 12 will retry once the assistant produces
 *     terminating punctuation)
 *   - Slices from start through and including the terminator
 *   - Hard-caps the result at MAX_ACK_CHARS (120). The cap is bytewise:
 *     when the first sentence is longer than 120 chars the cap is
 *     applied directly to the slice and the terminator may be dropped
 *
 * @param streamText accumulated assistant text from the bridge
 * @returns the first sentence (capped) or null when no sentence is
 *          available
 */
// pure function — no side effects
export function extractAck(streamText: string): string | null {
  if (typeof streamText !== "string") {
    return null;
  }
  const trimmed = streamText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = SENTENCE_TERMINATOR_REGEX.exec(trimmed);
  if (match === null) {
    return null;
  }
  // match.index is the position of the terminator; include it.
  const sentence = trimmed.slice(0, match.index + 1);
  if (sentence.length > MAX_ACK_CHARS) {
    return sentence.slice(0, MAX_ACK_CHARS);
  }
  return sentence;
}

/**
 * Return the inner text of the first `<spoken-summary>...</spoken-summary>`
 * block in the input. Used by Phase 12 to feed the spoken completion
 * summary to the TTS layer (LOOP-04).
 *
 * Behaviour:
 *
 *   - Returns null when the input is null/undefined or when the markers
 *     are absent (including the open-marker-only case — an unclosed
 *     `<spoken-summary>` does not match the regex)
 *   - Returns the captured inner text with surrounding whitespace
 *     trimmed when the markers match. Inner whitespace between
 *     non-whitespace characters is preserved verbatim
 *   - Returns the empty string `""` when the markers match but enclose
 *     no content. This is the CONTEXT.md spec: null is reserved for
 *     "markers absent"; the empty string signals "markers present but
 *     empty"
 *   - Returns ONLY the first occurrence when multiple `<spoken-summary>`
 *     blocks appear (the regex has no `g` flag)
 *
 * @param streamText accumulated assistant text from the bridge
 * @returns the inner text, the empty string for empty markers, or null
 *          when the markers are absent
 */
// pure function — no side effects
export function extractSpokenSummary(streamText: string): string | null {
  if (typeof streamText !== "string") {
    return null;
  }
  const match = SPOKEN_SUMMARY_REGEX.exec(streamText);
  if (match === null) {
    return null;
  }
  const inner = match[1];
  if (inner === undefined) {
    // Should be unreachable because the regex always captures group 1
    // when it matches at all, but `noUncheckedIndexedAccess` widens
    // the indexed type; treat as "markers absent".
    return null;
  }
  return inner.trim();
}
