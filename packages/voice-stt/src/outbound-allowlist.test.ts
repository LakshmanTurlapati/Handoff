import { assertElevenLabsHost } from "@achilles/voice-protocol";
import { describe, expect, it, vi } from "vitest";
import { STT_REALTIME_URL } from "./constants.js";
import { createRealtimeSttClient } from "./realtime-client.js";
import { mintSttToken } from "./token-mint.js";

/**
 * Stub `getToken` that returns a benign fixture token. Used to satisfy
 * the constructor surface; the tests in this file never call `start()`
 * so the token is never consumed.
 */
const stubGetToken = vi.fn(async () => ({
  token: "tok_test",
  expiresAt: "2099-01-01T00:00:00Z",
}));

describe("SAFE-03 outbound allowlist — createRealtimeSttClient construction", () => {
  it("does NOT throw for the locked default WSS URL", () => {
    expect(() =>
      createRealtimeSttClient({
        getToken: stubGetToken,
        url: STT_REALTIME_URL,
      }),
    ).not.toThrow();
  });

  it("does NOT throw for a regional ElevenLabs WSS URL", () => {
    expect(() =>
      createRealtimeSttClient({
        getToken: stubGetToken,
        url: "wss://api.us.elevenlabs.io/v1/speech-to-text/realtime",
      }),
    ).not.toThrow();
  });

  it("throws with SAFE-03 in the message for wss://evil.com (before any network attempt)", () => {
    expect(() =>
      createRealtimeSttClient({
        getToken: stubGetToken,
        url: "wss://evil.com/v1/realtime",
      }),
    ).toThrow(/SAFE-03/);
  });

  it("throws for the substring-attack host api.elevenlabs.io.evil.com (SAFE-03)", () => {
    expect(() =>
      createRealtimeSttClient({
        getToken: stubGetToken,
        url: "wss://api.elevenlabs.io.evil.com/v1/realtime",
      }),
    ).toThrow(/SAFE-03/);
  });
});

describe("SAFE-03 outbound allowlist — mintSttToken (regional endpoints)", () => {
  it("allows the regional EU residency endpoint", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        async json() {
          return { token: "tok_eu", expires_at: "2026-06-06T11:45:00Z" };
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      mintSttToken({
        apiKey: "sk_test_long_enough_value_for_testing_purposes_only",
        endpoint: "https://api.eu.residency.elevenlabs.io/v1/realtime/token",
        fetchImpl,
      }),
    ).resolves.toEqual({
      token: "tok_eu",
      expiresAt: "2026-06-06T11:45:00Z",
    });
  });
});

describe("SAFE-03 outbound allowlist — assertElevenLabsHost on locked URLs", () => {
  it("accepts STT_REALTIME_URL (proves the locked default is in the allowlist)", () => {
    expect(() => assertElevenLabsHost(STT_REALTIME_URL)).not.toThrow();
    const canonical = assertElevenLabsHost(STT_REALTIME_URL);
    expect(canonical).toContain("api.elevenlabs.io");
  });
});
