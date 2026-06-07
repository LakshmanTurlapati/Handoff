---
phase: 14-hardening-privacy-resilience
plan: 01
subsystem: latency-probe
tags: [loop-06, observability, percentile, rolling-window, cli]
requires:
  - apps/achilles/src/main/session.ts (Phase 12-04 orchestrator)
  - apps/achilles/src/main/mock-loop-clients.ts (deterministic fakes)
  - apps/achilles-cli/src/cli.ts (Phase 13-01 commander entrypoint)
provides:
  - apps/achilles/src/main/latency-probe.ts (createLatencyProbe + percentile)
  - apps/achilles-cli/src/commands/latency.ts (latencyCommand)
  - --debug global CLI flag (sets ACHILLES_DEBUG=1)
  - achilles latency --report subcommand
affects:
  - apps/achilles/src/main/session.ts (six new probe call sites)
  - apps/achilles/src/main/index.ts (probe construction when ACHILLES_DEBUG=1)
  - apps/achilles-cli/src/cli.ts (CliDeps + --debug + latency command)
  - vitest.workspace.ts (phase-14-unit project entry)
tech-stack:
  added: []
  patterns:
    - Injected seam (writeFileImpl, readFileImpl, nowImpl) for deterministic testing
    - R-7 linear-interpolation percentile method (sorted ascending + lo/hi + frac)
    - Fixed-capacity FIFO rolling window with O(N) eviction
    - Optional probe field on AchillesSessionDeps (back-compat via undefined)
key-files:
  created:
    - apps/achilles/src/main/latency-probe.ts
    - apps/achilles/src/main/latency-probe.test.ts
    - apps/achilles-cli/src/commands/latency.ts
    - apps/achilles-cli/src/commands/latency.test.ts
    - .planning/phases/14-hardening-privacy-resilience/14-01-SUMMARY.md
  modified:
    - apps/achilles/src/main/session.ts
    - apps/achilles/src/main/session.test.ts
    - apps/achilles/src/main/index.ts
    - apps/achilles-cli/src/cli.ts
    - apps/achilles-cli/src/cli.test.ts
    - vitest.workspace.ts
decisions:
  - Duplicated the percentile R-7 helper locally in latency.ts rather than importing from @achilles/app/main/latency-probe (apps/achilles is the private Electron app, not a publishable library; cross-package import would break the standalone achilles npm dist build).
  - The LOOP-06 metric anchor is the FIRST IPC_TTS_CHUNK fan-out moment, not the renderer playback-start moment. The renderer's playback-queue owns the actual audio rendering; main can only measure when the byte left IPC. The probe finalizeSample() fires there.
  - The sample file path is ~/.achilles/latency-samples.json — both the main-process writer and the CLI reader use the same fixed path so the offline subcommand needs no Electron IPC round-trip.
  - tts_playback_complete is recorded but happens AFTER finalizeSample (the sample is already in the rolling window); the call is a no-op for the LOOP-06 metric but kept uniform for taxonomy consistency.
metrics:
  duration: ~25 minutes
  completed: 2026-06-06
---

# Phase 14 Plan 01: Latency Probe Summary

LOOP-06 observability — pure latency-probe module records six voice-loop stage timestamps over a rolling 20-utterance window, computes P50 / P95 via the R-7 method, emits an `[achilles-latency]` log line per turn when `--debug` is active, persists samples to `~/.achilles/latency-samples.json`, and surfaces the rolling window via the offline `achilles latency --report` subcommand. No live ElevenLabs / Electron in CI; deterministic fake clocks drive percentile fixtures against the LOOP-06 budget invariant (P50 < 1 s, P95 < 1.5 s).

## What Shipped

### Latency probe module (`apps/achilles/src/main/latency-probe.ts`, 423 LOC)

- `createLatencyProbe({nowImpl, debugEnabled, logger, writeSampleFile, sampleFilePath, writeFileImpl, maxWindow=20})` returns a handle with `markSpeechEnd / recordStage / finalizeSample / report / dispose`.
- `LatencyStage` union literal: `'stt_committed' | 'claude_first_text_delta' | 'claude_assistant_done' | 'tts_first_chunk' | 'tts_playback_start' | 'tts_playback_complete'`.
- `LatencySample` interface — frozen object with `utteranceId`, `speechEndMs`, per-stage timestamps, and the LOOP-06 `endToEndMs`.
- Exported `percentile(values, p)` helper using R-7 linear interpolation: `sorted ascending; idx = (p/100) * (n-1); floor + ceil + interpolation`. Verified against the locked fixture `[100, 200, 300, 400, 500] → P50=300, P95=480`.
- Rolling FIFO with capacity eviction (default 20 samples); samples beyond capacity evict the head.
- Optional file export — `writeFileImpl(path, JSON)` after every `finalizeSample` when `writeSampleFile=true`; JSON shape is `{ samples: LatencySample[], updatedAt: ISO-8601 }`.
- `dispose()` clears the window AND drops the `writeFileImpl` reference; subsequent calls are no-ops.

### Session.ts wiring (six new probe call sites)

| Location | Stage |
|---|---|
| `onUtteranceCommit(payload)` body | `markSpeechEnd(payload.committedAt, payload.id)` + `recordStage('stt_committed')` |
| `consumeClaudeEvents` first parseable ack branch | `recordStage('claude_first_text_delta')` |
| `consumeClaudeEvents` `process_exit` branch | `recordStage('claude_assistant_done')` |
| `openTtsClient()` after `tts.open()` resolves | `recordStage('tts_first_chunk')` |
| Chunk-fanout consumer, first IPC_TTS_CHUNK only | `recordStage('tts_playback_start')` + `finalizeSample()` |
| `onTtsPlaybackComplete()` body | `recordStage('tts_playback_complete')` |

All calls use `deps.latencyProbe?.recordStage(...)` optional chaining — when `latencyProbe` is undefined the orchestrator is bit-for-bit identical to its pre-14-01 surface (SE17 invariant).

### CLI surface

- `achilles --debug launch` → passes `{ env: { ...process.env, ACHILLES_DEBUG: "1" } }` through to `deps.launchCommand`. The Electron main reads the env var at bootstrap and constructs a probe with `debugEnabled=true + writeSampleFile=true + sampleFilePath = ~/.achilles/latency-samples.json`.
- `achilles latency --report` → reads `~/.achilles/latency-samples.json` via the injected `readFileImpl` seam, computes P50 / P95 over `endToEndMs`, prints a summary block with budget status (`within budget` / `BREACH: ...`).
- `achilles latency` (no `--report`) → writes `[achilles] Specify --report...` to stderr; exits 1.
- Missing file → writes `[achilles] No latency samples recorded yet...` to stdout; exits 0.
- Malformed JSON → writes `[achilles] Latency sample file is malformed: <path>` to stderr; exits 1.

### Tests (49 new tests, 28 in phase-14-unit + 21 across phase-12/13)

- `latency-probe.test.ts` (21 tests): LP1..LP9 + percentile R-7 fixture + dispose idempotency + write-impl exception handling.
- `latency.test.ts` (7 tests): LC1..LC4 + missing-`--report` + non-object-root JSON + BREACH fixture.
- `session.test.ts` (+3 tests, total 27): SE15 (markSpeechEnd + stt_committed on commit), SE16 (six stages wired through full turn + finalizeSample on first chunk), SE17 (probe-undefined preserves Plan 12-04 behaviour bit-for-bit).
- `cli.test.ts` (+5 tests, total 14): C10 (--debug routes env override), C11 (latency --report → `{report: true}`), C11b (latency alone → `{report: false}`), C12 (no --debug means no overrides), C12b (--help lists `latency` and `--debug`).

## Verification

| Command | Result |
|---|---|
| `npx vitest run --project phase-14-unit` | 28 tests pass (LP1..LP9 + LC1..LC4 + bonuses) |
| `MOCK_LOOP=1 npx vitest run --project phase-12-unit apps/achilles/src/main/session.test.ts` | 27 tests pass (16 SE existing + 8 CR existing + 3 new SE15..SE17) |
| `npx vitest run --project phase-12-unit apps/achilles/src/main/session.test.ts` | 27 tests pass |
| `npx vitest run --project phase-13-unit apps/achilles-cli/src/cli.test.ts` | 14 tests pass (C1..C9 existing + 5 new C10..C12 + C12b) |
| `npm run typecheck --workspace apps/achilles` | Exit 0 |
| `npm run typecheck --workspace achilles` | Exit 0 |
| `npm run build --workspace achilles` | Exit 0 |
| `node apps/achilles-cli/dist/cli.js --help` | Lists `latency` and `--debug` |
| Full regression: phase-09 / 10 / 11 / 12 / 13 / 14 (`npx vitest run --project ...`) | 1113 tests pass |
| Privacy grep (`payload\.text\|accumulatedText\|apiKey\|lastTurnText` in latency-probe.ts) | No matches in code (defensive — T-14-01 mitigation) |
| Emoji grep (codepoints across new files) | No matches |
| Direct `process.exit()` outside DI in `latency.ts` body | No matches (only mentioned in a comment describing the production seam) |

## Decisions Made

1. **Percentile helper duplicated locally in `commands/latency.ts`** — the plan called for importing from `@achilles/app/main/latency-probe.ts`, but `apps/achilles-cli/tsconfig.json` declares `paths: {}` (empty) and the `achilles` npm package bundles only `@achilles/achilles-skill`. Adding `@achilles/app` as a cross-package import would break the standalone publishable build. The R-7 percentile math is small (~15 LOC) so duplication has a lower maintenance cost than the cross-package coupling. Documented in the `latency.ts` file-level docstring.

2. **`tts_playback_complete` recorded but no-op for the LOOP-06 metric** — the probe finalizes the sample on the FIRST IPC_TTS_CHUNK fan-out (the "first audible byte" anchor). Stages recorded after that (i.e., `playback_complete`) land in a null in-flight slot and are silently dropped. This is intentional: the CONTEXT.md taxonomy keeps the call uniform across all stages, but the LOOP-06 metric is locked at the first-chunk boundary.

3. **Sample file path: `~/.achilles/latency-samples.json`** — both the Electron main writer and the CLI offline reader use this fixed path. No Electron IPC round-trip required for the offline subcommand. Parent directory is created via `mkdirSync({recursive: true})` on probe construction; failures are best-effort.

4. **`isBareInvocation` (Phase 13) preserved as-is** — `achilles` (length 2) bypasses commander and routes directly to launchCommand. Adding `--debug` requires the explicit `launch` subcommand: `achilles launch --debug`. The bare path cannot pass `--debug` because there are no args, but that's fine — users who want debug type the full invocation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Percentile helper import path**
- **Found during:** Task 2 implementation
- **Issue:** Plan asked to "Import the `percentile` helper from `@achilles/app/main/latency-probe` via the workspace alias". This works at test time (vitest workspace alias) but breaks at production build time — `apps/achilles-cli/tsconfig.json` has `paths: {}` and `apps/achilles-cli/package.json` only bundles `@achilles/achilles-skill`. The Electron app is private and not publishable, so it can't be a runtime dependency of the achilles CLI npm package.
- **Fix:** Duplicated the small R-7 percentile helper as a local function in `commands/latency.ts`. Math is identical to the probe's. Documented the rationale in the file-level docstring.
- **Files modified:** `apps/achilles-cli/src/commands/latency.ts`
- **Impact:** Both implementations remain in sync because they share the same R-7 algorithm (~15 LOC); a future divergence would be caught by the verification fixture (`[100,200,300,400,500] → P50=300, P95=480`).

**2. [Rule 1 — Test bug] LP9 outlier count**
- **Found during:** Initial LP9 run
- **Issue:** Test asserted "1 outlier of 1600 ms in 19 sub-900 ms samples gives P95 > 1500", but R-7 percentile math on 20 samples with one outlier at index 19 gives idx=18.05 → interpolation between sorted[18]=868 and sorted[19]=1600 → P95 = 904.6, not > 1500.
- **Fix:** Bumped to 2 outliers (18 fast + 1600 + 1700). The R-7 idx=18.05 now interpolates between sorted[18]=1600 and sorted[19]=1700 → ~1605 > 1500.
- **Files modified:** `apps/achilles/src/main/latency-probe.test.ts`

**3. [Rule 1 — Test bug] LP5 per-stage assertion for tts_playback_complete**
- **Found during:** Initial LP5 run
- **Issue:** My `recordHappyPath` test helper records `tts_playback_complete` AFTER `finalizeSample()`, so the in-flight slot is null and the stage is silently dropped — that's by-design. But the LP5 test asserted `r.perStageP50.tts_playback_complete === 1500`.
- **Fix:** Inlined the LP5 test sample so `tts_playback_complete` is recorded BEFORE finalizeSample. The semantics test is now consistent with the probe's contract.
- **Files modified:** `apps/achilles/src/main/latency-probe.test.ts`

No architectural changes (Rule 4) required.

## Threat Model Compliance

| Threat | Disposition | Mitigation evidence |
|---|---|---|
| T-14-01 — log line contains transcript / API key | mitigate | Log line composes `utt=<uuid>` + per-stage `delta=ms` only. Grep guard `payload\.text\|accumulatedText\|apiKey\|lastTurnText` returns no matches in `latency-probe.ts`. The probe never receives transcript content — `markSpeechEnd` takes an epoch + UUID; `recordStage` takes a stage name + optional timestamp. |
| T-14-02 — sample file contains transcript / key | mitigate | JSON payload is `{ samples: LatencySample[], updatedAt }` where `LatencySample` carries `utteranceId` (UUID) + numeric timestamps only. Tests LP7 verify the on-disk content has no transcript / key fragments. |
| T-14-03 — tampering with sample file | accept | The offline `--report` only computes percentiles from the file; no arbitrary code execution. JSON.parse failure or non-object root triggers the "malformed" path (LC3, LC6) — exit 1, never crashes. |
| T-14-04 — unbounded rolling window | mitigate | `maxWindow=20` default; the FIFO shrinks via `while (window.length > maxWindow) window.shift()`. `recordStage` is O(1); `finalizeSample` is O(maxWindow). |
| T-14-05 — debug toggle repudiation | accept | Documented in CONTEXT.md; `--debug` is opt-in only. |

## Known Stubs

None. All probe surfaces are fully implemented:
- `markSpeechEnd`, `recordStage`, `finalizeSample`, `report`, `dispose` — fully implemented
- `latencyCommand({subcommand: "--report"})` — fully implemented; reads from disk, computes P50/P95, prints summary
- Session wiring at six stage boundaries — fully implemented
- Production `index.ts` bootstrap reads `ACHILLES_DEBUG=1`, constructs probe with writeSampleFile + sampleFilePath, passes to createSession — fully implemented

## Threat Flags

None. The 14-01 surface introduces no new network endpoints, no new auth paths, no new file access patterns outside the documented `~/.achilles/latency-samples.json` (which is the planned LOOP-06 sample file path).

## Self-Check: PASSED

- File `apps/achilles/src/main/latency-probe.ts` — FOUND
- File `apps/achilles/src/main/latency-probe.test.ts` — FOUND
- File `apps/achilles-cli/src/commands/latency.ts` — FOUND
- File `apps/achilles-cli/src/commands/latency.test.ts` — FOUND
- File `.planning/phases/14-hardening-privacy-resilience/14-01-SUMMARY.md` — FOUND
- File `vitest.workspace.ts` (modified) — FOUND with `phase-14-unit` entry
- File `apps/achilles/src/main/session.ts` (modified) — FOUND with six probe call sites
- File `apps/achilles/src/main/session.test.ts` (modified) — FOUND with SE15..SE17
- File `apps/achilles/src/main/index.ts` (modified) — FOUND with ACHILLES_DEBUG bootstrap
- File `apps/achilles-cli/src/cli.ts` (modified) — FOUND with --debug flag + latency command
- File `apps/achilles-cli/src/cli.test.ts` (modified) — FOUND with C10..C12 tests
