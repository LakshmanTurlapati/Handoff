/**
 * Plan 14-04 — SAFE-06 stuck-thinking watchdog unit tests.
 *
 * SW1..SW8 cover the watchdog factory contract:
 *
 *   SW1: factory returns the {armForTurn, observeProgress, clearForTurn,
 *        dispose} surface
 *   SW2: armForTurn schedules a setTimeout via the injected seam; calling
 *        armForTurn again before clearForTurn cancels the prior token
 *   SW3: observeProgress clears the current timer and re-schedules; this
 *        is the per-progress-event heartbeat path
 *   SW4: clearForTurn cancels the current timer without firing onTimeout
 *   SW5: when the timer fires, onTimeout receives {waitedMs} once; the
 *        internal token is cleared so a subsequent natural firing path
 *        is a no-op; logger emits the [achilles] line with waitedMs only
 *        and NEVER contains transcript fragments or API key bytes
 *   SW6: dispose cancels any pending timer and zeroes onTimeout so a
 *        stale firing path is a no-op even if the host scheduler is
 *        non-cooperative
 *   SW7: dispose() twice is a no-op; clearForTurn() after timer fired is
 *        a no-op
 *   SW8: nowImpl is reserved for future arithmetic; the SW1..SW7
 *        contract is fully satisfied with setTimeoutImpl + clearTimeoutImpl
 *
 * No real Electron, no live ElevenLabs, no real Claude Code. The
 * watchdog module is pure: only the injected timer + clock + logger
 * seams are used.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createStuckThinkingWatchdog,
  STUCK_THINKING_ANNOUNCEMENT,
  STUCK_THINKING_DEFAULT_TIMEOUT_MS,
} from "./stuck-thinking-watchdog.js";

/**
 * Build a fake timer system that records setTimeout / clearTimeout
 * invocations and lets the test fire the scheduled callback
 * synchronously. The implementation mirrors the session.test.ts
 * harness so the watchdog's timer wiring is observable in isolation.
 */
function makeFakeTimers(): {
  setTimeoutImpl: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl: (token: unknown) => void;
  pending: Map<number, { cb: () => void; ms: number }>;
  fireNext(): void;
  hasPending(): boolean;
} {
  let nextToken = 1;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  return {
    setTimeoutImpl: (cb: () => void, ms: number): unknown => {
      const token = nextToken++;
      pending.set(token, { cb, ms });
      return token;
    },
    clearTimeoutImpl: (token: unknown): void => {
      pending.delete(token as number);
    },
    pending,
    fireNext(): void {
      const entries = [...pending.entries()];
      if (entries.length === 0) return;
      const [token, entry] = entries[0]!;
      pending.delete(token);
      entry.cb();
    },
    hasPending(): boolean {
      return pending.size > 0;
    },
  };
}

describe("createStuckThinkingWatchdog — SW1 surface", () => {
  it("returns the {armForTurn, observeProgress, clearForTurn, dispose} surface", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    expect(typeof watchdog.armForTurn).toBe("function");
    expect(typeof watchdog.observeProgress).toBe("function");
    expect(typeof watchdog.clearForTurn).toBe("function");
    expect(typeof watchdog.dispose).toBe("function");
  });

  it("exports the locked STUCK_THINKING_ANNOUNCEMENT constant verbatim from PITFALLS #19", () => {
    // The exact phrasing is locked by CONTEXT.md "Claude's Discretion:
    // exact phrasing of the stuck-thinking audible announcement" + the
    // PITFALLS #19 example. The em-dash is U+2014 (allowed); no emoji.
    expect(STUCK_THINKING_ANNOUNCEMENT).toBe(
      "Claude is still working — I'll let you know when it's done.",
    );
    // The announcement must contain NO emoji (U+1F000-U+1FFFF / U+2600-
    // U+27FF). Em-dash U+2014 is allowed.
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(STUCK_THINKING_ANNOUNCEMENT)).toBe(
      false,
    );
    expect(/[\u{2600}-\u{27FF}]/u.test(STUCK_THINKING_ANNOUNCEMENT)).toBe(false);
  });

  it("exports the locked default timeout STUCK_THINKING_DEFAULT_TIMEOUT_MS = 60_000", () => {
    expect(STUCK_THINKING_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });
});

describe("createStuckThinkingWatchdog — SW2 armForTurn schedules + re-arm cancels prior token", () => {
  it("armForTurn schedules a setTimeout via the injected seam with the configured timeoutMs", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      timeoutMs: 60_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    expect(t.pending.size).toBe(1);
    const entries = [...t.pending.values()];
    expect(entries[0]!.ms).toBe(60_000);
  });

  it("armForTurn called twice cancels the first token and schedules a fresh one (idempotent re-arm)", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    const firstTokens = [...t.pending.keys()];
    watchdog.armForTurn();
    const secondTokens = [...t.pending.keys()];
    // Exactly one timer is in flight after the second armForTurn.
    expect(t.pending.size).toBe(1);
    // The token from the first armForTurn must have been cleared.
    expect(secondTokens).not.toEqual(firstTokens);
  });

  it("armForTurn uses the default timeout when timeoutMs is unset", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    const entries = [...t.pending.values()];
    expect(entries[0]!.ms).toBe(STUCK_THINKING_DEFAULT_TIMEOUT_MS);
  });
});

describe("createStuckThinkingWatchdog — SW3 observeProgress clears + re-schedules", () => {
  it("observeProgress clears the current timer and re-schedules with the same timeoutMs", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      timeoutMs: 5_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    const beforeTokens = [...t.pending.keys()];
    watchdog.observeProgress();
    const afterTokens = [...t.pending.keys()];
    expect(t.pending.size).toBe(1);
    expect(afterTokens).not.toEqual(beforeTokens);
    const entries = [...t.pending.values()];
    expect(entries[0]!.ms).toBe(5_000);
  });

  it("multiple consecutive observeProgress calls keep deferring the timeout (heartbeat pattern)", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    for (let i = 0; i < 10; i++) {
      watchdog.observeProgress();
    }
    // Still exactly one in-flight timer; onTimeout has NOT fired.
    expect(t.pending.size).toBe(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("observeProgress called when no timer is armed is a no-op (defensive)", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    // No armForTurn — observeProgress should not start a fresh timer.
    watchdog.observeProgress();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createStuckThinkingWatchdog — SW4 clearForTurn cancels without firing", () => {
  it("clearForTurn cancels the in-flight timer without invoking onTimeout", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    expect(t.pending.size).toBe(1);
    watchdog.clearForTurn();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clearForTurn called when no timer is armed is a no-op", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    // No prior arm — clear should not throw and should remain pending-free.
    watchdog.clearForTurn();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createStuckThinkingWatchdog — SW5 timer fires onTimeout once with waitedMs", () => {
  it("when the timer fires, onTimeout receives {waitedMs} matching the configured timeoutMs", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      timeoutMs: 42_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({ waitedMs: 42_000 });
  });

  it("after the timer fires, the internal token is cleared so further fires are no-ops until armForTurn", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // No pending timer remains; subsequent clearForTurn / observeProgress
    // are no-ops.
    expect(t.pending.size).toBe(0);
    watchdog.clearForTurn();
    watchdog.observeProgress();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("logger receives a [achilles] line with waitedMs only — NEVER transcript or API key bytes", () => {
    const t = makeFakeTimers();
    const logs: string[] = [];
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      timeoutMs: 60_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      logger: (msg: string): void => {
        logs.push(msg);
      },
    });
    watchdog.armForTurn();
    t.fireNext();
    // The single log line includes waitedMs only.
    const matched = logs.find((line) =>
      line.includes("[achilles] stuck-thinking timer fired"),
    );
    expect(matched).toBeDefined();
    expect(matched).toContain("waitedMs=60000");
    // Defence-in-depth: the log line must never contain transcript or
    // key shapes. The grep guard in the verify command enforces this at
    // the source level; here we assert it on the runtime line too.
    for (const line of logs) {
      expect(line).not.toContain("payload.text");
      expect(line).not.toContain("accumulatedText");
      expect(line).not.toContain("apiKey");
      expect(line).not.toContain("xi-");
      expect(line).not.toContain("sk_");
    }
  });

  it("re-arming after a fire schedules a fresh timer", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    watchdog.armForTurn();
    expect(t.pending.size).toBe(1);
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });
});

describe("createStuckThinkingWatchdog — SW6 dispose cancels + zeroes onTimeout", () => {
  it("dispose cancels any pending timer", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    expect(t.pending.size).toBe(1);
    watchdog.dispose();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("dispose zeroes the onTimeout callback so even a stale firing path is a no-op", () => {
    // Build a watchdog where the fake timer scheduler stays open
    // (non-cooperative host). Even if we manually invoke the captured
    // callback after dispose, onTimeout MUST NOT fire.
    let capturedCb: (() => void) | null = null;
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      timeoutMs: 1_000,
      setTimeoutImpl: (cb: () => void) => {
        capturedCb = cb;
        return 1;
      },
      clearTimeoutImpl: () => undefined,
    });
    watchdog.armForTurn();
    watchdog.dispose();
    // Even firing the captured cb manually — simulating a stale handle
    // that the host did not clear — does not re-invoke onTimeout.
    expect(capturedCb).not.toBeNull();
    capturedCb!();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createStuckThinkingWatchdog — CR-01 bootstrap will-quit dispose contract", () => {
  it("dispose() invoked from the bootstrap will-quit sequence drops a leftover sessionRef closure AND clears the in-flight timer token", () => {
    // CR-01 regression. Phase 14 review found that index.ts constructed the
    // watchdog inside `if (apiKey !== null) { ... }` and the will-quit handler
    // never called stuckThinkingWatchdog.dispose(). The captured `sessionRef`
    // closure (the disposed AchillesSession) stayed reachable through
    // onTimeoutRef AND the in-flight setTimeout token survived host teardown.
    //
    // This test simulates the bootstrap shape: an outer-scope sessionRef + a
    // watchdog whose onTimeout closure captures it. We assert that after
    // dispose() (the will-quit call) the captured ref is dropped (onTimeout is
    // not invoked even if the host scheduler fires the captured cb) AND no
    // timer token is left pending.
    let sessionRef: { announceStuckThinking: ReturnType<typeof vi.fn> } | null = {
      announceStuckThinking: vi.fn(),
    };
    let capturedCb: (() => void) | null = null;
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: ({ waitedMs }): void => {
        sessionRef?.announceStuckThinking({ waitedMs });
      },
      timeoutMs: 60_000,
      setTimeoutImpl: (cb: () => void) => {
        capturedCb = cb;
        return 1;
      },
      clearTimeoutImpl: () => undefined,
    });
    // Bootstrap-shaped lifecycle: arm at start of a turn, then simulate
    // a will-quit before the timer fires.
    watchdog.armForTurn();
    expect(capturedCb).not.toBeNull();

    // Drop the bootstrap-scoped sessionRef (simulates session.dispose()).
    const announceSpy = sessionRef.announceStuckThinking;
    sessionRef = null;

    // Now the will-quit handler calls watchdog.dispose() — without the CR-01
    // fix, the captured cb still resolves the (now-stale) onTimeoutRef and
    // would invoke session.announceStuckThinking on a disposed session.
    watchdog.dispose();
    capturedCb!();
    // No announcement was made on the (already-cleared) session ref:
    // dispose() zeroed onTimeoutRef so the captured cb is a no-op.
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("dispose() is safe to call when no timer was armed (bootstrap exits before any utterance)", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    // No armForTurn — the bootstrap quit before any utterance.
    expect(() => watchdog.dispose()).not.toThrow();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createStuckThinkingWatchdog — SW7 idempotency", () => {
  it("dispose() twice does not throw and stays in the disposed state", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    expect(() => {
      watchdog.dispose();
      watchdog.dispose();
    }).not.toThrow();
    expect(t.pending.size).toBe(0);
  });

  it("armForTurn / observeProgress / clearForTurn after dispose are all no-ops", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.dispose();
    watchdog.armForTurn();
    watchdog.observeProgress();
    watchdog.clearForTurn();
    expect(t.pending.size).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clearForTurn after the timer has fired is a no-op", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(() => watchdog.clearForTurn()).not.toThrow();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe("createStuckThinkingWatchdog — SW8 nowImpl reserved but optional", () => {
  it("nowImpl can be omitted entirely; the SW1..SW7 contract still holds with setTimeoutImpl + clearTimeoutImpl alone", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      // no nowImpl on purpose
    });
    watchdog.armForTurn();
    t.fireNext();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("nowImpl, when supplied, is not required to be invoked (reserved for future arithmetic)", () => {
    const t = makeFakeTimers();
    const nowImpl = vi.fn(() => 12345);
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
      nowImpl,
    });
    watchdog.armForTurn();
    t.fireNext();
    // The contract documents nowImpl as reserved; the test only asserts
    // the watchdog does not crash when a nowImpl is supplied. Whether it
    // is invoked is an implementation detail.
    expect(nowImpl).toBeDefined();
  });
});
