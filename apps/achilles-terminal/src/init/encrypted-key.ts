/**
 * Phase 18, Plan 01, Task 3 -- libsodium secretbox read/write at
 * ~/.achilles/key.enc with 0o600 permission enforcement.
 *
 * Requirements:
 *   - SAFE-01: key never logged; 0o600 perms enforced via chmodSync after
 *     write AND verified via statSync before read.
 *   - INIT-02: encrypted-file is the third tier in the API key resolution
 *     hierarchy (env -> keychain -> encrypted file).
 *
 * On-disk format: base64(nonce_24 || ciphertext) as a single UTF-8 line.
 *
 * Encryption: XSalsa20-Poly1305 (NaCl secretBox/openSecretBox) via @stablelib/nacl.
 * The poly1305 authentication tag is prepended by the secretBox convention
 * (16 bytes), so on-disk ciphertext is 16 bytes longer than the plaintext.
 *
 * Key derivation: scryptSync(machineId, salt, 32) where:
 *   - machineId is read from /etc/machine-id (Linux), ioreg (macOS), or
 *     a generated UUID stored at ~/.achilles/.machine-id (fallback).
 *   - salt is 32 random bytes stored at ~/.achilles/.key.salt (generated
 *     once; 0o600).
 *
 * Public surface:
 *
 *   - const ENCRYPTED_KEY_PATH: string
 *   - class EncryptedKeyPermissionsError extends Error { readonly mode: number }
 *   - interface EncryptedKeyDeps
 *   - readEncryptedKey(deps?): Promise<string | null>
 *   - writeEncryptedKey(plaintext, deps?): Promise<void>
 *
 * Thread model:
 *   - T-18-01 mitigate: chmodSync(0o600) + statSync mode check on read.
 *   - T-18-02 mitigate: secretbox.open returns null on tag mismatch; caller
 *     receives null (fail closed).
 *   - T-18-03 mitigate: zero console.log / console.error calls; logger
 *     seam only (no logger imported here -- callers supply it).
 *
 * No emojis (CLAUDE.md global).
 */

import { secretBox, openSecretBox } from "@stablelib/nacl";
import { randomBytes as stableRandomBytes } from "@stablelib/random";
import { scryptSync, createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Exported constant
// ---------------------------------------------------------------------------

/**
 * Canonical path for the encrypted API key on disk.
 * Downstream callers (e.g. api-key.ts, wizard.ts) import this so there is
 * a single source of truth for the path.
 *
 * @public
 */
export const ENCRYPTED_KEY_PATH: string = join(
  homedir(),
  ".achilles",
  "key.enc",
);

// ---------------------------------------------------------------------------
// Exported error class
// ---------------------------------------------------------------------------

/**
 * Thrown by readEncryptedKey() when the key file exists but has permissions
 * looser than 0o600 (e.g. 0o644). The `mode` field carries the actual octal
 * permissions found on disk so the wizard (Plan 03) can print a diagnostic.
 *
 * @public
 */
export class EncryptedKeyPermissionsError extends Error {
  /**
   * The actual file mode (octal) reported by statSync at read time.
   * Callers can format this as `(mode >>> 0).toString(8)` for display.
   */
  readonly mode: number;

  constructor(message: string, mode: number) {
    super(message);
    this.name = "EncryptedKeyPermissionsError";
    this.mode = mode;
  }
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Injection seam for writeEncryptedKey / readEncryptedKey. Production code
 * uses the defaults; tests inject tmpdir-scoped implementations so no real
 * ~/.achilles directory is created or read.
 *
 * @public
 */
export interface EncryptedKeyDeps {
  /**
   * Returns the user's home directory. Defaults to os.homedir().
   * Tests inject () => tmpDir to isolate every fs side effect.
   */
  readonly homedirImpl?: () => string;

  /**
   * Returns a Uint8Array of `n` cryptographically random bytes. Defaults to
   * @stablelib/random's randomBytes. Tests inject a deterministic sequence
   * to make assertions on the on-disk binary layout predictable.
   */
  readonly randomBytesImpl?: (n: number) => Uint8Array;

  /**
   * Returns the machine-local identifier string used as the KDF input.
   * Defaults to the OS-specific resolver (see resolveMachineId).
   * Tests inject a fixed string to avoid platform-specific ioreg calls.
   */
  readonly machineIdImpl?: () => string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the machine-local identifier used as the scrypt password.
 *
 * Priority:
 *  1. Linux: /etc/machine-id (trim whitespace)
 *  2. macOS: ioreg IOPlatformUUID
 *  3. Fallback: ~/.achilles/.machine-id (generated once; 0o600)
 *
 * The raw id is SHA-256 hashed before being passed to scrypt so the
 * platform fingerprint never reaches the KDF directly.
 */
function resolveMachineId(homeDir: string, randomImpl: (n: number) => Uint8Array): string {
  // Linux
  if (existsSync("/etc/machine-id")) {
    try {
      const raw = readFileSync("/etc/machine-id", "utf8").trim();
      if (raw.length > 0) {
        return createHash("sha256").update(raw).digest("hex");
      }
    } catch {
      // Fall through to next method.
    }
  }

  // macOS
  if (process.platform === "darwin") {
    try {
      const ioregOutput = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        encoding: "utf8",
        timeout: 3000,
      });
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(ioregOutput);
      if (match && match[1]) {
        return createHash("sha256").update(match[1]).digest("hex");
      }
    } catch {
      // Fall through to fallback.
    }
  }

  // Fallback: persisted UUID at ~/.achilles/.machine-id
  const machineIdPath = join(homeDir, ".achilles", ".machine-id");
  if (existsSync(machineIdPath)) {
    const existing = readFileSync(machineIdPath, "utf8").trim();
    if (existing.length > 0) {
      return createHash("sha256").update(existing).digest("hex");
    }
  }

  // Generate a new UUID, persist it, and return its hash.
  const newId = Buffer.from(randomImpl(32)).toString("base64");
  mkdirSync(join(homeDir, ".achilles"), { recursive: true, mode: 0o700 });
  writeFileSync(machineIdPath, newId, { mode: 0o600 });
  chmodSync(machineIdPath, 0o600);
  return createHash("sha256").update(newId).digest("hex");
}

/**
 * Load the salt from ~/.achilles/.key.salt or generate and persist 32
 * random bytes if the file does not yet exist. Returns the salt as a
 * Uint8Array (32 bytes).
 */
function loadOrGenerateSalt(
  homeDir: string,
  randomImpl: (n: number) => Uint8Array,
): Uint8Array {
  const saltPath = join(homeDir, ".achilles", ".key.salt");
  if (existsSync(saltPath)) {
    return new Uint8Array(readFileSync(saltPath));
  }

  const salt = randomImpl(32);
  mkdirSync(join(homeDir, ".achilles"), { recursive: true, mode: 0o700 });
  writeFileSync(saltPath, Buffer.from(salt), { mode: 0o600 });
  chmodSync(saltPath, 0o600);
  return salt;
}

/**
 * Derive a 32-byte encryption key from the machine id and salt using
 * scrypt. Parameters are tuned for a single-user dev tool -- correctness
 * over performance.
 */
function deriveKey(machineId: string, salt: Uint8Array): Uint8Array {
  return new Uint8Array(
    scryptSync(machineId, Buffer.from(salt), 32, {
      N: 16384,
      r: 8,
      p: 1,
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write `plaintext` to ~/.achilles/key.enc using XSalsa20-Poly1305
 * (NaCl secretbox). The key is derived from a machine-local salt + machine
 * id via scrypt. The parent directory is created at 0o700 if absent.
 * File permissions are explicitly set to 0o600 via chmodSync after write
 * because some umasks defeat the writeFileSync mode argument.
 *
 * @public
 */
export function writeEncryptedKey(
  plaintext: string,
  deps?: EncryptedKeyDeps,
): Promise<void> {
  const homedirFn = deps?.homedirImpl ?? homedir;
  const randomImpl = deps?.randomBytesImpl ?? stableRandomBytes;
  const machineIdFn = deps?.machineIdImpl;

  const homeDir = homedirFn();
  const encDir = join(homeDir, ".achilles");
  const encPath = join(encDir, "key.enc");

  const machineId = machineIdFn
    ? machineIdFn()
    : resolveMachineId(homeDir, randomImpl);
  const salt = loadOrGenerateSalt(homeDir, randomImpl);
  const key = deriveKey(machineId, salt);

  const nonce = randomImpl(24);
  const plainBytes = new TextEncoder().encode(plaintext);
  const ciphertext = secretBox(key, nonce, plainBytes);

  const onDisk = Buffer.concat([
    Buffer.from(nonce),
    Buffer.from(ciphertext),
  ]).toString("base64");

  mkdirSync(encDir, { recursive: true, mode: 0o700 });
  writeFileSync(encPath, onDisk, { mode: 0o600 });
  // Explicit chmod because some umasks override the writeFileSync mode arg.
  chmodSync(encPath, 0o600);

  return Promise.resolve();
}

/**
 * Read the decrypted plaintext from ~/.achilles/key.enc.
 *
 * - Returns null when the file does not exist (clean miss -- fall through
 *   to the "missing" path in api-key.ts).
 * - Throws EncryptedKeyPermissionsError when the file exists with
 *   permissions looser than 0o600 (e.g. 0o644).
 * - Returns null when the authenticated decryption fails (tampered or
 *   corrupt file -- fail closed; never returns a tampered key).
 *
 * @public
 */
export function readEncryptedKey(
  deps?: EncryptedKeyDeps,
): Promise<string | null> {
  const homedirFn = deps?.homedirImpl ?? homedir;
  const randomImpl = deps?.randomBytesImpl ?? stableRandomBytes;
  const machineIdFn = deps?.machineIdImpl;

  const homeDir = homedirFn();
  const encPath = join(homeDir, ".achilles", "key.enc");

  if (!existsSync(encPath)) {
    return Promise.resolve(null);
  }

  // Permissions enforcement (T-18-01 mitigation).
  const mode = statSync(encPath).mode & 0o777;
  if (mode !== 0o600) {
    return Promise.reject(
      new EncryptedKeyPermissionsError(
        `key.enc has permissions 0o${mode.toString(8)} -- expected 0o600; refusing to read a world-readable key file`,
        mode,
      ),
    );
  }

  const onDisk = readFileSync(encPath, "utf8");
  const raw = Buffer.from(onDisk, "base64");

  // Split nonce (24 bytes) from ciphertext.
  const nonce = new Uint8Array(raw.subarray(0, 24));
  const ciphertext = new Uint8Array(raw.subarray(24));

  const machineId = machineIdFn
    ? machineIdFn()
    : resolveMachineId(homeDir, randomImpl);
  const salt = loadOrGenerateSalt(homeDir, randomImpl);
  const key = deriveKey(machineId, salt);

  // openSecretBox returns null on poly1305 tag mismatch (T-18-02 mitigation).
  const plain = openSecretBox(key, nonce, ciphertext);
  if (plain === null) {
    return Promise.resolve(null);
  }

  return Promise.resolve(new TextDecoder().decode(plain));
}
