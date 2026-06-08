/**
 * Phase 18, Plan 01, Task 4 -- Behaviour tests for api-key.ts.
 *
 * Tests the three-tier API key resolution hierarchy:
 *   env -> keychain -> encrypted-file
 *
 * Coverage:
 *   - env win when ELEVENLABS_API_KEY is set
 *   - empty string env treated as not-set (falls through)
 *   - keychain win when env misses
 *   - encrypted-file win when env + keychain miss
 *   - missing result when all three miss
 *   - KeychainUnavailableError causes fall-through to encrypted-file
 *   - EncryptedKeyPermissionsError causes fall-through to missing
 *   - logger receives source + keyLength but never the key bytes
 *   - writeApiKey -> keychain path
 *   - writeApiKey -> encrypted-file path
 *   - writeApiKey refuses to write empty key
 *
 * All tests use deps injection -- no real env, keychain, or ~/.achilles
 * is touched.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import {
  resolveApiKey,
  writeApiKey,
} from "../../src/init/api-key.js";
import { KeychainUnavailableError } from "../../src/init/keychain.js";
import { EncryptedKeyPermissionsError } from "../../src/init/encrypted-key.js";

// ---------------------------------------------------------------------------
// resolveApiKey -- env tier
// ---------------------------------------------------------------------------

describe("resolveApiKey -- env tier", () => {
  it("returns source=env when envImpl.ELEVENLABS_API_KEY is set", async () => {
    const result = await resolveApiKey({
      envImpl: { ELEVENLABS_API_KEY: "xi-test-key-env-12345678" },
      readKeychainImpl: vi.fn(),
      readEncryptedKeyImpl: vi.fn(),
    });
    expect(result.source).toBe("env");
    expect(result.key).toBe("xi-test-key-env-12345678");
  });

  it("treats envImpl.ELEVENLABS_API_KEY === '' as not set (falls through)", async () => {
    const readKeychainImpl = vi.fn().mockResolvedValue("xi-keychain-key-12345");
    const result = await resolveApiKey({
      envImpl: { ELEVENLABS_API_KEY: "" },
      readKeychainImpl,
      readEncryptedKeyImpl: vi.fn(),
    });
    // Empty string env must fall through to keychain.
    expect(result.source).toBe("keychain");
    expect(result.key).toBe("xi-keychain-key-12345");
    expect(readKeychainImpl).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- keychain tier
// ---------------------------------------------------------------------------

describe("resolveApiKey -- keychain tier", () => {
  it("returns source=keychain when env miss but readKeychainImpl resolves to a string", async () => {
    const readKeychainImpl = vi
      .fn()
      .mockResolvedValue("xi-keychain-stored-key-1234");
    const result = await resolveApiKey({
      envImpl: {},
      readKeychainImpl,
      readEncryptedKeyImpl: vi.fn(),
    });
    expect(result.source).toBe("keychain");
    expect(result.key).toBe("xi-keychain-stored-key-1234");
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- encrypted-file tier
// ---------------------------------------------------------------------------

describe("resolveApiKey -- encrypted-file tier", () => {
  it("returns source=encrypted-file when env + keychain miss but readEncryptedKeyImpl resolves", async () => {
    const readKeychainImpl = vi.fn().mockResolvedValue(null);
    const readEncryptedKeyImpl = vi
      .fn()
      .mockResolvedValue("xi-encrypted-file-key-123");
    const result = await resolveApiKey({
      envImpl: {},
      readKeychainImpl,
      readEncryptedKeyImpl,
    });
    expect(result.source).toBe("encrypted-file");
    expect(result.key).toBe("xi-encrypted-file-key-123");
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- missing tier
// ---------------------------------------------------------------------------

describe("resolveApiKey -- missing", () => {
  it("returns source=missing when all three sources miss", async () => {
    const readKeychainImpl = vi.fn().mockResolvedValue(null);
    const readEncryptedKeyImpl = vi.fn().mockResolvedValue(null);
    const result = await resolveApiKey({
      envImpl: {},
      readKeychainImpl,
      readEncryptedKeyImpl,
    });
    expect(result.source).toBe("missing");
    expect(result.key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- KeychainUnavailableError fall-through
// ---------------------------------------------------------------------------

describe("resolveApiKey -- KeychainUnavailableError fall-through", () => {
  it("falls through to encrypted-file when readKeychainImpl throws KeychainUnavailableError", async () => {
    const readKeychainImpl = vi
      .fn()
      .mockRejectedValue(
        new KeychainUnavailableError("libsecret missing", new Error("inner")),
      );
    const readEncryptedKeyImpl = vi
      .fn()
      .mockResolvedValue("xi-encrypted-fallback-key-123");
    const result = await resolveApiKey({
      envImpl: {},
      readKeychainImpl,
      readEncryptedKeyImpl,
    });
    expect(result.source).toBe("encrypted-file");
    expect(result.key).toBe("xi-encrypted-fallback-key-123");
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- EncryptedKeyPermissionsError fall-through
// ---------------------------------------------------------------------------

describe("resolveApiKey -- EncryptedKeyPermissionsError fall-through", () => {
  it("returns source=missing when readEncryptedKeyImpl throws EncryptedKeyPermissionsError", async () => {
    const readKeychainImpl = vi.fn().mockResolvedValue(null);
    const readEncryptedKeyImpl = vi
      .fn()
      .mockRejectedValue(
        new EncryptedKeyPermissionsError("perms too loose", 0o644),
      );
    const result = await resolveApiKey({
      envImpl: {},
      readKeychainImpl,
      readEncryptedKeyImpl,
    });
    expect(result.source).toBe("missing");
    expect(result.key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey -- logger contract (SAFE-01)
// ---------------------------------------------------------------------------

describe("resolveApiKey -- logger contract", () => {
  it("logger receives source + keyLength but never the key bytes", async () => {
    const testKey = "xi-secret-key-do-not-log-123456789012345678901";
    const logEvents: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const logger = (
      event: string,
      fields: { source?: string; keyLength?: number },
    ) => {
      logEvents.push({ event, fields });
    };

    await resolveApiKey({
      envImpl: { ELEVENLABS_API_KEY: testKey },
      readKeychainImpl: vi.fn(),
      readEncryptedKeyImpl: vi.fn(),
      logger,
    });

    // Logger must have been called.
    expect(logEvents.length).toBeGreaterThanOrEqual(1);

    // None of the log fixture serialisations should contain the key string.
    const serialised = JSON.stringify(logEvents);
    expect(serialised).not.toContain(testKey);
    // And not even a 10-char substring of the key that would be diagnostic.
    expect(serialised).not.toContain(testKey.slice(10, 25));
  });
});

// ---------------------------------------------------------------------------
// writeApiKey -- keychain path
// ---------------------------------------------------------------------------

describe("writeApiKey -- keychain path", () => {
  it("calls writeKeychainImpl with ('achilles', 'ELEVENLABS_API_KEY', key)", async () => {
    const writeKeychainImpl = vi.fn().mockResolvedValue(undefined);
    await writeApiKey("xi-write-test-key-1234567890", "keychain", {
      writeKeychainImpl,
      writeEncryptedKeyImpl: vi.fn(),
    });
    expect(writeKeychainImpl).toHaveBeenCalledWith(
      "achilles",
      "ELEVENLABS_API_KEY",
      "xi-write-test-key-1234567890",
    );
  });
});

// ---------------------------------------------------------------------------
// writeApiKey -- encrypted-file path
// ---------------------------------------------------------------------------

describe("writeApiKey -- encrypted-file path", () => {
  it("calls writeEncryptedKeyImpl with (key)", async () => {
    const writeEncryptedKeyImpl = vi.fn().mockResolvedValue(undefined);
    await writeApiKey("xi-write-enc-key-12345678901", "encrypted-file", {
      writeKeychainImpl: vi.fn(),
      writeEncryptedKeyImpl,
    });
    expect(writeEncryptedKeyImpl).toHaveBeenCalledWith(
      "xi-write-enc-key-12345678901",
    );
  });
});

// ---------------------------------------------------------------------------
// writeApiKey -- empty key rejection
// ---------------------------------------------------------------------------

describe("writeApiKey -- empty key rejection", () => {
  it("throws when passed an empty key string", async () => {
    await expect(
      writeApiKey("", "keychain", {
        writeKeychainImpl: vi.fn(),
        writeEncryptedKeyImpl: vi.fn(),
      }),
    ).rejects.toThrow("api-key: refusing to write empty key");
  });
});
