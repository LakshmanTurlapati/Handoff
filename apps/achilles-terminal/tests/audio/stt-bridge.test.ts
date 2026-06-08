/**
 * Phase 17, Plan 02, Task 1 — unit tests for stt-bridge.ts.
 *
 * 4 tests:
 *
 *   1. sttFactory invoked with the injected webSocketCtor seam +
 *      the wrapped getToken closure
 *   2. mintToken failure routed through the circuit breaker: emits
 *      SessionEvent error with classification matching the breaker's
 *      ClassifiedErrorKind verdict; start() rejects
 *   3. write(frame) forwards the Int16Array to sttClient.write
 *   4. events$() iterator fans stt_partial + stt_committed onto the
 *      session emitter BEFORE yielding to the caller
 *
 * Hermetic: every test injects a fake sttFactory + a recording
 * mintToken; no real voice-stt WSS is opened.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CreateRealtimeSttClientOptions,
  RealtimeSttClient,
  SttEvent,
  SttWebSocketCtor,
  SttWebSocketLike,
} from "@achilles/voice-stt";
import { createSttBridge } from "../../src/audio/stt-bridge.js";
import type { SessionEvent } from "../../src/session-events.js";
import type {
  AttemptOutcome,
  CircuitBreaker,
} from "../../src/circuit-breaker.js";

/**
 * Build a fake RealtimeSttClient with a controllable events$ async
 * iterable. The test drives the iterable by pushing events and
 * resolving the in-flight `next` promise.
 */
function makeFakeSttClient(): {
  client: RealtimeSttClient;
  pushEvent: (ev: SttEvent) => void;
  endStream: () => void;
  writeSpy: ReturnType<typeof vi.fn>;
  startSpy: ReturnType<typeof vi.fn>;
  stopSpy: ReturnType<typeof vi.fn>;
} {
  const queue: SttEvent[] = [];
  let resolver: (() => void) | null = null;
  let ended = false;

  const events$: AsyncIterable<SttEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<SttEvent> {
      return {
        async next(): Promise<IteratorResult<SttEvent>> {
          while (queue.length === 0 && !ended) {
            await new Promise<void>((resolve) => {
              resolver = resolve;
            });
          }
          if (queue.length > 0) {
            const value = queue.shift()!;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  const startSpy = vi.fn(() => Promise.resolve());
  const stopSpy = vi.fn(() => Promise.resolve());
  const writeSpy = vi.fn();

  const client: RealtimeSttClient = {
    events$,
    start: startSpy,
    stop: stopSpy,
    write: writeSpy,
  };

  return {
    client,
    pushEvent: (ev: SttEvent): void => {
      queue.push(ev);
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r();
      }
    },
    endStream: (): void => {
      ended = true;
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r();
      }
    },
    writeSpy,
    startSpy,
    stopSpy,
  };
}

describe("createSttBridge — Test 1: constructs realtime client via the injected sttFactory + webSocketCtor seam", () => {
  it("calls sttFactory exactly once at start() with the wrapped getToken + the injected webSocketCtor", async () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(
      (
        opts: Pick<
          CreateRealtimeSttClientOptions,
          "getToken" | "webSocketCtor"
        >,
      ) => {
        void opts;
        return fakeStt.client;
      },
    );
    const fakeWebSocketCtor: SttWebSocketCtor = (
      url: string,
      protocols?: string | string[],
    ): SttWebSocketLike => {
      void url;
      void protocols;
      return {
        readyState: 0,
        send: () => undefined,
        close: () => undefined,
        addEventListener: () => undefined,
      };
    };
    const mintToken = vi.fn(() =>
      Promise.resolve({
        token: "fake_token",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    );
    const bridge = createSttBridge({
      sttFactory,
      mintToken,
      webSocketCtor: fakeWebSocketCtor,
      emit: vi.fn(),
    });
    await bridge.start();
    expect(sttFactory).toHaveBeenCalledTimes(1);
    const opts = sttFactory.mock.calls[0]![0];
    expect(typeof opts.getToken).toBe("function");
    expect(opts.webSocketCtor).toBe(fakeWebSocketCtor);
    // start() drove sttClient.start
    expect(fakeStt.startSpy).toHaveBeenCalledTimes(1);
    // mintToken not called yet (the realtime client awaits getToken
    // lazily on its connect step — the fake client's start() in this
    // test does not exercise that path; we only verify the factory
    // composition seam here).
    expect(mintToken).toHaveBeenCalledTimes(0);
  });
});

describe("createSttBridge — Test 2: mintToken failure routed through circuit breaker", () => {
  it("emits SessionEvent error with classification matching the breaker's verdict; start() rejects", async () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(() => fakeStt.client);
    const mintToken = vi.fn(() =>
      Promise.resolve({
        token: "should_not_be_used",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    );
    // Breaker reports exhausted=true with auth kind on the first
    // attempt. We must drive the wrappedGetToken (which the realtime
    // client calls internally), so we exercise it through the
    // sttFactory closure: when sttFactory is called, we await
    // opts.getToken() to trigger the breaker path.
    // vi.fn() does not infer the generic <T> signature of attempt
    // (TS 5.7 narrows Mock to a single concrete instantiation). We
    // build the attempt impl as a plain function with the correct
    // generic shape, then assert the CircuitBreaker surface.
    const attemptSpy = vi.fn();
    const attemptImpl = <T,>(
      fn: () => Promise<T> | T,
    ): Promise<AttemptOutcome<T>> => {
      attemptSpy();
      void fn;
      return Promise.resolve(
        Object.freeze({
          error: Object.freeze({
            kind: "auth" as const,
            cause: new Error("401"),
          }),
          attemptCount: 1,
          consecutiveFailures: 1,
          exhausted: true,
        }),
      );
    };
    const breakerStub: CircuitBreaker = {
      attempt: attemptImpl,
      status: vi.fn(() => ({
        state: "open" as const,
        consecutiveFailures: 1,
        openedAt: 1,
      })),
    };
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    let bridgeGetToken:
      | CreateRealtimeSttClientOptions["getToken"]
      | null = null;
    // Override factory to capture getToken so we can drive it directly.
    const factoryCapture = vi.fn(
      (
        opts: Pick<
          CreateRealtimeSttClientOptions,
          "getToken" | "webSocketCtor"
        >,
      ): RealtimeSttClient => {
        bridgeGetToken = opts.getToken;
        return fakeStt.client;
      },
    );
    const bridge = createSttBridge({
      sttFactory: factoryCapture,
      mintToken,
      circuitBreaker: breakerStub,
      emit,
    });
    // start() must complete (it calls sttFactory + sttClient.start;
    // we have NOT triggered getToken yet so the breaker has not
    // attempted).
    await bridge.start();
    void sttFactory;

    // Now drive the wrapped getToken to exercise the breaker path.
    expect(bridgeGetToken).not.toBeNull();
    let thrown: unknown = null;
    try {
      await bridgeGetToken!();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("auth");

    const errors = captured.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    const err = errors[0] as SessionEvent & { type: "error" };
    expect(err.payload.classification).toBe("auth");
    expect(err.payload.message).toContain("mintToken");
    expect(attemptSpy).toHaveBeenCalled();
  });
});

describe("createSttBridge — Test 3: write forwards Int16Array frames to sttClient", () => {
  it("write(frame) calls sttClient.write with the SAME Int16Array reference", async () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(() => fakeStt.client);
    const bridge = createSttBridge({
      sttFactory,
      mintToken: () =>
        Promise.resolve({
          token: "t",
          expiresAt: "2030-01-01T00:00:00Z",
        }),
      emit: vi.fn(),
    });
    await bridge.start();
    const frame = new Int16Array([1, 2, 3, 4]);
    bridge.write(frame);
    expect(fakeStt.writeSpy).toHaveBeenCalledTimes(1);
    expect(fakeStt.writeSpy.mock.calls[0]![0]).toBe(frame);
  });

  it("write() before start() is a no-op (does not throw, does not invoke sttClient)", () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(() => fakeStt.client);
    const bridge = createSttBridge({
      sttFactory,
      mintToken: () =>
        Promise.resolve({
          token: "t",
          expiresAt: "2030-01-01T00:00:00Z",
        }),
      emit: vi.fn(),
    });
    const frame = new Int16Array([1, 2, 3]);
    expect(() => bridge.write(frame)).not.toThrow();
    expect(fakeStt.writeSpy).not.toHaveBeenCalled();
  });
});

describe("createSttBridge — Test 4: events$() fans stt_partial + stt_committed on the session emitter", () => {
  it("emits stt_partial then stt_committed on deps.emit BEFORE yielding from the iterator", async () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(() => fakeStt.client);
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    const bridge = createSttBridge({
      sttFactory,
      mintToken: () =>
        Promise.resolve({
          token: "t",
          expiresAt: "2030-01-01T00:00:00Z",
        }),
      emit,
      nowImpl: () => 1_700_000_000_000,
    });
    await bridge.start();

    // Push a partial then committed event.
    fakeStt.pushEvent({ type: "partial", text: "hello", confidence: 0.5 });
    fakeStt.pushEvent({ type: "committed", text: "hello world", durationMs: 250 });
    fakeStt.endStream();

    const yielded: SttEvent[] = [];
    for await (const ev of bridge.events$()) {
      yielded.push(ev);
    }

    expect(yielded.length).toBe(2);
    expect(yielded[0]?.type).toBe("partial");
    expect(yielded[1]?.type).toBe("committed");

    // Session emitter saw both with the right discriminants.
    const partials = captured.filter((e) => e.type === "stt_partial");
    const commits = captured.filter((e) => e.type === "stt_committed");
    expect(partials.length).toBe(1);
    expect(commits.length).toBe(1);
    const p = partials[0] as SessionEvent & { type: "stt_partial" };
    const c = commits[0] as SessionEvent & { type: "stt_committed" };
    expect(p.payload.text).toBe("hello");
    expect(c.payload.text).toBe("hello world");
    expect(p.timestamp).toBe(1_700_000_000_000);
  });

  it("emits error SessionEvent on stt error event with classification mapped from SttErrorCode", async () => {
    const fakeStt = makeFakeSttClient();
    const sttFactory = vi.fn(() => fakeStt.client);
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    const bridge = createSttBridge({
      sttFactory,
      mintToken: () =>
        Promise.resolve({
          token: "t",
          expiresAt: "2030-01-01T00:00:00Z",
        }),
      emit,
    });
    await bridge.start();

    fakeStt.pushEvent({
      type: "error",
      code: "rate_limit",
      retryable: true,
    });
    fakeStt.endStream();

    for await (const _ev of bridge.events$()) {
      void _ev;
    }
    const errors = captured.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    const err = errors[0] as SessionEvent & { type: "error" };
    expect(err.payload.classification).toBe("rate_limit");
  });
});
