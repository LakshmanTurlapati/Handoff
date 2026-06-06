import { describe, expect, it } from "vitest";
import * as VP from "./index.js";

describe("transport: isElevenLabsHost (SAFE-03 allowlist)", () => {
  it("accepts api.elevenlabs.io", () => {
    expect(VP.isElevenLabsHost("api.elevenlabs.io")).toBe(true);
  });

  it("accepts api.us.elevenlabs.io (regional)", () => {
    expect(VP.isElevenLabsHost("api.us.elevenlabs.io")).toBe(true);
  });

  it("accepts api.eu.residency.elevenlabs.io (residency subdomain)", () => {
    expect(VP.isElevenLabsHost("api.eu.residency.elevenlabs.io")).toBe(true);
  });

  it("accepts the bare apex elevenlabs.io", () => {
    expect(VP.isElevenLabsHost("elevenlabs.io")).toBe(true);
  });

  it("accepts case-insensitive hostnames", () => {
    expect(VP.isElevenLabsHost("API.ElevenLabs.IO")).toBe(true);
  });

  it("rejects evil.com", () => {
    expect(VP.isElevenLabsHost("evil.com")).toBe(false);
  });

  it("rejects substring-attack host api.elevenlabs.io.evil.com (SAFE-03)", () => {
    expect(VP.isElevenLabsHost("api.elevenlabs.io.evil.com")).toBe(false);
  });

  it("rejects a host that merely contains elevenlabs", () => {
    expect(VP.isElevenLabsHost("notelevenlabs.io")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(VP.isElevenLabsHost("")).toBe(false);
  });
});

describe("transport: assertElevenLabsHost (SAFE-03 enforcement)", () => {
  it("returns the canonical URL string for an allowed host", () => {
    const url = "https://api.elevenlabs.io/v1/realtime";
    expect(VP.assertElevenLabsHost(url)).toContain("api.elevenlabs.io");
  });

  it("accepts a URL object as input", () => {
    const url = new URL("wss://api.us.elevenlabs.io/v1/speech-to-text/realtime");
    expect(VP.assertElevenLabsHost(url)).toContain("api.us.elevenlabs.io");
  });

  it("throws with the offending host in the message when refused", () => {
    expect(() =>
      VP.assertElevenLabsHost("https://api.elevenlabs.io.evil.com/v1/realtime"),
    ).toThrow(/api\.elevenlabs\.io\.evil\.com/);
  });

  it("throws with SAFE-03 in the message when refused", () => {
    expect(() =>
      VP.assertElevenLabsHost("https://evil.com/whatever"),
    ).toThrow(/SAFE-03/);
  });

  it("throws on a non-parseable URL", () => {
    expect(() => VP.assertElevenLabsHost("not a url")).toThrow();
  });
});

describe("barrel: every documented public symbol is exported", () => {
  it("re-exports the STT schemas and types", () => {
    expect(VP.PartialTranscriptSchema).toBeDefined();
    expect(VP.CommittedTranscriptSchema).toBeDefined();
    expect(VP.SttErrorEventSchema).toBeDefined();
    expect(VP.SttEventSchema).toBeDefined();
  });

  it("re-exports the TTS schemas and comparator", () => {
    expect(VP.TtsChunkSchema).toBeDefined();
    expect(VP.TtsStreamCompleteSchema).toBeDefined();
    expect(VP.compareTtsChunkSequence).toBeDefined();
    expect(typeof VP.compareTtsChunkSequence).toBe("function");
  });

  it("re-exports the IPC schemas", () => {
    expect(VP.MintSttTokenRequestSchema).toBeDefined();
    expect(VP.MintSttTokenResponseSchema).toBeDefined();
    expect(VP.VoiceIpcEnvelopeSchema).toBeDefined();
  });

  it("re-exports the transport allowlist surface", () => {
    expect(VP.isElevenLabsHost).toBeDefined();
    expect(VP.assertElevenLabsHost).toBeDefined();
    expect(VP.ELEVENLABS_HOST_ALLOWLIST).toBeDefined();
    expect(VP.ELEVENLABS_HOST_ALLOWLIST.length).toBeGreaterThan(0);
  });
});
