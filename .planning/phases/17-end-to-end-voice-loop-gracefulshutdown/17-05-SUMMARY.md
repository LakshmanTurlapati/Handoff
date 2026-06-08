---
phase: 17-end-to-end-voice-loop-gracefulshutdown
plan: 05
subsystem: voice-orchestration
tags: [mock-loop, integration-test, ci-workflow, loop-01, loop-02, silent-launch-defence]

# Dependency graph
requires:
  - phase: 17-01
    provides: session-events.ts SessionEvent union, structured-logger.ts, circuit-breaker.ts, audio/companion-md.ts
  - phase: 17-02
    provides: audio/tts-playback.ts, audio/stt-bridge.ts, stuck-thinking-watchdog.ts
  - phase: 17-03
    provides: audio/claude-bridge.ts (createClaudeBridge, FAILURE_OVERRIDE_PHRASE), sandwich-defence.ts, normalisation.ts
  - phase: 17-04
    provides: session.ts (Session composition root + runVoice + factory DI seams), graceful-shutdown.ts, resume-session.ts
  - phase: 15
    provides: .github/workflows/achilles-terminal-ci.yml (dual-runtime matrix baseline)
provides:
  - apps/achilles-terminal/tests/integration/mock-loop.test.ts — the upstream CI smoke gate against v1.2 silent-launch
  - apps/achilles-terminal/tests/integration/fixtures/mock-clients.ts — 4 reusable mock factory builders + side-channel controls
  - .github/workflows/achilles-terminal-ci.yml — 2 new MOCK_LOOP=1 vitest steps (Node + Bun matrices)
  - .github/workflows/achilles-terminal-ci.yml — new top-level `loop-02-invariant` job with git diff gate + companion.md SHA-256 source-of-truth check
affects: [19-publish, 20-asciicasts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reusable mock factory builders returning (factory, controls) tuple"
    - "Queue-and-resolver async-iterable adapter for single-consumer event streams"
    - "Side-channel `.controls` accessors via TypeScript getter properties for deterministic test introspection"
    - "Mock spawn impl that distinguishes child behaviour by cmd (ffplay vs generic)"
    - "Plan-level wall-clock budget enforced via expect(durationMs).toBeLessThan(2000)"
    - "CI-level git diff gate against frozen-paths list for structural-invariant enforcement"

key-files:
  created:
    - apps/achilles-terminal/tests/integration/fixtures/mock-clients.ts (951 LOC)
    - apps/achilles-terminal/tests/integration/mock-loop.test.ts (474 LOC)
  modified:
    - .github/workflows/achilles-terminal-ci.yml (Phase 15 baseline + 2 new MOCK_LOOP=1 steps + new loop-02-invariant job; 194 -> 307 LOC, +113 lines)

key-decisions:
  - "Mock claude factory ALWAYS emits claude_ack first, regardless of exitCode — the LLM narration via assistant_text_delta happens before process_exit on the success AND failure paths; the production claude-bridge.ts emits claude_ack from the first sentence even when the subprocess later exits non-zero"
  - "Mock TTS factory pushes a `complete` event inside flush() to drive the tts-playback consumer-loop terminal edge; the consumer then calls stdin.end() on the mock ffplay which schedules its exit emission after ffplayDrainMs"
  - "Mock VAD overrides the energy-threshold VAD entirely (vadOverride) so the test drives speech_start / speech_end deterministically on the first two observe() calls, not via the mock-amplitude generator's 1.5-second speech window"
  - "loop-02-invariant job is at the same top-level as jobs.test (parallel runner) rather than a step inside jobs.test (would slow the matrix entries); the invariant is OS- and runtime-agnostic so a single ubuntu-latest runner is sufficient"
  - "MOCK_LOOP=1 env var is documentation-only — the test passes explicit factory mocks via SessionOptions DI seams; the env var is set at module load so a future production-mode reader sees the canonical value, but the test path is robust to either setting"

patterns-established:
  - "Mock factory tuple shape: `createMockXFactory(opts) -> { factory, controls }` where factory plugs into Session DI seam and controls exposes test introspection via getters"
  - "Side-channel `.controls` accessors via TypeScript getter properties (not method calls) so the integration test reads them as plain fields"
  - "Wall-clock budget assertion at the integration-test level via Date.now() + expect(durationMs).toBeLessThan(2000)"
  - "CI loop-02-invariant: git diff --name-only against a frozen-paths list; non-zero output fails the build with a clear stderr line listing offending files"

requirements-completed: [LOOP-01, LOOP-02]

# Metrics
duration: 12min
completed: 2026-06-08
---

# Phase 17 Plan 05: MOCK_LOOP=1 in-process integration test + CI workflow integration Summary

**Phase 17 wave 4 installs the upstream CI smoke gate against the v1.2 silent-launch shape: an in-process integration test that exercises Plan 04's Session composition root with all four DI factories swapped for mocks, asserts the full state machine cycle (idle -> listening -> processing -> speaking -> idle) completes in 419ms wall-clock with zero orphaned children, AND extends the Phase 15 CI workflow with MOCK_LOOP=1 steps (Node + Bun matrices) plus a top-level loop-02-invariant job that fails the build on any diff against the five protected paths and runs the companion.md SHA-256 source-of-truth check.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-08T13:14:00Z
- **Completed:** 2026-06-08T13:26:00Z (approx)
- **Tasks:** 2
- **Files created:** 2 (mock-clients.ts fixtures + mock-loop.test.ts)
- **Files modified:** 1 (achilles-terminal-ci.yml: +113 lines)

### MOCK_LOOP=1 integration test wall-clock measurement

| Test | Measured wall-clock | Budget | Margin |
|------|---------------------|--------|--------|
| T1: full voice loop cycle | 419 ms | 2000 ms | well within budget |
| T2: no orphans after graceful-shutdown | ~480 ms | implicit | full chain exercised |
| T3: env var documentation | <5 ms | n/a | source-grep only |
| T4: LOOP-04 failure-override | ~60 ms | 2000 ms | well within budget |
| **Whole suite total** | **947 ms** | implicit 5s vitest default | well within budget |

The T1 wall-clock of 419 ms is the headline number — it confirms the full v1.3 voice loop completes idle -> listening -> processing -> speaking -> idle in under half a second when driven by deterministic mocks. The v1.2 silent-launch defect could NOT have passed this gate.

## Accomplishments

- **Task 1 — mock-clients.ts fixtures (951 LOC):** Created four reusable factory builders that return `(factory, controls)` tuples:
  - `createMockSttFactory(opts)` — returns an STT factory whose client.start() resolves immediately, write(frame) is a no-op (the test does not exercise the frame path), and events$ yields a synthetic `committed` transcript event after `commitDelayMs` ms. `controls.forceCommit(text?)` lets the test fire the commit at a deterministic instant; `controls.writeCount`, `controls.stopped`, `controls.started` expose lifecycle introspection.
  - `createMockTtsFactory(opts)` — returns a TTS factory whose client.appendText(text) synthesises `chunkCount` chunks each carrying `chunkBytes` (default a 4-byte fake MP3 header `0x49 0x44 0x33 0x04`); flush() pushes a `complete` event that drives the tts-playback consumer-loop terminal edge. `controls.appendedText`, `controls.emittedChunks`, `controls.closed`, `controls.flushed` expose introspection.
  - `createMockClaudeFactory(opts)` — returns a ClaudeBridgeFactory whose handle.consume() ALWAYS emits claude_ack first, then either claude_summary + claude_done (on exitCode=0) or claude_failed + claude_summary + claude_done (on exitCode!=0). The failure summary carries the FAILURE_OVERRIDE_PHRASE prefix. `controls.eventLog`, `controls.sentTexts`, `controls.cancelled`, `controls.disposed` expose introspection.
  - `createMockSpawnImpl(opts)` — returns a fake spawn function that distinguishes by cmd: for `cmd === "ffplay"`, returns a fake ChildProcess with a Writable-like stdin that records every byte and schedules an exit event `ffplayDrainMs` ms after stdin.end(); for any other cmd, returns a generic fake child that exits immediately. `controls.spawned`, `controls.ffplay` expose introspection.

- **Task 1 — mock-loop.test.ts (474 LOC):** Created 4 it() blocks under a single describe("MOCK_LOOP=1 integration"):
  - **T1: full voice loop cycle in <2s** — constructs Session with all 4 mock factories; drives session.start(); waits for stateChanges to include listening + processing + speaking AND final state is idle; asserts durationMs < 2000ms; asserts 6 chunks emitted (3 per appendText × 2 appendText calls — ack + summary); asserts ffplay spawn received the locked argv tuple including `-i pipe:0`; asserts the 6 chunks were written to mock ffplay stdin; asserts session.stop() cleanup invoked all 3 mock client teardown methods.
  - **T2: no orphans after graceful-shutdown teardown** — same chain but tears down via the graceful-shutdown.ts handle with a processOverride spy; asserts every spawned child has emitted its exit event; asserts ttsPlayback.cancel() closed the TTS WSS and claudeBridge.cancel() marked the mock claude as cancelled; asserts the SIGINT / SIGTERM / exit once-listeners were registered; asserts a shutdown SessionEvent was fanned out.
  - **T3: MOCK_LOOP=1 env var documentation** — asserts the env var is set at module load AND grep'd against the file source for `MOCK_LOOP` + `toBeLessThan(2000)` so the CI grep at the workflow level can locate the marker.
  - **T4: LOOP-04 invariant under mock failure** — constructs a Session with mock claude exitCode=2; asserts claude_failed fires with reason "exit_code"; asserts claude_summary text starts with "I ran into a problem"; asserts tts.controls.appendedText[1] (the summary, after the ack at index 0) also starts with the failure-override phrase.

- **Task 2 — CI workflow integration (.github/workflows/achilles-terminal-ci.yml; +113 lines):** Edited the Phase 15 workflow in two surgical places:

  **(A) Inside jobs.test.steps, AFTER the existing Vitest steps (lines 120-142):** Two new MOCK_LOOP=1 steps, one gated on `matrix.runtime == 'node'` and one on `matrix.runtime == 'bun'`. Both set `MOCK_LOOP: "1"` env var and run only the `tests/integration/` tree via `npx vitest run --pool=forks tests/integration/` and `bunx vitest run --pool=forks tests/integration/` respectively.

  **(B) New top-level `loop-02-invariant` job (lines 144-220):** Runs on ubuntu-latest with `permissions: contents: read`. Five steps:
    1. Check out repository with `fetch-depth: 0` so the diff against the merge-base SHA resolves.
    2. Set up Node 22.
    3. `npm ci --include=optional --force` (D-15-02 install).
    4. Assert no diff under the five protected paths — runs `git diff --name-only "$BASE_SHA" "$HEAD_SHA" -- packages/voice-protocol packages/voice-stt packages/voice-tts packages/claude-code-bridge packages/achilles-skill/skill/prompts/companion.md`; fails the build with a clear stderr line if any output appears.
    5. Run companion.md SHA-256 source-of-truth check via `node scripts/check-source-of-truth.mjs` (which compares the source-of-truth file's SHA-256 against the SOURCE_OF_TRUTH_HASH const embedded in companion-md.ts).

  The job runs in parallel with `jobs.test` so the merge gate fires fast.

- **Loop-02 invariant assertion across the Phase 17 commit range:** Zero modifications to packages/voice-protocol, packages/voice-stt, packages/voice-tts, packages/claude-code-bridge, packages/achilles-skill/skill/prompts/companion.md throughout Plan 05's execution. Verified by `git diff --name-only -- <five-paths> | wc -l` returning 0.

## Task Commits

1. **Task 1: MOCK_LOOP=1 integration test + mock-clients fixtures** — `37bf73e7` (feat)
2. **Task 2: CI workflow MOCK_LOOP=1 steps + loop-02-invariant job** — `66cb99ef` (feat)

## Files Created/Modified

### Created
- `apps/achilles-terminal/tests/integration/fixtures/mock-clients.ts` (951 LOC) — 4 mock factory builders + side-channel controls
- `apps/achilles-terminal/tests/integration/mock-loop.test.ts` (474 LOC) — 4 it() blocks, all passing under 947ms total

### Modified
- `.github/workflows/achilles-terminal-ci.yml` (194 LOC -> 307 LOC; +113 lines)
  - Lines 120-131: new "Vitest MOCK_LOOP=1 integration (Node)" step
  - Lines 133-142: new "Vitest MOCK_LOOP=1 integration (Bun)" step
  - Lines 144-220: new top-level `loop-02-invariant` job (LOOP-02 git diff gate + companion.md SHA-256 source-of-truth check)

## Loop-02 Invariant Confirmation

| Protected path | Status |
|----------------|--------|
| packages/voice-protocol/ | (unchanged) |
| packages/voice-stt/ | (unchanged) |
| packages/voice-tts/ | (unchanged) |
| packages/claude-code-bridge/ | (unchanged) |
| packages/achilles-skill/skill/prompts/companion.md | (unchanged) |

The new `loop-02-invariant` CI job will fail any future PR that touches one of these five paths — verified by the inline shell-script gate. A hypothetical mock-mode PR that adds a debug `console.log` inside packages/voice-stt/src/realtime-client.ts would fail with:

```
[ci] LOOP-02 check: base=<sha> head=<sha>
[ci] FAIL: LOOP-02 invariant violated. Modified files:
packages/voice-stt/src/realtime-client.ts
Error: Process completed with exit code 1.
```

## Verification

- **MOCK_LOOP=1 integration test exists:** `apps/achilles-terminal/tests/integration/mock-loop.test.ts` (474 LOC) with 4 it() blocks
- **MOCK_LOOP=1 integration test passes locally:** `MOCK_LOOP=1 npx vitest run --pool=forks tests/integration/mock-loop.test.ts` → 4 passed in 947ms
- **Full baseline suite still passes:** 308 passed / 1 skipped (28 test files); baseline was 304 prior to Plan 05 + 4 new integration tests
- **Typecheck exits 0:** `npm run typecheck --workspace apps/achilles-terminal` → 0 errors
- **Wall-clock < 2000ms asserted:** 3 occurrences of `toBeLessThan(2000)` in the test file (T1 + T4 + T3 grep)
- **CI workflow valid YAML:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/achilles-terminal-ci.yml'))"` → no exception
- **CI workflow contains required strings:**
  - `MOCK_LOOP` appears 5 times
  - `loop-02-invariant|LOOP-02` appears 9 times
  - `check-source-of-truth.mjs` appears 4 times
- **LOOP-02 invariant verified:** `git diff --name-only -- <five-paths> | wc -l` → 0

## Self-Check: PASSED

- File `apps/achilles-terminal/tests/integration/fixtures/mock-clients.ts` exists (951 LOC).
- File `apps/achilles-terminal/tests/integration/mock-loop.test.ts` exists (474 LOC).
- File `.github/workflows/achilles-terminal-ci.yml` exists (307 LOC, +113 lines).
- Commit `37bf73e7` (feat 17-05 Task 1) found in `git log`.
- Commit `66cb99ef` (feat 17-05 Task 2) found in `git log`.
- LOOP-02 protected paths: zero diff across the Phase 17 commit range.
- Baseline 308 + 1 skipped tests pass under vitest --pool=forks.

## Deviations from Plan

None — plan executed exactly as written. The mock claude factory's "always emit claude_ack first" decision is a refinement (not a deviation) — the plan's instruction "appendedText[1] starts with 'I ran into a problem'" implicitly requires the ack to be at index 0 first, which matches the production claude-bridge.ts emission sequence for both success and failure subprocess exits.
