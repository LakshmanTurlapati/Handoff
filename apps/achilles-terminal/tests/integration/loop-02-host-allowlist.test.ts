/**
 * Phase 18, Plan 04, Task 2 — SAFE-03 + LOOP-02 host allowlist integration test.
 *
 * SAFE-03: ElevenLabs-only outbound network allowlist is enforced at
 * packages/voice-protocol/src/transport.ts:assertElevenLabsHost.
 * This is a carryover from v1.2; Phase 18 does NOT modify voice-protocol.
 *
 * LOOP-02: packages/voice-protocol is LOCKED. This test does NOT modify
 * transport.ts — it imports and asserts the function is present and
 * functional. If this import fails, the LOOP-02 boundary has shifted
 * (the function was removed or the package was restructured) and Phase 19
 * must address the regression before shipping.
 *
 * Test cases:
 *   1. assertElevenLabsHost is exported from @achilles/voice-protocol
 *   2. Accepts a valid ElevenLabs WSS URL without throwing
 *   3. Throws on an arbitrary external host (example.com)
 *   4. Throws on a malicious host (malicious.io)
 *   5. Export signature matches the expected shape (function accepting string | URL)
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assertElevenLabsHost } from "@achilles/voice-protocol";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANSPORT_SRC = resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "voice-protocol",
  "src",
  "transport.ts",
);

describe("SAFE-03 + LOOP-02: assertElevenLabsHost host allowlist (packages/voice-protocol/src/transport.ts)", () => {
  it("assertElevenLabsHost is exported from @achilles/voice-protocol", () => {
    expect(typeof assertElevenLabsHost).toBe("function");
  });

  it("assertElevenLabsHost accepts a valid ElevenLabs WSS URL without throwing", () => {
    const validUrl = "wss://api.elevenlabs.io/v1/text-to-speech/voice-id/stream-input";
    expect(() => assertElevenLabsHost(validUrl)).not.toThrow();
    // The function returns the full URL string
    const result = assertElevenLabsHost(validUrl);
    expect(typeof result).toBe("string");
    expect(result).toContain("api.elevenlabs.io");
  });

  it("assertElevenLabsHost throws on an arbitrary external host (example.com)", () => {
    const externalUrl = "wss://example.com/v1/stream";
    expect(() => assertElevenLabsHost(externalUrl)).toThrow();
    expect(() => assertElevenLabsHost(externalUrl)).toThrow(/not in the ElevenLabs allowlist/);
  });

  it("assertElevenLabsHost throws on a malicious host (malicious.io)", () => {
    const maliciousUrl = "https://malicious.io/abc";
    expect(() => assertElevenLabsHost(maliciousUrl)).toThrow();
    expect(() => assertElevenLabsHost(maliciousUrl)).toThrow(/not in the ElevenLabs allowlist/);
  });

  it("assertElevenLabsHost export signature matches expected shape (Phase 17 surface unchanged)", () => {
    // Read transport.ts source and assert the export signature is present verbatim.
    // This grep-based assertion catches signature drift before runtime errors would.
    let source: string;
    try {
      source = readFileSync(TRANSPORT_SRC, "utf8");
    } catch {
      // If the file cannot be read, the LOOP-02 boundary has shifted.
      throw new Error(
        `LOOP-02 violation: packages/voice-protocol/src/transport.ts is not readable at expected path. ` +
          `The SAFE-03 allowlist source may have been moved or deleted. Path checked: ${TRANSPORT_SRC}`,
      );
    }
    // The canonical export signature as of Phase 17 (LOOP-02 locked)
    expect(source).toContain("export function assertElevenLabsHost(url: string | URL): string");
  });
});
