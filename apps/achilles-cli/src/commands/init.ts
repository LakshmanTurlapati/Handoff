/**
 * `achilles init` — Plan 13-03 implementation (DIST-04).
 *
 * Spawns the bundled Electron binary with `ACHILLES_MODE=init` in the
 * env so main/index.ts routes its bootstrap to the InitWizard window
 * instead of the floating shell. Unlike the `launch` command, this
 * spawn is NOT detached — the CLI process blocks on the wizard's exit
 * code so the user's terminal reflects the wizard's success/failure
 * disposition (DIST-04 contract: `achilles init` exits with the same
 * code the wizard exits with).
 *
 * Why ACHILLES_MODE in the env rather than a CLI arg:
 *
 *   - The Electron binary's argv is consumed by Electron itself
 *     (--enable-features, --no-sandbox, etc.); passing a custom arg
 *     would force main/index.ts to filter argv against a known list.
 *   - The env var crosses the spawn boundary cleanly and is the
 *     established pattern (MOCK_LOOP=1, ELECTRON_RENDERER_URL etc.).
 *   - Pitfall #3 (macOS TCC) — the env var routes the wizard's mic
 *     prompt INSIDE the Electron host, not in the launching terminal.
 *
 * On ElectronBinaryMissingError (the platform is supported but the
 * binary is absent), the command writes a stderr remediation line that
 * names both "Electron binary not found" and "npm install -g achilles"
 * (Plan 13-03 C4) and exits 1.
 *
 * NO emoji (CLAUDE.md global). NO direct env mutation — the child env
 * is a fresh object built from a spread of the supplied env.
 */

import { ElectronBinaryMissingError } from "../electron-binary-locator.js";

/**
 * Subset of `node:child_process` ChildProcess that initCommand touches.
 * The wizard's spawn is attached + stdio:inherit so the user sees any
 * console output from the wizard; the CLI process waits on the exit
 * event before invoking processExitImpl with the propagated code.
 *
 * @public
 */
export interface AttachedChild {
  readonly pid?: number;
  on(event: "exit", cb: (code: number | null) => void): void;
}

/**
 * Subset of `node:child_process` spawn options that initCommand sets.
 * The injected spawn seam receives these verbatim. Differs from
 * launch.ts's DetachedSpawnOptions:
 *
 *   - detached: false (CLI blocks on wizard exit)
 *   - stdio: 'inherit' (user sees any wizard console output)
 *   - env: a fresh object with ACHILLES_MODE='init' overlaid
 *
 * @public
 */
export interface AttachedSpawnOptions {
  readonly detached: false;
  readonly stdio: "inherit";
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Subset of `node:stream` Writable that initCommand writes to.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Spawn function shape — narrow contract over `node:child_process`
 * `spawn(command, args, options)`. The initCommand reads exit-code
 * propagation via child.on('exit', ...).
 *
 * @public
 */
export type AttachedSpawn = (
  command: string,
  args: readonly string[],
  options: AttachedSpawnOptions,
) => AttachedChild;

/**
 * Injected dependencies for initCommand. All five seams are required
 * so tests have no global mutable state to manage.
 *
 * @public
 */
export interface InitDeps {
  readonly locate: () => string;
  readonly spawn: AttachedSpawn;
  readonly processExitImpl: (code: number) => void;
  readonly stderr: WritableSeam;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Open the first-run wizard by spawning the bundled Electron binary
 * with ACHILLES_MODE=init in the env. The CLI process blocks on the
 * wizard's exit code (NOT detached) so terminal feedback reflects the
 * wizard's success/failure.
 *
 * Return value: void on the immediate path (the CLI process is still
 * alive, waiting on the child's exit event); processExitImpl is called
 * from the exit listener after the wizard has terminated.
 *
 * @public
 */
export function initCommand(deps: InitDeps): void {
  const { locate, spawn, processExitImpl, stderr, env } = deps;
  let binaryPath: string;
  try {
    binaryPath = locate();
  } catch (err) {
    if (err instanceof ElectronBinaryMissingError) {
      // Plan 13-03 C4: the remediation line must name both the
      // immediate failure and the install command. The locator's
      // own err.message already includes platform + path; the second
      // line surfaces the actionable command.
      stderr.write(`[achilles] Electron binary not found for the init wizard.\n`);
      stderr.write(`[achilles] ${err.message}\n`);
      stderr.write(
        `[achilles] Run \`npm install -g achilles\` to repair the install.\n`,
      );
      processExitImpl(1);
      return;
    }
    // WR-02 fix: locator threw something other than
    // ElectronBinaryMissingError (e.g. "Unsupported platform: aix" from
    // electron-binary-locator.ts). The previous `throw err;` here
    // surfaced an unhandled exception with a raw Node stack trace
    // because cli.ts's commander action callback has no top-level
    // try/catch. Surface a typed `[achilles] init failed: ...` line
    // and exit 1 cleanly so the user on an unsupported platform sees a
    // diagnostic message rather than the V8 crash trace.
    const detail = err instanceof Error ? err.message : String(err);
    stderr.write(`[achilles] init failed: ${detail}\n`);
    processExitImpl(1);
    return;
  }

  // Build the child env. The supplied env is read-only; the spread
  // produces a fresh object that ACHILLES_MODE is overlaid onto. This
  // preserves PATH, HOME, USER, ELEVENLABS_API_KEY (if set as a power-user
  // fallback), and every other inherited variable.
  const childEnv: Record<string, string | undefined> = {
    ...env,
    ACHILLES_MODE: "init",
  };

  const child = spawn(binaryPath, [], {
    detached: false,
    stdio: "inherit",
    env: childEnv,
  });

  // Propagate the wizard's exit code. The contract is: CLI exits with
  // 0 when the wizard signalled success (markWizardDone → app.quit()),
  // and with whatever non-zero code the wizard emitted otherwise. A
  // null/undefined exit code (the child was killed by a signal before
  // surfacing a code) maps to 1 as a defensive default.
  child.on("exit", (code: number | null) => {
    processExitImpl(code ?? 1);
  });
}
