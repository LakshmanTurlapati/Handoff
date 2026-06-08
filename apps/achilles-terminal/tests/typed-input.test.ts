/**
 * Phase 18, Plan 03, Task 3 — Tests for typed-input.ts.
 *
 * All tests use injected deps seams; no real circuit-breaker or real
 * @clack/prompts calls. Polling is controlled manually via a captured
 * callback reference (no real timer APIs needed). No emojis.
 */

import { describe, it, expect } from "vitest";
import {
  createTypedInputFallback,
  type TypedInputHandle,
  type TypedInputDeps,
} from "../src/typed-input.js";
import type { CircuitBreaker, CircuitStatus } from "../src/circuit-breaker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CircuitState = "closed" | "open" | "half-open";

function makeBreaker(state: CircuitState): CircuitBreaker {
  return {
    attempt: async (fn) => fn() as never,
    status: (): CircuitStatus => ({
      state,
      consecutiveFailures: 0,
      openedAt: state === "open" ? Date.now() : null,
    }),
  };
}

function makeDynamicBreaker(initialState: CircuitState): {
  breaker: CircuitBreaker;
  setState: (s: CircuitState) => void;
} {
  let currentState: CircuitState = initialState;
  const breaker: CircuitBreaker = {
    attempt: async (fn) => fn() as never,
    status: (): CircuitStatus => ({
      state: currentState,
      consecutiveFailures: 0,
      openedAt: currentState === "open" ? Date.now() : null,
    }),
  };
  return {
    breaker,
    setState: (s: CircuitState) => {
      currentState = s;
    },
  };
}

/**
 * Build a deps object that captures the interval callback for manual firing.
 * Returns the deps and a fire() function that manually invokes the callback
 * and returns a promise that resolves when the async onPoll chain completes.
 */
function makeManualDeps(
  overrides: Partial<TypedInputDeps>,
): {
  deps: TypedInputDeps;
  fire: () => Promise<void>;
  intervalRegistered: () => boolean;
} {
  let pollCallback: (() => void) | undefined;
  let cleared = false;

  const deps: TypedInputDeps = {
    pollIntervalMs: 500,
    setIntervalImpl: (fn, _ms) => {
      pollCallback = fn;
      return 0 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalImpl: (_id) => {
      cleared = true;
      pollCallback = undefined;
    },
    ...overrides,
  };

  return {
    deps,
    fire: async () => {
      if (!pollCallback) return;
      // Call the sync wrapper, which schedules async work via void
      pollCallback();
      // Drain the microtask queue multiple times to let promise chains settle
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    },
    intervalRegistered: () => !cleared && pollCallback !== undefined,
  };
}

describe("createTypedInputFallback", () => {
  it("does NOT prompt while breaker.status().state === 'closed'", async () => {
    const breaker = makeBreaker("closed");
    const promptCalls: string[] = [];

    const { deps, fire } = makeManualDeps({
      promptText: async (msg: string) => {
        promptCalls.push(msg);
        return "typed text";
      },
      isCancel: () => false,
    });

    const handle: TypedInputHandle = createTypedInputFallback(
      breaker,
      async () => {},
      deps,
    );

    await fire();
    await fire();

    expect(promptCalls.length).toBe(0);
    handle.dispose();
  });

  it("prompts via promptText when status transitions to 'open'", async () => {
    const { breaker, setState } = makeDynamicBreaker("closed");
    const promptCalls: string[] = [];

    const { deps, fire } = makeManualDeps({
      promptText: async (msg: string) => {
        promptCalls.push(msg);
        return "typed reply";
      },
      isCancel: () => false,
    });

    const handle: TypedInputHandle = createTypedInputFallback(
      breaker,
      async () => {},
      deps,
    );

    // Still closed — no prompts
    await fire();
    expect(promptCalls.length).toBe(0);

    // Open the breaker
    setState("open");
    await fire();
    expect(promptCalls.length).toBe(1);

    handle.dispose();
  });

  it("calls onTyped with the user-typed string", async () => {
    const breaker = makeBreaker("open");
    const typedValues: string[] = [];

    const { deps, fire } = makeManualDeps({
      promptText: async () => "hello world",
      isCancel: () => false,
    });

    const handle: TypedInputHandle = createTypedInputFallback(
      breaker,
      async (text) => {
        typedValues.push(text);
      },
      deps,
    );

    await fire();

    expect(typedValues).toContain("hello world");
    handle.dispose();
  });

  it("does NOT call onTyped when promptText returns isCancel symbol", async () => {
    const breaker = makeBreaker("open");
    const cancelSymbol = Symbol("cancel");
    const typedValues: string[] = [];

    const { deps, fire } = makeManualDeps({
      promptText: async () => cancelSymbol,
      isCancel: (v) => v === cancelSymbol,
    });

    const handle: TypedInputHandle = createTypedInputFallback(
      breaker,
      async (text) => {
        typedValues.push(text);
      },
      deps,
    );

    await fire();

    expect(typedValues.length).toBe(0);
    handle.dispose();
  });

  it("dispose() stops the poller", async () => {
    const breaker = makeBreaker("closed");
    let callbackCleared = false;

    const deps: TypedInputDeps = {
      pollIntervalMs: 500,
      promptText: async () => "typed",
      isCancel: () => false,
      setIntervalImpl: (_fn, _ms) => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalImpl: (_id) => {
        callbackCleared = true;
      },
    };

    const handle = createTypedInputFallback(breaker, async () => {}, deps);
    expect(callbackCleared).toBe(false);

    handle.dispose();
    expect(callbackCleared).toBe(true);
  });

  it("re-prompts on the next interval if breaker is still 'open' after onTyped resolves", async () => {
    const breaker = makeBreaker("open");
    let promptCallCount = 0;

    const { deps, fire } = makeManualDeps({
      promptText: async () => {
        promptCallCount++;
        return "text";
      },
      isCancel: () => false,
    });

    const handle = createTypedInputFallback(
      breaker,
      async () => {
        // onTyped resolves but breaker stays open
      },
      deps,
    );

    // First poll fires a prompt and completes the onTyped chain
    await fire();
    const countAfterFirst = promptCallCount;
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Second poll should fire another prompt (promptActive was reset by first)
    await fire();
    expect(promptCallCount).toBeGreaterThanOrEqual(2);

    handle.dispose();
  });
});
