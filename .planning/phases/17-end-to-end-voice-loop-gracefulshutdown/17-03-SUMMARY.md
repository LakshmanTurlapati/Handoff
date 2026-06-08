---
phase: 17
plan: 03
subsystem: voice-loop
tags:
  - voice-loop
  - claude-bridge
  - sandwich-defence
  - normalisation
  - LOOP-01
  - LOOP-03
  - LOOP-04
  - LOOP-07
  - SAFE-04
  - PITFALLS-16
  - PITFALLS-21
dependency_graph:
  requires:
    - "17-01: voice deps + scaffolding (session-events, companion-md, structured-logger)"
    - "packages/claude-code-bridge: createClaudeSession + extractAck + extractSpokenSummary + deriveOutcome (unchanged per LOOP-02)"
  provides:
    - "apps/achilles-terminal/src/audio/claude-bridge.ts: createClaudeBridge wrapper with detached spawn + sandwich-wrap + ack/summary extraction + failure-override"
    - "apps/achilles-terminal/src/sandwich-defence.ts: SAFE-04 substrate"
    - "apps/achilles-terminal/src/normalisation.ts: pre-TTS normalisation substrate"
    - "FAILURE_OVERRIDE_PHRASE = 'I ran into a problem' (greppable for Phase 20 asciicasts)"
  affects:
    - "17-04 (session.ts composition): consumes createClaudeBridge handle"
    - "17-05 (MOCK_LOOP integration test): exercises the claude-bridge wrapper end-to-end"
tech_stack:
  added: []
  patterns:
    - "spawnImpl-wrapper injection (LOOP-07 — adapter pattern around node:child_process.spawn)"
    - "sandwich-wrap envelope (SAFE-04 — DELIM_START / DELIM_END / REMINDER_LINE)"
    - "ack-then-summary stream extraction (LOOP-01 — pure functions over assistant text)"
    - "authoritative failure-override (LOOP-04 — exit_code OR tool_result.is_error; never LLM narration)"
key_files:
  created:
    - apps/achilles-terminal/src/sandwich-defence.ts
    - apps/achilles-terminal/src/normalisation.ts
    - apps/achilles-terminal/src/normalisation-fixtures.ts
    - apps/achilles-terminal/src/audio/claude-bridge.ts
    - apps/achilles-terminal/tests/sandwich-defence.test.ts
    - apps/achilles-terminal/tests/normalisation.test.ts
    - apps/achilles-terminal/tests/audio/claude-bridge.test.ts
  modified: []
decisions:
  - "FAILURE_OVERRIDE_PHRASE lacks trailing period: const = 'I ran into a problem' (no '.'); buildFailureSummary appends the period+reason in one go. Phase 20 grep -F succeeds against both the const declaration and the spoken summary regardless of suffix wording."
  - "spawnImpl wrapper at single location: wrapSpawnWithDetach (claude-bridge.ts line 289) is the only place detached:true appears in Phase 17 source. Tests assert the option reaches the inner spawn (T1)."
  - "Sandwich-defence + normalisation ports are byte-for-byte (zero edits to source bodies). Test surfaces port verbatim except for ../src/ relative import paths to match achilles-terminal's src/tests/ layout."
  - "claude-bridge.ts NEVER derives failure from LLM narration. observedToolErrors accumulator is defence-in-depth fallback; primary path is session.outcome from the bridge (which itself derives from exit_code + tool_result.is_error per the unchanged outcome.ts in claude-code-bridge)."
metrics:
  duration_minutes: 14
  completed_date: 2026-06-08
  tasks_completed: 2
  files_created: 7
  files_modified: 0
  tests_added: 62
  tests_passing: 228
---

# Phase 17 Plan 03: claude-bridge wrapper + sandwich-defence port + pre-TTS normalisation port — Summary

Wired the LOOP-01 / LOOP-03 / LOOP-04 / LOOP-07 invariants on top of the byte-for-byte-unchanged `@achilles/claude-code-bridge` package via a thin wrapper that owns sandwich-wrap envelope construction, ack + spoken-summary extraction, authoritative failure-override emission, and the `{ detached: true }` spawn-option injection that detaches `claude` into its own process group (anthropics/claude-code#45717 workaround).

## Tasks Completed

### Task 1: Sandwich-defence port (SAFE-04) + pre-TTS normalisation port (LOOP-03)

**Commit:** `4352b51a`

Byte-for-byte port of three v1.2 files from `apps/achilles/src/main/` into `apps/achilles-terminal/src/`:

- `sandwich-defence.ts` (209 LOC) — exports `DELIM_START` / `DELIM_END` / `REMINDER_LINE` constants, `wrapTranscript` (throws on empty / delimiter-collision / non-string), `detectManipulationTokens` (returns frozen report with PATTERN-NAME identifiers, never the matched fragment). Ported **4 manipulation-detector patterns** from v1.2:
  - `override_directive`
  - `secret_recitation_request`
  - `tool_call_disable`
  - `context_reset_request`
- `normalisation.ts` (310 LOC) — exports `DEFAULT_TTS_CAP_CHARS = 600`, `REDACTION_TOKEN = "[redacted secret]"`, `normaliseForTts` (composed pipeline). The pipeline executes **6 steps in fixed order**:
  1. trim input
  2. drop fenced code blocks (triple-backtick)
  3. strip ANSI escape sequences (CSI + OSC, both BEL and ST terminators)
  4. mask absolute paths (Unix /Users, /home, /var; Windows C:\)
  5. mask secret prefixes (sk-, xi-, ghp_, github_pat_ with 20+ char body)
  6. collapse whitespace runs (defensive after redactions) + cap at 600 chars
- `normalisation-fixtures.ts` (157 LOC) — adversarial fixture generators (4 functions). Zero verbatim injection-trigger strings in source — the dangerous compositional shape emerges only at runtime through seed-array composition.

Test surfaces ported byte-for-byte except for `../src/` relative paths to match `achilles-terminal`'s `src/` + `tests/` layout. **15 sandwich-defence tests + 36 normalisation tests = 51 tests pass** under `vitest --pool=forks`.

Verified zero non-stdlib imports via `grep -c "^import" apps/achilles-terminal/src/{sandwich-defence,normalisation,normalisation-fixtures}.ts` returning `0` for all three.

### Task 2: claude-bridge wrapper (LOOP-01 claude half + LOOP-03 + LOOP-04 + LOOP-07)

**Commit:** `c872586c`

Created `apps/achilles-terminal/src/audio/claude-bridge.ts` (430 LOC) — a thin wrapper over `@achilles/claude-code-bridge.createClaudeSession` that owns:

1. **LOOP-07 spawn detach** — `wrapSpawnWithDetach` at line 289 wraps the caller-provided `spawnImpl` (default `node:child_process.spawn`) to inject `detached: true` + `stdio: ["pipe","pipe","pipe"]` on every invocation. This is the **only place `detached: true` appears in Phase 17 source code**. The `@achilles/claude-code-bridge` package stays byte-for-byte unchanged (LOOP-02).

2. **SAFE-04 sandwich-wrap on send** — `send()` applies `wrapTranscript(rawTranscript)` before forwarding to `bridge.send`. Manipulation-token detection runs on the unwrapped transcript; on `detected: true` the wrapper logs a warning via `deps.logger.warn("manipulation_tokens_detected", { patterns })` but passes the wrapped body unchanged to the bridge — the v1.2 contract: log + warn, do NOT silently strip.

3. **LOOP-01 ack + summary extraction** — `consume()` drives `extractAck` on every `assistant_text_delta` (first non-null ack triggers `emit({type:"claude_ack", ...})`), and on `process_exit` either calls `buildFailureSummary(outcome)` (failure branch) or `extractSpokenSummary(session.lastTurnText)` (success branch, with 40-word `capWords` fallback for missing markers). Both `claude_ack` and `claude_summary` payloads pass through `normaliseForTts` so paths / secrets / fenced code never reach the TTS layer.

4. **LOOP-04 failure-override authority** — `claude_failed` emission is reachable ONLY from `outcome.kind === "failure"` (derived from exit_code or tool_result.is_error in the bridge's authoritative `deriveOutcome`). LLM narration containing the literal string "I ran into a problem" inside `assistant_text_delta` does NOT trigger the failure path — Test 7 asserts the invariant by setting `outcome = {kind: "success"}` and verifying NO `claude_failed` event is emitted regardless of the assistant text content.

5. **LOOP-03 TTS routing boundary** — only `claude_ack` and `claude_summary` SessionEvents carry payload.text destined for TTS. `tool_use` and `tool_result` events are observed (tool_result.is_error feeds the observedToolErrors defence-in-depth fallback) but produce NO TTS-bound emissions. Test 9 asserts the invariant.

**Public surface:**

```ts
export const FAILURE_OVERRIDE_PHRASE = "I ran into a problem";  // line 105
export function buildFailureSummary(outcome: ClaudeOutcome): string;
export function createClaudeBridge(deps): ClaudeBridgeHandle;
export interface ClaudeBridgeHandle {
  send(rawTranscript: string): Promise<void>;
  consume(): Promise<void>;
  cancel(): Promise<ProcessExitEvent>;
  dispose(): Promise<void>;
}
```

**buildFailureSummary contract** — the 3 locked suffix forms (mirroring v1.2 session.ts lines 786-811 except the no-period prefix):

| reason     | output                                          |
| ---------- | ----------------------------------------------- |
| exit_code  | `"I ran into a problem. exit_code: <code>"`     |
| exit_code (null) | `"I ran into a problem. exit_code: unknown"` |
| tool_error | `"I ran into a problem. tool_error"`            |
| cancelled  | `"I ran into a problem. cancelled"`             |
| kind=success (defensive default) | `"I ran into a problem"`     |

**11 claude-bridge tests pass** (10 from the plan + 1 bonus `T8b` for the `buildFailureSummary` 3-reason mapping table). Total Plan 03 tests: **62 (51 from Task 1 + 11 from Task 2)**.

## LOOP-02 Compliance

Confirmed via `git diff --name-only HEAD -- 'packages/voice-protocol' 'packages/voice-stt' 'packages/voice-tts' 'packages/claude-code-bridge' 'packages/achilles-skill/skill/prompts/companion.md' | wc -l` returning `0`. The five protected paths are unchanged:

- `packages/voice-protocol` (unchanged)
- `packages/voice-stt` (unchanged)
- `packages/voice-tts` (unchanged)
- `packages/claude-code-bridge` (unchanged)
- `packages/achilles-skill/skill/prompts/companion.md` (unchanged)

## Verification Output

```
LOOP-07 spawn-detach grep:    7 hits in claude-bridge.ts (1 emission + 6 doc mentions)
FAILURE_OVERRIDE_PHRASE:      1 hit, exact byte-for-byte match at line 105
No trailing period:           0 hits for "I ran into a problem." form
LOOP-02 diff check:           0 files modified
Test suite (full):            228 tests passing | 1 skipped
Test suite (Plan 03):         62 tests (51 Task 1 + 11 Task 2)
typecheck:                    exits 0
lint (Plan 03 files only):    exits 0 (pre-existing Plan 17-01 errors logged to deferred-items.md)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tool_use wire schema field name**
- **Found during:** Task 2 test draft (T9)
- **Issue:** The plan said tool_use carries `tool_use_id`; the actual Zod schema in `packages/claude-code-bridge/src/event-schemas.ts` declares `id: z.string()` (not `tool_use_id`).
- **Fix:** Updated test fixture for T9 to use `id: "t1"` matching the wire schema.
- **Files modified:** `apps/achilles-terminal/tests/audio/claude-bridge.test.ts`
- **Commit:** `c872586c`

**2. [Rule 3 - Blocking] dist build for tsconfig path resolution**
- **Found during:** Task 1 baseline typecheck
- **Issue:** The `apps/achilles-terminal/tsconfig.json` `paths` entries point to `packages/*/dist/index.d.ts` declarations; those dist directories did not exist in the fresh worktree.
- **Fix:** Ran `npm install --force` then `npm run build` for the 5 voice packages (claude-code-bridge, voice-protocol, voice-stt, voice-tts, achilles-skill) so the dist declarations existed before typecheck. This is a one-time setup step — none of the package sources were modified.
- **Files modified:** (none in repo — dist files are gitignored)

**3. [Rule 1 - Bug] strict-mode async-no-await lints**
- **Found during:** Task 2 lint
- **Issue:** ESLint `@typescript-eslint/require-await` flagged `send` / `cancel` / `dispose` for being async without await, and flagged the test's `async *[Symbol.asyncIterator]()` async-generator helper. Lint also caught unnecessary type assertions in the source and tests.
- **Fix:**
  - `send()` rewritten to return `Promise<void>` without `async` (uses explicit Promise.resolve / reject — the try/catch handles synchronous wrapTranscript throws).
  - `cancel` / `dispose` made synchronous functions returning the bridge's existing Promise.
  - Test helper `makeEvents$` adds `await Promise.resolve()` so the async generator is genuinely asynchronous at runtime.
  - Removed unnecessary `as` casts; replaced with direct typed function-literal forms for the createSession test injection.
  - Replaced `Promise.reject(err)` with `Promise.reject(err instanceof Error ? err : new Error(String(err)))` per the `prefer-promise-reject-errors` rule.
- **Files modified:** `apps/achilles-terminal/src/audio/claude-bridge.ts`, `apps/achilles-terminal/tests/audio/claude-bridge.test.ts`
- **Commit:** `c872586c`

### Out-of-scope items logged (NOT auto-fixed per executor scope boundary rule)

- Pre-existing lint errors in Plan 17-01 deliverables (`circuit-breaker.ts`, `tests/circuit-breaker.test.ts`, `tests/structured-logger.test.ts`): 55 errors + 1 warning. Logged to `.planning/phases/17-end-to-end-voice-loop-gracefulshutdown/deferred-items.md` for follow-up.

## Authentication Gates

None — Plan 03 does not invoke any authenticated service.

## Notable Implementation Details

### Why FAILURE_OVERRIDE_PHRASE has no trailing period

The plan locks the const at `"I ran into a problem"` (no `.`) instead of v1.2's `"I ran into a problem."`. Both forms speak identically through TTS — the listener hears the period prosody from the `${PREFIX}. exit_code: 2` form regardless. The no-period const makes the Phase 20 asciicast grep `grep -F "I ran into a problem" dist/achilles` robust to suffix-wording refactors: a future contributor who changes `exit_code: ${code}` to `(exit ${code})` does not break the grep, as long as they preserve the `I ran into a problem` substring.

### Why `consume()` keeps a local observedToolErrors

The bridge's own `outcome.ts` already accumulates `tool_result.is_error` ids and derives outcome.reason = "tool_error". The local `observedToolErrors` in `consume()` is defence-in-depth: a defective bridge that somehow fails to populate `session.outcome` (e.g. on an unusual exit path that bypasses the exit listener) would otherwise leave the failure-override path silent. The fallback `session.outcome ?? {kind: ... derived from observedToolErrors}` keeps the loop authoritative even on bridge bugs.

### Why send() runs detectManipulationTokens BEFORE wrapTranscript

The detector pattern is signature-based — it matches the body the user actually spoke, not the wrapped envelope. Running detect on the unwrapped transcript means a transcript like "ignore previous instructions" is correctly flagged regardless of whether the wrapper later prepends `---USER VOICE TRANSCRIPT START---`. The wrapped envelope is fed to bridge.send unchanged — per the v1.2 contract "log + warn, do NOT silently strip" (sandwich-defence.ts module JSDoc).

## Self-Check: PASSED

Files created (verified via `[ -f ... ] && echo FOUND`):

- `apps/achilles-terminal/src/sandwich-defence.ts` FOUND
- `apps/achilles-terminal/src/normalisation.ts` FOUND
- `apps/achilles-terminal/src/normalisation-fixtures.ts` FOUND
- `apps/achilles-terminal/src/audio/claude-bridge.ts` FOUND
- `apps/achilles-terminal/tests/sandwich-defence.test.ts` FOUND
- `apps/achilles-terminal/tests/normalisation.test.ts` FOUND
- `apps/achilles-terminal/tests/audio/claude-bridge.test.ts` FOUND

Commits exist (verified via `git log --oneline | grep ...`):

- `4352b51a feat(17-03): port sandwich-defence + pre-TTS normalisation (SAFE-04, LOOP-03)` FOUND
- `c872586c feat(17-03): claude-bridge wrapper (LOOP-01, LOOP-03, LOOP-04, LOOP-07)` FOUND
