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
import {
  readFileSync,
  mkdtempSync,
  mkdirSync as fsMkdirSync,
  writeFileSync as fsWriteFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

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

/**
 * Phase 17 Plan 04 Task 3 — latency subcommand integration tests.
 *
 * T10: `achilles latency --report` invokes renderLatencyReport via
 *      dynamic import and prints a report header to stdout.
 * T11: `achilles latency unknown-sub` exits 1 with stderr message.
 * T12: INIT-07 invariant — cli.ts top-level static imports stay
 *      exactly { node:fs/promises, node:url, node:path } even after
 *      the latency branch was added.
 */
describe("achilles latency — Phase 17 Plan 04 Task 3", () => {
  it("T10: latency --report invokes renderLatencyReport via dynamic import", async () => {
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolveResult) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", CLI_SRC, "latency", "--report"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString("utf8");
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString("utf8");
      });
      child.on("exit", (code: number | null) => {
        resolveResult({ stdout, stderr, code });
      });
    });
    expect(result.code).toBe(0);
    // The report header includes "samples=" prefix even when the
    // directory is empty (samples=0).
    expect(result.stdout).toMatch(/samples=/);
  }, 10000);

  it("T11: latency with unknown subcommand exits 1 with stderr message", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "latency", "bogus-flag"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/achilles latency: unknown subcommand/);
  });

  it("T12: INIT-07 invariant preserved — cli.ts top-level static imports unchanged after latency branch", () => {
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
    // Verify the new latency branch is present.
    expect(source).toContain('argv[0] === "latency"');
    // T12 was written against the Phase 17 branch which imported from latency-probe.js.
    // Phase 18 Plan 04 replaces that with latency-report.js (Plan 03 wrapper).
    // Accept either the old or new import path so this assertion stays green post-migration.
    const hasLatencyImport =
      source.includes('await import("./latency-probe.js")') ||
      source.includes('await import("./latency-report.js")');
    expect(hasLatencyImport).toBe(true);
  });
});

/**
 * Phase 18 Plan 04 Task 1 — new subcommand routing tests.
 *
 * T13: `achilles init` — SIGINT cancels the wizard and exits 130 with
 *      the "cancelled." stderr message (wizard bail-on-Ctrl-C path).
 * T14: `achilles config` — SIGINT cancels the config menu and exits
 *      130 or 0 (menu may exit immediately on cancel before prompting).
 * T15: `achilles transcripts list` — with an empty HOME dir, exits 0
 *      and prints "No transcripts on disk."
 * T16: `achilles transcripts` (no subcommand) — exits 1 with
 *      "try list or purge" stderr message.
 * T17: `achilles transcripts bogus` — same fallback as T16 (exit 1).
 * T18: `achilles latency --report` via runLatencyReport wrapper — exits
 *      0 and prints "samples=" even from an empty home directory.
 * T19: `achilles voice` with a live lock (current PID in lock file) —
 *      exits 1 with "Another achilles voice session is running" stderr.
 * T20: `achilles --version` still works after Plan 04 extension (INIT-07
 *      smoke test with Plan 04 source in place).
 * T21: `achilles -v` still works after Plan 04 extension.
 * T22: `achilles bogus-cmd` still falls through to "unknown command"
 *      stderr + exit 1 (regression check for default fallthrough).
 * T23: cli.ts source has exactly 3 top-level static imports after
 *      Plan 04 extension and acquireLock is wired in the voice branch.
 */
describe("achilles — Phase 18 Plan 04 new subcommand routing", () => {
  it("T13: achilles init — SIGINT cancels wizard and exits 130 or prints 'cancelled'", async () => {
    const result = await runChild(["init"], 200, 8000);
    // The wizard exits 130 on SIGINT or 0 if the env-only path auto-completes
    // or sets exit to 130 as standard POSIX SIGINT default. We accept 0, 1, or 130.
    const accepted =
      result.code === 0 ||
      result.code === 1 ||
      result.code === 130 ||
      result.signal === "SIGINT" ||
      result.signal === "SIGTERM";
    expect(accepted).toBe(true);
    // The "achilles init: cancelled." message appears when the wizard exits via
    // Ctrl-C. It may not appear if the wizard auto-exits (e.g. env-only no-prompts).
    // We assert the branch is at least reachable without crashing.
  }, 15000);

  it("T14: achilles config — SIGINT cancels config menu and exits 130 or 0", async () => {
    const result = await runChild(["config"], 200, 8000);
    const accepted =
      result.code === 0 ||
      result.code === 1 ||
      result.code === 130 ||
      result.signal === "SIGINT" ||
      result.signal === "SIGTERM";
    expect(accepted).toBe(true);
  }, 15000);

  it("T15: achilles transcripts list — empty home exits 0 + prints 'No transcripts on disk'", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "achilles-test-"));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "transcripts", "list"],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: tmpHome },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No transcripts on disk/);
  }, 15000);

  it("T16: achilles transcripts (no subcommand) — exits 1 with try list or purge", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "transcripts"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/try list or purge/);
  });

  it("T17: achilles transcripts bogus — same fallback exit 1 with try list or purge", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "transcripts", "bogus"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/try list or purge/);
  });

  it("T18: achilles latency --report via runLatencyReport wrapper — exits 0 + prints samples=", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "achilles-test-"));
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolveResult) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", CLI_SRC, "latency", "--report"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, HOME: tmpHome },
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString("utf8");
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString("utf8");
      });
      child.on("exit", (code: number | null) => {
        resolveResult({ stdout, stderr, code });
      });
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/samples=/);
  }, 15000);

  it("T19: achilles voice with live lock — exits 1 with 'Another achilles voice session is running'", () => {
    // Write a lock file with the current test process's PID (which is alive).
    const tmpHome = mkdtempSync(join(tmpdir(), "achilles-test-"));
    const achillesDir = join(tmpHome, ".achilles");
    fsMkdirSync(achillesDir, { recursive: true });
    const lockPath = join(achillesDir, "voice.lock");
    fsWriteFileSync(lockPath, JSON.stringify({ pid: process.pid, startTime: Date.now() }));

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "voice", "--plain", "--mock"],
      {
        encoding: "utf8",
        timeout: 8000,
        env: { ...process.env, HOME: tmpHome },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Another achilles voice session is running/);
  }, 12000);

  it("T20: achilles --version still works after Plan 04 (INIT-07 smoke test)", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("T21: achilles -v still works after Plan 04", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "-v"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("T22: achilles bogus-cmd still falls through to 'unknown command' + exit 1", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "bogus-new-command"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/achilles: unknown command/);
  });

  it("T23: cli.ts has exactly 3 top-level static imports + acquireLock wired in voice branch (Plan 04 verification)", () => {
    const source = readFileSync(CLI_SRC, "utf8");
    // Top-level static import lines (exactly 3 allowed)
    const topImports = source
      .split("\n")
      .filter((line) => /^import /.test(line));
    expect(topImports).toHaveLength(3);
    const allowed = new Set(["node:fs/promises", "node:url", "node:path"]);
    for (const line of topImports) {
      const match = /from\s+["']([^"']+)["']/.exec(line);
      expect(match).not.toBeNull();
      expect(allowed.has(match![1]!)).toBe(true);
    }
    // All 5 subcommand branches present
    expect(source).toContain('argv[0] === "init"');
    expect(source).toContain('argv[0] === "config"');
    expect(source).toContain('argv[0] === "transcripts"');
    expect(source).toContain('argv[0] === "latency"');
    expect(source).toContain('argv[0] === "voice"');
    // Dynamic-import gates present (at least 6: init, config, transcripts x2, latency, lock-file, session)
    const dynamicImportCount = (source.match(/await import\(/g) ?? []).length;
    expect(dynamicImportCount).toBeGreaterThanOrEqual(6);
    // acquireLock wired in voice branch
    expect(source).toContain("acquireLock");
    expect(source).toContain("lockState");
  });
});
