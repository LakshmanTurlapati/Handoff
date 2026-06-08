/**
 * Phase 17, Plan 04, Task 3 — resume-session unit tests.
 *
 * Tests the LOOP-06 lock file + session-state persistence + --resume
 * <sid> hydration substrate. Every test uses an injected homeDir
 * tmpdir so no test ever touches the user's real ~/.achilles/.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir, platform } from "node:os";
import {
  mkdtempSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

import { createResumeSession } from "../src/resume-session.js";

function makeTmpHome(): string {
  return mkdtempSync(join(tmpdir(), "achilles-resume-test-"));
}

describe("createResumeSession (Phase 17 Plan 04 Task 3)", () => {
  it.skipIf(platform() === "win32")(
    "T1: ensureHome creates ~/.achilles/ + sessions/ with 0o700 mode (POSIX only)",
    () => {
      const home = makeTmpHome();
      try {
        // Remove the tmp dir so ensureHome creates it from scratch.
        rmSync(home, { recursive: true, force: true });
        const handle = createResumeSession({ homeDir: home });
        handle.ensureHome();
        expect(existsSync(home)).toBe(true);
        expect(existsSync(join(home, "sessions"))).toBe(true);
        const homeMode = statSync(home).mode & 0o777;
        const sessionsMode = statSync(join(home, "sessions")).mode & 0o777;
        expect(homeMode).toBe(0o700);
        expect(sessionsMode).toBe(0o700);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("T2: acquireLock writes a JSON file with pid + startTime", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({
        homeDir: home,
        nowImpl: () => 1234567890,
        pidImpl: () => 99999,
        killProbe: () => false,
      });
      const result = handle.acquireLock();
      expect(result.ok).toBe(true);
      const lockPath = join(home, "voice.lock");
      const raw = readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as { pid: number; startTime: number };
      expect(parsed.pid).toBe(99999);
      expect(parsed.startTime).toBe(1234567890);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T3: acquireLock detects live PID and returns ok=false", () => {
    const home = makeTmpHome();
    try {
      // Pre-write a lock with pid 88888.
      writeFileSync(
        join(home, "voice.lock"),
        JSON.stringify({ pid: 88888, startTime: 1000 }),
      );
      const killSpy = vi.fn(() => true); // PID is "alive"
      const handle = createResumeSession({
        homeDir: home,
        killProbe: killSpy,
      });
      const result = handle.acquireLock();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.runningPid).toBe(88888);
      }
      expect(killSpy).toHaveBeenCalledWith(88888);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T4: acquireLock overwrites a stale-PID lock (kill returns false)", () => {
    const home = makeTmpHome();
    try {
      // Pre-write a stale lock.
      writeFileSync(
        join(home, "voice.lock"),
        JSON.stringify({ pid: 77777, startTime: 500 }),
      );
      const handle = createResumeSession({
        homeDir: home,
        pidImpl: () => 11111,
        nowImpl: () => 9999,
        killProbe: () => false, // Simulate ESRCH path.
      });
      const result = handle.acquireLock();
      expect(result.ok).toBe(true);
      const raw = readFileSync(join(home, "voice.lock"), "utf8");
      const parsed = JSON.parse(raw) as { pid: number; startTime: number };
      // The lock was overwritten with the new PID.
      expect(parsed.pid).toBe(11111);
      expect(parsed.startTime).toBe(9999);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T5: releaseLock unlinks the file idempotently", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({
        homeDir: home,
        killProbe: () => false,
      });
      handle.acquireLock();
      expect(existsSync(join(home, "voice.lock"))).toBe(true);
      handle.releaseLock();
      expect(existsSync(join(home, "voice.lock"))).toBe(false);
      // Second call must not throw.
      expect(() => handle.releaseLock()).not.toThrow();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T6: persistSessionState writes a JSON file at sessions/<sid>.json", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({ homeDir: home });
      handle.persistSessionState("test-sid-1", {
        status: "active",
        startTime: 12345,
        lastTranscript: "hello",
        latencyP50: 500,
        latencyP95: 800,
      });
      const path = join(home, "sessions", "test-sid-1.json");
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as {
        sid: string;
        status: string;
        startTime: number;
        lastTranscript: string;
        latencyP50: number;
        latencyP95: number;
      };
      expect(parsed.sid).toBe("test-sid-1");
      expect(parsed.status).toBe("active");
      expect(parsed.startTime).toBe(12345);
      expect(parsed.lastTranscript).toBe("hello");
      expect(parsed.latencyP50).toBe(500);
      expect(parsed.latencyP95).toBe(800);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T7: hydrateSession returns null for a missing sid", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({ homeDir: home });
      const result = handle.hydrateSession("nonexistent-sid");
      expect(result).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T8: hydrateSession parses an existing session file", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({ homeDir: home });
      handle.persistSessionState("hydrate-test", {
        status: "ended",
        startTime: 5000,
      });
      const result = handle.hydrateSession("hydrate-test");
      expect(result).not.toBeNull();
      expect(result?.sid).toBe("hydrate-test");
      expect(result?.status).toBe("ended");
      expect(result?.startTime).toBe(5000);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T9: listSessions returns summaries sorted by startTime descending", () => {
    const home = makeTmpHome();
    try {
      const handle = createResumeSession({ homeDir: home });
      handle.persistSessionState("first", {
        status: "ended",
        startTime: 1000,
      });
      handle.persistSessionState("third", {
        status: "active",
        startTime: 3000,
      });
      handle.persistSessionState("second", {
        status: "ended",
        startTime: 2000,
      });
      const sessions = handle.listSessions();
      expect(sessions.length).toBe(3);
      expect(sessions[0]?.sid).toBe("third"); // newest first
      expect(sessions[1]?.sid).toBe("second");
      expect(sessions[2]?.sid).toBe("first");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("T10: malformed lock file is treated as stale + overwritten", () => {
    const home = makeTmpHome();
    try {
      // Write garbage that doesn't parse as JSON.
      writeFileSync(join(home, "voice.lock"), "not-json-content");
      const handle = createResumeSession({
        homeDir: home,
        pidImpl: () => 55555,
        killProbe: () => true, // Even with a live PID probe, garbage shouldn't block.
      });
      const result = handle.acquireLock();
      expect(result.ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
