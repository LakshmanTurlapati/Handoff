import { describe, expect, it } from "vitest";
import {
  TtsChunkSchema,
  TtsStreamCompleteSchema,
  compareTtsChunkSequence,
} from "./tts-events.js";
import type { TtsChunk } from "./tts-events.js";

describe("TtsChunkSchema", () => {
  it("accepts a well-formed MP3 chunk", () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const value = {
      type: "chunk" as const,
      sequence: 0,
      audio,
      mimeType: "audio/mpeg" as const,
    };
    expect(TtsChunkSchema.parse(value)).toEqual(value);
  });

  it("accepts a well-formed PCM chunk", () => {
    const audio = new Uint8Array([10, 20, 30]);
    const value = {
      type: "chunk" as const,
      sequence: 42,
      audio,
      mimeType: "audio/pcm" as const,
    };
    expect(TtsChunkSchema.parse(value)).toEqual(value);
  });

  it("rejects a negative sequence", () => {
    expect(() =>
      TtsChunkSchema.parse({
        type: "chunk",
        sequence: -1,
        audio: new Uint8Array([1]),
        mimeType: "audio/mpeg",
      }),
    ).toThrow();
  });

  it("rejects a non-integer sequence", () => {
    expect(() =>
      TtsChunkSchema.parse({
        type: "chunk",
        sequence: 1.5,
        audio: new Uint8Array([1]),
        mimeType: "audio/mpeg",
      }),
    ).toThrow();
  });

  it("rejects a missing audio field", () => {
    expect(() =>
      TtsChunkSchema.parse({
        type: "chunk",
        sequence: 0,
        mimeType: "audio/mpeg",
      }),
    ).toThrow();
  });

  it("rejects an unsupported mimeType", () => {
    expect(() =>
      TtsChunkSchema.parse({
        type: "chunk",
        sequence: 0,
        audio: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    ).toThrow();
  });
});

describe("TtsStreamCompleteSchema", () => {
  it("accepts a well-formed stream-complete event", () => {
    const value = {
      type: "complete" as const,
      totalChunks: 47,
      durationMs: 12000,
    };
    expect(TtsStreamCompleteSchema.parse(value)).toEqual(value);
  });

  it("rejects totalChunks less than 1", () => {
    expect(() =>
      TtsStreamCompleteSchema.parse({
        type: "complete",
        totalChunks: 0,
        durationMs: 100,
      }),
    ).toThrow();
  });

  it("rejects a negative durationMs", () => {
    expect(() =>
      TtsStreamCompleteSchema.parse({
        type: "complete",
        totalChunks: 1,
        durationMs: -5,
      }),
    ).toThrow();
  });
});

describe("compareTtsChunkSequence", () => {
  const makeChunk = (sequence: number): TtsChunk => ({
    type: "chunk",
    sequence,
    audio: new Uint8Array(),
    mimeType: "audio/mpeg",
  });

  it("returns negative when a.sequence < b.sequence", () => {
    expect(compareTtsChunkSequence(makeChunk(0), makeChunk(1))).toBeLessThan(0);
  });

  it("returns positive when a.sequence > b.sequence", () => {
    expect(compareTtsChunkSequence(makeChunk(5), makeChunk(2))).toBeGreaterThan(
      0,
    );
  });

  it("returns zero when equal", () => {
    expect(compareTtsChunkSequence(makeChunk(3), makeChunk(3))).toBe(0);
  });
});
