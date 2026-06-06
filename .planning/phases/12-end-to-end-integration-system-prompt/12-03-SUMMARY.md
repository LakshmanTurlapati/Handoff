---
phase: 12-end-to-end-integration-system-prompt
plan: 03
subsystem: achilles
tags:
  - achilles
  - renderer
  - audio
  - audio-worklet
  - getusermedia
  - analyser-node
  - tts-playback
  - prompt-04
  - half-duplex
  - loop-01
  - loop-05
requirements:
  - PROMPT-04
requires:
  - voice-stt (Phase 09) renderer-safe barrel — structural mirror for the SequenceBuffer + Int16 frame contract; not directly imported in 12-03 (orchestrator wiring lands in 12-04)
  - voice-protocol (Phase 09) — IPC envelope + Zod `.strict()` precedent
  - Phase 11 shared/constants + ipc-schemas — extended only (no break)
  - Phase 11 components/Waveform.tsx — analyser prop unchanged; real AnalyserNode is shape-compatible with AnalyserLike
provides:
  - downsample48kTo16kInt16(input) — pure 48 kHz Float32 -> 16 kHz Int16 PCM helper, 320 samples per frame at 20 ms granularity, LOOP-01 pin
  - createDownsampleWorklet(audioContext) -> Promise<DownsampleWorkletHandle> — AudioWorklet factory using inline Blob URL
  - createMicCapture({audioContext, analyserBinding, onFrame, onAmplitude, getUserMediaImpl?, createWorkletImpl?, amplitudeTickMs?}) — getUserMedia + worklet + AnalyserNode composition root; pause/resume gates frame delivery at the worklet message-port boundary
  - createPlaybackQueue({audioContext, analyserBinding, onPlaybackComplete, onDrained, onError?, decodeAudioDataImpl?}) — sole production audio output path (PROMPT-04 structural enforcement)
  - createAnalyserBinding({audioContext, mode?, fftSize?}) — mode-switching AnalyserNode for the Waveform (listening/speaking/idle); MockAnalyser stays as test seam
  - 6 new IPC channel constants — IPC_TTS_CHUNK / IPC_TTS_PLAYBACK_COMPLETE / IPC_UTTERANCE_COMMIT / IPC_MIC_FRAME / IPC_STT_TOKEN_REQUEST / IPC_STT_TOKEN
  - 6 new .strict() Zod schemas paired with the above + IPC_PAYLOAD_SCHEMAS map entries
  - Locked sample-rate constants — TARGET_SAMPLE_RATE=16000, FRAME_SAMPLES=320, SOURCE_SAMPLE_RATE=48000, FRAME_SAMPLES_48K=960, FRAME_DURATION_MS=20
  - DOWNSAMPLE_WORKLET_NAME literal — "achilles-downsample-processor"
affects:
  - Plan 12-04 (session.ts orchestrator) composes createMicCapture + createPlaybackQueue + createAnalyserBinding behind the state machine; wires the 6 new IPC channels to the renderer bridge
  - Plan 12-04 (renderer App composition) — main.tsx feeds the AnalyserNode from createAnalyserBinding into the Phase 11 Waveform's analyser prop
tech-stack:
  added: []
  patterns:
    - injection-seam composition (getUserMediaImpl + createWorkletImpl + decodeAudioDataImpl) so unit tests run without real Web Audio / MediaStream / AudioWorklet
    - inline AudioWorklet processor source delivered via dynamically constructed Blob URL (electron-vite renderer config does not yet pipe a separate worklet bundle)
    - single-runtime-export structural enforcement (Object.keys(module) === ['createPlaybackQueue']) for PROMPT-04
    - half-duplex gating at the AudioWorkletNode message-port boundary (frames dropped without closing the OS mic track — avoids macOS re-prompt)
    - renderer-side SequenceBuffer mirroring @achilles/voice-tts/sequence-buffer.ts (process-boundary forces structural copy, not import)
    - z.literal() validators pinning the LOOP-01 contract at the IPC trust boundary (sampleRate: 16000, samplesPerFrame: 320)
key-files:
  created:
    - apps/achilles/src/renderer/audio/downsample-worklet.ts
    - apps/achilles/src/renderer/audio/downsample-worklet.test.ts
    - apps/achilles/src/renderer/audio/mic-capture.ts
    - apps/achilles/src/renderer/audio/mic-capture.test.ts
    - apps/achilles/src/renderer/audio/playback-queue.ts
    - apps/achilles/src/renderer/audio/playback-queue.test.ts
    - apps/achilles/src/renderer/audio/analyser-binding.ts
    - apps/achilles/src/renderer/audio/analyser-binding.test.ts
    - .planning/phases/12-end-to-end-integration-system-prompt/deferred-items.md
  modified:
    - apps/achilles/src/shared/constants.ts (+6 IPC channel constants in a clearly labelled Phase 12 section; no renumbering)
    - apps/achilles/src/shared/ipc-schemas.ts (+6 .strict() Zod schemas + 6 type aliases + 6 map entries; appended only)
    - apps/achilles/src/shared/ipc-schemas.test.ts (+36 new test cases across 9 describe blocks for the Phase 12 surface; 1 length assertion bumped 12 -> 18)
decisions:
  - Plan 12-03 pins the LOOP-01 contract (16 kHz mono Int16 PCM, 320 samples / 20 ms / frame) in THREE places — the downsample helper's locked module constants, the AudioWorklet processor's inline source, and the MicFramePayloadSchema's `z.literal(16000)` + `z.literal(320)` validators. A regression that ships a wrong sample rate fails the typecheck, fails the unit test, and fails at the IPC boundary.
  - PROMPT-04 enforcement is structural: playback-queue.ts has EXACTLY ONE runtime export (`createPlaybackQueue`). Test P6 asserts `Object.keys(module) === ['createPlaybackQueue']` via dynamic import. The interface types are erased at runtime so a future contributor cannot accidentally smuggle a second audio-out path through this module without breaking the test.
  - Half-duplex gating drops frames at the AudioWorkletNode message-port boundary, NOT at the MediaStreamTrack level. Closing the track would trigger a visible OS mic-indicator flicker (and on some macOS configurations, a re-prompt) every turn. The amplitude tick continues during pause so the Waveform UI still reflects the mic visually.
  - The AudioWorklet processor source is embedded as an inline string and loaded via a dynamically constructed Blob URL because electron-vite does not yet pipe a separate worklet bundle. A future plan can lift the processor into its own bundle.
  - The renderer-side SequenceBuffer in playback-queue.ts mirrors the SHAPE of @achilles/voice-tts/src/sequence-buffer.ts but does NOT import it — voice-tts is main-process-only. The structural mirror is intentional and documented in the JSDoc.
  - getUserMedia denial caches the rejection. Subsequent start() calls return the cached promise WITHOUT re-invoking the stub. The renderer cannot accidentally re-trigger the OS permission prompt by reactively calling start() from an error handler.
  - The injection seams (getUserMediaImpl, createWorkletImpl, decodeAudioDataImpl) accept optional callable overrides that default to the real Web Audio / MediaDevices API. Unit tests inject stubs; production code uses the defaults — no branching on environment.
  - The new IPC channels follow the established `achilles:` prefix + kebab-case convention; no renumbering of existing channels. The IPC_PAYLOAD_SCHEMAS map appends the 6 new entries without touching the prior 12.
metrics:
  duration_minutes: 12
  completed: 2026-06-06
  task_count: 3
  file_count: 9
  test_count: 36 new ipc-schema tests + 28 new audio module tests = 64 new tests; cumulative phase-12-unit 97/97, phase-11-unit 347/347 (including the new audio tests sweeping into 11-unit's include glob), phase-09-unit 302/302, no Plan 11-01 regression
---

# Phase 12 Plan 03: Renderer Audio Infrastructure Summary

Locked the LOOP-01 audio contract (16 kHz mono Int16 PCM, 320 samples / 20 ms / frame) end-to-end in the renderer by shipping four new audio modules under `apps/achilles/src/renderer/audio/`. PROMPT-04 is now structurally enforced via the playback-queue's single-runtime-export property.

## Created Files

### Audio modules (`apps/achilles/src/renderer/audio/`)

| File | Purpose | Key exports |
|------|---------|-------------|
| `downsample-worklet.ts` | Pure `downsample48kTo16kInt16` helper + `createDownsampleWorklet` AudioWorklet factory | `downsample48kTo16kInt16`, `createDownsampleWorklet`, `DOWNSAMPLE_WORKLET_NAME`, `TARGET_SAMPLE_RATE`, `FRAME_SAMPLES`, `SOURCE_SAMPLE_RATE`, `FRAME_SAMPLES_48K`, `FRAME_DURATION_MS` |
| `mic-capture.ts` | Composition root: getUserMedia + downsample worklet + AnalyserNode + pause/resume gates | `createMicCapture`, `MicCaptureHandle`, `MicCaptureOptions`, `MicCaptureState` |
| `playback-queue.ts` | TTS chunk decoder + sequence-respecting playback queue (PROMPT-04 sole-entry-point) | `createPlaybackQueue` (sole runtime export) — `PlaybackQueueHandle`, `PlaybackQueueOptions` are TypeScript interfaces erased at runtime |
| `analyser-binding.ts` | Mode-switching AnalyserNode replacing Phase 11's MockAnalyser in production | `createAnalyserBinding`, `AnalyserBindingHandle`, `CreateAnalyserBindingOptions`, `AnalyserMode` |

### Test files (4 × .test.ts, all `// @vitest-environment jsdom`)

| File | Tests | Coverage |
|------|-------|----------|
| `downsample-worklet.test.ts` | 7 | sample rate ratio (T1), Int16 conversion bounds with clamp (T2), 1 kHz sine round-trip via zero-crossing count (T3), determinism (T4), input-length contract (T5), locked constants (T6), processor name literal (T7) |
| `mic-capture.test.ts` | 7 | handle shape (M1), constraint set (M2), worklet frame forwarding (M3), pause/resume gating at worklet boundary (M4), stop() teardown (M5), AMPLITUDE_TICK_MS amplitude reporting via fake timers (M6), NotAllowedError caching (M7) |
| `playback-queue.test.ts` | 7 | handle shape (P1), in-order playback (P2), out-of-order reordering (P3), onPlaybackComplete + onDrained sequencing (P4), invalid sequence (P5), PROMPT-04 single-entry-point assertion via `Object.keys(import())` (P6), flush() teardown (P7) |
| `analyser-binding.test.ts` | 7 | default fftSize + AnalyserLike shape (A1), setMicSource + setMode wiring (A2), three-mode swap (A3), disconnect-before-connect ordering (A4), AnalyserLike type assignability (A5), no-op same-mode setMode, destroy() teardown |

### Documentation

- `.planning/phases/12-end-to-end-integration-system-prompt/deferred-items.md` — logs the pre-existing `npm test --workspace apps/achilles` failure (Phase 11 .tsx component tests fail with `ReferenceError: React is not defined` when invoked directly through the workspace script; passes cleanly through `npx vitest run --project phase-11-unit` which picks up the root vitest.workspace.ts esbuild JSX-automatic config)

## Modified Files

### `apps/achilles/src/shared/constants.ts`

Appended a clearly labelled `Phase 12 IPC channels` section with six new channel constants:

```
IPC_TTS_CHUNK              = "achilles:tts-chunk"
IPC_TTS_PLAYBACK_COMPLETE  = "achilles:tts-playback-complete"
IPC_UTTERANCE_COMMIT       = "achilles:utterance-commit"
IPC_MIC_FRAME              = "achilles:mic-frame"
IPC_STT_TOKEN_REQUEST      = "achilles:stt-token-request"
IPC_STT_TOKEN              = "achilles:stt-token"
```

Pre-existing Plan 11-01 constants are unchanged; total IPC channel count is now 12 + 6 = 18.

### `apps/achilles/src/shared/ipc-schemas.ts`

Appended six `.strict()` Zod schemas + six `z.infer` type aliases + six entries in `IPC_PAYLOAD_SCHEMAS`:

- `TtsChunkPayloadSchema` — `{seq: nonneg int, mime: "audio/mpeg"|"audio/pcm", bytes: ArrayBuffer, isFinal: boolean}`
- `TtsPlaybackCompletePayloadSchema` — empty object (channel itself is the signal)
- `UtteranceCommitPayloadSchema` — `{id: uuid, text: nonempty string, committedAt: nonneg int}` (shape-matches the prior `TranscriptCommittedPayloadSchema`)
- `MicFramePayloadSchema` — `{pcm: ArrayBuffer, sampleRate: z.literal(16000), samplesPerFrame: z.literal(320)}` — **LOOP-01 pin at the IPC boundary**
- `SttTokenRequestPayloadSchema` — empty object
- `SttTokenPayloadSchema` — `{token: nonempty string, expiresAt: ISO-8601 datetime}`

### `apps/achilles/src/shared/ipc-schemas.test.ts`

Added 9 new describe blocks (36 new test cases) — channel naming (P12.IPC1), each schema's happy path + `.strict()` rejection (P12.IPC2..P12.IPC7), IPC_PAYLOAD_SCHEMAS routing (P12.IPC8), and the no-collision check against Plan 11-01 channels (P12.IPC9). One pre-existing assertion `expect(keys.length).toBe(12)` was updated to `18` with a comment explaining the Phase 11 vs Phase 12 split.

## Locked Sample-Rate Constants (LOOP-01)

```typescript
TARGET_SAMPLE_RATE  = 16000
FRAME_DURATION_MS   = 20
FRAME_SAMPLES       = 320   // 20 ms at 16 kHz
SOURCE_SAMPLE_RATE  = 48000
FRAME_SAMPLES_48K   = 960   // 20 ms at 48 kHz
DOWNSAMPLE_WORKLET_NAME = "achilles-downsample-processor"
```

These are pinned in three places:
1. `downsample-worklet.ts` exported module constants — the pure helper and AudioWorklet factory both read from them.
2. The inline AudioWorklet processor source uses templated literals so a future rename propagates correctly.
3. `MicFramePayloadSchema` uses `z.literal(16000)` and `z.literal(320)` validators — a renderer or main process trying to send a wrong-rate frame is rejected at the IPC trust boundary.

## PROMPT-04 Single-Entry-Point Enforcement

`playback-queue.ts` exports exactly one runtime callable (`createPlaybackQueue`). The two interface exports (`PlaybackQueueHandle`, `PlaybackQueueOptions`) are erased at compile time and do not appear in the module's runtime namespace.

Test P6 verifies this property:

```typescript
const module = await import("./playback-queue.js");
expect(Object.keys(module)).toEqual(["createPlaybackQueue"]);
```

A future contributor cannot smuggle a second audio-output path through this module without breaking that test.

## Half-Duplex Gate Contract (PITFALLS #2 / CONTEXT.md)

`mic-capture.pauseFrameDelivery()` drops frames at the AudioWorkletNode message-port boundary. The MediaStreamTrack stays open. This was chosen because closing the track would trigger an OS-visible mic-indicator flicker (and on some macOS configurations, a re-prompt) every turn.

The amplitude tick continues during pause so the Waveform UI still reflects the mic visually. The orchestrator (Plan 12-04) is free to mask the visual via the state-changed broadcast if desired; this plan provides the mechanism, not the policy.

`resumeFrameDelivery()` is the reverse — the worklet message-port boundary stops dropping. `stop()` is the full teardown (closes the MediaStreamTrack, destroys the worklet, clears the analyser binding's mic source).

## Six New IPC Channels + `.strict()` Schemas

| Channel constant | Wire literal | Direction | Schema |
|---|---|---|---|
| `IPC_TTS_CHUNK` | `achilles:tts-chunk` | Main → Renderer | `TtsChunkPayloadSchema` — `{seq, mime, bytes, isFinal}` |
| `IPC_TTS_PLAYBACK_COMPLETE` | `achilles:tts-playback-complete` | Renderer → Main | `TtsPlaybackCompletePayloadSchema` — empty |
| `IPC_UTTERANCE_COMMIT` | `achilles:utterance-commit` | Renderer → Main | `UtteranceCommitPayloadSchema` — `{id, text, committedAt}` |
| `IPC_MIC_FRAME` | `achilles:mic-frame` | Renderer → Main | `MicFramePayloadSchema` — `{pcm, sampleRate:16000, samplesPerFrame:320}` |
| `IPC_STT_TOKEN_REQUEST` | `achilles:stt-token-request` | Renderer → Main | `SttTokenRequestPayloadSchema` — empty |
| `IPC_STT_TOKEN` | `achilles:stt-token` | Main → Renderer | `SttTokenPayloadSchema` — `{token, expiresAt}` |

All payloads use `.strict()` so unknown fields are rejected at the boundary (SAFE-01 precedent inherited from Plan 11-01).

## Test Counts Per Module

| Module | New tests | Status |
|---|---|---|
| `downsample-worklet.test.ts` | 7 | pass |
| `mic-capture.test.ts` | 7 | pass |
| `playback-queue.test.ts` | 7 | pass |
| `analyser-binding.test.ts` | 7 | pass |
| `ipc-schemas.test.ts` | 36 new (29 prior + 36 new = 65 total) | pass |
| **Total new** | **64** | |

Cumulative project test counts after Plan 12-03:
- `phase-12-unit`: **97/97 pass** (8 files — skill prompts + sandwich-defence + normalisation + the 4 audio modules)
- `phase-11-unit`: **347/347 pass** (no Plan 11-01 regression; the new audio tests sweep into the 11-unit include glob too)
- `phase-09-unit + phase-10-unit`: **302/302 pass** (no regression)

## Verification Results (per plan `<verification>` block)

| # | Command | Result |
|---|---|---|
| 1 | `npx vitest run --project phase-12-unit apps/achilles/src/renderer/audio/` | 28/28 pass (4 files) |
| 2 | `npx vitest run --project phase-11-unit apps/achilles/src/shared/` | 75/75 pass (no Plan 11-01 regression) |
| 3 | `npm run typecheck --workspace apps/achilles` | exit 0 (both tsconfig.node.json + tsconfig.web.json clean) |
| 4 | `grep -c "export " apps/achilles/src/renderer/audio/playback-queue.ts` | 3 lines match `^export ` — 2 are `interface` (erased at runtime) + 1 is `function`; Object.keys(module) test P6 confirms exactly one runtime callable |
| 5 | `grep -v '^//' apps/achilles/src/renderer/audio/downsample-worklet.ts \| grep -c "TARGET_SAMPLE_RATE = 16000"` | 2 (the declaration + the derived `FRAME_SAMPLES` line), ≥ 1 satisfied |
| 6 | `grep -c "achilles:" apps/achilles/src/shared/constants.ts` | 22 raw matches; `grep -c '^export const IPC_' constants.ts` = 18 (exactly 12 + 6) |
| extra | `find apps/achilles/src -name '*.js' -o -name '*.d.ts'` | empty (CR-07 clean) |
| extra | emoji scan over modified/new files | clean (CLAUDE.md global) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Unused-parameter typecheck error in `scheduleAndPlay`**
- **Found during:** Task 3 (after writing playback-queue.ts), surfaced by `npm run typecheck --workspace apps/achilles`
- **Issue:** `tsc -p tsconfig.web.json` reported `error TS6133: 'chunk' is declared but its value is never read` at `playback-queue.ts:104`. The `scheduleAndPlay` internal helper accepted `chunk: TtsChunkPayload` for call-site documentation but only used `decoded` and `seq` inside the function body.
- **Fix:** Renamed the parameter to `_chunk` (with explanatory comment) — TypeScript's `noUnusedParameters` rule allows leading-underscore unused parameters, preserving the documentation intent at the call site without breaking the typecheck.
- **Files modified:** `apps/achilles/src/renderer/audio/playback-queue.ts`
- **Verification:** `npm run typecheck --workspace apps/achilles` exits 0 after the rename. All 7 playback-queue tests still pass (the parameter rename does not affect the runtime export shape that P6 asserts against).

No architectural deviations were required; the plan's design held end-to-end.

## Deferred Issues

**1. `npm test --workspace apps/achilles` fails for Phase 11 .tsx component tests** — logged in `.planning/phases/12-end-to-end-integration-system-prompt/deferred-items.md`. This is a **pre-existing** failure verified by a `git stash -u` to base commit `6f66ee5` (Plan 12-02 head) — not caused by Plan 12-03. The workaround used during 12-03 verification was `npx vitest run --project phase-11-unit` which picks up the root `vitest.workspace.ts` esbuild JSX-automatic config and passes 347/347. Plan 12-04 is the natural owner since it also extends the renderer composition root.

## Self-Check: PASSED

- [x] `apps/achilles/src/renderer/audio/downsample-worklet.ts` exists
- [x] `apps/achilles/src/renderer/audio/downsample-worklet.test.ts` exists
- [x] `apps/achilles/src/renderer/audio/mic-capture.ts` exists
- [x] `apps/achilles/src/renderer/audio/mic-capture.test.ts` exists
- [x] `apps/achilles/src/renderer/audio/playback-queue.ts` exists
- [x] `apps/achilles/src/renderer/audio/playback-queue.test.ts` exists
- [x] `apps/achilles/src/renderer/audio/analyser-binding.ts` exists
- [x] `apps/achilles/src/renderer/audio/analyser-binding.test.ts` exists
- [x] `apps/achilles/src/shared/constants.ts` modified (6 new constants)
- [x] `apps/achilles/src/shared/ipc-schemas.ts` modified (6 new schemas + map entries)
- [x] `apps/achilles/src/shared/ipc-schemas.test.ts` modified (+36 tests)
- [x] All 28 phase-12 audio tests pass
- [x] All 75 phase-11 shared tests pass (no Plan 11-01 regression)
- [x] Typecheck exits 0
- [x] No emojis in any new or modified file
- [x] No `.js` / `.d.ts` files under `apps/achilles/src/`
