/**
 * Tests for the tarball-no-secrets release-gate scanner.
 *
 * The scanner runs `npm pack`, extracts the tarball, walks the extracted
 * tree, and applies seven concrete regex patterns to the contents of
 * each scannable file. The test seam injects the scanner result directly
 * so the unit tests do not invoke `npm pack` — the real-mode invocation
 * is exercised only when the env var ACHILLES_CHECK_REAL=1 is set.
 *
 * Test categories:
 *   - TNS1: clean tarball passes (no leak detected)
 *   - TNS2: `sk_<29+>` leak detected; log truncated to first 8 chars
 *   - TNS3: README env-var NAME mentioned without value — allowlisted
 *   - TNS4: README env-var NAME + VALUE — flagged as leak
 *   - TNS5: defensive scan covers all seven patterns
 *   - TNS6: live source files (packages/achilles-skill/skill/SKILL.md +
 *     companion.md) are clean against the scanner (self-checking against
 *     the real source tree)
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runTarballSecretScan,
  KEY_PATTERNS,
} from "./check-tarball-no-secrets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

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

/**
 * Build a synthetic scanner that returns the provided file map:
 *   { 'package/README.md': 'contents', 'package/dist/cli.js': '...' }
 *
 * The runner walks the file map (sorted by key) and feeds each entry's
 * contents to the regex set.
 */
function buildScannerSeam(fileMap) {
  return {
    listFiles: async () => Object.keys(fileMap),
    readFile: async (relPath) => fileMap[relPath],
  };
}

test("TNS1: clean tarball passes — exits 0 and logs scan count", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const scanner = buildScannerSeam({
    "package/dist/cli.js": "import { fromXyz } from 'commander';",
    "package/dist/cli.d.ts": "export const x: number;",
    "package/README.md":
      "# achilles\n## Install\nnpm install -g achilles\n",
    "package/package.json":
      '{"name":"achilles","version":"0.1.0"}',
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [0]);
  const out = buf.text();
  assert.ok(
    out.includes("no secrets detected"),
    `expected clean-scan message in stdout, got: ${out}`,
  );
  // Should report a scan count >=  1.
  assert.match(
    out,
    /scanned \d+ matchable files/,
    `expected scan count line in stdout, got: ${out}`,
  );
});

test("TNS2: `sk_<29+>` leak detected — exits 1; log truncates to first 8 chars + does NOT include full match", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const leakyValue = "sk_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG";
  const scanner = buildScannerSeam({
    "package/dist/cli.js": `const k = "${leakyValue}";`,
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("SECRET LEAK DETECTED"),
    `expected SECRET LEAK DETECTED in stderr, got: ${err}`,
  );
  assert.ok(
    err.includes("package/dist/cli.js"),
    `expected file path in stderr, got: ${err}`,
  );
  // Defence in depth: the matched bytes must be truncated; the FULL match
  // value must not appear in any output.
  assert.ok(
    !err.includes(leakyValue),
    `stderr leaked the full match value (defence-in-depth violation)`,
  );
  // First 8 chars of the match should appear (the documented truncation).
  assert.ok(
    err.includes("sk_abcde"),
    `expected first-8-char truncation in stderr, got: ${err}`,
  );
});

test("TNS3: README env-var NAME mentioned WITHOUT a value — allowlisted; overall exit 0", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  // The README mentions the env-var NAME alone; no value pattern attached.
  const scanner = buildScannerSeam({
    "package/README.md":
      "Set the ELEVENLABS_API_KEY env var via achilles init or via your shell.\n",
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  // The bare NAME without `=value` should not match the elevenlabs-env-assignment
  // regex (which requires `{16,}` after `=`), so the overall result is success.
  assert.deepEqual(exits, [0]);
  const out = buf.text();
  assert.ok(
    out.includes("no secrets detected"),
    `expected clean scan message in stdout, got: ${out}`,
  );
});

test("TNS4: README env-var NAME with a VALUE assignment — flagged as leak", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const scanner = buildScannerSeam({
    "package/README.md":
      "Set ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx in env.\n",
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("SECRET LEAK DETECTED"),
    `expected SECRET LEAK DETECTED in stderr, got: ${err}`,
  );
});

test("TNS5: defensive scan covers all seven concrete patterns", async () => {
  // KEY_PATTERNS must export the seven named regex entries.
  const names = KEY_PATTERNS.map((p) => p.name);
  for (const expected of [
    "elevenlabs-sk_",
    "elevenlabs-xi-api-key",
    "elevenlabs-xi_api_key-assignment",
    "elevenlabs-env-assignment",
    // CR-03 fix: renamed from 'anthropic-sk-' (which produced false
    // positives on bare `sk-` prefixes) to 'anthropic-sk-ant' (anchored
    // on the real Anthropic key prefix).
    "anthropic-sk-ant",
    "github-pat",
    "github-fine-grained-pat",
  ]) {
    assert.ok(
      names.includes(expected),
      `expected KEY_PATTERNS to include name '${expected}', got names: ${names.join(",")}`,
    );
  }

  // Now exercise each pattern with a leaky string in its own synthetic file.
  const samples = {
    "elevenlabs-sk_":
      "sk_abcdefghijklmnopqrstuvwxyz123456789ABCDEF",
    "elevenlabs-xi-api-key":
      "xi-api-key: 0123456789abcdefghij",
    "elevenlabs-xi_api_key-assignment":
      "xi_api_key=0123456789abcdef",
    "elevenlabs-env-assignment":
      'ELEVENLABS_API_KEY="abcdefghijklmnop12345"',
    // CR-03 fix: the sample now uses the real Anthropic key shape
    // (sk-ant-... ≥37 chars total, well over the {30,} body requirement).
    "anthropic-sk-ant":
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789ABCDEF",
    "github-pat":
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    "github-fine-grained-pat":
      "github_pat_11ABCDEFG0_abcdefghijklmnopqrstuv",
  };

  for (const [patternName, leakSample] of Object.entries(samples)) {
    const buf = buildBuffer();
    const ebuf = buildBuffer();
    const exits = [];
    const scanner = buildScannerSeam({
      [`package/test-${patternName}.txt`]: leakSample,
    });

    await runTarballSecretScan({
      scanner,
      stdout: buf,
      stderr: ebuf,
      processExitImpl: (code) => exits.push(code),
    });

    assert.deepEqual(
      exits,
      [1],
      `pattern '${patternName}' did NOT exit 1 for sample '${leakSample.slice(0, 12)}...': stderr=${ebuf.text()} stdout=${buf.text()}`,
    );
    assert.ok(
      ebuf.text().includes(patternName),
      `expected pattern '${patternName}' name in stderr, got: ${ebuf.text()}`,
    );
  }
});

test("TNS6: live skill files (SKILL.md + companion.md) pass the scanner — self-checks against real source", async () => {
  // Read the actual on-disk contents and pass them through the scanner.
  const companionPath = resolve(
    REPO_ROOT,
    "packages/achilles-skill/skill/prompts/companion.md",
  );
  const skillMdPath = resolve(
    REPO_ROOT,
    "packages/achilles-skill/skill/SKILL.md",
  );
  const companion = await readFile(companionPath, "utf8");
  const skillMd = await readFile(skillMdPath, "utf8");
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];

  const scanner = buildScannerSeam({
    "package/skill/prompts/companion.md": companion,
    "package/skill/SKILL.md": skillMd,
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  assert.deepEqual(
    exits,
    [0],
    `live skill files unexpectedly flagged; stderr=${ebuf.text()}`,
  );
});

test("TNS9: CR-04 — directory creation uses node:fs mkdirSync recursive, NOT execFileSync('mkdir', ['-p', ...])", async () => {
  // The script's real-mode tarball pipeline creates the extract dir
  // before running `tar -xzf`. Under the original implementation this
  // shelled out to POSIX `mkdir -p`, which fails on Windows (cmd.exe's
  // built-in mkdir does not accept the -p flag). The CR-04 fix replaces
  // the shell-out with `mkdirSync(path, { recursive: true })`.
  const raw = await readFile(
    resolve(HERE, "check-tarball-no-secrets.mjs"),
    "utf8",
  );
  // Strip block comments and line comments before pattern-matching so
  // the assertions are not fooled by the CR-04-fix block comment that
  // (deliberately) mentions the bad pattern as the thing being replaced.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(
    /mkdirSync/.test(src) && /from "node:fs"/.test(src),
    "expected check-tarball-no-secrets.mjs to import mkdirSync from node:fs",
  );
  assert.ok(
    !/execFileSync\(\s*["']mkdir["']/.test(src),
    "expected check-tarball-no-secrets.mjs to NOT call execFileSync('mkdir', ...) — Windows portability regression",
  );
  assert.ok(
    /mkdirSync\([^)]*recursive:\s*true/.test(src),
    "expected mkdirSync call with { recursive: true }",
  );
});

test("TNS8: CR-03 — anthropic-sk-ant pattern rejects bare sk- kebab-case strings and accepts the real sk-ant- prefix", async () => {
  // Locate the anthropic regex by pattern name.
  const anthropic = KEY_PATTERNS.find((p) => p.name === "anthropic-sk-ant");
  assert.ok(
    anthropic !== undefined,
    `expected KEY_PATTERNS to include 'anthropic-sk-ant'; got names: ${KEY_PATTERNS.map((p) => p.name).join(",")}`,
  );

  // Negative samples — bare kebab-case strings that begin with `sk-`
  // but are NOT Anthropic keys. The previous bare-`sk-` pattern would
  // have flagged each of these as a SECRET LEAK DETECTED, blocking
  // legitimate publishes with a false positive.
  const negativeSamples = [
    "sk-foo-bar-baz",
    "sk-overlay-component-positioning-fixed",
    "sk-ipped-because-this-is-just-a-test",
    "sk-button-primary-disabled-hover",
    // 'sk-' followed by a long kebab-case run that would have matched
    // the old {29,} body length is also rejected by the new pattern.
    "sk-some-very-long-class-name-here-1234567890",
  ];
  for (const sample of negativeSamples) {
    anthropic.regex.lastIndex = 0;
    const matched = sample.match(anthropic.regex);
    assert.equal(
      matched,
      null,
      `expected '${sample}' NOT to match anthropic-sk-ant pattern, but got: ${matched?.join(",") ?? "null"}`,
    );
  }

  // Positive samples — real Anthropic key shapes (`sk-ant-...`) MUST
  // match. The body length is anchored at {30,} so the test values are
  // each 30+ chars after the `sk-ant-` prefix.
  const positiveSamples = [
    "sk-ant-1234567890abcdefghij1234567890ab",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789ABCDEF",
  ];
  for (const sample of positiveSamples) {
    anthropic.regex.lastIndex = 0;
    const matched = sample.match(anthropic.regex);
    assert.ok(
      Array.isArray(matched) && matched.length > 0,
      `expected '${sample}' to match anthropic-sk-ant pattern, but got null`,
    );
  }

  // Defence-in-depth: also exercise the full scanner with a
  // mixed-content file containing both a false positive and a real
  // key. The runner must flag the real key and ignore the kebab-case
  // identifier.
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const scanner = buildScannerSeam({
    "package/styles.css":
      ".sk-overlay-component-positioning-fixed { display: none; }\n",
    "package/dist/leak.js":
      'const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567";\n',
  });
  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });
  assert.deepEqual(exits, [1]);
  const err = ebuf.text();
  assert.ok(
    err.includes("anthropic-sk-ant"),
    `expected 'anthropic-sk-ant' pattern-name in stderr, got: ${err}`,
  );
  assert.ok(
    err.includes("package/dist/leak.js"),
    `expected the leak file path in stderr, got: ${err}`,
  );
  assert.ok(
    !err.includes("package/styles.css"),
    `expected the kebab-case CSS file to NOT trigger a false positive, got: ${err}`,
  );
});

test("TNS7: no emoji codepoints appear in any stdout/stderr write across TNS1-TNS5 simulations", async () => {
  const buf = buildBuffer();
  const ebuf = buildBuffer();
  const exits = [];
  const scanner = buildScannerSeam({
    "package/README.md": "Clean README content.\n",
  });

  await runTarballSecretScan({
    scanner,
    stdout: buf,
    stderr: ebuf,
    processExitImpl: (code) => exits.push(code),
  });

  const combined = buf.text() + ebuf.text();
  for (const ch of combined) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in logs (CLAUDE.md violation)`,
    );
  }
  assert.deepEqual(exits, [0]);
});
