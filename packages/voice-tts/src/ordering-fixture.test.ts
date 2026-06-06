/**
 * Headline PITFALLS #6 demo: 30-second narration replayed in scrambled
 * arrival order through the stream client + SequenceBuffer, asserting
 * monotonic emission, full coverage of sequences 0..59, no remaining
 * gap at end of stream, and a matching `stream_complete` total.
 *
 * The test reads the fixture at packages/voice-tts/test/fixtures/
 * sequenced-chunks.json — 60 chunks numbered 0..59, each 500 ms —
 * permutes the arrival order with a deterministic seed, drives the
 * mock WebSocket constructor to emit chunks in the permuted order,
 * pipes the wrapper's TtsChunk events through a SequenceBuffer, and
 * asserts the buffer's output is strictly monotonic.
 *
 * Side-assertion: the mock records the URL it received from the
 * wrapper; that URL must be an `api.elevenlabs.io` host (SAFE-03).
 *
 * Citations:
 *   - PITFALLS #6 — TTS chunks arriving out of order; sequence-tracked
 *     reorder is the ROADMAP success criterion.
 *   - 09-CONTEXT.md — 30-second narration fixture, scrambled arrival
 *     replay, no real ElevenLabs network calls in CI.
 *   - SAFE-03 — outbound URL must be an ElevenLabs host.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createTtsStreamClient,
  SequenceBuffer,
  type TtsChunk,
  type TtsEvent,
} from "./index.js";
import {
  createMockTtsWsCtor,
  type MockChunk,
} from "../test/fixtures/mock-elevenlabs-tts-server.js";

interface FixtureChunk {
  sequence: number;
  audioBase64: string;
  durationMs: number;
  mimeType: "audio/mpeg" | "audio/pcm";
}

interface Fixture {
  totalChunks: number;
  durationMs: number;
  chunks: FixtureChunk[];
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  here,
  "..",
  "test",
  "fixtures",
  "sequenced-chunks.json",
);

const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

/**
 * Deterministic scramble of [0..n-1] derived from a fixed seed so the
 * test is repeatable in CI. Uses a Fisher-Yates shuffle driven by a
 * tiny linear-congruential generator.
 */
function deterministicScramble(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let state = seed;
  function rand(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  }
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as number;
    out[j] = tmp as number;
  }
  return out;
}

describe("voice-tts/ordering-fixture — 30-second scrambled-arrival replay", () => {
  it("reorders 60 chunks arriving out-of-order into strictly monotonic 0..59", async () => {
    // Sanity-check the fixture parameters.
    expect(fixture.totalChunks).toBe(60);
    expect(fixture.durationMs).toBe(30000);
    expect(fixture.chunks.length).toBe(60);

    // Map the fixture into the mock's chunk shape.
    const mockChunks: MockChunk[] = fixture.chunks.map((c) => ({
      sequence: c.sequence,
      audioBase64: c.audioBase64,
      durationMs: c.durationMs,
      mimeType: c.mimeType,
    }));

    // Permute the arrival order. Seed 42 produces a non-identity
    // permutation that exercises both forward and backward gaps.
    const arrivalOrder = deterministicScramble(60, 42);
    // Make sure the permutation is actually scrambled (not a no-op).
    expect(arrivalOrder).not.toEqual(
      Array.from({ length: 60 }, (_, i) => i),
    );

    let recordedUrl = "";
    const ctor = createMockTtsWsCtor({
      chunks: mockChunks,
      arrivalOrder,
      chunkIntervalMs: 1,
      urlSink: (u) => {
        recordedUrl = u;
      },
    });

    const client = createTtsStreamClient({
      keySource: async () => "sk_test_key_long_enough_for_validation",
      voiceId: "narration-voice",
      webSocketCtor: ctor as unknown as typeof WebSocket,
    });

    // Pipe chunk events through a SequenceBuffer; collect the emitted
    // (monotonic) sequence ids and observe whether a gap was ever
    // unresolved at stream end.
    const buf = new SequenceBuffer<TtsChunk>();
    const emittedSequences: number[] = [];
    buf.onEmit((chunk) => emittedSequences.push(chunk.sequence));

    let lastComplete: TtsEvent | null = null;
    const collector = (async () => {
      for await (const evt of client.events$) {
        if (evt.type === "chunk") {
          buf.push(evt);
          buf.drain();
        } else if (evt.type === "complete") {
          lastComplete = evt;
          // Drain once more to be safe; if reordering still has
          // anything buffered, it will surface now.
          buf.drain();
          break;
        }
      }
    })();

    // Drive the wrapper.
    client.appendText("This is the 30-second narration script.");
    client.flush();

    await collector;
    await client.close();

    // Headline assertions:
    //   - All 60 sequences emitted exactly once.
    expect(emittedSequences.length).toBe(60);
    const sortedEmitted = [...emittedSequences].sort((a, b) => a - b);
    expect(sortedEmitted).toEqual(Array.from({ length: 60 }, (_, i) => i));
    //   - Strictly monotonic order out of the buffer.
    expect(emittedSequences).toEqual(Array.from({ length: 60 }, (_, i) => i));
    //   - No remaining gap.
    expect(buf.hasGap()).toBe(false);
    expect(buf.nextExpected()).toBe(60);
    //   - stream_complete matches total emitted.
    expect(lastComplete).not.toBeNull();
    const finalComplete = lastComplete as unknown as {
      type: string;
      totalChunks: number;
    };
    expect(finalComplete.type).toBe("complete");
    expect(finalComplete.totalChunks).toBe(60);

    // SAFE-03 side-assertion: the URL the mock saw is an ElevenLabs host.
    expect(recordedUrl).toMatch(/^wss:\/\/api\.elevenlabs\.io\//);
  });
});
