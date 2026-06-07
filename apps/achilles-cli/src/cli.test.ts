/**
 * Tests for the commander entrypoint surface.
 *
 * Per Plan 13-01 Task 2 behaviour Tests C1-C9. The CLI is exposed as
 * `runCli({ argv, stdout, stderr, processExitImpl, deps })` so tests
 * pass spies for every per-command handler (launchCommand,
 * installSkillCommand, initCommand, transcriptsCommand). The default
 * action (no subcommand) routes to launchCommand. The version string is
 * read from package.json at module load — tests assert it matches the
 * package.json value at runtime so a future version bump cannot drift
 * the CLI's `--version` output.
 *
 * C9 (shebang) is a file-level assertion: cli.ts must begin with the
 * literal `#!/usr/bin/env node` line so `tsc --preserveValueImports`
 * keeps the shebang and `npm install -g achilles` on Linux/macOS finds
 * the interpreter without a wrapper.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli, type CliDeps } from "./cli.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(HERE, "..", "package.json"), "utf8"),
).version as string;

type WriteSeam = { write: (chunk: string) => boolean };

const makeStreamSpy = (): {
  seam: WriteSeam;
  chunks: string[];
} => {
  const chunks: string[] = [];
  return {
    seam: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
};

const makeDepsWithSpies = () => {
  const launchCommand = vi.fn();
  const installSkillCommand = vi.fn();
  const initCommand = vi.fn();
  const transcriptsCommand = vi.fn();
  const deps: CliDeps = {
    launchCommand,
    installSkillCommand,
    initCommand,
    transcriptsCommand,
  };
  return { deps, launchCommand, installSkillCommand, initCommand, transcriptsCommand };
};

describe("runCli", () => {
  it("C1: --version writes the package.json version to stdout AND calls processExitImpl(0)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
      throw new Error(`__EXIT_${code}__`); // commander writes then calls exit synchronously
    };
    const { deps } = makeDepsWithSpies();

    try {
      runCli({
        argv: ["node", "achilles", "--version"],
        stdout: stdout.seam,
        stderr: stderr.seam,
        processExitImpl,
        deps,
      });
    } catch (err) {
      // commander throws after exit; swallow only the synthetic exit sentinel
      if (!(err instanceof Error) || !err.message.startsWith("__EXIT_")) throw err;
    }

    const combined = stdout.chunks.join("");
    expect(combined).toContain(PACKAGE_VERSION);
    expect(exitCode).toBe(0);
  });

  it("C2: --help lists launch, install-skill, init, transcripts", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (code: number) => {
      throw new Error(`__EXIT_${code}__`);
    };
    const { deps } = makeDepsWithSpies();

    try {
      runCli({
        argv: ["node", "achilles", "--help"],
        stdout: stdout.seam,
        stderr: stderr.seam,
        processExitImpl,
        deps,
      });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("__EXIT_")) throw err;
    }

    const combined = stdout.chunks.join("");
    expect(combined).toContain("launch");
    expect(combined).toContain("install-skill");
    expect(combined).toContain("init");
    expect(combined).toContain("transcripts");
  });

  it("C3: no-args defaults to launchCommand (called exactly once)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (_code: number) => {};
    const { deps, launchCommand } = makeDepsWithSpies();

    runCli({
      argv: ["node", "achilles"],
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl,
      deps,
    });

    expect(launchCommand).toHaveBeenCalledTimes(1);
  });

  it("C4: explicit `launch` routes to launchCommand (called exactly once)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (_code: number) => {};
    const { deps, launchCommand } = makeDepsWithSpies();

    runCli({
      argv: ["node", "achilles", "launch"],
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl,
      deps,
    });

    expect(launchCommand).toHaveBeenCalledTimes(1);
  });

  it("C5: `install-skill` routes to installSkillCommand (called exactly once)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (_code: number) => {};
    const { deps, installSkillCommand } = makeDepsWithSpies();

    runCli({
      argv: ["node", "achilles", "install-skill"],
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl,
      deps,
    });

    expect(installSkillCommand).toHaveBeenCalledTimes(1);
  });

  it("C6: `init` routes to initCommand (called exactly once)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (_code: number) => {};
    const { deps, initCommand } = makeDepsWithSpies();

    runCli({
      argv: ["node", "achilles", "init"],
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl,
      deps,
    });

    expect(initCommand).toHaveBeenCalledTimes(1);
  });

  it("C7: `transcripts purge` routes to transcriptsCommand with first arg 'purge'", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    const processExitImpl = (_code: number) => {};
    const { deps, transcriptsCommand } = makeDepsWithSpies();

    runCli({
      argv: ["node", "achilles", "transcripts", "purge"],
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl,
      deps,
    });

    expect(transcriptsCommand).toHaveBeenCalledTimes(1);
    expect(transcriptsCommand.mock.calls[0]?.[0]).toBe("purge");
  });

  it("C8: unknown command writes a commander 'unknown command' error to stderr AND calls processExitImpl(1)", () => {
    const stdout = makeStreamSpy();
    const stderr = makeStreamSpy();
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
      throw new Error(`__EXIT_${code}__`);
    };
    const { deps } = makeDepsWithSpies();

    try {
      runCli({
        argv: ["node", "achilles", "nonexistent"],
        stdout: stdout.seam,
        stderr: stderr.seam,
        processExitImpl,
        deps,
      });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("__EXIT_")) throw err;
    }

    const combined = stderr.chunks.join("");
    expect(combined.toLowerCase()).toContain("unknown command");
    expect(exitCode).toBe(1);
  });

  it("C9: cli.ts begins with the literal shebang `#!/usr/bin/env node`", () => {
    const cliPath = resolve(HERE, "cli.ts");
    const firstLine = readFileSync(cliPath, "utf8").split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});
