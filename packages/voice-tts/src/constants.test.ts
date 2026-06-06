/**
 * Unit tests for @achilles/voice-tts/constants.
 *
 * These tests lock the Flash v2.5 model id, chunk-length schedule,
 * pre-buffer duration, default output format, the stream-input URL
 * template, and the Turbo-deprecation guard.
 *
 * Citations:
 *   - PITFALLS #5 — model selection per call site (Flash for TTS; Turbo deprecated)
 *   - PITFALLS #6 — TTS chunk ordering + chunk_length_schedule + ~500 ms prebuffer
 *   - 09-CONTEXT.md decisions — `eleven_flash_v2_5` locked; `eleven_turbo_v2_5` forbidden;
 *     MP3 44.1 kHz default; chunk_length_schedule [80, 120, 160, 220]
 */
import { describe, expect, it } from "vitest";

import { assertElevenLabsHost } from "@achilles/voice-protocol";

import {
  assertFlashModel,
  buildTtsStreamUrl,
  CHUNK_LENGTH_SCHEDULE,
  DEFAULT_OUTPUT_FORMAT,
  FLASH_MODEL,
  PRE_BUFFER_MS,
  TTS_STREAM_URL_TEMPLATE,
} from "./constants.js";

describe("voice-tts/constants — Flash v2.5 model lock", () => {
  it("FLASH_MODEL is exactly the literal 'eleven_flash_v2_5'", () => {
    expect(FLASH_MODEL).toBe("eleven_flash_v2_5");
  });

  it("CHUNK_LENGTH_SCHEDULE deep-equals [80, 120, 160, 220] (PITFALLS #6)", () => {
    expect(Array.from(CHUNK_LENGTH_SCHEDULE)).toEqual([80, 120, 160, 220]);
  });

  it("TTS_STREAM_URL_TEMPLATE is the documented Flash v2.5 stream-input URL", () => {
    expect(TTS_STREAM_URL_TEMPLATE).toBe(
      "wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_flash_v2_5",
    );
  });

  it("buildTtsStreamUrl interpolates voiceId and the result passes the SAFE-03 allowlist", () => {
    const url = buildTtsStreamUrl({ voiceId: "test-voice-id" });
    expect(url).toBe(
      "wss://api.elevenlabs.io/v1/text-to-speech/test-voice-id/stream-input?model_id=eleven_flash_v2_5",
    );
    // SAFE-03: the resulting URL MUST be in the ElevenLabs allowlist.
    expect(() => assertElevenLabsHost(url)).not.toThrow();
  });

  it("assertFlashModel accepts the Flash model and rejects deprecated Turbo (PITFALLS #5)", () => {
    expect(assertFlashModel("eleven_flash_v2_5")).toBe("eleven_flash_v2_5");
    expect(() => assertFlashModel("eleven_turbo_v2_5")).toThrowError(
      /deprecated|PITFALLS #5/i,
    );
  });

  it("DEFAULT_OUTPUT_FORMAT is the MP3 44.1 kHz default (CONTEXT.md decision)", () => {
    expect(DEFAULT_OUTPUT_FORMAT).toBe("mp3_44100");
  });

  it("PRE_BUFFER_MS is 500 ms (PITFALLS #6 documented prebuffer)", () => {
    expect(PRE_BUFFER_MS).toBe(500);
  });
});
