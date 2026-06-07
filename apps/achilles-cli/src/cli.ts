#!/usr/bin/env node
/**
 * `achilles` — commander-based CLI entrypoint for the npm package.
 *
 * Plan 13-01 ships the routing surface for four top-level commands
 * (launch / install-skill / init / transcripts <subcommand>) and the
 * no-arg default (defaults to launch). The version string is read
 * dynamically from package.json at module load so a future version
 * bump cannot drift the CLI's `--version` output.
 *
 * Per-command handlers are injected through the `CliDeps` seam so the
 * commander wiring tests (C1-C9) can pass spies without invoking the
 * real Electron spawn or the placeholder install-skill / init
 * implementations. The production wiring at the bottom of the file
 * (gated by an `import.meta.url === argv-script` check) binds the
 * seams to the real handlers + `process.argv` + `process.stdout` +
 * `process.stderr` + `process.exit`.
 *
 * Why injected handlers instead of direct imports inside the commander
 * actions: Plan 13-02 (install-skill) and Plan 13-03 (init) REPLACE
 * their respective placeholder modules; the import path in this file
 * does NOT change between waves. The placeholders own the
 * `[achilles] install-skill: placeholder — Plan 13-02 implements this`
 * surface; the wave-N replacement swaps the body without touching the
 * cli.ts route table.
 */

import { readFileSync, existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import {
  ElectronBinaryMissingError,
  locateElectronBinary,
} from "./electron-binary-locator.js";
import { launchCommand as realLaunchCommand } from "./commands/launch.js";
import { installSkillCommand as realInstallSkillCommand } from "./commands/install-skill.js";
import { initCommand as realInitCommand } from "./commands/init.js";
import { transcriptsCommand as realTranscriptsCommand } from "./commands/transcripts.js";

/**
 * Subset of `node:stream` Writable shape used by runCli. The commander
 * library writes to streams via `.write`; the seam accepts the same
 * minimal shape so tests can substitute a plain `{ write }` object.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Per-command handlers injected into the commander action callbacks.
 * The CLI never imports the implementations directly from inside an
 * action body — the commander program holds a reference to the
 * deps object captured at runCli() time. This keeps the route table
 * stable across Plan 13-02 / 13-03 placeholder replacements.
 *
 * @public
 */
export interface CliDeps {
  readonly launchCommand: (overrides?: { readonly env?: Readonly<Record<string, string | undefined>> }) => void;
  readonly installSkillCommand: (opts: { readonly force: boolean }) => void;
  readonly initCommand: () => void;
  readonly transcriptsCommand: (subcommand: string) => void;
}

/**
 * Inputs to runCli — the testable seam.
 *
 * @public
 */
export interface RunCliInputs {
  readonly argv: readonly string[];
  readonly stdout: WritableSeam;
  readonly stderr: WritableSeam;
  readonly processExitImpl: (code: number) => void;
  readonly deps: CliDeps;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Read the package version from package.json. Resolved relative to the
 * compiled artifact's location so both the source-loaded (Vitest) and
 * dist-loaded (production) entrypoints find the same file.
 *
 * Layout:
 *   - Vitest source path:    apps/achilles-cli/src/cli.ts -> ../package.json
 *   - Production dist path:  apps/achilles-cli/dist/cli.js -> ../package.json
 *
 * Both walk one directory up from `HERE`.
 */
const packageJsonPath = resolve(HERE, "..", "package.json");
const packageVersion: string = JSON.parse(
  readFileSync(packageJsonPath, "utf8"),
).version as string;

/**
 * Build a commander Program wired to the injected deps + stdout/stderr
 * seams + processExitImpl. The program is rebuilt on every runCli
 * invocation because commander state (parsed args, error output
 * targets) is captured per-instance.
 */
function buildProgram(inputs: RunCliInputs): Command {
  const { stdout, stderr, processExitImpl, deps } = inputs;
  const program = new Command();
  program
    .name("achilles")
    .description("Achilles voice companion for Claude Code")
    .version(packageVersion)
    // Route commander's output to the injected stdout/stderr seams so
    // tests can capture --version / --help / error messages without
    // touching process.stdout / process.stderr.
    .configureOutput({
      writeOut: (str) => stdout.write(str),
      writeErr: (str) => stderr.write(str),
      outputError: (str, write) => write(str),
    })
    // Route commander's `exit` through the seam too. The default
    // behaviour calls `process.exit` synchronously; the seam lets tests
    // capture the exit code without terminating the test runner.
    .exitOverride((err) => {
      // Commander's CommanderError carries the exit code on `err.exitCode`.
      // For the --version / --help paths the code is 0; for unknown
      // commands and argument validation errors it is 1.
      processExitImpl(err.exitCode);
      // Throw the same error so the synchronous test harness can swallow
      // it (the production main path never catches because process.exit
      // terminates the runtime before commander's internal throw lands).
      throw err;
    });

  program
    .command("launch")
    .description("Open the floating Achilles UI")
    .action(() => {
      deps.launchCommand();
    });

  program
    .command("install-skill")
    .description("Install the Achilles Claude Code skill")
    .option("--force", "Overwrite existing skill destination")
    .action((opts: { force?: boolean }) => {
      deps.installSkillCommand({ force: opts.force ?? false });
    });

  program
    .command("init")
    .description(
      "Run the first-run wizard (API key, mic permission, smoke test)",
    )
    .action(() => {
      deps.initCommand();
    });

  program
    .command("transcripts <subcommand>")
    .description(
      "Manage transcript persistence (Phase 14 — currently `purge` is a stub)",
    )
    .action((sub: string) => {
      deps.transcriptsCommand(sub);
    });

  return program;
}

/**
 * Detect the "no-arg invocation" case so the default action can route
 * to launch WITHOUT registering a `program.action()` (registering one
 * makes commander treat `achilles nonexistent` as "default action with
 * extra positional arg" and emit "too many arguments" instead of the
 * correct "unknown command" — see Plan 13-01 Test C8).
 *
 * argv shape (per commander `from: "node"` convention):
 *   [0] node interpreter or script wrapper
 *   [1] script path (or "achilles" when invoked from the bin shim)
 *   [2..] command arguments — empty in the no-arg case
 *
 * The function returns true when argv length is exactly 2 — i.e., the
 * user typed `achilles` and nothing else.
 */
function isBareInvocation(argv: readonly string[]): boolean {
  return argv.length === 2;
}

/**
 * Entrypoint. Builds a commander program against the injected seams,
 * parses argv, and lets commander dispatch to the action callbacks.
 *
 * Special-cased default: a bare `achilles` invocation (no subcommand,
 * no flags) routes directly to `deps.launchCommand()` without going
 * through commander at all. This keeps `achilles nonexistent` reachable
 * to commander's unknown-command handler (which writes "unknown
 * command" to stderr and exits 1).
 *
 * On --version / --help / unknown-command paths, commander calls the
 * configured `exitOverride` which routes through processExitImpl. The
 * production bottom-of-file binding lets the synchronous throw escape
 * so the Node process terminates with the right code; tests catch the
 * synthetic exit sentinel.
 *
 * @public
 */
export function runCli(inputs: RunCliInputs): void {
  if (isBareInvocation(inputs.argv)) {
    inputs.deps.launchCommand();
    return;
  }
  const program = buildProgram(inputs);
  program.parse(inputs.argv, { from: "node" });
}

/**
 * Production wiring. Only runs when this module is the entrypoint of
 * the Node process — i.e., the published `dist/cli.js` is invoked as
 * `achilles` via the `bin` shim. Vitest imports cli.ts as a module,
 * never as the entrypoint, so the guard keeps the body inert under
 * test.
 */
const invokedAsScript = (() => {
  // `process.argv[1]` is the absolute path of the script the Node
  // runtime was launched with. Compare against this module's file URL
  // to detect entrypoint mode without invoking commander on import.
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  const productionDeps: CliDeps = {
    launchCommand: () =>
      realLaunchCommand({
        locate: () =>
          locateElectronBinary({
            pkgRoot: resolve(HERE, ".."),
            platform: process.platform,
            fileExistsAt: existsSync,
          }),
        spawn: (cmd, args, opts) => nodeSpawn(cmd, [...args], opts),
        processExitImpl: (code) => process.exit(code),
        stderr: process.stderr,
        env: process.env,
      }),
    installSkillCommand: (opts) =>
      realInstallSkillCommand({
        stdout: process.stdout,
        processExitImpl: (code) => process.exit(code),
        force: opts.force,
      }),
    initCommand: () =>
      realInitCommand({
        stdout: process.stdout,
        processExitImpl: (code) => process.exit(code),
      }),
    transcriptsCommand: (sub) =>
      realTranscriptsCommand(sub, {
        stdout: process.stdout,
        processExitImpl: (code) => process.exit(code),
      }),
  };
  try {
    runCli({
      argv: process.argv,
      stdout: process.stdout,
      stderr: process.stderr,
      processExitImpl: (code) => process.exit(code),
      deps: productionDeps,
    });
  } catch (err) {
    // Commander throws the exitOverride sentinel for --version / --help /
    // unknown-command paths. processExitImpl has already been called by
    // the override, so the process is already terminating; swallow the
    // sentinel so it does not surface as an uncaught exception. Any
    // other error escapes normally.
    const isCommanderExit =
      err !== null && typeof err === "object" && "exitCode" in (err as object);
    if (!isCommanderExit) throw err;
  }
}

// Re-export the ElectronBinaryMissingError so consumers (future Plan
// 13-04 verifier) can import the typed error without reaching into the
// locator module.
export { ElectronBinaryMissingError };
