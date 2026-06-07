/**
 * Pre-TTS string normalisation for the Achilles voice loop.
 *
 * Ships PITFALLS #16 (long completion summary spoken aloud) and #21
 * (sensitive data read aloud verbatim). Composed by the orchestrator
 * (Plan 12-04, session.ts) on the assistant body extracted from the
 * <spoken-summary> block BEFORE the bytes reach the ElevenLabs TTS
 * stream. The normaliser is the belt-and-braces defence behind the
 * companion.md system prompt — the prompt instructs Claude not to read
 * paths/symbols/secrets aloud, and this module enforces it
 * mechanically.
 *
 * Defence-in-depth contract (per CONTEXT.md "Pre-TTS normalisation" +
 * "Log normalisation stats (count of redactions) but never the
 * redacted content"):
 *
 *   1. Fenced code blocks (triple-backtick) are dropped wholesale —
 *      code is silent and visible only in the terminal.
 *   2. ANSI escape sequences (CSI + OSC) are stripped.
 *   3. Absolute paths (/Users/..., /home/..., C:\Users\...) are masked
 *      to "the file".
 *   4. Secret-shape prefixes (sk-, xi-, ghp_, github_pat_) are masked
 *      to "[redacted secret]".
 *   5. Runs of whitespace collapsed.
 *   6. Final length capped at DEFAULT_TTS_CAP_CHARS (600).
 *
 * The returned `NormalisationReport` carries per-category COUNTS and a
 * truncation FLAG only. It does NOT include the redacted content
 * itself (SAFE-01 / PITFALLS #21 defence-in-depth: a downstream logger
 * that JSON.stringifies the report cannot leak the original bytes).
 *
 * All exports are pure: no clock reads, no console output, no I/O,
 * no mutation of input.
 */

/**
 * Defensive cap on the TTS input length. Per PITFALLS #16 (90-second
 * spoken summaries are user-hostile) and CONTEXT.md's "Cap final TTS
 * input length at 600 chars (defensive)".
 */
export const DEFAULT_TTS_CAP_CHARS = 600;

/**
 * Replacement token for matched secret-shape strings. The "[redacted
 * secret]" form is intentionally human-legible — if the TTS layer
 * speaks the post-redaction body, the listener hears that a secret was
 * present without the secret itself being read aloud.
 */
export const REDACTION_TOKEN = "[redacted secret]";

/**
 * Replacement noun used when masking absolute paths. Per CONTEXT.md
 * "/Users/... -> 'the file'" — a generic noun keeps the spoken summary
 * legible without leaking project structure.
 */
export const PATH_REPLACEMENT = "the file";

/**
 * Tail appended when `capLength` truncates. The leading space ensures
 * the cap point cannot land in the middle of a word.
 */
export const TRUNCATION_TAIL = " (more in the terminal)";

/**
 * CSI escape sequence regex. Covers SGR colour codes (\x1b[31m,
 * \x1b[0m), cursor movement (\x1b[2J), and the rest of the
 * Control-Sequence-Introducer family. Per CONTEXT.md "/\x1b\[[0-9;]*m/"
 * generalised to any final byte in the CSI range [A-Za-z].
 */
const ANSI_CSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * OSC escape sequence regex. Covers terminal title setters
 * (\x1b]0;title\x07) and other Operating-System-Command escapes
 * terminated by EITHER BEL (0x07) OR the C1 String Terminator
 * (ESC \\ = 0x1b 0x5c).
 *
 * WR-02 defence-in-depth: while the companion.md prompt forbids ANSI
 * in <spoken-summary>, a paste from a remote terminal can drop in an
 * ST-terminated OSC sequence. The class [^\x07\x1b] keeps the inner
 * match from crossing another ESC (so we never swallow content past
 * the terminator), and the (?:\x07|\x1b\\) alternation matches either
 * terminator.
 */
const ANSI_OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Absolute Unix-style path regex. Anchors on a leading word boundary
 * (start of input or whitespace) so bare slashes inside prose
 * ("a/b ratio") are left alone, and looks ahead for a sentence
 * terminator or whitespace so trailing punctuation is preserved.
 */
const UNIX_PATH_REGEX =
  /(^|\s)(\/[A-Za-z0-9_.~][A-Za-z0-9_.~/\\-]*)(?=\s|$|[.,!?;])/g;

/**
 * Absolute Windows-style path regex. Same anchoring strategy as
 * UNIX_PATH_REGEX; the second character group permits backslashes
 * after the drive letter.
 */
const WINDOWS_PATH_REGEX =
  /(^|\s)([A-Z]:\\[A-Za-z0-9_.~\\-]+)(?=\s|$|[.,!?;])/g;

/**
 * Secret-prefix patterns. Each has a minimum-length guard of 20
 * alphanumeric/dash/underscore characters AFTER the prefix so a casual
 * mention of "sk-" in prose is left alone. The prefixes themselves are
 * the public, well-known leading bytes of the respective provider's
 * keys (OpenAI / ElevenLabs / GitHub PAT / GitHub fine-grained PAT).
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxi-[A-Za-z0-9_-]{20,}/g,
  /\bghp_[A-Za-z0-9_]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
];

/**
 * Fenced code-block regex. The non-greedy `.*?` (with `[\s\S]` so the
 * dot eats newlines) means each pair of triple-backticks matches one
 * fenced block — even if multiple fences live in the same string.
 */
const FENCED_CODE_REGEX = /```[\s\S]*?```/g;

/**
 * Whitespace-run regex. After redactions the body can end up with
 * double or triple spaces in place of the original tokens; collapsing
 * to a single space keeps TTS prosody natural.
 */
const WHITESPACE_RUN_REGEX = /[ \t]{2,}/g;

/**
 * Multi-newline regex. After fenced-code drops the body can carry
 * runs of blank lines; collapse them to a single newline so the
 * spoken cadence stays even.
 */
const MULTI_NEWLINE_REGEX = /\n{2,}/g;

/**
 * Report shape returned by `normaliseForTts`. Per CONTEXT.md "Log
 * normalisation stats (count of redactions) but never the redacted
 * content" — the report carries COUNTS only. No field references the
 * original input bytes.
 */
export interface NormalisationReport {
  readonly ansi: { readonly count: number };
  readonly paths: { readonly count: number };
  readonly secrets: { readonly count: number };
  readonly fences: { readonly count: number };
  readonly truncated: boolean;
}

/**
 * Strips ANSI escape sequences from the input. Returns the cleaned
 * string and a count of removed escapes (CSI + OSC summed).
 *
 * Pure.
 */
export function stripAnsi(text: string): { value: string; count: number } {
  const csiCount = (text.match(ANSI_CSI_REGEX) ?? []).length;
  const oscCount = (text.match(ANSI_OSC_REGEX) ?? []).length;
  const value = text.replace(ANSI_CSI_REGEX, "").replace(ANSI_OSC_REGEX, "");
  return { value, count: csiCount + oscCount };
}

/**
 * Masks Unix-style and Windows-style absolute paths with
 * PATH_REPLACEMENT. Preserves the leading whitespace capture group so
 * surrounding prose punctuation is undisturbed.
 *
 * Pure.
 */
export function maskAbsolutePaths(text: string): {
  value: string;
  count: number;
} {
  const unixCount = (text.match(UNIX_PATH_REGEX) ?? []).length;
  const winCount = (text.match(WINDOWS_PATH_REGEX) ?? []).length;
  const replaced = text
    .replace(UNIX_PATH_REGEX, (_m, ws: string) => `${ws}${PATH_REPLACEMENT}`)
    .replace(WINDOWS_PATH_REGEX, (_m, ws: string) => `${ws}${PATH_REPLACEMENT}`);
  return { value: replaced, count: unixCount + winCount };
}

/**
 * Masks secret-shape strings with REDACTION_TOKEN. Iterates through
 * SECRET_PATTERNS, accumulating each match count and chaining the
 * replacement. The minimum-length guard inside each regex means a
 * casual mention of "sk-" or "xi-" in prose is preserved.
 *
 * Pure.
 */
export function maskSecretPrefixes(text: string): {
  value: string;
  count: number;
} {
  let value = text;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    const matches = value.match(pattern);
    if (matches) {
      count += matches.length;
      value = value.replace(pattern, REDACTION_TOKEN);
    }
  }
  return { value, count };
}

/**
 * Drops fenced code blocks (triple-backtick) wholesale. Per CONTEXT.md
 * "Drop fenced code blocks entirely (do not read code aloud)". After
 * the replacement, runs of blank lines left behind are collapsed to a
 * single newline so the spoken cadence stays even.
 *
 * Pure.
 */
export function dropFencedCode(text: string): {
  value: string;
  count: number;
} {
  const count = (text.match(FENCED_CODE_REGEX) ?? []).length;
  const stripped = text.replace(FENCED_CODE_REGEX, "");
  const collapsed = stripped.replace(MULTI_NEWLINE_REGEX, "\n");
  return { value: collapsed, count };
}

/**
 * Caps the input length at `capChars` (default DEFAULT_TTS_CAP_CHARS).
 * Truncated output ends with TRUNCATION_TAIL so the listener hears a
 * clear "(more in the terminal)" indicator instead of a mid-word
 * cutoff.
 *
 * Pure.
 */
function capLength(
  text: string,
  capChars: number = DEFAULT_TTS_CAP_CHARS,
): { value: string; truncated: boolean } {
  if (text.length <= capChars) {
    return { value: text, truncated: false };
  }
  const head = text.slice(0, capChars - TRUNCATION_TAIL.length);
  return { value: `${head}${TRUNCATION_TAIL}`, truncated: true };
}

/**
 * Composed pre-TTS normalisation. The order matters:
 *
 *   1. trim input
 *   2. drop fenced code blocks (cheapest big-bytes win — subsequent
 *      passes do not waste regex work on code content)
 *   3. strip ANSI
 *   4. mask absolute paths
 *   5. mask secret prefixes
 *   6. collapse whitespace runs (defensive after redactions)
 *   7. cap length
 *
 * Returns the normalised string + a `NormalisationReport` carrying
 * per-category COUNTS and the truncation flag. The report is
 * deliberately free of original input bytes (PITFALLS #21
 * defence-in-depth — a downstream logger that serialises the report
 * cannot leak the redacted content).
 *
 * Pure.
 *
 * @param text The assistant body extracted from the <spoken-summary>
 *   block. Empty / whitespace-only input returns "" with a zeroed
 *   report.
 * @param opts.capChars Optional override for the truncation cap.
 *   Defaults to DEFAULT_TTS_CAP_CHARS.
 */
export function normaliseForTts(
  text: string,
  opts?: { capChars?: number },
): { normalised: string; report: NormalisationReport } {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) {
    return {
      normalised: "",
      report: {
        ansi: { count: 0 },
        paths: { count: 0 },
        secrets: { count: 0 },
        fences: { count: 0 },
        truncated: false,
      },
    };
  }

  const fenced = dropFencedCode(trimmed);
  const ansi = stripAnsi(fenced.value);
  const paths = maskAbsolutePaths(ansi.value);
  const secrets = maskSecretPrefixes(paths.value);
  const collapsed = secrets.value
    .replace(WHITESPACE_RUN_REGEX, " ")
    .replace(MULTI_NEWLINE_REGEX, "\n")
    .trim();
  const capped = capLength(collapsed, opts?.capChars ?? DEFAULT_TTS_CAP_CHARS);

  return {
    normalised: capped.value,
    report: {
      ansi: { count: ansi.count },
      paths: { count: paths.count },
      secrets: { count: secrets.count },
      fences: { count: fenced.count },
      truncated: capped.truncated,
    },
  };
}
