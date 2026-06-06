/**
 * @achilles/voice-protocol
 *
 * Shared Zod-validated TypeScript contracts consumed by:
 *
 *   - @achilles/voice-stt (Plan 09-02) — renderer-side STT wrapper
 *   - @achilles/voice-tts (Plan 09-03) — main-process TTS wrapper
 *   - apps/achilles (Phase 11+)        — renderer + main IPC handlers
 *
 * The barrel below is the single supported import surface for
 * downstream code; submodule boundaries (`./stt-events.js`,
 * `./tts-events.js`, `./ipc.js`, `./transport.js`) are an
 * implementation detail and may change without a major version bump.
 *
 * Contracts owned here:
 *
 *   - STT events:  PartialTranscript, CommittedTranscript, SttErrorEvent
 *   - TTS events:  TtsChunk (sequenced), TtsStreamComplete
 *   - IPC envelope: MintSttTokenRequest, MintSttTokenResponse, union
 *   - Outbound:    isElevenLabsHost, assertElevenLabsHost,
 *                  ELEVENLABS_HOST_ALLOWLIST
 *
 * Each schema is paired with its companion `type X = z.infer<...>`
 * alias so callers can use the runtime guard and the static type
 * from the same import.
 */
export * from "./stt-events.js";
export * from "./tts-events.js";
export * from "./ipc.js";
export * from "./transport.js";
