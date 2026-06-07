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

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  ElectronBinaryMissingError,
  locateElectronBinary,
} from "./electron-binary-locator.js";
import { launchCommand as realLaunchCommand } from "./commands/launch.js";
import { installSkillCommand as realInstallSkillCommand } from "./commands/install-skill.js";
import { initCommand as realInitCommand } from "./commands/init.js";
import { latencyCommand as realLatencyCommand } from "./commands/latency.js";
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
  /**
   * Plan 14-01: `achilles latency --report` handler. Production
   * wiring (bottom of this file) binds the seam to the real
   * latencyCommand from commands/latency.ts; tests pass a spy.
   *
   * The `report` boolean is the canonical commander option name; the
   * handler maps `true` → `"--report"` subcommand and `false` →
   * `""` (which the handler treats as the "Specify --report" error
   * path). This indirection keeps cli.ts agnostic of the latency.ts
   * argument-shape contract.
   */
  readonly latencyCommand: (opts: { readonly report: boolean }) => void;
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
/**
 * Compose the env override passed to `deps.launchCommand` when the
 * top-level `--debug` AND/OR `--save-transcripts` flags are present.
 * Inherits from `process.env` so the spawned Electron child receives
 * the operator's full environment plus the resolved env vars.
 * Returns `undefined` when BOTH flags are absent so the launch
 * command falls back to its default env binding (Plan 12-04 behaviour
 * preserved).
 *
 * The two flags COMPOSE — `achilles --debug --save-transcripts launch`
 * passes both `ACHILLES_DEBUG=1` AND `ACHILLES_SAVE_TRANSCRIPTS=1` to
 * the Electron child. main/index.ts reads each env var independently
 * (one wires the LatencyProbe; one wires the TranscriptStore).
 *
 * The function is exposed separately so the bare-invocation path
 * (`isBareInvocation === true`) and the explicit `launch` action use
 * the same code path — preventing a future refactor from silently
 * dropping a flag on one branch.
 */
function makeLaunchEnv(
  debug: boolean,
  saveTranscripts: boolean,
):
  | { readonly env: Readonly<Record<string, string | undefined>> }
  | undefined {
  if (!debug && !saveTranscripts) return undefined;
  const env: Record<string, string | undefined> = { ...process.env };
  if (debug) env.ACHILLES_DEBUG = "1";
  if (saveTranscripts) env.ACHILLES_SAVE_TRANSCRIPTS = "1";
  return { env };
}

function buildProgram(inputs: RunCliInputs): Command {
  const { stdout, stderr, processExitImpl, deps } = inputs;
  const program = new Command();
  program
    .name("achilles")
    .description("Achilles voice companion for Claude Code")
    .version(packageVersion)
    // Plan 14-01: top-level --debug flag enables the LOOP-06 latency
    // probe. When present, the launch action passes ACHILLES_DEBUG=1
    // through to the spawned Electron child; the main process reads
    // the env var at bootstrap and constructs the LatencyProbe. Absent
    // --debug, the env passthrough is unchanged so the probe is
    // unwired (Plan 12-04 behaviour preserved).
    .option("--debug", "Enable per-utterance LOOP-06 latency probe logging")
    // Plan 14-02: top-level --save-transcripts flag enables the SAFE-02
    // opt-in transcript persistence. When present, the launch action
    // passes ACHILLES_SAVE_TRANSCRIPTS=1 through to the spawned
    // Electron child; main reads the env var at bootstrap and
    // constructs the TranscriptStore. Composes with --debug — both
    // env vars can be set in the same launch.
    .option(
      "--save-transcripts",
      "Persist text transcripts to ~/.achilles/transcripts/ (SAFE-02 opt-in)",
    )
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
      const opts = program.opts() as {
        debug?: boolean;
        saveTranscripts?: boolean;
      };
      const debugOpt = opts.debug ?? false;
      const saveTranscriptsOpt = opts.saveTranscripts ?? false;
      deps.launchCommand(makeLaunchEnv(debugOpt, saveTranscriptsOpt));
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
      "Manage SAFE-02 transcript files: `purge` deletes all JSONL files; `list` enumerates them with line counts",
    )
    .action((sub: string) => {
      deps.transcriptsCommand(sub);
    });

  program
    .command("latency")
    .description("Print the LOOP-06 rolling-window P50 / P95 summary")
    .option(
      "--report",
      "Read the rolling-window JSON sample file and print P50 / P95",
    )
    .action((opts: { report?: boolean }) => {
      deps.latencyCommand({ report: opts.report ?? false });
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
  // npm-link / npm install -g installs the bin as a symlink; resolve
  // both sides via realpathSync so the comparison survives that.
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const canonicalEntry = realpathSync(resolve(entry));
    const canonicalHere = realpathSync(resolve(fileURLToPath(import.meta.url)));
    return canonicalEntry === canonicalHere;
  } catch {
    try {
      return resolve(entry) === resolve(fileURLToPath(import.meta.url));
    } catch {
      return false;
    }
  }
})();

if (invokedAsScript) {
  const productionDeps: CliDeps = {
    launchCommand: (overrides) =>
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
        // Plan 14-01: honour the optional env override so the
        // top-level --debug flag can inject ACHILLES_DEBUG=1 without
        // touching the launch command's signature.
        env: overrides?.env ?? process.env,
      }),
    installSkillCommand: (opts) =>
      realInstallSkillCommand({
        stdout: process.stdout,
        processExitImpl: (code) => process.exit(code),
        force: opts.force,
      }),
    initCommand: () =>
      realInitCommand({
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
    transcriptsCommand: (sub) =>
      realTranscriptsCommand(sub, {
        stdout: process.stdout,
        stderr: process.stderr,
        processExitImpl: (code) => process.exit(code),
        // Plan 14-02: the production transcripts directory mirrors the
        // main-side write path (`apps/achilles/src/main/index.ts`
        // writes JSONL files under `~/.achilles/transcripts/` via the
        // TranscriptStore's writeFileImpl seam). Both surfaces use the
        // same location so the offline subcommand does not need an
        // Electron IPC round-trip.
        dirPath: join(homedir(), ".achilles", "transcripts"),
        readDirImpl: (p) => readdirSync(p),
        statFileImpl: (p) => {
          const st = statSync(p);
          return { size: st.size, mtime: st.mtime };
        },
        deleteFileImpl: (p) => unlinkSync(p),
        readFileImpl: (p, enc) => readFileSync(p, enc),
      }),
    latencyCommand: (opts) =>
      realLatencyCommand({
        // Plan 14-01: the production sample file path mirrors the
        // main-side write path (`apps/achilles/src/main/index.ts`
        // writes to `~/.achilles/latency-samples.json` via the
        // LatencyProbe's writeFileImpl seam). Both surfaces use the
        // same path under the user's home dir so the offline subcommand
        // does not need an Electron IPC round-trip.
        subcommand: opts.report ? "--report" : "",
        reportPath: join(homedir(), ".achilles", "latency-samples.json"),
        readFileImpl: (p) => readFileSync(p, "utf8"),
        stdout: process.stdout,
        stderr: process.stderr,
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
