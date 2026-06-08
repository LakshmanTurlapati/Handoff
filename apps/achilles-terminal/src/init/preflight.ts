/**
 * Phase 18, Plan 02, Task 1 — Preflight check module (INIT-03).
 *
 * Checks that sox, ffmpeg, and claude are available and functional before
 * the init wizard continues. Each check has two stages:
 *
 *   1. `which` / `where.exe` — confirms the binary is on PATH
 *   2. Device-open smoke — a short-lived spawn that exercises the real
 *      code path (sox opens the mic for 1 second; ffmpeg prints version;
 *      claude prints version). Stage 2 is the critical gate that catches
 *      the "binary on PATH but mic disabled" silent-failure shape described
 *      in PITFALLS.md §1: without a real device-open, Phase 18 would
 *      inherit the v1.2 silent-launch class.
 *
 * The module accepts a `PreflightDeps` injection seam so every behaviour
 * can be exercised in unit tests without touching a real microphone, real
 * ffmpeg, or real PATH.
 *
 * PITFALLS.md §1 / D-19 stdio requirement:
 *   Every spawn call uses stdio: ["ignore", "pipe", "pipe"] — NEVER
 *   full-ignore. stdout is discarded via the "ignore" slot, but stderr
 *   is always piped so EPERM / device-not-found messages are captured
 *   and surfaced to the caller via BinaryCheck.stderr.
 *
 * No emojis (CLAUDE.md global).
 */

import { EventEmitter } from "node:events";
import {
  execSync as nodeExecSync,
  spawn as nodeSpawn,
  type ExecSyncOptions,
  type SpawnOptions,
} from "node:child_process";
import type { ChildProcess } from "node:child_process";

/**
 * Status of a single binary's preflight check.
 *
 * @public
 */
export type BinaryStatus = "ok" | "missing" | "device-failed";

/**
 * Result for a single binary.
 *
 * @public
 */
export interface BinaryCheck {
  readonly name: "sox" | "ffmpeg" | "claude";
  readonly status: BinaryStatus;
  readonly path: string | null;
  readonly stderr?: string;
}

/**
 * Aggregate result for all three binaries.
 *
 * @public
 */
export interface PreflightResult {
  readonly sox: BinaryCheck;
  readonly ffmpeg: BinaryCheck;
  readonly claude: BinaryCheck;
  readonly allOk: boolean;
}

/**
 * Dependency injection seam for testing.
 *
 * @public
 */
export interface PreflightDeps {
  /**
   * Synchronous exec implementation (defaults to node:child_process.execSync).
   * Used for `which` / `where.exe` lookups.
   */
  execImpl?: (cmd: string, opts?: ExecSyncOptions) => string | Buffer;
  /**
   * Spawn implementation (defaults to node:child_process.spawn).
   * Used for device-open smoke tests.
   */
  spawnImpl?: (
    cmd: string,
    args: string[],
    opts: SpawnOptions,
  ) => ChildProcess;
  /**
   * Platform override for testing Windows/POSIX branches without
   * running on the target OS.
   */
  platformOverride?: NodeJS.Platform;
  /**
   * Timeout in milliseconds for the device-open smoke. Defaults to 3000.
   */
  timeoutMs?: number;
}

const DEFAULT_DEVICE_OPEN_TIMEOUT_MS = 3000;

/**
 * Resolve the path to a binary by running `which bin` (POSIX) or
 * `where.exe bin` (win32). Returns the trimmed path string, or null
 * if the binary is not on PATH (exec throws or returns empty).
 */
function whichSync(
  bin: string,
  platform: NodeJS.Platform,
  execImpl: (cmd: string, opts?: ExecSyncOptions) => string | Buffer,
): string | null {
  const cmd =
    platform === "win32" ? `where.exe ${bin}` : `which ${bin} 2>/dev/null`;
  try {
    const out = execImpl(cmd, { encoding: "utf8" });
    const str = typeof out === "string" ? out : out.toString("utf8");
    const trimmed = str.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Spawn a child process for the device-open smoke test and wait for
 * either exit or timeout. Captures stderr for diagnostic output.
 *
 * stdio is ["ignore", "pipe", "pipe"] — stdout discarded (we only
 * care about exit code), stderr piped to capture EPERM messages.
 */
function runDeviceOpenSmoke(
  cmd: string,
  args: string[],
  spawnImpl: (
    cmd: string,
    args: string[],
    opts: SpawnOptions,
  ) => ChildProcess,
  timeoutMs: number,
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawnImpl(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrCapture = "";
    let settled = false;

    const stderrStream = proc.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk: Buffer) => {
        stderrCapture += chunk.toString("utf8");
      });
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        resolve({ exitCode: null, stderr: stderrCapture });
      }
    }, timeoutMs);

    (proc as unknown as EventEmitter).on(
      "exit",
      (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ exitCode: code, stderr: stderrCapture });
        }
      },
    );
  });
}

/**
 * Run the sox device-open smoke test. Uses the same argv shape as
 * Phase 16's mic-sox.ts so the test exercises the real mic-open path:
 *   POSIX: rec -q -t raw -r 16000 -b 16 -e signed -c 1 - trim 0 1
 *   win32: sox.exe -q -d -t raw -r 16000 -b 16 -e signed -c 1 - trim 0 1
 */
async function checkSox(
  resolvedPath: string,
  platform: NodeJS.Platform,
  spawnImpl: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess,
  timeoutMs: number,
): Promise<{ status: BinaryStatus; stderr?: string }> {
  const cmd = platform === "win32" ? "sox.exe" : "rec";
  const args =
    platform === "win32"
      ? ["-q", "-d", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", "-", "trim", "0", "1"]
      : ["-q", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", "-", "trim", "0", "1"];

  // resolvedPath is used as a hint only; we use cmd for the actual spawn
  // to match the mic-sox.ts pattern exactly (rec on POSIX).
  void resolvedPath;

  const { exitCode, stderr } = await runDeviceOpenSmoke(cmd, args, spawnImpl, timeoutMs);
  if (exitCode === 0) {
    return { status: "ok" };
  }
  return { status: "device-failed", stderr };
}

/**
 * Run ffmpeg -version to confirm the binary works. No device test —
 * ffmpeg failure modes surface at PLAY-01 runtime via Phase 17
 * child-exit-watchdog.
 */
async function checkFfmpeg(
  _resolvedPath: string,
  _platform: NodeJS.Platform,
  spawnImpl: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess,
  timeoutMs: number,
): Promise<{ status: BinaryStatus; stderr?: string }> {
  const { exitCode, stderr } = await runDeviceOpenSmoke(
    "ffmpeg",
    ["-version"],
    spawnImpl,
    timeoutMs,
  );
  if (exitCode === 0) {
    return { status: "ok" };
  }
  return { status: "device-failed", stderr };
}

/**
 * Run claude --version to confirm the binary works.
 */
async function checkClaude(
  _resolvedPath: string,
  _platform: NodeJS.Platform,
  spawnImpl: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess,
  timeoutMs: number,
): Promise<{ status: BinaryStatus; stderr?: string }> {
  const { exitCode, stderr } = await runDeviceOpenSmoke(
    "claude",
    ["--version"],
    spawnImpl,
    timeoutMs,
  );
  if (exitCode === 0) {
    return { status: "ok" };
  }
  return { status: "device-failed", stderr };
}

/**
 * Run preflight checks for sox, ffmpeg, and claude. Each check runs
 * `which` then a device-open smoke. Returns a typed result table.
 *
 * @public
 */
export async function checkPreflight(
  deps: PreflightDeps = {},
): Promise<PreflightResult> {
  const platform = deps.platformOverride ?? process.platform;
  const execImpl =
    deps.execImpl ??
    ((cmd: string, opts?: ExecSyncOptions) => nodeExecSync(cmd, opts));
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DEVICE_OPEN_TIMEOUT_MS;

  // --- sox ---
  const soxPath = whichSync("sox", platform, execImpl);
  let soxCheck: BinaryCheck;
  if (soxPath === null) {
    soxCheck = { name: "sox", status: "missing", path: null };
  } else {
    const { status, stderr } = await checkSox(soxPath, platform, spawnImpl, timeoutMs);
    soxCheck = { name: "sox", status, path: soxPath, ...(stderr !== undefined ? { stderr } : {}) };
  }

  // --- ffmpeg ---
  const ffmpegPath = whichSync("ffmpeg", platform, execImpl);
  let ffmpegCheck: BinaryCheck;
  if (ffmpegPath === null) {
    ffmpegCheck = { name: "ffmpeg", status: "missing", path: null };
  } else {
    const { status, stderr } = await checkFfmpeg(ffmpegPath, platform, spawnImpl, timeoutMs);
    ffmpegCheck = { name: "ffmpeg", status, path: ffmpegPath, ...(stderr !== undefined ? { stderr } : {}) };
  }

  // --- claude ---
  const claudePath = whichSync("claude", platform, execImpl);
  let claudeCheck: BinaryCheck;
  if (claudePath === null) {
    claudeCheck = { name: "claude", status: "missing", path: null };
  } else {
    const { status, stderr } = await checkClaude(claudePath, platform, spawnImpl, timeoutMs);
    claudeCheck = { name: "claude", status, path: claudePath, ...(stderr !== undefined ? { stderr } : {}) };
  }

  const allOk =
    soxCheck.status === "ok" &&
    ffmpegCheck.status === "ok" &&
    claudeCheck.status === "ok";

  return {
    sox: soxCheck,
    ffmpeg: ffmpegCheck,
    claude: claudeCheck,
    allOk,
  };
}
