---
phase: 10-claude-code-bridge
verified: 2026-06-06T09:54:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
tests:
  phase_10_unit: 138/138 passed
  phase_09_unit: 145/145 passed (no regression)
  typecheck: exit 0
fixtures:
  - simple-turn.ndjson
  - tool-error.ndjson
  - partial-json.ndjson
  - unknown-event.ndjson
  - spoken-summary.ndjson
  - oversized-line.ndjson
  - cancel-mid-stream.ndjson
commits:
  - 1e61248 # feat(10-01): @achilles/claude-code-bridge scaffold + extractors + workspace plumbing
  - d320e75 # docs(10-01)
  - efbfe1a # feat(10-02): NDJSON line parser + session spawner + authoritative outcome + version check + fixtures
  - 2a0e264 # docs(10-02)
  - 42248d7 # feat(10-03): cancellation primitive with SIGINT/SIGTERM/SIGKILL escalation + --resume after cancel
requirements_completed:
  - LOOP-03
  - LOOP-04
  - LOOP-07
---

# Phase 10: Claude Code Bridge Verification Report

**Phase Goal:** `packages/claude-code-bridge` exposing `createClaudeSession({ systemPromptFile }) -> { send(text), events$, close() }`. Subprocess path uses `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <companion.md> --resume <sid>`. LDJSON line buffer with watchdog protects against partial-JSON-across-reads. Bridge exposes authoritative success/failure signal derived from exit code + tool_result events. Cancellation primitive sends SIGINT.

**Verified:** 2026-06-06T09:54:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fixture transcript causes spawn with locked argv and emits typed events for each NDJSON line on events$ | VERIFIED | `session.test.ts` behaviour 1 + 2 + locked-flags-identity assert argv equals `["-p", "--output-format", "stream-json", "--include-partial-messages", "--append-system-prompt-file", "<path>"]` (no resume) or appends `["--resume", "<sid>"]` (with resume); behaviours 5+6+7 replay `simple-turn.ndjson` and assert the events$ sequence `session_init` -> `assistant_text_delta` -> `assistant_text_done` -> `assistant_done` -> `process_exit` |
| 2 | Corrupted NDJSON stream split across two data events parses cleanly via LDJSON line buffer; no SyntaxError | VERIFIED | `line-parser.test.ts` behaviour 3 (mid-line split) + `session.test.ts` behaviour 9 against `partial-json.ndjson` chunked `[60, rest]` — 0 parse_error events, both objects parse successfully into events$ |
| 3 | session.cancel() sends SIGINT within 50 ms; child terminates; events$ closes; subsequent send(text) starts new session via --resume <sid> with previous session ID preserved | VERIFIED | `cancellation.test.ts` behaviour 1 asserts `Date.now() - start < 50` after `child.kill("SIGINT")`; `session.test.ts` behaviour 5 (LOOP-07) instantiates session A, replays `cancel-mid-stream.ndjson`, awaits `sessionA.cancel()`, then asserts `sessionB._internal.argv` ends with `["--resume", "sid-cancel-001"]`; behaviour 7 asserts events$ terminates after ProcessExit |
| 4 | Bridge emits failure outcome when child exits non-zero or any tool_result is_error, regardless of LLM narration | VERIFIED | `session.test.ts` behaviour 8 replays `tool-error.ndjson` (model narrates "I successfully read the file." after a `tool_result is_error:true` and exit 0); `session.outcome === { kind: "failure", reason: "tool_error" }`; `outcome.test.ts` test 26 + 28 + 30 verify priority `cancelled > tool_error > exit_code` |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/claude-code-bridge/src/index.ts` | Barrel exporting public API + Wave 2 runtime | VERIFIED | Re-exports constants, errors, event-schemas, extractor, types, line-parser, wire-mapper, version-check, outcome, session |
| `packages/claude-code-bridge/src/constants.ts` | LOCKED_FLAGS (6 entries), MIN_CLAUDE_VERSION="2.0.0", MAX_LINE_BYTES=1_048_576, SKIP_VERSION_CHECK_ENV_VAR | VERIFIED | All four constants present and `as const`-typed |
| `packages/claude-code-bridge/src/line-parser.ts` | LDJSON buffer with MAX_LINE_BYTES watchdog | VERIFIED | `createLineParser` ships dual watchdog branches (write-time accumulator overflow + split-time line overflow), discardingUntilNewline tail-suppression mode, `flush()` for trailing partials |
| `packages/claude-code-bridge/src/wire-mapper.ts` | Claude Code wire-format -> ClaudeStreamEvent translator | VERIFIED | `mapWireEvent` is total — dispatches on `wire.type`, falls back to `UnknownEvent { raw }`, final guard via `ClaudeStreamEventSchema.safeParse` |
| `packages/claude-code-bridge/src/version-check.ts` | runVersionCheck + compareSemverStrings + parseVersionFromOutput | VERIFIED | Three exports present; injection seam via `spawnSyncImpl` and `env`; honours `SKIP_VERSION_CHECK_ENV_VAR === "1"` |
| `packages/claude-code-bridge/src/outcome.ts` | deriveOutcome from exit code + tool errors + cancelled flag (never LLM text) | VERIFIED | Priority `cancelled > tool_error > exit_code`; takes only `{ exitCode, toolErrors, cancelled }`; no text input |
| `packages/claude-code-bridge/src/session.ts` | createClaudeSession composing all the above with events$, sessionId, lastTurnText, send, close, cancel | VERIFIED | Public surface present; runVersionCheck called synchronously before spawn; FIFO + waiter-queue events$ terminates after ProcessExit |
| `packages/claude-code-bridge/src/cancellation.ts` | cancelChildProcess SIGINT/SIGTERM/SIGKILL escalation, idempotent | VERIFIED | Per-child WeakMap idempotency cache; synchronous `child.kill("SIGINT")` in executor; `scheduleSigterm` at +1000 ms; `scheduleSigkill` at +2000 ms |
| `packages/claude-code-bridge/src/extractor.ts` | extractAck + extractSpokenSummary pure functions | VERIFIED | Module-scoped regex constants; 120-char ack cap; spoken-summary distinguishes absent (null) vs empty (""); both marked pure |
| `packages/claude-code-bridge/test/fixtures/tool-error.ndjson` | Pitfall #17 regression fixture | VERIFIED | 6 lines: tool_result is_error=true followed by narration "I successfully read the file." plus result:success |
| `packages/claude-code-bridge/test/fixtures/partial-json.ndjson` | Mid-line chunk split fixture | VERIFIED | 2 lines, exercised by test with `splitAt: 60` |
| `packages/claude-code-bridge/test/fixtures/cancel-mid-stream.ndjson` | session_init + partial assistant_text_delta + abrupt close | VERIFIED | 2 content lines; tests simulate abrupt close via `child.emit("exit", null, "SIGINT")` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `session.ts` | `line-parser.ts` | `createLineParser()` + pipe child.stdout chunks | WIRED | Line 51, 319, 337–339 (stdout.on("data") -> parser.write); flush on end + exit |
| `session.ts` | `wire-mapper.ts` | `mapWireEvent(obj)` on each parsed JSON | WIRED | Line 53, 320–323 (parser.on("json") emits mapped event) |
| `session.ts` | `version-check.ts` | `runVersionCheck({ env })` synchronously before spawn | WIRED | Line 54, 142–143 (called BEFORE `spawnImpl`) |
| `session.ts` | `outcome.ts` | `deriveOutcome({ exitCode, toolErrors, cancelled })` on exit | WIRED | Line 55, 370 (inside child.on("exit") handler) |
| `session.ts` | `cancellation.ts` | `cancelChildProcess({ child })` via session.cancel() | WIRED | Line 56, 473 (only when not exited) |
| `session.ts` | `constants.ts` | argv built from `LOCKED_FLAGS` | WIRED | Line 50, 211 (`recipe: string[] = [...LOCKED_FLAGS]`) |
| `cancellation.ts` | `outcome.ts` | sets `cancelled` flag in session closure (not direct import) | WIRED | session.ts line 472 sets `cancelled = true` before awaiting cancelChildProcess; deriveOutcome reads it from closure |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 10 unit tests pass | `npx vitest run --project phase-10-unit` | 9 files / 138 tests passed | PASS |
| Phase 9 unit tests still pass (no regression) | `npx vitest run --project phase-09-unit` | 17 files / 145 tests passed | PASS |
| Typecheck succeeds | `npm run typecheck --workspace @achilles/claude-code-bridge` | `tsc --noEmit` exit 0 | PASS |
| CR-07 hygiene (no compiled artifacts in src) | `find packages/claude-code-bridge/src \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' \) | wc -l` | 0 | PASS |
| All committed fixtures present | `ls packages/claude-code-bridge/test/fixtures/` | 7 fixtures listed (5 committed + 2 generated) | PASS |
| Commits present in git log | `git log --oneline -10` | All 5 expected commits (1e61248, d320e75, efbfe1a, 2a0e264, 42248d7) visible | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|----------|
| LOOP-03 | 10-02 | Transcript injection via locked argv + stream-json + session ID persistence across utterances | SATISFIED | `session.ts` buildArgv produces locked argv; `send()` writes to stdin; `sessionId` captured from session_init; behaviour 5 verifies --resume flow |
| LOOP-04 | 10-01, 10-02 | NDJSON line-by-line parsing + spoken acknowledgement + `<spoken-summary>` extractor (TTS routing is Phase 12) | SATISFIED | `line-parser.ts` ships LDJSON parser; `extractor.ts` ships pure extractAck (120-char cap) + extractSpokenSummary (null vs empty distinction); 16 extractor tests + 11 line-parser tests pass |
| LOOP-07 | 10-03 | User can cancel in-flight job; SIGINT to child; TTS-stop and UI-idle are Phase 12 wiring | SATISFIED (bridge contract) | `session.cancel()` returns Promise<ProcessExitEvent>; cancellation primitive ships SIGINT/SIGTERM/SIGKILL escalation; session.sessionId preserved for --resume next turn; TTS-stop and UI-idle deferred to Phase 12 wiring (correctly scoped — bridge surface delivered) |

No orphaned requirements — all three Phase 10 requirements (LOOP-03, LOOP-04, LOOP-07) are declared in the plan frontmatter and implemented in code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| _none_ | — | — | — | — |

Scans performed:
- `grep -rE "TBD|FIXME|XXX" packages/claude-code-bridge/src/ --include="*.ts"` (excluding `.test.ts`) — 0 matches
- `grep -rE "TODO|HACK|PLACEHOLDER" packages/claude-code-bridge/src/ --include="*.ts"` (excluding `.test.ts`) — 0 matches
- `grep -rn "console\." packages/claude-code-bridge/src/ --include="*.ts"` (excluding `.test.ts`) — only one JSDoc match asserting purity in `extractor.ts:35` (a documentation comment, not a call site)
- Production source has no debt markers, no warning-level cleanup comments, no console logging. The package logs nothing — neither the prompt body (T-10-10) nor any state. The bridge is observation-only.

### Stub Detection (Three-Level Artifact Check)

Every artifact passes all three levels (exists + substantive + wired) plus Level 4 data-flow trace where applicable:

- `line-parser.ts` (214 lines) — substantive watchdog state machine; wired via session.ts line 319; data flows from child.stdout
- `wire-mapper.ts` (208 lines) — substantive constructVariant + safeParse guard; wired via session.ts line 320–323; data flows from parsed JSON
- `version-check.ts` (178 lines) — substantive spawnSync probe + semver compare; wired via session.ts line 142–143
- `outcome.ts` (87 lines) — substantive priority derivation; wired via session.ts line 370 inside exit handler; data flows from authoritative signals only
- `session.ts` (497 lines) — substantive composition of all the above with closure-based state; data flows through events$ FIFO
- `cancellation.ts` (238 lines) — substantive escalation state machine with WeakMap idempotency cache; wired via session.cancel() line 473
- `extractor.ts` (157 lines) — substantive pure functions over input strings; wired through barrel for Phase 12 consumption (consumption happens in Phase 12, not Phase 10 — extractor wiring is correctly deferred per plan scope)

### Probe Execution

This phase is library infrastructure; no `scripts/*/tests/probe-*.sh` exists for Phase 10. Vitest-based probes (the test suites) are the canonical PASS markers and were executed by this verifier (138/138 pass).

### Human Verification Required

_None._

Phase 10 is library infrastructure with fixture-driven test coverage. The four ROADMAP success criteria are observable via deterministic vitest assertions against real NDJSON fixtures and verified argv shapes. The `ACHILLES_LIVE_CLAUDE=1` gated integration test (real `claude` CLI invocation) is intentionally deferred to Phase 12 / Phase 14 per CONTEXT.md "Optional; CI default is fixture-driven" — that is correct scope.

There is no UI, no real-time behavior, no external service to verify visually. All wiring is traceable through `grep`, all behavior is verifiable through fixtures, and all timing is verifiable through vitest fake timers (cancellation grace periods).

### Gaps Summary

_None._

All four ROADMAP success criteria pass. All three required artifacts plus the auxiliary cancellation, version-check, outcome, and extractor modules exist, are substantive, are wired into `session.ts`, and have data flowing through them. Tests confirm behaviour against real fixtures including the Pitfall #17 regression (`tool-error.ndjson` — model narrates success while tool errored). The cancellation primitive's synchronous SIGINT path is verified within the 50 ms wall budget. The resume-after-cancel argv shape is verified end-to-end via two-session integration test. No debt markers, no anti-patterns, no console logging, no CR-07 hygiene violations.

The bridge ships the complete public surface Phase 12 will wire to:
- `events$`, `sessionId`, `lastTurnText`, `outcome`, `send`, `cancel`, `close`
- `extractAck`, `extractSpokenSummary`
- Types: `ClaudeBridgeEvent`, `ClaudeOutcome`, `CreateClaudeSessionOptions`, `ProcessExitEvent`
- `ClaudeVersionError`

Phase 10 is complete. Wave 2 may proceed to Phase 11 / Phase 12.

---

*Verified: 2026-06-06T09:54:00Z*
*Verifier: Claude (gsd-verifier)*
