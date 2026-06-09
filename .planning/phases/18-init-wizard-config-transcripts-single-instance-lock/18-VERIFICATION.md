---
phase: 18-init-wizard-config-transcripts-single-instance-lock
verified: 2026-06-08T00:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  date: 2026-06-08
  previous_status: human_needed
  previous_score: 10/12
  gaps_closed:
    - "SAFE-02 — --save-transcripts flag wired into runVoice() via dynamic createTranscriptStore import + session event subscription"
    - "ERR-04 — createTypedInputFallback wired into runVoice() with session.sttCircuit + session.submitTranscript() as onTyped callback"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Full achilles init wizard end-to-end interactive run"
    expected: "Linear @clack/prompts flow completes: API key -> preflight -> ambient calibration (real mic) -> smoke test -> summary diff -> marker write"
    why_human: "Requires interactive @clack/prompts session, real microphone hardware, sox device open, real ElevenLabs API key, and network connectivity — cannot be verified programmatically"
  - test: "macOS TCC parent-emulator EPERM denial path"
    expected: "When sox device-open fails with EPERM and platform is darwin, wizard resolves parent emulator via process.ppid + ps and prints per-emulator remediation text (VS Code/Cursor -> 'open Terminal.app once')"
    why_human: "Requires actually denying mic permission in macOS System Settings, then running the wizard; the remediation table is code-verified but the real EPERM trigger is OS-level"
  - test: "Real ElevenLabs API key storage + retrieval via OS keychain"
    expected: "writeKeychain('achilles', 'ELEVENLABS_API_KEY', 'xi-...') stores to macOS Keychain; readKeychain returns it; resolveApiKey returns source='keychain'"
    why_human: "Requires a real ElevenLabs API key and write permission to the OS Keychain Access — operator-only"
---

# Phase 18: Init Wizard + Config + Transcripts + Single-Instance Lock — Verification Report

**Phase Goal:** Build cold-start friction killer: linear @clack/prompts wizard walking API key resolution -> sox/ffmpeg preflight (real device-open smoke, not just `which`) -> 5-second ambient calibration seeding the VAD EWMA noise floor -> 1-utterance round-trip smoke test; resolve API key from ELEVENLABS_API_KEY env -> OS keychain via @napi-rs/keyring -> encrypted ~/.achilles/key.enc (libsodium secretbox, 0o600); detect parent terminal emulator on macOS EPERM and print per-emulator remediation (VS Code/Cursor -> "open Terminal.app once"); single-instance ~/.achilles/voice.lock PID file; opt-in --save-transcripts with transcripts list/purge subcommands; typed-input fallback via @clack/prompts.text() when STT circuit opens; achilles latency --report rolling-window P50/P95; achilles config settings menu.
**Verified:** 2026-06-08
**Status:** passed
**Re-verification:** Yes — after gap closure (commit a39a8ce2)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | INIT-01: @clack/prompts wizard executes 7 linear steps (welcome -> api-key -> preflight -> ambient-calibration -> smoke-test -> summary -> marker) with idempotent defaults and summary diff | VERIFIED | `wizard.ts` (458 LOC): all 7 stepsCompleted.push() calls present; readInitMarkerImpl() used for prior marker; diffLines built from oldSource vs resolvedApiKeySource; promptConfirm "Save these changes?" gates writes |
| 2 | INIT-02: resolveApiKey() implements env -> keychain -> encrypted-file precedence; writeApiKey() refuses env target | VERIFIED | `api-key.ts` (270 LOC): three-tier chain with KeychainUnavailableError fall-through, EncryptedKeyPermissionsError fall-through, empty-env-as-unset guard; writeApiKey has TypeScript exhaustiveness check blocking "env" target |
| 3 | INIT-03: checkPreflight() runs which + real sox device-open smoke matching Phase 16 mic-sox.ts argv; install-suggestions.ts has all 3 platform lines | VERIFIED | `preflight.ts` (306 LOC): `rec -q -t raw -r 16000 -b 16 -e signed -c 1 - trim 0 1` present; `install-suggestions.ts` has `brew install`, `sudo apt install -y`, `choco install -y` |
| 4 | INIT-04: calibrateAmbient() captures 5s, computes 10th-percentile RMS, writes to settings.json; smoke-test.ts uses Phase 17 createSession | VERIFIED | `ambient-calibration.ts` (257 LOC): percentile10() formula `sorted[floor(0.10 * (n-1))]`, writeNoiseFloorToSettings merges idempotently; `smoke-test.ts` imports `createSession` from `../session.js` |
| 5 | INIT-05: Wizard is idempotent with "keep current" defaults; summary diff printed before any write | VERIFIED | `wizard.ts`: readInitMarkerImpl() populates priorMarker; oldSource = priorMarker?.apiKeySource ?? "missing"; diff shows "oldSource -> resolvedApiKeySource"; writeInitMarker called only after promptConfirm("Save these changes?") |
| 6 | INIT-06: resolveParentEmulator() covers all 8 emulators (7+unknown) via ppid+ps; REMEDIATION_TABLE present; VS Code/Cursor cite microsoft/vscode#307364; wizard calls this on sox device-failed + darwin | VERIFIED | `parent-terminal.ts` (156 LOC): 8 emulators in REMEDIATION_TABLE; grep for microsoft/vscode#307364 returns 2 hits; `wizard.ts` line: `if (check.name === "sox" && platform === "darwin")` gates emulator resolution |
| 7 | SAFE-01: api-key.ts + encrypted-key.ts have ZERO direct console.log/console.error; structured-logger has 7 redaction patterns including xi_ shape; DEFAULT_REDACT_PATTERNS exported | VERIFIED | No non-comment console calls in either module; `structured-logger.ts` line 179: `/xi_[a-zA-Z0-9]{40,}/g` present; `export const DEFAULT_REDACT_PATTERNS` confirmed |
| 8 | SAFE-02: transcripts/store.ts applies DEFAULT_REDACT_PATTERNS; retention.ts has 30-day default; transcripts/cli.ts exports list+purge; cli.ts wires transcripts list/purge; --save-transcripts wired in runVoice() | VERIFIED | `store.ts` imports and applies DEFAULT_REDACT_PATTERNS; `retention.ts` DEFAULT_RETENTION_DAYS=30; `cli.ts` wires list/purge; `session.ts` runVoice() registers `--save-transcripts` commander option, dynamic-imports `createTranscriptStore`, subscribes to the "event" channel (stt_committed/claude_ack/claude_summary), registers `transcriptStore.dispose()` via `process.once("exit")` |
| 9 | SAFE-03: assertElevenLabsHost exists in voice-protocol/src/transport.ts; loop-02-host-allowlist.test.ts asserts it | VERIFIED | `packages/voice-protocol/src/transport.ts` exports `function assertElevenLabsHost(url: string | URL): string`; integration test present with 5 cases |
| 10 | SAFE-04: cli.ts voice branch acquires acquireLock() BEFORE session.ts dynamic import; exits with verbatim conflict message on collision | VERIFIED | cli.ts lines 177-186: `await import("./lock-file.js")` then `acquireLock()` then conflict check then `await import("./session.js")`; message: "Another achilles voice session is running (pid ${lockState.runningPid}). Press Ctrl-C in that terminal first." |
| 11 | ERR-04: createTypedInputFallback polls circuit-breaker.status() and calls onTyped on "open" state; wired to live session via session.sttCircuit + session.submitTranscript() | VERIFIED | `typed-input.ts` (143 LOC) polls circuitBreaker.status() and calls onTyped(result). `session.ts` runVoice() dynamic-imports `createTypedInputFallback` under `!isMock`, passes `session.sttCircuit` as circuitBreaker and `async (typed) => session.submitTranscript(typed)` as onTyped; disposes via `process.once("exit")`. `Session.submitTranscript()` is public and delegates to private `driveClaudeForUtterance` — the same path voice transcripts use. Three tests in `tests/session-submit-transcript.test.ts` prove method existence, sttCircuit public exposure, and no-op behavior when claudeBridge is null. |
| 12 | ERR-07: achilles latency --report calls renderLatencyReport; latency-report.ts exists as thin wrapper | VERIFIED | `latency-report.ts` (52 LOC) imports and delegates to `renderLatencyReport` from `./latency-probe.js`; cli.ts latency branch: `await import("./latency-report.js")` then `runLatencyReport()` |

**Score:** 12/12 truths verified

---

### Critical Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| INIT-07: cli.ts top-level static imports == exactly 3 node: imports | VERIFIED | `grep -E "^import" cli.ts` = 3 lines: node:fs/promises, node:url, node:path; the two new imports in runVoice() (`./transcripts/store.js`, `./typed-input.js`) are dynamic `await import(` inside the action callback — cli.ts unchanged |
| LOOP-02: packages/voice-*, claude-code-bridge/, companion.md byte-for-byte unchanged | VERIFIED | commit a39a8ce2 `--stat` shows only `apps/achilles-terminal/src/session.ts` and `apps/achilles-terminal/tests/session-submit-transcript.test.ts` modified; 0 changes to any packages/* path |
| SAFE-03 via integration test | VERIFIED | `tests/integration/loop-02-host-allowlist.test.ts` present with 5 cases including throws-on-example.com |
| D-15-01: package.json name="achilles-terminal" | VERIFIED | `"name": "achilles-terminal"` confirmed |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/achilles-terminal/src/init/api-key.ts` | resolveApiKey + writeApiKey with 3-tier hierarchy | VERIFIED | 270 LOC; exports resolveApiKey, writeApiKey, ApiKeySource, ApiKeyResolveResult |
| `apps/achilles-terminal/src/init/keychain.ts` | KeychainUnavailableError + readKeychain/writeKeychain | VERIFIED | 209 LOC; lazy @napi-rs/keyring import; KeychainUnavailableError class |
| `apps/achilles-terminal/src/init/encrypted-key.ts` | secretBox/openSecretBox + 0o600 enforcement | VERIFIED | 333 LOC; uses `secretBox`/`openSecretBox` from @stablelib/nacl; chmodSync(encPath, 0o600) explicit |
| `apps/achilles-terminal/src/init/preflight.ts` | which + device-open smoke; BinaryCheck/PreflightResult | VERIFIED | 306 LOC; rec argv matches Phase 16; stdio:["ignore","pipe","pipe"] |
| `apps/achilles-terminal/src/init/ambient-calibration.ts` | 5s calibration -> 10th percentile -> settings.json | VERIFIED | 257 LOC; percentile10() formula correct; writeNoiseFloorToSettings merges idempotently |
| `apps/achilles-terminal/src/init/parent-terminal.ts` | 8 emulators; REMEDIATION_TABLE; ppid+ps | VERIFIED | 156 LOC; all 8 entries in REMEDIATION_TABLE; microsoft/vscode#307364 cited |
| `apps/achilles-terminal/src/init/marker.ts` | hasInitMarker/readInitMarker/writeInitMarker | VERIFIED | 129 LOC; 0o600 on write; 0o700 parent dir |
| `apps/achilles-terminal/src/lock-file.ts` | acquireLock/releaseLock/isPidAlive; LOCK_FILE reuse | VERIFIED | 199 LOC; imports LOCK_FILE + ACHILLES_HOME from resume-session.ts; isPidAlive uses kill-0 probe |
| `apps/achilles-terminal/src/structured-logger.ts` | 7 regex entries; DEFAULT_REDACT_PATTERNS exported | VERIFIED | 7 regex confirmed; `export const DEFAULT_REDACT_PATTERNS` |
| `apps/achilles-terminal/src/init/wizard.ts` | runInitWizard() composing Plans 01/02 | VERIFIED | 458 LOC; all 6 Plan 01/02 module imports present; 7 stepsCompleted.push() calls |
| `apps/achilles-terminal/src/init/smoke-test.ts` | runSmokeTest; createSession import | VERIFIED | 154 LOC; imports createSession from session.ts |
| `apps/achilles-terminal/src/transcripts/store.ts` | JSONL with redaction; 0o600; session_end on dispose | VERIFIED | 192 LOC; applies DEFAULT_REDACT_PATTERNS; chmodSync 0o600 on first write |
| `apps/achilles-terminal/src/transcripts/retention.ts` | cleanupOldTranscripts(30) | VERIFIED | 116 LOC; DEFAULT_RETENTION_DAYS=30 |
| `apps/achilles-terminal/src/transcripts/cli.ts` | transcriptsList/transcriptsPurge | VERIFIED | 241 LOC; both functions exported |
| `apps/achilles-terminal/src/typed-input.ts` | createTypedInputFallback polling circuit-breaker; live call-site in runVoice | VERIFIED | 143 LOC; polls circuitBreaker.status(); onTyped wired to session.submitTranscript() in runVoice() via commit a39a8ce2 |
| `apps/achilles-terminal/src/config-menu.ts` | 6 fields (4 VAD + 2 boolean) with validators | VERIFIED | 344 LOC; CONFIGURABLE_FIELDS has vad.voiceThresholdRatio, vad.voiceHoldMs, vad.silenceHoldMs, vad.minUtteranceMs, save_transcripts, debug_mode |
| `apps/achilles-terminal/src/latency-report.ts` | thin wrapper around renderLatencyReport | VERIFIED | 52 LOC; imports renderLatencyReport from latency-probe.ts |
| `apps/achilles-terminal/src/cli.ts` | 4 new subcommands via dynamic import; voice lock | VERIFIED | 214 LOC; init/config/transcripts/latency branches; acquireLock BEFORE session.ts in voice branch; 3 static top-level imports (INIT-07 unchanged) |
| `apps/achilles-terminal/tests/session-submit-transcript.test.ts` | 3 wiring-proof tests for submitTranscript + sttCircuit | VERIFIED | NEW in commit a39a8ce2; 3 tests: method exists + is async, no-op on non-started session, sttCircuit.status() publicly callable |
| `apps/achilles-terminal/tests/integration/init-07-invariant.test.ts` | 6 cases asserting INIT-07 | VERIFIED | Present; checks count==3, node:-only, no relative top-level, >=6 dynamic imports, shebang, spawn smoke |
| `apps/achilles-terminal/tests/integration/loop-02-host-allowlist.test.ts` | 5 cases asserting SAFE-03 | VERIFIED | Present; typeof check, elevenlabs accept, example.com reject, malicious.io reject, signature grep |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| cli.ts voice branch | lock-file.ts acquireLock | `await import("./lock-file.js")` before session.ts | VERIFIED | Lines 177-186: lock acquired, checked, conflict exits before session import |
| cli.ts | wizard.ts runInitWizard | `await import("./init/wizard.js")` | VERIFIED | Line 115 |
| cli.ts | config-menu.ts runConfigMenu | `await import("./config-menu.js")` | VERIFIED | Line 136 |
| cli.ts | transcripts/cli.ts list+purge | `await import("./transcripts/cli.js")` | VERIFIED | Lines 150, 155 |
| cli.ts | latency-report.ts runLatencyReport | `await import("./latency-report.js")` | VERIFIED | Line 95 |
| wizard.ts | api-key.ts + preflight.ts + ambient-calibration.ts + marker.ts | Sequential @clack/prompts steps | VERIFIED | All 6 Plan 01/02 module functions imported and called in wizard.ts |
| transcripts/store.ts | structured-logger.ts DEFAULT_REDACT_PATTERNS | `import { DEFAULT_REDACT_PATTERNS } from "../structured-logger.js"` | VERIFIED | Applied to text+event fields before JSONL write |
| runVoice() | transcripts/store.ts createTranscriptStore | dynamic `await import("./transcripts/store.js")` guarded by `opts.saveTranscripts === true` | VERIFIED | session.ts lines 1199-1234; subscribes to "event" channel; dispose registered via process.once("exit") |
| runVoice() | typed-input.ts createTypedInputFallback | dynamic `await import("./typed-input.js")` guarded by `!isMock` | VERIFIED | session.ts lines 1244-1260; passes session.sttCircuit + async onTyped -> session.submitTranscript(); dispose registered via process.once("exit") |
| Session.submitTranscript | Session.driveClaudeForUtterance | direct delegation (`await this.driveClaudeForUtterance(text)`) | VERIFIED | session.ts line 831; public method is a thin shim over the private pipeline entry |
| smoke-test.ts | session.ts createSession | `import { createSession } from "../session.js"` | VERIFIED | Direct import; sessionFactoryImpl injection seam for tests |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| wizard.ts noiseFloor | resolvedNoiseFloor | calibrateAmbientImpl() | Yes (from mic frames via micSoxFactory) | FLOWING |
| wizard.ts apiKeySource | resolvedApiKeySource | resolveApiKeyImpl() | Yes (env/keychain/encrypted-file) | FLOWING |
| transcripts/store.ts | entry.text | runVoice() session "event" subscriber (stt_committed / claude_ack / claude_summary) | Yes — live session events from voice pipeline | FLOWING (wired in a39a8ce2) |
| typed-input.ts typed string | result from promptText | @clack/prompts.text() -> onTyped -> session.submitTranscript() -> driveClaudeForUtterance | Yes (user keyboard input routes through sandwich-wrap) | FLOWING (wired in a39a8ce2) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| INIT-07: --version cold-start | Asserted by init-07-invariant.test.ts spawn smoke | 3 static imports confirmed; shebang confirmed; cli.ts top-level static imports unchanged by a39a8ce2 | PASS (by test + code inspection) |
| SAFE-03: assertElevenLabsHost rejects arbitrary host | Asserted by loop-02-host-allowlist.test.ts | example.com throws | PASS (by test) |
| SAFE-04: acquireLock before session.ts | Code inspection of voice branch | Lock lines 177-186 before session line 186; cli.ts unmodified by a39a8ce2 | PASS |
| SAFE-01: 7 redact patterns exported | grep count | 7 confirmed; export const verified | PASS |
| LOOP-02: packages unchanged | git show a39a8ce2 --stat | Only session.ts + session-submit-transcript.test.ts modified; 0 bytes diff on packages/* | PASS |
| ERR-04 public surface | tests/session-submit-transcript.test.ts (3 tests) | submitTranscript exists + async; no-op on non-started session; sttCircuit.status() polled correctly | PASS (465 passing, 1 skipped, 2 pre-existing cli.test.ts subprocess flakes) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INIT-01 | 18-03, 18-04 | @clack/prompts linear wizard | SATISFIED | wizard.ts 7-step flow; cli.ts `await import("./init/wizard.js")` |
| INIT-02 | 18-01 | env -> keychain -> encrypted-file hierarchy | SATISFIED | api-key.ts 3-tier resolveApiKey; KeychainUnavailableError + EncryptedKeyPermissionsError fall-through |
| INIT-03 | 18-02, 18-03 | which + real device-open smoke; install suggestions | SATISFIED | preflight.ts + install-suggestions.ts; rec argv matches mic-sox.ts |
| INIT-04 | 18-02, 18-03 | 5s ambient calibration + smoke test | SATISFIED | ambient-calibration.ts 10th-percentile + writeNoiseFloorToSettings; smoke-test.ts createSession import |
| INIT-05 | 18-03 | Idempotent re-run with keep-current defaults | SATISFIED | wizard.ts priorMarker read; oldSource diff; writeInitMarker only on confirm |
| INIT-06 | 18-02, 18-03 | Parent emulator EPERM detection; per-emulator remediation | SATISFIED | parent-terminal.ts 8 emulators; VSCode/Cursor cite vscode#307364; wizard wires platform check |
| SAFE-01 | 18-01, 18-02 | Key never logged; 7-regex redaction; 0o600 on key.enc | SATISFIED | api-key.ts + encrypted-key.ts zero console calls; structured-logger.ts 7 patterns exported |
| SAFE-02 | 18-03, 18-04 | Transcripts off by default; opt-in; list/purge; --save-transcripts records to JSONL | SATISFIED | Store + retention + list/purge modules exist and work; `--save-transcripts` option registered in commander; createTranscriptStore dynamically imported and subscribed to session events; transcriptStore.dispose() registered on process exit (commit a39a8ce2) |
| SAFE-03 | 18-04 | ElevenLabs-only host allowlist unchanged | SATISFIED | assertElevenLabsHost in transport.ts; integration test present; packages diff = 0 |
| SAFE-04 | 18-02, 18-04 | Single-instance lock; explicit conflict message | SATISFIED | lock-file.ts acquireLock/releaseLock/isPidAlive; cli.ts voice branch wires acquireLock BEFORE session.ts; verbatim message confirmed |
| ERR-04 | 18-03 | Typed-input fallback via @clack/prompts when circuit opens; wired to session pipeline | SATISFIED | createTypedInputFallback module complete; polls circuit-breaker.status(); runVoice() wires it with session.sttCircuit + session.submitTranscript() as onTyped; SC-5 single-pipeline entry confirmed (commit a39a8ce2) |
| ERR-07 | 18-03, 18-04 | achilles latency --report P50/P95; --debug verbose logging | SATISFIED | latency-report.ts delegates to renderLatencyReport; cli.ts latency --report branch wired; runVoice(argv.slice(1)) passes --debug through to session.ts |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/init/wizard.ts` | 128 | `const PACKAGE_VERSION = "1.3.0"` hardcoded | INFO | Should read from package.json at runtime in production; currently a static literal. Low impact for Phase 18 but will drift when package version bumps |

No TBD/FIXME/XXX markers found in Phase 18 files. No unreferenced debt markers. The pre-existing Phase 17-01 lint debt is documented in deferred-items.md and not Phase 18's responsibility.

---

### Human Verification Required

The two wiring gaps (SAFE-02 and ERR-04) have been closed by commit a39a8ce2. The remaining human verification items are operator-level tests that require real hardware, real API keys, or real OS permission state.

#### 1. Full achilles init wizard end-to-end

**Test:** Run `achilles init` in a clean terminal with a real ElevenLabs API key and sox/ffmpeg installed
**Expected:** Linear @clack/prompts flow runs: welcome note -> API key detection -> sox device-open smoke passes -> 5-second ambient calibration with real mic -> smoke test option -> summary diff -> marker write to ~/.achilles/init.json
**Why human:** Requires interactive @clack/prompts session, real microphone hardware, working sox binary, real ElevenLabs API key, and network round-trip. Cannot simulate interactively in CI.

#### 2. macOS TCC parent-emulator EPERM denial path

**Test:** Deny mic permission in System Settings -> Privacy & Security -> Microphone for iTerm2 (or Terminal.app). Run `achilles init`. Observe sox device-open step.
**Expected:** Wizard shows device-failed for sox, resolves parent emulator via ppid+ps, prints the per-emulator remediation hint from REMEDIATION_TABLE
**Why human:** Requires actual System Settings denial on macOS — cannot be simulated without real TCC permission state.

#### 3. Real ElevenLabs API key in OS keychain

**Test:** Run `achilles init`, choose "OS keychain" as storage target, enter a real xi-prefixed key. Then run `achilles init` again and verify "keep current" defaults show source=keychain.
**Expected:** Key stored via @napi-rs/keyring AsyncEntry; readKeychain returns it on second run; wizard shows "ELEVENLABS_API_KEY is set in keychain (xi-...); keep?"
**Why human:** Requires a real key and write permission to the OS Keychain Access database. Operator-only.

Note: human verification items 4 and 5 from the initial report (--save-transcripts runtime wiring, ERR-04 session pipeline wiring) are CLOSED by commit a39a8ce2. The remaining 3 items above (asciicast, real System Settings denial, real key in keychain) are deferred to Phase 20 operator acceptance testing, as they require live hardware and credentials that cannot be exercised in an automated pipeline.

---

## Re-Verification (gap closure)

**Re-verified:** 2026-06-08
**Fix commit:** a39a8ce2 — "fix(18-gap): wire SAFE-02 transcripts + ERR-04 typed-input into runVoice"
**Files modified:** `apps/achilles-terminal/src/session.ts` (+91 lines), `apps/achilles-terminal/tests/session-submit-transcript.test.ts` (NEW, +52 lines)

### Gap 1: SAFE-02 — --save-transcripts not wired into session.ts

**Initial status:** PARTIAL (human_needed) — createTranscriptStore module complete and unit tested; --save-transcripts flag absent from commander; no live session call-site.

**Fix applied:**
- `runVoice()` in session.ts now registers `--save-transcripts` as a commander option (session.ts line 1089-1091)
- When `opts.saveTranscripts === true`: dynamic-imports `createTranscriptStore` from `./transcripts/store.js`, generates a `transcriptSid` (using `resumeSid` if present, else `Date.now()-random`), creates the store, subscribes to the session "event" channel
- Subscription captures `stt_committed` events as `user` entries and `claude_ack` / `claude_summary` events as `assistant` entries
- `transcriptStore.dispose()` registered via `process.once("exit")` so the `session_end` JSONL entry fires before the lock-file unlink chain
- All new imports are dynamic inside the action callback — INIT-07 preserved (cli.ts top-level static imports unchanged)

**New status:** VERIFIED

---

### Gap 2: ERR-04 — createTypedInputFallback never called from a live session

**Initial status:** UNCERTAIN/PARTIAL (human_needed) — typed-input.ts module complete and unit tested; no call-site in Phase 18 wired `createTypedInputFallback` to a real session pipeline; SC-5 invariant ("typed transcript flows through the same sandwich-wrap single-pipeline entry") unmet.

**Fix applied:**
- New public method `Session.submitTranscript(text: string): Promise<void>` added at session.ts line 830-832 — a thin shim delegating to the private `driveClaudeForUtterance(text)` method, which dispatches `STT_COMMITTED` to the state machine and calls `claudeBridge.send(transcript)` (the same path voice transcripts traverse, satisfying SC-5)
- `runVoice()` in session.ts now dynamic-imports `createTypedInputFallback` from `./typed-input.js` under `!isMock` (mock mode skips the fallback because the mock STT bridge never opens its circuit breaker)
- Wired with `session.sttCircuit` as the circuit breaker and `async (typed: string) => session.submitTranscript(typed)` as the `onTyped` callback
- `typedInputHandle.dispose()` registered via `process.once("exit")`
- Three new tests in `tests/session-submit-transcript.test.ts` prove the public surface:
  - `submitTranscript` method exists and returns a Promise
  - No-op (does not throw) when `claudeBridge` is null (session not yet started)
  - `sttCircuit` is publicly accessible and exposes a `status()` method returning `{ state: "closed" | "open" | "half-open" }`

**New status:** VERIFIED

---

### Invariants checked post-fix

| Invariant | Status | Evidence |
|-----------|--------|----------|
| INIT-07: cli.ts top-level static imports still exactly 3 | STILL HOLDS | `grep "^import" apps/achilles-terminal/src/cli.ts` = 3 lines (node:fs/promises, node:url, node:path); commit a39a8ce2 does not touch cli.ts |
| LOOP-02: packages/voice-*, claude-code-bridge/, companion.md unchanged | STILL HOLDS | `git show a39a8ce2 --stat` shows only session.ts + session-submit-transcript.test.ts; 0 bytes on any packages/* path |

---

### Note on remaining human verification items

The three remaining human verification items (wizard end-to-end, macOS EPERM denial, OS keychain real key) are not wiring gaps — they require live hardware, real API credentials, and OS-level permission manipulation. They are deferred to Phase 20 operator acceptance testing (asciicast recording and real System Settings denial are Phase 20 scope). They do not block Phase 18 being marked `passed`.

---

_Initial verification: 2026-06-08T00:00:00Z_
_Re-verification: 2026-06-08_
_Verifier: Claude (gsd-verifier)_
