/**
 * MockClaudeProcess — test helper that plays a captured NDJSON fixture
 * as if it were the child's stdout (Plan 10-02, Task 1).
 *
 * This file lives in `test/` rather than `src/` because it is a test
 * fixture, not a runtime export. The package tsconfig already excludes
 * `test/**` from the build (Phase 09 CR-06), so this file never lands in
 * `dist/`.
 *
 * Two usage patterns:
 *
 *   1. Drive a {@link LineParser} directly (line-parser.test.ts):
 *
 *        const mock = MockClaudeProcess.fromFixture("simple-turn.ndjson");
 *        await mock.play(parser);
 *        parser.flush();
 *
 *      The helper reads the fixture from disk, optionally splits it into
 *      explicit byte-sized chunks per `chunkSizes`, and writes each chunk
 *      into the parser. Returns the configured `{ exitCode, signal }` so
 *      session-level tests can assert exit semantics without coupling
 *      this helper to {@link createClaudeSession}.
 *
 *   2. Drive the full session (session.test.ts):
 *
 *      For session-level fixture replay, tests inject a fake `spawnImpl`
 *      that returns a PassThrough-backed ChildProcess stub. The session
 *      tests then read the fixture and write into that stub's stdout
 *      directly; this helper is the source of the per-chunk byte split
 *      logic when a chunk-boundary scenario is required.
 *
 * Why a class rather than a function:
 *   The plan requires both per-instance configuration ({@link chunkSizes},
 *   {@link exitCode}, {@link signal}) and two static utility methods
 *   ({@link fromFixture} and {@link writeOversizedFixture}). The class
 *   surface mirrors what tests reach for: `new MockClaudeProcess({...})`
 *   for ad-hoc chunk-size scenarios; `MockClaudeProcess.fromFixture(name)`
 *   for the common single-write case.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

import { MAX_LINE_BYTES } from "../src/constants.js";
import type { LineParser } from "../src/line-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FIXTURES_DIR = path.resolve(__dirname, "fixtures");

export interface MockClaudeProcessOptions {
  /** Absolute path to the fixture file on disk. The constructor does not
   * read the file until {@link play} is called; this keeps the
   * constructor synchronous. */
  fixturePath: string;
  /** Optional list of byte counts to use for splitting the fixture into
   * discrete `write()` calls. The sum SHOULD equal the fixture size; if
   * the sum is short, the trailing bytes are written in one final chunk;
   * if it overshoots, the last chunk is truncated. Omit for "write the
   * whole fixture in one call". */
  chunkSizes?: number[];
  /** Exit code to return from {@link play}. Defaults to 0. Set to non-0
   * to simulate a child that crashed or was killed cleanly. */
  exitCode?: number | null;
  /** Signal to return from {@link play}. Defaults to null (clean exit).
   * Pass `"SIGTERM"` etc. to simulate a kill. */
  signal?: NodeJS.Signals | null;
}

export interface MockPlayResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class MockClaudeProcess {
  readonly fixturePath: string;
  readonly chunkSizes: number[] | undefined;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(opts: MockClaudeProcessOptions) {
    this.fixturePath = opts.fixturePath;
    this.chunkSizes = opts.chunkSizes;
    this.exitCode = opts.exitCode ?? 0;
    this.signal = opts.signal ?? null;
  }

  /**
   * Resolve a fixture by name (relative to `test/fixtures/`).
   * Convenience for the most common test pattern: single fixture, single
   * chunk, exit-0, no signal.
   */
  static fromFixture(name: string): MockClaudeProcess {
    return new MockClaudeProcess({
      fixturePath: path.join(DEFAULT_FIXTURES_DIR, name),
      exitCode: 0,
      signal: null,
    });
  }

  /**
   * Write the oversized-line fixture programmatically to disk. The
   * fixture is too large (>1 MiB) to commit, so it is generated on
   * demand by the test suite via `beforeAll`.
   *
   * Layout (2 lines):
   *
   *   line 1: `{"type":"system","subtype":"init",...,"padding":"<X>"}` where
   *           `<X>` is 1_048_700 bytes of `a` (exceeds MAX_LINE_BYTES of
   *           1_048_576).
   *   line 2: `{"type":"result","subtype":"success"}`
   *
   * The line-parser test verifies that line 1 emits parse_error
   * (`line_too_long`) and line 2 still parses cleanly.
   *
   * @param destPath absolute path to write the fixture to.
   */
  static async writeOversizedFixture(destPath: string): Promise<void> {
    const padLen = MAX_LINE_BYTES + 124; // 1_048_700, > MAX_LINE_BYTES
    const padding = "a".repeat(padLen);
    const line1 =
      `{"type":"system","subtype":"init","session_id":"sid-oversized-001",` +
      `"model":"claude-sonnet-4-5","claude_code_version":"2.0.5","padding":"${padding}"}`;
    const line2 = `{"type":"result","subtype":"success"}`;
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, `${line1}\n${line2}\n`, "utf8");
  }

  /**
   * Replay the fixture into a {@link LineParser}.
   *
   * If {@link chunkSizes} is set, each entry slices the fixture buffer at
   * the given byte boundary and writes that slice. Otherwise the whole
   * fixture is written as one chunk. Returns the configured exit code
   * and signal so callers can assert exit semantics in tests that wrap
   * this helper in a `createClaudeSession` stub.
   */
  async play(parser: LineParser): Promise<MockPlayResult> {
    const buf = await fs.readFile(this.fixturePath);
    if (this.chunkSizes === undefined) {
      parser.write(buf);
    } else {
      let offset = 0;
      for (const size of this.chunkSizes) {
        if (size <= 0) {
          continue;
        }
        const end = Math.min(offset + size, buf.length);
        if (offset >= buf.length) {
          break;
        }
        parser.write(buf.subarray(offset, end));
        offset = end;
      }
      if (offset < buf.length) {
        // Sum of chunkSizes was short of the fixture; write the
        // remainder as one final chunk so no bytes are dropped silently.
        parser.write(buf.subarray(offset));
      }
    }
    return { exitCode: this.exitCode, signal: this.signal };
  }

  /**
   * Read the full fixture into a Buffer without writing it anywhere.
   * Useful when a test needs to drive a session-level PassThrough stub
   * and wants the bytes pre-loaded.
   */
  async readFixture(): Promise<Buffer> {
    return fs.readFile(this.fixturePath);
  }
}
