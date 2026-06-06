/**
 * Achilles STT event contracts (LOOP-01).
 *
 * These Zod schemas describe the events that flow from the renderer-side
 * Scribe v2 Realtime wrapper (`@achilles/voice-stt`, Plan 09-02) back to
 * the rest of the Achilles main + renderer code:
 *
 *   - PartialTranscriptSchema       — interim transcript, may revise
 *   - CommittedTranscriptSchema     — final transcript for one utterance
 *   - SttErrorEventSchema           — typed wrapper error (rate-limited,
 *                                     network, auth, concurrent-cap,
 *                                     unknown)
 *
 * They are unioned by `type` into SttEventSchema and consumed by
 * downstream IPC code and the Achilles state machine.
 *
 * Lifecycle notes (see PITFALLS.md #4 — "Holding the ElevenLabs STT
 * WebSocket open indefinitely"): a `committed` event closes the current
 * utterance and is the signal the STT wrapper uses to tear the
 * WebSocket down. PITFALLS.md #1 ("Sample-rate or codec mismatch")
 * concerns the audio frames upstream of these events; this file only
 * speaks about the events themselves.
 *
 * Security notes: nothing in this contract should ever carry the
 * ElevenLabs API key. The renderer is authenticated via a single-use
 * token minted by the main process (see `./ipc.ts`).
 */
import { z } from "zod";

/**
 * Discriminator values for the three STT event variants. Order is the
 * intended emission sequence over one utterance: zero or more `partial`
 * events, then exactly one `committed`. An `error` event can appear at
 * any point and is terminal for the current utterance.
 */
export const STT_EVENT_TYPES = ["partial", "committed", "error"] as const;

export type SttEventType = (typeof STT_EVENT_TYPES)[number];

/**
 * Typed reason codes for SttErrorEventSchema. Codes that mark the
 * caller as needing to back off (`rate_limit`, `concurrent_limit`) are
 * distinct from generic `network` errors so reconnect logic can apply
 * the right backoff and so the UI can surface "rate limited" instead
 * of "network".
 */
export const STT_ERROR_CODES = [
  "rate_limit",
  "concurrent_limit",
  "network",
  "auth",
  "unknown",
] as const;

export type SttErrorCode = (typeof STT_ERROR_CODES)[number];

/**
 * Interim transcript emitted while the user is still speaking.
 *
 * - `text`: the current best-guess transcript for the utterance so far.
 *   Must be non-empty — an empty partial conveys no signal and is
 *   rejected at the boundary.
 * - `confidence`: ElevenLabs Scribe confidence in `[0, 1]`. Used by the
 *   UI to dim partials below a display threshold.
 *
 * A partial can be revised by later partials and is superseded by the
 * eventual `committed` event for the same utterance.
 */
export const PartialTranscriptSchema = z
  .object({
    type: z.literal("partial"),
    text: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type PartialTranscript = z.infer<typeof PartialTranscriptSchema>;

/**
 * Final transcript for one utterance. Terminal for the current STT
 * session — downstream code should treat this as the trigger to feed
 * the transcript into the Claude Code bridge (Phase 10).
 *
 * - `text`: the verbatim final transcript. Must be non-empty.
 * - `durationMs`: utterance duration in milliseconds, non-negative
 *   integer. Used by the latency probe (LOOP-06).
 */
export const CommittedTranscriptSchema = z
  .object({
    type: z.literal("committed"),
    text: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type CommittedTranscript = z.infer<typeof CommittedTranscriptSchema>;

/**
 * Typed error emitted when the STT wrapper cannot continue.
 *
 * - `code`: one of `STT_ERROR_CODES`. Unknown literal values are
 *   refused at the boundary.
 * - `retryable`: hint to the reconnect logic. Wrappers SHOULD set
 *   `false` for `auth` and `true` for transient `network` /
 *   `rate_limit` cases.
 * - `message`: optional human-readable detail surfaced in the UI; must
 *   never contain the raw API key, audio bytes, or full transcript
 *   content.
 */
export const SttErrorEventSchema = z
  .object({
    type: z.literal("error"),
    code: z.enum(STT_ERROR_CODES),
    retryable: z.boolean(),
    message: z.string().min(1).optional(),
  })
  .strict();

export type SttErrorEvent = z.infer<typeof SttErrorEventSchema>;

/**
 * Discriminated union over every STT event. Downstream code SHOULD
 * `switch` on `event.type` rather than introspecting individual schemas.
 */
export const SttEventSchema = z.discriminatedUnion("type", [
  PartialTranscriptSchema,
  CommittedTranscriptSchema,
  SttErrorEventSchema,
]);

export type SttEvent = z.infer<typeof SttEventSchema>;
