/**
 * Phase 17, Plan 04, Task 2 — gracefulShutdown unit tests.
 *
 * Tests the LOOP-05 7-step teardown chain via injected process / timer
 * / unlinkSync seams so no real signals fire and no real file is
 * touched.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

import { registerGracefulShutdown } from "../src/graceful-shutdown.js";
import type { Session } from "../src/session.js";

// The processOverride dep accepts a structurally-narrow shape. The
// vi.fn spies are typed loosely (ReturnType<typeof vi.fn>) so we
// type-cast through `unknown` at the deps assignment site rather
// than reshape every spy's parameter signature.
interface ProcessSpy {
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}

/**
 * Helper to satisfy the RegisterGracefulShutdownDeps processOverride
 * type. Each vi.fn spy's call signature is `(...args: any[]) =>
 * any`, but the deps interface demands narrower signatures; the cast
 * via unknown is the conventional vitest mock-injection pattern.
 */
function toProcessOverride(
  spy: ProcessSpy,
): NonNullable<
  Parameters<
    typeof import("../src/graceful-shutdown.js").registerGracefulShutdown
  >[0]["processOverride"]
> {
  return spy as unknown as NonNullable<
    Parameters<
      typeof import("../src/graceful-shutdown.js").registerGracefulShutdown
    >[0]["processOverride"]
  >;
}

interface LoggerSpy {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function makeProcessSpy(): ProcessSpy {
  return {
    once: vi.fn(),
    on: vi.fn(),
    exit: vi.fn(() => undefined as never),
    kill: vi.fn(() => true as const),
  };
}

function makeLoggerSpy(): LoggerSpy {
  const spy: LoggerSpy = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
  spy.child.mockReturnValue(spy);
  return spy;
}

/**
 * Build a fake Session that exposes only the surface graceful-
 * shutdown reads. Uses EventEmitter so .emit("event", ...) works.
 */
function makeFakeSession(opts: {
  ttsCancel?: () => Promise<void>;
  claudeCancel?: () => Promise<unknown>;
  sttStop?: () => Promise<void>;
  micStop?: () => Promise<void>;
}): Session {
  const emitter = new EventEmitter();
  const session = Object.assign(emitter, {
    shuttingDown: false,
    ttsPlayback: {
      cancel: opts.ttsCancel ?? (() => Promise.resolve()),
      dispose: () => Promise.resolve(),
      start: () => Promise.resolve(),
      appendText: () => undefined,
      flush: () => undefined,
    } as unknown,
    claudeBridge: {
      cancel:
        opts.claudeCancel ??
        (() => Promise.resolve({ type: "process_exit", exit_code: 0 })),
      dispose: () => Promise.resolve(),
      send: () => Promise.resolve(),
      consume: () => Promise.resolve(),
    } as unknown,
    sttBridge: {
      stop: opts.sttStop ?? (() => Promise.resolve()),
      start: () => Promise.resolve(),
      write: () => undefined,
      commit: () => undefined,
      events$: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ value: undefined, done: true }),
        }),
      }),
    } as unknown,
    stop: opts.micStop ?? (() => Promise.resolve()),
  });
  return session as unknown as Session;
}

describe("gracefulShutdown (Phase 17 Plan 04 Task 2)", () => {
  it("T1: registers process.once for SIGINT + SIGTERM (not process.on)", () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const session = makeFakeSession({});
    registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    const onceCalls = proc.once.mock.calls.map((c) => c[0]);
    expect(onceCalls).toContain("SIGINT");
    expect(onceCalls).toContain("SIGTERM");
    expect(onceCalls).toContain("exit");
    // process.on should not be called yet — only after the first
    // gracefulShutdown invocation (second-signal escalation path).
    expect(proc.on).not.toHaveBeenCalled();
  });

  it("T2: 7-step teardown calls handles in documented order", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const callOrder: string[] = [];
    const session = makeFakeSession({
      ttsCancel: () => {
        callOrder.push("tts");
        return Promise.resolve();
      },
      claudeCancel: () => {
        callOrder.push("claude");
        return Promise.resolve({ type: "process_exit", exit_code: 0 });
      },
      sttStop: () => {
        callOrder.push("stt");
        return Promise.resolve();
      },
      micStop: () => {
        callOrder.push("mic");
        return Promise.resolve();
      },
    });
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    await handle.gracefulShutdown("sigint");
    expect(callOrder).toEqual(["tts", "claude", "stt", "mic"]);
    expect(proc.exit).toHaveBeenCalledWith(0);
    expect(logger.flush).toHaveBeenCalled();
  });

  it("T3: budget timeout fires process.exit(130) when handle hangs", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    // Build a session whose every handle hangs indefinitely.
    const hangingPromise = new Promise<void>(() => undefined);
    const session = makeFakeSession({
      ttsCancel: () => hangingPromise,
      claudeCancel: () => hangingPromise as never,
      sttStop: () => hangingPromise,
      micStop: () => hangingPromise,
    });
    // Capture the setTimeout token spy.
    const setTSpy = vi.fn((cb: () => void, _ms: number): unknown => {
      // Fire the outer 1.5s budget timer synchronously by capturing
      // each registered callback and invoking the outer one when ms
      // === 1500.
      if (_ms === 1500) {
        cb();
      }
      return 0;
    });
    const clearTSpy = vi.fn();
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
      setTimeoutImpl: setTSpy,
      clearTimeoutImpl: clearTSpy,
    });
    // Don't await — the inner promise hangs.
    void handle.gracefulShutdown("sigint");
    // The synchronous-fired budget timer should have called exit(130).
    expect(proc.exit).toHaveBeenCalledWith(130);
    expect(logger.error).toHaveBeenCalledWith(
      "graceful_shutdown_budget_exceeded",
      expect.objectContaining({ reason: "sigint" }),
    );
  });

  it("T4: idempotent — second gracefulShutdown call returns same Promise", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const session = makeFakeSession({});
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    const p1 = handle.gracefulShutdown("sigint");
    const p2 = handle.gracefulShutdown("sigterm");
    expect(p1).toBe(p2);
    await p1;
    // Only one exit call.
    expect(proc.exit.mock.calls.length).toBe(1);
  });

  it("T5: process.once('exit') handler synchronously unlinks the lock file", () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const unlinkSpy = vi.fn();
    const session = makeFakeSession({});
    registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock-cleanup",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: unlinkSpy,
    });
    // Locate the exit handler registered via process.once.
    const exitCall = proc.once.mock.calls.find((c) => c[0] === "exit");
    expect(exitCall).toBeDefined();
    const exitHandler = exitCall![1] as () => void;
    // Invoke it directly — simulates the host process about to exit.
    exitHandler();
    expect(unlinkSpy).toHaveBeenCalledWith("/tmp/test-lock-cleanup");
  });

  it("T6: logger.flush called before process.exit", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    // Track the call ordering between flush and exit.
    const sequence: string[] = [];
    logger.flush.mockImplementation(() => {
      sequence.push("flush");
      return Promise.resolve();
    });
    proc.exit.mockImplementation(() => {
      sequence.push("exit");
      return undefined as never;
    });
    const session = makeFakeSession({});
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    await handle.gracefulShutdown("sigint");
    const flushIdx = sequence.indexOf("flush");
    const exitIdx = sequence.indexOf("exit");
    expect(flushIdx).toBeLessThan(exitIdx);
  });

  it("T7: shuttingDown=true is set on the session at chain start", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const session = makeFakeSession({});
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    expect(session.shuttingDown).toBe(false);
    await handle.gracefulShutdown("sigint");
    expect(session.shuttingDown).toBe(true);
  });

  it("T8: reason 'internal_error' maps to exit code 1; others map to 0", async () => {
    const proc = makeProcessSpy();
    const logger = makeLoggerSpy();
    const session = makeFakeSession({});
    const handle = registerGracefulShutdown({
      session,
      logger,
      lockFilePath: "/tmp/test-lock",
      processOverride: toProcessOverride(proc),
      unlinkSyncImpl: vi.fn(),
    });
    await handle.gracefulShutdown("internal_error");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });
});
