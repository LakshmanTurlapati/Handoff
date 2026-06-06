/**
 * LDJSON (newline-delimited JSON) line parser with MAX_LINE_BYTES
 * watchdog (Plan 10-02, Task 1).
 *
 * Pitfall #8 owner: the parser accumulates Buffer chunks read from the
 * spawned `claude` child's stdout, splits on the first `\n`, parses each
 * prefix as JSON, keeps the trailing remainder in the buffer, and emits
 * `parse_error` for both malformed JSON (with the raw line preserved,
 * truncated at 256 chars for log hygiene) and for any single line that
 * exceeds MAX_LINE_BYTES (the watchdog cap). The watchdog discards the
 * over-cap buffer up to the next `\n` so the stream keeps parsing after
 * a pathological line.
 *
 * CONTEXT.md "NDJSON parsing" section ties:
 *
 *   - Line buffer is a simple `Buffer` accumulator, split on `\n`, with
 *     a `MAX_LINE_BYTES = 1_048_576` (1 MiB) cap.
 *   - Lines exceeding the cap emit a `parse_error` event and the bridge
 *     discards the buffer up to the next `\n`.
 *   - Partial JSON (an incomplete last line at process exit) is
 *     tolerated: best-effort one final parse attempt, otherwise emit
 *     `parse_error` and proceed to close (the `flush()` method
 *     implements this contract).
 *
 * The parser is event-driven via two `on` overloads (`"json"` and
 * `"parse_error"`). It avoids `node:events`' `EventEmitter` to keep the
 * type narrowing per-event handler clean — the inline handler map below
 * is the minimum surface that satisfies the LineParser interface
 * without leaking the wildcard `addListener` shape of EventEmitter.
 */

import { Buffer } from "node:buffer";

import { MAX_LINE_BYTES } from "./constants.js";

/** Max number of characters of a raw bad line to surface in parse_error.
 * Keeps logs bounded even when the offending line is megabytes long.
 */
const RAW_LINE_LOG_CAP = 256;

export interface ParseErrorPayload {
  /** Short reason string: "line_too_long" for the watchdog cap; otherwise
   * a prefixed form like "syntax: <message>" or
   * "trailing_partial: <message>". */
  error: string;
  /** First {@link RAW_LINE_LOG_CAP} characters of the offending line. Set
   * only for malformed-JSON / trailing-partial errors; omitted for the
   * "line_too_long" watchdog because the offending content has already
   * exceeded a sane log size by definition. */
  raw_line?: string;
}

export interface LineParser {
  /** Push a stdout chunk into the parser. Emits `"json"` for each
   * complete line that parses successfully and `"parse_error"` for
   * malformed lines or watchdog trips. Safe to call after the child has
   * exited as long as `flush()` has not been called. */
  write(chunk: Buffer): void;
  /** Best-effort final parse for a trailing partial line (one without a
   * `\n`). Emits one final `"json"` or `"parse_error"` event for that
   * partial; after `flush()` returns the parser must not be written to
   * again. */
  flush(): void;
  /** Register a handler for parsed JSON objects. */
  on(event: "json", handler: (obj: unknown) => void): void;
  /** Register a handler for parse errors and watchdog trips. */
  on(event: "parse_error", handler: (err: ParseErrorPayload) => void): void;
}

/**
 * Construct a new LDJSON line parser.
 *
 * @returns a {@link LineParser} ready to consume child stdout chunks.
 */
export function createLineParser(): LineParser {
  // Mutable internal state. `accumulator` holds the bytes of the
  // currently-incomplete line plus any not-yet-split tail.
  // `discardingUntilNewline` is set after a line_too_long event so that
  // the next call to write() throws the overflow tail away rather than
  // attempting to parse it.
  let accumulator: Buffer = Buffer.alloc(0);
  let discardingUntilNewline = false;

  const jsonHandlers: Array<(obj: unknown) => void> = [];
  const parseErrorHandlers: Array<(err: ParseErrorPayload) => void> = [];

  function emitJson(obj: unknown): void {
    for (const h of jsonHandlers) {
      h(obj);
    }
  }
  function emitParseError(err: ParseErrorPayload): void {
    for (const h of parseErrorHandlers) {
      h(err);
    }
  }

  /**
   * Parse one already-extracted line prefix (without the terminating
   * `\n`). Emits either `"json"` or `"parse_error"`.
   */
  function parseLine(line: Buffer): void {
    const text = line.toString("utf8");
    try {
      const obj = JSON.parse(text) as unknown;
      emitJson(obj);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : String(cause ?? "unknown");
      emitParseError({
        error: `syntax: ${message}`,
        raw_line: text.slice(0, RAW_LINE_LOG_CAP),
      });
    }
  }

  function write(chunk: Buffer): void {
    if (!Buffer.isBuffer(chunk)) {
      // Defensive: callers normally pass Buffers, but Readable streams
      // can occasionally yield strings depending on encoding settings.
      // Convert via Buffer.from rather than throwing.
      accumulator = Buffer.concat([accumulator, Buffer.from(String(chunk))]);
    } else {
      accumulator = Buffer.concat([accumulator, chunk]);
    }

    // Drain every complete line currently in the accumulator.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const newlineIdx = accumulator.indexOf(0x0a); // '\n'
      if (newlineIdx === -1) {
        // No complete line yet. Apply watchdog: if the accumulator has
        // grown past MAX_LINE_BYTES with no newline, drop it and start
        // discarding until the next newline arrives.
        if (accumulator.length > MAX_LINE_BYTES && !discardingUntilNewline) {
          emitParseError({ error: "line_too_long" });
          accumulator = Buffer.alloc(0);
          discardingUntilNewline = true;
        } else if (discardingUntilNewline && accumulator.length > 0) {
          // Already in discard mode — drop whatever pre-newline bytes we
          // have so memory stays bounded under sustained overflow.
          accumulator = Buffer.alloc(0);
        }
        break;
      }
      // We have a complete line. Slice off the prefix (excluding `\n`)
      // and shift the accumulator past the newline.
      const linePrefix = accumulator.subarray(0, newlineIdx);
      accumulator = accumulator.subarray(newlineIdx + 1);
      if (discardingUntilNewline) {
        // The prefix was the tail of an over-cap line. Drop it and
        // re-enter normal mode for the next line.
        discardingUntilNewline = false;
        continue;
      }
      // Empty lines (consecutive `\n`s) are ignored; per stream-json
      // semantics they have no JSON object.
      if (linePrefix.length === 0) {
        continue;
      }
      // Watchdog: a completed line that itself exceeds MAX_LINE_BYTES is
      // dropped rather than parsed. This handles the case where the
      // oversized line and its terminating newline arrive together in a
      // single write (e.g. a fixture file read into one big Buffer).
      if (linePrefix.length > MAX_LINE_BYTES) {
        emitParseError({ error: "line_too_long" });
        continue;
      }
      parseLine(linePrefix);
    }
  }

  function flush(): void {
    if (accumulator.length === 0) {
      return;
    }
    if (discardingUntilNewline) {
      // We are still discarding the tail of an over-cap line and the
      // child closed without producing the next newline. There is
      // nothing useful to surface to the caller — drop silently.
      accumulator = Buffer.alloc(0);
      return;
    }
    const text = accumulator.toString("utf8");
    accumulator = Buffer.alloc(0);
    try {
      const obj = JSON.parse(text) as unknown;
      emitJson(obj);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : String(cause ?? "unknown");
      emitParseError({
        error: `trailing_partial: ${message}`,
        raw_line: text.slice(0, RAW_LINE_LOG_CAP),
      });
    }
  }

  function on(event: "json", handler: (obj: unknown) => void): void;
  function on(event: "parse_error", handler: (err: ParseErrorPayload) => void): void;
  function on(
    event: "json" | "parse_error",
    handler: ((obj: unknown) => void) | ((err: ParseErrorPayload) => void),
  ): void {
    if (event === "json") {
      jsonHandlers.push(handler as (obj: unknown) => void);
    } else {
      parseErrorHandlers.push(handler as (err: ParseErrorPayload) => void);
    }
  }

  return { write, flush, on };
}
