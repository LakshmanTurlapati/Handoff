/**
 * Tests for the LDJSON line parser (Plan 10-02, Task 1).
 *
 * Coverage map (9 behaviours from the plan's <behavior> block):
 *
 *   1. Single complete JSON line ending in \n yields one parsed object.
 *   2. Two JSON lines in one chunk yield two parsed objects in order.
 *   3. First half then second half (across two writes) yields one object
 *      after the newline arrives.
 *   4. Three writes where the middle write contains a complete object
 *      plus the start of the next yields the right sequence + ordering.
 *   5. Line longer than MAX_LINE_BYTES emits parse_error with reason
 *      "line_too_long" and discards the buffer to the next newline.
 *   6. Malformed JSON emits parse_error with raw_line truncated to 256
 *      chars; parser continues with the next line.
 *   7. flush() after a trailing partial emits parse_error rather than
 *      silently discarding.
 *   8. MockClaudeProcess.fromFixture("simple-turn.ndjson") replay yields
 *      the expected sequence of parsed object types.
 *   9. MockClaudeProcess with configurable chunkSizes splitting a JSON
 *      object mid-line still emits one complete object for that line.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";

import { createLineParser } from "./line-parser.js";
import { MAX_LINE_BYTES } from "./constants.js";
import { MockClaudeProcess } from "../test/mock-claude-process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../test/fixtures");
const OVERSIZED_FIXTURE_PATH = path.join(FIXTURES_DIR, "oversized-line.ndjson");

interface ParseErrorRecord {
  error: string;
  raw_line?: string;
}

function collectParser() {
  const parser = createLineParser();
  const objects: unknown[] = [];
  const errors: ParseErrorRecord[] = [];
  parser.on("json", (obj) => {
    objects.push(obj);
  });
  parser.on("parse_error", (err) => {
    errors.push(err);
  });
  return { parser, objects, errors };
}

describe("createLineParser", () => {
  it("behaviour 1: a single complete JSON line ending in \\n yields one parsed object", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"type":"a","n":1}\n', "utf8"));
    expect(objects).toEqual([{ type: "a", n: 1 }]);
    expect(errors).toEqual([]);
  });

  it("behaviour 2: two JSON lines in one chunk yield two parsed objects in order", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"k":1}\n{"k":2}\n', "utf8"));
    expect(objects).toEqual([{ k: 1 }, { k: 2 }]);
    expect(errors).toEqual([]);
  });

  it("behaviour 3: first-half then second-half across two writes yields one object after the newline arrives", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"k":"hel', "utf8"));
    expect(objects).toEqual([]);
    parser.write(Buffer.from('lo"}\n', "utf8"));
    expect(objects).toEqual([{ k: "hello" }]);
    expect(errors).toEqual([]);
  });

  it("behaviour 4: three writes where the middle contains a complete object plus the start of the next yields the right sequence", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"a":1', "utf8"));
    parser.write(Buffer.from('}\n{"b":2}\n{"c":', "utf8"));
    expect(objects).toEqual([{ a: 1 }, { b: 2 }]);
    parser.write(Buffer.from("3}\n", "utf8"));
    expect(objects).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(errors).toEqual([]);
  });

  it("behaviour 5: a line longer than MAX_LINE_BYTES emits parse_error with reason 'line_too_long' and discards the buffer up to the next newline", () => {
    const { parser, objects, errors } = collectParser();
    // Build an oversized line of length > MAX_LINE_BYTES (no newline inside).
    const oversizedLength = MAX_LINE_BYTES + 200;
    const oversized = Buffer.alloc(oversizedLength, 0x61); // ASCII 'a'
    // Stream it in by halves so the watchdog can trip mid-line.
    parser.write(oversized.subarray(0, Math.floor(oversizedLength / 2)));
    parser.write(oversized.subarray(Math.floor(oversizedLength / 2)));
    // No newline yet; the watchdog must have fired by now (the parser
    // tracks accumulator length on each write and emits parse_error once
    // the accumulator exceeds MAX_LINE_BYTES with no newline).
    expect(errors.length).toBe(1);
    expect(errors[0]?.error).toBe("line_too_long");
    // Now finish the discarded line and feed a valid follow-up.
    parser.write(Buffer.from('garbage-tail\n{"ok":true}\n', "utf8"));
    expect(objects).toEqual([{ ok: true }]);
    expect(errors.length).toBe(1); // no new errors
  });

  it("behaviour 6: malformed JSON emits parse_error with raw_line truncated to 256 chars and the parser continues", () => {
    const { parser, objects, errors } = collectParser();
    const longRawLine = "x".repeat(300);
    parser.write(Buffer.from(`${longRawLine}\n{"valid":1}\n`, "utf8"));
    expect(objects).toEqual([{ valid: 1 }]);
    expect(errors.length).toBe(1);
    expect(errors[0]?.error.startsWith("syntax:")).toBe(true);
    expect(errors[0]?.raw_line).toBeDefined();
    expect(errors[0]?.raw_line?.length).toBe(256);
    expect(errors[0]?.raw_line).toBe("x".repeat(256));
  });

  it("behaviour 7: flush() after a trailing partial line emits parse_error for that partial", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"complete":1}\n{"partial', "utf8"));
    expect(objects).toEqual([{ complete: 1 }]);
    expect(errors).toEqual([]);
    parser.flush();
    expect(errors.length).toBe(1);
    expect(errors[0]?.error.startsWith("trailing_partial:")).toBe(true);
    expect(errors[0]?.raw_line).toBe('{"partial');
  });

  it("behaviour 7b: flush() with a complete final line (no trailing newline) parses it successfully", () => {
    const { parser, objects, errors } = collectParser();
    parser.write(Buffer.from('{"complete":1}', "utf8"));
    expect(objects).toEqual([]);
    parser.flush();
    expect(objects).toEqual([{ complete: 1 }]);
    expect(errors).toEqual([]);
  });

  it("behaviour 8: MockClaudeProcess.fromFixture('simple-turn.ndjson').play(parser) yields the expected sequence of parsed object types", async () => {
    const { parser, objects, errors } = collectParser();
    const mock = MockClaudeProcess.fromFixture("simple-turn.ndjson");
    const result = await mock.play(parser);
    parser.flush();
    expect(errors).toEqual([]);
    expect(objects.length).toBe(4);
    expect((objects[0] as { type: string }).type).toBe("system");
    expect((objects[1] as { type: string }).type).toBe("assistant");
    expect((objects[2] as { type: string }).type).toBe("assistant");
    expect((objects[3] as { type: string }).type).toBe("result");
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBe(null);
  });

  it("behaviour 9: MockClaudeProcess with chunkSizes that split a JSON object mid-line still emits one complete object for that line", async () => {
    const { parser, objects, errors } = collectParser();
    const fixturePath = path.join(FIXTURES_DIR, "partial-json.ndjson");
    const buf = await fs.readFile(fixturePath);
    const splitAt = 60;
    const mock = new MockClaudeProcess({
      fixturePath,
      chunkSizes: [splitAt, buf.length - splitAt],
      exitCode: 0,
      signal: null,
    });
    await mock.play(parser);
    parser.flush();
    expect(errors).toEqual([]);
    expect(objects.length).toBe(2);
    expect((objects[0] as { type: string }).type).toBe("system");
    expect((objects[0] as { session_id: string }).session_id).toBe("sid-partial-001");
    expect((objects[1] as { type: string }).type).toBe("assistant");
  });

  describe("oversized-line.ndjson fixture", () => {
    beforeAll(async () => {
      await MockClaudeProcess.writeOversizedFixture(OVERSIZED_FIXTURE_PATH);
    });

    it("emits parse_error for line 1 (line_too_long) and parses line 2 cleanly", async () => {
      const { parser, objects, errors } = collectParser();
      const mock = new MockClaudeProcess({
        fixturePath: OVERSIZED_FIXTURE_PATH,
        exitCode: 0,
        signal: null,
      });
      await mock.play(parser);
      parser.flush();
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]?.error).toBe("line_too_long");
      expect(objects.length).toBe(1);
      expect((objects[0] as { type: string }).type).toBe("result");
    });
  });
});
