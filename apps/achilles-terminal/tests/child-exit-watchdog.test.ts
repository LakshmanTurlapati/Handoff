/**
 * Phase 17, Plan 02, Task 2 — ERR-03 / ERR-06 child-exit watchdog tests.
 *
 * 5 tests cover the sliding-window respawn cap behaviour:
 *
 *   1. Single child exit triggers respawnFactory exactly once
 *   2. 4 exits within windowMs trips the cap: respawnFactory invoked
 *      exactly maxRespawns times (3), onError invoked once with the
 *      locked AUDIO_DEVICE_LOST_MESSAGE
 *   3. Exits spaced beyond windowMs do NOT trip the cap (sliding
 *      window roll-off)
 *   4. dispose() during respawn-in-flight cleanly cancels — any
 *      exit after dispose is a no-op (no further respawnFactory call)
 *   5. Logger records both child_exit + respawn_cap_exceeded events
 *      with the right field shapes
 *
 * Hermetic: every test uses a fake child built on top of node:events
 * EventEmitter; no real spawn() is invoked.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createChildExitWatchdog,
  AUDIO_DEVICE_LOST_MESSAGE,
  RESPAWN_MAX,
  RESPAWN_WINDOW_MS,
  type ChildProcessExitLike,
} from "../src/child-exit-watchdog.js";
import type { StructuredLogger } from "../src/structured-logger.js";

/**
 * Build a fake child that satisfies the ChildProcessExitLike
 * surface. The test triggers an "exit" via emit().
 */
function makeFakeChild(): EventEmitter & ChildProcessExitLike {
  return new EventEmitter() as EventEmitter & ChildProcessExitLike;
}

/**
 * Build a clock seam where time advances explicitly via `advance`.
 */
function makeClock(initial = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Recording StructuredLogger fake. Captures (level, event, fields) tuples.
 */
function makeRecordingLogger(): {
  logger: StructuredLogger;
  records: Array<{
    level: "info" | "warn" | "error";
    event: string;
    fields: Record<string, unknown> | undefined;
  }>;
} {
  const records: Array<{
    level: "info" | "warn" | "error";
    event: string;
    fields: Record<string, unknown> | undefined;
  }> = [];
  const logger: StructuredLogger = {
    info: (event: string, fields?: Record<string, unknown>): void => {
      records.push({ level: "info", event, fields });
    },
    warn: (event: string, fields?: Record<string, unknown>): void => {
      records.push({ level: "warn", event, fields });
    },
    error: (event: string, fields?: Record<string, unknown>): void => {
      records.push({ level: "error", event, fields });
    },
    child: (): StructuredLogger => logger,
    flush: (): Promise<void> => Promise.resolve(),
    dispose: (): void => undefined,
  };
  return { logger, records };
}

describe("createChildExitWatchdog — locked constants", () => {
  it("RESPAWN_MAX=3 + RESPAWN_WINDOW_MS=10_000 + AUDIO_DEVICE_LOST_MESSAGE matches CONTEXT.md", () => {
    expect(RESPAWN_MAX).toBe(3);
    expect(RESPAWN_WINDOW_MS).toBe(10_000);
    expect(AUDIO_DEVICE_LOST_MESSAGE).toBe(
      "Audio device lost — restart Achilles",
    );
    // No emojis
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(AUDIO_DEVICE_LOST_MESSAGE)).toBe(
      false,
    );
    expect(/[\u{2600}-\u{27FF}]/u.test(AUDIO_DEVICE_LOST_MESSAGE)).toBe(false);
  });
});

describe("createChildExitWatchdog — Test 1: single exit triggers respawnFactory", () => {
  it("on first exit, respawnFactory is invoked exactly once + onError is NOT called", () => {
    const initial = makeFakeChild();
    const respawned = makeFakeChild();
    const respawnFactory = vi.fn(() => respawned);
    const onError = vi.fn();
    const clock = makeClock();
    createChildExitWatchdog({
      label: "sox",
      child: initial,
      respawnFactory,
      onError,
      nowImpl: clock.now,
    });
    initial.emit("exit", 1);
    expect(respawnFactory).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("createChildExitWatchdog — Test 2: cap-exceeded triggers onError with locked message", () => {
  it("4 exits within windowMs: respawnFactory called 3 times + onError called once with AUDIO_DEVICE_LOST_MESSAGE", () => {
    const onError = vi.fn();
    const clock = makeClock();
    // Build a chain of fake children; respawnFactory hands out the
    // next one each time.
    const children: Array<EventEmitter & ChildProcessExitLike> = [];
    for (let i = 0; i < 4; i++) {
      children.push(makeFakeChild());
    }
    let nextIdx = 1;
    const respawnFactory = vi.fn(() => {
      const c = children[nextIdx++]!;
      return c;
    });
    createChildExitWatchdog({
      label: "sox",
      child: children[0]!,
      respawnFactory,
      onError,
      nowImpl: clock.now,
    });
    // Fire 4 exits — each 100ms apart, all within the 10s window.
    children[0]!.emit("exit", 1);
    clock.advance(100);
    children[1]!.emit("exit", 1);
    clock.advance(100);
    children[2]!.emit("exit", 1);
    clock.advance(100);
    children[3]!.emit("exit", 1);

    // RESPAWN_MAX=3: the 4th exit trips the cap; respawnFactory was
    // called 3 times (to spawn children[1..3]), and onError fires
    // once with the locked message.
    expect(respawnFactory).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(AUDIO_DEVICE_LOST_MESSAGE);
  });
});

describe("createChildExitWatchdog — Test 3: sliding-window roll-off does NOT trip cap", () => {
  it("2 exits + 11s gap + 2 more exits: respawnFactory called 4 times, onError NOT called", () => {
    const onError = vi.fn();
    const clock = makeClock();
    const children: Array<EventEmitter & ChildProcessExitLike> = [];
    for (let i = 0; i < 5; i++) {
      children.push(makeFakeChild());
    }
    let nextIdx = 1;
    const respawnFactory = vi.fn(() => children[nextIdx++]!);
    createChildExitWatchdog({
      label: "sox",
      child: children[0]!,
      respawnFactory,
      onError,
      nowImpl: clock.now,
    });
    // First two exits inside the window
    children[0]!.emit("exit", 1);
    clock.advance(100);
    children[1]!.emit("exit", 1);
    // Now advance past the windowMs so the prior two roll off
    clock.advance(11_000);
    children[2]!.emit("exit", 1);
    clock.advance(100);
    children[3]!.emit("exit", 1);

    // 4 exits processed total, all within the cap since the first
    // two have rolled off the sliding window.
    expect(respawnFactory).toHaveBeenCalledTimes(4);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("createChildExitWatchdog — Test 4: dispose() prevents further respawn after exit", () => {
  it("dispose() then exit: respawnFactory is NOT invoked", () => {
    const onError = vi.fn();
    const respawnFactory = vi.fn();
    const initial = makeFakeChild();
    const watchdog = createChildExitWatchdog({
      label: "ffplay",
      child: initial,
      respawnFactory,
      onError,
    });
    watchdog.dispose();
    initial.emit("exit", 1);
    expect(respawnFactory).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("dispose() is idempotent", () => {
    const initial = makeFakeChild();
    const watchdog = createChildExitWatchdog({
      label: "ffplay",
      child: initial,
      respawnFactory: vi.fn(),
      onError: vi.fn(),
    });
    expect(() => {
      watchdog.dispose();
      watchdog.dispose();
    }).not.toThrow();
  });
});

describe("createChildExitWatchdog — Test 5: logger records child_exit + respawn_cap_exceeded events", () => {
  it("logger receives child_exit info events + respawn_cap_exceeded error on cap", () => {
    const { logger, records } = makeRecordingLogger();
    const clock = makeClock();
    const children: Array<EventEmitter & ChildProcessExitLike> = [];
    for (let i = 0; i < 4; i++) {
      children.push(makeFakeChild());
    }
    let nextIdx = 1;
    const respawnFactory = vi.fn(() => children[nextIdx++]!);
    createChildExitWatchdog({
      label: "ffplay",
      child: children[0]!,
      respawnFactory,
      onError: vi.fn(),
      logger,
      nowImpl: clock.now,
    });
    children[0]!.emit("exit", 1);
    clock.advance(100);
    children[1]!.emit("exit", 1);
    clock.advance(100);
    children[2]!.emit("exit", 1);
    clock.advance(100);
    children[3]!.emit("exit", 1);

    const exitInfo = records.filter(
      (r) => r.event === "child_exit" && r.level === "info",
    );
    expect(exitInfo.length).toBe(4);
    expect(exitInfo[0]!.fields).toMatchObject({
      label: "ffplay",
      code: 1,
      attempt: 1,
    });
    const capError = records.find(
      (r) => r.event === "respawn_cap_exceeded" && r.level === "error",
    );
    expect(capError).toBeDefined();
    expect(capError!.fields).toMatchObject({
      label: "ffplay",
      attempts: 4,
      windowMs: 10_000,
    });
  });

  it("respawnFactory throwing is treated as cap-exceeded with locked message", () => {
    const onError = vi.fn();
    const { logger } = makeRecordingLogger();
    const initial = makeFakeChild();
    const respawnFactory = vi.fn(() => {
      throw new Error("spawn failed: ENOENT");
    });
    createChildExitWatchdog({
      label: "sox",
      child: initial,
      respawnFactory,
      onError,
      logger,
    });
    initial.emit("exit", 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(AUDIO_DEVICE_LOST_MESSAGE);
  });
});
