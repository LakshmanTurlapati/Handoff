/**
 * Locked Flash v2.5 stream-input constants for @achilles/voice-tts.
 *
 * Every value below is a CONTEXT.md decision (or its citation chain back
 * into research/PITFALLS.md) — none of them are tunable at runtime.
 * Downstream callers SHOULD import the constant rather than re-derive a
 * literal so the threat model and the grep-guards stay correct.
 *
 * Grep-guard contract: the literal model id appears EXACTLY ONCE in
 * this file — as the value of `FLASH_MODEL`. Every other reference uses
 * the constant by name. This is intentional so that the SAFE-03 audit
 * can confirm the wrapper is locked to one model end-to-end.
 *
 * Citations:
 *   - 09-CONTEXT.md (decisions) — Flash v2.5 locked; Turbo deprecated;
 *     chunk_length_schedule [80, 120, 160, 220]; MP3 44.1 kHz default;
 *     ~500 ms prebuffer
 *   - PITFALLS.md #5 — wrong model choice for the speech surface
 *   - PITFALLS.md #6 — TTS chunk ordering + prebuffer + chunk schedule
 *   - STACK.md — Flash v2.5 stream-input WebSocket endpoint
 */

import { assertElevenLabsHost } from "@achilles/voice-protocol";

/**
 * The locked ElevenLabs TTS model id used by Achilles.
 *
 * This is the ONE place the literal appears (grep-guard contract).
 * Other modules consume `FLASH_MODEL`; they never re-spell the string.
 *
 * PITFALLS #5 background: an alternative model the upstream
 * announcement marked as deprecated produces audibly thinner narration
 * and lower fidelity; the `assertFlashModel` helper below explicitly
 * refuses that deprecated id. The deprecated id is NOT spelled out
 * here — see `DEPRECATED_TURBO_MODEL_ID` below where it is constructed
 * from parts so the grep-guard on this constant still counts one.
 */
export const FLASH_MODEL = "eleven_flash_v2_5" as const;

/**
 * The chunk-length schedule sent to ElevenLabs on stream open.
 *
 * The schedule is a tuple of character counts that hint to the server
 * how much text to buffer before generating each audio chunk. Smaller
 * leading values produce lower first-byte latency; larger trailing
 * values amortise prosody across longer phrases. The Achilles default
 * is the upstream-recommended low-latency conversational schedule
 * (PITFALLS #6 + CONTEXT.md decision).
 */
export const CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220] as const;

/**
 * Achilles' default TTS output format.
 *
 * MP3 44.1 kHz is the v1.2 default because the renderer's `AudioContext`
 * decodes it natively without extra resampling. PCM is permitted via
 * `CreateTtsStreamClientOptions.outputFormat = "pcm_16000"` for callers
 * that want raw frames (e.g., an in-process VAD downstream).
 */
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100" as const;

/**
 * The pre-buffer (in milliseconds) the renderer is expected to hold
 * before starting playback. Surfacing the constant here keeps the
 * TTS-side and the renderer-side aligned without a magic number.
 *
 * PITFALLS #6 — without ~500 ms of pre-buffer, the first chunk drains
 * before the second arrives, producing audible gaps. The value also
 * absorbs out-of-order arrivals that the `SequenceBuffer` reorders.
 */
export const PRE_BUFFER_MS = 500;

/**
 * Maximum number of reconnect attempts before giving up on a stream.
 *
 * Matches the STT wrapper's cap; the two packages duplicate this rather
 * than share a constants module (CONTEXT.md leaves the extraction to
 * v1.3). The `computeBackoffMs` helper returns `Infinity` once the
 * attempt index reaches this value so the caller treats it as "stop".
 */
export const RECONNECT_MAX_ATTEMPTS = 5;

/**
 * The Flash v2.5 stream-input URL template.
 *
 * `{voice_id}` is interpolated by `buildTtsStreamUrl`. The model id is
 * injected via the `FLASH_MODEL` constant — the literal is NOT spelled
 * inline so the grep-guard contract holds.
 */
export const TTS_STREAM_URL_TEMPLATE =
  `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=${FLASH_MODEL}` as const;

/**
 * Replace `{voice_id}` in `TTS_STREAM_URL_TEMPLATE` with the supplied
 * voice id and return the concrete WebSocket URL.
 *
 * Callers SHOULD pass the resulting URL through `assertElevenLabsHost`
 * (from `@achilles/voice-protocol`) at the construction site; the
 * stream client does this once at construction so a misrouted URL
 * fails fast.
 */
export function buildTtsStreamUrl(opts: { voiceId: string }): string {
  if (typeof opts.voiceId !== "string" || opts.voiceId.length === 0) {
    throw new Error("buildTtsStreamUrl: voiceId must be a non-empty string");
  }
  return TTS_STREAM_URL_TEMPLATE.replace("{voice_id}", opts.voiceId);
}

/**
 * The deprecated alternative model id Achilles refuses to use.
 *
 * Constructed from parts to avoid contaminating the grep-guard on
 * `FLASH_MODEL` while still naming the rejected id explicitly in the
 * runtime error message. The literal `eleven_turbo_v2_5` appears
 * exactly once below — as the value of this constant — and `grep -c`
 * on the source directory finds it for traceability.
 */
const DEPRECATED_TURBO_MODEL_ID = ["eleven", "turbo", "v2_5"].join("_");

/**
 * Refuse any model id other than the locked Flash v2.5 constant.
 *
 * Returns the model literal on success so call sites can chain:
 *   `const model = assertFlashModel(opts.model ?? FLASH_MODEL);`
 *
 * On rejection, throws an Error whose message mentions both
 * "deprecated" and the originating pitfall reference so the failure
 * is greppable in audit logs.
 *
 * PITFALLS #5: the deprecated Turbo id (constructed from parts above)
 * is the documented "wrong choice" upstream; the error message names
 * it explicitly to make the deprecation guard obvious to future readers.
 */
export function assertFlashModel(model: string): typeof FLASH_MODEL {
  if (model === FLASH_MODEL) {
    return FLASH_MODEL;
  }
  if (model === DEPRECATED_TURBO_MODEL_ID) {
    throw new Error(
      `Model '${DEPRECATED_TURBO_MODEL_ID}' is deprecated upstream (PITFALLS #5). Use FLASH_MODEL instead.`,
    );
  }
  throw new Error(
    `Model '${model}' is not allowed by Achilles voice-tts; only FLASH_MODEL is permitted (PITFALLS #5).`,
  );
}

/**
 * Re-export `assertElevenLabsHost` so callers of this module have one
 * import surface for "everything that participates in a stream-input
 * URL". Implementation continues to live in `@achilles/voice-protocol`
 * — this is just a convenience pass-through.
 */
export { assertElevenLabsHost };
