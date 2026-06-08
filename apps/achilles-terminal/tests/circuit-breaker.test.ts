/**
 * Phase 17, Plan 01, Task 2 — Behaviour tests for circuit-breaker.ts.
 *
 * Mirrors the v1.2 incident-detection.test.ts surface with the
 * CONTEXT.md-locked threshold defaults inlined. Every test injects
 * nowImpl + randomImpl deterministically; NO live network, NO real
 * clock reads.
 *
 * Test categories ported from the v1.2 source:
 *
 *   - Handle surface (attempt + status)
 *   - Discriminated AttemptOutcome shape
 *   - Success resets the consecutive-failure counter
 *   - auth/rate_limit opens IMMEDIATELY
 *   - Retryable failure accumulator opens at threshold
 *   - computeBackoffMs full-jitter math (4 sub-cases)
 *   - status() cooldown transition closed -> open -> half-open
 *   - classifyHttpError shape -> kind (5 sub-cases)
 *   - computeBackoffMs determinism (2 sub-cases)
 *   - Logger discipline (no secrets in log lines)
 *   - Two breakers operate independently
 *   - Open breaker short-circuits attempt without invoking fn
 *   - WR-04 attemptCount vs consecutiveFailures separation (4 sub-cases)
 *
 * Pure unit tests; no Electron, no fs, no http.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyHttpError,
  computeBackoffMs,
  createCircuitBreaker,
  type AttemptOutcome,
  type CircuitBreaker,
  type ClassifiedErrorKind,
} from "../src/circuit-breaker.js";

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

function fixedRandom(value: number): () => number {
  return () => value;
}

// ─────────────────────────────────────────────────────────────────────
// Handle surface — createCircuitBreaker returns {attempt, status}
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — handle surface", () => {
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
// Discriminated AttemptOutcome shape
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — discriminated outcome", () => {
  it("success has only `result`; failure has only `error`", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const okOutcome: AttemptOutcome<number> = await breaker.attempt(
      async () => 42,
    );
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
// Success resets the consecutive-failure counter
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — success resets counter", () => {
  it("a successful attempt zeroes consecutiveFailures even after prior 5xx failures", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("boom"), { status: 503 });
    });
    expect(breaker.status().consecutiveFailures).toBe(2);
    expect(breaker.status().state).toBe("closed");
    const ok = await breaker.attempt(async () => "ok");
    expect("result" in ok).toBe(true);
    expect(breaker.status().consecutiveFailures).toBe(0);
    expect(breaker.status().state).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// auth / rate_limit opens IMMEDIATELY
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — auth/rate_limit opens immediately", () => {
  it("a single 401 error opens the breaker (exhausted=true)", async () => {
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

  it("a single 429 error opens the breaker (exhausted=true)", async () => {
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
// Retryable failure accumulator opens at threshold
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — retryable accumulator opens at threshold", () => {
  it("opens after exactly maxConsecutiveFailures within windowMs", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      windowMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const failure = async (): Promise<AttemptOutcome<unknown>> => {
      return breaker.attempt(async () => {
        throw Object.assign(new Error("5xx"), { status: 502 });
      });
    };
    const a = await failure();
    expect("error" in a && a.exhausted).toBe(false);
    expect(breaker.status().state).toBe("closed");

    clock.advance(1_000);
    const b = await failure();
    expect("error" in b && b.exhausted).toBe(false);
    expect(breaker.status().state).toBe("closed");

    clock.advance(1_000);
    const c = await failure();
    expect("error" in c).toBe(true);
    if ("error" in c) {
      expect(c.exhausted).toBe(true);
      expect(c.attemptCount).toBe(1);
      expect(c.consecutiveFailures).toBeGreaterThanOrEqual(3);
    }
    expect(breaker.status().state).toBe("open");
  });

  it("failures separated by more than windowMs are evicted", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      maxConsecutiveFailures: 3,
      windowMs: 30_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    const failure = async (): Promise<AttemptOutcome<unknown>> => {
      return breaker.attempt(async () => {
        throw Object.assign(new Error("transient"), { code: "ECONNRESET" });
      });
    };
    await failure();
    clock.advance(30_001);
    await failure();
    clock.advance(30_001);
    await failure();
    expect(breaker.status().state).toBe("closed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// computeBackoffMs — full-jitter math
// ─────────────────────────────────────────────────────────────────────

describe("computeBackoffMs — full-jitter formula", () => {
  it("returns min(capMs, baseMs * 2^(attempt-1)) * randomImpl", () => {
    // attempt=1 -> exponential=250; capped=250; delay = 250 * 0.5 = 125
    expect(computeBackoffMs(1, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      125,
      5,
    );
    // attempt=2 -> exponential=500; delay=500*0.5=250
    expect(computeBackoffMs(2, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      250,
      5,
    );
    // attempt=3 -> exponential=1000; delay=1000*0.5=500
    expect(computeBackoffMs(3, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      500,
      5,
    );
    // attempt=10 -> exponential=128000 capped at 30000; delay=30000*0.5=15000
    expect(computeBackoffMs(10, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      15000,
      5,
    );
  });

  it("returns 0 when randomImpl yields 0 (full-jitter lower bound)", () => {
    expect(computeBackoffMs(5, 250, 30_000, fixedRandom(0))).toBe(0);
  });

  it("returns capMs when randomImpl yields 1 and attempt past saturation", () => {
    // attempt=20 -> exponential huge; capped=30000; random=1; delay=30000
    expect(computeBackoffMs(20, 250, 30_000, fixedRandom(1))).toBe(30_000);
  });

  it("clamps attempt<=0 to 1 (degenerate-input safety)", () => {
    expect(computeBackoffMs(0, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      125,
      5,
    );
    expect(computeBackoffMs(-3, 250, 30_000, fixedRandom(0.5))).toBeCloseTo(
      125,
      5,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// status() — closed -> open -> half-open with cooldown
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — cooldown state transitions", () => {
  it("after open, status transitions to half-open when cooldownMs elapses; successful probe re-closes", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().state).toBe("open");
    clock.advance(59_999);
    expect(breaker.status().state).toBe("open");
    clock.advance(2);
    expect(breaker.status().state).toBe("half-open");
    const probe = await breaker.attempt(async () => "ok");
    expect("result" in probe).toBe(true);
    expect(breaker.status().state).toBe("closed");
    expect(breaker.status().consecutiveFailures).toBe(0);
  });

  it("a failed half-open probe re-opens the breaker", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 60_000,
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
    clock.advance(60_001);
    expect(breaker.status().state).toBe("half-open");
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
// classifyHttpError — shape -> kind
// ─────────────────────────────────────────────────────────────────────

describe("classifyHttpError — shape-based classification", () => {
  it("HTTP 401 / 403 -> 'auth'", () => {
    expect(classifyHttpError({ status: 401 })).toBe<ClassifiedErrorKind>(
      "auth",
    );
    expect(classifyHttpError({ status: 403 })).toBe<ClassifiedErrorKind>(
      "auth",
    );
    expect(classifyHttpError({ statusCode: 401 })).toBe<ClassifiedErrorKind>(
      "auth",
    );
  });

  it("HTTP 429 -> 'rate_limit'", () => {
    expect(classifyHttpError({ status: 429 })).toBe<ClassifiedErrorKind>(
      "rate_limit",
    );
    expect(classifyHttpError({ statusCode: 429 })).toBe<ClassifiedErrorKind>(
      "rate_limit",
    );
  });

  it("HTTP 5xx -> 'server'", () => {
    expect(classifyHttpError({ status: 500 })).toBe<ClassifiedErrorKind>(
      "server",
    );
    expect(classifyHttpError({ status: 503 })).toBe<ClassifiedErrorKind>(
      "server",
    );
    expect(classifyHttpError({ status: 599 })).toBe<ClassifiedErrorKind>(
      "server",
    );
  });

  it("Node-socket codes -> 'network'", () => {
    expect(
      classifyHttpError({ code: "ECONNRESET" }),
    ).toBe<ClassifiedErrorKind>("network");
    expect(
      classifyHttpError({ code: "ETIMEDOUT" }),
    ).toBe<ClassifiedErrorKind>("network");
    expect(
      classifyHttpError({ code: "ENOTFOUND" }),
    ).toBe<ClassifiedErrorKind>("network");
    expect(
      classifyHttpError({ code: "ECONNREFUSED" }),
    ).toBe<ClassifiedErrorKind>("network");
  });

  it("unrecognised / null / non-object inputs -> 'unknown'", () => {
    expect(classifyHttpError(null)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError(undefined)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError("just a string")).toBe<ClassifiedErrorKind>(
      "unknown",
    );
    expect(classifyHttpError(42)).toBe<ClassifiedErrorKind>("unknown");
    expect(classifyHttpError({ status: 404 })).toBe<ClassifiedErrorKind>(
      "unknown",
    );
    expect(classifyHttpError({ code: "ENOENT" })).toBe<ClassifiedErrorKind>(
      "unknown",
    );
  });

  it("HTTP shape wins over Node code when both are present", () => {
    expect(
      classifyHttpError({ status: 401, code: "ECONNRESET" }),
    ).toBe<ClassifiedErrorKind>("auth");
  });
});

// ─────────────────────────────────────────────────────────────────────
// computeBackoffMs — determinism with fixed random
// ─────────────────────────────────────────────────────────────────────

describe("computeBackoffMs — determinism with fixed random", () => {
  it("(attempt=3, base=250, cap=30000, random=0.5) yields exactly 500", () => {
    expect(computeBackoffMs(3, 250, 30_000, fixedRandom(0.5))).toBe(500);
  });

  it("two calls with the same random + attempt return the same value", () => {
    const r = fixedRandom(0.25);
    const a = computeBackoffMs(4, 250, 30_000, r);
    const b = computeBackoffMs(4, 250, 30_000, r);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Logger discipline — no secrets / no transcripts in log lines
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — logger discipline", () => {
  it("log lines include label + kind + attempt + open boolean only; never the cause body", async () => {
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
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), {
        status: 503,
      });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), {
        status: 503,
      });
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error(`${SECRET} ${TRANSCRIPT}`), {
        status: 503,
      });
    });
    const blob = logs.join("\n");
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toContain(TRANSCRIPT);
    for (const line of logs) {
      expect(line.startsWith("[achilles]")).toBe(true);
      expect(line).toContain("circuit stt");
    }
    const openedLine = logs.find((l) => l.includes("opened=true"));
    expect(openedLine).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Two breakers are independent (label-isolated state)
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — two breakers are independent", () => {
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
    const ttsOk = await tts.attempt(async () => "tts up");
    expect("result" in ttsOk).toBe(true);
    expect(stt.status().state).toBe("open");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Open breaker short-circuits attempt without invoking fn
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — open breaker short-circuits", () => {
  it("attempt() while open + before cooldown returns exhausted=true and never invokes fn", async () => {
    const clock = makeClock();
    const breaker = createCircuitBreaker({
      label: "test",
      cooldownMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().state).toBe("open");
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

// ─────────────────────────────────────────────────────────────────────
// WR-04 — attemptCount + consecutiveFailures separately tracked
// ─────────────────────────────────────────────────────────────────────

describe("createCircuitBreaker — WR-04 split counters", () => {
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
      windowMs: 30_000,
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
      cooldownMs: 60_000,
      nowImpl: clock.now,
      randomImpl: fixedRandom(0.5),
    });
    await breaker.attempt(async () => {
      throw Object.assign(new Error("nope"), { status: 401 });
    });
    expect(breaker.status().consecutiveFailures).toBe(1);
    const fn = vi.fn(async () => "x");
    const outcome = await breaker.attempt(fn);
    expect(fn).not.toHaveBeenCalled();
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.attemptCount).toBe(0);
      expect(outcome.consecutiveFailures).toBe(1);
    }
  });

  it("auth failure reports attemptCount=1 and consecutiveFailures=1", async () => {
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
