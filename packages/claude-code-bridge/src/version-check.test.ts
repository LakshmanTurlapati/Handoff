/**
 * Tests for the synchronous `claude --version` probe + semver compare
 * (Plan 10-02, Task 2).
 *
 * Coverage map (Tests 11-23 from the plan's <behavior> block):
 *
 *   compareSemverStrings:
 *     11. ("2.0.0", "2.0.0") === 0
 *     12. ("1.9.99", "2.0.0") === -1  (the critical MIN_CLAUDE_VERSION gate)
 *     13. ("2.0.1", "2.0.0") === 1
 *     14. ("2.1.0", "2.0.99") === 1
 *     15. ("3.0.0", "2.0.0") === 1
 *     16. ("invalid", "2.0.0") throws (no silent zero)
 *
 *   parseVersionFromOutput:
 *     17. ("Claude Code 2.0.5 (sha ...)") === "2.0.5"
 *     18. ("2.0.5\n") === "2.0.5"
 *     19. ("no version here") throws
 *
 *   runVersionCheck (using a stub spawnSyncImpl + env stub):
 *     20. skipEnvVar set + truthy "1" returns { skipped: true } without spawn
 *     21. stub returns "Claude Code 2.0.5" -> { skipped: false, actualVersion: "2.0.5" }
 *     22. stub returns "Claude Code 1.9.5" -> throws ClaudeVersionError
 *     23. stub returns signal=SIGTERM + status=null -> throws generic Error
 */
import { describe, it, expect, vi } from "vitest";
import type { SpawnSyncReturns } from "node:child_process";

import {
  compareSemverStrings,
  parseVersionFromOutput,
  runVersionCheck,
} from "./version-check.js";
import { ClaudeVersionError } from "./errors.js";
import { MIN_CLAUDE_VERSION, SKIP_VERSION_CHECK_ENV_VAR } from "./constants.js";

function makeSpawnReturn(opts: {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
}): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: ["", opts.stdout ?? "", opts.stderr ?? ""],
    stdout: opts.stdout ?? "",
    stderr: opts.stderr ?? "",
    status: opts.status ?? 0,
    signal: opts.signal ?? null,
    error: opts.error,
  } as SpawnSyncReturns<string>;
}

describe("compareSemverStrings", () => {
  it("test 11: equal semvers compare to 0", () => {
    expect(compareSemverStrings("2.0.0", "2.0.0")).toBe(0);
  });

  it("test 12: 1.9.99 < 2.0.0 (the MIN_CLAUDE_VERSION gate)", () => {
    expect(compareSemverStrings("1.9.99", "2.0.0")).toBe(-1);
  });

  it("test 13: 2.0.1 > 2.0.0", () => {
    expect(compareSemverStrings("2.0.1", "2.0.0")).toBe(1);
  });

  it("test 14: minor wins over patch (2.1.0 > 2.0.99)", () => {
    expect(compareSemverStrings("2.1.0", "2.0.99")).toBe(1);
  });

  it("test 15: major wins (3.0.0 > 2.0.0)", () => {
    expect(compareSemverStrings("3.0.0", "2.0.0")).toBe(1);
  });

  it("test 16: invalid semver throws (no silent zero)", () => {
    expect(() => compareSemverStrings("invalid", "2.0.0")).toThrow(/semver/i);
  });
});

describe("parseVersionFromOutput", () => {
  it("test 17: extracts the first dotted triple from a long line", () => {
    expect(parseVersionFromOutput("Claude Code 2.0.5 (sha 1234abcd)")).toBe(
      "2.0.5",
    );
  });

  it("test 18: extracts a naked version with trailing newline", () => {
    expect(parseVersionFromOutput("2.0.5\n")).toBe("2.0.5");
  });

  it("test 19: throws when no dotted triple is present", () => {
    expect(() => parseVersionFromOutput("no version here")).toThrow(/version/i);
  });
});

describe("runVersionCheck", () => {
  it("test 20: skipEnvVar=1 returns { skipped: true } without invoking spawnSync", () => {
    const spawnSyncImpl = vi.fn();
    const result = runVersionCheck({
      env: { [SKIP_VERSION_CHECK_ENV_VAR]: "1" },
      spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
    });
    expect(result).toEqual({ skipped: true });
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  it("test 21: status=0 with valid version output returns { skipped:false, actualVersion }", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ stdout: "Claude Code 2.0.5\n", status: 0 }),
    );
    const result = runVersionCheck({
      env: {}, // skip var absent
      spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
    });
    expect(result).toEqual({ skipped: false, actualVersion: "2.0.5" });
    expect(spawnSyncImpl).toHaveBeenCalledOnce();
    const args = spawnSyncImpl.mock.calls[0];
    expect(args?.[0]).toBe("claude");
    expect(args?.[1]).toEqual(["--version"]);
  });

  it("test 22: actual < required throws ClaudeVersionError with both versions", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ stdout: "Claude Code 1.9.5", status: 0 }),
    );
    try {
      runVersionCheck({
        env: {},
        spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
      });
      throw new Error("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(ClaudeVersionError);
      const err = cause as ClaudeVersionError;
      expect(err.actualVersion).toBe("1.9.5");
      expect(err.requiredVersion).toBe(MIN_CLAUDE_VERSION);
      expect(err.name).toBe("ClaudeVersionError");
    }
  });

  it("test 23: signal=SIGTERM with status=null throws generic Error (not ClaudeVersionError)", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ status: null, signal: "SIGTERM" }),
    );
    try {
      runVersionCheck({
        env: {},
        spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
      });
      throw new Error("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(Error);
      expect(cause).not.toBeInstanceOf(ClaudeVersionError);
      expect((cause as Error).message).toMatch(/probe|claude --version/i);
    }
  });

  it("non-zero exit status throws a generic Error mentioning the status", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ stdout: "garbage", status: 127 }),
    );
    expect(() =>
      runVersionCheck({
        env: {},
        spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
      }),
    ).toThrow(/status 127/);
  });

  it("custom minVersion is honoured by the check", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ stdout: "Claude Code 2.5.0", status: 0 }),
    );
    expect(() =>
      runVersionCheck({
        env: {},
        spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
        minVersion: "3.0.0",
      }),
    ).toThrow(ClaudeVersionError);
  });

  it("env var falsy / missing does NOT trigger the skip path", () => {
    const spawnSyncImpl = vi.fn(() =>
      makeSpawnReturn({ stdout: "Claude Code 2.0.0\n", status: 0 }),
    );
    const result = runVersionCheck({
      env: { [SKIP_VERSION_CHECK_ENV_VAR]: "0" },
      spawnSyncImpl: spawnSyncImpl as unknown as typeof runVersionCheckSpawnType,
    });
    expect(result.skipped).toBe(false);
    expect(spawnSyncImpl).toHaveBeenCalledOnce();
  });
});

// Type-only helper alias used to satisfy vi.fn() casting above.
type runVersionCheckSpawnType = Parameters<typeof runVersionCheck>[0] extends
  | undefined
  | { spawnSyncImpl?: infer S }
  ? NonNullable<S>
  : never;
