/**
 * Phase 18, Plan 03, Task 2 — Transcript store module.
 *
 * Requirements:
 *   - SAFE-02: transcripts are OFF by default; --save-transcripts opts in.
 *     Plan 04's cli.ts is the place where --save-transcripts flag wires this
 *     to session.ts as a subscriber.
 *   - SAFE-02: each line is redacted via DEFAULT_REDACT_PATTERNS (7 regexes
 *     from structured-logger.ts, including the xi_ Plan 02 7th pattern) before
 *     being written.
 *   - T-18-14 mitigate: API keys typed into typed-input fallback are redacted
 *     before reaching the JSONL file.
 *   - T-18-19 mitigate: transcripts/ directory is created at 0o700; each file
 *     is set to 0o600 on first write.
 *
 * Format: JSONL — one JSON object per line, newline-terminated.
 *
 * The store appends a session_end system entry on dispose() so the file has
 * bounded structure even if the process exits mid-run (the file remains valid
 * JSONL — it just has an extra session_end).
 *
 * All filesystem operations are injectable via deps seams so tests run
 * hermetically.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import {
  appendFileSync,
  mkdirSync as nodeMkdirSync,
  chmodSync as nodeChmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { DEFAULT_REDACT_PATTERNS } from "../structured-logger.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * A single line in the transcript JSONL file.
 *
 * @public
 */
export interface TranscriptEntry {
  readonly t: number;
  readonly type: "user" | "assistant" | "system";
  readonly text?: string;
  readonly event?: string;
  readonly session_id?: string;
}

/**
 * Handle returned by createTranscriptStore. The caller appends entries
 * and calls dispose() at session end.
 *
 * @public
 */
export interface TranscriptStoreHandle {
  append(entry: TranscriptEntry): void;
  dispose(): void;
  readonly filePath: string;
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Injection seam for createTranscriptStore. Tests inject homedirImpl to
 * point at a tmpdir; chmodSyncImpl and mkdirSyncImpl can be spy wrappers.
 *
 * @public
 */
export interface TranscriptStoreDeps {
  homedirImpl?: () => string;
  chmodSyncImpl?: (path: string, mode: number) => void;
  mkdirSyncImpl?: (path: string, opts: { recursive: boolean; mode: number }) => void;
  appendFileSyncImpl?: (path: string, data: string) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REDACTION_MARKER = "[REDACTED]";

/**
 * Apply every DEFAULT_REDACT_PATTERN to a single string value. Returns the
 * redacted string. Mirrors the applyRedactions helper in structured-logger.ts
 * but is implemented here independently to avoid coupling.
 */
function applyRedactionsToLine(
  line: string,
  patterns: ReadonlyArray<RegExp>,
): string {
  let result = line;
  for (const pattern of patterns) {
    result = result.replace(pattern, REDACTION_MARKER);
  }
  return result;
}

/**
 * Serialize a TranscriptEntry to a single JSONL line (no newline appended
 * here — the caller appends "\n"). Applies redaction to the `text` and
 * `event` string fields before serializing.
 */
function serializeEntry(entry: TranscriptEntry): string {
  const redactedText =
    entry.text !== undefined
      ? applyRedactionsToLine(entry.text, DEFAULT_REDACT_PATTERNS)
      : undefined;
  const redactedEvent =
    entry.event !== undefined
      ? applyRedactionsToLine(entry.event, DEFAULT_REDACT_PATTERNS)
      : undefined;

  const obj: Record<string, unknown> = { t: entry.t, type: entry.type };
  if (redactedText !== undefined) obj["text"] = redactedText;
  if (redactedEvent !== undefined) obj["event"] = redactedEvent;
  if (entry.session_id !== undefined) obj["session_id"] = entry.session_id;

  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a TranscriptStoreHandle that writes JSONL to
 * ~/.achilles/transcripts/<sessionId>.jsonl.
 *
 * The parent directory is created at 0o700 on construction; each file is
 * chmod'd to 0o600 on first append.
 *
 * @public
 */
export function createTranscriptStore(
  sessionId: string,
  deps: TranscriptStoreDeps = {},
): TranscriptStoreHandle {
  const homedirImpl = deps.homedirImpl ?? homedir;
  const chmodSyncImpl = deps.chmodSyncImpl ?? nodeChmodSync;
  const mkdirSyncImpl = deps.mkdirSyncImpl ?? nodeMkdirSync;
  const appendFileSyncImpl = deps.appendFileSyncImpl ?? appendFileSync;

  const transcriptsDir = join(homedirImpl(), ".achilles", "transcripts");
  const filePath = join(transcriptsDir, `${sessionId}.jsonl`);

  // Create the parent dir with 0o700 at construction time.
  mkdirSyncImpl(transcriptsDir, { recursive: true, mode: 0o700 });

  let disposed = false;
  let firstWrite = true;

  function writeEntry(entry: TranscriptEntry): void {
    const line = serializeEntry(entry) + "\n";
    appendFileSyncImpl(filePath, line);
    if (firstWrite) {
      chmodSyncImpl(filePath, 0o600);
      firstWrite = false;
    }
  }

  function append(entry: TranscriptEntry): void {
    if (disposed) return;
    writeEntry(entry);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const sessionEndEntry: TranscriptEntry = {
      t: Date.now(),
      type: "system",
      event: "session_end",
      session_id: sessionId,
    };
    writeEntry(sessionEndEntry);
  }

  return {
    append,
    dispose,
    get filePath() {
      return filePath;
    },
  };
}
