/**
 * Achilles renderer↔main IPC payload schemas.
 *
 * Every channel listed in `constants.ts` has a `.strict()` Zod schema
 * here. The preload bridge parses every outbound payload before
 * crossing the boundary; the main-process IPC handlers parse every
 * inbound payload before dispatching. Unknown fields are rejected
 * (SAFE-01 boundary precedent — matches packages/voice-protocol).
 *
 * The map `IPC_PAYLOAD_SCHEMAS` keys each channel constant to its
 * payload schema so callers can route generically:
 *
 *   parseEnvelope("achilles:state-changed", payload)
 *
 * throws if the channel is unknown or the payload fails its schema.
 */
import { z } from "zod";
import {
  ACHILLES_STATES,
  HOTKEY_MODES,
  IPC_ERROR,
  IPC_MIC_AMPLITUDE,
  IPC_MIC_FRAME,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_STT_TOKEN,
  IPC_STT_TOKEN_REQUEST,
  IPC_TRANSCRIPT_COMMITTED,
  IPC_TRANSCRIPT_PARTIAL,
  IPC_TTS_AMPLITUDE,
  IPC_TTS_CHUNK,
  IPC_TTS_PLAYBACK_COMPLETE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
  IPC_UTTERANCE_COMMIT,
  PERMISSION_STATES,
} from "./constants.js";

// ─────────────────────────────────────────────────────────────────────
// Main → Renderer payloads
// ─────────────────────────────────────────────────────────────────────

/**
 * AchillesState membership schema. Used both as a standalone export
 * (for tests + the Renderer→Main `request-state` payload) and as the
 * inner shape of `StateChangedPayloadSchema`.
 */
export const AchillesStateSchema = z.enum(ACHILLES_STATES);

export const StateChangedPayloadSchema = z
  .object({
    state: AchillesStateSchema,
  })
  .strict();

export type StateChangedPayload = z.infer<typeof StateChangedPayloadSchema>;

export const TranscriptPartialPayloadSchema = z
  .object({
    text: z.string().min(1),
  })
  .strict();

export type TranscriptPartialPayload = z.infer<
  typeof TranscriptPartialPayloadSchema
>;

export const TranscriptCommittedPayloadSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1),
    committedAt: z.number().int().nonnegative(),
  })
  .strict();

export type TranscriptCommittedPayload = z.infer<
  typeof TranscriptCommittedPayloadSchema
>;

export const MicAmplitudePayloadSchema = z
  .object({
    rms: z.number().min(0).max(1),
  })
  .strict();

export type MicAmplitudePayload = z.infer<typeof MicAmplitudePayloadSchema>;

export const TtsAmplitudePayloadSchema = z
  .object({
    rms: z.number().min(0).max(1),
  })
  .strict();

export type TtsAmplitudePayload = z.infer<typeof TtsAmplitudePayloadSchema>;

export const PermissionStatePayloadSchema = z
  .object({
    state: z.enum(PERMISSION_STATES),
  })
  .strict();

export type PermissionStatePayload = z.infer<
  typeof PermissionStatePayloadSchema
>;

export const ErrorPayloadSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────
// Renderer → Main payloads
// ─────────────────────────────────────────────────────────────────────

export const RequestStatePayloadSchema = z
  .object({
    state: AchillesStateSchema,
  })
  .strict();

export type RequestStatePayload = z.infer<typeof RequestStatePayloadSchema>;

export const RegisterHotkeyPayloadSchema = z
  .object({
    accelerator: z.string().min(1),
  })
  .strict();

export type RegisterHotkeyPayload = z.infer<
  typeof RegisterHotkeyPayloadSchema
>;

/**
 * `open-system-settings` carries no payload — the channel itself is
 * the signal. `.strict()` keeps the door closed against future
 * piggyback fields.
 */
export const OpenSystemSettingsPayloadSchema = z.object({}).strict();

export type OpenSystemSettingsPayload = z.infer<
  typeof OpenSystemSettingsPayloadSchema
>;

/**
 * Electron's `BrowserWindow.setPosition` takes integer coordinates;
 * Floats would be silently truncated, so reject them here so a buggy
 * renderer surfaces the contract violation explicitly.
 */
export const UpdateWindowPositionPayloadSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

export type UpdateWindowPositionPayload = z.infer<
  typeof UpdateWindowPositionPayloadSchema
>;

/**
 * `update-hotkey-config` accepts a partial update: either `mode`,
 * `key`, or both. The refine guard rejects the empty-object case so
 * a buggy renderer can't fire a no-op message.
 */
export const UpdateHotkeyConfigPayloadSchema = z
  .object({
    mode: z.enum(HOTKEY_MODES).optional(),
    key: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => v.mode !== undefined || v.key !== undefined, {
    message: "at least one of mode or key required",
  });

export type UpdateHotkeyConfigPayload = z.infer<
  typeof UpdateHotkeyConfigPayloadSchema
>;

// ─────────────────────────────────────────────────────────────────────
// Phase 12 — renderer audio + STT auth surface
//
// Six new schemas paired with the six Phase 12 IPC channel constants in
// constants.ts. Each is `.strict()` so unknown fields are rejected at
// the boundary. Literal-validators on MicFramePayloadSchema pin the
// LOOP-01 audio contract (PITFALLS #1) at the IPC trust boundary —
// any sender (renderer or main) writing a wrong sample rate or frame
// size is refused before dispatch.
// ─────────────────────────────────────────────────────────────────────

/**
 * Main → Renderer. Carries one decoded TTS audio chunk. The `seq`
 * field drives the renderer playback-queue's SequenceBuffer-shape
 * ordering; `isFinal:true` triggers `onPlaybackComplete` after the
 * AudioBufferSourceNode for that chunk fires `onended`. The MIME
 * type union is locked to the two formats ElevenLabs Flash v2.5
 * supports — adding a third format is a Phase 14 decision.
 */
export const TtsChunkPayloadSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    mime: z.union([z.literal("audio/mpeg"), z.literal("audio/pcm")]),
    bytes: z.instanceof(ArrayBuffer),
    isFinal: z.boolean(),
  })
  .strict();

export type TtsChunkPayload = z.infer<typeof TtsChunkPayloadSchema>;

/**
 * Renderer → Main. Signals that the playback queue has drained the
 * last (`isFinal:true`) chunk. The channel itself is the signal —
 * the empty payload is intentional. The orchestrator (Plan 12-04)
 * uses this to drive the `speaking → idle` transition after the 300 ms
 * debounce (PITFALLS #2 half-duplex tail).
 */
export const TtsPlaybackCompletePayloadSchema = z.object({}).strict();

export type TtsPlaybackCompletePayload = z.infer<
  typeof TtsPlaybackCompletePayloadSchema
>;

/**
 * Renderer → Main. Forwards a committed utterance from the renderer
 * STT client to the main-process orchestrator. The shape deliberately
 * matches `TranscriptCommittedPayloadSchema` so the renderer-to-main
 * commit reuses the same fields; the SAFE-04 sandwich-defence wrapping
 * applies to `text` BEFORE it is sent into the Claude bridge.
 */
export const UtteranceCommitPayloadSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1),
    committedAt: z.number().int().nonnegative(),
  })
  .strict();

export type UtteranceCommitPayload = z.infer<
  typeof UtteranceCommitPayloadSchema
>;

/**
 * Renderer → Main. One downsampled mic frame (16 kHz mono Int16 PCM)
 * forwarded for either logging, multiplexed transport, or a Phase 14
 * fallback path. The literal validators on `sampleRate` (16000) and
 * `samplesPerFrame` (320) pin the LOOP-01 contract — a Phase 12
 * regression that ships 48 kHz frames is rejected at the boundary.
 *
 * Note: in the v1.2 happy path, the renderer's STT client writes
 * frames directly to the ElevenLabs WebSocket without round-tripping
 * through main. This channel exists so a Phase 14 fallback path can
 * mirror frames into a main-process diagnostic capture (gated behind
 * `--debug-audio` per PITFALLS #23). The channel is defined here so
 * Phase 12 can ship the contract; the orchestrator wiring in 12-04
 * is opt-in.
 */
export const MicFramePayloadSchema = z
  .object({
    pcm: z.instanceof(ArrayBuffer),
    sampleRate: z.literal(16000),
    samplesPerFrame: z.literal(320),
  })
  .strict();

export type MicFramePayload = z.infer<typeof MicFramePayloadSchema>;

/**
 * Renderer → Main. Empty payload — the channel itself is the signal.
 * The renderer's STT bootstrap asks main for a fresh single-use token;
 * main responds via `IPC_STT_TOKEN`. The token round-trip exists so
 * the raw ElevenLabs API key never reaches the renderer (SAFE-01).
 */
export const SttTokenRequestPayloadSchema = z.object({}).strict();

export type SttTokenRequestPayload = z.infer<
  typeof SttTokenRequestPayloadSchema
>;

/**
 * Main → Renderer. Carries the freshly minted single-use STT token.
 * `expiresAt` is an ISO-8601 timestamp; the renderer's STT client
 * refreshes when within ~30 s of expiry. Tokens are 15-minute lived
 * per the ElevenLabs realtime spec; v1.2 trusts the server-provided
 * expiry rather than computing its own.
 */
export const SttTokenPayloadSchema = z
  .object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type SttTokenPayload = z.infer<typeof SttTokenPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────
// Channel-keyed schema map + helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Channel-keyed lookup so callers can route a (channel, payload) pair
 * generically without negotiating a parallel switch. The map is the
 * single source of truth: adding a new channel constant to
 * `constants.ts` MUST be paired with a corresponding entry here.
 *
 * Typed loosely as `z.ZodTypeAny` because the discriminator is the
 * outer channel string, not a `type` literal inside the payload (the
 * Electron IPC API already routes by channel).
 */
export const IPC_PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [IPC_STATE_CHANGED]: StateChangedPayloadSchema,
  [IPC_TRANSCRIPT_PARTIAL]: TranscriptPartialPayloadSchema,
  [IPC_TRANSCRIPT_COMMITTED]: TranscriptCommittedPayloadSchema,
  [IPC_MIC_AMPLITUDE]: MicAmplitudePayloadSchema,
  [IPC_TTS_AMPLITUDE]: TtsAmplitudePayloadSchema,
  [IPC_PERMISSION_STATE]: PermissionStatePayloadSchema,
  [IPC_ERROR]: ErrorPayloadSchema,
  [IPC_REQUEST_STATE]: RequestStatePayloadSchema,
  [IPC_REGISTER_HOTKEY]: RegisterHotkeyPayloadSchema,
  [IPC_OPEN_SYSTEM_SETTINGS]: OpenSystemSettingsPayloadSchema,
  [IPC_UPDATE_WINDOW_POSITION]: UpdateWindowPositionPayloadSchema,
  [IPC_UPDATE_HOTKEY_CONFIG]: UpdateHotkeyConfigPayloadSchema,
  // Phase 12 audio + STT auth surface — APPENDED only; do not reorder
  // the entries above without revisiting the per-channel tests.
  [IPC_TTS_CHUNK]: TtsChunkPayloadSchema,
  [IPC_TTS_PLAYBACK_COMPLETE]: TtsPlaybackCompletePayloadSchema,
  [IPC_UTTERANCE_COMMIT]: UtteranceCommitPayloadSchema,
  [IPC_MIC_FRAME]: MicFramePayloadSchema,
  [IPC_STT_TOKEN_REQUEST]: SttTokenRequestPayloadSchema,
  [IPC_STT_TOKEN]: SttTokenPayloadSchema,
};

/**
 * Parses a payload against its channel's schema. Throws if the
 * channel is unknown or the payload is invalid.
 */
export function parseEnvelope(channel: string, payload: unknown): unknown {
  const schema = IPC_PAYLOAD_SCHEMAS[channel];
  if (schema === undefined) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  return schema.parse(payload);
}

/**
 * Serializes a payload through its channel's schema. Used by the
 * preload bridge before forwarding to `ipcRenderer.send` so the
 * renderer cannot smuggle unknown fields across the trust boundary.
 *
 * Returns the parsed payload (which is structurally identical to the
 * input on success but stripped of any prototype pollution Zod
 * sanitises).
 */
export function serializeForChannel(
  channel: string,
  payload: unknown,
): unknown {
  return parseEnvelope(channel, payload);
}
