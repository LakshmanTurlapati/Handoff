/**
 * Single read point for the ElevenLabs API key in the Achilles main
 * process.
 *
 * Plan 12-04 Task 1 — readApiKey reads from the electron-store wrapper
 * (which itself layers safeStorage encryption on top per Plan 11-01)
 * with a falls-back to `process.env.ELEVENLABS_API_KEY`. When both are
 * absent, the function throws a typed `MissingApiKeyError` so the
 * caller (main/index.ts) can branch on the graceful-degradation path.
 *
 * Why a single read point:
 *
 *   - SAFE-01: the key must not appear anywhere outside the main
 *     process. The orchestrator (session.ts) calls readApiKey ONCE and
 *     captures the resolved string in a closure; renderer-side IPC
 *     never sees the bytes. STT clients receive single-use tokens
 *     minted by @achilles/voice-stt/token-mint, not the key.
 *
 *   - The logger seam emits an [achilles]-prefixed info message
 *     indicating which source supplied the key (store vs. env). The
 *     key bytes are NEVER concatenated into the log message — only
 *     the source name is. The K5 leak-prevention test pins this
 *     invariant.
 *
 * Pure: depends only on the injected `store` + `env`, no clock reads,
 * no global state, no I/O outside the seams.
 */

/**
 * Typed error thrown by {@link readApiKey} when neither the store nor
 * `process.env.ELEVENLABS_API_KEY` provides a non-empty value. Named so
 * the caller can do `err instanceof MissingApiKeyError` to branch into
 * a degraded-mode boot.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ELEVENLABS_API_KEY is missing — set the env var or use the Phase 13 init wizard to store it via safeStorage.",
    );
    this.name = "MissingApiKeyError";
  }
}

/**
 * Dependencies for {@link readApiKey}. The store + env are injected so
 * tests can run without touching electron-store or process.env.
 */
export interface KeySourceDeps {
  /**
   * Subset of AchillesStore exposing only the readElevenlabsApiKey()
   * method — the wider store surface is intentionally NOT required so
   * callers can pass a minimal in-test stub.
   */
  store: { readElevenlabsApiKey(): string | null };
  /**
   * Environment object whose ELEVENLABS_API_KEY field is consulted as
   * the fallback. Production callers pass `process.env`.
   */
  env: NodeJS.ProcessEnv;
  /**
   * Optional logger sink. Defaults to console.error with the
   * [achilles] prefix. The logger is invoked with a single string
   * argument; the function MUST NOT include the key bytes in the
   * message (the K5 leak-prevention test asserts this invariant).
   */
  logger?: (msg: string) => void;
}

/**
 * Read the ElevenLabs API key from the configured sources.
 *
 * Precedence (locked):
 *
 *   1. store.readElevenlabsApiKey() — safeStorage-encrypted blob from
 *      the Phase 13 init wizard.
 *   2. env.ELEVENLABS_API_KEY — v1.2 ergonomic fallback for power users
 *      who do not want to run the wizard.
 *   3. throw MissingApiKeyError.
 *
 * @throws MissingApiKeyError when neither source supplies a non-empty
 *         value.
 */
export function readApiKey(deps: KeySourceDeps): string {
  const log =
    deps.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });

  const fromStore = deps.store.readElevenlabsApiKey();
  if (fromStore !== null && typeof fromStore === "string" && fromStore.length > 0) {
    log("[achilles] elevenlabs api key sourced from store");
    return fromStore;
  }

  const fromEnv = deps.env.ELEVENLABS_API_KEY;
  if (fromEnv !== undefined && typeof fromEnv === "string" && fromEnv.length > 0) {
    log("[achilles] elevenlabs api key sourced from env");
    return fromEnv;
  }

  throw new MissingApiKeyError();
}
