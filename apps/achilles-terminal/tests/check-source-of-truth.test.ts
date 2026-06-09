/**
 * Wider-arm vitest test for the Phase 17 source-of-truth gate script.
 *
 * Phase 19 Plan 03 Task 1 -- this test verifies the Phase 17
 * check-source-of-truth.mjs script behaves correctly against the new
 * post-Plan 01 publish layout (DIST-03):
 *
 *   1. Happy path: against the current monorepo state (companion.md
 *      byte-for-byte locked + the embedded SOURCE_OF_TRUTH_HASH const in
 *      apps/achilles-terminal/src/audio/companion-md.ts matches) the
 *      script must exit 0.
 *
 *   2. Drift path: against a synthesized fixture where the source
 *      companion.md differs from the embedded hash, the script must exit
 *      non-zero with a clear stderr line that contains "SHA-256 drift".
 *
 * The wider-arm distinction (vs the Phase 17 single-arm form) is the
 * second assertion's coverage: Phase 17 verified only the happy path;
 * Phase 19 extends with an explicit drift case so the prepublishOnly hook
 * gates publishes that would ship a stale SOURCE_OF_TRUTH_HASH const.
 *
 * Per RESEARCH Pitfall 3: the bundled-tarball arm is INTENTIONALLY not
 * extracted by this test. The achilles-skill package is now a real public
 * dependency (Plan 19-01 flipped private:false + bumped to 1.3.0), so
 * the in-tarball copy resolves from npm at install time and the v1.2
 * second-arm extraction is dissolved. The Phase 17 single-arm form is
 * sufficient for the publish gate; this test confirms it.
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// tests/ lives at apps/achilles-terminal/tests/; the repo root is two
// directories up.
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SCRIPT_PATH = resolve(
  REPO_ROOT,
  "apps/achilles-terminal/scripts/check-source-of-truth.mjs",
);

describe("check-source-of-truth.mjs wider-arm", () => {
  test("exits 0 against the current monorepo (post-Plan 01 layout)", () => {
    // The script reads companion.md from LOOP-02 path and compares the
    // SHA-256 against the embedded SOURCE_OF_TRUTH_HASH const in
    // apps/achilles-terminal/src/audio/companion-md.ts. Phase 17 wired
    // both halves; Plan 19-01 left both byte-for-byte unchanged
    // (LOOP-02 invariant -- companion.md hash 7d53d7e6d0644e08a86c6fd8234bd6a4f067ac69).
    const result = spawnSync("node", [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/source-of-truth.*SHA-256 match/);
    expect(result.stderr).toBe("");
  });

  test("exits non-zero when companion.md source drifts from the embedded hash", () => {
    // Build an isolated fixture monorepo with a perturbed companion.md
    // so the source SHA-256 no longer matches the embedded hash. The
    // script must detect drift and exit non-zero with a "drift" log line.
    const sandbox = mkdtempSync(join(tmpdir(), "achilles-sot-drift-"));
    try {
      // Mirror the directory shape the script walks: it computes
      // REPO_ROOT three levels up from its own directory, then resolves
      // packages/achilles-skill/skill/prompts/companion.md AND
      // apps/achilles-terminal/src/audio/companion-md.ts from there. We
      // re-create both files in the sandbox so the script's path
      // resolution lands inside the sandbox.
      const sandboxScriptDir = join(
        sandbox,
        "apps/achilles-terminal/scripts",
      );
      const sandboxCompanionPath = join(
        sandbox,
        "packages/achilles-skill/skill/prompts/companion.md",
      );
      const sandboxCompanionMdTsPath = join(
        sandbox,
        "apps/achilles-terminal/src/audio/companion-md.ts",
      );
      mkdirSync(sandboxScriptDir, { recursive: true });
      mkdirSync(dirname(sandboxCompanionPath), { recursive: true });
      mkdirSync(dirname(sandboxCompanionMdTsPath), { recursive: true });
      // Copy the real script into the sandbox at the same relative path
      // so its `resolve(HERE, "..", "..", "..")` walks to the sandbox
      // root.
      cpSync(SCRIPT_PATH, join(sandboxScriptDir, "check-source-of-truth.mjs"), {
        recursive: false,
      });
      // Write a synthesized companion.md whose SHA-256 will NOT match the
      // embedded constant.
      writeFileSync(
        sandboxCompanionPath,
        "Drifted companion content -- this byte sequence is intentionally not the locked file.\n",
        "utf8",
      );
      // Write a companion-md.ts that contains a SOURCE_OF_TRUTH_HASH
      // const for a totally different file (real companion.md hash is
      // not used here -- we use an arbitrary 64-char hex string).
      writeFileSync(
        sandboxCompanionMdTsPath,
        [
          "// Sandboxed companion-md.ts for drift test.",
          "export const SOURCE_OF_TRUTH_HASH =",
          '  "0000000000000000000000000000000000000000000000000000000000000000";',
          "",
        ].join("\n"),
        "utf8",
      );

      const sandboxScript = join(
        sandboxScriptDir,
        "check-source-of-truth.mjs",
      );
      expect(existsSync(sandboxScript)).toBe(true);

      const result = spawnSync("node", [sandboxScript], {
        cwd: sandbox,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/companion\.md SHA-256 drift/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("exits non-zero when companion.md source is missing entirely", () => {
    // The script's first I/O step is readFile on the source-of-truth
    // path. If the file is missing, the script must exit non-zero with a
    // "source missing" stderr line.
    const sandbox = mkdtempSync(join(tmpdir(), "achilles-sot-missing-"));
    try {
      const sandboxScriptDir = join(
        sandbox,
        "apps/achilles-terminal/scripts",
      );
      const sandboxCompanionMdTsPath = join(
        sandbox,
        "apps/achilles-terminal/src/audio/companion-md.ts",
      );
      mkdirSync(sandboxScriptDir, { recursive: true });
      mkdirSync(dirname(sandboxCompanionMdTsPath), { recursive: true });
      cpSync(SCRIPT_PATH, join(sandboxScriptDir, "check-source-of-truth.mjs"), {
        recursive: false,
      });
      // Embedded hash exists; companion.md does NOT.
      writeFileSync(
        sandboxCompanionMdTsPath,
        [
          "export const SOURCE_OF_TRUTH_HASH =",
          '  "1111111111111111111111111111111111111111111111111111111111111111";',
          "",
        ].join("\n"),
        "utf8",
      );

      const sandboxScript = join(
        sandboxScriptDir,
        "check-source-of-truth.mjs",
      );
      const result = spawnSync("node", [sandboxScript], {
        cwd: sandbox,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/source missing expected file/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
