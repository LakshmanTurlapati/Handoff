/**
 * Phase 17, Plan 01, Task 1 — Tests for the companion.md embedded-asset
 * loader + SHA-256 verifier.
 *
 * Three test cases:
 *
 *   1. resolveCompanionPromptPath returns an existing readable file
 *      whose content starts with markdown content (the source-of-truth
 *      file begins with an HTML comment marker; we accept any non-empty
 *      content here because the path is what we are validating).
 *   2. verifyCompanionSha256 returns ok:true against the resolved path
 *      (the embedded hash matches the file bytes at plan-execution time).
 *   3. verifyCompanionSha256 detects drift: a temp file written with
 *      arbitrary bytes produces ok:false and actual !== expected.
 *
 * Pure unit tests. No network, no clock, no spawn. Uses node:os.tmpdir
 * for hermetic test isolation in test 3.
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveCompanionPromptPath,
  verifyCompanionSha256,
  SOURCE_OF_TRUTH_HASH,
} from "../../src/audio/companion-md.js";

describe("companion-md — Phase 17 Plan 01 Task 1", () => {
  it("resolveCompanionPromptPath returns existing readable file", async () => {
    const path = resolveCompanionPromptPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
    // Absolute path on POSIX starts with "/"; on Windows starts with a
    // drive letter.
    expect(path).toMatch(/^(\/|[A-Za-z]:[\\/])/);
    const bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(0);
    const text = bytes.toString("utf8");
    // The source-of-truth file begins with an HTML comment (<!--) that
    // documents the contract references; we accept that prefix as the
    // canonical signature for "starts with markdown content".
    expect(text.startsWith("<!--")).toBe(true);
  });

  it("verifyCompanionSha256 returns ok:true against the embedded hash", async () => {
    const path = resolveCompanionPromptPath();
    const result = await verifyCompanionSha256(path);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(SOURCE_OF_TRUTH_HASH);
    expect(result.expected).toBe(SOURCE_OF_TRUTH_HASH);
  });

  it("verifyCompanionSha256 detects drift", async () => {
    const dir = await mkdtemp(join(tmpdir(), "achilles-companion-md-test-"));
    try {
      const driftPath = join(dir, "drifted-companion.md");
      await writeFile(driftPath, "drifted", "utf8");
      const result = await verifyCompanionSha256(driftPath);
      expect(result.ok).toBe(false);
      expect(result.actual).not.toBe(result.expected);
      expect(result.expected).toBe(SOURCE_OF_TRUTH_HASH);
      // The actual hash is a 64-char hex string.
      expect(result.actual).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
