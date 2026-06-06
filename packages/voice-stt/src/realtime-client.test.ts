import {
  PartialTranscriptSchema,
  type SttEvent,
} from "@achilles/voice-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECONNECT_MAX_ATTEMPTS,
  STT_REALTIME_URL,
} from "./constants.js";
import { createStubWebSocket } from "../test/fixtures/mock-elevenlabs-server.js";
import { createRealtimeSttClient } from "./realtime-client.js";

/**
 * Drain `events$` into an in-memory array, with an early-exit predicate.
 * Returns once `predicate(event)` returns true for some event or after
 * `maxEvents` events are collected.
 */
async function collectUntil(
  iterable: AsyncIterable<SttEvent>,
  predicate: (event: SttEvent) => boolean,
  maxEvents = 50,
): Promise<SttEvent[]> {
  const out: SttEvent[] = [];
  for await (const ev of iterable) {
    out.push(ev);
    if (predicate(ev)) {
      return out;
    }
    if (out.length >= maxEvents) {
      return out;
    }
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRealtimeSttClient — construction surface (SAFE-01)", () => {
  it("returns events$, start, stop, and write — and the type signature has no apiKey field", () => {
    const stub = createStubWebSocket();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_a",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });
    expect(client.events$).toBeDefined();
    expect(typeof client.start).toBe("function");
    expect(typeof client.stop).toBe("function");
    expect(typeof client.write).toBe("function");

    // Defence in depth: the runtime object should not carry any apiKey
    // surface either. This protects against a future refactor that
    // accidentally leaks the SAFE-01 boundary into the returned client.
    expect((client as { apiKey?: unknown }).apiKey).toBeUndefined();
  });
});

describe("createRealtimeSttClient — start lifecycle", () => {
  it("calls getToken exactly once on start and constructs a WebSocket against STT_REALTIME_URL", async () => {
    const stub = createStubWebSocket();
    const getToken = vi.fn(async () => ({
      token: "tok_b",
      expiresAt: "2099-01-01T00:00:00Z",
    }));
    const client = createRealtimeSttClient({
      getToken,
      webSocketCtor: stub.ctor,
    });

    await client.start();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(stub.lastUrl()).toBe(STT_REALTIME_URL);
    // The single-use token rides in the WebSocket subprotocol position.
    const protocols = stub.lastProtocols();
    expect(Array.isArray(protocols)).toBe(true);
    expect(protocols as string[]).toContain("tok_b");
  });
});

describe("createRealtimeSttClient — server message handling", () => {
  it("emits a parsed PartialTranscript on partial_transcript (schema-validated)", async () => {
    const stub = createStubWebSocket();
    const parseSpy = vi.spyOn(PartialTranscriptSchema, "safeParse");
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_c",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });

    await client.start();
    const inst = stub.current();
    expect(inst).not.toBeNull();
    inst?.__fire({ type: "open" });
    inst?.__fire({
      type: "message",
      data: JSON.stringify({
        type: "partial_transcript",
        text: "hello",
        confidence: 0.91,
      }),
    });

    const events = await collectUntil(
      client.events$,
      (e) => e.type === "partial",
    );
    const partial = events.find((e) => e.type === "partial");
    expect(partial).toBeDefined();
    expect(partial).toMatchObject({
      type: "partial",
      text: "hello",
      confidence: 0.91,
    });
    // The wrapper goes through PartialTranscriptSchema.safeParse on
    // every partial — proven by the spy hit.
    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockRestore();

    await client.stop();
  });

  it("emits a CommittedTranscript with durationMs from the server's duration_ms field", async () => {
    const stub = createStubWebSocket();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_d",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });
    await client.start();
    const inst = stub.current();
    inst?.__fire({ type: "open" });
    inst?.__fire({
      type: "message",
      data: JSON.stringify({
        type: "committed_transcript",
        text: "hello world",
        duration_ms: 4500,
      }),
    });

    const events = await collectUntil(
      client.events$,
      (e) => e.type === "committed",
    );
    const committed = events.find((e) => e.type === "committed");
    expect(committed).toMatchObject({
      type: "committed",
      text: "hello world",
      durationMs: 4500,
    });

    await client.stop();
  });
});

describe("createRealtimeSttClient — reconnect lifecycle (PITFALLS #4)", () => {
  it("schedules a reconnect after an abnormal close (code 1006) within the computeBackoffMs(0) window", async () => {
    const stub = createStubWebSocket();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_e",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });
    await client.start();
    expect(stub.constructionCount()).toBe(1);
    const inst = stub.current();
    inst?.__fire({ type: "close", code: 1006 });

    // Advance fake timers past the computeBackoffMs(0) upper bound +
    // 50 ms slack.
    await vi.advanceTimersByTimeAsync(300);
    // Allow any pending microtasks (the reconnect path awaits getToken).
    await vi.runOnlyPendingTimersAsync();

    expect(stub.constructionCount()).toBeGreaterThanOrEqual(2);

    await client.stop();
  });

  it("after RECONNECT_MAX_ATTEMPTS consecutive close events emits a terminal `network` error with retryable=false", async () => {
    const stub = createStubWebSocket();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_f",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });
    await client.start();
    // Fire MAX_ATTEMPTS + 1 abnormal closes, advancing the backoff
    // timers in between so the wrapper actually retries.
    for (let i = 0; i < RECONNECT_MAX_ATTEMPTS + 1; i += 1) {
      const inst = stub.current();
      inst?.__fire({ type: "close", code: 1006 });
      await vi.advanceTimersByTimeAsync(5000);
      await vi.runOnlyPendingTimersAsync();
    }
    const events = await collectUntil(
      client.events$,
      (e) => e.type === "error" && e.code === "network",
    );
    const terminal = events.find(
      (e) => e.type === "error" && e.code === "network",
    );
    expect(terminal).toBeDefined();
    expect(terminal).toMatchObject({
      type: "error",
      code: "network",
      retryable: false,
    });
  });

  it("maps a server error with status='too_many_concurrent_requests' to code=concurrent_limit and retryable=true", async () => {
    const stub = createStubWebSocket();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_g",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: stub.ctor,
    });
    await client.start();
    const inst = stub.current();
    inst?.__fire({ type: "open" });
    inst?.__fire({
      type: "message",
      data: JSON.stringify({
        type: "error",
        status: "too_many_concurrent_requests",
      }),
    });

    const events = await collectUntil(
      client.events$,
      (e) => e.type === "error" && e.code === "concurrent_limit",
    );
    const concurrent = events.find(
      (e) => e.type === "error" && e.code === "concurrent_limit",
    );
    expect(concurrent).toMatchObject({
      type: "error",
      code: "concurrent_limit",
      retryable: true,
    });

    await client.stop();
  });
});

describe("createRealtimeSttClient — stop", () => {
  it("closes the WebSocket cleanly on stop()", async () => {
    const stub = createStubWebSocket();
    const closeSpy = vi.fn();
    const client = createRealtimeSttClient({
      getToken: async () => ({
        token: "tok_h",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
      webSocketCtor: (url, protocols) => {
        const sock = stub.ctor(url, protocols);
        // Wrap close to record the invocation while preserving the
        // stub's recording behaviour.
        const orig = sock.close.bind(sock);
        sock.close = (code, reason) => {
          closeSpy(code, reason);
          orig(code, reason);
        };
        return sock;
      },
    });

    await client.start();
    await client.stop();
    expect(closeSpy).toHaveBeenCalled();
  });
});
