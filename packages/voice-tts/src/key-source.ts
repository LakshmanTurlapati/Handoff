/**
 * Consumer-injected API-key reader hook for @achilles/voice-tts.
 *
 * The package's security stance is intentional and narrow:
 *
 *   - We do NOT read `process.env.ELEVENLABS_API_KEY` (or any env var).
 *   - We do NOT call `safeStorage.decryptString(...)` or any OS keystore.
 *   - We do NOT persist the API key anywhere after the callback resolves.
 *   - We do NOT log the resolved key (PITFALLS #22).
 *
 * Instead, the consumer (Phase 11 Electron main process; Phase 12
 * orchestrator) injects a `KeySource` callback. The Achilles main
 * process reads the key from `safeStorage` (macOS Keychain / Windows
 * DPAPI / libsecret) on demand and resolves the promise; this package
 * forwards the resolved string to the WebSocket open frame and drops
 * the local reference once the frame is on the wire.
 *
 * Citations:
 *   - SAFE-01 (REQUIREMENTS.md) — API key never leaves main process
 *   - PITFALLS #22 — ElevenLabs API key leaks to client-side code or logs
 *   - 09-CONTEXT.md decisions — key stored only in main; renderer never sees it
 */

/**
 * `KeySource` is the consumer-injected callback for the ElevenLabs API
 * key. The signature is deliberately zero-argument so that the only
 * direction of data flow is `consumer -> wrapper`: the wrapper can
 * `await source()` to obtain a key, but it cannot supply one.
 *
 * This shape — `() => Promise<string>` — is the entire surface area of
 * the package's authentication contract. There is no `apiKey` field on
 * `CreateTtsStreamClientOptions`. There is no `setApiKey(key)` setter.
 * A misuse where a caller passes the raw key directly is impossible to
 * express by the types.
 */
export type KeySource = () => Promise<string>;

/**
 * Minimum length we require for a valid API key. ElevenLabs production
 * keys are `sk_` + a long hex suffix and run well past 32 characters;
 * 32 is the floor used by the renderer-side validator in
 * `@achilles/voice-protocol/ipc.ts` (`ELEVENLABS_KEY_MIN_LENGTH`) and
 * we align here so misconfigurations fail at the wrapper boundary
 * with a clear message instead of being accepted, sent over the wire,
 * and rejected by ElevenLabs with an opaque close code.
 *
 * Aligning with the renderer floor also means the IPC envelope check
 * and the main-process keystore check enforce the SAME shape; a key
 * that survives the IPC validator will, by construction, survive this
 * check too.
 */
const MIN_KEY_LENGTH = 32;

/**
 * Await the injected `KeySource` callback and validate the resolved
 * value before handing it to the WebSocket layer.
 *
 * On success, returns the resolved string verbatim. On failure,
 * throws a normalised `Error` whose message ALWAYS begins with the
 * literal `[voice-tts] failed to read API key from injected keySource`
 * prefix — this is the documented log line the consumer can grep for.
 *
 * Validation rules:
 *
 *   1. The callback must resolve, not throw. Thrown errors are wrapped
 *      and re-thrown with the documented prefix so the failure surfaces
 *      at the wrapper boundary, not from somewhere deep inside the
 *      consumer's keystore code.
 *   2. The resolved value must be a non-empty string of at least
 *      `MIN_KEY_LENGTH` characters. Anything else triggers an
 *      `invalid key shape from keySource` error.
 */
export async function callKeySource(source: KeySource): Promise<string> {
  let raw: unknown;
  try {
    raw = await source();
  } catch (cause) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `[voice-tts] failed to read API key from injected keySource: ${causeMessage}`,
    );
  }
  if (typeof raw !== "string" || raw.length < MIN_KEY_LENGTH) {
    throw new Error(
      "[voice-tts] failed to read API key from injected keySource: invalid key shape from keySource",
    );
  }
  return raw;
}
