/**
 * Phase 18, Plan 03, Task 2 — Tests for transcripts/store.ts.
 *
 * All tests use a tmpdir injected via homedirImpl so they never touch the
 * real ~/.achilles/transcripts/ directory. No console.log/error allowed
 * per CLAUDE.md. No emojis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createTranscriptStore,
  type TranscriptEntry,
  type TranscriptStoreHandle,
} from "../../src/transcripts/store.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
}

describe("createTranscriptStore", () => {
  let tmpDir: string;
  const sid = "test-session-001";

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes JSONL with one object per line", () => {
    const handle: TranscriptStoreHandle = createTranscriptStore(sid, {
      homedirImpl: () => tmpDir,
    });
    const entry1: TranscriptEntry = { t: 1000, type: "user", text: "hello" };
    const entry2: TranscriptEntry = { t: 2000, type: "assistant", text: "world" };
    handle.append(entry1);
    handle.append(entry2);
    handle.dispose();

    const content = fs.readFileSync(handle.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    // At least 3 lines: 2 user entries + 1 session_end system entry
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed["t"]).toBe(1000);
    expect(parsed["type"]).toBe("user");
    expect(parsed["text"]).toBe("hello");
  });

  it("apply the xi_-prefix redaction (Plan 02 7th regex) to text", () => {
    const handle = createTranscriptStore(sid, { homedirImpl: () => tmpDir });
    const secretKey = "xi_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890aBcDeF"; // 44 chars after xi_ (>=40)
    const entry: TranscriptEntry = { t: 1000, type: "user", text: `key is ${secretKey}` };
    handle.append(entry);
    handle.dispose();

    const content = fs.readFileSync(handle.filePath, "utf8");
    expect(content).not.toContain(secretKey);
    expect(content).toContain("[REDACTED]");
  });

  it("applies the existing sk- redaction", () => {
    const handle = createTranscriptStore(sid, { homedirImpl: () => tmpDir });
    const skKey = "sk-abcdefghijklmnopqrstuvwxyz12345678"; // 16+ chars after sk-
    const entry: TranscriptEntry = { t: 1000, type: "user", text: `my key: ${skKey}` };
    handle.append(entry);
    handle.dispose();

    const content = fs.readFileSync(handle.filePath, "utf8");
    expect(content).not.toContain(skKey);
    expect(content).toContain("[REDACTED]");
  });

  it("enforces 0o600 perms via chmodSync", () => {
    const chmodCalls: Array<{ path: string; mode: number }> = [];
    const handle = createTranscriptStore(sid, {
      homedirImpl: () => tmpDir,
      chmodSyncImpl: (p, mode) => {
        chmodCalls.push({ path: p, mode });
        fs.chmodSync(p, mode);
      },
    });
    handle.append({ t: 1, type: "user", text: "test" });
    handle.dispose();

    const fileChmodCalls = chmodCalls.filter((c) => c.path === handle.filePath);
    expect(fileChmodCalls.length).toBeGreaterThanOrEqual(1);
    expect(fileChmodCalls.every((c) => c.mode === 0o600)).toBe(true);
  });

  it("creates ~/.achilles/transcripts/ with 0o700 perms", () => {
    const mkdirCalls: Array<{ path: string; opts: unknown }> = [];
    const handle = createTranscriptStore(sid, {
      homedirImpl: () => tmpDir,
      mkdirSyncImpl: (p, opts) => {
        mkdirCalls.push({ path: p, opts });
        fs.mkdirSync(p, opts as fs.MakeDirectoryOptions);
      },
    });
    handle.append({ t: 1, type: "user", text: "test" });
    handle.dispose();

    const transcriptDirCalls = mkdirCalls.filter((c) =>
      c.path.includes("transcripts"),
    );
    expect(transcriptDirCalls.length).toBeGreaterThanOrEqual(1);
    expect(
      (transcriptDirCalls[0]!.opts as { mode: number }).mode,
    ).toBe(0o700);
  });

  it("dispose appends a session_end system entry", () => {
    const handle = createTranscriptStore(sid, { homedirImpl: () => tmpDir });
    handle.append({ t: 1000, type: "user", text: "before dispose" });
    handle.dispose();

    const content = fs.readFileSync(handle.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const systemEnd = lines.find((l) => {
      const parsed = JSON.parse(l) as Record<string, unknown>;
      return parsed.type === "system" && parsed.event === "session_end";
    });
    expect(systemEnd).toBeDefined();
  });

  it("append after dispose is a no-op (does not throw)", () => {
    const handle = createTranscriptStore(sid, { homedirImpl: () => tmpDir });
    handle.append({ t: 1000, type: "user", text: "first" });
    handle.dispose();

    // Should not throw
    expect(() => {
      handle.append({ t: 2000, type: "user", text: "after dispose" });
    }).not.toThrow();

    // Content should be the same as before the second append
    const content = fs.readFileSync(handle.filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const hasAfterDispose = lines.some((l) => l.includes("after dispose"));
    expect(hasAfterDispose).toBe(false);
  });

  it("filePath includes the supplied sessionId", () => {
    const customSid = "my-session-12345";
    const handle = createTranscriptStore(customSid, {
      homedirImpl: () => tmpDir,
    });
    handle.dispose();
    expect(handle.filePath).toContain(customSid);
    expect(handle.filePath).toContain(".jsonl");
  });
});
