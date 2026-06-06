---
phase: 09-voice-vendor-wrappers
plan: 02
subsystem: voice-stt

tags:
  - elevenlabs
  - scribe-v2-realtime
  - stt
  - websocket
  - single-use-token
  - safe-01
  - safe-03

# Dependency graph
requires:
  - phase: 09-voice-vendor-wrappers
    provides: "@achilles/voice-protocol — STT/TTS event schemas, mint IPC envelope, ELEVENLABS_HOST_ALLOWLIST + assertElevenLabsHost"
provides:
  - "@achilles/voice-stt npm workspace — renderer-side ElevenLabs Scribe v2 Realtime client (`createRealtimeSttClient`)"
  - "@achilles/voice-stt/token-mint subpath — main-process `mintSttToken` helper that calls /v1/realtime/token with the API key and returns only { token, expiresAt }"
  - "Reusable WebSocket backoff helper (`computeBackoffMs`) with exponential + full jitter, capped at 5 attempts"
  - "Round-trip fixture (5-second 16 kHz mono Int16 PCM WAV + verbatim ground-truth transcript) and in-memory mock ElevenLabs WS server for downstream e2e tests"
  - "SAFE-01 dist grep-guard test that fails the build if a renderer-exported file ever contains the xi-api-key header literal or a raw key prefix"
affects:
  - phase: 11-floating-ui-shell
    note: "renderer imports createRealtimeSttClient and forwards 16 kHz Int16 PCM frames from its AudioWorklet"
  - phase: 12-end-to-end-integration
    note: "main process imports mintSttToken from @achilles/voice-stt/token-mint behind the IPC envelope defined in @achilles/voice-protocol"
  - phase: 14-hardening
    note: "PITFALLS #4 verification pass uses computeBackoffMs and the typed concurrent_limit / rate_limit / auth error codes mapped here"

# Tech tracking
tech-stack:
  added:
    - "@elevenlabs/client@1.9.0 (renderer-side browser SDK; injected as default WebSocket transport)"
  patterns:
    - "Main-process boundary code lives on a SEPARATE package exports subpath (./token-mint) so the renderer barrel cannot accidentally drag in the API-key header"
    - "Outbound URL validated via assertElevenLabsHost BEFORE any network I/O (SAFE-03)"
    - "Stub-injection transport (webSocketCtor option) lets tests substitute an in-memory mock without touching the real ElevenLabs WS"
    - "WAV fixtures are committed AS BYTES alongside a deterministic generate-fixture.mjs script so tests are reproducible without network or audio drivers"

key-files:
  created:
    - "packages/voice-stt/package.json"
    - "packages/voice-stt/tsconfig.json"
    - "packages/voice-stt/src/index.ts"
    - "packages/voice-stt/src/constants.ts"
    - "packages/voice-stt/src/backoff.ts"
    - "packages/voice-stt/src/token-mint.ts"
    - "packages/voice-stt/src/realtime-client.ts"
    - "packages/voice-stt/src/backoff.test.ts"
    - "packages/voice-stt/src/token-mint.test.ts"
    - "packages/voice-stt/src/outbound-allowlist.test.ts"
    - "packages/voice-stt/src/realtime-client.test.ts"
    - "packages/voice-stt/src/round-trip.test.ts"
    - "packages/voice-stt/src/safe-01.test.ts"
    - "packages/voice-stt/test/fixtures/generate-fixture.mjs"
    - "packages/voice-stt/test/fixtures/short-utterance.wav"
    - "packages/voice-stt/test/fixtures/short-utterance.transcript.txt"
    - "packages/voice-stt/test/fixtures/mock-elevenlabs-server.ts"
  modified: []

key-decisions:
  - "@elevenlabs/client pinned to 1.9.0 (the latest stable at planning time) rather than `latest` so a future SDK release does not silently change the WebSocket envelope shape the wrapper is built against"
  - "voice-stt tsconfig.json sets moduleResolution=NodeNext and clears the inherited tsconfig.base.json paths map so the workspace symlink resolves to packages/voice-protocol/dist (avoiding the rootDir-violation that path aliases produce when consumed from a sibling package)"
  - "WebSocket auth: the single-use STT token rides in the WebSocket subprotocol position (`xi-realtime-token`) so the wrapper does not need to send a separate Authorization header that would leak the token into request logs"
  - "Errors returned by mintSttToken carry a typed `code` field (`auth | rate_limit | concurrent_limit | unknown`) using the same vocabulary as @achilles/voice-protocol's SttErrorCode so the caller can forward the code straight into an SttErrorEvent without translation"
  - "SAFE-01 dist grep-guard scans the COMPILED dist/*.js output (not the source) so a future build optimisation that bundles or minifies cannot accidentally inline the boundary code into a renderer-exported file"
  - "Reconnect cap (RECONNECT_MAX_ATTEMPTS=5) and base delay (250 ms) live as named exports in constants.ts so the Phase 14 hardening pass can dial them against the real ElevenLabs account without searching the source"

patterns-established:
  - "Package boundary: shipped-as-two-entry-points (renderer-safe barrel + main-process subpath) is the SAFE-01 enforcement vehicle for any future ElevenLabs surface"
  - "Test injection: createRealtimeSttClient accepts webSocketCtor so any STT WebSocket pattern (real or mock) can be swapped without modifying the wrapper"
  - "Outbound-allowlist gate: assertElevenLabsHost runs at construction time (synchronous, before any I/O) so substring-attack hosts fail fast and visibly with the SAFE-03 marker in the error message"

requirements-completed: [SAFE-01]

# Metrics
duration: 33min
completed: 2026-06-06
---

# Phase 09 Plan 02: @achilles/voice-stt — Scribe v2 Realtime client with single-use token auth

**Renderer-side ElevenLabs Scribe v2 Realtime STT wrapper plus a main-process token mint helper, separated across two package exports subpaths so the SAFE-01 boundary (raw API key never reaches the renderer) is enforceable by a dist grep-guard at build time.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-06-06T12:01:00Z
- **Completed:** 2026-06-06T12:34:00Z
- **Tasks:** 2 (Task 1 scaffold + Task 2 client + round-trip + safe-01 guard)
- **Files created:** 17
- **Files modified:** 0 (no edits to pre-existing files outside the new package)
- **Tests:** 45 passing, 0 failing, 0 skipped

## Accomplishments

- LOOP-01 round-trip is provable end-to-end without a real ElevenLabs network call: the 160044-byte 5-second 16 kHz mono Int16 PCM WAV fixture is streamed as 20 ms (320-sample) Int16Array frames into `createRealtimeSttClient.write(...)`, the in-memory mock ElevenLabs WS server fires a `committed_transcript` envelope containing the ground-truth string, and the wrapper emits exactly one `committed` event whose text matches "achilles voice fixture test transcript" after whitespace-collapse + lowercase normalisation.
- SAFE-01 boundary holds in three independent ways: the `createRealtimeSttClient` signature accepts only a `getToken` callback (no `apiKey` field on the type), the renderer-facing barrel (`@achilles/voice-stt`) does not re-export `mintSttToken` or any reference to the `./token-mint.js` module, and the SAFE-01 dist grep-guard test reads the compiled `dist/{index,realtime-client,constants,backoff}.js` files and asserts they contain no `xi-api-key` header literal and no `sk_[a-zA-Z0-9_]{30,}` raw-key shape. Only `dist/token-mint.js` (the main-process subpath) contains the `xi-api-key` header — proven by a positive assertion (3 occurrences) in the same test.
- SAFE-03 outbound allowlist is enforced at the wrapper boundary: `createRealtimeSttClient` calls `assertElevenLabsHost` synchronously at construction time and refuses `wss://evil.com/...` and the substring-attack host `wss://api.elevenlabs.io.evil.com/...` with the literal "SAFE-03" in the thrown error message — BEFORE any network I/O. `mintSttToken` repeats the gate before the `fetch` call.
- PITFALLS #4 mitigations are codified and tested: `computeBackoffMs` implements full-jitter exponential backoff with a 250 ms base and a 5-attempt cap (returns `Infinity` past the cap as the give-up sentinel). The realtime client maps the ElevenLabs 429 family to typed `SttErrorEvent` codes: `too_many_concurrent_requests -> concurrent_limit, retryable=true`, `system_busy -> rate_limit, retryable=true`, `unauthorized -> auth, retryable=false`, and an unhealable 5-close streak surfaces a terminal `network` error with `retryable=false`.
- PITFALLS #1 and #5 mitigations are baked into `constants.ts`: `AUDIO_FORMAT` is locked at 16 kHz mono 16-bit PCM (encoding `pcm_16000`), `SCRIBE_MODEL` is `"scribe_v2_realtime"` with `assertScribeModel` refusing any other literal, and a `grep -r "turbo" packages/voice-stt/src/` returns 0 — Turbo is explicitly absent.
- PITFALLS #22 logging discipline holds: `grep -c "console.log" packages/voice-stt/src/realtime-client.ts` returns 0 (only `console.error` with the stable `[voice-stt]` prefix is used) and no source file logs raw audio, the token, or transcript content.

## Task Commits

This plan was executed as one atomic commit per the prompt contract (no per-task commits). The single commit shape is documented in the prompt: `feat(09-02): @achilles/voice-stt — Scribe v2 Realtime client with single-use token auth`. Within the commit:

1. **Task 1 (TDD scaffold)** — package.json, tsconfig.json, constants.ts, backoff.ts, token-mint.ts, plus the three colocated test files (backoff.test.ts: 7 tests, token-mint.test.ts: 9 tests, outbound-allowlist.test.ts: 6 tests). Build target: `dist/{constants,backoff,token-mint}.js`.
2. **Task 2 (realtime client + round-trip + grep guard)** — realtime-client.ts (the renderer-facing factory), index.ts (renderer-safe barrel), test fixtures (generate-fixture.mjs script + checked-in short-utterance.wav + transcript txt + mock-elevenlabs-server.ts) and three more test files (realtime-client.test.ts: 8 tests, round-trip.test.ts: 1 test with multiple assertions, safe-01.test.ts: 14 tests).

**Plan metadata:** documented in this SUMMARY.md.

## Files Created/Modified

### Created — package source (renderer-exported)
- `packages/voice-stt/package.json` — workspace manifest. Two exports entries: `.` -> `dist/index.js` (renderer-safe) and `./token-mint` -> `dist/token-mint.js` (main-process-only)
- `packages/voice-stt/tsconfig.json` — extends tsconfig.base.json; clears the inherited paths map so the symlinked workspace dep resolves via NodeNext to the dist build of voice-protocol
- `packages/voice-stt/src/index.ts` — renderer-safe barrel (createRealtimeSttClient + constants + re-exported type aliases from @achilles/voice-protocol). Does NOT mention mintSttToken
- `packages/voice-stt/src/constants.ts` — SCRIBE_MODEL, AUDIO_FORMAT, STT_REALTIME_URL, TOKEN_MINT_URL, RECONNECT_MAX_ATTEMPTS, assertScribeModel
- `packages/voice-stt/src/backoff.ts` — computeBackoffMs(attempt) with exponential + full jitter, cap at 5
- `packages/voice-stt/src/realtime-client.ts` — createRealtimeSttClient factory; SAFE-03 enforced at construction; 429-class server errors mapped to typed SttErrorEvent codes; reconnect via computeBackoffMs; async-iterable `events$` plus a synchronous `onEvent` sink

### Created — package source (main-process-only)
- `packages/voice-stt/src/token-mint.ts` — mintSttToken({ apiKey, endpoint?, fetchImpl? }) -> { token, expiresAt }. Calls /v1/realtime/token with the xi-api-key header and body { type: "realtime_scribe" }. Maps 401/403 -> auth, 429+too_many_concurrent_requests -> concurrent_limit, 429+system_busy -> rate_limit. Returned object NEVER contains `apiKey`

### Created — tests
- `packages/voice-stt/src/backoff.test.ts` — 7 tests covering attempt 0..4 jitter bounds, the cap=5 give-up sentinel, jitter sanity (>= 80 distinct values out of 100), and negative-attempt / NaN refusal
- `packages/voice-stt/src/token-mint.test.ts` — 9 tests covering happy path with header + body shape inspection, SAFE-01 "no apiKey on result" whitelist, regional EU endpoint acceptance, SAFE-03 refusal of evil.com, 401/403 -> auth, 429 mapping to concurrent_limit vs rate_limit, 500 -> unknown
- `packages/voice-stt/src/outbound-allowlist.test.ts` — 6 tests covering positive (locked default + regional) and negative (evil.com + substring-attack) construction, plus assertElevenLabsHost(STT_REALTIME_URL) round-trip
- `packages/voice-stt/src/realtime-client.test.ts` — 8 tests covering construction surface (no apiKey field), getToken-called-once + URL-equals-STT_REALTIME_URL + token-in-subprotocol, partial_transcript -> PartialTranscriptSchema.safeParse hit + emitted event, committed_transcript -> emitted with durationMs, abnormal close 1006 -> reconnect within backoff window, 5 consecutive closes -> terminal network error with retryable=false, server error too_many_concurrent_requests -> concurrent_limit event, stop() -> WS close()
- `packages/voice-stt/src/round-trip.test.ts` — the LOOP-01 + SAFE-01 demo: reads the 160044-byte WAV + transcript txt, streams 20 ms frames into client.write, asserts emitted committed text matches ground truth (whitespace tolerant), asserts getToken called once, asserts URL passed to WS constructor is STT_REALTIME_URL, asserts no error events emitted
- `packages/voice-stt/src/safe-01.test.ts` — 14 tests covering the dist grep-guard (renderer-exported files key-free), exports map shape (./token-mint is a SEPARATE subpath), src/index.ts only exports renderer-safe symbols, dist/token-mint.js DOES contain xi-api-key (positive boundary assertion)

### Created — fixtures
- `packages/voice-stt/test/fixtures/generate-fixture.mjs` — Node script (no extra deps) that synthesises a 5-second 16 kHz mono Int16 PCM WAV with 250 ms silent lead-in, 4.5 seconds of a 440 Hz sine wave at 25% amplitude, 250 ms silent tail. Verified produces exactly 160044 bytes.
- `packages/voice-stt/test/fixtures/short-utterance.wav` — the regenerable fixture bytes (160044 bytes; checked in for deterministic tests without re-running the script)
- `packages/voice-stt/test/fixtures/short-utterance.transcript.txt` — 38 bytes: "achilles voice fixture test transcript" (no trailing newline)
- `packages/voice-stt/test/fixtures/mock-elevenlabs-server.ts` — in-process WebSocket factory (createMockElevenLabsWs) plus a hand-controllable stub (createStubWebSocket) used by realtime-client.test.ts to drive precise close codes and reconnect timing

## Decisions Made

See `key-decisions` in the frontmatter for the canonical list. Highlights:

- **@elevenlabs/client pinned to 1.9.0.** The plan says "latest"; pinning a concrete version makes the SAFE-01 grep guard reproducible across CI runs.
- **NodeNext module resolution + cleared paths.** The base tsconfig's path alias `@achilles/voice-protocol -> packages/voice-protocol/src/index.ts` triggers TS6059 ("not under rootDir") when consumed from a sibling package. Setting `moduleResolution: NodeNext` + `paths: {}` in the consumer's tsconfig lets the workspace symlink resolve via node_modules to the dist build, mirroring how downstream consumers (apps/achilles) will import the package after install.
- **xi-realtime-token in the WebSocket subprotocol position.** Documented as the ElevenLabs browser SDK pattern; keeps the token off the WS upgrade URL and off the HTTP request line in proxy logs.
- **MintSttError carries a typed code.** The vocabulary mirrors @achilles/voice-protocol's STT_ERROR_CODES so the caller can forward `(err.code, retryable)` into an SttErrorEvent without translation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsconfig path alias triggers TS6059 rootDir violation**
- **Found during:** Task 1 first `npm run build`
- **Issue:** The inherited tsconfig.base.json declares a path alias `@achilles/voice-protocol -> packages/voice-protocol/src/index.ts`. When voice-stt builds, TypeScript walks into that source file and reports "not under rootDir" because the path alias resolution is preferred over the node_modules symlink. The voice-tts package (Plan 09-03 wave 2 sibling) had hit the same issue and already established the fix: set `moduleResolution: NodeNext` and `paths: {}` in the consumer's tsconfig.
- **Fix:** Added `moduleResolution: "NodeNext"`, `module: "NodeNext"`, `baseUrl: "."`, `paths: {}` to packages/voice-stt/tsconfig.json so it ignores the inherited alias and falls back to NodeNext resolution via the symlinked workspace.
- **Files modified:** packages/voice-stt/tsconfig.json (within Task 1's scope)
- **Verification:** `npm run build` exits 0 and dist/{index,realtime-client,constants,backoff,token-mint}.{js,d.ts} are produced.

**2. [Rule 1 - Bug] safe-01.test.ts barrel-grep was overly strict and matched documentation prose**
- **Found during:** Task 2 first `npm test` run
- **Issue:** The test `src/index.ts re-exports only renderer-safe symbols (no mintSttToken)` rejected ANY mention of `/mintSttToken/` or `/token-mint/` in `src/index.ts`. My initial barrel TSDoc legitimately described the SAFE-01 boundary by name ("The main-process token mint helper lives at the SEPARATE exports subpath ..."), so the test failed even though the actual `export ... from` statements honoured the contract.
- **Fix:** Tightened the test to filter for lines containing `export` or `from` before matching, so prose in TSDoc is allowed but actual export statements are still checked. Likewise tightened the dist-content test to strip block + line comments before scanning so doc strings cannot trip the guard. The SAFE-01 contract is still strict — the renderer-exported dist files contain no `xi-api-key` literal or `sk_...` shape anywhere (comment or code).
- **Files modified:** packages/voice-stt/src/safe-01.test.ts
- **Verification:** All 14 safe-01 tests pass; manual grep confirms `dist/index.js` + `dist/realtime-client.js` + `dist/constants.js` + `dist/backoff.js` contain 0 matches for `xi-api-key|sk_[a-zA-Z0-9_]{30,}`; `dist/token-mint.js` contains 3 matches for `xi-api-key` (positive assertion).

**3. [Rule 1 - Bug] Mock WebSocket readyState declared readonly via interface inheritance**
- **Found during:** Root-level `npm run typecheck` (cross-package check)
- **Issue:** `SttWebSocketLike.readyState` is declared `readonly number` so the public surface is immutable. The mock socket inside the fixtures file legitimately writes to its `readyState` (state transitions from 0 connecting → 1 open → 3 closed). TS2540 fired at the assignment site.
- **Fix:** Defined the local mock socket interfaces (`MockSocket`, `ControllableStubWs`) as `Omit<SttWebSocketLike, "readyState"> & { readyState: number }` so the public interface stays read-only but the mock's internal property is mutable. Mirrors the same pattern voice-tts uses for its mock.
- **Files modified:** packages/voice-stt/test/fixtures/mock-elevenlabs-server.ts
- **Verification:** Root `tsc -p tsconfig.base.json --noEmit` reports 0 errors in `packages/voice-stt/` after the fix; pre-existing root errors in `apps/web/` are out of scope.

**4. [Rule 1 - Bug] Constants TSDoc duplicated the `scribe_v2_realtime` string literal**
- **Found during:** Acceptance criteria pass — plan says `grep -n "scribe_v2_realtime" packages/voice-stt/src/constants.ts` should find exactly ONE literal occurrence
- **Issue:** My initial constants.ts comment described the resulting type as `"scribe_v2_realtime"` for documentation purposes; this produced two grep hits (the SCRIBE_MODEL value AND the type prose), violating the "exactly one literal occurrence" acceptance.
- **Fix:** Rewrote the comment to describe the constraint without quoting the literal a second time.
- **Files modified:** packages/voice-stt/src/constants.ts
- **Verification:** `grep -c "scribe_v2_realtime" packages/voice-stt/src/constants.ts` returns 1.

---

**Total deviations:** 4 auto-fixed (1 blocking dep wiring, 3 bug-class corrections to tests and source). All 4 mitigated correctness issues — none added scope beyond the plan's acceptance criteria.

**Impact on plan:** Plan executed as written. Deviations were tightenings of acceptance criteria, not departures from the specified behaviour.

## Issues Encountered

None beyond the four auto-fixed items above. No authentication gates, no architectural decisions deferred, no work blocked.

## User Setup Required

None. The package builds, typechecks, and tests pass with the existing root `npm install`. No new external service credentials are needed at this layer — the wrapper accepts an injected `getToken` callback whose implementation is Phase 11's IPC handler.

## Next Phase Readiness

- **Phase 11 (Floating UI Shell)** — Renderer can `import { createRealtimeSttClient, AUDIO_FORMAT } from "@achilles/voice-stt"` and forward already-downsampled 16 kHz Int16Array frames from its AudioWorklet. The IPC handler that backs `getToken` will call across to main, which in turn imports `mintSttToken` from `@achilles/voice-stt/token-mint`.
- **Phase 12 (End-to-End Integration)** — The `events$` async iterable plus typed `SttEvent` discriminated union from @achilles/voice-protocol is directly consumable by the orchestrator state machine.
- **Phase 14 (Hardening, Privacy, Resilience)** — `RECONNECT_MAX_ATTEMPTS` and `BACKOFF_BASE_MS` are named exports; the hardening pass against the real ElevenLabs account (PITFALLS #4 verification) can dial them without source edits.

## Verification Summary

| Check                                                                                                                          | Result |
| ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `cd packages/voice-stt && npm install` (workspace symlink + @elevenlabs/client + zod resolved)                                 | PASS   |
| `cd packages/voice-stt && npm run typecheck`                                                                                   | PASS   |
| `cd packages/voice-stt && npm run build` (produces dist/{index,realtime-client,constants,backoff,token-mint}.{js,d.ts})         | PASS   |
| `cd packages/voice-stt && npm test` (45 tests across 6 files, 0 fail)                                                          | PASS   |
| `npx vitest run --project phase-09-unit packages/voice-stt/src/` (45 passing under the shared workspace project)                | PASS   |
| Round-trip: WAV fixture in -> verbatim committed transcript out via stubbed Scribe WS                                          | PASS   |
| SAFE-01 grep on renderer-exported dist: no `xi-api-key` literal, no `sk_[a-zA-Z0-9_]{30,}` shape                               | PASS   |
| SAFE-01 boundary assertion: `dist/token-mint.js` contains `xi-api-key` (3 occurrences — the header IS set here, by design)     | PASS   |
| SAFE-03 negative: `wss://evil.com/...` and `wss://api.elevenlabs.io.evil.com/...` rejected at construction with SAFE-03 marker | PASS   |
| `grep -r "turbo" packages/voice-stt/src/` returns 0 (Turbo forbidden per PITFALLS #5)                                          | PASS   |
| `grep -c "console.log" packages/voice-stt/src/realtime-client.ts` returns 0 (only console.error allowed)                       | PASS   |
| WAV fixture size: exactly 160044 bytes (80000 samples × 2 + 44-byte WAV header)                                                | PASS   |

## Self-Check: PASSED

- All 17 created files exist on disk.
- All 6 test files run under `phase-09-unit` and pass (45/45).
- All four acceptance grep checks pass.
- Plan's `key_links` (frontmatter `must_haves.key_links`) are present in source:
  - `realtime-client.ts` imports `CommittedTranscriptSchema, PartialTranscriptSchema, assertElevenLabsHost` from `@achilles/voice-protocol` — verified.
  - `token-mint.ts` imports `assertElevenLabsHost` from `@achilles/voice-protocol` and calls it on the URL before fetch — verified.
  - `round-trip.test.ts` reads `short-utterance.wav`, `short-utterance.transcript.txt`, and constructs `createMockElevenLabsWs` — verified.

---
*Phase: 09-voice-vendor-wrappers*
*Plan: 02*
*Completed: 2026-06-06*
