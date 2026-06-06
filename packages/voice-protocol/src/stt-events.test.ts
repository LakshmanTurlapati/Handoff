import { describe, expect, it } from "vitest";
import {
  CommittedTranscriptSchema,
  PartialTranscriptSchema,
  SttErrorEventSchema,
  SttEventSchema,
} from "./stt-events.js";

describe("PartialTranscriptSchema", () => {
  it("accepts a well-formed partial transcript", () => {
    const value = { type: "partial", text: "hello world", confidence: 0.92 };
    expect(PartialTranscriptSchema.parse(value)).toEqual(value);
  });

  it("rejects a payload missing the text field", () => {
    expect(() =>
      PartialTranscriptSchema.parse({ type: "partial", confidence: 0.5 }),
    ).toThrow();
  });

  it("rejects a payload whose type is committed", () => {
    expect(() =>
      PartialTranscriptSchema.parse({
        type: "committed",
        text: "hello",
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it("rejects a confidence outside [0, 1]", () => {
    expect(() =>
      PartialTranscriptSchema.parse({
        type: "partial",
        text: "hello",
        confidence: 1.5,
      }),
    ).toThrow();
  });
});

describe("CommittedTranscriptSchema", () => {
  it("accepts a well-formed committed transcript", () => {
    const value = {
      type: "committed",
      text: "hello world",
      durationMs: 4500,
    };
    expect(CommittedTranscriptSchema.parse(value)).toEqual(value);
  });

  it("rejects a negative durationMs", () => {
    expect(() =>
      CommittedTranscriptSchema.parse({
        type: "committed",
        text: "hello",
        durationMs: -1,
      }),
    ).toThrow();
  });

  it("rejects a missing text field", () => {
    expect(() =>
      CommittedTranscriptSchema.parse({
        type: "committed",
        durationMs: 1000,
      }),
    ).toThrow();
  });

  it("rejects a non-integer durationMs", () => {
    expect(() =>
      CommittedTranscriptSchema.parse({
        type: "committed",
        text: "hello",
        durationMs: 1500.5,
      }),
    ).toThrow();
  });
});

describe("SttErrorEventSchema", () => {
  it("accepts a well-formed error event", () => {
    const value = { type: "error", code: "rate_limit", retryable: true };
    expect(SttErrorEventSchema.parse(value)).toEqual(value);
  });

  it("rejects unknown literal code values", () => {
    expect(() =>
      SttErrorEventSchema.parse({
        type: "error",
        code: "totally_unknown",
        retryable: false,
      }),
    ).toThrow();
  });

  it("accepts an optional message", () => {
    const value = {
      type: "error",
      code: "network",
      retryable: true,
      message: "connection reset",
    };
    expect(SttErrorEventSchema.parse(value)).toEqual(value);
  });
});

describe("SttEventSchema (discriminated union)", () => {
  it("parses a partial variant", () => {
    const value = { type: "partial", text: "hello", confidence: 0.7 };
    expect(SttEventSchema.parse(value)).toEqual(value);
  });

  it("parses a committed variant", () => {
    const value = { type: "committed", text: "hello", durationMs: 1200 };
    expect(SttEventSchema.parse(value)).toEqual(value);
  });

  it("parses an error variant", () => {
    const value = { type: "error", code: "auth", retryable: false };
    expect(SttEventSchema.parse(value)).toEqual(value);
  });

  it("rejects an object whose type is tts_chunk", () => {
    expect(() =>
      SttEventSchema.parse({ type: "tts_chunk", sequence: 0 }),
    ).toThrow();
  });
});
