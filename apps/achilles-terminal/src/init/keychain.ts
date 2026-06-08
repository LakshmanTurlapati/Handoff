/**
 * Phase 18, Plan 01, Task 2 — @napi-rs/keyring wrapper with typed-fallback.
 *
 * Purpose: read/write API keys to the OS keychain, surfacing a
 * KeychainUnavailableError when the platform keychain backend is not
 * present (Linux without libsecret, or other platform-level failure).
 * The api-key resolver (api-key.ts) catches this typed error and falls
 * through to the encrypted-file path; ANY other thrown error rethrows
 * so a real bug is not masked.
 *
 * Public surface:
 *
 *   - class KeychainUnavailableError extends Error { readonly cause: unknown }
 *   - interface KeychainDeps { keyringImpl?: KeyringImpl }
 *   - readKeychain(service, account, deps?): Promise<string | null>
 *   - writeKeychain(service, account, secret, deps?): Promise<void>
 *
 * The default keyringImpl wraps @napi-rs/keyring's AsyncEntry class
 * (Entry per-call so test injection never accidentally instantiates the
 * real OS keychain handle). The wrapper accepts a `keyringImpl`
 * injection seam so every unit test runs hermetically.
 *
 * Threat model:
 *   - T-18-04 mitigation: catches ONLY the underlying keyring rejection
 *     and rethrows it wrapped as KeychainUnavailableError. The resolver
 *     does the instanceof check to decide whether to continue; any
 *     other thrown error propagates and breaks the flow so a real bug
 *     is not silently masked.
 *
 * On the @napi-rs/keyring API surface:
 *   - getPassword() resolves to `string | undefined` when an entry
 *     exists; it MAY reject with a "NoEntry"-shaped error on some
 *     platforms when the entry is absent. The wrapper treats `undefined`
 *     as null and any rejection as KeychainUnavailableError so the
 *     resolver can fall through.
 *
 * No emojis (CLAUDE.md global).
 */

/**
 * Shape of a keyring implementation suitable for injection. The
 * production default wraps @napi-rs/keyring's AsyncEntry; tests inject
 * vi.fn() mocks.
 *
 * @public
 */
export interface KeyringImpl {
  /**
   * Read the password stored under (service, account). Resolves to a
   * string if an entry exists, or to null if none is set. Rejects on
   * platform-level failures (e.g. libsecret missing on Linux).
   */
  getPassword(service: string, account: string): Promise<string | null>;
  /**
   * Write the password stored under (service, account). Resolves once
   * the entry is persisted. Rejects on platform-level failures.
   */
  setPassword(
    service: string,
    account: string,
    secret: string,
  ): Promise<void>;
}

/**
 * Construction-time dependencies for readKeychain / writeKeychain.
 * Tests inject a `keyringImpl` mock so no real OS keychain is touched.
 *
 * @public
 */
export interface KeychainDeps {
  /**
   * Override the default @napi-rs/keyring-backed implementation. When
   * absent, the default wraps the AsyncEntry class lazily on first
   * call.
   */
  readonly keyringImpl?: KeyringImpl;
}

/**
 * Typed error raised when the platform keychain backend is not
 * available (Linux without libsecret, or platform-level failure). The
 * api-key resolver catches this class via `instanceof` to fall through
 * to the encrypted-file path.
 *
 * The original error is preserved on `cause` for diagnostic logging.
 *
 * @public
 */
export class KeychainUnavailableError extends Error {
  /**
   * The underlying rejection from the keyring SDK. Preserved as
   * `unknown` so the resolver does not inspect message bytes (which
   * may carry implementation detail not safe to log).
   */
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "KeychainUnavailableError";
    this.cause = cause;
  }
}

/**
 * Lazy-built default keyringImpl. The AsyncEntry class is only
 * constructed at the moment the wrapper is first called, so test
 * injection of a `keyringImpl` deps override is the cheap and complete
 * isolation guarantee — the import below is hoisted but the Entry
 * instantiation only happens inside getDefaultKeyringImpl().
 */
async function getDefaultKeyringImpl(): Promise<KeyringImpl> {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return {
    async getPassword(service, account) {
      const entry = new AsyncEntry(service, account);
      try {
        const value = await entry.getPassword();
        return value ?? null;
      } catch (err) {
        // @napi-rs/keyring may surface "NoEntry" as a rejection on
        // some platforms. Inspect the error name/message to decide
        // whether the entry is absent (return null) or the keychain
        // is unavailable (rethrow as KeychainUnavailableError via
        // the outer wrapper). We treat any "NoEntry" / "not found"
        // marker as missing and let everything else propagate.
        const msg = err instanceof Error ? err.message.toLowerCase() : "";
        if (
          msg.includes("noentry") ||
          msg.includes("no entry") ||
          msg.includes("not found")
        ) {
          return null;
        }
        throw err;
      }
    },
    async setPassword(service, account, secret) {
      const entry = new AsyncEntry(service, account);
      await entry.setPassword(secret);
    },
  };
}

/**
 * Resolve the active keyringImpl from deps or the default lazy build.
 */
async function resolveKeyringImpl(
  deps: KeychainDeps | undefined,
): Promise<KeyringImpl> {
  if (deps?.keyringImpl !== undefined) {
    return deps.keyringImpl;
  }
  return getDefaultKeyringImpl();
}

/**
 * Read the password stored at (service, account) from the OS keychain.
 *
 * - Returns the stored string when present.
 * - Returns null when no entry exists at (service, account) — this is
 *   the documented "clean miss" path; the api-key resolver moves on to
 *   the encrypted-file fallback.
 * - Throws KeychainUnavailableError when the underlying keyring backend
 *   is unavailable (e.g. Linux without libsecret).
 *
 * @public
 */
export async function readKeychain(
  service: string,
  account: string,
  deps?: KeychainDeps,
): Promise<string | null> {
  const impl = await resolveKeyringImpl(deps);
  try {
    return await impl.getPassword(service, account);
  } catch (err) {
    throw new KeychainUnavailableError(
      "OS keychain unavailable; falling back to encrypted-file path",
      err,
    );
  }
}

/**
 * Write the password at (service, account) into the OS keychain.
 *
 * Throws KeychainUnavailableError when the underlying keyring backend
 * is unavailable. The api-key resolver's writeApiKey() catches this
 * and surfaces it via the wizard's @clack/prompts UI (Plan 03).
 *
 * @public
 */
export async function writeKeychain(
  service: string,
  account: string,
  secret: string,
  deps?: KeychainDeps,
): Promise<void> {
  const impl = await resolveKeyringImpl(deps);
  try {
    await impl.setPassword(service, account, secret);
  } catch (err) {
    throw new KeychainUnavailableError(
      "OS keychain unavailable for write; falling back to encrypted-file path",
      err,
    );
  }
}
