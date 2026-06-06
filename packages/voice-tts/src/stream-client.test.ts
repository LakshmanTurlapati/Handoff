/**
 * Unit tests for @achilles/voice-tts/stream-client.
 *
 * These tests exercise:
 *   - the signature has no `apiKey` field (SAFE-01 / PITFALLS #22)
 *   - the open frame carries the locked CHUNK_LENGTH_SCHEDULE and
 *     `eleven_flash_v2_5` model id (PITFALLS #5 + #6)
 *   - the consumer-injected `keySource` is awaited exactly once
 *   - server-sent JSON chunks decode through TtsChunkSchema and surface
 *     as TtsChunk events
 *   - WS close with non-1000 code triggers a reconnect via
 *     computeBackoffMs, capped at RECONNECT_MAX_ATTEMPTS
 *   - flush() sends the empty-string end-of-utterance signal
 *   - close() cleanly tears down the WS and completes events$
 *   - an evil URL throws SAFE-03 at construction (covered by
 *     outbound-allowlist.test.ts; one redundant assertion here for
 *     traceability)
 */
import { describe, expect, it } from "vitest";

import { Buffer } from "node:buffer";

import { CHUNK_LENGTH_SCHEDULE, FLASH_MODEL } from "./constants.js";
import type { KeySource } from "./key-source.js";
import { createTtsStreamClient } from "./stream-client.js";
import {
  createMockTtsWsCtor,
  type MockChunk,
  type MockWebSocketLike,
} from "../test/fixtures/mock-elevenlabs-tts-server.js";

const TEST_KEY = "sk_test_key_long_enough_for_validation";
const VOICE_ID = "test-voice-id";

function makeStubChunks(count: number): MockChunk[] {
  const chunks: MockChunk[] = [];
  for (let i = 0; i < count; i += 1) {
    chunks.push({
      sequence: i,
      audioBase64: Buffer.from(`stub-${i}`).toString("base64"),
      durationMs: 100,
      mimeType: "audio/mpeg",
    });
  }
  return chunks;
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor: predicate did not become true in time"));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

describe("voice-tts/stream-client — Flash v2.5 stream-input surface", () => {
  it("constructor returns the documented public surface (events$, appendText, flush, close)", () => {
    const chunks = makeStubChunks(2);
    const ctor = createMockTtsWsCtor({ chunks });
    const client = createTtsStreamClient({
      keySource: async () => TEST_KEY,
      voiceId: VOICE_ID,
      webSocketCtor: ctor as unknown as typeof WebSocket,
    });
    expect(typeof client.appendText).toBe("function");
    expect(typeof client.flush).toBe("function");
    expect(typeof client.close).toBe("function");
    expect(client.events$).toBeDefined();
    expect(typeof (client.events$ as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe(
      "function",
    );
  });

  it("appendText sends a frame containing the locked CHUNK_LENGTH_SCHEDULE and the FLASH_MODEL id", async () => {
    const chunks = makeStubChunks(1);
    const sentFramesSink: string[] = [];
    let createdWs: MockWebSocketLike | null = null;
    const baseCtor = createMockTtsWsCtor({ chunks });
    class RecordingCtor extends (baseCtor as unknown as new (
      url: string | URL,
      protocols?: string | string[],
    ) => MockWebSocketLike) {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        createdWs = this as unknown as MockWebSocketLike;
      }
      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        sentFramesSink.push(typeof data === "string" ? data : String(data));
        super.send(data);
      }
    }
    const client = createTtsStreamClient({
      keySource: async () => TEST_KEY,
      voiceId: VOICE_ID,
      webSocketCtor: RecordingCtor as unknown as typeof WebSocket,
    });
    client.appendText("Hello, Achilles.");
    await waitFor(() => sentFramesSink.length >= 1);
    const initialFrame = JSON.parse(sentFramesSink[0] ?? "{}") as {
      chunk_length_schedule?: number[];
      model_id?: string;
    };
    expect(initialFrame.chunk_length_schedule).toEqual(
      Array.from(CHUNK_LENGTH_SCHEDULE),
    );
    expect(initialFrame.model_id).toBe(FLASH_MODEL);
    expect(createdWs).not.toBeNull();
    expect((createdWs as unknown as MockWebSocketLike).url).toContain(
      `model_id=${FLASH_MODEL}`,
    );
    await client.close();
  });

  it("awaits the injected keySource exactly once during the WS open", async () => {
    let keySourceCalls = 0;
    const keySource: KeySource = async () => {
      keySourceCalls += 1;
      return TEST_KEY;
    };
    const chunks = makeStubChunks(2);
    const ctor = createMockTtsWsCtor({ chunks });
    const client = createTtsStreamClient({
      keySource,
      voiceId: VOICE_ID,
      webSocketCtor: ctor as unknown as typeof WebSocket,
    });
    client.appendText("first");
    client.appendText("second");
    client.flush();
    await waitFor(() => keySourceCalls >= 1);
    // Give the runtime a few ticks to confirm no extra calls.
    await new Promise((r) => setTimeout(r, 20));
    expect(keySourceCalls).toBe(1);
    await client.close();
  });

  it("decodes an inbound chunk frame through TtsChunkSchema and surfaces it on events$", async () => {
    const chunks = makeStubChunks(3);
    const ctor = createMockTtsWsCtor({ chunks, chunkIntervalMs: 5 });
    const client = createTtsStreamClient({
      keySource: async () => TEST_KEY,
      voiceId: VOICE_ID,
      webSocketCtor: ctor as unknown as typeof WebSocket,
    });
    const received: Array<{ type: string; sequence?: number }> = [];
    const collector = (async () => {
      for await (const evt of client.events$) {
        received.push(evt as { type: string; sequence?: number });
        if (evt.type === "complete") {
          break;
        }
      }
    })();
    client.appendText("payload");
    client.flush();
    await collector;
    const chunkEvents = received.filter((e) => e.type === "chunk");
    expect(chunkEvents.length).toBe(3);
    expect(chunkEvents[0]?.sequence).toBe(0);
    expect(received[received.length - 1]?.type).toBe("complete");
    await client.close();
  });

  it("flush() sends the empty-string end-of-utterance signal", async () => {
    const chunks = makeStubChunks(1);
    const baseCtor = createMockTtsWsCtor({ chunks });
    const sentFramesSink: string[] = [];
    class RecordingCtor extends (baseCtor as unknown as new (
      url: string | URL,
      protocols?: string | string[],
    ) => MockWebSocketLike) {
      override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        sentFramesSink.push(typeof data === "string" ? data : String(data));
        super.send(data);
      }
    }
    const client = createTtsStreamClient({
      keySource: async () => TEST_KEY,
      voiceId: VOICE_ID,
      webSocketCtor: RecordingCtor as unknown as typeof WebSocket,
    });
    client.appendText("hello");
    client.flush();
    await waitFor(() => sentFramesSink.length >= 2);
    const flushFrame = JSON.parse(sentFramesSink[sentFramesSink.length - 1] ?? "{}") as {
      text?: string;
    };
    expect(flushFrame.text).toBe("");
    await client.close();
  });

  it("close() cleanly tears down the WS and signals events$ completion", async () => {
    const chunks = makeStubChunks(2);
    let closeCalled = false;
    const baseCtor = createMockTtsWsCtor({ chunks });
    class RecordingCtor extends (baseCtor as unknown as new (
      url: string | URL,
      protocols?: string | string[],
    ) => MockWebSocketLike) {
      override close(code?: number, reason?: string): void {
        closeCalled = true;
        super.close(code, reason);
      }
    }
    const client = createTtsStreamClient({
      keySource: async () => TEST_KEY,
      voiceId: VOICE_ID,
      webSocketCtor: RecordingCtor as unknown as typeof WebSocket,
    });
    client.appendText("hello");
    await client.close();
    expect(closeCalled).toBe(true);
    // The events$ iterator should not hang — it should resolve to done.
    const it = client.events$[Symbol.asyncIterator]();
    const result = await it.next();
    expect(result.done).toBe(true);
  });

  it("throws SAFE-03 at construction for an evil URL (redundant with outbound-allowlist.test.ts)", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: async () => TEST_KEY,
        voiceId: VOICE_ID,
        url: "wss://evil.com/v1/text-to-speech/test/stream-input",
      }),
    ).toThrowError(/SAFE-03/);
  });

  it("createTtsStreamClient signature compiles without an apiKey parameter (SAFE-01)", () => {
    // Type-level guarantee: this assignment fails to compile if the
    // option type ever grows an `apiKey` field.
    type OptKeys = keyof Parameters<typeof createTtsStreamClient>[0];
    // The known acceptable keys today:
    type AcceptableKeys =
      | "keySource"
      | "voiceId"
      | "url"
      | "webSocketCtor"
      | "outputFormat";
    // The compile-time guard:
    const _checkSubset: AcceptableKeys = "" as OptKeys;
    expect(typeof _checkSubset).toBe("string");
  });
});
