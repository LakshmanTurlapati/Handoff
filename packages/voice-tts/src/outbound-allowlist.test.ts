/**
 * SAFE-03 outbound-allowlist tests for @achilles/voice-tts.
 *
 * These tests verify that the wrapper REFUSES any non-ElevenLabs URL
 * at construction time, BEFORE any network I/O happens. The single
 * source of truth for the matcher is `assertElevenLabsHost` from
 * `@achilles/voice-protocol` (Plan 09-01); voice-tts must call it at
 * the construction boundary.
 *
 * Positive cases:
 *   - The default `buildTtsStreamUrl({ voiceId })` URL is allowed.
 *   - Regional residency hosts (`api.us.`, `api.eu.residency.`) are allowed.
 *
 * Negative cases:
 *   - `evil.com` is refused with a "SAFE-03"-bearing error message.
 *   - The substring-attack host `api.elevenlabs.io.evil.com` is also
 *     refused — this verifies the matcher does NOT do a naive
 *     `.endsWith("elevenlabs.io")` check.
 *
 * Citations:
 *   - SAFE-03 (REQUIREMENTS.md) — outbound network restricted to
 *     ElevenLabs hosts; substring attacks must be refused
 *   - 09-CONTEXT.md decisions — allowlist enforced at the wrapper layer
 */
import { describe, expect, it } from "vitest";

import { assertElevenLabsHost } from "@achilles/voice-protocol";

import { buildTtsStreamUrl } from "./constants.js";
import { createTtsStreamClient } from "./stream-client.js";
import type { KeySource } from "./key-source.js";

/**
 * Stub `KeySource` used for construction-time tests. Construction does
 * NOT call the key source — the test only asserts the URL guard fires
 * before any WS opens. The callback is here for type-shape parity.
 */
const stubKeySource: KeySource = async () =>
  "sk_test_0123456789abcdef0123456789abcdef";

describe("voice-tts/outbound-allowlist — SAFE-03 enforcement at construction", () => {
  it("accepts the locked default Flash v2.5 stream-input URL", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
      }),
    ).not.toThrow();
  });

  it("accepts an explicit allowlisted URL: 'wss://api.elevenlabs.io/...'", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
        url: "wss://api.elevenlabs.io/v1/text-to-speech/test/stream-input?model_id=eleven_flash_v2_5",
      }),
    ).not.toThrow();
  });

  it("accepts the regional override 'wss://api.us.elevenlabs.io/...'", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
        url: "wss://api.us.elevenlabs.io/v1/text-to-speech/test/stream-input?model_id=eleven_flash_v2_5",
      }),
    ).not.toThrow();
  });

  it("accepts the regional override 'wss://api.eu.residency.elevenlabs.io/...'", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
        url: "wss://api.eu.residency.elevenlabs.io/v1/text-to-speech/test/stream-input?model_id=eleven_flash_v2_5",
      }),
    ).not.toThrow();
  });

  it("refuses a non-ElevenLabs URL with a 'SAFE-03'-bearing error", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
        url: "wss://evil.com/v1/text-to-speech/test/stream-input",
      }),
    ).toThrowError(/SAFE-03/);
  });

  it("refuses a substring-attack URL 'api.elevenlabs.io.evil.com' with SAFE-03", () => {
    expect(() =>
      createTtsStreamClient({
        keySource: stubKeySource,
        voiceId: "test-voice",
        url: "wss://api.elevenlabs.io.evil.com/v1/text-to-speech/test/stream-input",
      }),
    ).toThrowError(/SAFE-03/);
  });

  it("buildTtsStreamUrl output for any voiceId passes assertElevenLabsHost (cross-package consistency)", () => {
    const voiceIds = ["default", "voice-1", "21m00Tcm4TlvDq8ikWAM", "abc-XYZ-123"];
    for (const voiceId of voiceIds) {
      const url = buildTtsStreamUrl({ voiceId });
      expect(() => assertElevenLabsHost(url)).not.toThrow();
    }
  });
});
