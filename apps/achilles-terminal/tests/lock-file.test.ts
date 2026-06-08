/**
 * Phase 18, Plan 02, Task 4 — RED tests for lock-file.ts
 *
 * Tests for acquireLock, releaseLock, and isPidAlive.
 * All tests inject lockFilePathImpl (tmp file) + killImpl seams so
 * no real PID or ~/.achilles touch is needed.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireLock,
  releaseLock,
  isPidAlive,
  type LockFileDeps,
} from "../src/lock-file.js";

/** Build a tmpdir-based lock file path and return deps + cleanup. */
function makeTmpLock(): { lockPath: string; deps: LockFileDeps; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "achilles-lock-test-"));
  const lockPath = join(dir, "voice.lock");
  const deps: LockFileDeps = {
    lockFilePathImpl: lockPath,
    pidImpl: () => process.pid,
    clockImpl: () => 1700000000000,
    // killImpl defaults to undefined (process.kill) but tests override it
  };
  return {
    lockPath,
    deps,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** killImpl that always succeeds (live process). */
function liveKill(): (pid: number, sig: number) => boolean {
  return vi.fn(() => true);
}

/** killImpl that throws ESRCH (dead process). */
function deadKill(): (pid: number, sig: number) => boolean {
  return vi.fn(() => {
    const err = Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    throw err;
  });
}

/** killImpl that throws EPERM (alive but not ours). */
function epermKill(): (pid: number, sig: number) => boolean {
  return vi.fn(() => {
    const err = Object.assign(new Error("EPERM"), { code: "EPERM" });
    throw err;
  });
}

describe("acquireLock — no existing lock", () => {
  it("returns ok=true when lock file does not exist", () => {
    const { deps, cleanup } = makeTmpLock();
    try {
      const result = acquireLock(deps);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("acquireLock — writes lock content", () => {
  it("writes JSON { pid, startTime } with 0o600 perms", () => {
    const { lockPath, deps, cleanup } = makeTmpLock();
    try {
      acquireLock(deps);
      const { readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
      const content = JSON.parse(readFileSync(lockPath, "utf8")) as {
        pid: number;
        startTime: number;
      };
      expect(content.pid).toBe(process.pid);
      expect(content.startTime).toBe(1700000000000);
      const st = statSync(lockPath);
      // On POSIX, mode & 0o777 should be 0o600.
      if (process.platform !== "win32") {
        expect(st.mode & 0o777).toBe(0o600);
      }
    } finally {
      cleanup();
    }
  });
});

describe("acquireLock — live PID conflict", () => {
  it("returns ok=false with runningPid when lock exists AND isPidAlive(pid)==true", () => {
    const { lockPath, deps, cleanup } = makeTmpLock();
    try {
      // Pre-write a lock with PID 99999.
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 99999, startTime: 1700000000000 }),
        { mode: 0o600 },
      );
      const depsWithLiveKill: LockFileDeps = {
        ...deps,
        killImpl: liveKill(),
      };
      const result = acquireLock(depsWithLiveKill);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.runningPid).toBe(99999);
      }
    } finally {
      cleanup();
    }
  });
});

describe("acquireLock — stale PID", () => {
  it("unlinks stale lock and proceeds to acquire when isPidAlive(pid)==false", () => {
    const { lockPath, deps, cleanup } = makeTmpLock();
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 88888, startTime: 1700000000000 }),
        { mode: 0o600 },
      );
      const depsWithDeadKill: LockFileDeps = {
        ...deps,
        killImpl: deadKill(),
      };
      const result = acquireLock(depsWithDeadKill);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("acquireLock — malformed JSON", () => {
  it("treats malformed JSON content as stale and proceeds to acquire", () => {
    const { lockPath, deps, cleanup } = makeTmpLock();
    try {
      writeFileSync(lockPath, "not valid json {{{", { mode: 0o600 });
      const result = acquireLock(deps);
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("releaseLock — unlinks", () => {
  it("unlinks the lock file", () => {
    const { lockPath, deps, cleanup } = makeTmpLock();
    try {
      acquireLock(deps);
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      expect(existsSync(lockPath)).toBe(true);
      releaseLock(deps);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("releaseLock — idempotent", () => {
  it("releaseLock is idempotent — calling on a missing file does not throw", () => {
    const { deps, cleanup } = makeTmpLock();
    try {
      // Never acquireLock — file does not exist.
      expect(() => releaseLock(deps)).not.toThrow();
    } finally {
      cleanup();
    }
  });
});

describe("isPidAlive — ESRCH", () => {
  it("returns false when killImpl throws ESRCH", () => {
    expect(isPidAlive(99999, deadKill())).toBe(false);
  });
});

describe("isPidAlive — EPERM", () => {
  it("returns true when killImpl throws EPERM (alive, not ours)", () => {
    expect(isPidAlive(99999, epermKill())).toBe(true);
  });
});

describe("isPidAlive — no throw", () => {
  it("returns true when killImpl returns without throw", () => {
    expect(isPidAlive(process.pid, liveKill())).toBe(true);
  });
});
