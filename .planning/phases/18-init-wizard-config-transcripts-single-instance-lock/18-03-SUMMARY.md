---
phase: 18-init-wizard-config-transcripts-single-instance-lock
plan: 03
subsystem: init-wizard-surfaces
tags: [init-wizard, transcripts, typed-input, config-menu, latency-report, smoke-test, clack-prompts, jsonl, circuit-breaker, vad]

requires:
  - plan: 18-01
    provides: resolveApiKey + writeApiKey + ApiKeySource; keychain + encrypted-key modules
  - plan: 18-02
    provides: checkPreflight + calibrateAmbient + writeInitMarker + resolveParentEmulator; 7-regex redaction patterns

provides:
  - "wizard.ts: runInitWizard() composing all Plan 01/02 modules into 7 linear @clack/prompts steps"
  - "smoke-test.ts: runSmokeTest() 1-utterance round-trip exercising Phase 17 session (operator-only; tests use sessionFactoryImpl seam)"
  - "transcripts/store.ts: createTranscriptStore() JSONL writer with 7-regex redaction + 0o600 perms"
  - "transcripts/retention.ts: cleanupOldTranscripts() 30-day retention"
  - "transcripts/cli.ts: transcriptsList() + transcriptsPurge() list/purge handlers"
  - "typed-input.ts: createTypedInputFallback() polling circuit-breaker.status() for @clack/prompts.text() fallback"
  - "config-menu.ts: runConfigMenu() interactive settings editor for 4 VAD knobs + 2 booleans"
  - "latency-report.ts: runLatencyReport() thin wrapper around Phase 17 renderLatencyReport"
  - "64 passing unit tests across 8 test files + structured-logger baseline tests still green"

affects:
  - 18-04-cli-extension (dynamic-imports wizard, transcripts, config, latency from Plan 03's exported entry points)

tech-stack:
  added: []
  patterns:
    - "deps-injection seam continued: every new module accepts optional deps object; production defaults are in-module"
    - "Promise.resolve()/Promise.reject() for sync-internally-but-async-typed functions (avoids @typescript-eslint/require-await)"
    - "eslint-disable-next-line for @clack/prompts type casts (necessary runtime cast on dynamic import)"
    - "Manual poll-callback capture in tests (not fake timers) to avoid infinite loop in setInterval-based code"

key-files:
  created:
    - apps/achilles-terminal/src/init/wizard.ts (458 LOC)
    - apps/achilles-terminal/src/init/smoke-test.ts (154 LOC)
    - apps/achilles-terminal/src/transcripts/store.ts (192 LOC)
    - apps/achilles-terminal/src/transcripts/retention.ts (116 LOC)
    - apps/achilles-terminal/src/transcripts/cli.ts (241 LOC)
    - apps/achilles-terminal/src/typed-input.ts (143 LOC)
    - apps/achilles-terminal/src/config-menu.ts (344 LOC)
    - apps/achilles-terminal/src/latency-report.ts (52 LOC)
    - apps/achilles-terminal/tests/init/wizard.test.ts (11 tests)
    - apps/achilles-terminal/tests/init/smoke-test.test.ts (5 tests)
    - apps/achilles-terminal/tests/transcripts/store.test.ts (8 tests)
    - apps/achilles-terminal/tests/transcripts/retention.test.ts (6 tests)
    - apps/achilles-terminal/tests/transcripts/cli.test.ts (7 tests)
    - apps/achilles-terminal/tests/typed-input.test.ts (6 tests)
    - apps/achilles-terminal/tests/config-menu.test.ts (7 tests)
    - apps/achilles-terminal/tests/latency-report.test.ts (3 tests)
  modified:
    - apps/achilles-terminal/src/structured-logger.ts (one-keyword change: `const` -> `export const` on DEFAULT_REDACT_PATTERNS)

key-decisions:
  - "wizard.ts smoke test is OPERATOR-ONLY: fires only when `achilles init` is invoked interactively. Every vitest test uses sessionFactoryImpl injection seam to emit synthetic round-trip events without spawning real audio processes (CLAUDE.md no-auto-running rule)."
  - "transcripts/store.ts copies the applyRedactionsToLine logic inline (doesn't import from structured-logger) to avoid coupling; imports DEFAULT_REDACT_PATTERNS only after the export keyword was added in this plan."
  - "typed-input.ts uses a manual setInterval polling model (not EventEmitter subscription) because the v1.2 circuit-breaker.ts is a pure-functional read model with no events — only .status() is available."
  - "config-menu.ts loop continues until user selects '__save__' or '__cancel__'; language picker deferred to v1.4 per CONTEXT.md deferred block."
  - "latency-report.ts is intentionally minimal (52 LOC) — Phase 17 already shipped the full renderLatencyReport() implementation; this wrapper exists so Plan 04's cli.ts doesn't import Phase 17 internal paths directly."
  - "Test files use () => Promise.resolve(value) instead of async () => value to satisfy @typescript-eslint/require-await when the function body has no await expression."
  - "Manual poll-callback capture pattern in typed-input.test.ts instead of vitest fake timers — vi.runAllTimersAsync() with an open setInterval creates an infinite-loop abort."

requirements-completed: [INIT-01, INIT-04, INIT-05, SAFE-02, ERR-04, ERR-07]

duration: ~8 hours
completed: 2026-06-08T21:10:00Z
---

# Phase 18 Plan 03: Init Wizard + Config + Transcripts + Runtime Surfaces Summary

**Eight user-facing modules composing Wave 1+2 into the init wizard, opt-in JSONL transcripts with 7-regex redaction, STT circuit-open typed fallback, VAD config menu, and the latency report CLI wrapper; 64 passing unit tests with hermetic deps injection on every surface.**

## Performance

- **Duration:** ~8 hours (single executor session with resilient per-module commit cadence)
- **Started:** 2026-06-08T13:30:00Z
- **Completed:** 2026-06-08T21:10:00Z
- **Tasks:** 3 plan tasks (8 TDD RED+GREEN cycles)
- **Files modified:** 18 (16 new + structured-logger.ts one-keyword change + wizard.test.ts)

## Accomplishments

### wizard.ts (458 LOC) + smoke-test.ts (154 LOC)
- `runInitWizard()` composes all Plan 01/02 modules into 7 linear @clack/prompts steps: welcome -> api-key -> preflight -> ambient-calibration -> smoke-test -> summary -> marker
- Idempotent re-run (INIT-05): reads prior init.json for "keep current" defaults
- Summary diff prints changed settings before any write; user must confirm save
- Smoke test (INIT-04) is OPERATOR-ONLY — tests inject `sessionFactoryImpl` seam that emits synthetic `claude_done` + `tts_drained` events; no real session spawned from vitest
- Every prompt goes through injectable deps seams (`promptText`, `promptSelect`, `promptConfirm`, `noteImpl`, `spinnerImpl`) for hermetic test coverage
- T-18-15: summary diff displays `apiKeySource` enum, never key bytes

### transcripts/store.ts (192 LOC)
- `createTranscriptStore(sessionId, deps?)` writes JSONL at `~/.achilles/transcripts/<sid>.jsonl`
- Applies all 7 DEFAULT_REDACT_PATTERNS (including the xi_ Plan 02 7th regex) to `text` + `event` fields before write — T-18-14 mitigation confirmed by test fixture
- Parent dir at 0o700; each file at 0o600 on first append (T-18-19)
- `dispose()` writes `session_end` system entry; subsequent appends are no-ops
- `DEFAULT_REDACT_PATTERNS` now exported from structured-logger.ts (one-keyword change: `const` → `export const`)

### transcripts/retention.ts (116 LOC)
- `cleanupOldTranscripts(days = 30, deps?)` deletes .jsonl files older than threshold
- Returns `{ deletedCount, keptCount }` accurate counts
- Gracefully handles absent directory (returns zeros without throwing)

### transcripts/cli.ts (241 LOC)
- `transcriptsList()` prints filename + first user-line preview (truncated to 80 chars)
- `transcriptsPurge()` presents @clack/prompts.select with 4 options; Delete all / Delete older than 30 days / Delete older than 7 days / Cancel
- NOT wired to cli.ts yet — Plan 04 owns that dynamic-import gate (INIT-07 preserved)

### typed-input.ts (143 LOC)
- `createTypedInputFallback(circuitBreaker, onTyped, deps?)` polls `circuitBreaker.status()` every `pollIntervalMs` (default 1000ms, T-18-17)
- When `status.state === "open"` and no prompt is active, presents `@clack/prompts.text()`
- After `onTyped` resolves, next poll determines whether to re-prompt (breaker still open) or stand down
- `dispose()` clears the poll interval via `clearIntervalImpl`

### config-menu.ts (344 LOC)
- `CONFIGURABLE_FIELDS` (frozen array): 4 VAD knobs (voiceThresholdRatio [1.5-5], voiceHoldMs [20-200], silenceHoldMs [100-1000], minUtteranceMs [100-1000]) + save_transcripts + debug_mode — all with runtime validators
- `runConfigMenu()` reads `~/.achilles/settings.json`, shows select menu with current values, prompts for new value with validator, saves at 0o600 (T-18-18 + T-18-20)
- Preserves unrelated keys on write; cancels cleanly with no writes

### latency-report.ts (52 LOC)
- `runLatencyReport(deps?)` delegates to Phase 17's `renderLatencyReport()` unchanged
- Accepts `dirOverride` seam for hermetic tests (points at tmpdir with synthetic JSON files)
- This module is the Plan 04 dynamic-import target for `achilles latency --report`

## Test Coverage

| Module | Test File | Tests |
|--------|-----------|-------|
| wizard.ts | tests/init/wizard.test.ts | 11 |
| smoke-test.ts | tests/init/smoke-test.test.ts | 5 |
| transcripts/store.ts | tests/transcripts/store.test.ts | 8 |
| transcripts/retention.ts | tests/transcripts/retention.test.ts | 6 |
| transcripts/cli.ts | tests/transcripts/cli.test.ts | 7 |
| typed-input.ts | tests/typed-input.test.ts | 6 |
| config-menu.ts | tests/config-menu.test.ts | 7 |
| latency-report.ts | tests/latency-report.test.ts | 3 |
| **Total** | | **53 new** |

Plus structured-logger.ts baseline tests (11 cases) verified still green = 64 total passing.

## Task Commits

Each module was committed atomically with TDD RED -> GREEN gates:

1. **test(18-03):** TranscriptStore tests (RED) - `12803c02`
2. **feat(18-03):** TranscriptStore + structured-logger export (GREEN) - `af593fbd`
3. **test(18-03):** retention tests (RED) - `94bbbeab`
4. **feat(18-03):** cleanupOldTranscripts (GREEN) - `fa19b0b7`
5. **test(18-03):** transcriptsList/Purge tests (RED) - `6fd6733e`
6. **feat(18-03):** transcripts/cli.ts (GREEN) - `289edb9e`
7. **test(18-03):** createTypedInputFallback tests (RED) - `8d1a7ef9`
8. **feat(18-03):** typed-input.ts (GREEN) - `fbf61cac`
9. **test(18-03):** runConfigMenu tests (RED) - `c828c6b7`
10. **feat(18-03):** config-menu.ts (GREEN) - `fd1456f5`
11. **test(18-03):** runLatencyReport tests (RED) - `06787e13`
12. **feat(18-03):** latency-report.ts (GREEN) - `2487f058`
13. **test(18-03):** runSmokeTest tests (RED) - `551b8406`
14. **feat(18-03):** smoke-test.ts (GREEN) - `48ac61af`
15. **test(18-03):** runInitWizard tests (RED) - `4298a5ab`
16. **feat(18-03):** wizard.ts (GREEN) - `87a066c6`
17. **fix(18-03):** resolve lint errors - `a47cb8b9`

## Invariants Preserved

- **INIT-07:** cli.ts NOT touched; Plan 04 owns the dynamic-import wiring
- **LOOP-02:** zero changes to packages/voice-*, claude-code-bridge, or companion.md
- **Phase 17 internals untouched:** session.ts, latency-probe.ts, circuit-breaker.ts, graceful-shutdown.ts byte-for-byte unchanged
- **CLAUDE.md no-auto-running:** smoke-test.ts is NEVER called from vitest; all 5 smoke-test tests use sessionFactoryImpl seam
- **DEFAULT_REDACT_PATTERNS 7-regex array:** byte-for-byte intact; only added `export` keyword before `const`

## Confirmations Required by Plan Output Spec

1. **Wizard smoke test ONLY from wizard (never from vitest):** Confirmed. `tests/init/smoke-test.test.ts` injects `sessionFactoryImpl` on every test case. Search `grep -r "runSmokeTest\b" tests/` returns only injection-seam usages.

2. **Transcripts redaction covers xi_ Plan 02 7th regex (fixture proof):** Confirmed. `tests/transcripts/store.test.ts` test "apply the xi_-prefix redaction (Plan 02 7th regex) to text" uses fixture key `xi_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890aBcDeF` (44 chars after xi_; passes the >= 40 threshold) and asserts it does NOT appear in the written JSONL file.

3. **runConfigMenu validators reject out-of-range VAD values:** Confirmed. `tests/config-menu.test.ts` "CONFIGURABLE_FIELDS validator for voiceThresholdRatio rejects 6 (out of range)" asserts `validator(6)` returns a non-null error string.

4. **runLatencyReport delegates to Phase 17 unchanged (one-line wrapper):** Confirmed. `src/latency-report.ts` is 52 LOC; the implementation body is 2 lines: `const dir = deps.dirOverride ?? LATENCY_DIR; return renderLatencyReport(dir);`. Phase 17's `latency-probe.ts` is byte-for-byte unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test timing: vitest fake timers + active setInterval = infinite loop abort**
- **Found during:** typed-input.ts test GREEN phase
- **Issue:** `vi.runAllTimersAsync()` with an open `setInterval` fires the callback repeatedly until vitest aborts with "Aborting after running 10000 timers, assuming an infinite loop!"
- **Fix:** Replaced fake-timer approach with manual poll-callback capture: `setIntervalImpl` stores the callback reference; tests call `fire()` which invokes the callback once and awaits `Promise.resolve()` 20 times to drain microtask queue
- **Files modified:** tests/typed-input.test.ts
- **Commit:** a47cb8b9 (bundled with lint fixes)

**2. [Rule 1 - Bug] `require-await` lint errors on synchronous-body async functions**
- **Found during:** lint clean pass
- **Issue:** Functions declared `async` but using only synchronous operations triggered `@typescript-eslint/require-await`. Pattern: `transcriptsList`, `cleanupOldTranscripts`, test `async () => value` callbacks.
- **Fix:** Removed `async` keyword; added explicit `return Promise.resolve(value)` to maintain the async interface contract. Test callbacks changed to `() => Promise.resolve(value)`. Matches Pattern established in Plan 01 (encrypted-key.ts).
- **Files modified:** src/transcripts/retention.ts, src/transcripts/cli.ts, all test files
- **Commit:** a47cb8b9

**3. [Rule 1 - Bug] `no-unnecessary-type-assertion` on @clack/prompts return casts**
- **Found during:** lint clean pass
- **Issue:** `clack.text({ message: msg }) as unknown as Promise<string | symbol>` flagged. ESLint rule fires on intermediate `unknown` casts.
- **Fix:** Added `// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion` on the expression line for all @clack/prompts casts in wizard.ts, typed-input.ts, config-menu.ts, transcripts/cli.ts
- **Commit:** a47cb8b9

**4. [Rule 1 - Bug] wizard.test.ts confirmation call count off by one (env-keep confirm comes first)**
- **Found during:** wizard.ts GREEN phase (first test run)
- **Issue:** Test expected save-summary confirm at call #2, but with `source="env"` the flow is: (1) keep-env confirm, (2) run-smoke-test confirm, (3) save-summary confirm. Test was using count=2 not count=3.
- **Fix:** Updated the confirm call counter from 2 to 3 in both failing wizard tests.
- **Files modified:** tests/init/wizard.test.ts
- **Commit:** a47cb8b9

**Total deviations:** 4 auto-fixed (4x Rule 1 bugs)

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: T-18-14 (mitigated) | src/transcripts/store.ts | API key typed via typed-input flows through append() — all 7 DEFAULT_REDACT_PATTERNS applied before write |
| threat_flag: T-18-15 (mitigated) | src/init/wizard.ts | Summary diff shows apiKeySource enum + "key is set", never key bytes |
| threat_flag: T-18-17 (mitigated) | src/typed-input.ts | pollIntervalMs defaults to 1000ms; configurable but not below 100ms |
| threat_flag: T-18-18 (mitigated) | src/config-menu.ts | settings.json written at 0o600 + explicit chmodSync |
| threat_flag: T-18-19 (mitigated) | src/transcripts/store.ts | transcripts/ dir at 0o700; each file at 0o600 |
| threat_flag: T-18-20 (mitigated) | src/config-menu.ts | Validators are runtime functions; reject out-of-range values before write |

## Known Stubs

None. All modules have real implementations wired to Phase 17/18 infrastructure. The `PACKAGE_VERSION` constant in wizard.ts is hardcoded to "1.3.0" (matching package.json); Phase 19's publish step would derive this dynamically.

## Self-Check: PASSED

All 8 source files exist on disk. All 17 commits verified in git log. 64 tests passing. Lint clean on all new files.
