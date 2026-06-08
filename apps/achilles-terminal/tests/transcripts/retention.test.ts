/**
 * Phase 18, Plan 03, Task 2 — Tests for transcripts/retention.ts.
 *
 * All tests inject homedirImpl so they never touch the real
 * ~/.achilles/transcripts/ directory. No emojis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanupOldTranscripts,
  DEFAULT_RETENTION_DAYS,
} from "../../src/transcripts/retention.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "retention-test-"));
}

function makeTranscriptsDir(homeDir: string): string {
  const dir = path.join(homeDir, ".achilles", "transcripts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
  fs.writeFileSync(filePath, content);
  const mtimeSec = mtimeMs / 1000;
  fs.utimesSync(filePath, mtimeSec, mtimeSec);
}

describe("cleanupOldTranscripts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("DEFAULT_RETENTION_DAYS is 30", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it("deletes files with mtime older than 30 days", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    const oldFileMs = Date.now() - (31 * 24 * 3600 * 1000); // 31 days ago
    const oldFile = path.join(transcriptsDir, "old.jsonl");
    writeFileWithMtime(oldFile, "old content", oldFileMs);

    const result = await cleanupOldTranscripts(30, { homedirImpl: () => tmpDir });
    expect(result.deletedCount).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
  });

  it("keeps files newer than 30 days", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    const recentFileMs = Date.now() - (29 * 24 * 3600 * 1000); // 29 days ago
    const recentFile = path.join(transcriptsDir, "recent.jsonl");
    writeFileWithMtime(recentFile, "recent content", recentFileMs);

    const result = await cleanupOldTranscripts(30, { homedirImpl: () => tmpDir });
    expect(result.keptCount).toBe(1);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  it("returns accurate deletedCount and keptCount", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    const oldMs = Date.now() - (40 * 24 * 3600 * 1000);
    const newMs = Date.now() - (5 * 24 * 3600 * 1000);

    writeFileWithMtime(path.join(transcriptsDir, "old1.jsonl"), "a", oldMs);
    writeFileWithMtime(path.join(transcriptsDir, "old2.jsonl"), "b", oldMs);
    writeFileWithMtime(path.join(transcriptsDir, "new1.jsonl"), "c", newMs);

    const result = await cleanupOldTranscripts(30, { homedirImpl: () => tmpDir });
    expect(result.deletedCount).toBe(2);
    expect(result.keptCount).toBe(1);
  });

  it("returns { deletedCount: 0, keptCount: 0 } when dir does not exist without throwing", async () => {
    // tmpDir exists but has no .achilles/transcripts subdirectory
    const result = await cleanupOldTranscripts(30, { homedirImpl: () => tmpDir });
    expect(result.deletedCount).toBe(0);
    expect(result.keptCount).toBe(0);
  });

  it("uses custom days threshold (7) when supplied", async () => {
    const transcriptsDir = makeTranscriptsDir(tmpDir);
    const eightDaysAgo = Date.now() - (8 * 24 * 3600 * 1000);
    const sixDaysAgo = Date.now() - (6 * 24 * 3600 * 1000);

    writeFileWithMtime(path.join(transcriptsDir, "old.jsonl"), "old", eightDaysAgo);
    writeFileWithMtime(path.join(transcriptsDir, "new.jsonl"), "new", sixDaysAgo);

    const result = await cleanupOldTranscripts(7, { homedirImpl: () => tmpDir });
    expect(result.deletedCount).toBe(1);
    expect(result.keptCount).toBe(1);
  });
});
