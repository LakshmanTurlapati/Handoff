/**
 * Phase 18, Plan 01, Task 4 -- Three-tier API key resolver.
 *
 * Requirements:
 *   - INIT-02: Resolution hierarchy is env -> keychain -> encrypted-file.
 *     The first source that produces a non-empty string wins. The env var
 *     is read-only; writeApiKey() refuses to write to it.
 *   - SAFE-01: The key bytes NEVER appear in any log output. The optional
 *     logger seam receives only the source enum and the key length (for
 *     diagnostic correlation). There are zero console.log/console.error
 *     calls in this module.
 *
 * Fall-through contracts:
 *   - KeychainUnavailableError from readKeychain -> continue to encrypted-file
 *   - EncryptedKeyPermissionsError from readEncryptedKey -> continue to "missing"
 *   - Any OTHER thrown error propagates (T-18-04 mitigate: real bugs are not masked)
 *
 * Write contract:
 *   - writeApiKey(key, "keychain") -> writeKeychain("achilles", "ELEVENLABS_API_KEY", key)
 *   - writeApiKey(key, "encrypted-file") -> writeEncryptedKey(key)
 *   - writeApiKey("", ...) throws (refuse to persist an empty key)
 *   - Target "env" is not a valid write target by design (env is read-only).
 *
 * Public surface:
 *
 *   - type ApiKeySource
 *   - interface ApiKeyResolveResult
 *   - interface ResolveApiKeyDeps
 *   - interface WriteApiKeyDeps
 *   - resolveApiKey(deps?): Promise<ApiKeyResolveResult>
 *   - writeApiKey(key, target, deps?): Promise<void>
 *
 * No emojis (CLAUDE.md global).
 */

import {
  readKeychain,
  writeKeychain,
  KeychainUnavailableError,
} from "./keychain.js";
import {
  readEncryptedKey,
  writeEncryptedKey,
  EncryptedKeyPermissionsError,
} from "./encrypted-key.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Identifies which tier of the resolution hierarchy produced the key.
 *
 * @public
 */
export type ApiKeySource = "env" | "keychain" | "encrypted-file" | "missing";

/**
 * Result returned by resolveApiKey(). The `key` field is null when
 * source === "missing"; non-null for all other sources.
 *
 * @public
 */
export interface ApiKeyResolveResult {
  readonly source: ApiKeySource;
  readonly key: string | null;
}

// ---------------------------------------------------------------------------
// Deps interfaces
// ---------------------------------------------------------------------------

/**
 * Injection seam for resolveApiKey(). Tests inject all three fields to run
 * hermetically without touching process.env, the real OS keychain, or
 * ~/.achilles/key.enc.
 *
 * @public
 */
export interface ResolveApiKeyDeps {
  /**
   * Override process.env. Tests inject a plain object like
   * { ELEVENLABS_API_KEY: "xi-..." } or {} to control the env tier.
   * Defaults to process.env.
   */
  readonly envImpl?: NodeJS.ProcessEnv;

  /**
   * Override readKeychain. Tests inject a vi.fn() mock.
   * Defaults to the real readKeychain from keychain.ts.
   */
  readonly readKeychainImpl?: typeof readKeychain;

  /**
   * Override readEncryptedKey. Tests inject a vi.fn() mock.
   * Defaults to the real readEncryptedKey from encrypted-key.ts.
   */
  readonly readEncryptedKeyImpl?: typeof readEncryptedKey;

  /**
   * Optional structured logger seam. Receives ONLY the source enum and the
   * key length -- never the key bytes (SAFE-01). The resolver calls this
   * after each successful resolution or on the "missing" outcome.
   */
  readonly logger?: (
    event: string,
    fields: { source?: ApiKeySource; keyLength?: number },
  ) => void;
}

/**
 * Injection seam for writeApiKey(). Tests inject writeKeychainImpl and
 * writeEncryptedKeyImpl mocks so no real keychain or fs side effects occur.
 *
 * @public
 */
export interface WriteApiKeyDeps {
  /**
   * Override writeKeychain. Tests inject a vi.fn() mock.
   * Defaults to the real writeKeychain from keychain.ts.
   */
  readonly writeKeychainImpl?: typeof writeKeychain;

  /**
   * Override writeEncryptedKey. Tests inject a vi.fn() mock.
   * Defaults to the real writeEncryptedKey from encrypted-key.ts.
   */
  readonly writeEncryptedKeyImpl?: typeof writeEncryptedKey;

  /**
   * Optional structured logger seam. Receives only the source enum.
   * Never receives the key bytes.
   */
  readonly logger?: (
    event: string,
    fields: { source?: ApiKeySource },
  ) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the ElevenLabs API key using the three-tier hierarchy:
 *
 *   1. ELEVENLABS_API_KEY env var (first; read-only; never overwritten)
 *   2. OS keychain via readKeychain("achilles", "ELEVENLABS_API_KEY")
 *   3. Encrypted file at ~/.achilles/key.enc via readEncryptedKey()
 *
 * Fall-through rules:
 *   - KeychainUnavailableError -> skip keychain, try encrypted-file
 *   - EncryptedKeyPermissionsError -> skip encrypted-file, return "missing"
 *   - Any other thrown error propagates (T-18-04: do not mask real bugs)
 *   - Empty-string env var is treated as "not set" (common shell mistake)
 *
 * @public
 */
export async function resolveApiKey(
  deps?: ResolveApiKeyDeps,
): Promise<ApiKeyResolveResult> {
  const envImpl = deps?.envImpl ?? process.env;
  const readKeychainImpl = deps?.readKeychainImpl ?? readKeychain;
  const readEncryptedKeyImpl = deps?.readEncryptedKeyImpl ?? readEncryptedKey;
  const logger = deps?.logger;

  // --- Tier 1: env var ---
  const envKey = envImpl["ELEVENLABS_API_KEY"];
  if (typeof envKey === "string" && envKey.length > 0) {
    logger?.("api_key_resolved", { source: "env", keyLength: envKey.length });
    return { source: "env", key: envKey };
  }

  // --- Tier 2: OS keychain ---
  try {
    const keychainKey = await readKeychainImpl(
      "achilles",
      "ELEVENLABS_API_KEY",
    );
    if (typeof keychainKey === "string" && keychainKey.length > 0) {
      logger?.("api_key_resolved", {
        source: "keychain",
        keyLength: keychainKey.length,
      });
      return { source: "keychain", key: keychainKey };
    }
  } catch (err) {
    if (err instanceof KeychainUnavailableError) {
      // Documented fall-through: Linux without libsecret, or platform failure.
      logger?.("api_key_keychain_unavailable", { source: "keychain" });
      // Continue to encrypted-file tier.
    } else {
      // Re-throw unexpected errors so real bugs are not silently swallowed.
      throw err;
    }
  }

  // --- Tier 3: encrypted file ---
  try {
    const fileKey = await readEncryptedKeyImpl();
    if (typeof fileKey === "string" && fileKey.length > 0) {
      logger?.("api_key_resolved", {
        source: "encrypted-file",
        keyLength: fileKey.length,
      });
      return { source: "encrypted-file", key: fileKey };
    }
  } catch (err) {
    if (err instanceof EncryptedKeyPermissionsError) {
      // Documented fall-through: permissions too loose; Plan 03 wizard
      // will inspect the error for remediation guidance. The resolver
      // itself returns "missing" so the application loop boots gracefully.
      logger?.("api_key_perms_error", { source: "encrypted-file" });
      // Continue to "missing".
    } else {
      throw err;
    }
  }

  // --- All tiers missed ---
  logger?.("api_key_resolved", { source: "missing" });
  return { source: "missing", key: null };
}

/**
 * Persist the API key to the requested storage target.
 *
 * - "keychain": writes to the OS keychain via writeKeychain().
 * - "encrypted-file": writes to ~/.achilles/key.enc via writeEncryptedKey().
 * - The env var target is intentionally absent: the env var is read-only by
 *   contract (INIT-02). The TypeScript exhaustiveness check below ensures a
 *   future addition of "env" to WriteTarget would produce a compile error.
 *
 * Throws if `key` is empty (prevents persisting an empty placeholder).
 *
 * @public
 */
export async function writeApiKey(
  key: string,
  target: "keychain" | "encrypted-file",
  deps?: WriteApiKeyDeps,
): Promise<void> {
  if (key.length === 0) {
    throw new Error("api-key: refusing to write empty key");
  }

  const writeKeychainImpl = deps?.writeKeychainImpl ?? writeKeychain;
  const writeEncryptedKeyImpl = deps?.writeEncryptedKeyImpl ?? writeEncryptedKey;
  const logger = deps?.logger;

  switch (target) {
    case "keychain":
      await writeKeychainImpl("achilles", "ELEVENLABS_API_KEY", key);
      logger?.("api_key_written", { source: "keychain" });
      return;

    case "encrypted-file":
      await writeEncryptedKeyImpl(key);
      logger?.("api_key_written", { source: "encrypted-file" });
      return;

    default: {
      // TypeScript exhaustiveness check. This branch is unreachable at
      // runtime but catches future additions to the target union at
      // compile time.
      const _exhaust: never = target;
      throw new Error(`api-key: unknown write target: ${String(_exhaust)}`);
    }
  }
}
