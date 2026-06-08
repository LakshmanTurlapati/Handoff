/**
 * Phase 18, Plan 02, Task 1 — Install suggestions module (INIT-03).
 *
 * Returns platform-specific install commands for missing binaries detected
 * by checkPreflight(). Optionally invokes the package manager subprocess
 * when the package manager itself is available.
 *
 * Platform lookup table:
 *   darwin  -> brew install sox ffmpeg      (homebrew)
 *   linux   -> sudo apt install -y sox ffmpeg  (apt-get)
 *   win32   -> choco install -y sox.portable ffmpeg  (chocolatey)
 *
 * For `claude` missing on any platform, the install line is the docs URL
 * (claude has no package-manager installer; it ships via its own binary).
 *
 * Note on sudo: on Linux, apt-get requires sudo. We surface the command
 * verbatim — the wizard does NOT auto-elevate. The user's shell will prompt
 * for their password naturally when invokePackageManager spawns the command.
 *
 * No emojis (CLAUDE.md global).
 */

import { EventEmitter } from "node:events";
import {
  execSync as nodeExecSync,
  spawn as nodeSpawn,
  type SpawnOptions,
} from "node:child_process";
import type { ChildProcess } from "node:child_process";

/** Claude install docs URL — no package-manager installer exists. */
const CLAUDE_INSTALL_URL = "https://docs.claude.ai/code";

/** Mapping from platform to install-command generator function. */
const INSTALL_COMMAND_GENERATORS: Partial<
  Record<NodeJS.Platform, (missing: string[]) => string>
> = {
  darwin: (missing) => {
    const pkgs = missing.filter((m) => m !== "claude");
    return `brew install ${pkgs.join(" ")}`;
  },
  linux: (missing) => {
    const pkgs = missing.filter((m) => m !== "claude");
    return `sudo apt install -y ${pkgs.join(" ")}`;
  },
  win32: (missing) => {
    const pkgs = missing.map((m) => (m === "sox" ? "sox.portable" : m)).filter((m) => m !== "claude");
    return `choco install -y ${pkgs.join(" ")}`;
  },
};

/**
 * Result of suggestInstallCommand.
 *
 * @public
 */
export interface InstallCommand {
  /** The install command string to present to the user. */
  readonly cmd: string;
  /**
   * True if the platform package manager is found on PATH and
   * invokePackageManager can be called automatically.
   */
  readonly canAutoInvoke: boolean;
}

/**
 * Dependency seam for suggestInstallCommand exec calls.
 * Tests inject this to avoid touching the real PATH.
 *
 * @public
 */
export interface SuggestDeps {
  /** Override for execSync (package manager `which` probe). */
  execImpl?: (cmd: string) => string | Buffer;
}

/**
 * Dependency seam for invokePackageManager spawn calls.
 *
 * @public
 */
export interface InvokeDeps {
  /** Override for spawn (package manager subprocess). */
  spawnImpl?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

/**
 * Check whether the platform package manager is on PATH.
 */
function isPkgManagerAvailable(
  platform: NodeJS.Platform,
  execImpl: (cmd: string) => string | Buffer,
): boolean {
  const cmd = (() => {
    if (platform === "darwin") return "which brew 2>/dev/null";
    if (platform === "linux") return "which apt-get 2>/dev/null";
    if (platform === "win32") return "where choco 2>/dev/null";
    return null;
  })();
  if (cmd === null) return false;
  try {
    const out = execImpl(cmd);
    const str = typeof out === "string" ? out : out.toString("utf8");
    return str.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Build a platform-specific install command for the given missing binaries.
 * If `claude` is in the list, always returns canAutoInvoke=false and the
 * docs URL (no package-manager path for claude).
 *
 * @public
 */
export function suggestInstallCommand(
  platform: NodeJS.Platform,
  missing: ReadonlyArray<"sox" | "ffmpeg" | "claude">,
  deps: SuggestDeps = {},
): InstallCommand {
  const execImpl =
    deps.execImpl ?? ((cmd: string) => nodeExecSync(cmd, { encoding: "utf8" }));

  const claudeMissing = missing.includes("claude");
  const nonClaudeMissing = missing.filter((m) => m !== "claude");

  // If claude is missing and it is the only missing binary, return the docs URL.
  if (claudeMissing && nonClaudeMissing.length === 0) {
    return { cmd: CLAUDE_INSTALL_URL, canAutoInvoke: false };
  }

  // Build the install command for non-claude missing binaries.
  const generator = INSTALL_COMMAND_GENERATORS[platform];
  let cmd: string;
  if (generator !== undefined && nonClaudeMissing.length > 0) {
    cmd = generator(nonClaudeMissing);
  } else if (claudeMissing) {
    // Claude is missing alongside other binaries — note the docs URL separately.
    cmd = `${CLAUDE_INSTALL_URL} (for claude); ${
      generator?.(nonClaudeMissing) ?? "install sox and ffmpeg manually"
    }`;
  } else {
    cmd = generator?.(missing as string[]) ?? "install missing tools manually";
  }

  const canAutoInvoke = isPkgManagerAvailable(platform, execImpl);
  return { cmd, canAutoInvoke };
}

/**
 * Invoke the package manager by spawning a shell with the given command.
 * Captures stderr and exit code. Does NOT auto-elevate — if the command
 * requires sudo, the shell will prompt naturally.
 *
 * @public
 */
export function invokePackageManager(
  cmd: string,
  deps: InvokeDeps = {},
): Promise<{ exitCode: number | null; stderr: string }> {
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;

  return new Promise((resolve) => {
    // Split the command into cmd + args for cross-platform shell invocation.
    // Use sh -c on POSIX; cmd /c on win32.
    const isWin = process.platform === "win32";
    const [shellCmd, shellArg] = isWin ? ["cmd", "/c"] : ["sh", "-c"];

    const proc = spawnImpl(shellCmd, [shellArg, cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrCapture = "";
    const stderrStream = proc.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk: Buffer) => {
        stderrCapture += chunk.toString("utf8");
      });
    }

    (proc as unknown as EventEmitter).on(
      "exit",
      (code: number | null) => {
        resolve({ exitCode: code, stderr: stderrCapture });
      },
    );
  });
}
