/**
 * Tests for the `achilles init` command.
 *
 * Per Plan 13-03 Task 1 behaviour Tests C1-C4. The command is a pure
 * function over injected `locate` + `spawn` + `processExitImpl` +
 * `stderr.write` + `env` seams so the test never touches
 * node:child_process. Mirrors the launch.test.ts shape from Plan 13-01.
 *
 *   - C1: env-var injection — ACHILLES_MODE='init' is present in the
 *     spawned child's env; PATH (and any other supplied env entries)
 *     are preserved verbatim.
 *   - C2: NOT detached — opts.detached is false (or unset). The CLI
 *     blocks on the wizard exit code per the DIST-04 contract.
 *   - C3: exit-code propagation — when the spawned child fires its
 *     'exit' event with code N, the command invokes processExitImpl(N).
 *   - C4: missing-binary remediation — when locate throws
 *     ElectronBinaryMissingError, the command writes a stderr line
 *     naming both "Electron binary not found" and "npm install -g
 *     achilles", then calls processExitImpl(1).
 */

import { describe, expect, it, vi } from "vitest";

import { ElectronBinaryMissingError } from "../electron-binary-locator.js";
import { initCommand } from "./init.js";

type SpawnCall = {
  cmd: string;
  args: readonly string[];
  opts: Record<string, unknown>;
};

interface AttachedChild {
  readonly pid: number;
  on(event: "exit", cb: (code: number | null) => void): void;
  /** Test seam — synthesises the spawned child's exit event. */
  fireExit(code: number | null): void;
}

const makeSpawnSpy = () => {
  const calls: SpawnCall[] = [];
  const children: AttachedChild[] = [];
  const spawn = (
    cmd: string,
    args: readonly string[],
    opts: Record<string, unknown>,
  ): AttachedChild => {
    calls.push({ cmd, args, opts });
    const exitListeners: Array<(code: number | null) => void> = [];
    const child: AttachedChild = {
      pid: 4242,
      on(event, cb): void {
        if (event === "exit") {
          exitListeners.push(cb);
        }
      },
      fireExit(code): void {
        for (const cb of exitListeners) cb(code);
      },
    };
    children.push(child);
    return child;
  };
  return { calls, spawn, children };
};

describe("initCommand", () => {
  it("C1: env-var injection — ACHILLES_MODE='init' is present in child env; supplied PATH is preserved verbatim", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;
    const { calls, spawn } = makeSpawnSpy();
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
    };
    const stderrWrites: string[] = [];
    const stderr = {
      write: (chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      },
    };
    const env = { PATH: "/usr/bin", HOME: "/home/alice" };

    initCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe(binaryPath);
    expect(calls[0]?.args).toEqual([]);
    const childEnv = calls[0]?.opts.env as Record<string, string | undefined>;
    expect(childEnv).toBeTruthy();
    expect(childEnv.ACHILLES_MODE).toBe("init");
    expect(childEnv.PATH).toBe("/usr/bin");
    expect(childEnv.HOME).toBe("/home/alice");
    expect(exitCode).toBeNull();
    expect(stderrWrites).toEqual([]);
  });

  it("C2: spawn is NOT detached (opts.detached is false or unset) and stdio is 'inherit'", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;
    const { calls, spawn } = makeSpawnSpy();
    const processExitImpl = (_code: number) => undefined;
    const stderr = { write: (_chunk: string) => true };

    initCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    expect(calls).toHaveLength(1);
    const opts = calls[0]!.opts;
    // detached must be falsy (the contract is "CLI blocks on wizard exit").
    expect(opts.detached === false || opts.detached === undefined).toBe(true);
    // stdio is 'inherit' so the user sees any console output from the wizard.
    expect(opts.stdio).toBe("inherit");
  });

  it("C3: propagates the child's exit code through processExitImpl (code 0 → 0; code 7 → 7)", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;

    {
      const { children, spawn } = makeSpawnSpy();
      let exitCode: number | null = null;
      const processExitImpl = (code: number) => {
        exitCode = code;
      };
      const stderr = { write: (_chunk: string) => true };
      initCommand({
        locate,
        spawn,
        processExitImpl,
        stderr,
        env: {},
      });
      children[0]!.fireExit(0);
      expect(exitCode).toBe(0);
    }

    {
      const { children, spawn } = makeSpawnSpy();
      let exitCode: number | null = null;
      const processExitImpl = (code: number) => {
        exitCode = code;
      };
      const stderr = { write: (_chunk: string) => true };
      initCommand({
        locate,
        spawn,
        processExitImpl,
        stderr,
        env: {},
      });
      children[0]!.fireExit(7);
      expect(exitCode).toBe(7);
    }

    // null/undefined exit code maps to 1 (defence in depth).
    {
      const { children, spawn } = makeSpawnSpy();
      let exitCode: number | null = null;
      const processExitImpl = (code: number) => {
        exitCode = code;
      };
      const stderr = { write: (_chunk: string) => true };
      initCommand({
        locate,
        spawn,
        processExitImpl,
        stderr,
        env: {},
      });
      children[0]!.fireExit(null);
      expect(exitCode).toBe(1);
    }
  });

  it("C4: missing binary surfaces 'Electron binary not found' AND 'npm install -g achilles' and calls processExitImpl(1); no spawn", () => {
    const platform = process.platform;
    const locate = () => {
      throw new ElectronBinaryMissingError(
        `Electron binary not found for platform ${platform} at /pkg/dist/missing`,
      );
    };
    const { calls, spawn } = makeSpawnSpy();
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
    };
    const stderrWrites: string[] = [];
    const stderr = {
      write: (chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      },
    };

    initCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    expect(exitCode).toBe(1);
    const combined = stderrWrites.join("");
    expect(combined).toContain("Electron binary not found");
    expect(combined).toContain("npm install -g achilles");
    expect(calls).toHaveLength(0);
  });

  it("does not mutate the supplied env object (spread, not assign)", () => {
    const binaryPath = "/pkg/dist/Achilles.exe";
    const locate = () => binaryPath;
    const { spawn } = makeSpawnSpy();
    const processExitImpl = (_code: number) => undefined;
    const stderr = { write: (_chunk: string) => true };
    const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
    const beforeKeys = Object.keys(env).sort();

    initCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env,
    });

    const afterKeys = Object.keys(env).sort();
    expect(afterKeys).toEqual(beforeKeys);
    expect(env.ACHILLES_MODE).toBeUndefined();
  });

  it("zero emojis in any stderr surface (CLAUDE.md global)", () => {
    const locate = () => {
      throw new ElectronBinaryMissingError(
        "Electron binary not found for platform darwin at /pkg/dist/missing",
      );
    };
    const { spawn } = makeSpawnSpy();
    const processExitImpl = vi.fn();
    const stderrWrites: string[] = [];
    const stderr = {
      write: (chunk: string) => {
        stderrWrites.push(chunk);
        return true;
      },
    };

    initCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    for (const line of stderrWrites) {
      expect(/\p{Extended_Pictographic}/u.test(line)).toBe(false);
    }
  });
});
