/**
 * Plan 14-03 — Behaviour tests for incident-detection.ts.
 *
 * Twelve tests (ID1..ID12) covering the circuit breaker, the error
 * classifier, and the backoff math. Every test uses synthetic
 * injected error fixtures + deterministic seams (nowImpl, randomImpl,
 * classifyError) — NO live network, NO real clock reads.
 *
 *   ID1 : createCircuitBreaker returns a {attempt, status} handle.
 *   ID2 : attempt returns the discriminated AttemptOutcome shape.
 *   ID3 : success resets the consecutive-failure counter.
 *   ID4 : auth / rate_limit opens the breaker IMMEDIATELY.
 *   ID5 : retryable failures accumulate, breaker opens at threshold.
 *   ID6 : computeBackoffMs full-jitter integration via injected random.
 *   ID7 : status() transitions closed -> open -> half-open with cooldown.
 *   ID8 : classifyHttpError maps status / code to the right kinds.
 *   ID9 : computeBackoffMs deterministic when randomImpl is fixed.
 *   ID10: logger lines never include API key / transcript text.
 *   ID11: two breakers operate independently (label-isolated state).
 *   ID12: open breaker short-circuits attempt without invoking fn.
 *
 * The tests are pure unit tests — no Electron, no fs, no http.
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyHttpError,
  computeBackoffMs,
  createCircuitBreaker,
  type AttemptOutcome,
  type CircuitBreaker,
  type ClassifiedErrorKind,
} from "./incident-detection.js";

/**
 * Builds a controllable nowImpl harness. The harness owns a single
 * mutable value; calls return the current value, and `advance(ms)`
 * pushes the clock forward.
 */
function makeClock(initial = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Fixed-value randomImpl helper. Returns the supplied value on every
 * call so backoff math is deterministic.
 */
function fixedRandom(value: number): () => number {
  return () => value;
}

// ─────────────────────────────────────────────────────────────────────
// ID1 — createCircuitBreaker returns a {attempt, status} handle
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID1 handle surface", () => {
  it("returns an object exposing attempt() and status()", () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    expect(typeof breaker.attempt).toBe("function");
    expect(typeof breaker.status).toBe("function");
    expect(breaker.status().state).toBe("closed");
    expect(breaker.status().consecutiveFailures).toBe(0);
    expect(breaker.status().openedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID2 — attempt returns the discriminated AttemptOutcome shape
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID2 attempt returns discriminated outcome", () => {
  it("success outcome has only `result` (no `error` field) and failure has only `error` (no `result` field)", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const okOutcome: AttemptOutcome<number> = await breaker.attempt(async () => 42);
    expect("result" in okOutcome).toBe(true);
    expect("error" in okOutcome).toBe(false);
    if ("result" in okOutcome) {
      expect(okOutcome.result).toBe(42);
    }
    const failOutcome = await breaker.attempt(async () => {
      throw Object.assign(new Error("server boom"), { status: 503 });
    });
    expect("error" in failOutcome).toBe(true);
    expect("result" in failOutcome).toBe(false);
    if ("error" in failOutcome) {
      expect(failOutcome.error.kind).toBe("server");
      expect(failOutcome.attemptCount).toBe(1);
      expect(failOutcome.exhausted).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID3 — success resets the consecutive-failure counter
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID3 success resets failure counter", () => {
  it("a successful attempt zeroes consecutiveFailures even after prior 5xx failures", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    // Two failures: counter at 2 but circuit still closed.
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    expect(breaker.status().consecutiveFailures).toBe(2);
    expect(breaker.status().state).toBe("closed");
    // Success — counter resets to 0.
    const ok = await breaker.attempt(async () => "ok");
    expect("result" in ok).toBe(true);
    expect(breaker.status().consecutiveFailures).toBe(0);
    expect(breaker.status().state).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID4 — auth / rate_limit opens IMMEDIATELY
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID4 non-retryable kinds open the breaker", () => {
  it("a single 401 error opens the breaker (exhausted=true) and returns kind='auth'", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "stt",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const outcome = await breaker.attempt(async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error.kind).toBe("auth");
      expect(outcome.attemptCount).toBe(1);
      expect(outcome.exhausted).toBe(true);
    }
    expect(breaker.status().state).toBe("open");
  });

  it("a single 429 error opens the breaker (exhausted=true) and returns kind='rate_limit'", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "tts",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const outcome = await breaker.attempt(async () => {
      throw Object.assign(new Error("Too Many Requests"), { status: 429 });
    });
    if ("error" in outcome) {
      expect(outcome.error.kind).toBe("rate_limit");
      expect(outcome.exhausted).toBe(true);
    }
    expect(breaker.status().state).toBe("open");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID5 — retryable failures accumulate, breaker opens at threshold
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID5 retryable failure accumulator opens at threshold", () => {
  it("opens after exactly maxConsecutiveFailures within the window; earlier failures are not exhausted", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      windowMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const failure = async (): Promise<AttemptOutcome<unknown>> => {
      return breaker.attempt(async () => {
        throw Object.assign(new Error("5xx"), { status: 502 });
      });
    };
    // First two failures: NOT exhausted, circuit still closed.
    const a = await failure();
    expect("error" in a && a.exhausted).toBe(false);
    expect(breaker.status().state).toBe("closed");

    clock.advance(1_000);
    const b = await failure();
    expect("error" in b && b.exhausted).toBe(false);
    expect(breaker.status().state).toBe("closed");

    // Third failure: opens the circuit, exhausted=true.
    clock.advance(1_000);
    const c = await failure();
    expect("error" in c).toBe(true);
    if ("error" in c) {
      expect(c.exhausted).toBe(true);
      // WR-04 fix: attemptCount is the within-attempt counter (fn was
      // invoked exactly once inside this attempt() call). The
      // across-attempt counter that previously lived in attemptCount
      // is now exposed via the separate consecutiveFailures field.
      expect(c.attemptCount).toBe(1);
      expect(c.consecutiveFailures).toBeGreaterThanOrEqual(3);
    }
    expect(breaker.status().state).toBe("open");
  });

  it("failures separated by more than windowMs are evicted and do NOT cumulatively trip the breaker", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      windowMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const failure = async (): Promise<AttemptOutcome<unknown>> => {
      return breaker.attempt(async () => {
        throw Object.assign(new Error("transient"), { code: "ECONNRESET" });
      });
    };
    await failure();
    clock.advance(60_001); // beyond window
    await failure();
    clock.advance(60_001);
    await failure();
    // Although three failures occurred, no two fell inside the same
    // window, so the breaker stays closed.
    expect(breaker.status().state).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID6 — computeBackoffMs (full-jitter integration via injected random)
// ─────────────────────────────────────────────────────────────────────

describe("computeBackoffMs — ID6 full-jitter formula", () => {
  it("returns min(capMs, baseMs * 2^(attempt-1)) * randomImpl", () => {
    // attempt=1 -> exponential=baseMs; capped at min(baseMs, capMs)=baseMs
    // delay = baseMs * 0.5
    expect(computeBackoffMs(1, 250, 5000, fixedRandom(0.5))).toBeCloseTo(125, 5);
    // attempt=2 -> exponential=500; capped=min(500, 5000)=500; delay=500*0.5=250
    expect(computeBackoffMs(2, 250, 5000, fixedRandom(0.5))).toBeCloseTo(250, 5);
    // attempt=3 -> exponential=1000; delay=1000*0.5=500
    expect(computeBackoffMs(3, 250, 5000, fixedRandom(0.5))).toBeCloseTo(500, 5);
    // attempt=10 -> exponential=128000 capped at 5000; delay=5000*0.5=2500
    expect(computeBackoffMs(10, 250, 5000, fixedRandom(0.5))).toBeCloseTo(2500, 5);
  });

  it("returns 0 when randomImpl yields 0 (full-jitter lower bound)", () => {
    expect(computeBackoffMs(5, 250, 5000, fixedRandom(0))).toBe(0);
  });

  it("returns capMs when randomImpl yields 1 and attempt is past the cap saturation point", () => {
    // attempt=20 -> exponential huge; capped=5000; randomImpl=1; delay=5000
    expect(computeBackoffMs(20, 250, 5000, fixedRandom(1))).toBe(5000);
  });

  it("clamps attempt<=0 to 1 (degenerate-input safety)", () => {
    expect(computeBackoffMs(0, 250, 5000, fixedRandom(0.5))).toBeCloseTo(125, 5);
    expect(computeBackoffMs(-3, 250, 5000, fixedRandom(0.5))).toBeCloseTo(125, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID7 — status() transitions closed -> open -> half-open with cooldown
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID7 cooldown state transitions", () => {
  it("after open, status transitions to half-open when cooldownMs elapses; a successful probe re-closes", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    // Trip the breaker via a single 401.
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().state).toBe("open");
    // Before cooldown elapses, status() still reports 'open'.
    clock.advance(29_999);
    expect(breaker.status().state).toBe("open");
    // After cooldown, status() reports 'half-open' (the next attempt
    // is a probe).
    clock.advance(2);
    expect(breaker.status().state).toBe("half-open");
    // A successful probe re-closes.
    const probe = await breaker.attempt(async () => "ok");
    expect("result" in probe).toBe(true);
    expect(breaker.status().state).toBe("closed");
    expect(breaker.status().consecutiveFailures).toBe(0);
  });

  it("a failed half-open probe re-opens the breaker", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    expect(breaker.status().state).toBe("open");
    clock.advance(30_001);
    expect(breaker.status().state).toBe("half-open");
    // Probe fails; breaker re-opens.
    const probe = await breaker.attempt(async () => {
      throw Object.assign(new Error("still broken"), { status: 503 });
    });
    expect("error" in probe).toBe(true);
    if ("error" in probe) {
      expect(probe.exhausted).toBe(true);
    }
    expect(breaker.status().state).toBe("open");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID8 — classifyHttpError maps shape to kind
// ─────────────────────────────────────────────────────────────────────

describe("classifyHttpError — ID8 shape-based classification", () => {
  it("HTTP 401 / 403 -> 'auth'", () => {
    expect(classifyHttpError({ status: 401 })).toBe<ClassifiedErrorKind>("auth");
    expect(classifyHttpError({ status: 403 })).toBe<ClassifiedErrorKind>("auth");
    expect(classifyHttpError({ statusCode: 401 })).toBe<ClassifiedErrorKind>("auth");
  });

  it("HTTP 429 -> 'rate_limit'", () => {
    expect(classifyHttpError({ status: 429 })).toBe<ClassifiedErrorKind>("rate_limit");
    expect(classifyHttpError({ statusCode: 429 })).toBe<ClassifiedErrorKind>(
      "rate_limit",
    );
  });

  it("HTTP 5xx -> 'server'", () => {
    expect(classifyHttpError({ status: 500 })).toBe<ClassifiedErrorKind>("server");
    expect(classifyHttpError({ status: 503 })).toBe<ClassifiedErrorKind>("server");
    expect(classifyHttpError({ status: 599 })).toBe<ClassifiedErrorKind>("server");
  });

  it("Node-socket codes -> 'network'", () => {
    expect(classifyHttpError({ code: "ECONNRESET" })).toBe<ClassifiedErrorKind>(
      "network",
    );
    expect(classifyHttpError({ code: "ETIMEDOUT" })).toBe<ClassifiedErrorKind>(
      "network",
    );
    expect(classifyHttpError({ code: "ENOTFOUND" })).toBe<ClassifiedErrorKind>(
      "network",
    );
    expect(classifyHttpError({ code: "ECONNREFUSED" })).toBe<ClassifiedErrorKind>(
      "network",
    );
  });

  it("unrecognised / null / non-object inputs -> 'unknown'", () => {
    expect(classifyHttpError(null)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError(undefined)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError("just a string")).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError(42)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError({ status: 404 })).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError({ code: "ENOENT" })).toBe<ClassifiedErrorKind>("unknown");
  });

  it("HTTP shape wins over Node code when both are present", () => {
    // A wrapper error with both shapes should classify as auth (HTTP wins).
    expect(
      classifyHttpError({ status: 401, code: "ECONNRESET" }),
    ).toBe<ClassifiedErrorKind>("auth");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID9 — computeBackoffMs is deterministic with fixed randomImpl
// ─────────────────────────────────────────────────────────────────────

describe("computeBackoffMs — ID9 determinism with fixed random", () => {
  it("(attempt=3, base=250, cap=5000, random=0.5) yields exactly 500 ms", () => {
    expect(computeBackoffMs(3, 250, 5000, fixedRandom(0.5))).toBe(500);
  });

  it("two calls with the same random + attempt return the same value (no hidden state)", () => {
    const r = fixedRandom(0.25);
    const a = computeBackoffMs(4, 250, 5000, r);
    const b = computeBackoffMs(4, 250, 5000, r);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID10 — logger lines never include API key / transcript text
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID10 logger discipline (no secrets, no transcripts)", () => {
  it("log lines include label + kind + attempt + open boolean ONLY; never the cause body", async () => {
    const clock = makeClock();
    const logs: string[] = [];
    const breaker = createCircuitBreaker({
      label: "stt",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
      logger: (msg) => logs.push(msg),
    });
    const SECRET = "xi-mock-api-key-1234567890123456";
    const TRANSCRIPT = "DESTRUCTIVE-USER-PHRASE-XYZ";
    // The cause carries both the secret and the transcript fragment;
    // neither should appear in the log lines.
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), { status: 503 });
    });
    const blob = logs.join("\n");
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(TRANSCRIPT);
    // Positive shape assertion — each line starts with [achilles] and
    // includes the label + kind.
    for (const line of logs) {
      expect(line.startsWith("[achilles]")).toBe(true);
      expect(line).toContain("circuit stt");
    }
    // The line that opened the circuit has opened=true.
    const openedLine = logs.find((l) => l.includes("opened=true"));
    expect(openedLine).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID11 — two breakers operate independently
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID11 two breakers are independent", () => {
  it("opening the STT breaker leaves the TTS breaker closed", async () => {
    const clock = makeClock();
    const stt: CircuitBreaker = createCircuitBreaker({
      label: "stt",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const tts: CircuitBreaker = createCircuitBreaker({
      label: "tts",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await stt.attempt(async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });
    expect(stt.status().state).toBe("open");
    expect(tts.status().state).toBe("closed");
    // A successful TTS attempt does NOT affect the STT breaker.
    const ttsOk = await tts.attempt(async () => "tts up");
    expect("result" in ttsOk).toBe(true);
    expect(stt.status().state).toBe("open");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ID12 — open breaker short-circuits attempt without invoking fn
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — ID12 open breaker short-circuits", () => {
  it("attempt() while open + before cooldown returns exhausted=true and never invokes fn", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    // Trip the breaker.
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().state).toBe("open");
    // Subsequent attempt does NOT invoke fn.
    const fn = vi.fn(async () => "should not run");
    const outcome = await breaker.attempt(fn);
    expect(fn).not.toHaveBeenCalled();
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.exhausted).toBe(true);
      expect(outcome.attemptCount).toBe(0);
    }
  });
});

describe("createCircuitBreaker — WR-04 attemptCount and consecutiveFailures are separately tracked", () => {
  // WR-04 regression. Prior to the fix, attemptCount on AttemptFailure was
  // overloaded to mean both "fn invocations inside this attempt() call"
  // (always 0 or 1 for the v1.2 breaker) AND "failures across attempt() calls
  // in the sliding window" (the consecutiveFailures counter). An orchestrator
  // observing attemptCount=3 could not tell whether fn was invoked 3 times
  // inside ONE attempt() or once each in THREE attempt() calls. After WR-04
  // the two counters are exposed separately on AttemptFailure.

  it("a single retryable failure reports attemptCount=1 and consecutiveFailures=1", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const outcome = await breaker.attempt(async () => {
      throw Object.assign(new Error("5xx"), { status: 503 });
    });
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.attemptCount).toBe(1);
      expect(outcome.consecutiveFailures).toBe(1);
      expect(outcome.exhausted).toBe(false);
    }
  });

  it("three consecutive retryable failures report attemptCount=1 each but consecutiveFailures grows 1,2,3", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      windowMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const failure = async (): Promise<AttemptOutcome<unknown>> => {
      return breaker.attempt(async () => {
        throw Object.assign(new Error("5xx"), { status: 503 });
      });
    };
    const a = await failure();
    const b = await failure();
    const c = await failure();
    expect("error" in a && a.attemptCount).toBe(1);
    expect("error" in b && b.attemptCount).toBe(1);
    expect("error" in c && c.attemptCount).toBe(1);
    expect("error" in a && a.consecutiveFailures).toBe(1);
    expect("error" in b && b.consecutiveFailures).toBe(2);
    expect("error" in c && c.consecutiveFailures).toBe(3);
  });

  it("short-circuit path reports attemptCount=0 and consecutiveFailures unchanged", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    // Auth failure opens immediately, consecutiveFailures = 1.
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().consecutiveFailures).toBe(1);
    // Short-circuit: fn not invoked.
    const fn = vi.fn(async () => "x");
    const outcome = await breaker.attempt(fn);
    expect(fn).not.toHaveBeenCalled();
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.attemptCount).toBe(0);
      // consecutiveFailures snapshots the across-attempt counter at
      // the short-circuit boundary; unchanged by the short-circuit
      // itself (the auth failure is what made it 1).
      expect(outcome.consecutiveFailures).toBe(1);
    }
  });

  it("auth failure reports attemptCount=1 (fn invoked once) and consecutiveFailures=1", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "stt",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const outcome = await breaker.attempt(async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error.kind).toBe("auth");
      expect(outcome.attemptCount).toBe(1);
      expect(outcome.consecutiveFailures).toBe(1);
    }
  });
});
