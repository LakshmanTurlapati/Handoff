/**
 * Phase 18, Plan 02, Task 3 — Parent terminal emulator detection (INIT-06).
 *
 * Resolves the user's terminal emulator by inspecting the parent process ID
 * and querying the OS for the process name:
 *
 *   process.ppid -> execSync(`ps -p ${ppid} -o comm=`) -> trim -> match table
 *
 * This information is used by the init wizard (Plan 03) to surface a
 * per-emulator remediation hint when the sox device-open smoke fails with
 * EPERM/EACCES on macOS. On macOS Sequoia and later, the TCC responsible
 * process is the GUI ancestor — the terminal emulator — NOT the leaf binary
 * that opened the audio device. The exact failure shape and remediation are
 * documented in PITFALLS.md §3.
 *
 * VS Code / Cursor special case (microsoft/vscode#307364, May 2026):
 *   VS Code and Cursor do NOT propagate microphone permission from their
 *   integrated terminal. The only safe fix is to open Terminal.app once,
 *   run `achilles init` there to grant mic access at the system level,
 *   then return to VS Code / Cursor. This is documented in the REMEDIATION_TABLE
 *   entries for VSCode and Cursor below.
 *
 * Windows:
 *   Parent detection falls through to "unknown" — INIT-06 explicitly targets
 *   macOS. Windows TCC analog is N/A.
 *
 * No emojis (CLAUDE.md global).
 */

import { execSync as nodeExecSync } from "node:child_process";

/**
 * Terminal emulator enum.
 *
 * @public
 */
export type ParentEmulator =
  | "iTerm2"
  | "Terminal"
  | "VSCode"
  | "Cursor"
  | "Ghostty"
  | "WezTerm"
  | "Warp"
  | "unknown";

/**
 * Per-emulator remediation messages for the macOS TCC mic-permission failure.
 * These messages are surfaced by Plan 03's wizard UI after the sox device-open
 * smoke returns EPERM/EACCES.
 *
 * @public
 */
export const REMEDIATION_TABLE: Readonly<Record<ParentEmulator, string>> =
  Object.freeze({
    iTerm2:
      "Open System Settings -> Privacy & Security -> Microphone and grant iTerm2 access. Restart the terminal after granting.",
    Terminal:
      "Open System Settings -> Privacy & Security -> Microphone and grant Terminal access. Restart the terminal after granting.",
    Ghostty:
      "Open System Settings -> Privacy & Security -> Microphone and grant Ghostty access. Restart the terminal after granting.",
    WezTerm:
      "Open System Settings -> Privacy & Security -> Microphone and grant WezTerm access. Restart the terminal after granting.",
    Warp:
      "Open System Settings -> Privacy & Security -> Microphone and grant Warp access. Restart the terminal after granting.",
    VSCode:
      "VS Code does not propagate microphone permission to its integrated terminal (microsoft/vscode#307364). Open Terminal.app once, run `achilles init`, then return to VS Code.",
    Cursor:
      "Cursor does not propagate microphone permission to its integrated terminal. Open Terminal.app once, run `achilles init`, then return to Cursor.",
    unknown:
      "Open System Settings -> Privacy & Security -> Microphone and enable your terminal emulator. If your terminal is not listed, try iTerm2 or Terminal.app as a known-working alternative.",
  });

/**
 * Ordered pattern table mapping process name fragments to emulator enum values.
 * Listed most-specific first so "Code Helper" matches VSCode before a hypothetical
 * future emulator with just "Code" in the name.
 */
const EMULATOR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  emulator: ParentEmulator;
}> = [
  { pattern: /Code\s+Helper/i, emulator: "VSCode" },
  { pattern: /\bCode\b/i, emulator: "VSCode" },
  { pattern: /\bVSCode\b/i, emulator: "VSCode" },
  { pattern: /Cursor\s+Helper/i, emulator: "Cursor" },
  { pattern: /\bCursor\b/i, emulator: "Cursor" },
  { pattern: /\biTerm/i, emulator: "iTerm2" },
  { pattern: /\bTerminal\b/i, emulator: "Terminal" },
  { pattern: /ghostty/i, emulator: "Ghostty" },
  { pattern: /wezterm/i, emulator: "WezTerm" },
  // Warp embeds itself as "stable" in its process name on some versions.
  { pattern: /\bWarp\b/i, emulator: "Warp" },
  { pattern: /\bstable\b/, emulator: "Warp" },
];

/**
 * Dependency injection seam for testing.
 *
 * @public
 */
export interface ParentTerminalDeps {
  /**
   * Returns the parent process ID. Defaults to process.ppid.
   * Tests inject a deterministic value so no real process is involved.
   */
  ppidImpl?: () => number;
  /**
   * Synchronous exec implementation. Defaults to node:child_process.execSync.
   * Tests inject a function that returns the desired ps output without running ps.
   */
  execSyncImpl?: (cmd: string) => string;
}

/**
 * Resolve the user's parent terminal emulator.
 *
 * Runs `ps -p ${ppid} -o comm=` on POSIX. Returns "unknown" on any error
 * (process not found, ps unavailable, Windows, etc.).
 *
 * @public
 */
export function resolveParentEmulator(
  deps: ParentTerminalDeps = {},
): ParentEmulator {
  const ppidImpl = deps.ppidImpl ?? (() => process.ppid);
  const execSyncImpl =
    deps.execSyncImpl ??
    ((cmd: string) => nodeExecSync(cmd, { encoding: "utf8" }));

  try {
    const ppid = ppidImpl();
    const raw = execSyncImpl(`ps -p ${ppid.toString()} -o comm=`);
    const comm = typeof raw === "string" ? raw.trim() : String(raw).trim();

    for (const { pattern, emulator } of EMULATOR_PATTERNS) {
      if (pattern.test(comm)) {
        return emulator;
      }
    }

    return "unknown";
  } catch {
    // ps failed, not on POSIX, or ppid resolution failed — fall back safely.
    return "unknown";
  }
}

/**
 * Return the remediation hint for the given emulator.
 *
 * @public
 */
export function getRemediationHint(emulator: ParentEmulator): string {
  return REMEDIATION_TABLE[emulator];
}
