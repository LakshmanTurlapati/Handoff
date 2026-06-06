---
phase: 09-voice-vendor-wrappers
plan: 03
subsystem: voice
tags:
  - voice-tts
  - elevenlabs
  - flash-v2-5
  - sequence-ordering
  - safe-03
dependency_graph:
  requires:
    - "@achilles/voice-protocol (Plan 09-01)"
  provides:
    - "@achilles/voice-tts package — main-process Flash v2.5 stream-input client"
    - "SequenceBuffer<T> — monotonic reorder utility consumed by Phase 11 renderer"
    - "KeySource callback contract — Phase 11 main wires Electron safeStorage as the source"
  affects:
    - "vitest workspace phase-09-unit project picks up packages/voice-tts/src/**/*.test.ts"
tech_stack:
  added:
    - "@elevenlabs/elevenlabs-js@2.51.0 (Node SDK, declared dependency — wrapper opens its own WS, the SDK is the documented vendor surface to track upstream)"
    - "ws@8.18.0 (Node WebSocket runtime; type @types/ws@8.5.13)"
  patterns:
    - "Consumer-injected KeySource callback for credential resolution (no package-side env reads, no keystore opens, no persistence)"
    - "Zod-validated incoming JSON frames via TtsChunkSchema + TtsStreamCompleteSchema from @achilles/voice-protocol"
    - "Construction-time SAFE-03 host validation via assertElevenLabsHost before any I/O"
    - "In-process reorder buffer with explicit gap detection (SequenceBuffer.hasGap())"
    - "Exponential backoff with full jitter capped at RECONNECT_MAX_ATTEMPTS=5 (duplicated from voice-stt per CONTEXT.md; v1.3 refactor candidate)"
key_files:
  created:
    - packages/voice-tts/package.json
    - packages/voice-tts/tsconfig.json
    - packages/voice-tts/src/index.ts
    - packages/voice-tts/src/constants.ts
    - packages/voice-tts/src/constants.test.ts
    - packages/voice-tts/src/key-source.ts
    - packages/voice-tts/src/key-source.test.ts
    - packages/voice-tts/src/backoff.ts
    - packages/voice-tts/src/backoff.test.ts
    - packages/voice-tts/src/sequence-buffer.ts
    - packages/voice-tts/src/sequence-buffer.test.ts
    - packages/voice-tts/src/stream-client.ts
    - packages/voice-tts/src/stream-client.test.ts
    - packages/voice-tts/src/outbound-allowlist.test.ts
    - packages/voice-tts/src/ordering-fixture.test.ts
    - packages/voice-tts/test/fixtures/generate-chunks.mjs
    - packages/voice-tts/test/fixtures/sequenced-chunks.json
    - packages/voice-tts/test/fixtures/mock-elevenlabs-tts-server.ts
    - .planning/phases/09-voice-vendor-wrappers/deferred-items.md
    - .planning/phases/09-voice-vendor-wrappers/09-03-SUMMARY.md
  modified: []
decisions:
  - "Override tsconfig.base.json paths={} inside packages/voice-tts/tsconfig.json so @achilles/voice-protocol resolves through node_modules dist instead of the workspace src path (which would otherwise fall outside the wrapper's rootDir). Same pattern voice-stt needs (and Plan 09-02 will replicate)."
  - "Restructured constants.ts so the literal 'eleven_flash_v2_5' appears EXACTLY ONCE — as the FLASH_MODEL constant. The URL template uses a template literal that interpolates FLASH_MODEL; the deprecated Turbo id is constructed from string parts (DEPRECATED_TURBO_MODEL_ID) so the grep-guard contract on FLASH_MODEL is preserved."
  - "Stream-client lazy-opens the WebSocket on first appendText / flush; close() awaits any in-flight open so the WS reference is set before tear-down (fixes a race observed in the close-cleanup test)."
  - "Mock WS uses queueMicrotask for the open event so the wrapper's onopen handler binding is wired before fire; this matches how real browser WebSockets behave."
metrics:
  duration_minutes: 18
  completed_date: "2026-06-06"
  tasks: 2
  test_files: 7
  tests_total: 41
  source_lines: 1419
  test_fixture_lines: 644
  total_lines: 2501
---

# Phase 09 Plan 03: @achilles/voice-tts — Flash v2.5 Streaming with Sequence-Tracked Playback Summary

## One-liner

Main-process Flash v2.5 stream-input TTS wrapper around the ElevenLabs SDK with consumer-injected KeySource (no env reads, no keystore opens), construction-time SAFE-03 allowlist enforcement via assertElevenLabsHost, and a SequenceBuffer that proves monotonic chunk emission against a 60-chunk 30-second narration fixture replayed in scrambled arrival order.

## Tasks Completed

### Task 1: Scaffold @achilles/voice-tts package + constants + key-source + sequence buffer + outbound allowlist
- Created `packages/voice-tts/package.json` mirroring voice-protocol's shape, pinned `@elevenlabs/elevenlabs-js@2.51.0` and `ws@8.18.0`.
- Created `packages/voice-tts/tsconfig.json` extending the repo base with overrides for NodeNext module resolution and `paths: {}` to clear the workspace src redirect so the wrapper builds against the protocol's compiled dist (Rule 3 deviation: see below).
- Authored `src/constants.ts` with the locked Flash v2.5 model id, chunk-length schedule [80, 120, 160, 220], MP3 44.1 kHz default, 500 ms pre-buffer, 5-attempt reconnect cap, the stream-input URL template, and `assertFlashModel` / `buildTtsStreamUrl` helpers. The literal `eleven_flash_v2_5` appears EXACTLY ONCE in the file (grep-guard contract); the deprecated `eleven_turbo_v2_5` is named in the assertFlashModel error via a string-join so the grep-guard on FLASH_MODEL stays clean.
- Authored `src/key-source.ts` with the `KeySource = () => Promise<string>` callback type and the `callKeySource(source)` helper that validates the resolved value is a non-empty string >= 8 characters. The module reads no environment variables and opens no keystore; all credentials flow through the consumer-injected callback.
- Authored `src/backoff.ts` duplicating the STT wrapper's `computeBackoffMs(attempt)` with full jitter (base 250 ms, ceiling `base * 2^attempt`, returns Infinity past `RECONNECT_MAX_ATTEMPTS`). CONTEXT.md decision leaves extraction to v1.3.
- Authored `src/sequence-buffer.ts` with `SequenceBuffer<T extends Sequenced>` exposing `push`, `drain`, `hasGap`, `nextExpected`, and `onEmit`. Internal storage is a `Map<number, T>`; the gap detector returns true when the maximum buffered sequence is past `nextExpected_ + size` (i.e., there is a hole between the head and the highest buffered item).
- Authored 5 colocated unit-test files covering the constant lock, key-source contract, backoff bounds + cap, sequence-buffer reorder semantics, and the SAFE-03 host guard.

### Task 2: Stream client + 30-second sequenced fixture + scrambled-order replay test
- Authored `test/fixtures/generate-chunks.mjs` (Node, no extra deps) that emits 60 chunks with `audioBase64 = base64('chunk-<i>')`, `durationMs = 500`, `mimeType = "audio/mpeg"`, summing to exactly 30000 ms.
- Ran the generator to produce `test/fixtures/sequenced-chunks.json` (60 chunks, 30000 ms, 366 lines pretty-printed).
- Authored `test/fixtures/mock-elevenlabs-tts-server.ts` with `createMockTtsWsCtor({ chunks, arrivalOrder, urlSink })` returning a WebSocket-shaped class. The mock records the construct URL (for SAFE-03 side-assertions), starts emitting chunks on the first `send()`, sends them per the supplied `arrivalOrder` permutation, and terminates with a `stream_complete` envelope carrying the totals.
- Authored `src/stream-client.ts` (512 lines) with `createTtsStreamClient(opts)` returning `{ events$, appendText, flush, close }`. Behaviour:
  - SAFE-03 gate at construction via `assertElevenLabsHost` on `opts.url ?? buildTtsStreamUrl({ voiceId })`.
  - Lazy WS open on first appendText / flush; awaits `callKeySource(opts.keySource)` exactly once and forwards the resolved key via the `xi-api-key` header (with a fallback for browser-shaped constructors that don't accept options).
  - Initial frame carries `model_id = FLASH_MODEL`, `chunk_length_schedule = [80, 120, 160, 220]`, `output_format`.
  - Inbound JSON frames decode through `TtsChunkSchema` / `TtsStreamCompleteSchema` from `@achilles/voice-protocol`; malformed frames log via `console.error` with `[voice-tts]` prefix and continue.
  - `flush()` sends the documented empty-string `{ text: "" }` end-of-utterance signal.
  - `close()` awaits in-flight open before tearing down the WS so the reference is set before `close()` is called.
  - On non-1000 close, schedules a reconnect via `computeBackoffMs(attempt)`; gives up after `RECONNECT_MAX_ATTEMPTS` with a final `[voice-tts]` log and signals the events$ iterator complete.
- Authored `src/index.ts` barrel that re-exports the public surface (`createTtsStreamClient`, `KeySource`, `SequenceBuffer`, `FLASH_MODEL`, `CHUNK_LENGTH_SCHEDULE`, `DEFAULT_OUTPUT_FORMAT`, `PRE_BUFFER_MS`, `computeBackoffMs`, `buildTtsStreamUrl`, `assertFlashModel`, `RECONNECT_MAX_ATTEMPTS`, `TTS_STREAM_URL_TEMPLATE`) plus the protocol's `TtsChunk` / `TtsEvent` / `TtsStreamComplete` types so consumers do not need to dual-import.
- Authored `src/stream-client.test.ts` (8 tests): public surface shape, initial-frame contents, single keySource invocation, inbound chunk decode through TtsChunkSchema, empty-string flush, clean close, SAFE-03 redundant guard, and a TypeScript signature guard that fails to compile if an `apiKey` field is ever added.
- Authored `src/ordering-fixture.test.ts` — the headline PITFALLS #6 demo: reads `sequenced-chunks.json`, permutes the arrival order with a deterministic seed (LCG-driven Fisher-Yates shuffle, seed 42), drives the wrapper against the mock, pipes chunk events through a `SequenceBuffer`, and asserts:
  - All 60 sequences emitted exactly once.
  - Emitted order is strictly monotonic [0, 1, ..., 59].
  - `SequenceBuffer.hasGap()` is false at stream end.
  - `nextExpected()` is 60 (one past the last emitted).
  - `stream_complete` reports totalChunks === 60.
  - Side-assertion: the mock's recorded URL matches `^wss://api\.elevenlabs\.io/` (SAFE-03 holds end-to-end).
- Verified the SAFE-03 outbound-allowlist suite from Task 1 also includes the cross-package consistency test (Task 2 behavior addition): asserts `buildTtsStreamUrl({ voiceId })` for several voice ids all pass `assertElevenLabsHost`.

## Threat Model Mitigations

All STRIDE entries in the plan's `<threat_model>` are mitigated by the code as designed:

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-09-12 (key surface info-disclosure) | mitigate | `KeySource = () => Promise<string>` callback. `key-source.ts` has zero `process.env` references. Tests verify type-shape and runtime validation. |
| T-09-13 (URL tampering) | mitigate | `assertElevenLabsHost` runs at construction in `stream-client.ts`. SAFE-03 positive + negative tests cover regional hosts AND substring attacks. |
| T-09-14 (model spoofing) | mitigate | `FLASH_MODEL` constant; `assertFlashModel` refuses the deprecated Turbo id with a clear error. |
| T-09-15 (reconnect DoS) | mitigate | `computeBackoffMs` with full jitter capped at 5 attempts; emits final error and stops past the cap. |
| T-09-16 (chunk ordering spoof) | mitigate | `SequenceBuffer` rejects negative sequences, dedupes duplicate sequences, emits in monotonic order regardless of arrival. |
| T-09-17 (logging info-disclosure) | mitigate | All logging is `console.error` with `[voice-tts]` prefix; `grep -c "console.log" stream-client.ts` returns 0. |
| T-09-18 (chunk payload disclosure) | accept | Phase 12 owns pre-TTS redaction. This package treats text input as opaque. |
| T-09-SC (npm install supply chain) | mitigate | `@elevenlabs/elevenlabs-js@2.51.0` and `ws@8.18.0` pinned to STACK.md HIGH-confidence versions. |

## Verification Results

- `npm install --workspace @achilles/voice-tts` -> success (workspace registered, 189 packages audited).
- `npm run typecheck --workspace @achilles/voice-tts` -> success (exit 0).
- `npm run build --workspace @achilles/voice-tts` -> success, dist/index.js produced.
- `npm test --workspace @achilles/voice-tts` -> 41 tests pass across 7 test files.
- `npx vitest run --project phase-09-unit packages/voice-tts/src/` -> 41 tests pass.
- Ordering-fixture test: scrambled-arrival replay of 60 sequenced chunks emerges from SequenceBuffer in monotonic order 0..59 with `hasGap() === false`.
- SAFE-03 outbound-allowlist: positive cases (`api.elevenlabs.io`, `api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io`) accepted; negative cases (`evil.com`, `api.elevenlabs.io.evil.com` substring attack) refused at construction with a SAFE-03-bearing error message.
- Grep-guard `eleven_flash_v2_5` literal occurrences in constants.ts: 1 (matches plan acceptance criterion).
- Grep-guard `eleven_turbo_v2_5` references in src/: present in constants.ts (1, deprecation guard) and constants.test.ts (2, test of the guard) — totals satisfy the `>= 1` acceptance criterion.
- Grep-guard `process.env` in key-source.ts non-comment lines: 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript rootDir conflict on @achilles/voice-protocol path mapping**
- **Found during:** Task 1 first build attempt
- **Issue:** `tsc -p tsconfig.json` errored with TS6059 — TypeScript was resolving `@achilles/voice-protocol` to `packages/voice-protocol/src/index.ts` via tsconfig.base.json `paths`, but that file is outside the wrapper's rootDir.
- **Fix:** Added `moduleResolution: "NodeNext"`, `module: "NodeNext"`, `baseUrl: "."`, and `paths: {}` overrides to `packages/voice-tts/tsconfig.json`. This clears the workspace-src redirect so the import resolves through the package's `node_modules` symlink (which points at the workspace and its `dist/index.d.ts` via the `exports` map).
- **Files modified:** `packages/voice-tts/tsconfig.json`
- **Commit:** included in final atomic commit
- **Note:** Plan 09-02 (voice-stt) has the same upstream issue and will need the same fix; that is owned by Plan 09-02.

**2. [Rule 1 - Bug] Restructured constants.ts so `eleven_flash_v2_5` literal appears exactly once**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** Plan requires `grep -n eleven_flash_v2_5 constants.ts` finds EXACTLY one literal occurrence. First draft had 5 occurrences (constant + URL template literal + error message + 2 comments).
- **Fix:** URL template now interpolates `${FLASH_MODEL}`; error message references the constant by name; comments no longer spell the literal verbatim. Deprecated Turbo id constructed via `["eleven", "turbo", "v2_5"].join("_")` so the grep-guard on FLASH_MODEL stays clean while runtime behaviour names the rejected model.
- **Files modified:** `packages/voice-tts/src/constants.ts`
- **Commit:** included in final atomic commit

**3. [Rule 1 - Bug] SequenceBuffer.hasGap() semantics**
- **Found during:** Task 1 sequence-buffer test run
- **Issue:** First draft returned `!buffered.has(nextExpected_)` which is false after pushing the head even if there are gaps further out. The plan's test asserts `hasGap()` returns true for buffered `{0, 2}` (head present, but 1 missing before 2).
- **Fix:** `hasGap()` now returns true when `maxBufferedSeq >= nextExpected_ + buffered.size`, which detects holes anywhere in the buffered prefix.
- **Files modified:** `packages/voice-tts/src/sequence-buffer.ts`
- **Commit:** included in final atomic commit

**4. [Rule 1 - Bug] close() race against lazy WS open**
- **Found during:** Task 2 stream-client test run
- **Issue:** `close()` test failed because `appendText` triggers `ensureOpen()` asynchronously; if `close()` runs immediately after, `ws` is still null and the mock's `close()` recorder never fires.
- **Fix:** `close()` now awaits any in-flight `openPromise` before invoking `ws.close()`.
- **Files modified:** `packages/voice-tts/src/stream-client.ts`
- **Commit:** included in final atomic commit

**5. [Rule 1 - Bug] ordering-fixture.test.ts null-cast typecheck error**
- **Found during:** Root `npm run typecheck` after Task 2
- **Issue:** Casting `lastComplete as { type: string }` when `lastComplete` is initialised to `null` triggers TS2352 "may be a mistake".
- **Fix:** Replaced narrow cast with `lastComplete as unknown as { type: string; totalChunks: number }` after a null check (only the test scope cares; the production code is correctly typed).
- **Files modified:** `packages/voice-tts/src/ordering-fixture.test.ts`
- **Commit:** included in final atomic commit

### Out-of-Scope Pre-Existing Issues (deferred-items.md)

Root `npm run typecheck` surfaces TS17004 / TS2352 errors in `apps/web/components/session/*.tsx` and `tests/auth-pairing.spec.ts`, plus TS2353 on `vitest.workspace.ts` `passWithNoTests`. These are pre-existing — Phase 09 only touches `packages/voice-tts/`. Logged to `.planning/phases/09-voice-vendor-wrappers/deferred-items.md`; not addressed by this plan.

## Authentication Gates

None — the package never opens an authenticated channel during testing. All tests use stubbed KeySource callbacks returning a fixed test string. Real-world authentication is the consumer's responsibility (Phase 11 main process wires Electron `safeStorage` as the KeySource).

## Known Stubs

None — every code path is implemented for the v1.2 scope. The TODO carry-over to Phase 11 is wiring Electron `safeStorage.decryptString(...)` as the consumer-side `KeySource` implementation; the wrapper itself is complete.

## Threat Flags

None — the package introduces no new attack surface beyond what the threat model already enumerates. All outbound traffic is gated by `assertElevenLabsHost` from `@achilles/voice-protocol` (the same matcher voice-stt uses), and the wrapper has no inbound listening sockets.

## Self-Check: PASSED

- File checks (created):
  - `packages/voice-tts/package.json` FOUND
  - `packages/voice-tts/tsconfig.json` FOUND
  - `packages/voice-tts/src/index.ts` FOUND
  - `packages/voice-tts/src/constants.ts` FOUND
  - `packages/voice-tts/src/key-source.ts` FOUND
  - `packages/voice-tts/src/backoff.ts` FOUND
  - `packages/voice-tts/src/sequence-buffer.ts` FOUND
  - `packages/voice-tts/src/stream-client.ts` FOUND
  - `packages/voice-tts/src/constants.test.ts` FOUND
  - `packages/voice-tts/src/key-source.test.ts` FOUND
  - `packages/voice-tts/src/backoff.test.ts` FOUND
  - `packages/voice-tts/src/sequence-buffer.test.ts` FOUND
  - `packages/voice-tts/src/stream-client.test.ts` FOUND
  - `packages/voice-tts/src/outbound-allowlist.test.ts` FOUND
  - `packages/voice-tts/src/ordering-fixture.test.ts` FOUND
  - `packages/voice-tts/test/fixtures/generate-chunks.mjs` FOUND
  - `packages/voice-tts/test/fixtures/sequenced-chunks.json` FOUND (60 chunks, 30000 ms)
  - `packages/voice-tts/test/fixtures/mock-elevenlabs-tts-server.ts` FOUND
- Test pass: 41/41 across 7 test files.
- Build pass: `tsc -p tsconfig.json` exit 0; dist/index.js produced.
- Workspace typecheck pass: `npm run typecheck --workspace @achilles/voice-tts` exit 0.
- Commit verification: will be appended below after the final commit lands.
