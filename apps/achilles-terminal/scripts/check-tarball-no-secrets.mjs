#!/usr/bin/env node
/**
 * Tarball secret-scan release gate for the achilles npm CLI.
 *
 * Closes Pitfall #22 + SAFE-01: the published tarball must NEVER contain
 * an ElevenLabs API key (or any other detected secret prefix). The check
 * runs at `npm publish` time via the prepublishOnly script in
 * apps/achilles-terminal/package.json and aborts the publish on any leak.
 *
 * Phase 19 Plan 03 Task 1 port from the v1.2 canonical script under the
 * apps achilles-cli scripts directory. The ONLY content change is the
 * cliDir computation which now points at apps achilles-terminal instead
 * of the v1.2 location (REPO_ROOT depth is identical: three levels up
 * from scripts/). All seven KEY_PATTERNS regex entries, the
 * SCANNABLE_EXTENSIONS set, walkFiles + truncateMatch helpers,
 * defaultScannerSeam, runTarballSecretScan, and the invocation-guard
 * IIFE ship verbatim from v1.2.
 *
 * Seven concrete regex patterns (KEY_PATTERNS below):
 *   - elevenlabs-sk_                  `sk_[A-Za-z0-9_-]{29,}`
 *   - elevenlabs-xi-api-key           `xi-api-key:\s*[A-Za-z0-9_-]+`
 *   - elevenlabs-xi_api_key-assignment `xi_api_key\s*=\s*[A-Za-z0-9_-]+`
 *   - elevenlabs-env-assignment       `ELEVENLABS_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{16,}["']?`
 *   - anthropic-sk-ant                 `sk-ant-[A-Za-z0-9_-]{30,}` (CR-03 -- see note below)
 *   - github-pat                      `ghp_[A-Za-z0-9_-]{36,}`
 *   - github-fine-grained-pat         `github_pat_[A-Za-z0-9_]+`
 *
 * CR-03 note: the anthropic-sk pattern is anchored on the literal
 * `sk-ant-` prefix (the real Anthropic key shape `sk-ant-api03-...`)
 * rather than the bare `sk-` prefix. The previous `/sk-[A-Za-z0-9_-]{29,}/`
 * pattern produced false positives on any kebab-case identifier starting
 * with `sk-` and running for 29+ chars (CSS class names, component
 * identifiers, design-system tokens), which would have blocked
 * legitimate publishes with a misleading SECRET LEAK DETECTED message.
 *
 * Allowlist policy: the bare env-var NAME `ELEVENLABS_API_KEY` is allowed
 * in README documentation (the README mentions it as the var to set in
 * your shell). The allowlist is IMPLICIT in the regex -- the
 * elevenlabs-env-assignment regex requires `{16,}` characters after the
 * `=`, so the bare NAME on its own does not match. Any assignment with a
 * concrete value pattern is flagged.
 *
 * Logging contract (CLAUDE.md global: NO emojis; defence in depth):
 *   - Successful scan: stdout `[achilles] tarball scan: no secrets detected (scanned N matchable files)`.
 *   - Leak: stderr `[achilles] SECRET LEAK DETECTED: <pattern-name> matched in <file>: <first-8-chars>...`.
 *     The FULL matched substring is NEVER logged.
 *
 * No external dependencies. Node 22 stdlib only.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join, relative, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/**
 * The seven concrete regex patterns. The `name` field is used in logs
 * (and in the unit test that enumerates KEY_PATTERNS). The `regex` field
 * is a RegExp instance.
 *
 * @public
 */
export const KEY_PATTERNS = Object.freeze([
  {
    name: "elevenlabs-sk_",
    regex: /sk_[A-Za-z0-9_-]{29,}/g,
  },
  {
    name: "elevenlabs-xi-api-key",
    regex: /xi-api-key:\s*[A-Za-z0-9_-]+/g,
  },
  {
    name: "elevenlabs-xi_api_key-assignment",
    regex: /xi_api_key\s*=\s*[A-Za-z0-9_-]+/g,
  },
  {
    // Allowlist is implicit: requires {16,} after `=`, so the bare NAME
    // mentioned in prose does NOT match.
    name: "elevenlabs-env-assignment",
    regex: /ELEVENLABS_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{16,}["']?/g,
  },
  {
    // CR-03 fix: tightened from `/sk-[A-Za-z0-9_-]{29,}/` to the actual
    // Anthropic key prefix `sk-ant-`. The previous bare-`sk-` pattern
    // matched any kebab-case identifier of 32+ chars (e.g. CSS class
    // names like `sk-overlay-component-positioning-fixed`), producing
    // false positives that blocked legitimate publishes with a
    // misleading SECRET LEAK DETECTED diagnostic.
    name: "anthropic-sk-ant",
    regex: /sk-ant-[A-Za-z0-9_-]{30,}/g,
  },
  {
    name: "github-pat",
    regex: /ghp_[A-Za-z0-9_-]{36,}/g,
  },
  {
    name: "github-fine-grained-pat",
    regex: /github_pat_[A-Za-z0-9_]+/g,
  },
]);

const SCANNABLE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".ts",
  ".tsx",
]);

/**
 * Truncate a matched substring for safe logging. Returns the first 8
 * characters followed by the literal `...`. Defence-in-depth: the FULL
 * match never appears in any log line.
 */
function truncateMatch(s) {
  if (s.length <= 8) return `${s}...`;
  return `${s.slice(0, 8)}...`;
}

/**
 * Walk a directory recursively, returning a list of relative paths
 * (relative to `rootDir`) for every file (not directory) found. Sorted
 * for deterministic test output.
 */
function walkFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(relative(rootDir, abs));
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Build a production scanner that runs `npm pack`, extracts the result,
 * and walks the extracted tree.
 *
 * Phase 19 Plan 03 Task 1 port: cliDir now resolves to apps/achilles-terminal
 * (was the v1.2 cli dir). Everything else identical.
 */
function defaultScannerSeam() {
  const cliDir = resolve(REPO_ROOT, "apps/achilles-terminal");
  const tmp = mkdtempSync(join(tmpdir(), "achilles-tns-"));
  let extractRoot;
  try {
    const stdout = execFileSync(
      "npm",
      ["pack", "--pack-destination", tmp, "--json"],
      {
        cwd: cliDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error(
        `npm pack returned unexpected JSON: ${stdout.slice(0, 200)}`,
      );
    }
    const tarballName = result[0].filename;
    if (!tarballName) {
      throw new Error(
        `npm pack JSON missing filename field: ${stdout.slice(0, 200)}`,
      );
    }
    const tarballPath = join(tmp, tarballName);
    extractRoot = join(tmp, "extract");
    // CR-04 fix: use the Node stdlib instead of shelling out to POSIX
    // `mkdir -p`. The previous `execFileSync('mkdir', ['-p', ...])`
    // would fail on Windows (`mkdir` is a cmd.exe built-in that does not
    // accept the `-p` flag), aborting prepublishOnly with a misleading
    // ENOENT / spawn error if the operator publishes from a Windows
    // host.
    mkdirSync(extractRoot, { recursive: true });
    execFileSync("tar", ["-xzf", tarballPath, "-C", extractRoot], {
      stdio: "ignore",
    });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return {
    tmpdir: tmp,
    scanner: {
      listFiles: async () => walkFiles(extractRoot),
      readFile: async (relPath) =>
        readFileSync(join(extractRoot, relPath), "utf8"),
    },
  };
}

/**
 * Determine whether a path should be scanned by extension.
 */
function shouldScan(relPath) {
  const ext = extname(relPath).toLowerCase();
  return SCANNABLE_EXTENSIONS.has(ext);
}

/**
 * Run the tarball secret scan.
 *
 * @param {object} deps
 * @param {{ listFiles: () => Promise<string[]>, readFile: (p: string) => Promise<string> }} deps.scanner
 * @param {{ write: (s: string) => boolean }} deps.stdout
 * @param {{ write: (s: string) => boolean }} deps.stderr
 * @param {(code: number) => void} deps.processExitImpl
 */
export async function runTarballSecretScan(deps) {
  const { scanner, stdout, stderr } = deps;
  const allFiles = await scanner.listFiles();
  const scannable = allFiles.filter(shouldScan);
  let leakCount = 0;

  for (const relPath of scannable) {
    let contents;
    try {
      contents = await scanner.readFile(relPath);
    } catch {
      continue;
    }
    for (const { name, regex } of KEY_PATTERNS) {
      // Reset the regex's lastIndex between files (global regexes
      // maintain state across .exec calls).
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(contents)) !== null) {
        const matched = m[0];
        // Allowlist (defensive): the implicit allowlist is encoded into
        // the elevenlabs-env-assignment regex which requires {16,} after
        // `=`. No additional README NAME-mention allowlist is needed
        // here because the bare NAME cannot match any of the seven
        // regexes by construction.
        leakCount += 1;
        stderr.write(
          `[achilles] SECRET LEAK DETECTED: ${name} matched in ${relPath}: ${truncateMatch(matched)}\n`,
        );
        // Continue scanning the same file for other matches; we want a
        // complete leak inventory in the failure log.
      }
    }
  }

  if (leakCount > 0) {
    stderr.write(
      `[achilles] tarball scan: ${leakCount} leak(s) detected across ${scannable.length} scannable file(s); aborting publish\n`,
    );
    deps.processExitImpl(1);
    return;
  }

  stdout.write(
    `[achilles] tarball scan: no secrets detected (scanned ${scannable.length} matchable files)\n`,
  );
  deps.processExitImpl(0);
}

// Production wiring -- runs only when invoked as a script.
const invokedAsScript = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      resolve(entry) === resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  let tmpToClean = null;
  try {
    const { scanner, tmpdir: tmp } = defaultScannerSeam();
    tmpToClean = tmp;
    await runTarballSecretScan({
      scanner,
      stdout: process.stdout,
      stderr: process.stderr,
      processExitImpl: (code) => {
        if (tmpToClean) rmSync(tmpToClean, { recursive: true, force: true });
        process.exit(code);
      },
    });
  } catch (e) {
    if (tmpToClean) rmSync(tmpToClean, { recursive: true, force: true });
    process.stderr.write(
      `[achilles] tarball secret scan failed: ${e.message}\n`,
    );
    process.exit(1);
  }
}
