/**
 * Phase 17, Plan 01, Task 2 — Structured NDJSON logger module.
 *
 * Substrate for the Phase 19 ERR-08 wiring: a single createStructuredLogger
 * instance constructed at runVoice() entry, fanned out to every audio/
 * module's logger seam. Writes NDJSON to ~/.achilles/achilles.log on every
 * run regardless of --debug flag (closes the v1.2 silent-stdio gap).
 *
 * Public surface:
 *
 *   - createStructuredLogger(deps): StructuredLogger
 *   - interface StructuredLogger { info, warn, error, child, flush, dispose }
 *
 * Defaults:
 *   - logDir = path.join(os.homedir(), ".achilles")
 *   - file   = "achilles.log"
 *   - maxBytes = 10 * 1024 * 1024  (10 MB rotation)
 *
 * On every write:
 *   - Stringify { ts, level, scope, event, ...fields } to NDJSON
 *   - Apply the 6 default redaction regex families to the serialised line
 *   - Check the file size; if it exceeds maxBytes, rotate to .log.1
 *
 * Default redaction patterns (T-17-01 + T-18-07 mitigation):
 *   - /sk-[a-zA-Z0-9]{16,}/g                       — generic sk- prefix (OpenAI / Anthropic)
 *   - /xi-[a-zA-Z0-9-]{20,}/g                      — ElevenLabs xi- key prefix (hyphen)
 *   - /Bearer\s+[A-Za-z0-9._-]+/g                  — Authorization Bearer values
 *   - /[a-zA-Z0-9_-]{32,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g  — JWTs
 *   - /[a-f0-9]{64,}/g                             — long hex tokens (SHA-256, etc.)
 *   - /ELEVENLABS_API_KEY=\S+/g                    — env var assignments
 *   - /xi_[a-zA-Z0-9]{40,}/g                      — ElevenLabs new xi_ key shape (T-18-07)
 *
 * The replacement marker is `[REDACTED]`. Callers can supply additional
 * patterns via the redactPatterns dep; the default list is always
 * applied first.
 *
 * File-system contract:
 *
 *   - mkdirSync(logDir, { recursive: true, mode: 0o700 }) — idempotent
 *     (T-17-LG: 0o700 limits access to the owning user on POSIX)
 *   - appendFileSync(file, line, { mode: 0o600 }) — sync to guarantee
 *     the log line survives a SIGINT mid-write
 *   - statSync(file) before each write to check the rotation threshold;
 *     rename existing .log to .log.1 (deleting any previous .log.1)
 *
 * Threat model:
 *   - T-17-01 mitigation: default redaction patterns cover the 6 known
 *     secret shapes; tests assert removal of the fixture sk- pattern
 *   - T-17-03 mitigation: 10 MB rotation prevents unbounded growth
 *   - T-17-LG mitigation: 0o700 dir + 0o600 file modes restrict
 *     read access to the owning user
 *
 * The disposed flag short-circuits subsequent calls so a SIGINT-driven
 * shutdown that calls dispose() before the audio-pipeline tasks have
 * fully cleared their logger emissions does not throw.
 *
 * No emojis (CLAUDE.md global).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Log level — one of three sinks per StructuredLogger instance.
 *
 * @public
 */
export type LogLevel = "info" | "warn" | "error";

/**
 * Construction-time dependencies for createStructuredLogger. Every
 * threshold + every clock + every redaction list is injected so tests
 * are deterministic and hermetic.
 *
 * @public
 */
export interface CreateStructuredLoggerDeps {
  /**
   * Directory to write the log file under. Defaults to
   * `path.join(os.homedir(), ".achilles")`.
   */
  readonly logDir?: string;
  /**
   * Filename inside logDir. Defaults to `"achilles.log"`.
   */
  readonly fileName?: string;
  /**
   * Rotation threshold in bytes. When statSync(file).size exceeds this
   * value, the file is renamed to fileName + ".1" (the previous .1
   * file is unlinked first), and a fresh log file is started on the
   * next write. Defaults to 10 * 1024 * 1024 (10 MB).
   */
  readonly maxBytes?: number;
  /**
   * Clock seam. Production defaults to `() => Date.now()`. Tests
   * inject a deterministic fake.
   */
  readonly nowImpl?: () => number;
  /**
   * Caller-supplied redaction patterns appended to the default list.
   * Every entry is applied via `String.prototype.replaceAll` (the
   * pattern's flags must include `g` for full-line redaction).
   */
  readonly redactPatterns?: ReadonlyArray<RegExp>;
  /**
   * Initial scope label. Defaults to the empty string; the child()
   * method returns a new logger with a non-empty scope.
   */
  readonly scope?: string;
}

/**
 * Logger handle. Every method on a disposed logger is a no-op.
 *
 * @public
 */
export interface StructuredLogger {
  /**
   * Append an `info`-level NDJSON line.
   */
  info(event: string, fields?: Record<string, unknown>): void;
  /**
   * Append a `warn`-level NDJSON line.
   */
  warn(event: string, fields?: Record<string, unknown>): void;
  /**
   * Append an `error`-level NDJSON line.
   */
  error(event: string, fields?: Record<string, unknown>): void;
  /**
   * Return a new logger that prefixes every line with the given scope.
   * The child shares the underlying file handle + state with the
   * parent; disposing either disposes both.
   */
  child(scope: string): StructuredLogger;
  /**
   * No-op in the sync-write implementation (appendFileSync flushes
   * synchronously). Returns a resolved Promise so callers can compose
   * a graceful-shutdown await chain symmetrically.
   */
  flush(): Promise<void>;
  /**
   * Mark the logger as disposed. Subsequent info/warn/error calls
   * become no-ops.
   */
  dispose(): void;
}

/**
 * Default redaction patterns — 7 regex families covering the known
 * secret shapes (T-17-01 + T-18-07 mitigation). Applied in declared order
 * via String.prototype.replaceAll; every pattern uses the `g` flag.
 *
 * Order matters: the JWT pattern is listed before the long-hex
 * pattern because a JWT's signature segment IS a long hex/base64
 * string; matching the JWT shape first preserves the structure of the
 * surrounding token in the redacted output.
 *
 * Pattern 7 (T-18-07): ElevenLabs new key shape (xi UNDERSCORE prefix,
 * 40+ alphanumeric chars). Distinct from pattern 4 (xi HYPHEN prefix).
 * Added in Phase 18 Plan 02.
 */
const DEFAULT_REDACT_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /[a-zA-Z0-9_-]{32,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sk-[a-zA-Z0-9]{16,}/g,
  /xi-[a-zA-Z0-9-]{20,}/g,
  /ELEVENLABS_API_KEY=\S+/g,
  /[a-f0-9]{64,}/g,
  /xi_[a-zA-Z0-9]{40,}/g,
];

const REDACTION_MARKER = "[REDACTED]";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_FILE_NAME = "achilles.log";

/**
 * Shared mutable state across a parent logger and any children it
 * spawns. The shared `disposed` flag means dispose() on the parent
 * cascades to the children automatically.
 */
interface SharedLoggerState {
  disposed: boolean;
  readonly logDir: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly rotatedPath: string;
  readonly maxBytes: number;
  readonly nowImpl: () => number;
  readonly redactPatterns: ReadonlyArray<RegExp>;
  // Tracks whether mkdirSync + chmodSync on filePath have been issued
  // already; the first write is responsible for ensuring the dir
  // exists and the file mode is 0o600.
  initialized: boolean;
}

/**
 * Apply every redaction pattern to a single line. Returns the
 * redacted line. Multiple-match patterns (the `g` flag) replace ALL
 * occurrences; non-`g` patterns replace only the first occurrence —
 * but every entry in the default list uses `g`.
 */
function applyRedactions(
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
 * Initialize the log directory + file (idempotent). Creates the
 * directory with mode 0o700 (T-17-LG); ensures the file has mode
 * 0o600 if it already exists, or will get 0o600 on first write.
 */
function initializeIfNeeded(state: SharedLoggerState): void {
  if (state.initialized) return;
  try {
    mkdirSync(state.logDir, { recursive: true, mode: 0o700 });
  } catch {
    // mkdirSync with recursive:true is idempotent; the only realistic
    // failure mode is EACCES on a parent dir, which we leave to
    // surface at the appendFileSync call below.
  }
  if (existsSync(state.filePath)) {
    try {
      chmodSync(state.filePath, 0o600);
    } catch {
      // best-effort — POSIX systems honor chmod; Windows does not but
      // does not throw.
    }
  }
  state.initialized = true;
}

/**
 * Rotate the log file if its current size exceeds maxBytes. Renames
 * filePath -> rotatedPath, deleting any previous rotatedPath. After
 * rotation, the next appendFileSync creates a fresh empty file.
 */
function rotateIfNeeded(state: SharedLoggerState): void {
  if (!existsSync(state.filePath)) return;
  let size: number;
  try {
    size = statSync(state.filePath).size;
  } catch {
    return;
  }
  if (size <= state.maxBytes) return;
  if (existsSync(state.rotatedPath)) {
    try {
      unlinkSync(state.rotatedPath);
    } catch {
      // best-effort; if removal fails, renameSync below may also fail
      // and we surface that to the caller via the next write attempt.
    }
  }
  try {
    renameSync(state.filePath, state.rotatedPath);
  } catch {
    // best-effort; if rename fails the next write will continue to
    // grow the existing file, which is the safer failure mode.
  }
}

/**
 * Serialise a single log entry to NDJSON and apply redactions.
 */
function buildLine(
  state: SharedLoggerState,
  scope: string,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> | undefined,
): string {
  const record: Record<string, unknown> = {
    ts: state.nowImpl(),
    level,
    event,
  };
  if (scope.length > 0) {
    record["scope"] = scope;
  }
  if (fields !== undefined) {
    for (const [k, v] of Object.entries(fields)) {
      // Avoid overwriting reserved fields; reserved fields win.
      if (
        k === "ts" ||
        k === "level" ||
        k === "event" ||
        k === "scope"
      ) {
        continue;
      }
      record[k] = v;
    }
  }
  let serialised: string;
  try {
    serialised = JSON.stringify(record);
  } catch {
    // Fall back to a redacted shape if JSON.stringify throws (e.g.
    // circular reference in fields). Never throw from the logger.
    serialised = JSON.stringify({
      ts: state.nowImpl(),
      level,
      event,
      scope: scope.length > 0 ? scope : undefined,
      error: "json_stringify_failed",
    });
  }
  return applyRedactions(serialised, state.redactPatterns) + "\n";
}

function writeLine(
  state: SharedLoggerState,
  scope: string,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> | undefined,
): void {
  if (state.disposed) return;
  initializeIfNeeded(state);
  rotateIfNeeded(state);
  const line = buildLine(state, scope, level, event, fields);
  try {
    appendFileSync(state.filePath, line, { mode: 0o600 });
  } catch {
    // Never throw from the logger — losing a log line is preferable
    // to crashing the host pipeline.
  }
}

/**
 * Build a logger handle bound to the supplied shared state + scope.
 */
function buildLogger(
  state: SharedLoggerState,
  scope: string,
): StructuredLogger {
  return {
    info(event, fields) {
      writeLine(state, scope, "info", event, fields);
    },
    warn(event, fields) {
      writeLine(state, scope, "warn", event, fields);
    },
    error(event, fields) {
      writeLine(state, scope, "error", event, fields);
    },
    child(childScope) {
      const composed =
        scope.length > 0 ? `${scope}.${childScope}` : childScope;
      return buildLogger(state, composed);
    },
    flush() {
      return Promise.resolve();
    },
    dispose() {
      state.disposed = true;
    },
  };
}

/**
 * Build a structured-logger handle using the supplied deps. Defaults
 * to `~/.achilles/achilles.log`, 10 MB rotation, and the 6 default
 * redaction patterns.
 *
 * @public
 */
export function createStructuredLogger(
  deps: CreateStructuredLoggerDeps = {},
): StructuredLogger {
  const logDir = deps.logDir ?? join(homedir(), ".achilles");
  const fileName = deps.fileName ?? DEFAULT_FILE_NAME;
  const filePath = join(logDir, fileName);
  const rotatedPath = `${filePath}.1`;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const nowImpl = deps.nowImpl ?? ((): number => Date.now());
  // Compose default patterns + caller-supplied patterns. The default
  // list is always applied first so a caller-supplied pattern cannot
  // disable a default by overriding the same regex source.
  const redactPatterns: ReadonlyArray<RegExp> =
    deps.redactPatterns !== undefined
      ? [...DEFAULT_REDACT_PATTERNS, ...deps.redactPatterns]
      : DEFAULT_REDACT_PATTERNS;
  const scope = deps.scope ?? "";
  const state: SharedLoggerState = {
    disposed: false,
    logDir,
    fileName,
    filePath,
    rotatedPath,
    maxBytes,
    nowImpl,
    redactPatterns,
    initialized: false,
  };
  return buildLogger(state, scope);
}
