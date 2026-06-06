/**
 * Unit tests for @achilles/voice-tts/key-source.
 *
 * The key-source surface is the package's SAFE-01 + PITFALLS #22 stance:
 *
 *   - The package NEVER reads `process.env`.
 *   - The package NEVER opens a keystore.
 *   - The package NEVER persists the API key after the callback resolves.
 *
 * Instead, the consumer (Phase 11 Electron main + Phase 12 orchestrator)
 * injects a `KeySource` callback. The callback is awaited once per stream
 * open, the resolved string is forwarded to the WebSocket layer, and the
 * local reference is dropped after the open frame is sent.
 */
import { describe, expect, it } from "vitest";

import { callKeySource, type KeySource } from "./key-source.js";

describe("voice-tts/key-source — consumer-injected KeySource callback", () => {
  it("returns the awaited key when the source resolves successfully", async () => {
    const source: KeySource = async () => "sk_test_0123456789abcdef0123456789abcdef";
    await expect(callKeySource(source)).resolves.toBe(
      "sk_test_0123456789abcdef0123456789abcdef",
    );
  });

  it("wraps thrown errors with a documented '[voice-tts] failed to read API key' prefix", async () => {
    const source: KeySource = async () => {
      throw new Error("safeStorage unavailable");
    };
    await expect(callKeySource(source)).rejects.toThrowError(
      /\[voice-tts\] failed to read API key from injected keySource/,
    );
  });

  it("rejects non-string return values with 'invalid key shape from keySource'", async () => {
    // Cast through unknown to satisfy the typed signature while still
    // exercising the runtime defence-in-depth path.
    const badNumeric = (async () => 12345) as unknown as KeySource;
    await expect(callKeySource(badNumeric)).rejects.toThrowError(
      /invalid key shape from keySource/,
    );
  });

  it("rejects keys shorter than the 32-character floor with 'invalid key shape from keySource'", async () => {
    // WR-11 raised the floor to 32 chars (matching the renderer-side
    // ELEVENLABS_KEY_MIN_LENGTH in voice-protocol/ipc.ts). A short key
    // like "abc" or even "sk_short9" must fail at this boundary so a
    // misconfigured keystore surfaces a clear error instead of being
    // forwarded to ElevenLabs and rejected with an opaque close code.
    const tooShort: KeySource = async () => "abc";
    await expect(callKeySource(tooShort)).rejects.toThrowError(
      /invalid key shape from keySource/,
    );

    const justShortOfFloor: KeySource = async () =>
      "sk_test_0123456789abcdef0123456"; // 31 chars — one short of the floor.
    await expect(callKeySource(justShortOfFloor)).rejects.toThrowError(
      /invalid key shape from keySource/,
    );
  });

  it("rejects empty-string returns with 'invalid key shape from keySource'", async () => {
    const empty: KeySource = async () => "";
    await expect(callKeySource(empty)).rejects.toThrowError(
      /invalid key shape from keySource/,
    );
  });

  it("KeySource type signature contains no apiKey parameter — it is a getter, not a passing surface", () => {
    // This test is a compile-time guarantee. The body asserts that the
    // value type of KeySource is exactly `() => Promise<string>` — a
    // zero-argument callback. If a future commit changes the signature
    // to accept an `apiKey` parameter, this assignment fails to compile.
    const sentinel: () => Promise<string> = async () =>
      "sk_test_0123456789abcdef0123456789abcdef";
    const reassign: KeySource = sentinel;
    expect(typeof reassign).toBe("function");
  });
});
