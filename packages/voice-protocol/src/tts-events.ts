/**
 * Achilles TTS event contracts (LOOP-01 / LOOP-04 boundary).
 *
 * These Zod schemas describe the events emitted by the main-process
 * ElevenLabs Flash v2.5 wrapper (`@achilles/voice-tts`, Plan 09-03):
 *
 *   - TtsChunkSchema           — sequenced audio chunk with mime type
 *   - TtsStreamCompleteSchema  — terminal event closing the stream
 *
 * Together they let the renderer queue and play back chunks in
 * arrival-sequence order via its `AudioContext` (LOOP-05).
 *
 * Lifecycle notes (see PITFALLS.md #6 — "TTS chunks arriving faster
 * than playback drains (or out of order)"): the `sequence` field is
 * the only correctness signal for chunk ordering. Wrappers MUST emit
 * monotonically increasing, zero-based sequences and the renderer
 * MUST buffer ~500 ms before playback to absorb out-of-order arrivals.
 * `compareTtsChunkSequence` is the canonical comparator used by
 * downstream ordering tests in Plan 09-03.
 *
 * Security notes: audio bytes themselves are untrusted opaque data.
 * The schema validates the wrapper around them — not the audio.
 */
import { z } from "zod";

/**
 * MIME types Achilles negotiates with ElevenLabs Flash v2.5. MP3 is
 * the v1.2 default because the renderer's `AudioContext` decodes it
 * natively. PCM is permitted for environments that prefer raw frames.
 *
 * Any other MIME type is refused at the boundary so a misconfigured
 * wrapper cannot inject WebM, Opus, or undecodable formats into the
 * playback queue.
 */
export const TTS_MIME_TYPES = ["audio/mpeg", "audio/pcm"] as const;

export type TtsMimeType = (typeof TTS_MIME_TYPES)[number];

/**
 * Discriminator values for the two TTS event variants. `chunk` is the
 * data event; `complete` is the terminal event that signals the
 * renderer to drain its buffer and unmute the mic ~300 ms later
 * (LOOP-05 + PITFALLS.md #2 half-duplex gating).
 */
export const TTS_EVENT_TYPES = ["chunk", "complete"] as const;

export type TtsEventType = (typeof TTS_EVENT_TYPES)[number];

/**
 * One audio chunk in the TTS stream.
 *
 * - `sequence`: monotonically increasing, zero-based index. Used by
 *   `compareTtsChunkSequence` (downstream of this file) to detect
 *   out-of-order arrivals.
 * - `audio`: opaque byte stream. The renderer hands the bytes to its
 *   `AudioContext.decodeAudioData` (MP3) or schedules them directly
 *   (PCM). The schema does not inspect the bytes.
 * - `mimeType`: must be one of `TTS_MIME_TYPES`.
 */
export const TtsChunkSchema = z
  .object({
    type: z.literal("chunk"),
    sequence: z.number().int().nonnegative(),
    audio: z.instanceof(Uint8Array),
    mimeType: z.enum(TTS_MIME_TYPES),
  })
  .strict();

export type TtsChunk = z.infer<typeof TtsChunkSchema>;

/**
 * Terminal event for one TTS stream. Carries summary metrics:
 *
 * - `totalChunks`: total number of `chunk` events emitted in this
 *   stream. Must be `>= 1` — an empty stream is invalid.
 * - `durationMs`: total audible duration in milliseconds, non-negative
 *   integer. Used by LOOP-06 latency probe and by the mic re-enable
 *   timer (renderer waits ~300 ms after the last chunk drains).
 */
export const TtsStreamCompleteSchema = z
  .object({
    type: z.literal("complete"),
    totalChunks: z.number().int().min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type TtsStreamComplete = z.infer<typeof TtsStreamCompleteSchema>;

/**
 * Discriminated union over every TTS event. Downstream code SHOULD
 * `switch` on `event.type` rather than introspecting individual schemas.
 */
export const TtsEventSchema = z.discriminatedUnion("type", [
  TtsChunkSchema,
  TtsStreamCompleteSchema,
]);

export type TtsEvent = z.infer<typeof TtsEventSchema>;

/**
 * Canonical comparator for TtsChunk ordering. Used by Plan 09-03's
 * "no out-of-order playback" test and by the renderer's chunk-queue
 * insertion logic.
 *
 * Returns:
 *   negative when `a.sequence < b.sequence`
 *   zero     when equal
 *   positive when `a.sequence > b.sequence`
 *
 * NOTE: callers MUST NOT rely on the magnitude of the returned value;
 * only its sign is part of the contract. This matches the `Array.sort`
 * comparator convention.
 */
export function compareTtsChunkSequence(a: TtsChunk, b: TtsChunk): number {
  return a.sequence - b.sequence;
}
