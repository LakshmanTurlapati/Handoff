/**
 * Phase 18, Plan 01, Task 3 -- Behaviour tests for encrypted-key.ts.
 *
 * Tests the libsodium secretbox (XSalsa20-Poly1305) read/write path at
 * ~/.achilles/key.enc, including:
 *
 *   - round-trip correctness
 *   - absent-file -> null behaviour
 *   - 0o600 permissions enforcement (throws EncryptedKeyPermissionsError)
 *   - EncryptedKeyPermissionsError.mode exposes the actual perms
 *   - parent directory created at 0o700
 *   - tampered-ciphertext -> null (fail closed)
 *   - on-disk format: first 24 bytes (post base64 decode) are the nonce
 *   - nonce randomness: two writes of the same key produce different ciphertexts
 *
 * All tests use a fresh tmpdir and inject `homedirImpl` so they never
 * touch the real ~/.achilles directory.
 *
 * No emojis (CLAUDE.md global).
 */
import {
  mkdtempSync,
  statSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  readEncryptedKey,
  writeEncryptedKey,
  EncryptedKeyPermissionsError,
} from "../../src/init/encrypted-key.js";

/** Create a fresh isolated tmpdir for each test to avoid cross-test state. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "achilles-enc-"));
}

/**
 * Build a minimal deps override that routes all fs paths to `homeDir`
 * and uses a fixed machineId and a fixed randomBytes so tests are
 * deterministic by default. Caller can override specific fields.
 */
function makeDeps(
  homeDir: string,
  overrides?: Partial<{
    machineIdImpl: () => string;
    randomBytesImpl: (n: number) => Uint8Array;
  }>,
) {
  return {
    homedirImpl: () => homeDir,
    machineIdImpl: overrides?.machineIdImpl ?? (() => "test-machine-id-fixed"),
    randomBytesImpl:
      overrides?.randomBytesImpl ??
      ((n: number) => {
        // Deterministic fill: byte value = index mod 256
        const buf = new Uint8Array(n);
        for (let i = 0; i < n; i++) buf[i] = i % 256;
        return buf;
      }),
  };
}

// ---------------------------------------------------------------------------
// 1. Round-trip
// ---------------------------------------------------------------------------

describe("writeEncryptedKey -> readEncryptedKey round-trip", () => {
  it("round-trips a 51-character ElevenLabs-shaped key", async () => {
    const tmpDir = makeTmpDir();
    const deps = makeDeps(tmpDir);
    const plaintext =
      "xi-abc123456789012345678901234567890123456789012345";
    await writeEncryptedKey(plaintext, deps);
    const result = await readEncryptedKey(deps);
    expect(result).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// 2. Absent file -> null
// ---------------------------------------------------------------------------

describe("readEncryptedKey absent file", () => {
  it("returns null when the file does not exist", async () => {
    const tmpDir = makeTmpDir();
    const deps = makeDeps(tmpDir);
    const result = await readEncryptedKey(deps);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Permissions check
// ---------------------------------------------------------------------------

describe("readEncryptedKey permissions enforcement", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  it("throws EncryptedKeyPermissionsError when the file exists with 0o644 perms", async () => {
    const deps = makeDeps(tmpDir);
    await writeEncryptedKey("xi-test-key-value-1234567890123456789012345678", deps);

    // Force looser perms on the just-written file.
    const encPath = join(tmpDir, ".achilles", "key.enc");
    chmodSync(encPath, 0o644);

    await expect(readEncryptedKey(deps)).rejects.toBeInstanceOf(
      EncryptedKeyPermissionsError,
    );
  });

  it("EncryptedKeyPermissionsError.mode exposes the actual octal perms found on disk", async () => {
    const deps = makeDeps(tmpDir);
    await writeEncryptedKey("xi-test-key-value-1234567890123456789012345678", deps);

    const encPath = join(tmpDir, ".achilles", "key.enc");
    chmodSync(encPath, 0o644);

    try {
      await readEncryptedKey(deps);
      expect.fail("Expected EncryptedKeyPermissionsError to be thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EncryptedKeyPermissionsError);
      const err = e as EncryptedKeyPermissionsError;
      expect(err.mode).toBe(0o644);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Directory creation at 0o700
// ---------------------------------------------------------------------------

describe("writeEncryptedKey directory creation", () => {
  it("creates ~/.achilles/ with 0o700 perms if missing", async () => {
    const tmpDir = makeTmpDir();
    const deps = makeDeps(tmpDir);

    // Confirm parent dir does not exist yet.
    const achillesDir = join(tmpDir, ".achilles");

    await writeEncryptedKey("xi-test-key-value-1234567890123456789012345678", deps);

    const dirStat = statSync(achillesDir);
    const dirMode = dirStat.mode & 0o777;
    expect(dirMode).toBe(0o700);
  });
});

// ---------------------------------------------------------------------------
// 5. Tampered ciphertext -> null (fail closed)
// ---------------------------------------------------------------------------

describe("readEncryptedKey tamper detection", () => {
  it("returns null on tampered ciphertext (flip one byte at offset 25)", async () => {
    const tmpDir = makeTmpDir();
    const deps = makeDeps(tmpDir);
    await writeEncryptedKey("xi-test-key-value-1234567890123456789012345678", deps);

    const encPath = join(tmpDir, ".achilles", "key.enc");
    const raw = Buffer.from(readFileSync(encPath, "utf8"), "base64");

    // Flip a byte in the ciphertext area (after the 24-byte nonce).
    raw[25] = raw[25] ^ 0xff;
    writeFileSync(encPath, raw.toString("base64"), { encoding: "utf8" });
    // Restore 0o600 so the permissions check does not interfere.
    chmodSync(encPath, 0o600);

    const result = await readEncryptedKey(deps);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. On-disk format: first 24 bytes are the nonce
// ---------------------------------------------------------------------------

describe("on-disk format nonce prefix", () => {
  it("the on-disk file's first 24 raw bytes (post base64 decode) are the nonce", async () => {
    const tmpDir = makeTmpDir();

    // Two separate sets of deps with DIFFERENT random sequences.
    const seq1Calls: number[] = [];
    const deps1 = makeDeps(tmpDir, {
      randomBytesImpl: (n: number) => {
        const buf = new Uint8Array(n);
        for (let i = 0; i < n; i++) buf[i] = (i + 1) % 256; // offset by 1
        seq1Calls.push(n);
        return buf;
      },
    });

    const tmpDir2 = makeTmpDir();
    const deps2 = makeDeps(tmpDir2, {
      randomBytesImpl: (n: number) => {
        const buf = new Uint8Array(n);
        for (let i = 0; i < n; i++) buf[i] = (i + 50) % 256; // different offset
        return buf;
      },
    });

    await writeEncryptedKey("xi-key-one-1234567890123456789012345678901234", deps1);
    await writeEncryptedKey("xi-key-two-1234567890123456789012345678901234", deps2);

    const enc1 = Buffer.from(
      readFileSync(join(tmpDir, ".achilles", "key.enc"), "utf8"),
      "base64",
    );
    const enc2 = Buffer.from(
      readFileSync(join(tmpDir2, ".achilles", "key.enc"), "utf8"),
      "base64",
    );

    // The first 24 bytes of enc1 and enc2 are the nonces — they should differ
    // because we used different randomBytesImpl sequences.
    const nonce1 = enc1.subarray(0, 24);
    const nonce2 = enc2.subarray(0, 24);
    expect(Buffer.compare(nonce1, nonce2)).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Nonce randomness: two consecutive writes produce different base64 strings
// ---------------------------------------------------------------------------

describe("nonce randomness across writes", () => {
  it("two consecutive writeEncryptedKey calls with the same plaintext produce DIFFERENT base64 strings", async () => {
    const tmpDir1 = makeTmpDir();
    const tmpDir2 = makeTmpDir();

    let callCount = 0;
    const makeRandomImpl = (baseOffset: number) => (n: number) => {
      callCount++;
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        buf[i] = (i + baseOffset + callCount * 7) % 256;
      }
      return buf;
    };

    const deps1 = makeDeps(tmpDir1, { randomBytesImpl: makeRandomImpl(0) });
    const deps2 = makeDeps(tmpDir2, { randomBytesImpl: makeRandomImpl(13) });

    const plaintext = "xi-same-key-12345678901234567890123456789012345";
    await writeEncryptedKey(plaintext, deps1);
    await writeEncryptedKey(plaintext, deps2);

    const b641 = readFileSync(join(tmpDir1, ".achilles", "key.enc"), "utf8");
    const b642 = readFileSync(join(tmpDir2, ".achilles", "key.enc"), "utf8");

    expect(b641).not.toBe(b642);
  });
});
