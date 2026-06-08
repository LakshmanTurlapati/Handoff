/**
 * Phase 18, Plan 02, Task 1 — RED tests for install-suggestions.ts
 *
 * Tests for suggestInstallCommand + invokePackageManager.
 * All tests inject the execImpl seam — no real package manager invoked.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import {
  suggestInstallCommand,
  invokePackageManager,
  type InvokeDeps,
} from "../../src/init/install-suggestions.js";

type SpawnImplFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => ChildProcess;

/** Build a fake ChildProcess that exits with exitCode after processing. */
function makeFakeInvokeProc(exitCode: number, stderrData: string): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  const stderrEe = new EventEmitter();
  (ee as unknown as Record<string, unknown>)["stderr"] = stderrEe;
  (ee as unknown as Record<string, unknown>)["stdout"] = null;
  (ee as unknown as Record<string, unknown>)["stdin"] = null;
  process.nextTick(() => {
    stderrEe.emit("data", Buffer.from(stderrData));
    (ee as unknown as EventEmitter).emit("exit", exitCode, null);
  });
  return ee;
}

describe("suggestInstallCommand — darwin single missing", () => {
  it("returns 'brew install sox' for darwin + ['sox']", () => {
    const result = suggestInstallCommand("darwin", ["sox"], {
      execImpl: () => "/usr/local/bin/brew",
    });
    expect(result.cmd).toBe("brew install sox");
    expect(result.canAutoInvoke).toBe(true);
  });
});

describe("suggestInstallCommand — darwin multiple missing", () => {
  it("returns 'brew install sox ffmpeg' for darwin + ['sox', 'ffmpeg']", () => {
    const result = suggestInstallCommand("darwin", ["sox", "ffmpeg"], {
      execImpl: () => "/usr/local/bin/brew",
    });
    expect(result.cmd).toBe("brew install sox ffmpeg");
  });
});

describe("suggestInstallCommand — linux", () => {
  it("returns 'sudo apt install -y sox ffmpeg' for linux", () => {
    const result = suggestInstallCommand("linux", ["sox", "ffmpeg"], {
      execImpl: () => "/usr/bin/apt-get",
    });
    expect(result.cmd).toBe("sudo apt install -y sox ffmpeg");
  });
});

describe("suggestInstallCommand — win32", () => {
  it("returns 'choco install -y sox.portable ffmpeg' for win32", () => {
    const result = suggestInstallCommand("win32", ["sox", "ffmpeg"], {
      execImpl: () => "C:\\choco.exe",
    });
    expect(result.cmd).toBe("choco install -y sox.portable ffmpeg");
  });
});

describe("suggestInstallCommand — claude missing", () => {
  it("returns a docs URL and canAutoInvoke=false for missing claude", () => {
    const result = suggestInstallCommand("darwin", ["claude"], {
      execImpl: () => "/usr/local/bin/brew",
    });
    expect(result.cmd).toContain("https://");
    expect(result.canAutoInvoke).toBe(false);
  });
});

describe("invokePackageManager — spawns and resolves", () => {
  it("spawns the supplied command via the injected spawnImpl seam and resolves with { exitCode, stderr }", async () => {
    const spawnSpy = vi.fn<SpawnImplFn>(() => makeFakeInvokeProc(0, ""));
    const deps: InvokeDeps = {
      spawnImpl: spawnSpy,
    };
    const result = await invokePackageManager("brew install sox", deps);
    expect(result.exitCode).toBe(0);
    expect(spawnSpy).toHaveBeenCalledOnce();
  });
});
