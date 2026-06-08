/**
 * Phase 18, Plan 01, Task 2 — Behaviour tests for keychain.ts.
 *
 * The @napi-rs/keyring SDK is the trusted intermediary; this module
 * wraps it with a typed-fallback error so the api-key resolver can
 * gracefully fall through to the encrypted-file path on Linux without
 * libsecret (the documented failure mode per CONTEXT.md).
 *
 * Every test injects a `keyringImpl` mock via the deps seam — NO test
 * touches the real OS keychain.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, expect, it, vi } from "vitest";
import {
  readKeychain,
  writeKeychain,
  KeychainUnavailableError,
} from "../../src/init/keychain.js";

describe("readKeychain — happy path", () => {
  it("returns the value when keyringImpl.getPassword resolves to a string", async () => {
    const keyringImpl = {
      getPassword: vi.fn().mockResolvedValue("xi-fake-key-value"),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    const result = await readKeychain("achilles", "ELEVENLABS_API_KEY", {
      keyringImpl,
    });
    expect(result).toBe("xi-fake-key-value");
    expect(keyringImpl.getPassword).toHaveBeenCalledWith(
      "achilles",
      "ELEVENLABS_API_KEY",
    );
  });
});

describe("readKeychain — empty entry", () => {
  it("returns null when keyringImpl.getPassword resolves to null (no entry)", async () => {
    const keyringImpl = {
      getPassword: vi.fn().mockResolvedValue(null),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    const result = await readKeychain("achilles", "MISSING_KEY", {
      keyringImpl,
    });
    expect(result).toBeNull();
  });
});

describe("readKeychain — keychain unavailable", () => {
  it("throws KeychainUnavailableError with .cause when keyringImpl.getPassword rejects", async () => {
    const innerErr = new Error("libsecret missing");
    const keyringImpl = {
      getPassword: vi.fn().mockRejectedValue(innerErr),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      readKeychain("achilles", "ELEVENLABS_API_KEY", { keyringImpl }),
    ).rejects.toBeInstanceOf(KeychainUnavailableError);
    try {
      await readKeychain("achilles", "ELEVENLABS_API_KEY", { keyringImpl });
    } catch (e) {
      expect(e).toBeInstanceOf(KeychainUnavailableError);
      expect((e as KeychainUnavailableError).cause).toBe(innerErr);
    }
  });
});

describe("writeKeychain — happy path", () => {
  it("calls keyringImpl.setPassword with (service, account, secret)", async () => {
    const keyringImpl = {
      getPassword: vi.fn().mockResolvedValue(null),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    await writeKeychain(
      "achilles",
      "ELEVENLABS_API_KEY",
      "xi-secret",
      { keyringImpl },
    );
    expect(keyringImpl.setPassword).toHaveBeenCalledWith(
      "achilles",
      "ELEVENLABS_API_KEY",
      "xi-secret",
    );
  });
});

describe("writeKeychain — keychain unavailable", () => {
  it("throws KeychainUnavailableError when keyringImpl.setPassword rejects", async () => {
    const innerErr = new Error("libsecret missing");
    const keyringImpl = {
      getPassword: vi.fn().mockResolvedValue(null),
      setPassword: vi.fn().mockRejectedValue(innerErr),
    };
    await expect(
      writeKeychain("achilles", "ELEVENLABS_API_KEY", "xi-secret", {
        keyringImpl,
      }),
    ).rejects.toBeInstanceOf(KeychainUnavailableError);
  });
});

describe("KeychainUnavailableError — class shape", () => {
  it("instances pass instanceof KeychainUnavailableError check", () => {
    const err = new KeychainUnavailableError("test", new Error("inner"));
    expect(err).toBeInstanceOf(KeychainUnavailableError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("KeychainUnavailableError");
    expect(err.cause).toBeInstanceOf(Error);
  });
});
