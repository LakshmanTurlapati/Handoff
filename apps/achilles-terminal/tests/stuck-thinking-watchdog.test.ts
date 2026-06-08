/**
 * Phase 17, Plan 02, Task 2 — ERR-05 stuck-thinking watchdog tests.
 *
 * Mirrors the v1.2 SW1..SW7 case set verbatim (the watchdog is a
 * verbatim port; the test surface ports the same invariants). The
 * watchdog factory is a pure module: the only injected seams are
 * setTimeoutImpl / clearTimeoutImpl / logger / nowImpl.
 *
 *   SW1 — factory returns the {armForTurn, observeProgress,
 *         clearForTurn, dispose} surface + locked constants
 *   SW2 — armForTurn schedules the timer + idempotent re-arm
 *         cancels prior token
 *   SW3 — observeProgress clears the current timer and re-schedules
 *         (heartbeat); observeProgress when no timer is armed is a
 *         no-op
 *   SW4 — clearForTurn cancels without firing onTimeout
 *   SW5 — when the timer fires, onTimeout receives {waitedMs}; the
 *         logger sees waitedMs only with NO transcript / no API key
 *         bytes (T-14-20 / T-17-08 mitigation)
 *   SW6 — dispose cancels any pending timer AND zeroes the onTimeout
 *         reference so even a stale firing path is a no-op
 *   SW7 — dispose() twice is a no-op; lifecycle methods after
 *         dispose() are all no-ops
 *
 * No real timers (vi.useFakeTimers not needed); every test injects
 * recording setTimeoutImpl + clearTimeoutImpl fakes.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import {
  createStuckThinkingWatchdog,
  STUCK_THINKING_ANNOUNCEMENT,
  STUCK_THINKING_DEFAULT_TIMEOUT_MS,
} from "../src/stuck-thinking-watchdog.js";

/**
 * Build a fake timer system that records setTimeout / clearTimeout
 * invocations and lets the test fire the scheduled callback
 * synchronously.
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

describe("createStuckThinkingWatchdog — SW1 surface + locked constants", () => {
  it("returns {armForTurn, observeProgress, clearForTurn, dispose}", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    expect(typeof watchdog.armForTurn).toBe("function");
    expect(typeof watchdog.observeProgress).toBe("function");
    expect(typeof watchdog.clearForTurn).toBe("function");
    expect(typeof watchdog.dispose).toBe("function");
  });

  it("exports the locked STUCK_THINKING_ANNOUNCEMENT verbatim with em-dash U+2014 (no emoji)", () => {
    expect(STUCK_THINKING_ANNOUNCEMENT).toBe(
      "Claude is still working — I'll let you know when it's done.",
    );
    // No emoji codepoint ranges
    expect(/[\u{1F000}-\u{1FFFF}]/u.test(STUCK_THINKING_ANNOUNCEMENT)).toBe(
      false,
    );
    expect(/[\u{2600}-\u{27FF}]/u.test(STUCK_THINKING_ANNOUNCEMENT)).toBe(
      false,
    );
    // Em-dash present
    expect(STUCK_THINKING_ANNOUNCEMENT).toContain("—");
  });

  it("exports STUCK_THINKING_DEFAULT_TIMEOUT_MS=60_000", () => {
    expect(STUCK_THINKING_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });
});

describe("createStuckThinkingWatchdog — SW2 armForTurn + idempotent re-arm", () => {
  it("armForTurn schedules a setTimeout via the injected seam with the configured timeoutMs", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      timeoutMs: 60_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    expect(t.pending.size).toBe(1);
    const entries = [...t.pending.values()];
    expect(entries[0]!.ms).toBe(60_000);
  });

  it("idempotent re-arm: armForTurn twice keeps exactly one in-flight timer", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    const before = [...t.pending.keys()];
    watchdog.armForTurn();
    const after = [...t.pending.keys()];
    expect(t.pending.size).toBe(1);
    expect(after).not.toEqual(before);
  });

  it("armForTurn uses the default 60_000 when timeoutMs is unset", () => {
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

describe("createStuckThinkingWatchdog — SW3 observeProgress heartbeat + defensive no-op", () => {
  it("observeProgress clears the current timer and re-schedules with the same timeoutMs", () => {
    const t = makeFakeTimers();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout: vi.fn(),
      timeoutMs: 5_000,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    watchdog.armForTurn();
    const before = [...t.pending.keys()];
    watchdog.observeProgress();
    const after = [...t.pending.keys()];
    expect(t.pending.size).toBe(1);
    expect(after).not.toEqual(before);
    const entries = [...t.pending.values()];
    expect(entries[0]!.ms).toBe(5_000);
  });

  it("observeProgress called when no timer is armed is a no-op (defensive — stale event from cancelled turn)", () => {
    const t = makeFakeTimers();
    const onTimeout = vi.fn();
    const watchdog = createStuckThinkingWatchdog({
      onTimeout,
      setTimeoutImpl: t.setTimeoutImpl,
      clearTimeoutImpl: t.clearTimeoutImpl,
    });
    // No armForTurn — observeProgress should NOT start a fresh timer.
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
});

describe("createStuckThinkingWatchdog — SW5 timer fires + logger discipline", () => {
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

  it("logger receives [achilles] line with waitedMs only — NEVER transcript or API key bytes (T-17-08)", () => {
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
    const matched = logs.find((line) =>
      line.includes("[achilles] stuck-thinking timer fired"),
    );
    expect(matched).toBeDefined();
    expect(matched).toContain("waitedMs=60000");
    // Defence-in-depth: the log line must never contain transcript
    // or key shapes. The grep guard in the verify command enforces
    // this at the source level; here we assert it on the runtime
    // line too.
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
  it("dispose() zeroes the onTimeout reference so even a stale firing path is a no-op", () => {
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
    // Manually invoke the captured cb — simulating a non-cooperative
    // host scheduler that fired the timer AFTER dispose().
    expect(capturedCb).not.toBeNull();
    capturedCb!();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("createStuckThinkingWatchdog — SW7 idempotency", () => {
  it("dispose() twice does not throw", () => {
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
});
