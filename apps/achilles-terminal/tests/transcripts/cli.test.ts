/**
 * Phase 18, Plan 03, Task 2 — Tests for transcripts/cli.ts.
 *
 * All tests inject homedirImpl so they never touch the real
 * ~/.achilles/transcripts/ directory. The @clack/prompts select() call is
 * also injected so tests never interact with stdin. No emojis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  transcriptsList,
  transcriptsPurge,
  type TranscriptsCliDeps,
} from "../../src/transcripts/cli.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
}

function makeTranscriptsDir(homeDir: string): string {
  const dir = path.join(homeDir, ".achilles", "transcripts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonlFile(dir: string, name: string, entries: object[]): string {
  const filePath = path.join(dir, name);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(filePath, lines + "\n");
  return filePath;
}

describe("transcriptsList", () => {
  let tmpDir: string;
  let output: string;
  const writeLine = (line: string): void => {
    output += line + "\n";
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
    output = "";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints 'No transcripts on disk.' when dir absent", async () => {
    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
    };
    await transcriptsList(deps);
    expect(output).toContain("No transcripts on disk.");
  });

  it("prints filename + first-user-line preview per file", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    writeJsonlFile(transcriptsDir, "sess-001.jsonl", [
      { t: 1000, type: "system", event: "session_start" },
      { t: 2000, type: "user", text: "Hello from session 001" },
      { t: 3000, type: "assistant", text: "Hi there" },
    ]);

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
    };
    await transcriptsList(deps);
    expect(output).toContain("sess-001.jsonl");
    expect(output).toContain("Hello from session 001");
  });

  it("truncates user text to 80 chars", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    const longText = "A".repeat(120);
    writeJsonlFile(transcriptsDir, "long.jsonl", [
      { t: 1000, type: "user", text: longText },
    ]);

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
    };
    await transcriptsList(deps);
    // Should not contain the full 120-char text
    expect(output).not.toContain(longText);
    // Should contain the first 80 chars
    expect(output).toContain("A".repeat(80));
  });
});

describe("transcriptsPurge", () => {
  let tmpDir: string;
  let output: string;
  const writeLine = (line: string): void => {
    output += line + "\n";
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
    output = "";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with select returning 'all' deletes every .jsonl", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    writeJsonlFile(transcriptsDir, "sess-a.jsonl", [
      { t: 1, type: "user", text: "a" },
    ]);
    writeJsonlFile(transcriptsDir, "sess-b.jsonl", [
      { t: 2, type: "user", text: "b" },
    ]);

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
      selectImpl: () => Promise.resolve("all" as string | symbol),
    };
    await transcriptsPurge(deps);

    expect(fs.existsSync(path.join(transcriptsDir, "sess-a.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(transcriptsDir, "sess-b.jsonl"))).toBe(false);
  });

  it("with select returning '30d' calls cleanupOldTranscripts(30)", async () => {
    makeTranscriptsDir(tmpDir);
    let cleanupDays: number | undefined;

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
      selectImpl: () => Promise.resolve("30d" as string | symbol),
      cleanupImpl: (days) => {
        cleanupDays = days;
        return Promise.resolve({ deletedCount: 0, keptCount: 0 });
      },
    };
    await transcriptsPurge(deps);
    expect(cleanupDays).toBe(30);
  });

  it("with select returning 'cancel' is a no-op", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    writeJsonlFile(transcriptsDir, "sess-c.jsonl", [
      { t: 1, type: "user", text: "c" },
    ]);

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
      selectImpl: () => Promise.resolve("cancel" as string | symbol),
    };
    await transcriptsPurge(deps);

    expect(fs.existsSync(path.join(transcriptsDir, "sess-c.jsonl"))).toBe(true);
    expect(output).toContain("Cancelled.");
  });

  it("with isCancel(selection) is a no-op", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    writeJsonlFile(transcriptsDir, "sess-d.jsonl", [
      { t: 1, type: "user", text: "d" },
    ]);

    // The cancel symbol from @clack/prompts is any value for which isCancel() returns true
    const cancelSymbol = Symbol("cancel");

    const deps: TranscriptsCliDeps = {
      homedirImpl: () => tmpDir,
      writeLineImpl: writeLine,
      selectImpl: () => Promise.resolve(cancelSymbol as unknown as string),
      isCancelImpl: (v: unknown) => v === cancelSymbol,
    };
    await transcriptsPurge(deps);

    expect(fs.existsSync(path.join(transcriptsDir, "sess-d.jsonl"))).toBe(true);
    expect(output).toContain("Cancelled.");
  });
});
