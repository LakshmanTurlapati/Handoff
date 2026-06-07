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

const makeSpawnSpy = () => {
  const calls: SpawnCall[] = [];
  const unref = vi.fn();
  const spawn = (
    cmd: string,
    args: readonly string[],
    opts: Record<string, unknown>,
  ): { unref: () => void; pid: number } => {
    calls.push({ cmd, args, opts });
    return { unref, pid: 4242 };
  };
  return { calls, spawn, unref };
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
