/**
 * Tests for the `achilles launch` command.
 *
 * Per Plan 13-01 Task 2 behaviour Tests LC1-LC3. The command is a pure
 * function over injected `locate` + `spawn` + `processExitImpl` +
 * `stderr.write` + `env` seams so the test never touches
 * node:child_process. The production wiring at apps/achilles-cli/src/cli.ts
 * binds `locate` to a closure that calls `locateElectronBinary` with the
 * real fs.existsSync + the runtime pkgRoot, `spawn` to
 * `node:child_process` spawn, `processExitImpl` to `(code) => process.exit(code)`,
 * and `env` to `process.env`.
 */

import { describe, expect, it, vi } from "vitest";
import { ElectronBinaryMissingError } from "../electron-binary-locator.js";
import { launchCommand } from "./launch.js";

type SpawnCall = {
  cmd: string;
  args: readonly string[];
  opts: Record<string, unknown>;
};

interface FakeDetachableChild {
  unref: () => void;
  pid: number;
  on(event: "error", cb: (err: Error) => void): void;
  /** Test seam — synthesises the spawned child's async 'error' event (WR-07). */
  fireError(err: Error): void;
}

const makeSpawnSpy = (options?: { throwOnSpawn?: Error }) => {
  const calls: SpawnCall[] = [];
  const unref = vi.fn();
  const children: FakeDetachableChild[] = [];
  const spawn = (
    cmd: string,
    args: readonly string[],
    opts: Record<string, unknown>,
  ): FakeDetachableChild => {
    calls.push({ cmd, args, opts });
    if (options?.throwOnSpawn) {
      throw options.throwOnSpawn;
    }
    const errorListeners: Array<(err: Error) => void> = [];
    const child: FakeDetachableChild = {
      unref,
      pid: 4242,
      on(event, cb): void {
        if (event === "error") {
          errorListeners.push(cb);
        }
      },
      fireError(err): void {
        for (const cb of errorListeners) cb(err);
      },
    };
    children.push(child);
    return child;
  };
  return { calls, spawn, unref, children };
};

describe("launchCommand", () => {
  it("LC1: happy path spawns the located Electron binary detached + stdio:ignore + unref + does not call processExitImpl", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;
    const { calls, spawn, unref } = makeSpawnSpy();
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

    launchCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe(binaryPath);
    expect(calls[0]?.args).toEqual([]);
    expect(calls[0]?.opts.detached).toBe(true);
    expect(calls[0]?.opts.stdio).toBe("ignore");
    expect(unref).toHaveBeenCalledTimes(1);
    expect(exitCode).toBeNull();
    expect(stderrWrites).toEqual([]);
  });

  it("LC2: locator throws ElectronBinaryMissingError → exit(1) + stderr line containing 'Electron binary not found' AND platform name; NO spawn call", () => {
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

    launchCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    expect(exitCode).toBe(1);
    const combined = stderrWrites.join("");
    expect(combined).toContain("Electron binary not found");
    expect(combined).toContain(platform);
    expect(calls).toHaveLength(0);
  });

  it("WR-07: spawn() throws synchronously (binary non-executable) — surfaces '[achilles] failed to spawn ...' and exits 1 without an unhandled exception", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;
    const throwErr = new Error("EACCES: permission denied");
    (throwErr as unknown as { code: string }).code = "EACCES";
    const { calls, spawn } = makeSpawnSpy({ throwOnSpawn: throwErr });
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

    expect(() =>
      launchCommand({
        locate,
        spawn,
        processExitImpl,
        stderr,
        env: {},
      }),
    ).not.toThrow();

    expect(exitCode).toBe(1);
    const combined = stderrWrites.join("");
    expect(combined).toContain("[achilles] failed to spawn Electron binary");
    expect(combined).toContain(binaryPath);
    expect(combined).toContain("EACCES");
    expect(calls).toHaveLength(1);
  });

  it("WR-07: async child 'error' event surfaces '[achilles] launch process error:' diagnostic without aborting the unref+exit path", () => {
    const binaryPath = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const locate = () => binaryPath;
    const { children, spawn, unref } = makeSpawnSpy();
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

    launchCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env: {},
    });

    // Confirm unref happened on the happy path.
    expect(unref).toHaveBeenCalledTimes(1);
    // Fire the async error event AFTER spawn returned.
    expect(children).toHaveLength(1);
    const asyncErr = new Error("EPIPE: broken pipe");
    children[0]!.fireError(asyncErr);
    const combined = stderrWrites.join("");
    expect(combined).toContain("[achilles] launch process error:");
    expect(combined).toContain("EPIPE");
    // The detached launch contract is "exit cleanly even if the child
    // dies later"; processExitImpl is NOT invoked from the error
    // listener.
    expect(exitCode).toBeNull();
  });

  it("WR-02: locate throws a non-ElectronBinaryMissingError (e.g. unsupported platform) — surfaces '[achilles] launch failed:' and exits 1 without an unhandled exception", () => {
    const locate = () => {
      throw new Error("Unsupported platform: aix");
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

    // Must NOT throw — the previous `throw err;` would have raised an
    // unhandled exception out of commander's action callback.
    expect(() =>
      launchCommand({
        locate,
        spawn,
        processExitImpl,
        stderr,
        env: {},
      }),
    ).not.toThrow();

    expect(exitCode).toBe(1);
    const combined = stderrWrites.join("");
    expect(combined).toContain("[achilles] launch failed:");
    expect(combined).toContain("Unsupported platform: aix");
    expect(calls).toHaveLength(0);
  });

  it("LC3: env passthrough — spawn opts.env equals the injected env object exactly", () => {
    const binaryPath = "/pkg/dist/Achilles.exe";
    const locate = () => binaryPath;
    const { calls, spawn } = makeSpawnSpy();
    const processExitImpl = (_code: number) => {};
    const stderr = {
      write: (_chunk: string) => true,
    };
    const env = { ACHILLES_MODE: "init", PATH: "/usr/bin" };

    launchCommand({
      locate,
      spawn,
      processExitImpl,
      stderr,
      env,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts.env).toEqual(env);
  });
});
