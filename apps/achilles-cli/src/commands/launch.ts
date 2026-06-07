/**
 * `achilles launch` command — opens the floating voice UI.
 *
 * The command locates the bundled Electron binary via the injected
 * `locate` seam, spawns it detached + stdio:ignore so the parent (the
 * CLI) does not wait on the GUI process, calls `child.unref()` so the
 * Node event loop drains and the CLI exits naturally with code 0, and
 * passes the injected `env` through to the spawned child untouched.
 *
 * On `ElectronBinaryMissingError` (the platform is supported but the
 * binary is missing — e.g., `npm install` was not run), the command
 * writes a remediation line to the injected `stderr.write` seam and
 * calls `processExitImpl(1)`. The diagnostic names the platform and
 * expected path; it does NOT read or interpolate environment variables
 * (threat model T-13-02 — information disclosure).
 *
 * Plan 13-01 Test LC1 pins the happy path; LC2 pins the missing-binary
 * surface; LC3 pins env passthrough. The CLI entrypoint
 * `apps/achilles-cli/src/cli.ts` binds the seams to:
 *
 *   - locate:           () => locateElectronBinary({ pkgRoot, platform: process.platform, fileExistsAt: fs.existsSync })
 *   - spawn:            (cmd, args, opts) => childProcess.spawn(cmd, args, opts)
 *   - processExitImpl:  (code) => process.exit(code)
 *   - stderr:           process.stderr
 *   - env:              process.env
 *
 * The `env` seam (LC3) is what Plan 13-03 uses to route `init` mode to
 * the wizard via `ACHILLES_MODE=init`; the contract is "spawn the
 * Electron child with this env object verbatim". The CLI is responsible
 * for composing the right env before calling launchCommand.
 */

import { ElectronBinaryMissingError } from "../electron-binary-locator.js";

/**
 * Subset of `node:child_process` ChildProcess that launchCommand
 * touches. The spawned Electron child is detached + ignored stdio; we
 * never read stdout/stderr from it and we never wait on its exit.
 *
 * WR-07 fix: extended with `on('error', ...)` so an async spawn error
 * (the binary became inaccessible between resolve and spawn, or
 * permissions changed) surfaces a typed diagnostic instead of an
 * unhandled rejection. The synchronous failure path is handled by a
 * try/catch around the spawn() call itself.
 *
 * @public
 */
export interface DetachableChild {
  readonly pid?: number;
  unref(): void;
  on(event: "error", cb: (err: Error) => void): void;
}

/**
 * Subset of `node:child_process` spawn options that launchCommand sets.
 * The injected spawn seam receives these verbatim.
 *
 * Note: `stdio` is narrowed to the literal `"ignore"` because that is
 * the only value launchCommand sets. The detached spawn does not share
 * stdin/stdout/stderr with the parent CLI — the parent exits naturally
 * once `child.unref()` is called and the event loop drains. A wider
 * union would be over-engineered for a single call site and triggers
 * variance friction against `node:child_process` SpawnOptions
 * (`StdioOptions` is a mutable array union).
 *
 * @public
 */
export interface DetachedSpawnOptions {
  readonly detached: boolean;
  readonly stdio: "ignore";
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Subset of `node:stream` Writable that launchCommand writes to.
 * Captured here so the test seam can be a plain `{ write }` object
 * without pulling in node:stream types.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Spawn function shape — narrow contract over `node:child_process`
 * `spawn(command, args, options)`. The launchCommand never reads
 * stdout/stderr from the returned child; it only calls `unref()`.
 *
 * @public
 */
export type DetachedSpawn = (
  command: string,
  args: readonly string[],
  options: DetachedSpawnOptions,
) => DetachableChild;

/**
 * Injected dependencies for launchCommand. All five seams are required
 * so tests have no global mutable state to manage.
 *
 * @public
 */
export interface LaunchDeps {
  readonly locate: () => string;
  readonly spawn: DetachedSpawn;
  readonly processExitImpl: (code: number) => void;
  readonly stderr: WritableSeam;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Open the floating Achilles voice UI by spawning the bundled Electron
 * binary as a detached child. On missing binary, writes a stderr
 * remediation line and exits 1.
 *
 * Return value: void on success (Node exits naturally with code 0 after
 * the event loop drains); also void on the missing-binary path
 * (processExitImpl is called from inside the catch).
 *
 * @public
 */
export function launchCommand(deps: LaunchDeps): void {
  const { locate, spawn, processExitImpl, stderr, env } = deps;
  let binaryPath: string;
  try {
    binaryPath = locate();
  } catch (err) {
    if (err instanceof ElectronBinaryMissingError) {
      stderr.write(`[achilles] ${err.message}\n`);
      processExitImpl(1);
      return;
    }
    // WR-02 fix: same rationale as in init.ts — locator threw something
    // other than ElectronBinaryMissingError (e.g. "Unsupported platform:
    // aix"). The previous `throw err;` surfaced an unhandled exception
    // because cli.ts's commander action callback has no top-level
    // try/catch. Surface a typed `[achilles] launch failed: ...` line
    // and exit 1 cleanly.
    const detail = err instanceof Error ? err.message : String(err);
    stderr.write(`[achilles] launch failed: ${detail}\n`);
    processExitImpl(1);
    return;
  }
  // WR-07 fix: wrap spawn() in try/catch so a non-executable binary,
  // a path that resolves to a directory, or an invalid options shape
  // surfaces a typed `[achilles] failed to spawn ...` line instead of
  // an unhandled exception. The synchronous throw path bites because
  // Node spawn raises EACCES / EISDIR / ENOENT on the binary itself
  // synchronously.
  let child: DetachableChild;
  try {
    child = spawn(binaryPath, [], {
      detached: true,
      stdio: "ignore",
      env,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    stderr.write(
      `[achilles] failed to spawn Electron binary at ${binaryPath}: ${detail}\n`,
    );
    processExitImpl(1);
    return;
  }
  // WR-07 fix: wire an async 'error' listener for the case where spawn
  // returns a child that subsequently fails (e.g. the binary
  // disappears between spawn return and exec). The listener surfaces a
  // diagnostic; processExitImpl is not invoked here because the
  // detached launch contract is "exit cleanly even if the child died
  // later" — but if the child errors BEFORE we unref, the listener
  // gives the operator a breadcrumb.
  child.on("error", (err: Error) => {
    stderr.write(
      `[achilles] launch process error: ${err.message}\n`,
    );
  });
  child.unref();
}
