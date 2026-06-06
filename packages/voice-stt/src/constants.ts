/**
 * Locked constants for the Achilles STT wrapper.
 *
 * These values are deliberately frozen here so a downstream caller
 * cannot negotiate them. Each one is keyed to a PITFALLS.md entry that
 * motivates the lock:
 *
 *   - SCRIBE_MODEL          -> PITFALLS #5 (Wrong model choice)
 *   - AUDIO_FORMAT          -> PITFALLS #1 (Sample-rate / codec mismatch)
 *   - RECONNECT_MAX_ATTEMPTS-> PITFALLS #4 (WebSocket lifecycle + 429
 *                                            distinction)
 *
 * The URLs are kept as string literals (rather than URL objects) so the
 * SAFE-03 allowlist matcher in @achilles/voice-protocol can be invoked
 * uniformly from both the renderer-side realtime client and the
 * main-process token mint helper.
 */

/**
 * ElevenLabs Scribe v2 Realtime model identifier (PITFALLS #5).
 *
 * Scribe v1 and the Turbo model are deprecated; the wrapper refuses
 * any other model literal at construction time. The `as const` narrows
 * the type to the literal value so callers cannot widen it to
 * `string` and accidentally negotiate a different model downstream.
 */
export const SCRIBE_MODEL = "scribe_v2_realtime" as const;

export type ScribeModel = typeof SCRIBE_MODEL;

/**
 * Audio format the renderer-side STT client expects (PITFALLS #1).
 *
 * Frames arriving at `write()` MUST already be downsampled to this
 * shape. The wrapper does not resample — that responsibility lives in
 * the renderer's `AudioWorklet` (Phase 11). The `encoding` value
 * matches the ElevenLabs realtime WebSocket's `pcm_16000` literal.
 */
export const AUDIO_FORMAT = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  encoding: "pcm_16000",
} as const;

export type AudioFormat = typeof AUDIO_FORMAT;

/**
 * Default ElevenLabs Scribe v2 Realtime WebSocket URL.
 *
 * Regional siblings (`api.us.`, `api.eu.residency.`, `api.in.residency.`)
 * are accepted by the SAFE-03 allowlist and may be passed to
 * `createRealtimeSttClient({ url })` at construction time.
 */
export const STT_REALTIME_URL =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

/**
 * Default ElevenLabs single-use token mint URL. The main process POSTs
 * the API key here to receive a ~15-minute token; the renderer never
 * sees this URL or the key. Regional overrides are allowed via the
 * `endpoint` option on the main-process mint helper (loaded from a
 * separate exports subpath — see `./token-mint.ts`).
 */
export const TOKEN_MINT_URL = "https://api.elevenlabs.io/v1/realtime/token";

/**
 * Maximum reconnect attempts before the realtime client surfaces a
 * terminal error (PITFALLS #4).
 *
 * Attempts are zero-indexed: 0..MAX_ATTEMPTS-1 produce a finite backoff
 * delay from `computeBackoffMs`; `attempt >= MAX_ATTEMPTS` returns
 * `Infinity` to signal "give up".
 */
export const RECONNECT_MAX_ATTEMPTS = 5;

/**
 * Refuse any model literal that is not the locked Scribe v2 Realtime
 * identifier (PITFALLS #5). Used by the wrapper at construction time
 * if a caller ever tries to pass a model through.
 */
export function assertScribeModel(model: string): ScribeModel {
  if (model !== SCRIBE_MODEL) {
    throw new Error(
      `Refusing model '${model}': only '${SCRIBE_MODEL}' is permitted (Turbo and Scribe v1 are deprecated; PITFALLS #5)`,
    );
  }
  return SCRIBE_MODEL;
}
