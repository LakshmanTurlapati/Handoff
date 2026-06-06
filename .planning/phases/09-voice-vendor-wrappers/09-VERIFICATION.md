---
phase: 09
phase_name: voice-vendor-wrappers
status: human_needed
verified_at: 2026-06-06
verified_by: gsd-verifier
score: 5/5 must-haves verified by code; 1 needs human audio playback confirmation
overrides_applied: 0
---

# Phase 09 Verification

## Goal Achievement Summary

The phase delivers three packages: `@achilles/voice-protocol` (shared Zod schemas + IPC envelope + outbound allowlist matcher), `@achilles/voice-stt` (renderer-facing Scribe v2 Realtime client + main-process token mint helper on a separate exports subpath), and `@achilles/voice-tts` (main-process Flash v2.5 stream-input client + SequenceBuffer). All 143 phase-09-unit tests pass; all three packages typecheck-clean; build outputs are present; the SAFE-01 grep guard against renderer-exported dist files comes back clean; the SAFE-03 outbound allowlist refuses both bare evil hosts and substring-attack hosts at construction time; the round-trip WAV fixture emits a verbatim committed transcript; and the 60-chunk scrambled-arrival ordering test drains 0..59 monotonically with `hasGap() === false`. The phase goal is functionally achieved at the wrapper layer; the only must-have that cannot be confirmed by static evidence is MH-04's "no audible gaps via renderer's AudioContext" — that side of the criterion belongs to Phase 11 (renderer) and needs a human audio playback check in the v1.2 hardening pass.

## Must-Have Verification

### MH-01: WAV fixture round-trips to verbatim committed transcript

- **Status:** passed
- **Evidence:**
  - `packages/voice-stt/test/fixtures/short-utterance.wav` is exactly 160044 bytes (5 s × 16 kHz × Int16 + 44-byte WAV header) — confirmed via `stat -f "%z"`.
  - `packages/voice-stt/test/fixtures/short-utterance.transcript.txt` contains the ground-truth string `achilles voice fixture test transcript` (38 bytes, no trailing newline) — confirmed by `cat`.
  - `packages/voice-stt/src/round-trip.test.ts:88-101` streams the WAV's PCM body as 20 ms (320-sample) Int16Array frames, fires `mock.flushCommit()`, and asserts that the emitted `committed` event's text matches the transcript under `normalise(s) = s.replace(/\s+/g, " ").trim().toLowerCase()`.
  - Test command: `npm test --workspace @achilles/voice-stt` -> `round-trip.test.ts (1 test) 5ms`; all 45/45 tests pass.
  - The mock at `packages/voice-stt/test/fixtures/mock-elevenlabs-server.ts:142-164` deterministically returns the ground-truth transcript on `committed_transcript`, and `realtime-client.ts:363-379` Zod-validates the inbound payload via `CommittedTranscriptSchema.safeParse` before emitting.

### MH-02: API key read only in main; renderer bundle and logs key-free

- **Status:** passed
- **Evidence:**
  - `packages/voice-stt/src/index.ts` (the renderer-facing barrel) exports only `createRealtimeSttClient`, `AUDIO_FORMAT`, `RECONNECT_MAX_ATTEMPTS`, `SCRIBE_MODEL`, `STT_REALTIME_URL`, `assertScribeModel`, and re-exported types — no `mintSttToken`, no `apiKey` surface. Verified by `grep -E "^export" packages/voice-stt/src/index.ts`.
  - `packages/voice-stt/package.json` exposes `mintSttToken` only at the separate exports subpath `"./token-mint": "./dist/token-mint.js"`; the default barrel `"."` resolves to the renderer-safe `dist/index.js`.
  - Renderer-exported dist grep guard: `grep "xi-api-key" packages/voice-stt/dist/{index,realtime-client,constants,backoff}.js` returns ZERO matches. `grep -E "sk_[a-zA-Z0-9_]{30,}" packages/voice-stt/dist/{index,realtime-client,constants,backoff}.js` returns ZERO matches.
  - Boundary assertion: `grep -c "xi-api-key" packages/voice-stt/dist/token-mint.js` returns 3 — the header IS set in the main-process-only file, by design.
  - SAFE-01 IPC strict-mode enforcement (verified at runtime): `node -e "MintSttTokenRequestSchema.parse({ type: 'mint-stt-token', model: 'scribe_v2_realtime', apiKey: 'sk_abc' })"` throws — Zod strict mode rejects the piggybacked `apiKey` field. See `packages/voice-protocol/src/ipc.ts:68-75`.
  - Response token defence in depth: `MintSttTokenResponseSchema.token.refine(...)` refuses any token value that starts with `sk_` and is >= 32 chars — verified at runtime via the same node check. See `packages/voice-protocol/src/ipc.ts:91-109`.
  - `packages/voice-tts/src/key-source.ts` — non-comment lines contain zero `process.env` references (`grep -v '^\s*\*' | grep -c "process.env"` returns 0); the package reads no env vars and opens no keystore. Authentication is via the consumer-injected `KeySource = () => Promise<string>` callback.
  - Logging discipline: `grep -c "console.log" packages/voice-stt/src/realtime-client.ts` returns 0; `grep -c "console.log" packages/voice-tts/src/stream-client.ts` returns 0. All wrapper logging is `console.error` with a `[voice-stt]` / `[voice-tts]` prefix; no audio bytes, no tokens, no full transcripts in logs.
  - `safe-01.test.ts` runs 14 assertions over the dist output and exports map; all pass under `npm test --workspace @achilles/voice-stt`.
  - **Out-of-scope note:** ROADMAP success criterion 2 also mentions "OS keystore (Keychain / DPAPI / libsecret) only in the main process". The keystore-wiring belongs to Phase 11 (Electron main); this phase delivers the consumer-injected `KeySource` callback contract that Phase 11 will fulfil with `safeStorage`. The package's stance — never reading env vars or opening keystores itself — is the wrapper-side half of that contract.

### MH-03: Renderer auths with single-use token; raw key never crosses IPC

- **Status:** passed
- **Evidence:**
  - `createRealtimeSttClient` signature at `packages/voice-stt/src/realtime-client.ts:115-120` accepts ONLY `getToken: () => Promise<{ token; expiresAt }>` — no `apiKey` field exists on `CreateRealtimeSttClientOptions`. A TypeScript caller cannot pass a key here; a JS caller would have the unused field silently dropped.
  - `realtime-client.ts:286` constructs the WebSocket with `webSocketCtor(url, ["xi-realtime-token", token])` — the single-use token rides in the WebSocket subprotocol position. The raw API key is never present in this module.
  - Token mint flow: `packages/voice-stt/src/token-mint.ts:106-113` is the ONLY place that touches the raw key (`"xi-api-key": opts.apiKey`). The function is shipped at the SEPARATE exports subpath `@achilles/voice-stt/token-mint` and is NOT re-exported by the renderer barrel.
  - `mintSttToken`'s resolved object explicitly contains only `{ token, expiresAt }` — no `apiKey` field — and that contract is asserted by `token-mint.test.ts` (9 tests pass).
  - IPC envelope schema enforces the boundary at runtime: `MintSttTokenRequestSchema` is `.strict()` and refuses any extra field (including `apiKey`, `xi_api_key`, `key`); `MintSttTokenResponseSchema.token` refuses any value matching the raw-key shape. See `packages/voice-protocol/src/ipc.ts:38-122`.
  - Round-trip test asserts `getToken` is called exactly once during `start()` and the `lastUrl` recorded by the mock is `STT_REALTIME_URL` — see `round-trip.test.ts:88-89`.

### MH-04: 30-second narration emitted in arrival order via sequence-numbered fixture

- **Status:** passed (wrapper-side sequencing); needs human (audible-gap check via real AudioContext is Phase 11 scope)
- **Evidence (wrapper-side, fully verified):**
  - `packages/voice-tts/test/fixtures/sequenced-chunks.json` — 60 chunks, `totalChunks: 60`, `durationMs: 30000`, each chunk with `durationMs: 500` summing to 30000 ms (`node -e` parse confirmed the parameters).
  - `packages/voice-tts/src/ordering-fixture.test.ts:103` permutes the arrival order with a deterministic LCG-driven Fisher-Yates shuffle (seed 42), asserts the permutation is non-identity, pipes chunk events through `SequenceBuffer`, and asserts:
    - all 60 sequences emitted exactly once (`emittedSequences.length === 60`, `sortedEmitted === [0..59]`);
    - strictly monotonic emission order (`emittedSequences === [0..59]`);
    - `buf.hasGap() === false` at stream end;
    - `buf.nextExpected() === 60`;
    - the `stream_complete.totalChunks === 60`.
  - Initial WS frame carries the locked `chunk_length_schedule = [80, 120, 160, 220]` via `CHUNK_LENGTH_SCHEDULE` from `constants.ts`. `grep -E "CHUNK_LENGTH_SCHEDULE" packages/voice-tts/src/stream-client.ts` finds the constant referenced 4 times in the wrapper.
  - `FLASH_MODEL = "eleven_flash_v2_5"` appears exactly once in `constants.ts` (grep-guard contract). `assertFlashModel("eleven_turbo_v2_5")` throws an Error whose message includes the deprecated id and `PITFALLS #5` — verified in `constants.test.ts` (7 tests pass).
  - PRE_BUFFER_MS = 500 (PITFALLS #6 prebuffer) is named-exported from `constants.ts:71`.
- **Needs human:**
  - The ROADMAP success criterion includes "...plays a 30-second narration via renderer's `AudioContext` with no audible gaps...". The actual audio playback via `AudioContext` is the renderer's responsibility and lives in Phase 11 (Floating UI Shell). This phase delivers the wrapper-side ordering guarantee — proven against a sequence-numbered fixture — but a human listening test against a real ElevenLabs Flash v2.5 stream is the appropriate gate for the "no audible gaps" half. The 500 ms `PRE_BUFFER_MS` constant is the contract Phase 11 must honour.

### MH-05: Outbound traffic restricted to ElevenLabs hostnames; denylist refuses other hosts

- **Status:** passed
- **Evidence:**
  - Single source of truth: `packages/voice-protocol/src/transport.ts:36-110` exports `ELEVENLABS_HOST_ALLOWLIST` (api.elevenlabs.io + 3 regional siblings), `isElevenLabsHost(host)`, and `assertElevenLabsHost(url)` that throws `Error(\`Outbound host '${host}' is not in the ElevenLabs allowlist (SAFE-03)\`)` for any host outside the allowlist.
  - Substring-attack defence: matcher splits on dots and verifies the trailing two labels are exactly `elevenlabs` and `io`, so `api.elevenlabs.io.evil.com` is correctly refused (verified at runtime: `node -e "assertElevenLabsHost('https://api.elevenlabs.io.evil.com/...')"` throws with the SAFE-03 marker in the message).
  - STT call site: `packages/voice-stt/src/realtime-client.ts:199` calls `assertElevenLabsHost(url)` at construction, BEFORE any I/O. The renderer-facing `outbound-allowlist.test.ts` (6 tests) covers both positive (locked default URL + regional) and negative (evil.com + substring attack) — all pass.
  - STT mint call site: `packages/voice-stt/src/token-mint.ts:97` calls `assertElevenLabsHost(endpoint)` before the `fetch()`. `token-mint.test.ts` (9 tests) covers the SAFE-03 refusal path for `https://evil.com/token` with the SAFE-03 marker.
  - TTS call site: `packages/voice-tts/src/stream-client.ts:170-171` calls `assertElevenLabsHost(opts.url ?? buildTtsStreamUrl(...))` at construction. `packages/voice-tts/src/outbound-allowlist.test.ts` (7 tests) covers `evil.com`, the substring-attack host `api.elevenlabs.io.evil.com`, and cross-package consistency (`buildTtsStreamUrl` output for several voice ids all pass `assertElevenLabsHost`).
  - Cross-package consistency: both voice-stt and voice-tts import `assertElevenLabsHost` from `@achilles/voice-protocol` — `grep -r "assertElevenLabsHost" packages/voice-{stt,tts}/src/` shows the same matcher used by both wrappers. No parallel implementation exists.

## Requirement Coverage

| REQ | Plan(s) | Status | Evidence |
|-----|---------|--------|----------|
| LOOP-01 | 09-01 (declared); exercised by 09-02 | passed | Audio format locked to 16 kHz mono Int16 PCM at `packages/voice-stt/src/constants.ts:39-44` (encoding `pcm_16000`); STT events (PartialTranscript, CommittedTranscript) schema-validated in `@achilles/voice-protocol`; round-trip WAV fixture (160044 bytes) emits verbatim committed transcript via the wrapper; renderer uses single-use token in WebSocket subprotocol position. Note: The renderer-side `getUserMedia` + AudioWorklet downsampling are Phase 11 scope (the renderer doesn't yet exist); the WRAPPER side of LOOP-01 — schema + token-auth + Scribe v2 Realtime URL + outbound allowlist — is delivered and tested. Wrapper-side of LOOP-01 is verifiable against fixtures; renderer-side is intentionally deferred to Phase 11. |
| SAFE-01 | 09-02 (declared) | passed | API key NEVER appears in renderer barrel exports (verified by inspection + `safe-01.test.ts` 14 tests + dist grep guard). `xi-api-key` header literal absent from all renderer-exported dist files (`grep` confirmed). IPC envelope schemas refuse `apiKey` field via `.strict()` + raw-key shape refusal via `.refine()`. Renderer authentication uses single-use token only. Out-of-scope: actual OS keystore reads (Keychain / DPAPI / libsecret) live in Phase 11 Electron main; this phase ships the `KeySource` callback contract that Phase 11 wires `safeStorage` into. |
| SAFE-03 | 09-03 (declared); also exercised by 09-02 | passed | Single allowlist matcher `assertElevenLabsHost` in `@achilles/voice-protocol/transport.ts`; called BEFORE any I/O at every outbound site (`token-mint.ts`, `realtime-client.ts`, `stream-client.ts`); substring-attack hostname `api.elevenlabs.io.evil.com` correctly refused (label-boundary parsing); 13+ tests across the three packages cover positive and negative cases. The `claude` local child (also named by SAFE-03) is Phase 10 scope. |

## Tests Run

| Command | Result |
| --- | --- |
| `npm test --workspace @achilles/voice-protocol` | 57/57 passed (4 files) |
| `npm test --workspace @achilles/voice-stt` | 45/45 passed (6 files) |
| `npm test --workspace @achilles/voice-tts` | 41/41 passed (7 files) |
| `npx vitest run --project phase-09-unit` | 143/143 passed (17 files) |
| `npm run typecheck --workspace @achilles/voice-protocol` | exit 0 |
| `npm run typecheck --workspace @achilles/voice-stt` | exit 0 |
| `npm run typecheck --workspace @achilles/voice-tts` | exit 0 |
| `node -e MintSttTokenRequestSchema.parse({apiKey: 'sk_'})` | THROWS (SAFE-01 strict mode rejects) |
| `node -e assertElevenLabsHost('https://api.elevenlabs.io.evil.com/...')` | THROWS with SAFE-03 marker |
| `node -e MintSttTokenResponseSchema.parse({token: 'sk_'+35*'a'})` | THROWS (raw-key shape refused) |
| `grep -c xi-api-key dist/{index,realtime-client,constants,backoff}.js` | 0 (clean) |
| `grep -c xi-api-key dist/token-mint.js` | 3 (intentional positive boundary) |
| `grep -c console.log src/realtime-client.ts` | 0 (only console.error) |
| `grep -c console.log src/stream-client.ts` | 0 (only console.error) |

## Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| `packages/voice-stt/src/realtime-client.ts` | `@achilles/voice-protocol` | `import { CommittedTranscriptSchema, PartialTranscriptSchema, SttErrorEventSchema, assertElevenLabsHost }` (line 38-44) | WIRED — used in `handleServerMessage` for Zod validation and at construction line 199 for SAFE-03 |
| `packages/voice-stt/src/token-mint.ts` | `@achilles/voice-protocol` | `import { assertElevenLabsHost }` (line 23) | WIRED — called at line 97 BEFORE fetch |
| `packages/voice-tts/src/stream-client.ts` | `@achilles/voice-protocol` | `import { assertElevenLabsHost, TtsChunkSchema, TtsStreamCompleteSchema }` (line 33-40) | WIRED — assertElevenLabsHost at line 171; TtsChunkSchema.safeParse at line 318; TtsStreamCompleteSchema.safeParse at line 336 |
| `packages/voice-tts/src/stream-client.ts` | `packages/voice-tts/src/key-source.ts` | `import { callKeySource, type KeySource }` (line 50) | WIRED — awaited at `ensureOpen()` line 386 |
| `packages/voice-stt/src/round-trip.test.ts` | `packages/voice-stt/test/fixtures/` | fs.readFileSync of WAV + transcript + mock factory (lines 30-34) | WIRED — drives the LOOP-01 round-trip end-to-end |
| `packages/voice-tts/src/ordering-fixture.test.ts` | `packages/voice-tts/test/fixtures/sequenced-chunks.json` | fs.readFileSync + scrambled replay (lines 62-63, 103-117) | WIRED — drives the 30-second monotonic-emit assertion |

## Data-Flow Trace

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `realtime-client.ts` | inbound `partial_transcript` / `committed_transcript` | WebSocket `message` handler -> JSON.parse -> Zod `safeParse` -> `emit()` to events$ AsyncIterable | YES — round-trip test proves verbatim ground-truth transcript flows out | FLOWING |
| `stream-client.ts` | inbound `chunk` / `stream_complete` | WS `onmessage` -> JSON.parse -> Zod `TtsChunkSchema.safeParse` -> `emit()` to events$ | YES — ordering-fixture test confirms 60 chunks emitted in monotonic 0..59 | FLOWING |
| `token-mint.ts` | response `token` / `expires_at` | `fetch(endpoint)` -> `response.json()` -> shape check -> return `{ token, expiresAt }` | YES — token-mint.test.ts covers happy path + error mappings | FLOWING |
| `SequenceBuffer` | buffered items | `push()` accepts items; `drain()` emits in monotonic order; `onEmit` callback fires per item | YES — sequence-buffer.test.ts (7 tests) verifies reorder semantics | FLOWING |

## Anti-Patterns Scanned

| File | Pattern | Severity | Disposition |
| --- | --- | --- | --- |
| `packages/voice-stt/src/realtime-client.ts` | `console.log` | none | 0 matches |
| `packages/voice-tts/src/stream-client.ts` | `console.log` | none | 0 matches |
| `packages/voice-stt/src/` | `turbo` (deprecated model) | none | 0 matches |
| `packages/voice-tts/src/` | `eleven_turbo_v2_5` | INFO | 3 references — all in the deprecation guard (`assertFlashModel`) or in tests asserting the guard. Intentional. |
| `packages/voice-tts/src/key-source.ts` (non-comment) | `process.env` | none | 0 matches after stripping TSDoc; the 1 grep hit was in a TSDoc block explaining "we do NOT read process.env". |
| `packages/voice-stt/src/index.ts` (export lines) | `mintSttToken` reference | none | 0 matches in export-line filter; only mentioned in TSDoc explaining the SAFE-01 boundary. |
| `packages/voice-tts/dist/constants.js` | `eleven_flash_v2_5` count | INFO | 1 (matches the grep-guard contract) |
| `packages/voice-stt/dist/{index,realtime-client,constants,backoff}.js` | `xi-api-key` | none | 0 matches (renderer-safe) |
| `packages/voice-stt/dist/token-mint.js` | `xi-api-key` | INFO | 3 matches — header IS set here by design; boundary positive assertion. |

No TODO / FIXME / XXX debt markers found in the phase's source files.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| voice-protocol module is requireable from Node | `node -e "require('./packages/voice-protocol/dist/ipc.js')"` | succeeds | PASS |
| MintSttTokenRequestSchema refuses apiKey field | `node -e "MintSttTokenRequestSchema.parse({type:'mint-stt-token',model:'scribe_v2_realtime',apiKey:'sk_abc'})"` | throws | PASS |
| MintSttTokenResponseSchema refuses raw-key shape | `node -e "MintSttTokenResponseSchema.parse({type:'mint-stt-token-response',token:'sk_'+35*'a',expiresAt:'2026-06-06T11:15:00Z'})"` | throws | PASS |
| assertElevenLabsHost refuses substring attack | `node -e "assertElevenLabsHost('https://api.elevenlabs.io.evil.com/...')"` | throws with SAFE-03 marker | PASS |
| assertElevenLabsHost accepts locked default | `node -e "assertElevenLabsHost('wss://api.elevenlabs.io/v1/speech-to-text/realtime')"` | returns URL string | PASS |
| Build outputs present | `ls packages/voice-{protocol,stt,tts}/dist/index.js` | all three exist | PASS |
| WAV fixture size matches plan | `stat -f "%z" .../short-utterance.wav` | 160044 bytes | PASS |
| sequenced-chunks fixture parameters | `node -e "console.log(json.totalChunks, json.durationMs)"` | 60, 30000 | PASS |

## Human Verification Required

### 1. Audio playback quality (MH-04 second half — Phase 11 / hardening pass concern)

- **Test:** Wire `createTtsStreamClient` against a real ElevenLabs Flash v2.5 stream with a 30-second narration script, route chunks through `SequenceBuffer`, decode each chunk through the renderer's `AudioContext`, and listen to the output.
- **Expected:** Audio plays continuously for ~30 seconds with no audible gaps, no out-of-order audio, no glitches across the 60 chunk boundaries. The 500 ms `PRE_BUFFER_MS` is honoured before playback starts.
- **Why human:** The ROADMAP criterion explicitly says "with no audible gaps" — that is a perceptual property that no static check or unit test can confirm. The wrapper-side ordering guarantee is verified by code; the audible quality of the playback is a renderer-side perceptual gate that requires Phase 11's `AudioContext` wiring and a human ear. This is appropriately deferred to Phase 11 and the Phase 14 hardening pass per the in-repo deferred-items workflow.

### 2. End-to-end SAFE-01 confirmation against real Electron build (deferred to Phase 11)

- **Test:** Build the Electron production bundle for Phase 11, then grep the produced renderer bundle for the ElevenLabs API key prefix (`sk_`) and the `xi-api-key` header literal. Inspect any Electron crash dump or log file for the same patterns.
- **Expected:** Zero matches in the renderer bundle and zero matches in any log surface.
- **Why human / why deferred:** The renderer bundle does not yet exist (Phase 11 has not run). The wrapper-side guard is delivered: `safe-01.test.ts` runs 14 grep assertions against the WRAPPER's dist files and they all pass. The end-to-end production-bundle grep is the natural Phase 11 / Phase 14 gate.

## Findings

- **Auto-fix deviations summary (all within scope):**
  - All three packages added `moduleResolution: NodeNext`, `paths: {}` to their local `tsconfig.json` to work around the inherited `tsconfig.base.json` path alias triggering TS6059 ("not under rootDir") when the consumer is a sibling package. This is a build-only change that does not affect runtime behaviour.
  - `safe-01.test.ts` was tightened to strip comments before grep-scanning the dist output and to filter export lines vs prose in `src/index.ts`. The SAFE-01 contract (renderer-exported files contain no `xi-api-key` or raw-key shapes) is still strictly enforced.
  - voice-tts `constants.ts` was restructured so the literal `eleven_flash_v2_5` appears exactly once (URL template uses `${FLASH_MODEL}` interpolation; deprecation error names the rejected id via a string-join so the grep-guard on the locked constant stays clean).
  - voice-tts `SequenceBuffer.hasGap()` was corrected to detect holes in the buffered prefix (not just the head); the test contract `buffered={0, 2} -> hasGap() === true` is honoured.
  - voice-tts `close()` now awaits any in-flight `openPromise` before tearing down the WS to fix a race observed in the close-cleanup test.

- **Out-of-scope pre-existing issues (already in `deferred-items.md`):**
  - Root `npm run typecheck` surfaces TS17004 / TS2352 errors in `apps/web/*` and `tests/auth-pairing.spec.ts`, plus TS2353 on `vitest.workspace.ts` `passWithNoTests`. None are introduced by Phase 09; all three Phase 09 packages typecheck-clean individually. Recommend a future hygiene phase per `deferred-items.md`.

- **Scope handoffs to later phases:**
  - Phase 11 (Floating UI Shell): wires `getUserMedia` + AudioWorklet downsampling for STT, wires `AudioContext` decode + playback for TTS, and wires Electron `safeStorage` as the `KeySource` callback for voice-tts and as the source of the API key passed to `mintSttToken`. The wrapper-side contracts are all in place.
  - Phase 14 (Hardening): the audible-gap perceptual check and the production-bundle SAFE-01 grep are appropriately deferred to the hardening pass.

- **Cross-package consistency:** Both voice-stt and voice-tts import `assertElevenLabsHost` from the SAME source-of-truth in `@achilles/voice-protocol`. No parallel allowlist implementation exists, confirming SAFE-03 is enforced by one matcher across the phase.

## Verdict

`human_needed` — All five must-haves are satisfied to the extent code can verify them; all 143 unit tests pass; all three packages typecheck-clean; the SAFE-01 grep guard against renderer-exported dist files is clean; the SAFE-03 outbound allowlist correctly refuses substring-attack hosts. The remaining gate is a human perceptual check of the audible-gap claim in MH-04, which is appropriately deferred to Phase 11 (renderer wiring of `AudioContext`) and Phase 14 (hardening). No code blockers prevent advancing to the next wave; the deferred items are documented in this report and tracked in `.planning/phases/09-voice-vendor-wrappers/deferred-items.md` as needed.
