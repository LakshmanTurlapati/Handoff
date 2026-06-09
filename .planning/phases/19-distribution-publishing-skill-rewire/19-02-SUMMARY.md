---
phase: 19-distribution-publishing-skill-rewire
plan: 02
subsystem: runtime-hardening
tags: [error-ux, banner, watchdog, structured-logger, eslint, install-skill, dynamic-import-gate, init-07, loop-02]
requires:
  - 19-01 (achilles-skill flip + SKILL.md rewrite + darwin drop)
  - phase-17 (child-exit-watchdog substrate + structured-logger + Session composition root)
  - phase-18 (typed-input fallback, lock-file)
  - phase-15 (eslint config slot at lines 27-41)
provides:
  - ERR-01 inline banner (D-10 pre-empt layout, D-11 aria-role timer)
  - ERR-03 sox + ffplay dual watchdog wiring (bounded respawn, stay-in-error-state)
  - ERR-08 unconditional structured logger at runVoice() entry
  - GATE-04 ESLint stdio:"ignore" forbid rule (lint half)
  - DIST-03 install-skill subcommand path (the SHA-256 + release workflow halves land in Plans 03/04)
affects:
  - apps/achilles-terminal/src/ui/VoiceShell.tsx (Banner inserted as first child of root Box)
  - apps/achilles-terminal/src/ui/useAchillesState.ts (useErrorBanner hook added)
  - apps/achilles-terminal/src/audio/mic-sox.ts (child reference exposed)
  - apps/achilles-terminal/src/audio/tts-playback.ts (child reference exposed, ChildProcessLike exported)
  - apps/achilles-terminal/src/session.ts (dual watchdog wiring + unconditional logger + fan-out scopes)
  - apps/achilles-terminal/eslint.config.js (no-restricted-syntax rule active)
  - apps/achilles-terminal/src/cli.ts (6th dynamic-import gate)
tech-stack:
  added: []
  patterns:
    - "Pattern S-1 TDD RED+GREEN one commit each per task"
    - "Pattern S-2 dynamic-import gate inside main() preserving INIT-07"
    - "Pattern S-3 structured logger fan-out via .child(scope)"
    - "Pattern S-6 root <Box flexDirection=column> JSX layout"
    - "Pattern S-7 readonly fields on interfaces"
    - "Pitfall 7 errorNonce-in-deps useEffect dependency for banner timer reset"
    - "Pitfall 8 ESLint AST selector limited to literal {stdio:ignore} object shape"
key-files:
  created:
    - apps/achilles-terminal/src/error-classifier.ts
    - apps/achilles-terminal/src/ui/Banner.tsx
    - apps/achilles-terminal/src/install-skill.ts
    - apps/achilles-terminal/src/skill-symlink.ts
    - apps/achilles-terminal/tests/error-classifier.test.ts
    - apps/achilles-terminal/tests/ui/banner.test.tsx
    - apps/achilles-terminal/tests/session-err03-wiring.test.ts
    - apps/achilles-terminal/tests/session-err08-wiring.test.ts
    - apps/achilles-terminal/tests/eslint-stdio-ignore.test.ts
    - apps/achilles-terminal/tests/install-skill.test.ts
    - apps/achilles-terminal/tests/cli-install-skill.test.ts
  modified:
    - apps/achilles-terminal/src/ui/VoiceShell.tsx
    - apps/achilles-terminal/src/ui/useAchillesState.ts
    - apps/achilles-terminal/src/audio/mic-sox.ts
    - apps/achilles-terminal/src/audio/tts-playback.ts
    - apps/achilles-terminal/src/session.ts
    - apps/achilles-terminal/eslint.config.js
    - apps/achilles-terminal/src/cli.ts
decisions:
  - "Banner.tsx initial visible state: true when classification!=null AND errorNonce>0 at mount (handles late-mount scenarios)"
  - "useErrorBanner subscribes to typed event channel only; legacy state-change is left for useAchillesState"
  - "ffplay watchdog wired through a tryAttach adapter because tts-playback.child is null until start() resolves"
  - "Watchdog disposal happens BEFORE killing the children in Session.stop() so SIGTERM does not trigger a respawn during shutdown"
  - "runVoice() constructs a single structured logger at entry and passes it through SessionOptions; Session constructor falls back to its own logger when opts.logger is omitted (Phase 17 back-compat preserved)"
  - "process.once('exit') registers logger.flush().then(dispose) symmetrically with the transcript-store + typed-input fallback handlers (all once-handlers)"
  - "ESLint rule remains literal-only; array form ['ignore','pipe','pipe'] is an accepted false-negative per Pitfall 8 (mic-sox.ts's stdio array is not flagged)"
  - "install-skill.ts is a near-verbatim port from v1.2 with the single path adjustment './skill-symlink.js' replacing '../skill-symlink.js'"
  - "Plan path-typo (state/useAchillesState.ts -> ui/useAchillesState.ts) auto-corrected during execution"
metrics:
  duration_minutes: 34
  tasks_completed: 3
  test_files_added: 7
  source_files_added: 4
  source_files_modified: 7
  total_new_tests: 49
  red_commits: 3
  green_commits: 3
  completed_date: 2026-06-09
---

# Phase 19 Plan 02: Runtime Hardening (ERR-01 + ERR-03 + ERR-08 + GATE-04 + DIST-03) Summary

Wired all v1.3 runtime hardening behind the publish-ready artifact: ERR-01 inline error banner (Banner.tsx + error-classifier.ts + VoiceShell.tsx integration), ERR-03 sox/ffplay dual child-exit watchdog wiring in session.ts (Phase 17 substrate construction calls), ERR-08 unconditional structured logger fan-out at runVoice() entry, ESLint stdio:"ignore" forbid rule activation in apps/achilles-terminal/eslint.config.js (GATE-04 lint half), and the install-skill subcommand port from v1.2 (DIST-03 install path) added as the 6th dynamic-import gate in cli.ts.

## Tasks Completed

| Task | Name                                                                                     | RED commit | GREEN commit |
| ---- | ---------------------------------------------------------------------------------------- | ---------- | ------------ |
| 1    | ERR-01 Banner component + error-classifier + VoiceShell wiring                           | 3e562f18   | 1d5f2891     |
| 2    | ERR-03 sox + ffplay watchdog wiring + ERR-08 logger fan-out + GATE-04 ESLint activation  | ec46dd49   | fabc4588     |
| 3    | install-skill subcommand port + cli.ts 6th dynamic-import gate (DIST-03)                 | d1245aa1   | 3b4e23e4     |

## Deliverables

### Task 1: ERR-01 Banner (D-10 + D-11)

#### `apps/achilles-terminal/src/error-classifier.ts` (NEW, 113 LOC)

Pure `classifyForBanner(c: SessionErrorClassification): ClassifiedBanner` transform. The mapping table covers every union member from `session-events.ts`:

| input             | class      | suggestedAction                                  |
| ----------------- | ---------- | ------------------------------------------------ |
| `network`         | network    | retrying...                                      |
| `auth`            | auth       | check ELEVENLABS_API_KEY                         |
| `rate_limit`      | rate-limit | ElevenLabs rate limit -- retrying in 30s         |
| `server`          | server     | ElevenLabs 5xx -- retrying with backoff          |
| `mic_unavailable` | sox        | Audio device lost -- restart Achilles            |
| `playback_lost`   | ffplay     | Audio output lost -- restart Achilles            |
| `claude_failed`   | claude     | claude subprocess failed -- Ctrl-C and retry     |
| `unknown`         | unknown    | see ~/.achilles/achilles.log                     |

Strings are LOCKED to 19-RESEARCH.md Code Example 3. The `ClassifiedBanner` interface uses `readonly` fields per Pattern S-7. Raw exception messages never reach the banner (T-19-10 mitigation).

#### `apps/achilles-terminal/src/ui/Banner.tsx` (NEW, 132 LOC)

Ink+React component rendering `[error] <class> -- <suggestedAction>` as a single red text row inside a `<Box aria-label="error <class> <action>" aria-role="timer">`. The `timer` role is the Ink 7 substitute for `status` per A8 (Ink 7's role enum does not include `status`; same precedent as ScreenReader.tsx).

Three useEffect blocks:
1. Show on `errorNonce !== lastErrNonce && classification !== null`
2. Auto-dismiss timer `setTimeout(8_000)` with cleanup, **`errorNonce` in deps** (Pitfall 7 guard)
3. Early dismiss on `successNonce !== lastSuccessNonce`

Initial visible state: `classification !== null && errorNonce > 0` so a late-mount with an already-pending error renders correctly from the first frame.

#### `apps/achilles-terminal/src/ui/useAchillesState.ts` (MOD)

Added `useErrorBanner(session)` hook. Subscribes to the typed `event` channel on the Session emitter; on `{type:"error"}` calls `classifyForBanner(ev.payload.classification)` and bumps `errorNonce`; on any other typed event bumps `successNonce`. Returns `{errorClass, errorNonce, successNonce}`.

#### `apps/achilles-terminal/src/ui/VoiceShell.tsx` (MOD)

```tsx
return (
  <Box flexDirection="column">
    <Banner classification={errorClass} errorNonce={errorNonce} successNonce={successNonce} />
    {sr ? <ScreenReader state={state} /> : <><Blob amplitude={amp} /><Sparkline ring={ring} writeIndex={writeIndex} /></>}
    <StatusRow state={state} transcript="" transcriptsActive={false} />
  </Box>
);
```

D-10 honored: Banner sits ABOVE the screen-reader/sighted branch and the StatusRow. The Banner returns null when no error is pending, so the surrounding Box collapses with zero footprint.

### Task 2: ERR-03 + ERR-08 + GATE-04 Wiring

#### `apps/achilles-terminal/src/session.ts` (MOD)

**ERR-03 dual-arm watchdog wiring** in `wireAudioBridges()`:

- sox watchdog: constructed when `this.micSox` is non-undefined. `respawnFactory` closes over the `micOpts` shape used in `start()`; `onError` emits `{type:"error", payload:{classification:"mic_unavailable", message}, timestamp}`; logger is `this.logger.child("sox-watchdog")`.
- ffplay watchdog: constructed in a new `wireFfplayWatchdog(emit)` helper invoked AFTER `this.ttsPlayback.start()` resolves (the ffplay child is created inside `start()` so the child reference is null until then). The `respawnFactory` rebuilds the entire `ttsPlayback` handle and returns a `makeFfplayChildAdapter(respawned)` wrapper whose `on("exit", ...)` defers attachment via a 50ms poll until the new child appears. `onError` emits `playback_lost`; logger is `this.logger.child("ffplay-watchdog")`.

Per CONTEXT.md Claude's Discretion: cap-exceeded paths DO NOT call `process.exit`. The Phase 18 ERR-04 typed-input fallback covers the user's path forward.

`Session.stop()` extended: dispose both watchdogs BEFORE killing the children so SIGTERM does not trigger a respawn during shutdown.

**ERR-08 unconditional logger** at `runVoice()` entry:

```ts
const runVoiceLogger = createStructuredLogger();
runVoiceLogger.info("run_voice_start", { pid: process.pid, argv, nodeVersion: process.version });
// ... later
sessionOpts.logger = runVoiceLogger;
// ... after registerGracefulShutdown
process.once("exit", () => {
  void runVoiceLogger.flush().then(() => runVoiceLogger.dispose());
});
```

The log line emits BEFORE `apiKey` resolve / any pipeline boot. The same logger handle is shared with the Session via `SessionOptions.logger` so all log lines land in one file per run.

**Logger fan-out** via `this.logger.child(scope)` for the audio bridges:
- `tts` (createTtsPlayback deps)
- `stt` (createSttBridge deps)
- `claude` (createClaudeBridge deps)
- `sox-watchdog` (sox createChildExitWatchdog deps)
- `ffplay-watchdog` (ffplay createChildExitWatchdog deps)

5 scopes (>= the plan's >=4 requirement).

#### `apps/achilles-terminal/src/audio/mic-sox.ts` (MOD)

Extended `MicSoxHandle` with `readonly child: ChildProcess` — a thin pass-through of the sox `proc` reference so the watchdog can attach its `on("exit")` listener. No behavioural change.

#### `apps/achilles-terminal/src/audio/tts-playback.ts` (MOD)

Extended `TtsPlaybackHandle` with `readonly child: ChildProcessLike | null` (null until `start()` resolves). Promoted `ChildProcessLike` from a private interface to an exported type so session.ts can reference the handle's child type.

#### `apps/achilles-terminal/eslint.config.js` (MOD)

Activated the prepared GATE-04 slot:

```js
"no-restricted-syntax": [
  "error",
  {
    selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
    message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
  },
],
```

Pitfall 8 documented: the selector matches only the LITERAL `{ stdio: "ignore" }` object shape. Variable indirection and the array form `[ "ignore", "pipe", "pipe" ]` (legitimate sox shape) are accepted false-negatives. The mic-sox stdio array is NOT flagged.

### Task 3: install-skill + cli dynamic-import gate (DIST-03)

#### `apps/achilles-terminal/src/skill-symlink.ts` (NEW, 323 LOC, port)

Verbatim port from `apps/achilles-cli/src/skill-symlink.ts`. The module is pure (only `node:path` imports), so the port is path-neutral. All 9 surfaces exported unchanged:

| symbol                            | kind      |
| --------------------------------- | --------- |
| `InstallSkillSymlinkFs`           | interface |
| `InstallSkillSymlinkLogger`       | interface |
| `InstallSkillSymlinkOptions`      | interface |
| `InstallSkillSymlinkResult`       | type      |
| `ExistingDestinationConflictError`| class     |
| `SymlinkNotPermittedError`        | class     |
| `getErrorCode`                    | function  |
| `WINDOWS_FALLBACK_CODES`          | const     |
| `installSkillSymlink`             | function  |

Idempotency contract preserved: existing symlink to same target -> `mode:"already-installed"`; existing different-target without `--force` -> `ExistingDestinationConflictError`; Windows EPERM/EACCES/EISDIR fallback -> recursive `cpSync` with a warn-log.

#### `apps/achilles-terminal/src/install-skill.ts` (NEW, 232 LOC, port)

Port from `apps/achilles-cli/src/commands/install-skill.ts`. Single port-time path adjustment: `from "./skill-symlink.js"` (v1.3 flat layout) replaces `from "../skill-symlink.js"` (v1.2 `commands/` subdir layout). Imports `SKILL_PROMPTS_DIR` from `@achilles/achilles-skill` (the package was flipped to `private: false` in Plan 19-01 and is now published at v1.3.0).

The `defaultSkillSourceProvider()` walks one directory up from `SKILL_PROMPTS_DIR` to obtain the skill ROOT (contains both `SKILL.md` and `prompts/companion.md`).

Three error branches:
1. `ExistingDestinationConflictError` -> stderr + `Pass --force to overwrite.\n` + exit 1
2. `SymlinkNotPermittedError` -> stderr + Windows Developer Mode hint + exit 1
3. generic `Error` -> stderr `install-skill failed: <detail>\n` + exit 1

Happy path prints `Skill installed at <dest>.\n` + `Please restart Claude Code to discover the /achilles skill.\n` (Pitfall #5 reminder).

#### `apps/achilles-terminal/src/cli.ts` (MOD)

Inserted the 6th dynamic-import gate INSIDE `main()` between the `transcripts` and `voice` branches:

```ts
if (argv[0] === "install-skill") {
  const force = argv.includes("--force");
  const { installSkillCommand } = await import("./install-skill.js");
  installSkillCommand({
    force,
    stdout: process.stdout,
    stderr: process.stderr,
    processExitImpl: (code) => process.exit(code),
  });
  return;
}
```

INIT-07 invariant held: top-level static imports remain `{node:fs/promises, node:url, node:path}`. The `install-skill.ts` module + its `@achilles/achilles-skill` import load ONLY when this branch fires.

## Test Files

All 7 NEW test files GREEN (49 tests total):

| File                                         | Tests | Notes                                                          |
| -------------------------------------------- | ----- | -------------------------------------------------------------- |
| `tests/error-classifier.test.ts`             | 11    | 8 mappings + 3 invariants (non-empty, readonly shape, no-emoji)|
| `tests/ui/banner.test.tsx`                   | 8     | T-BAN-01..07 + VoiceShell integration                          |
| `tests/session-err03-wiring.test.ts`         | 7     | sox + ffplay regex shape + stop disposal + no-process-exit     |
| `tests/session-err08-wiring.test.ts`         | 5     | run_voice_start before apiKey + constructor logger + fan-out   |
| `tests/eslint-stdio-ignore.test.ts`          | 3     | forbidden fires; sanctioned silent; array shape accepted-FN    |
| `tests/install-skill.test.ts`                | 7     | T-IS-01..06 + no-emoji invariant                               |
| `tests/cli-install-skill.test.ts`            | 8     | INIT-07 budget + branch placement + dynamic-import gate        |

Existing tests preserved:
- `tests/cli.test.ts` 23 tests (T1-T23) GREEN in isolation
- `tests/integration/init-07-invariant.test.ts` 7 cases GREEN
- `tests/session.test.ts` 17 cases GREEN
- `tests/ui/voice-shell.test.tsx` 10 cases GREEN
- `tests/child-exit-watchdog.test.ts` 8 cases GREEN
- `tests/structured-logger.test.ts` GREEN

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Path typo] PLAN.md `files_modified` listed `apps/achilles-terminal/src/state/useAchillesState.ts` but the actual file lives at `apps/achilles-terminal/src/ui/useAchillesState.ts`**

- **Found during:** Task 1 (when wiring `useErrorBanner` into VoiceShell)
- **Issue:** The plan frontmatter referenced a wrong path. The v1.3 layout from Phase 16 Plan 04 places hooks under `ui/`, not `state/` (state machine constants live under `state/`).
- **Fix:** Added the `useErrorBanner` hook in `src/ui/useAchillesState.ts` (the actual location). The `VoiceShell.tsx` import path is `./useAchillesState.js` (relative within `ui/`), which would have been broken if the hook had been added under `state/`.
- **Files modified:** `src/ui/useAchillesState.ts`
- **Commit:** 1d5f2891

**2. [Rule 1 - Test bug] T-BAN-02..06 initially failed because Banner mounted with `errorNonce>0` did not initialise `visible=true`**

- **Found during:** Task 1 GREEN
- **Issue:** The original useState initialiser pattern from RESEARCH Section Pattern 3 sets `lastErrNonce = errorNonce` AND `visible = false`. With the test rendering the very first frame at `errorNonce=1`, the show-effect saw no diff and the banner never appeared.
- **Fix:** Updated Banner.tsx to initialise `visible = (classification !== null && errorNonce > 0)` so a late-mount with an already-pending error renders correctly from frame 1. Did NOT modify the RED tests.
- **Files modified:** `src/ui/Banner.tsx`
- **Commit:** 1d5f2891

**3. [Rule 1 - Test bugs] Three Task 2 RED-test bugs auto-corrected**

- **Found during:** Task 2 GREEN
- **Issues:**
  - `session-err03-wiring.test.ts` `(d)` test was matching the `createChildExitWatchdog` IMPORT line (line 112) as an "occurrence" and asserting it appears AFTER `wireAudioBridges()` (line 483). The import line obviously fails that check.
  - `session-err03-wiring.test.ts` `cap-exceeded` test was matching `process.exit` in DOCSTRING COMMENTS ("do NOT call process.exit"). The regex needed the call-form `process.exit(` only.
  - `session-err08-wiring.test.ts` `(c)` test was looking for literal `logger.flush()` substring; the implementation uses `runVoiceLogger.flush()` (capitalised L) and `[lL]ogger\.flush\(\)/` is the correct regex.
- **Fix:** Updated the three test files to (a) filter for `createChildExitWatchdog(` call-form only, (b) strip comments from the cap-exceeded search window, (c) accept `[lL]ogger\.flush\(\)`.
- **Files modified:** `tests/session-err03-wiring.test.ts`, `tests/session-err08-wiring.test.ts`
- **Commit:** fabc4588

**4. [Rule 1 - Test scaffolding] ESLint test fixture filePath strategy reworked**

- **Found during:** Task 2 GREEN (eslint-stdio-ignore tests)
- **Issue:** `eslint.lintText(fixture, {filePath: <synthetic-path>})` returned a "TSConfig does not include this file" parse error because the synthetic file path was not on disk and therefore not in the tsconfig project graph.
- **Fix:** Rewrote the test to write three real fixture files to `src/__eslint_test_*.ts` in `beforeAll`, call `eslint.lintFiles([path])`, and clean up in `afterAll`. The fixtures match the tsconfig `include` glob so the type-checked rule set picks them up.
- **Files modified:** `tests/eslint-stdio-ignore.test.ts`
- **Commit:** fabc4588

## Deferred Items

### Pre-existing lint errors (out of scope)

The plan's `<verify>` step requires `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` to exit 0. The lint suite currently fails on PRE-EXISTING errors unrelated to Plan 19-02:

| File                                     | Line                | Rule                                                         |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------ |
| `src/session.ts`                         | 405                 | `@typescript-eslint/no-unnecessary-type-assertion` (`as SessionMetrics` cast in Phase 17 ported metrics object) |
| `src/session.ts`                         | 574                 | `@typescript-eslint/no-unnecessary-type-assertion` (`as never` cast in Phase 17 claude-bridge deps) |
| `src/session.ts`                         | 1158, 1308          | `@typescript-eslint/no-redundant-type-constituents` (`unknown` in the Phase 18 resume-session module shape) |
| `src/session.ts`                         | 1461                | `@typescript-eslint/unbound-method` (Phase 18 lock-file path resolution) |
| `src/lock-file.ts`                       | 151                 | `LockState` discriminated-union missing field branch         |
| `src/circuit-breaker.ts`, `src/graceful-shutdown.ts`, `src/latency-probe.ts` | various | Phase 17 / 18 unsafe-any patterns |
| `tests/init/encrypted-key.test.ts`, `tests/structured-logger.test.ts`, etc. | various | Phase 17 / 18 test-time type-safety issues |

These errors were present at HEAD before this plan started (verified by stashing my changes and re-running lint). All NEW files added by Plan 19-02 (Banner.tsx, error-classifier.ts, install-skill.ts, skill-symlink.ts, the 7 test files) pass lint cleanly. All MODIFIED files (VoiceShell.tsx, useAchillesState.ts, mic-sox.ts, tts-playback.ts, eslint.config.js, cli.ts) pass lint cleanly.

The session.ts errors are PRE-EXISTING from Phase 17/18 ports and the same lines exist at HEAD~7. They are out of scope for this plan's runtime-hardening work; a dedicated cleanup commit can address them in a future maintenance plan.

### Pre-existing flaky integration tests

`tests/cli.test.ts` T6 and T7 (Phase 16 voice subprocess SIGINT tests) fail in the FULL test suite due to parallelism-induced timing pressure: the 300ms SIGINT delay is not enough time for the subprocess to emit any output when the test runner is heavily loaded. These tests PASS when run in isolation (verified across 3 consecutive runs in the same shell). They ALSO FAIL in the full suite WITHOUT my changes (verified by stashing my work and re-running). Pre-existing flakiness; out of scope for Plan 19-02.

## Threat Flags

No new threat surfaces beyond those documented in the plan's `<threat_model>`. The Banner + error-classifier honor T-19-10 by keeping raw exception text out of the UI; the ERR-08 logger writes everything through the existing 7-regex `DEFAULT_REDACT_PATTERNS` set; ERR-03 watchdog cap-exceeded paths do not bypass the redaction pipeline; the GATE-04 ESLint rule is scoped to `apps/achilles-terminal/eslint.config.js` only (NOT root, NOT other workspaces); the install-skill ports preserve the v1.2 `path.resolve(SKILL_PROMPTS_DIR, "..")` source resolution so no user-controlled input crosses the symlink-target boundary.

## Invariants Held

| Invariant | Verification |
| --------- | ------------ |
| **LOOP-02 byte-for-byte** | `git log --name-only HEAD~7..HEAD \| grep -E "packages/(voice-\|claude-code-bridge\|achilles-skill/skill/prompts/companion)"` returns empty |
| **INIT-07 static-import budget** | `head -50 apps/achilles-terminal/src/cli.ts \| grep -cE '^import .* from "node:(fs/promises\|url\|path)"'` returns 3; the new `install-skill` branch uses `await import("./install-skill.js")` inside `main()` |
| **CLAUDE.md no-emoji global** | `LC_ALL=C grep -rP '[\x80-\xff]' apps/achilles-terminal/src/ui/Banner.tsx apps/achilles-terminal/src/error-classifier.ts apps/achilles-terminal/src/install-skill.ts apps/achilles-terminal/src/skill-symlink.ts` returns empty |
| **TDD RED+GREEN per task** | 3 `test(19-02)` RED commits + 3 `feat(19-02)` GREEN commits (S-1 pattern) |
| **Cap-exceeded stays in error state (Claude's Discretion)** | No `process.exit(` call appears within 2KB after either `createChildExitWatchdog(` site (verified by test) |
| **ERR-01 banner first child of root Box (D-10)** | `tests/ui/banner.test.tsx` T-BAN-07 asserts `<Banner ...>` appears between `<Box flexDirection="column">` opening and `{sr ? ...}` |
| **ESLint rule scope** | Rule activated in `apps/achilles-terminal/eslint.config.js` only; root and other workspaces unchanged |

## Self-Check: PASSED

All created files exist on disk; all 6 commits present in `git log`; all 7 NEW test files GREEN in isolation AND together; existing tests/integration/init-07-invariant.test.ts (7 cases) and tests/cli.test.ts INIT-07 tests (T8, T12, T23) STILL pass; LOOP-02 invariant held; INIT-07 invariant held; no emojis in any new/modified source file.

## Commits

| Hash       | Type | Message                                                                          |
| ---------- | ---- | -------------------------------------------------------------------------------- |
| 3e562f18   | test | add failing tests for ERR-01 Banner + error-classifier                           |
| 1d5f2891   | feat | ERR-01 Banner + error-classifier + VoiceShell wiring                             |
| ec46dd49   | test | add failing tests for ERR-03 + ERR-08 + GATE-04 wiring                           |
| fabc4588   | feat | ERR-03 dual watchdog + ERR-08 logger fan-out + GATE-04 ESLint                    |
| d1245aa1   | test | add failing tests for install-skill + cli dynamic-import gate                    |
| 3b4e23e4   | feat | port install-skill + skill-symlink + add cli dynamic-import gate                 |
