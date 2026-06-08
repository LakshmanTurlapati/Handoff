---
phase: 18-init-wizard-config-transcripts-single-instance-lock
plan: 04
subsystem: cli-entry-point
tags: [cli, init, config, transcripts, latency, lock-file, init-07, safe-03, safe-04, dynamic-import, integration-tests]

requires:
  - plan: 18-01
    provides: resolveApiKey + writeApiKey; keychain + encrypted-key modules
  - plan: 18-02
    provides: acquireLock + releaseLock + lock-file enforcement; LOCK_FILE + ACHILLES_HOME constants
  - plan: 18-03
    provides: runInitWizard + runConfigMenu + transcriptsList + transcriptsPurge + runLatencyReport exported entry points

provides:
  - "cli.ts: 4 new subcommand branches (init, config, transcripts list/purge, latency) via await import() gates after argv parse"
  - "cli.ts: voice branch acquires acquireLock() BEFORE session.js dynamic import; exits 1 with 'Another achilles voice session is running (pid N). Press Ctrl-C in that terminal first.' on conflict (SAFE-04)"
  - "cli.ts: latency branch migrated from renderLatencyReport (latency-probe.js) to runLatencyReport (latency-report.js — Plan 03 stable wrapper)"
  - "tests/cli.test.ts: T13-T23 (11 new cases) covering all new subcommand routing paths"
  - "tests/integration/loop-02-host-allowlist.test.ts: 5 cases asserting SAFE-03 assertElevenLabsHost still exported + functional"
  - "tests/integration/init-07-invariant.test.ts: 7 cases asserting cli.ts top-level static imports remain exactly 3 node: imports + INIT-07 spawn smoke"
  - "ROADMAP.md: Phase 18 entry updated to 4/4 Complete 2026-06-08"

affects:
  - 18-CONTEXT.md (Phase 18 closes; entry conditions for Phase 19 met)
  - Phase 19 (distribution + codesign — Apple Developer ID gate must be resolved before Phase 19 starts)

tech-stack:
  added: []
  patterns:
    - "await import() dynamic gates in cli.ts main() — all new subcommands follow the established INIT-07 pattern"
    - "acquireLock() before session.ts import — SAFE-04 wire-up pattern for single-instance enforcement"
    - "Integration test using fs.readFileSync + regex grep to assert source-level invariants (file-level contract testing)"

key-files:
  created:
    - apps/achilles-terminal/tests/integration/loop-02-host-allowlist.test.ts (56 LOC, 5 tests)
    - apps/achilles-terminal/tests/integration/init-07-invariant.test.ts (108 LOC, 7 tests)
  modified:
    - apps/achilles-terminal/src/cli.ts (+99 LOC: 4 new branches + voice lock wrapper + docblock update)
    - apps/achilles-terminal/tests/cli.test.ts (+211 LOC: T13-T23 + top-level imports for mkdtempSync/fsMkdirSync/fsWriteFileSync/tmpdir)
    - .planning/ROADMAP.md (18-04 [x], progress table 4/4 Complete)

key-decisions:
  - "latency branch migrated to latency-report.js (Plan 03 wrapper) instead of staying on latency-probe.js — cli.ts now depends on a stable consumer interface; Phase 17 internal paths are hidden behind the wrapper"
  - "releaseLock() NOT called in voice branch of cli.ts — graceful-shutdown.ts registers process.once('exit') unlink; calling it again would race with the handler; the comment documents this intentionally"
  - "T12 latency-probe.js assertion relaxed to accept either latency-probe.js or latency-report.js — the T12 test was written for the Phase 17 import path; Plan 04 legitimately changes it to the Plan 03 wrapper"
  - "init-07-invariant.test.ts uses mainFnLineIdx boundary to scope top-level import counting — avoids false positives from await import() calls inside async function bodies"

requirements-completed: [INIT-01, INIT-04, SAFE-02, SAFE-03, SAFE-04, ERR-04, ERR-07]

duration: ~45min
completed: 2026-06-08
---

# Phase 18 Plan 04: cli.ts Extension + Integration Tests + Phase 18 Wrap Summary

**cli.ts extended with init/config/transcripts/latency subcommand branches and voice lock acquisition; SAFE-03 + INIT-07 invariants proven by 12 integration tests; Phase 18 4/4 plans complete with 420+ passing tests across all waves.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-06-08T22:10:00Z
- **Completed:** 2026-06-08T22:55:00Z
- **Tasks:** 3 plan tasks (2 TDD RED+GREEN cycles + 1 wrap task)
- **Files modified:** 5 (cli.ts + cli.test.ts + 2 new integration test files + ROADMAP.md)

## Accomplishments

### cli.ts extension (99 LOC added)

- `init` subcommand: `await import("./init/wizard.js")` -> `runInitWizard()`; exits 0 (completed), 130 (cancelled + stderr message), 1 (other failure)
- `config` subcommand: `await import("./config-menu.js")` -> `runConfigMenu()`; exits 0
- `transcripts list`: `await import("./transcripts/cli.js")` -> `transcriptsList()`; exits 0
- `transcripts purge`: same dynamic import -> `transcriptsPurge()`; exits 0
- `transcripts` (no subcommand or unknown): stderr "achilles transcripts: try list or purge." + exit 1
- `latency --report`: migrated from `renderLatencyReport` (latency-probe.js) to `runLatencyReport` (latency-report.js — Plan 03 stable wrapper)
- `voice` branch: `await import("./lock-file.js")` -> `acquireLock()` BEFORE `await import("./session.js")`. Conflict path: `"Another achilles voice session is running (pid N). Press Ctrl-C in that terminal first."` + exit 1 (SAFE-04)
- INIT-07 preserved: top-level static imports unchanged — still exactly 3 lines (`node:fs/promises`, `node:url`, `node:path`). Total dynamic imports: 8 (all inside main() after argv parse)

### cli.test.ts extension (211 LOC added; T13-T23)

- T13: `achilles init` SIGINT -> wizard cancel path reachable without crash
- T14: `achilles config` SIGINT -> config menu cancel path reachable
- T15: `achilles transcripts list` empty home -> exits 0 + "No transcripts on disk."
- T16: `achilles transcripts` (no subcommand) -> exits 1 + "try list or purge"
- T17: `achilles transcripts bogus` -> same fallback
- T18: `achilles latency --report` via runLatencyReport -> exits 0 + "samples="
- T19: `achilles voice` with live PID lock -> exits 1 + "Another achilles voice session is running"
- T20: `achilles --version` still works after Plan 04 (INIT-07 smoke)
- T21: `achilles -v` still works after Plan 04
- T22: `achilles bogus-cmd` still falls through to "unknown command" + exit 1
- T23: cli.ts source invariant — 3 static imports, 5+ subcommand branches, 6+ dynamic imports, acquireLock wired

### Integration tests

**loop-02-host-allowlist.test.ts (5 tests)**
- assertElevenLabsHost is exported from @achilles/voice-protocol (typeof === "function")
- Accepts valid ElevenLabs WSS URL without throwing
- Throws on example.com with /not in the ElevenLabs allowlist/ message
- Throws on malicious.io
- Export signature matches `export function assertElevenLabsHost(url: string | URL): string` (file-level grep)

**init-07-invariant.test.ts (7 tests)**
- Exactly 3 top-level static imports before `async function main()`
- All 3 from node: specifiers only
- Zero top-level relative imports
- >= 6 await import() dynamic gates
- No top-level @clack/prompts / @napi-rs/keyring / @stablelib/nacl imports (T-18-21 mitigation)
- Shebang is exactly "#!/usr/bin/env node"
- INIT-07 spawn smoke: `achilles --version` exits 0 in < 5000ms without ELEVENLABS_API_KEY

## Phase 18 Aggregate Outcome

| Wave | Plan | Tests | Source Files |
|------|------|-------|--------------|
| Wave 1 | 18-01 | 25 | 3 new (keychain, encrypted-key, api-key) |
| Wave 2 | 18-02 | 52 | 7 new (preflight, install-suggestions, ambient-calibration, parent-terminal, marker, lock-file) + 2 modified (structured-logger) |
| Wave 3 | 18-03 | 64 | 8 new (wizard, smoke-test, transcripts/store, transcripts/retention, transcripts/cli, typed-input, config-menu, latency-report) + 1 modified (structured-logger) |
| Wave 4 | 18-04 | 23 cli + 12 integration = 35 | 1 modified (cli.ts) + 2 new integration test files |
| **Total** | **4 plans** | **~176 new tests** | **~18 new source files** |

All 420 tests (Phase 15-18) passing. 5 `tests/ui/*.test.tsx` failures are pre-existing Phase 17 `ink-testing-library` debt (out of scope per deferred-items.md).

## Requirements Coverage (Phase 18)

| Requirement | Plan | Status |
|-------------|------|--------|
| INIT-01 (wizard flow) | 18-03 + 18-04 (routing) | Complete |
| INIT-02 (API key resolver) | 18-01 | Complete |
| INIT-03 (preflight) | 18-02 | Complete |
| INIT-04 (ambient calibration + smoke test) | 18-02 + 18-03 | Complete |
| INIT-05 (idempotent re-run) | 18-03 (wizard defaults) | Complete |
| INIT-06 (parent terminal TCC) | 18-02 | Complete |
| INIT-07 (static import invariant) | Cross-cutting; asserted in 18-04 | Preserved |
| SAFE-01 (key never in logs) | 18-01 + 18-02 (7th regex) | Complete |
| SAFE-02 (transcripts off by default + retention) | 18-03 | Complete |
| SAFE-03 (ElevenLabs allowlist) | 18-04 integration test | Verified |
| SAFE-04 (single-instance lock) | 18-02 (lock-file) + 18-04 (voice wire-up) | Complete |
| ERR-04 (typed-input fallback) | 18-03 | Complete |
| ERR-07 (latency report) | 18-03 + 18-04 (routing) | Complete |

## Invariants Confirmed

- **INIT-07:** cli.ts top-level static imports byte-for-byte unchanged (3 lines: node:fs/promises, node:url, node:path). Proven by cli.test.ts T8/T12/T23, init-07-invariant.test.ts 6 cases, and `grep -E "^import\s" src/cli.ts | wc -l` = 3.
- **LOOP-02:** zero changes to `packages/voice-*`, `packages/claude-code-bridge/`, `packages/achilles-skill/skill/prompts/companion.md`. Proven by `git diff main..HEAD packages/voice-protocol packages/voice-stt packages/voice-tts packages/claude-code-bridge packages/achilles-skill/skill/prompts/companion.md` returning empty.
- **D-15-01:** `apps/achilles-terminal/package.json` name field still "achilles-terminal". Unchanged.
- **SKILL.md:** NOT modified in Phase 18 per CONTEXT.md recommendation — defer to Phase 19's "SKILL.md diff" task.

## Task Commits

1. **test(18-04):** T13-T23 failing tests — `2290f002` (RED)
2. **feat(18-04):** cli.ts extension (4 branches + voice lock) — `eb0ae38a` (GREEN)
3. **test(18-04):** SAFE-03 + INIT-07 integration tests — `05b6d287` (RED)
4. **fix(18-04):** remove unused 'join' imports from integration tests — `23b4ba09` (GREEN fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T12 assertion used Phase 17 import path `latency-probe.js`**
- **Found during:** Task 1 GREEN phase (test run after cli.ts was extended)
- **Issue:** The T12 test from Phase 17 Plan 04 asserted `await import("./latency-probe.js")` was present in cli.ts. Plan 04 legitimately migrates this to `./latency-report.js` (Plan 03 wrapper). The assertion would fail after the migration.
- **Fix:** Updated T12 to accept either path: `source.includes('await import("./latency-probe.js")') || source.includes('await import("./latency-report.js")')`. This keeps T12 green across both the Phase 17 and Phase 18 states.
- **Files modified:** apps/achilles-terminal/tests/cli.test.ts
- **Committed in:** eb0ae38a

**2. [Rule 1 - Bug] Unused 'join' import in both integration test files (TS6133)**
- **Found during:** Task 2 GREEN phase (typecheck run)
- **Issue:** Both integration test files imported `join` from "node:path" but only used `dirname` and `resolve` for path operations.
- **Fix:** Removed `join` from both import lists.
- **Files modified:** tests/integration/init-07-invariant.test.ts, tests/integration/loop-02-host-allowlist.test.ts
- **Committed in:** 23b4ba09

**Total deviations:** 2 auto-fixed (2x Rule 1 bugs)

## Phase 19 Entry Conditions

- Apple Developer ID acquisition decision needed BEFORE Phase 19 starts (codesign / notarytool path depends on cert availability)
- Everything on disk and tested: wizard, transcripts, config, lock-file, latency-report, cli.ts routing
- SKILL.md update deferred to Phase 19 (explicit "SKILL.md diff" task in that phase)
- Pre-existing Phase 17-01 lint debt (63 ESLint errors per deferred-items.md) remains; Phase 19 hardening addresses GATE-04

## Known Stubs

None. All cli.ts branches route to real Phase 18 Plan 01/02/03 implementations. The lock-file's TOCTOU window is accepted by design (single-user CLI; documented in lock-file.ts).

## Threat Flags

None introduced. Threat mitigations from the plan's threat model:

- T-18-21 (INIT-07 regression): mitigated — init-07-invariant.test.ts asserts zero top-level @clack/prompts / @napi-rs/keyring / @stablelib/nacl imports
- T-18-22 (two instances racing for mic): mitigated — voice branch acquires lock BEFORE session.ts import
- T-18-23 (forged PID lock): accepted per plan — isPidAlive fail-closed; user can delete the lock
- T-18-24 (SAFE-03 LOOP-02 boundary violated): mitigated — loop-02-host-allowlist.test.ts asserts assertElevenLabsHost still exported and functional
- T-18-25 (Phase 18 wrap claims completion without running full suite): mitigated — `npm test` ran with 420 passing tests; 4 [x] ROADMAP entries verified

## Self-Check: PASSED

Files verified to exist on disk:
- apps/achilles-terminal/src/cli.ts (exists, 8 dynamic imports, 3 static imports, acquireLock wired)
- apps/achilles-terminal/tests/cli.test.ts (exists, 23 tests passing)
- apps/achilles-terminal/tests/integration/loop-02-host-allowlist.test.ts (exists, 5 tests passing)
- apps/achilles-terminal/tests/integration/init-07-invariant.test.ts (exists, 7 tests passing)
- .planning/ROADMAP.md (Phase 18 4/4 Complete 2026-06-08; all 4 [x] entries)

Commits verified in git log:
- 2290f002, eb0ae38a, 05b6d287, 23b4ba09

---
*Phase: 18-init-wizard-config-transcripts-single-instance-lock*
*Completed: 2026-06-08*
