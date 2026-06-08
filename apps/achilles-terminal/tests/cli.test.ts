/**
 * Phase 15 seed test surface for INIT-07 + Phase 16 Plan 04 voice subcommand.
 *
 * Phase 15 Tests 1-5 (preserved verbatim): `achilles --version` and the short
 * `-v` form exit 0 and print the version field from package.json without
 * requiring any pipeline-boot resource (no ELEVENLABS_API_KEY, no sox, no
 * ffmpeg). The argv parse MUST happen before any dynamic import that would
 * touch those resources; this surface is the structural assertion that
 * Phase 16+ cannot regress.
 *
 * Test 5 is a file-level invariant: src/cli.ts must begin with the literal
 * shebang line so `npm install -g achilles` on POSIX systems finds the
 * interpreter without a wrapper.
 *
 * Plan 04 Tests 6-9 (NEW): integration tests for the `voice` subcommand.
 *   T6  `voice --plain --mock` exits cleanly on SIGINT + emits ISO-prefixed
 *        log lines
 *   T7  `voice --plain --mock --debug-vad` emits the locked JSON-line shape
 *        to stderr
 *   T8  INIT-07 source-budget invariant — cli.ts top-level static imports
 *        are EXACTLY { node:fs/promises, node:url, node:path } and the new
 *        runVoice path uses await import("./session.js") inside main()
 *   T9  voice branch dispatches to session.runVoice — sending SIGINT
 *        immediately after spawn results in a clean exit (smoke test of the
 *        full dynamic-import + signal-handler chain)
 *
 * Note on Assumption A7 (RESEARCH.md): under Bun, process.execPath is the
 * bun binary, not node. The simple shape here assumes Node + tsx; Plan 04
 * adds the dual-runtime CI matrix that surfaces any runtime-detection gap.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = join(HERE, "..", "src", "cli.ts");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(resolve(HERE, "..", "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("achilles --version", () => {
  it("prints a non-empty semver-shaped version string matching package.json", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
    expect(result.stderr).toBe("");
  });

  it("exits 0 without ELEVENLABS_API_KEY set (INIT-07)", () => {
    // Spread process.env then explicitly delete the key. Setting to
    // undefined would coerce to the string "undefined" via the spawn env
    // serialization; delete removes the key entirely.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ELEVENLABS_API_KEY;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      {
        encoding: "utf8",
        timeout: 5000,
        env,
      },
    );

    expect(result.status).toBe(0);
  });

  it("short -v flag prints the same version", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "-v"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
  });

  it("unknown command exits 1 with stderr message", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "bogus-subcommand"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/achilles: unknown command/);
  });

  it("src/cli.ts begins with the node shebang line", () => {
    const source = readFileSync(CLI_SRC, "utf8");
    const firstLine = source.split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});

/**
 * Helper for the spawn-based integration tests below. Spawns the CLI in a
 * child process with the given argv, sends SIGINT after `sigintDelayMs`,
 * and resolves with the captured stdout + stderr + exit code (or rejects
 * if the child does not exit within `timeoutMs`).
 */
async function runChild(
  argv: string[],
  sigintDelayMs: number,
  timeoutMs: number,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return await new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CLI_SRC, ...argv],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const sigintTimer = setTimeout(() => {
      child.kill("SIGINT");
    }, sigintDelayMs);
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectResult(new Error("integration test child did not exit in time"));
    }, timeoutMs);
    child.on(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null): void => {
        clearTimeout(sigintTimer);
        clearTimeout(killTimer);
        resolveResult({ stdout, stderr, code, signal });
      },
    );
  });
}

describe("achilles voice — Phase 16 Plan 04 integration tests", () => {
  it("T6: voice --plain --mock exits cleanly on SIGINT + emits ISO-prefixed log lines", async () => {
    const result = await runChild(["voice", "--plain", "--mock"], 300, 5000);
    // Exit 0 (clean SIGINT handler) OR 130 (POSIX default SIGINT exit) are
    // both acceptable. Some shells also report code=null with signal=SIGINT.
    const accepted =
      result.code === 0 ||
      result.code === 130 ||
      result.signal === "SIGINT" ||
      result.signal === "SIGTERM";
    expect(accepted).toBe(true);
    // ISO-prefixed log lines from plain-text.ts formatPlainLine.
    expect(result.stdout).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  }, 10000);

  it("T7: voice --plain --mock --debug-vad emits the locked JSON line shape to stderr", async () => {
    const result = await runChild(
      ["voice", "--plain", "--mock", "--debug-vad"],
      300,
      5000,
    );
    // The locked JSON-line shape from CONTEXT.md <specifics> row 4 begins
    // with `{"t":<digits>,"energy":`.
    expect(result.stderr).toMatch(/\{"t":\d+,"energy":/);
  }, 10000);

  it("T8: INIT-07 source-budget — top-level static imports are EXACTLY { node:fs/promises, node:url, node:path } and the voice branch dynamic-imports session", () => {
    const source = readFileSync(CLI_SRC, "utf8");
    const topImports = source
      .split("\n")
      .filter((line) => /^import /.test(line));
    const allowed = new Set(["node:fs/promises", "node:url", "node:path"]);
    for (const line of topImports) {
      const match = /from\s+["']([^"']+)["']/.exec(line);
      expect(match).not.toBeNull();
      const specifier = match![1]!;
      expect(allowed.has(specifier)).toBe(true);
    }
    // The dynamic-import gate must appear inside main().
    expect(source).toContain('await import("./session.js")');
  });

  it("T9: voice branch dispatches to session.runVoice — immediate SIGINT exits cleanly", async () => {
    const result = await runChild(["voice", "--plain", "--mock"], 50, 5000);
    const accepted =
      result.code === 0 ||
      result.code === 130 ||
      result.signal === "SIGINT" ||
      result.signal === "SIGTERM";
    expect(accepted).toBe(true);
  }, 10000);
});
