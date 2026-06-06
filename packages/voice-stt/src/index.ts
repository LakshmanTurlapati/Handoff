/**
 * @achilles/voice-stt — renderer-safe barrel.
 *
 * Imports from this barrel are renderer-safe: nothing here references
 * the ElevenLabs API key surface or sets the vendor authentication
 * header. The main-process token mint helper lives at the SEPARATE
 * exports subpath `@achilles/voice-stt/token-mint` and is intentionally
 * NOT re-exported here (SAFE-01).
 *
 * The grep-guard test in `./safe-01.test.ts` asserts both invariants
 * against the compiled dist output.
 */
export {
  createRealtimeSttClient,
} from "./realtime-client.js";
export type {
  CreateRealtimeSttClientOptions,
  RealtimeSttClient,
  SttSocketEvent,
  SttWebSocketCtor,
  SttWebSocketLike,
} from "./realtime-client.js";
export {
  AUDIO_FORMAT,
  RECONNECT_MAX_ATTEMPTS,
  SCRIBE_MODEL,
  STT_REALTIME_URL,
  assertScribeModel,
} from "./constants.js";
export type {
  AudioFormat,
  ScribeModel,
} from "./constants.js";
export type {
  CommittedTranscript,
  PartialTranscript,
  SttErrorCode,
  SttErrorEvent,
  SttEvent,
} from "@achilles/voice-protocol";
