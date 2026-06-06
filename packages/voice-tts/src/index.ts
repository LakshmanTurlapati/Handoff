/**
 * @achilles/voice-tts barrel.
 *
 * The single supported import surface for downstream consumers
 * (Phase 11 main process + Phase 12 orchestrator). Submodule paths
 * (`./constants.js`, `./stream-client.js`, etc.) are implementation
 * details and may change without a major version bump.
 *
 * The package is main-process-only — there is no renderer subpath, no
 * renderer-safe submodule. Phase 11 wires this barrel into the
 * Electron main process; the renderer talks to the main process via
 * IPC, not directly to this barrel.
 *
 * Citations:
 *   - SAFE-01 + PITFALLS #22 — the package never reads env vars or
 *     stores keys; auth is via the consumer-injected `KeySource`.
 *   - SAFE-03 — every outbound URL is validated at construction by
 *     `assertElevenLabsHost` from `@achilles/voice-protocol`.
 *   - PITFALLS #5 — model locked to `FLASH_MODEL`.
 *   - PITFALLS #6 — `CHUNK_LENGTH_SCHEDULE` + `SequenceBuffer` +
 *     `PRE_BUFFER_MS` mitigate out-of-order arrival and audible gaps.
 */

export { createTtsStreamClient } from "./stream-client.js";
export type {
  CreateTtsStreamClientOptions,
  TtsStreamClient,
  TtsOutputFormat,
} from "./stream-client.js";

export type { KeySource } from "./key-source.js";

export { SequenceBuffer } from "./sequence-buffer.js";
export type { Sequenced } from "./sequence-buffer.js";

export {
  assertFlashModel,
  buildTtsStreamUrl,
  CHUNK_LENGTH_SCHEDULE,
  DEFAULT_OUTPUT_FORMAT,
  FLASH_MODEL,
  PRE_BUFFER_MS,
  RECONNECT_MAX_ATTEMPTS,
  TTS_STREAM_URL_TEMPLATE,
} from "./constants.js";

export { computeBackoffMs } from "./backoff.js";

/**
 * Convenience re-exports of the Zod-derived TTS event types from
 * `@achilles/voice-protocol` so consumers do not need to dual-import.
 */
export type {
  TtsChunk,
  TtsEvent,
  TtsStreamComplete,
} from "@achilles/voice-protocol";
