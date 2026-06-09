/**
 * Phase 19 Plan 02 Task 3 — skill-symlink primitive (port from v1.2
 * apps/achilles-cli/src/skill-symlink.ts).
 *
 * The `installSkillSymlink` function creates the link from
 * `~/.claude/skills/achilles/` to the resolved skill source. The
 * function is a pure-function primitive: filesystem access is mediated
 * through the injected `fs` seam, logging through the injected
 * `logger` seam, and platform-branch behaviour through the injected
 * `platform` value. The production wrapper in
 * `apps/achilles-terminal/src/install-skill.ts` binds the seams to
 * `node:fs` defaults, `process.stdout` / `process.stderr`, and
 * `process.platform`.
 *
 * Idempotency contract:
 *
 *   - If the destination already exists AND is a symlink AND its target
 *     equals the requested source, return `{ mode: 'already-installed' }`
 *     and log a single info line. No destructive call.
 *   - If the destination exists with a DIFFERENT target (or as a real
 *     directory / file) AND `force === false`, throw
 *     `ExistingDestinationConflictError` naming both the existing target
 *     and the requested source so the user can investigate.
 *   - If `force === true`, `rmSync(destination, { recursive: true,
 *     force: true })` then proceed with the symlink/copy.
 *
 * Windows-EPERM fallback (PITFALLS.md #13):
 *
 *   - On Windows, `fs.symlinkSync` requires admin privileges or
 *     Developer Mode. When `symlinkSync` throws `EPERM`, `EACCES`, or
 *     `EISDIR` we fall back to a recursive `fs.cpSync` so the user has a
 *     working install. A single `warn`-level log line names the fallback
 *     so the user understands they will need to re-run `achilles
 *     install-skill` after an update to refresh the copy.
 *   - On macOS / Linux, ANY symlinkSync failure is a real bug
 *     (unwritable homedir, read-only filesystem) — we throw
 *     `SymlinkNotPermittedError` rather than silently masking the
 *     condition with a copy.
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md DIST-02 / DIST-03 — `achilles install-skill`
 *     symlinks the skill body into the Claude Code skills directory;
 *     single source of truth between npm-installed package and the
 *     `~/.claude/skills/achilles/` discovery target.
 *   - PITFALLS.md #11 — keep the skill bundle pure markdown + the
 *     prompts/ directory (no executables).
 *   - PITFALLS.md #13 — Windows global install pain; fall back to copy.
 *
 * Port note: this file is a verbatim port of v1.2
 * apps/achilles-cli/src/skill-symlink.ts. The module is pure (no
 * relative imports beyond node:path) so the port is path-neutral; the
 * v1.3 consumer at install-skill.ts uses the flat layout
 * `from "./skill-symlink.js"` instead of the v1.2 `../skill-symlink.js`.
 *
 * No emojis (CLAUDE.md global).
 *
 * @public
 */

import { dirname, resolve } from "node:path";

/**
 * Subset of `node:fs` synchronous APIs used by `installSkillSymlink`.
 * Captured here so the test seam can be a recording fake without
 * pulling in the full node:fs types.
 *
 * @public
 */
export interface InstallSkillSymlinkFs {
  mkdirSync(
    path: string,
    options: { readonly recursive: boolean },
  ): undefined;
  lstatSync(path: string): {
    isSymbolicLink: () => boolean;
    isDirectory: () => boolean;
    isFile: () => boolean;
  };
  readlinkSync(path: string): string;
  symlinkSync(
    target: string,
    path: string,
    type: "dir" | "file" | "junction",
  ): undefined;
  rmSync(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean },
  ): undefined;
  cpSync(
    source: string,
    destination: string,
    options: { readonly recursive: boolean },
  ): undefined;
}

/**
 * Logger seam. Two levels are emitted:
 *
 *   - `info`: success messages (symlink created, copy completed,
 *     already-installed no-op)
 *   - `warn`: Windows fallback warning (symlinkSync failed; falling
 *     back to a recursive copy)
 *
 * The production install-skill command binds both levels to
 * `process.stdout.write`; the test seam records each call for
 * assertion.
 *
 * @public
 */
export interface InstallSkillSymlinkLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Input contract for `installSkillSymlink`.
 *
 * @public
 */
export interface InstallSkillSymlinkOptions {
  readonly source: string;
  readonly destination: string;
  readonly force: boolean;
  readonly fs: InstallSkillSymlinkFs;
  readonly platform: NodeJS.Platform;
  readonly logger: InstallSkillSymlinkLogger;
}

/**
 * Return contract for `installSkillSymlink`.
 *
 * - `symlink`: a fresh symlink was created at the destination.
 * - `copy`: the Windows fallback copy was used; the destination is a
 *   regular directory mirroring the source's contents.
 * - `already-installed`: an existing symlink at the destination already
 *   points at the requested source; no destructive call was made.
 *
 * @public
 */
export type InstallSkillSymlinkResult =
  | { readonly mode: "symlink" }
  | { readonly mode: "copy" }
  | { readonly mode: "already-installed" };

/**
 * Thrown when the destination exists with a different target (symlink
 * to a wrong source, or a real directory / file) AND `force` is false.
 * The user must either pass `--force` to overwrite or investigate the
 * pre-existing destination manually.
 *
 * @public
 */
export class ExistingDestinationConflictError extends Error {
  override readonly name = "ExistingDestinationConflictError";
  constructor(message: string) {
    super(message);
    // Restore the prototype chain when extending built-ins in CJS / TS
    // downlevel emit. NodeNext ES2022 targets keep this safe; the line
    // is a belt-and-braces guard for any future emit-target shift.
    Object.setPrototypeOf(this, ExistingDestinationConflictError.prototype);
  }
}

/**
 * Thrown on macOS / Linux when the underlying `symlinkSync` call fails
 * for any reason. On those platforms we do NOT fall back to a copy
 * because the failure indicates a real problem with the user's homedir
 * or filesystem that the user needs to know about.
 *
 * @public
 */
export class SymlinkNotPermittedError extends Error {
  override readonly name = "SymlinkNotPermittedError";
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SymlinkNotPermittedError.prototype);
  }
}

/**
 * Test whether an arbitrary value carries a string-shaped `code`
 * property (typical of Node.js syscall errors). Used to decide whether
 * the symlinkSync failure is one we recognise as a Windows-permission
 * issue (EPERM / EACCES / EISDIR) or something else.
 *
 * @public
 */
export function getErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const candidate = (err as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * Set of error codes the Windows-EPERM fallback handles. Outside of
 * Windows, none of these codes trigger the copy fallback.
 *
 * @public
 */
export const WINDOWS_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "EISDIR",
]);

/**
 * Create the skill symlink at `destination` pointing at `source`,
 * applying the idempotency + Windows-fallback rules documented in the
 * module header.
 *
 * @public
 */
export function installSkillSymlink(
  options: InstallSkillSymlinkOptions,
): InstallSkillSymlinkResult {
  const { source, destination, force, fs, platform, logger } = options;

  // Step 1: ensure the destination's parent directory exists. The
  // parent is typically `~/.claude/skills`; on a fresh install neither
  // the .claude folder nor the skills/ subdirectory may exist yet.
  fs.mkdirSync(dirname(destination), { recursive: true });

  // Step 2: probe the destination. We use lstatSync (not statSync) so
  // we can distinguish a symlink from the directory or file it points
  // at; the latter follows the symlink and would mask the conflict
  // detection below.
  let destinationExists = false;
  let destinationIsSymlink = false;
  try {
    const stat = fs.lstatSync(destination);
    destinationExists = true;
    destinationIsSymlink = stat.isSymbolicLink();
  } catch (err) {
    // ENOENT (or any not-exists shape) is the happy path; rethrow any
    // other error so a permission denial on the homedir surfaces.
    const code = getErrorCode(err);
    if (code !== "ENOENT") {
      throw err;
    }
  }

  if (destinationExists) {
    const normalisedSource = resolve(source);
    if (destinationIsSymlink) {
      const currentTarget = resolve(fs.readlinkSync(destination));
      if (currentTarget === normalisedSource) {
        logger.info(
          `[achilles] skill already installed at ${destination} (points at ${source}); nothing to do.`,
        );
        return { mode: "already-installed" };
      }
      if (!force) {
        throw new ExistingDestinationConflictError(
          `[achilles] Destination ${destination} already points to a different source (${currentTarget}); the requested source is ${source}. Pass --force to overwrite.`,
        );
      }
      fs.rmSync(destination, { recursive: true, force: true });
    } else {
      if (!force) {
        throw new ExistingDestinationConflictError(
          `[achilles] Destination ${destination} exists but is not a symlink; pass --force to overwrite (this will DELETE the existing path).`,
        );
      }
      fs.rmSync(destination, { recursive: true, force: true });
    }
  }

  // Step 3: try the symlink. On macOS / Linux this is the only path
  // that returns `mode: 'symlink'`; on Windows the catch below may
  // fall through to a copy.
  //
  // WR-01 (TOCTOU): two concurrent `achilles install-skill` invocations
  // (or a Claude Code skill-discovery scan racing the second call) can
  // both observe ENOENT on lstatSync and then both attempt symlinkSync.
  // When the second symlinkSync hits EEXIST, re-probe the destination —
  // if it now points at our requested source the install is idempotent
  // and we report `already-installed`; otherwise the race left a
  // genuinely-different link and we raise the conflict on the second
  // pass so the operator sees the same error they would have seen in
  // the non-racing case.
  try {
    fs.symlinkSync(source, destination, "dir");
    logger.info(
      `[achilles] skill symlinked at ${destination} -> ${source}`,
    );
    return { mode: "symlink" };
  } catch (err) {
    const code = getErrorCode(err);
    if (code === "EEXIST") {
      // A concurrent invocation linked the same destination between our
      // lstat probe and our symlink call. Re-probe to decide whether
      // the in-flight link is ours.
      try {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink()) {
          const currentTarget = resolve(fs.readlinkSync(destination));
          const normalisedSource = resolve(source);
          if (currentTarget === normalisedSource) {
            logger.info(
              `[achilles] skill already installed at ${destination} (linked by a concurrent install); nothing to do.`,
            );
            return { mode: "already-installed" };
          }
          if (!force) {
            throw new ExistingDestinationConflictError(
              `[achilles] Destination ${destination} was concurrently linked to a different source (${currentTarget}); the requested source is ${source}. Pass --force to overwrite.`,
            );
          }
        }
        // Concurrent invocation created a directory / file (or a
        // symlink we just decided to overwrite); fall through to the
        // SymlinkNotPermittedError below with EEXIST detail so the
        // caller sees the genuine race condition.
      } catch (probeErr) {
        // Re-probe itself failed; treat as the original EEXIST condition.
        // Conflict errors raised above are intentional and must
        // propagate.
        if (probeErr instanceof ExistingDestinationConflictError) {
          throw probeErr;
        }
        // Fall through to SymlinkNotPermittedError below.
      }
    }
    if (
      platform === "win32" &&
      code !== undefined &&
      WINDOWS_FALLBACK_CODES.has(code)
    ) {
      logger.warn(
        `[achilles] symlink not permitted on this Windows configuration (need admin or Developer Mode); falling back to a recursive copy. Future updates require re-running 'achilles install-skill'.`,
      );
      fs.cpSync(source, destination, { recursive: true });
      logger.info(`[achilles] skill copied to ${destination}`);
      return { mode: "copy" };
    }
    const detail =
      code ?? (err instanceof Error ? err.message : "unknown");
    throw new SymlinkNotPermittedError(
      `[achilles] Failed to create symlink at ${destination} -> ${source} on platform ${platform}: ${detail}.`,
    );
  }
}
