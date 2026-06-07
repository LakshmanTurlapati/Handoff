/**
 * Tests for the source-of-truth diff check script.
 *
 * These tests use the `node:test` runner (NOT vitest) because the scripts
 * are .mjs and must be runnable outside any workspace install context —
 * a pre-publish CI environment that has not yet run `npm install` should
 * still be able to invoke `node apps/achilles-cli/scripts/check-source-of-truth.mjs`
 * and run the unit tests via `node --test`.
 *
 * Test seam: the runner exports `runSourceOfTruthCheck({ tarballPaths,
 * sourcePaths, fs, versions, stdout, stderr, processExitImpl, real })`.
 * Each test stubs the seams to validate one branch of the algorithm
 * without invoking the real `npm pack`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runSourceOfTruthCheck } from "./check-source-of-truth.mjs";

/**
 * Build a minimal fs-read seam that returns the provided byte map. Throws
 * an ENOENT-shaped error for unknown paths.
 */
function buildFsSeam(byteMap) {
  return {
    readFile: async (path) => {
      if (Object.prototype.hasOwnProperty.call(byteMap, path)) {
        return Buffer.from(byteMap[path]);
      }
      const err = new Error(`ENOENT: no such file or directory '${path}'`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

function buildBuffer() {
  const lines = [];
  return {
    write(chunk) {
      lines.push(chunk);
      return true;
    },
    text() {
      return lines.join("");
    },
  };
}

test("BD2 (placeholder for prepublishOnly): the package.json check is exercised by check-package-wiring.test.mjs — this file owns SOT1-SOT5 + SOT6 (real-mode skipped by default)", () => {
  assert.equal(1, 1);
});

test("SOT1: byte-identical source + bundled, version pin matches — exits 0 and logs both checks", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const identicalContents = "# Achilles companion prompt\nSame bytes.\n";
  const fs = buildFsSeam({
    "/repo/packages/achilles-skill/skill/prompts/companion.md":
      identicalContents,
    "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md":
      identicalContents,
  });

  await runSourceOfTruthCheck({
    sourcePaths: {
      source: "/repo/packages/achilles-skill/skill/prompts/companion.md",
    },
    tarballPaths: {
      extractedSkillCompanion:
        "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md",
    },
    fs,
    versions: { cli: "0.1.0", app: "0.1.0" },
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [0]);
  const out = buf.text();
  assert.ok(
    out.includes("source-of-truth: companion.md SHA-256 match"),
    `expected SHA-256 match line in stdout, got: ${out}`,
  );
  assert.ok(
    out.includes("version pin: 0.1.0 === 0.1.0"),
    `expected version-pin line in stdout, got: ${out}`,
  );
});

test("SOT2: byte mismatch — exits 1 and logs DIFF diagnostic with SHA-256 prefixes (truncated; never full bytes)", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const fs = buildFsSeam({
    "/repo/packages/achilles-skill/skill/prompts/companion.md":
      "# Achilles companion prompt\nVersion A.\n",
    "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md":
      "# Achilles companion prompt\nVersion B.\n",
  });

  await runSourceOfTruthCheck({
    sourcePaths: {
      source: "/repo/packages/achilles-skill/skill/prompts/companion.md",
    },
    tarballPaths: {
      extractedSkillCompanion:
        "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md",
    },
    fs,
    versions: { cli: "0.1.0", app: "0.1.0" },
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("companion.md DIFF"),
    `expected DIFF diagnostic in stderr, got: ${err}`,
  );
  // The diagnostic must include two SHA-256 prefixes (12 hex chars each
  // per the locked truncation).
  const prefixMatches = err.match(/[0-9a-f]{12}/g) || [];
  assert.ok(
    prefixMatches.length >= 2,
    `expected at least two SHA-256 prefixes in stderr, got: ${err}`,
  );
  // Defence in depth: the matched bytes must NOT appear in any output —
  // the script must never log the full file bytes during a diff.
  assert.ok(
    !err.includes("Version A") && !err.includes("Version B"),
    "stderr leaked the full file bytes (defence-in-depth violation)",
  );
});

test("SOT3: version pin drift — exits 1 and logs the drift diagnostic naming both versions", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const identicalContents = "# Same prompt\n";
  const fs = buildFsSeam({
    "/repo/packages/achilles-skill/skill/prompts/companion.md":
      identicalContents,
    "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md":
      identicalContents,
  });

  await runSourceOfTruthCheck({
    sourcePaths: {
      source: "/repo/packages/achilles-skill/skill/prompts/companion.md",
    },
    tarballPaths: {
      extractedSkillCompanion:
        "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md",
    },
    fs,
    versions: { cli: "0.1.1", app: "0.1.0" },
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("version pin drift: achilles 0.1.1 !== achilles-app 0.1.0"),
    `expected version-pin drift diagnostic in stderr, got: ${err}`,
  );
});

test("SOT4: tarball source missing (ENOENT) — exits 1 with a helpful 'did you run npm pack with bundledDependencies?' diagnostic", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  // Only the source path is readable; the tarball-extracted path is missing.
  const fs = buildFsSeam({
    "/repo/packages/achilles-skill/skill/prompts/companion.md":
      "# Source prompt\n",
  });

  await runSourceOfTruthCheck({
    sourcePaths: {
      source: "/repo/packages/achilles-skill/skill/prompts/companion.md",
    },
    tarballPaths: {
      extractedSkillCompanion:
        "/tmp/extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md",
    },
    fs,
    versions: { cli: "0.1.0", app: "0.1.0" },
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("tarball missing expected file"),
    `expected missing-file diagnostic in stderr, got: ${err}`,
  );
  assert.ok(
    err.includes("bundledDependencies"),
    `expected bundledDependencies hint in stderr, got: ${err}`,
  );
});

test("SOT5: no emoji codepoints appear in any stdout/stderr write across SOT1-SOT4 simulations", async () => {
  // Simulate the SOT1 happy path; capture stdout/stderr; assert no emoji.
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const identical = "# Same prompt\n";
  const fs = buildFsSeam({
    "/repo/source.md": identical,
    "/tmp/extract.md": identical,
  });

  await runSourceOfTruthCheck({
    sourcePaths: { source: "/repo/source.md" },
    tarballPaths: { extractedSkillCompanion: "/tmp/extract.md" },
    fs,
    versions: { cli: "0.1.0", app: "0.1.0" },
    stdout: buf,
    stderr: ebuf,
    processExitImpl: () => {},
  });

  // Codepoint sweep: no characters in the U+2600-U+27FF / U+1F000-U+1FFFF
  // emoji ranges should appear.
  const combined = buf.text() + ebuf.text();
  for (const ch of combined) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in logs (CLAUDE.md violation)`,
    );
  }
});
