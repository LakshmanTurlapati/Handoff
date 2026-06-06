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
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_TRANSCRIPT_COMMITTED,
  IPC_TRANSCRIPT_PARTIAL,
  IPC_TTS_AMPLITUDE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
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
