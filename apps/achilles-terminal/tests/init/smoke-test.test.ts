/**
 * Phase 18, Plan 03, Task 1 — Tests for init/smoke-test.ts.
 *
 * IMPORTANT (CLAUDE.md no-auto-running rule):
 *   runSmokeTest fires the real Phase 17 session ONLY when the operator runs
 *   `achilles init` interactively. Tests NEVER spawn a real session — all tests
 *   use the sessionFactoryImpl injection seam to emit synthetic round-trip events.
 *
 * No emojis. No real session spawning.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  runSmokeTest,
  type SmokeTestDeps,
  type SmokeTestResult,
} from "../../src/init/smoke-test.js";
import type { Session } from "../../src/session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a synthetic Session-like EventEmitter that exposes a dispose() method.
 * Tests control event emission manually.
 */
function makeFakeSession(): {
  session: Session;
  emit: (type: string, payload?: unknown) => void;
  disposeCallCount: () => number;
} {
  const emitter = new EventEmitter() as EventEmitter & { dispose?: () => void };
  let disposeCount = 0;

  emitter.dispose = () => {
    disposeCount++;
  };

  const fakeSession = emitter as unknown as Session;

  return {
    session: fakeSession,
    emit: (type: string, payload?: unknown) => {
      // Emit in the same format as the real Session
      emitter.emit("event", { type, payload: payload ?? {}, timestamp: Date.now() });
    },
    disposeCallCount: () => disposeCount,
  };
}

describe("runSmokeTest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes when the injected session emits claude_done(success) AND tts_drained", async () => {
    const { session, emit } = makeFakeSession();

    const deps: SmokeTestDeps = {
      sessionFactoryImpl: () => session,
      timeoutMs: 5000,
    };

    const resultPromise = runSmokeTest(deps);

    // Emit the round-trip events after a microtask
    await Promise.resolve();
    emit("claude_done", { outcome: { kind: "success" } });
    emit("tts_drained", {});

    const result: SmokeTestResult = await resultPromise;
    expect(result.passed).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(typeof result.elapsedMs).toBe("number");
  });

  it("fails with failureReason='timeout_30s' when no events fire within 30 seconds", async () => {
    vi.useFakeTimers();
    const { session } = makeFakeSession();

    const deps: SmokeTestDeps = {
      sessionFactoryImpl: () => session,
      timeoutMs: 30000,
      setTimeoutImpl: (fn, ms) => setTimeout(fn, ms),
      clearTimeoutImpl: clearTimeout,
    };

    const resultPromise = runSmokeTest(deps);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(31000);

    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.failureReason).toBe("timeout_30s");
    vi.useRealTimers();
  });

  it("disposes the session on pass", async () => {
    const { session, emit, disposeCallCount } = makeFakeSession();

    const deps: SmokeTestDeps = {
      sessionFactoryImpl: () => session,
      timeoutMs: 5000,
    };

    const resultPromise = runSmokeTest(deps);
    await Promise.resolve();
    emit("claude_done", { outcome: { kind: "success" } });
    emit("tts_drained", {});

    await resultPromise;
    expect(disposeCallCount()).toBeGreaterThanOrEqual(1);
  });

  it("disposes the session on timeout", async () => {
    vi.useFakeTimers();
    const { session, disposeCallCount } = makeFakeSession();

    const deps: SmokeTestDeps = {
      sessionFactoryImpl: () => session,
      timeoutMs: 30000,
      setTimeoutImpl: (fn, ms) => setTimeout(fn, ms),
      clearTimeoutImpl: clearTimeout,
    };

    const resultPromise = runSmokeTest(deps);
    await vi.advanceTimersByTimeAsync(31000);
    await resultPromise;

    expect(disposeCallCount()).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it("accepts a custom timeoutMs", async () => {
    vi.useFakeTimers();
    const { session } = makeFakeSession();

    const deps: SmokeTestDeps = {
      sessionFactoryImpl: () => session,
      timeoutMs: 10000, // custom: 10 seconds instead of 30
      setTimeoutImpl: (fn, ms) => setTimeout(fn, ms),
      clearTimeoutImpl: clearTimeout,
    };

    const resultPromise = runSmokeTest(deps);
    // Advance only to the custom timeout
    await vi.advanceTimersByTimeAsync(11000);

    const result = await resultPromise;
    expect(result.passed).toBe(false);
    expect(result.failureReason).toBe("timeout_30s");
    vi.useRealTimers();
  });
});
