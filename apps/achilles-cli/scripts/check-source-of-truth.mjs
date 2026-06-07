#!/usr/bin/env node
/**
 * Source-of-truth diff check for the achilles npm CLI release.
 *
 * Closes the Pitfall #12 dual-distribution drift hole (REQUIREMENTS.md
 * DIST-03): the skill body and the npm CLI must ship from one source of
 * truth. The check has two arms:
 *
 *   1. Byte-equality between
 *        packages/achilles-skill/skill/prompts/companion.md (the workspace
 *        source-of-truth file) AND
 *        node_modules/@achilles/achilles-skill/skill/prompts/companion.md
 *        inside the npm tarball produced by `npm pack apps/achilles-cli`.
 *      The tarball includes the workspace dep because
 *      apps/achilles-cli/package.json declares
 *        "bundledDependencies": ["@achilles/achilles-skill"]
 *      (Plan 13-04 wires this).
 *
 *   2. Version-pin equality between
 *        apps/achilles-cli/package.json `version`
 *      AND
 *        apps/achilles/package.json `version`
 *      so a user running `npm install -g achilles@X` gets a tarball whose
 *      Electron-app expectation matches version X.
 *
 * Both arms must pass or the script exits 1. The runner is exported as
 * `runSourceOfTruthCheck(deps)` so the unit tests can inject a mock fs +
 * version map; the production wiring at the bottom of this file binds the
 * seams to real node:fs/promises + a real `npm pack` invocation through
 * the `tarballRealRun` seam.
 *
 * Logging contract (CLAUDE.md global: NO emojis; defence in depth):
 *   - Success: log to stdout with the literal prefix `[achilles] `.
 *   - Failure: log to stderr.
 *   - Byte-mismatch diagnostics show the SHA-256 prefix (first 12 hex
 *     chars) for each side. The FULL file bytes are NEVER logged.
 *
 * No external dependencies. Node 22 stdlib only.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/achilles-cli/scripts/; the repo root is three
// directories up.
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/**
 * Compute the SHA-256 hex digest of a Buffer.
 */
function sha256Hex(buf) {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

/**
 * Resolve the production seams for the runner.
 */
function defaultSourcePaths() {
  return {
    source: resolve(
      REPO_ROOT,
      "packages/achilles-skill/skill/prompts/companion.md",
    ),
  };
}

function defaultFsSeam() {
  return {
    readFile: (path) => readFile(path),
  };
}

/**
 * Real-mode tarball pack + extract. Runs `npm pack --pack-destination
 * <tmpdir> --json` against apps/achilles-cli/ and extracts the produced
 * tarball into a unique subdirectory. Returns the path to the bundled
 * skill companion.md inside the extracted tarball.
 */
function realTarballPathProducer() {
  const cliDir = resolve(REPO_ROOT, "apps/achilles-cli");
  const tmp = mkdtempSync(join(tmpdir(), "achilles-sot-"));
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
    const extractDir = join(tmp, "extract");
    // CR-04 fix: use the Node stdlib instead of shelling out to POSIX
    // `mkdir -p`. The previous `execFileSync('mkdir', ['-p', ...])`
    // would fail on Windows (`mkdir` is a cmd.exe built-in that does not
    // accept the `-p` flag), aborting prepublishOnly with a misleading
    // ENOENT / spawn error if the operator publishes from a Windows
    // host.
    mkdirSync(extractDir, { recursive: true });
    execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
      stdio: "ignore",
    });
    const bundled = join(
      extractDir,
      "package",
      "node_modules",
      "@achilles",
      "achilles-skill",
      "skill",
      "prompts",
      "companion.md",
    );
    return { tarballPaths: { extractedSkillCompanion: bundled }, tmpdir: tmp };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

function defaultVersions() {
  const cliPkg = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "apps/achilles-cli/package.json"),
      "utf8",
    ),
  );
  const appPkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "apps/achilles/package.json"), "utf8"),
  );
  return { cli: cliPkg.version, app: appPkg.version };
}

/**
 * Run the source-of-truth check.
 *
 * @param {object} deps
 * @param {{ source: string }} deps.sourcePaths
 * @param {{ extractedSkillCompanion: string }} deps.tarballPaths
 * @param {{ readFile: (p: string) => Promise<Buffer> }} deps.fs
 * @param {{ cli: string, app: string }} deps.versions
 * @param {{ write: (s: string) => boolean }} deps.stdout
 * @param {{ write: (s: string) => boolean }} deps.stderr
 * @param {(code: number) => void} deps.processExitImpl
 */
export async function runSourceOfTruthCheck(deps) {
  const { sourcePaths, tarballPaths, fs, versions, stdout, stderr } = deps;
  let exitCode = 0;

  // Arm 1: byte-equality of source vs bundled companion.md
  let sourceBytes;
  let bundledBytes;
  try {
    sourceBytes = await fs.readFile(sourcePaths.source);
  } catch (e) {
    stderr.write(
      `[achilles] source missing expected file: ${sourcePaths.source} (${e.code ?? e.message})\n`,
    );
    deps.processExitImpl(1);
    return;
  }
  try {
    bundledBytes = await fs.readFile(tarballPaths.extractedSkillCompanion);
  } catch (e) {
    stderr.write(
      `[achilles] tarball missing expected file: ${tarballPaths.extractedSkillCompanion} (${e.code ?? e.message}); did you run npm pack with bundledDependencies?\n`,
    );
    deps.processExitImpl(1);
    return;
  }

  const sourceSha = sha256Hex(sourceBytes);
  const bundledSha = sha256Hex(bundledBytes);

  if (sourceSha === bundledSha) {
    stdout.write(
      `[achilles] source-of-truth: companion.md SHA-256 match (${sourceSha.slice(0, 12)})\n`,
    );
  } else {
    // Defence in depth: log only the truncated SHA-256 prefixes; NEVER
    // log the file bytes themselves.
    stderr.write(
      `[achilles] companion.md DIFF: source=${sourceSha.slice(0, 12)} bundled=${bundledSha.slice(0, 12)}\n`,
    );
    exitCode = 1;
  }

  // Arm 2: version-pin equality
  if (versions.cli === versions.app) {
    stdout.write(
      `[achilles] version pin: ${versions.cli} === ${versions.app}\n`,
    );
  } else {
    stderr.write(
      `[achilles] version pin drift: achilles ${versions.cli} !== achilles-app ${versions.app}\n`,
    );
    exitCode = 1;
  }

  deps.processExitImpl(exitCode);
}

// Production wiring — runs only when invoked as a script (the unit tests
// import this module without triggering the bottom-of-file path).
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
    const sourcePaths = defaultSourcePaths();
    const versions = defaultVersions();
    const { tarballPaths, tmpdir: tmp } = realTarballPathProducer();
    tmpToClean = tmp;
    await runSourceOfTruthCheck({
      sourcePaths,
      tarballPaths,
      fs: defaultFsSeam(),
      versions,
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
      `[achilles] source-of-truth check failed: ${e.message}\n`,
    );
    process.exit(1);
  }
}
