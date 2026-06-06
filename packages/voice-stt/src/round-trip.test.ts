import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { SttEvent } from "@achilles/voice-protocol";
import { STT_REALTIME_URL } from "./constants.js";
import { createMockElevenLabsWs } from "../test/fixtures/mock-elevenlabs-server.js";
import { createRealtimeSttClient } from "./realtime-client.js";

/**
 * The round-trip headline test (LOOP-01 demo + SAFE-01 boundary).
 *
 * Flow:
 *   1. Read the 5-second 16 kHz mono Int16 PCM WAV fixture from disk.
 *   2. Read the ground-truth transcript string from disk.
 *   3. Construct a `createRealtimeSttClient` whose WebSocket
 *      constructor is the in-memory mock (so no real network call).
 *   4. Stream the fixture's PCM payload as 20 ms (320-sample) chunks
 *      into `client.write(frame)`.
 *   5. Call `mock.flushCommit()` which causes the mock to emit a
 *      `committed_transcript` whose `text` equals the ground truth.
 *   6. Assert: the `committed` event's text matches the ground truth
 *      after whitespace collapse + lowercase; getToken was called
 *      exactly once; the URL passed to the WebSocket constructor was
 *      `STT_REALTIME_URL`.
 */
describe("round-trip — WAV fixture in, verbatim committed transcript out", () => {
  it("emits a committed event whose text matches the ground truth", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturesDir = join(here, "..", "test", "fixtures");
    const wavBytes = readFileSync(join(fixturesDir, "short-utterance.wav"));
    const transcript = readFileSync(
      join(fixturesDir, "short-utterance.transcript.txt"),
      "utf8",
    );

    // ---- Sanity: the WAV is the documented size. Keeps the test
    // honest in case the fixture is regenerated with different params.
    expect(wavBytes.length).toBe(160044);

    // ---- Build the mock and the client.
    const mock = createMockElevenLabsWs({ transcript });
    const getToken = vi.fn(async () => ({
      token: "tok_mock",
      expiresAt: "2099-01-01T00:00:00Z",
    }));

    const collected: SttEvent[] = [];
    const client = createRealtimeSttClient({
      getToken,
      url: STT_REALTIME_URL,
      webSocketCtor: mock.ctor,
      onEvent: (e) => collected.push(e),
    });

    await client.start();
    // Wait one microtask for the mock socket to fire its `open` event.
    await Promise.resolve();
    await Promise.resolve();

    // ---- Stream the PCM payload as 20 ms (320-sample) frames.
    const HEADER_BYTES = 44;
    const SAMPLES_PER_FRAME = 320;
    const pcmBytes = wavBytes.subarray(HEADER_BYTES);
    const totalSamples = pcmBytes.length / 2;
    const frames = Math.floor(totalSamples / SAMPLES_PER_FRAME);
    for (let f = 0; f < frames; f += 1) {
      const byteOffset = f * SAMPLES_PER_FRAME * 2;
      const slice = pcmBytes.subarray(
        byteOffset,
        byteOffset + SAMPLES_PER_FRAME * 2,
      );
      // Copy into a fresh aligned ArrayBuffer so the Int16Array view is
      // safe regardless of the underlying Buffer's alignment.
      const aligned = new ArrayBuffer(slice.byteLength);
      new Uint8Array(aligned).set(slice);
      const frame = new Int16Array(aligned);
      client.write(frame);
    }

    // ---- Have the mock emit the committed transcript.
    mock.flushCommit();
    // Yield so the wrapper processes the committed message.
    await Promise.resolve();
    await Promise.resolve();

    // ---- Assertions.
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(mock.lastUrl()).toBe(STT_REALTIME_URL);
    expect(mock.receivedChunkCount()).toBe(frames);

    const errors = collected.filter((e) => e.type === "error");
    expect(errors).toEqual([]);

    const committed = collected.find((e) => e.type === "committed");
    expect(committed).toBeDefined();
    if (committed && committed.type === "committed") {
      const normalise = (s: string): string =>
        s.replace(/\s+/g, " ").trim().toLowerCase();
      expect(normalise(committed.text)).toBe(normalise(transcript));
    }

    await client.stop();
  });
});
