/**
 * Phase 19 Plan 02 Task 3 — `achilles install-skill` subcommand
 * action handler (port from v1.2 apps/achilles-cli/src/commands/
 * install-skill.ts).
 *
 * Resolves the source (the workspace-resolved @achilles/achilles-skill
 * skill directory) and the destination (~/.claude/skills/achilles/),
 * then delegates to `installSkillSymlink` in `./skill-symlink.js`.
 * Surfaces conflict errors with concrete remediation copy and the
 * success path includes the "restart Claude Code" reminder
 * (PITFALLS.md #5: a new top-level skills directory created mid-session
 * requires Claude Code restart).
 *
 * Port notes:
 *
 *   - v1.2 imports `from "../skill-symlink.js"` (commands/ subdir layout).
 *     v1.3 is flat: `from "./skill-symlink.js"`.
 *   - `SKILL_PROMPTS_DIR` is imported from `@achilles/achilles-skill`
 *     unchanged — the package was flipped to `private: false` in
 *     Plan 19-01 and is published to npm at v1.3.0.
 *   - Production binding for `skillSourceProvider` walks one directory
 *     up from `SKILL_PROMPTS_DIR` to obtain the skill ROOT (the
 *     directory containing both SKILL.md and prompts/companion.md).
 *
 * The command body is a pure function over injected seams so the test
 * file `install-skill.test.ts` can drive every branch (happy path,
 * existing-different-target conflict, Windows EPERM fallback) without
 * touching the real filesystem.
 *
 * Production wiring (apps/achilles-terminal/src/cli.ts dynamic-import
 * gate inside main()) binds:
 *
 *   - homedir:              os.homedir
 *   - platform:             process.platform
 *   - fs:                   node:fs synchronous APIs
 *   - stdout / stderr:      process.stdout / process.stderr
 *   - processExitImpl:      (code) => process.exit(code)
 *   - skillSourceProvider:  () => resolve(SKILL_PROMPTS_DIR, '..')
 *   - logger:               { info: stdout.write+\n, warn: stdout.write+\n }
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md DIST-02 — `achilles install-skill` subcommand
 *   - REQUIREMENTS.md DIST-03 — one source of truth (the symlink target
 *     IS the source on macOS/Linux; copy fallback on Windows)
 *   - PITFALLS.md #5 — Claude Code skill discovery semantics
 *   - PITFALLS.md #13 — Windows global install pain (symlink may need
 *     admin or Developer Mode)
 *
 * No emojis (CLAUDE.md global).
 *
 * @public
 */

import { homedir as nodeHomedir } from "node:os";
import { join, resolve } from "node:path";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { SKILL_PROMPTS_DIR } from "@achilles/achilles-skill";

import {
  ExistingDestinationConflictError,
  installSkillSymlink,
  SymlinkNotPermittedError,
} from "./skill-symlink.js";
import type {
  InstallSkillSymlinkFs,
  InstallSkillSymlinkLogger,
} from "./skill-symlink.js";

/**
 * Subset of `node:stream` Writable shape used by installSkillCommand.
 * The cli.ts production wiring passes `process.stdout` /
 * `process.stderr` directly.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Inputs to installSkillCommand. The `force` + `stdout` +
 * `processExitImpl` triple is the slim contract the cli.ts production
 * wiring already passes; the rest are optional seams with production
 * defaults so the same call site continues to compile while the test
 * file injects all seams for branch coverage.
 *
 * @public
 */
export interface InstallSkillCommandOptions {
  readonly force: boolean;
  readonly stdout: WritableSeam;
  readonly processExitImpl: (code: number) => void;
  readonly stderr?: WritableSeam;
  readonly homedir?: () => string;
  readonly platform?: NodeJS.Platform;
  readonly fs?: InstallSkillSymlinkFs;
  readonly skillSourceProvider?: () => string;
  readonly logger?: InstallSkillSymlinkLogger;
}

/**
 * Default production fs seam: bound to `node:fs` synchronous APIs at
 * module load. Bound here once so the per-invocation defaults below do
 * not capture a fresh object literal per call.
 */
const productionFs: InstallSkillSymlinkFs = {
  mkdirSync: (path, opts) => {
    mkdirSync(path, opts);
    return undefined;
  },
  lstatSync: (path) => {
    const stat = lstatSync(path);
    return {
      isSymbolicLink: () => stat.isSymbolicLink(),
      isDirectory: () => stat.isDirectory(),
      isFile: () => stat.isFile(),
    };
  },
  readlinkSync: (path) => readlinkSync(path),
  symlinkSync: (target, path, type) => {
    symlinkSync(target, path, type);
    return undefined;
  },
  rmSync: (path, opts) => {
    rmSync(path, opts);
    return undefined;
  },
  cpSync: (src, dest, opts) => {
    cpSync(src, dest, opts);
    return undefined;
  },
};

/**
 * Default skill source provider: walks one directory up from
 * `SKILL_PROMPTS_DIR` to obtain the skill root that contains both
 * `SKILL.md` and `prompts/companion.md`. The skill root is the
 * directory the install-skill command symlinks into
 * `~/.claude/skills/achilles/`.
 */
function defaultSkillSourceProvider(): string {
  return resolve(SKILL_PROMPTS_DIR, "..");
}

/**
 * Build a logger seam that routes both `info` and `warn` levels to the
 * given stdout WritableSeam. Used to wire the primitive's two-level
 * logger to the command's stdout channel; user-facing remediation copy
 * is routed through stderr separately by the catch blocks below.
 */
function buildStdoutLogger(stdout: WritableSeam): InstallSkillSymlinkLogger {
  return {
    info: (msg) => stdout.write(msg + "\n"),
    warn: (msg) => stdout.write(msg + "\n"),
  };
}

/**
 * `achilles install-skill` action handler. Pure function over the
 * injected seams; never reads or writes filesystem state directly
 * (defers to the `fs` seam).
 *
 * @public
 */
export function installSkillCommand(
  options: InstallSkillCommandOptions,
): void {
  const {
    force,
    stdout,
    processExitImpl,
    stderr = stdout,
    homedir = nodeHomedir,
    platform = process.platform,
    fs = productionFs,
    skillSourceProvider = defaultSkillSourceProvider,
    logger = buildStdoutLogger(stdout),
  } = options;

  const source = skillSourceProvider();
  const destination = join(homedir(), ".claude", "skills", "achilles");

  try {
    const result = installSkillSymlink({
      source,
      destination,
      force,
      fs,
      platform,
      logger,
    });
    if (result.mode === "already-installed") {
      stdout.write(
        `[achilles] Skill already installed at ${destination}; nothing to do.\n`,
      );
      return;
    }
    // mode === 'symlink' or mode === 'copy' — both are fresh installs;
    // both require the user to restart Claude Code so the skill is
    // picked up (Pitfall #5: a new top-level skill directory is not
    // discovered mid-session).
    stdout.write(`[achilles] Skill installed at ${destination}.\n`);
    stdout.write(
      `[achilles] Please restart Claude Code to discover the /achilles skill.\n`,
    );
    return;
  } catch (err) {
    if (err instanceof ExistingDestinationConflictError) {
      stderr.write(`${err.message}\n`);
      stderr.write(`[achilles] Pass --force to overwrite.\n`);
      processExitImpl(1);
      return;
    }
    if (err instanceof SymlinkNotPermittedError) {
      stderr.write(`${err.message}\n`);
      stderr.write(
        `[achilles] On Windows you may need to enable Developer Mode (Settings > Update & Security > For Developers).\n`,
      );
      processExitImpl(1);
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    stderr.write(`[achilles] install-skill failed: ${detail}\n`);
    processExitImpl(1);
    return;
  }
}
