# Phase 09: Voice Vendor Wrappers - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (auto-optimized) — phase classified as infrastructure-only after analysis

<domain>
## Phase Boundary

This phase delivers three new monorepo packages that wrap the ElevenLabs voice surface so downstream Achilles code can consume STT and TTS without touching SDK or WebSocket details:

- `packages/voice-stt` — thin client around `@elevenlabs/client` Scribe v2 Realtime; renderer-side; consumes 16 kHz Int16 PCM frames; emits `partial` and `committed` transcript events
- `packages/voice-tts` — thin client around `@elevenlabs/elevenlabs-js@2.51.0` Flash v2.5 stream-input; main-process; consumes text chunks; emits sequenced audio chunks
- `packages/voice-protocol` — shared Zod-validated TypeScript types for IPC payloads, STT/TTS event shapes, the Achilles state machine enum, and the AchillesSession boundary

Adjacent obligations the phase OWNS but does not yet wire end-to-end:
- The single-use token mint flow (main mints a 15-minute ElevenLabs token; renderer authenticates with that token)
- The outbound network policy lock (only ElevenLabs hostnames reachable from voice-stt and voice-tts)
- The ElevenLabs API key surface in the main-process OS keystore (`safeStorage` + Keychain / DPAPI / libsecret)

Out of scope for Phase 09: the Electron app shell (Phase 11), the Claude Code bridge (Phase 10), the end-to-end integration / state machine / system prompt (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### Locked by REQUIREMENTS.md (do not reopen)
- Cloud-vs-local: Local Claude Code only (cloud routing deferred to v1.3)
- Mic trigger: Both press-to-toggle AND push-to-talk (UI ownership, not this phase)
- Voice selection: One fixed default voice + `ELEVENLABS_VOICE_ID` env override; no picker UI in v1.2
- Claude Code bridge: Subprocess `claude -p --output-format stream-json` (relevant to Phase 10, not here)

### Package layout
- Package names: `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/voice-protocol`. New `@achilles/*` scope rather than `@codex-mobile/*` because Achilles is a separable product distributed independently (npm `achilles` CLI + Claude Code skill)
- Workspace registration via the existing top-level `package.json` `workspaces: ["apps/*", "packages/*"]` — no change to workspaces config needed
- Each package has its own `package.json`, `tsconfig.json`, `src/`, and Vitest test files colocated as `*.test.ts` beside source files (matches repo convention; see `.planning/codebase/CONVENTIONS.md` testing section)
- Each package exports a named primary API via `src/index.ts`; no default exports (matches repo convention)

### Audio format (locked end-to-end)
- Mic capture: 48 kHz from `getUserMedia` (browser default), downsampled to 16 kHz mono Int16 PCM in an AudioWorklet (lives in `apps/achilles` renderer in Phase 11; `voice-stt` accepts already-downsampled Int16 frames)
- STT model: `scribe_v2_realtime`
- TTS model: `eleven_flash_v2_5`
- TTS output: MP3 default; PCM optional (renderer decodes via AudioContext in Phase 11)
- TTS chunk schedule: `chunk_length_schedule: [80, 120, 160, 220]` (per ARCHITECTURE.md latency tuning)

### WebSocket lifecycle
- STT WebSocket opens on `start()` (called when listening state begins) and closes after final commit
- Reconnect: exponential backoff with full jitter, capped at 5 attempts; distinguish ElevenLabs 429-class errors (rate limit, concurrent cap) from network errors and surface them as typed reconnect events
- Heartbeat: rely on ElevenLabs server-side ping; no custom keep-alive
- TTS WebSocket: stream-input pattern (open per utterance, drain, close); separate from STT socket

### Security boundary
- ElevenLabs API key is read in main process only via Electron `safeStorage` (which is backed by macOS Keychain / Windows DPAPI / libsecret on Linux)
- Renderer never sees the API key; main mints a single-use 15-minute STT token via the ElevenLabs `/v1/realtime/token` endpoint and ships only that token to the renderer over IPC
- `voice-tts` runs in main and uses the API key directly
- Outbound allowlist: hostnames matching `*.elevenlabs.io` and `api.elevenlabs.io` only (enforced at the wrapper boundary; verified by the Phase 09 success criterion)

### Testing strategy
- Vitest 2.1.8 (already in devDependencies) for unit tests
- Fixtures: a 5-second WAV at 16 kHz mono Int16 PCM checked into `packages/voice-stt/test/fixtures/` plus its verbatim ground-truth transcript
- STT test: drive the wrapper with the fixture, assert `committed` event payload matches ground truth verbatim (whitespace/punctuation tolerant)
- TTS test: drive `voice-tts` against a sequence-numbered fixture chunk stream, assert arrival order and no audible gap (verified via test for monotonic timestamp deltas, since true audio playback is in Phase 11)
- Outbound denylist test: stub fetch/WebSocket to verify any non-ElevenLabs host triggers a refusal

### Logging
- Lightweight: `console.error(...)` for unrecoverable errors with stable prefix `[voice-stt]` / `[voice-tts]`; no structured logger in the wrapper layer
- Never log the API key, audio buffers, or full transcripts. Permit logging the transcript length and the WebSocket state transitions

### Build pipeline
- TypeScript with `Node16`/`NodeNext` module resolution; `.js` import specifiers in source (matches repo convention)
- `tsc -b` for build; no bundler in the wrappers (downstream consumers bundle)
- Strict TypeScript on; no `any`

### Claude's Discretion
- Internal class vs functional/closure style for the wrappers — choose whatever reads cleaner; the public surface is the named exports from `src/index.ts`
- Exact event shape detail beyond what is required by the success criteria (Zod schemas in `voice-protocol` are the contract)
- File partitioning inside each package (single-file vs multi-file) — split when individual files exceed ~300 lines

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/protocol` — pattern for a shared protocol/types package with Zod schemas, multiple exports, `dist/` build output, public npm publish config. `@achilles/voice-protocol` should mirror this shape
- Top-level `package.json` workspaces glob (`packages/*`, `apps/*`) already picks up new packages without config change
- `tsconfig.base.json` is the shared TS base — extend it in each new package's `tsconfig.json`
- `vitest.workspace.ts` aggregates Vitest projects; add the new packages there for `npm test` discovery

### Established Patterns (from `.planning/codebase/CONVENTIONS.md`)
- Files: kebab-case (`voice-stt-client.ts`, not `VoiceSttClient.ts`)
- Functions: camelCase, verb-first (`startStream`, `commitUtterance`)
- Types: `interface` and string-literal unions over `enum`
- Exports: named only (no defaults except framework entrypoints — n/a here)
- Error handling: catch as `unknown`, convert to readable message, throw `new Error(...)` with explicit context for unrecoverable lifecycle states
- Import order: external/`node:` first, related `import type` near runtime imports, local imports last
- Module resolution: `Node16`/`NodeNext` with `.js` specifiers in TS source (per repo convention)
- Tests: colocate as `*.test.ts` beside source files

### Integration Points (downstream phases)
- Phase 10 (Claude Code Bridge) does not touch these packages
- Phase 11 (UI Shell) imports `@achilles/voice-protocol` for IPC type contracts; runs `@achilles/voice-stt` in the renderer; consumes audio chunks from `@achilles/voice-tts` over IPC
- Phase 12 (Integration) wires the orchestrator `apps/achilles/src/main/session.ts` against all three packages
- Phase 13 (Distribution) bundles these packages into the npm CLI tarball and the skill body

</code_context>

<specifics>
## Specific Ideas

- The wrapper packages must be testable in isolation against WAV fixtures and golden NDJSON — no Electron, no Claude Code, no live ElevenLabs network calls required in CI (use the official ElevenLabs SDK's built-in mock support or a thin stub layer)
- The single-use STT token mint endpoint is documented at ElevenLabs `/v1/realtime/token` (referenced from STACK.md and ARCHITECTURE.md research)
- Achilles uses ElevenLabs Scribe v2 Realtime for STT and Flash v2.5 for TTS — Turbo is deprecated and must not be used
- `chunk_length_schedule: [80, 120, 160, 220]` is the ElevenLabs-recommended schedule for low-latency TTS streaming and is the v1.2 default

</specifics>

<deferred>
## Deferred Ideas

- Voice picker UI — Phase 11 / v1.3 (VOICE-01)
- Custom voice cloning — v2+ (VOICE-02)
- Per-project voice profile — v2+ (VOICE-03)
- Local Whisper STT fallback — v2+ (PLAT-02)
- Multi-context WebSocket (multiple concurrent TTS streams) — not required for v1.2; can be added in v1.3 without API change

</deferred>
