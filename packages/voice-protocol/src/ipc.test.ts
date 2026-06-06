import { describe, expect, it } from "vitest";
import {
  MintSttTokenRequestSchema,
  MintSttTokenResponseSchema,
  VoiceIpcEnvelopeSchema,
} from "./ipc.js";

describe("MintSttTokenRequestSchema (SAFE-01 strict-mode boundary)", () => {
  it("accepts a minimal well-formed request", () => {
    const value = {
      type: "mint-stt-token" as const,
      model: "scribe_v2_realtime" as const,
    };
    expect(MintSttTokenRequestSchema.parse(value)).toEqual(value);
  });

  it("rejects a request carrying an apiKey field (SAFE-01)", () => {
    expect(() =>
      MintSttTokenRequestSchema.parse({
        type: "mint-stt-token",
        model: "scribe_v2_realtime",
        apiKey: "sk_secret",
      }),
    ).toThrow();
  });

  it("rejects a request carrying an xi_api_key field (SAFE-01)", () => {
    expect(() =>
      MintSttTokenRequestSchema.parse({
        type: "mint-stt-token",
        model: "scribe_v2_realtime",
        xi_api_key: "sk_secret",
      }),
    ).toThrow();
  });

  it("rejects a request carrying a generic key field (SAFE-01)", () => {
    expect(() =>
      MintSttTokenRequestSchema.parse({
        type: "mint-stt-token",
        model: "scribe_v2_realtime",
        key: "sk_secret",
      }),
    ).toThrow();
  });

  it("rejects a model literal other than scribe_v2_realtime", () => {
    expect(() =>
      MintSttTokenRequestSchema.parse({
        type: "mint-stt-token",
        model: "scribe_v1",
      }),
    ).toThrow();
  });
});

describe("MintSttTokenResponseSchema (SAFE-01 token defence in depth)", () => {
  it("accepts a well-formed response with a short opaque token", () => {
    const value = {
      type: "mint-stt-token-response" as const,
      token: "tok_abc123",
      expiresAt: "2026-06-06T11:15:00Z",
    };
    expect(MintSttTokenResponseSchema.parse(value)).toEqual(value);
  });

  it("rejects a response whose token looks like a raw ElevenLabs API key", () => {
    // 32+ chars starting with sk_ matches the refuse rule.
    const rawKey = "sk_" + "a".repeat(30);
    expect(() =>
      MintSttTokenResponseSchema.parse({
        type: "mint-stt-token-response",
        token: rawKey,
        expiresAt: "2026-06-06T11:15:00Z",
      }),
    ).toThrow();
  });

  it("accepts a short token even if it starts with the sk_ prefix (avoid false positive)", () => {
    // Shorter than ELEVENLABS_KEY_MIN_LENGTH so the refusal heuristic
    // does not trigger.
    const value = {
      type: "mint-stt-token-response" as const,
      token: "sk_short",
      expiresAt: "2026-06-06T11:15:00Z",
    };
    expect(MintSttTokenResponseSchema.parse(value)).toEqual(value);
  });

  it("rejects an invalid ISO-8601 expiresAt", () => {
    expect(() =>
      MintSttTokenResponseSchema.parse({
        type: "mint-stt-token-response",
        token: "tok_abc",
        expiresAt: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("VoiceIpcEnvelopeSchema (discriminated union)", () => {
  it("parses a mint-stt-token request variant", () => {
    const value = {
      type: "mint-stt-token" as const,
      model: "scribe_v2_realtime" as const,
    };
    expect(VoiceIpcEnvelopeSchema.parse(value)).toEqual(value);
  });

  it("parses a mint-stt-token-response variant", () => {
    const value = {
      type: "mint-stt-token-response" as const,
      token: "tok_abc",
      expiresAt: "2026-06-06T11:15:00Z",
    };
    expect(VoiceIpcEnvelopeSchema.parse(value)).toEqual(value);
  });

  it("rejects an unknown type literal", () => {
    expect(() =>
      VoiceIpcEnvelopeSchema.parse({
        type: "some-other-message",
        payload: {},
      }),
    ).toThrow();
  });
});
