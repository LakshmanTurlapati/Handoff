---
phase: 10-claude-code-bridge
plan: 02
subsystem: claude-code-bridge
tags: [typescript, ndjson, child-process, vitest, claude-code, line-buffer, watchdog, semver, async-iterable]

# Dependency graph
requires:
  - phase: 10-claude-code-bridge
    plan: 01
    provides: "package scaffold, 9-variant ClaudeStreamEventSchema, ClaudeBridgeEvent union, ClaudeVersionError, CreateClaudeSessionOptions, ClaudeOutcome, LOCKED_FLAGS, MIN_CLAUDE_VERSION, MAX_LINE_BYTES, SKIP_VERSION_CHECK_ENV_VAR, extractAck, extractSpokenSummary"
provides:
  - "createLineParser — LDJSON line buffer with MAX_LINE_BYTES (1 MiB) watchdog (Pitfall #8)"
  - "mapWireEvent — Claude Code stream-json wire-format -> ClaudeStreamEvent translator with UnknownEvent fallback"
  - "runVersionCheck + compareSemverStrings + parseVersionFromOutput — synchronous `claude --version` gate (Pitfall #24)"
  - "deriveOutcome — authoritative success/failure from exit code + tool_result.is_error + cancellation flag (Pitfall #17, NEVER consults LLM narration)"
  - "createClaudeSession — child-process spawner composing all the above; events$ AsyncIterable, sessionId capture, lastTurnText accumulation, send(text), close()"
  - "MockClaudeProcess test helper for fixture-driven replay"
  - "6 golden NDJSON fixtures (simple-turn, tool-error, partial-json, unknown-event, spoken-summary, oversized-line) — 5 committed + 1 generated at test time"
affects:
  - "10-claude-code-bridge plan 03 (cancellation primitive will layer SIGINT-then-SIGTERM-then-SIGKILL escalation onto the existing close() graceful path; consumes _internal.childPid and the existing exit-event plumbing)"
  - "12-end-to-end-integration (apps/achilles main session consumes createClaudeSession, sessionId for --resume, lastTurnText + extractors for TTS routing, outcome for spoken-completion variant)"
  - "14-hardening (consumes outcome + parse_error + process_exit events for stuck-thinking timeout + graceful degradation)"

# Tech tracking
tech-stack:
  added: []  # zero new npm dependencies; only Node built-ins added on top of the 10-01 scaffold
  patterns:
    - "LDJSON line buffer: Buffer accumulator + split-on-\\n + per-line MAX_LINE_BYTES watchdog with discardingUntilNewline tail-suppression mode"
    - "Wire-mapper as the boundary that absorbs future Claude Code field renames: defensive isRecord guard + per-variant constructVariant switch + final round-trip through ClaudeStreamEventSchema.safeParse"
    - "Test-injection seam via JSDoc @internal SessionDeps interface ({ spawnImpl?, runVersionCheck? }) — production callers omit, tests pass vi.fn() stubs; no production code path ever sets _deps"
    - "events$ AsyncIterable: FIFO + waiter-queue resolver pattern with explicit termination signal (process_exit yielded -> streamEnded=true -> subsequent .next() returns done:true)"
    - "MockClaudeProcess in test/ (NOT src/) so the package tsconfig exclude rule keeps it out of dist/"

key-files:
  created:
    - packages/claude-code-bridge/src/line-parser.ts
    - packages/claude-code-bridge/src/line-parser.test.ts
    - packages/claude-code-bridge/src/wire-mapper.ts
    - packages/claude-code-bridge/src/wire-mapper.test.ts
    - packages/claude-code-bridge/src/version-check.ts
    - packages/claude-code-bridge/src/version-check.test.ts
    - packages/claude-code-bridge/src/outcome.ts
    - packages/claude-code-bridge/src/outcome.test.ts
    - packages/claude-code-bridge/src/session.ts
    - packages/claude-code-bridge/src/session.test.ts
    - packages/claude-code-bridge/test/mock-claude-process.ts
    - packages/claude-code-bridge/test/fixtures/simple-turn.ndjson
    - packages/claude-code-bridge/test/fixtures/tool-error.ndjson
    - packages/claude-code-bridge/test/fixtures/partial-json.ndjson
    - packages/claude-code-bridge/test/fixtures/unknown-event.ndjson
    - packages/claude-code-bridge/test/fixtures/spoken-summary.ndjson
    - packages/claude-code-bridge/test/fixtures/.gitignore
  modified:
    - packages/claude-code-bridge/src/index.ts

key-decisions:
  - "send(text) writes `text + \"\\n\"` to child.stdin then calls stdin.end(). This is the CONTEXT.md \"Process control\" default for `claude -p` non-interactive mode; the positional-argument alternative is documented in the source as a known fallback but requires the prompt before spawn, conflicting with the spawn-then-send lifecycle."
  - "send(text) is idempotent — second call is a no-op. Phase 10 fixture model is one-prompt-per-session; multi-prompt routing is Phase 12's responsibility and will likely use --resume to start a fresh send-cycle."
  - "Watchdog fires on both 'accumulator has no \\n and exceeds MAX_LINE_BYTES' AND 'completed line itself exceeds MAX_LINE_BYTES'. Plan only specified the first; the second is required to make the oversized-line.ndjson fixture (which contains a 1.05 MB line WITH its terminating \\n in one buffer) emit parse_error rather than parse a huge JSON object."
  - "events$ termination contract: after ProcessExit is yielded, any subsequent .next() on the SAME iterator (or a fresh one) returns done:true immediately. The iterator never throws on second-consumption — the iterable serves the ordered FIFO once then terminates cleanly."
  - "MockClaudeProcess.writeOversizedFixture takes a destPath rather than reading from a class field so the test can choose its own path. The 1.05 MB fixture is .gitignore'd; the helper recreates it in beforeAll."
  - "Wire-mapper preserves UNKNOWN payloads on `raw` even for non-object / non-string-type inputs. This is more defensive than the plan strictly requires (which only specifies the unknown-event fall-through for typed-but-unrecognised shapes) — it keeps mapWireEvent total."

patterns-established:
  - "Pure-function watchdog with two trip conditions: (a) accumulator-without-newline overflow (write-time) and (b) completed-line overflow (split-time). Both emit parse_error with error: \"line_too_long\"."
  - "AsyncIterable session pattern with explicit terminal event: emit the terminal event, drain pending waiters, then mark streamEnded=true. New iterators created after stream-end return done:true immediately rather than hanging."
  - "Session deps injection seam: deps?.spawnImpl + deps?.runVersionCheck cover 100% of the IO surface; production code never sets _deps, tests get full control without touching the IO primitives."

requirements-completed: [LOOP-03]

# Metrics
duration: 11min
completed: 2026-06-06
---

# Phase 10 Plan 02: NDJSON Line Parser + Session Spawner + Authoritative Outcome + Version Check Summary

**Runtime spine of @achilles/claude-code-bridge: LDJSON watchdog parser + wire-format mapper + synchronous version gate + LLM-narration-immune outcome derivation + createClaudeSession composing all five against Node `child_process.spawn` — Phase 10 success criteria 1, 2, and 4 delivered.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-06T14:14:52Z
- **Completed:** 2026-06-06T14:25:59Z
- **Tasks:** 3 (executed atomically per execute-context single-commit policy)
- **Files modified:** 18 (17 created + 1 modified — `src/index.ts` barrel update)
- **Tests added:** 63 (11 line-parser + 13 wire-mapper + 16 version-check + 9 outcome + 14 session)
- **Tests passing:** 116/116 phase-10-unit suite (53 from 10-01 + 63 new from 10-02); phase-09-unit 145/145 unchanged (no regression)

## Accomplishments

- LOOP-03 delivered: `createClaudeSession({ systemPromptFile, resumeSessionId? })` spawns `claude` with the locked argv set, captures `session_id` from `session_init`, and supports session resume via `--resume <sid>` on subsequent calls.
- Phase 10 success criterion 1 met: the locked flag set is honoured exactly. Test 1 + Test 2 + the locked-flags-identity test assert `argv === ["-p", "--output-format", "stream-json", "--include-partial-messages", "--append-system-prompt-file", "<path>"]` (without resume) or `[..., "--resume", "<sid>"]` (with resume).
- Phase 10 success criterion 2 met: partial JSON across reads parses cleanly. The partial-json.ndjson fixture is chunk-split [60 bytes, rest] mid-line; the LDJSON line buffer correctly defers parsing until the newline arrives in the second chunk; zero parse_error events; both objects emitted in order.
- Phase 10 success criterion 4 met: authoritative success/failure ignores LLM narration. The tool-error.ndjson fixture contains a `tool_result` with `is_error=true` followed by assistant text claiming "I successfully read the file." plus a `result subtype:success`. `session.outcome` is `{ kind: "failure", reason: "tool_error" }` regardless.
- LDJSON watchdog (Pitfall #8) ships with both trip conditions: write-time overflow (accumulator exceeds MAX_LINE_BYTES without a newline) and split-time overflow (a completed line itself exceeds MAX_LINE_BYTES). The oversized-line.ndjson fixture (line 1 = 1 MiB + 124 bytes; line 2 = valid result) emits exactly one `parse_error` for line 1 and one successful parse for line 2.
- Wire-mapper defensive fallback (forward-compat surface): future Claude Code event types degrade to `unknown_event { raw }` with the original payload preserved; the unknown-event.ndjson fixture verifies the stream continues past the unknown variant and `assistant_done` + `process_exit` still arrive in order.
- Synchronous version check (Pitfall #24): `runVersionCheck` runs BEFORE the streaming spawn. When the fake `spawnSyncImpl` returns `Claude Code 1.9.5`, `ClaudeVersionError` is thrown with `actualVersion="1.9.5"` and `requiredVersion="2.0.0"` and the streaming `spawnImpl` is NEVER called. With `ACHILLES_SKIP_CLAUDE_VERSION_CHECK=1`, the probe is skipped entirely (no spawn).
- `session.lastTurnText` accumulates assistant text deltas and is replaced by the authoritative `full_text` on `assistant_text_done` — Phase 12's extractor inputs are stable.
- `events$` AsyncIterable: single-consumer FIFO + waiter-queue. `process_exit` is the FINAL event; the iterator terminates after it; subsequent `.next()` calls return `done:true` immediately. No double-consumption hazard (per Phase 09 WR-03 lesson).
- ZERO new npm dependencies. Only Node built-ins (`node:child_process`, `node:buffer`, `node:events`, `node:stream`, `node:fs`, `node:path`, `node:url`) on top of the 10-01 scaffold's `zod`.
- `dist/` builds clean: 11 source files compile to 11 `.js` + 11 `.d.ts` (plus source / declaration maps). No test files in `dist/`. The CR-06 + CR-07 hygiene checks pass: `find packages/claude-code-bridge/src \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' \) | wc -l` returns 0.

## Task Commits

This plan was delivered as a single atomic commit per the execute-context policy:

1. **Task 1: LDJSON line parser with watchdog + golden NDJSON fixtures + MockClaudeProcess test helper** — part of `efbfe1a`
2. **Task 2: Wire-format mapper, version-check probe, and authoritative outcome derivation** — part of `efbfe1a`
3. **Task 3: createClaudeSession spawner — argv assembly, events$ AsyncIterable, sessionId capture, --resume flow** — part of `efbfe1a`

**Atomic plan commit:** `efbfe1a` (feat(10-02): NDJSON line parser + session spawner + authoritative outcome + version check + fixtures)

_Note: Each of the three tasks followed RED-GREEN inside the commit-assembly window. RED was verified by running the new test files against missing modules (`Failed to load url ./<file>.js`). GREEN was verified by re-running after the production code was written; all 63 new test cases passed on the first GREEN run except behaviour-5 of the line parser (oversized-line fixture), which exposed a missing watchdog branch — the split-time-overflow check — that was added as a Rule 1 auto-fix and re-verified GREEN before the commit was assembled._

## LOOP-03 Verification

The exact argv shape produced by `createClaudeSession` is asserted in session.test.ts:

**Without `resumeSessionId`:**
```
["-p", "--output-format", "stream-json", "--include-partial-messages",
 "--append-system-prompt-file", "/tmp/companion.md"]
```
6 elements; no `--resume`.

**With `resumeSessionId: "sid-prior-001"`:**
```
["-p", "--output-format", "stream-json", "--include-partial-messages",
 "--append-system-prompt-file", "/tmp/companion.md",
 "--resume", "sid-prior-001"]
```
8 elements; `--resume <sid>` appended as the final two argv entries after the systemPromptFile path.

Both shapes round-trip through the `argv === LOCKED_FLAGS` identity check (the first 5 elements of argv equal `LOCKED_FLAGS.slice(0, 5)` verbatim).

## Pitfall #8 Verification (partial JSON across reads)

Fixture: `packages/claude-code-bridge/test/fixtures/partial-json.ndjson` (2 lines; line 1 is 119 bytes + `\n`; line 2 is 67 bytes + `\n`; total 188 bytes).

Test scenario: read the fixture as a Buffer (188 bytes), then write to the parser as two chunks: `buf.subarray(0, 60)` and `buf.subarray(60)`. The split at byte 60 is INSIDE line 1, so the parser sees:
- chunk 1: 60 bytes, no `\n` -> accumulator length 60, no parse, no error.
- chunk 2: 128 bytes containing the tail of line 1 + `\n` + line 2 + `\n` -> the parser splits at byte 119 (where the first `\n` is), parses line 1 successfully, advances, then parses line 2 successfully.

Result: **2 successful parses, 0 parse_error events**. SyntaxError is NOT thrown despite the chunk boundary cleaving inside a JSON object. The chunk-boundary check is also exercised at the session level in behaviour 9 with the same [60, rest] split via `replayFixture(child, fixturePath, { splitAt: 60 })` — the session.events$ emits `session_init` + `assistant_text_done` + `process_exit` with zero `parse_error` events in between.

## Pitfall #17 Verification (LLM narration vs. authoritative outcome)

Fixture: `packages/claude-code-bridge/test/fixtures/tool-error.ndjson` (6 lines):

```
{"type":"system","subtype":"init","session_id":"sid-tool-err-001",...}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu-1","name":"Read","input":{"file_path":"/etc/missing.conf"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu-1","content":"ENOENT: no such file","is_error":true}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"I successfully read the file."}]},"partial":true}
{"type":"assistant","message":{"content":[{"type":"text","text":"I successfully read the file."}]}}
{"type":"result","subtype":"success"}
```

Test scenario: replay with `exitCode=0, signal=null`. The wire-mapper produces:
- `session_init` (line 1)
- `tool_use` (line 2)
- `tool_result` with `is_error: true` (line 3) -> session.toolErrors = ["tu-1"]
- `assistant_text_delta` (line 4) -> session.lastTurnText accumulates the narration
- `assistant_text_done` (line 5)
- `assistant_done` (line 6)
- `process_exit` with `exit_code: 0, signal: null` (synthesised)

Authoritative derivation: `deriveOutcome({ exitCode: 0, toolErrors: ["tu-1"], cancelled: undefined })`. Priority order is `cancelled > tool_error > exit_code`; tool_error wins. Result:

```
session.outcome === {
  kind: "failure",
  reason: "tool_error",
  details: "1 tool_result with is_error=true (ids: tu-1)",
}
session.lastTurnText === "I successfully read the file."
```

The LLM's narration of success is preserved in `lastTurnText` (Phase 12's extractor needs it), but the outcome.kind is `"failure"` regardless. Phase 12's spoken-completion override (PROMPT-05) consumes `outcome` not `lastTurnText` when choosing between the standard and the honest variant.

## Pitfall #24 Verification (version probe + ClaudeVersionError)

Three test scenarios:

**(a) Bypass via env var:**
```ts
runVersionCheck({ env: { ACHILLES_SKIP_CLAUDE_VERSION_CHECK: "1" }, spawnSyncImpl: stub });
// -> { skipped: true }
// stub is NEVER called
```

**(b) Version too low:**
```ts
const stub = vi.fn(() => ({ stdout: "Claude Code 1.9.5", status: 0, ... }));
runVersionCheck({ env: {}, spawnSyncImpl: stub });
// throws ClaudeVersionError with actualVersion="1.9.5", requiredVersion="2.0.0"
// error.name === "ClaudeVersionError"
```

**(c) Version OK:**
```ts
const stub = vi.fn(() => ({ stdout: "Claude Code 2.0.5\n", status: 0, ... }));
runVersionCheck({ env: {}, spawnSyncImpl: stub });
// -> { skipped: false, actualVersion: "2.0.5" }
// stub called with ("claude", ["--version"], { encoding: "utf8", timeout: 5000 })
```

The version check is wired into `createClaudeSession` via `(deps?.runVersionCheck ?? runVersionCheck)({ env: effectiveEnv })`. The behaviour-3 session test asserts the call order: `runVersionCheck` runs synchronously before the streaming `spawnImpl` is called; a throw from `runVersionCheck` aborts construction and the streaming spawn is NEVER reached.

## Public createClaudeSession Contract

```ts
import { createClaudeSession } from "@achilles/claude-code-bridge";

const session = createClaudeSession({
  systemPromptFile: "/abs/path/to/companion.md",
  resumeSessionId: "optional-sid-from-prior-turn",
  cwd: "optional-cwd-override",
  env: { ACHILLES_SKIP_CLAUDE_VERSION_CHECK: "1" }, // optional
});

session.sessionId    // string | null   (set after session_init)
session.lastTurnText // string          (accumulates assistant text)
session.outcome      // ClaudeOutcome | null  (set after exit)
session.send(text)   // void            (writes text+"\n" to stdin, ends it; idempotent)
await session.close() // Promise<void>  (graceful SIGTERM + wait for exit)

for await (const ev of session.events$) {
  // ev: ClaudeBridgeEvent
  // ordering: session_init -> ... -> assistant_done -> process_exit
  // iterator terminates after process_exit
}

session._internal.childPid // number | null  (for Plan 10-03)
session._internal.argv     // readonly string[]  (for tests + Plan 10-03)
```

## Hooks for Plan 10-03 (Cancellation)

Plan 10-03 will layer SIGINT-then-SIGTERM-then-SIGKILL cancellation onto the session. It will reuse:

- `session._internal.childPid` — to discover whether the child is still alive without import-coupling to `node:child_process`.
- The exit-event plumbing in `createSessionState` — the `exitWaiters` queue already exists and Plan 10-03's `cancel()` will register the same way `close()` does (Plan 10-03 adds the escalation timers; the cleanup path is shared).
- `deriveOutcome`'s `cancelled` flag — Plan 10-03's cancel() will set `cancelled: true` on the deriveOutcome call when it produced the exit, so `outcome.reason === "cancelled"` overrides `"exit_code"` and `"tool_error"` (as already tested in outcome.test.ts).

The existing `close()` returns a Promise that resolves when the child has exited. Plan 10-03's `cancel()` will be a similar Promise-returning method that takes the same underlying exit-await path, just with the escalation timers and a state flag that biases the outcome attribution.

## Hooks for Phase 12 (TTS Wiring)

Phase 12 will import from `@achilles/claude-code-bridge`:

```ts
import {
  createClaudeSession,
  extractAck,         // Plan 10-01
  extractSpokenSummary, // Plan 10-01
} from "@achilles/claude-code-bridge";

const session = createClaudeSession({ systemPromptFile, resumeSessionId });
session.send(transcript);
for await (const ev of session.events$) {
  if (ev.type === "assistant_text_delta") {
    // Defensive double-read: session.lastTurnText is already updated.
    const ack = extractAck(session.lastTurnText);
    if (ack !== null && !ackPlayed) { ttsClient.speak(ack); ackPlayed = true; }
  }
}
// After the iterator terminates, session.outcome is populated:
if (session.outcome?.kind === "success") {
  const summary = extractSpokenSummary(session.lastTurnText);
  if (summary !== null && summary !== "") ttsClient.speak(summary);
  else ttsClient.speak("Done.");
} else {
  // Pitfall #17 honest override (PROMPT-05):
  ttsClient.speak(`I ran into a problem (${session.outcome?.reason}).`);
}
// Capture sessionId for the next turn's --resume:
const nextSid = session.sessionId;
```

## Decisions Made

- **send(text) uses stdin-then-end, not positional argument.** The CONTEXT.md "Process control" section called out the choice; the spawn-then-send lifecycle conflicts with the positional-argument path (which requires knowing the prompt at spawn time). The stdin-then-end approach is supported by `claude -p` non-interactive mode and fits the inversion-of-control surface where the caller drives the prompt body via `session.send()`.
- **send(text) is idempotent.** Phase 10's fixture model is one-prompt-per-session; Phase 12's multi-prompt loop will use `--resume <sid>` to start a fresh session for each utterance rather than send-twice on the same child. Documented in source as the v1.2 contract; future versions can lift this if multi-prompt-per-child becomes useful.
- **Watchdog fires on TWO conditions, not one.** The plan specified only "accumulator without newline exceeds MAX_LINE_BYTES" (write-time). But the oversized-line.ndjson fixture (line 1 = 1 MiB padding WITH terminating `\n` in one buffer) requires the split-time check too: a completed line that itself exceeds MAX_LINE_BYTES must emit `parse_error` rather than be passed to JSON.parse (which would otherwise succeed for a 1 MiB JSON object and emit a spurious json event). Added as a Rule 1 auto-fix during Task 1 GREEN.
- **events$ is single-consumer with cooperative termination.** Mirrors the AsyncIterable pattern from Phase 09 WR-03. Subsequent `.next()` after stream-end returns `{ done: true }` immediately rather than throwing — keeps the consumer side simple (a `for await` loop that exits naturally).
- **Wire-mapper is TOTAL (never throws).** Any input that cannot be mapped degrades to `UnknownEvent { raw }`. This includes non-object inputs (the plan only required typed-but-unrecognised shapes to fall through). Keeps the mapWireEvent contract a pure total function over `unknown -> ClaudeStreamEvent` — useful for future fuzzing.
- **oversized-line.ndjson is `.gitignore`'d, generated at test time.** A 1.05 MB fixture is wasteful to commit; `MockClaudeProcess.writeOversizedFixture(destPath)` recreates it in a `beforeAll` block. The fixture file is excluded via `packages/claude-code-bridge/test/fixtures/.gitignore`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added split-time line-length watchdog branch**
- **Found during:** Task 1 GREEN verification.
- **Issue:** The plan's `<action>` only specified one watchdog trip condition: "After the split loop, check the accumulator length. If it exceeds MAX_LINE_BYTES and contains no `\n`: emit parse_error." But the oversized-line.ndjson fixture contains a 1.05 MB line WITH its terminating `\n` arriving in the same Buffer write. Under the strict spec, the parser would find the first `\n` immediately, slice off the 1 MB prefix, run `JSON.parse(prefix)` (which succeeds — a JSON object with a 1 MB padding field IS valid JSON), and emit a successful `json` event. The acceptance criterion "Feeding the oversized-line.ndjson fixture emits exactly one parse_error with `error: \"line_too_long\"` for line 1 and one successful parsed object for line 2" cannot be satisfied without a second trip condition.
- **Fix:** Added a second watchdog branch INSIDE the split loop: when a completed line prefix exceeds MAX_LINE_BYTES, emit `parse_error { error: "line_too_long" }` and SKIP the JSON.parse call. This makes the watchdog effective regardless of whether the over-cap line and its newline arrive in the same chunk or staggered across chunks.
- **Files modified:** `packages/claude-code-bridge/src/line-parser.ts` (added 4 lines after the empty-line-skip check inside the split loop).
- **Verification:** Re-running the 11 line-parser tests showed 11/11 passing on the second GREEN. The split-time check does not regress any of the other 10 tests (they use lines smaller than MAX_LINE_BYTES).
- **Committed in:** `efbfe1a` (atomic plan commit).

---

**Total deviations:** 1 auto-fixed (Rule 1 — watchdog had a missing trip condition the acceptance criterion required).
**Impact on plan:** No scope creep, no architectural change, no contract deviation. The parser's external behaviour (the 9 documented behaviours) is unchanged; the fix only ensures the watchdog is comprehensive across both chunk-boundary patterns.

## Self-Check Plan

Verified during the implementation pass:

- All 17 created files exist on disk (listed under key-files.created above) — verified via `git diff --diff-filter=A --name-only HEAD~1 HEAD`.
- The atomic plan commit `efbfe1a` is in `git log` and carries the mandated message verbatim.
- `npm run build --workspace @achilles/claude-code-bridge` builds clean: 11 `.js` + 11 `.d.ts` in dist/, zero test files in dist/.
- CR-07 hygiene: `find packages/claude-code-bridge/src \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' \) | wc -l` returns 0.
- Barrel exports verified via post-build ESM `import()` — 16 expected runtime symbols (constants, classes, schemas, types tuple, extractors, parser, mapper, version-check, outcome, session factory) all destructure cleanly.
- 116/116 phase-10-unit tests pass; 145/145 phase-09-unit tests still pass (no regression).

## Threat Flags

None. The 7 STRIDE entries from the plan's `<threat_model>` (T-10-06..T-10-12 + T-10-SC) are all addressed:

- **T-10-06 (Tampering, NDJSON stream):** mitigated — MAX_LINE_BYTES watchdog with split-time + write-time trip conditions; malformed JSON emits parse_error with raw_line truncated at 256 chars; unknown event types map to UnknownEvent preserving raw.
- **T-10-07 (Spoofing, LLM-narrated success):** mitigated — `deriveOutcome` accepts ONLY `exitCode`, `toolErrors`, `cancelled`. The tool-error.ndjson fixture proves outcome.kind === "failure" when the model narrates success while a tool_result is_error=true was emitted.
- **T-10-08 (Denial of Service, unbounded line growth):** mitigated — both watchdog branches (write-time accumulator check + split-time line check) bound memory at MAX_LINE_BYTES + the discardingUntilNewline tail-suppression cap.
- **T-10-09 (Elevation of Privilege, systemPromptFile path):** accepted as documented — the path is passed verbatim through child_process.spawn's argv array (no shell interpolation) to the `--append-system-prompt-file` flag; reading arbitrary files is a Claude Code feature, not an Achilles concern.
- **T-10-10 (Information Disclosure, logging the prompt body):** mitigated by absence — `grep -r "console\." packages/claude-code-bridge/src` returns zero hits in the new files; the prompt body is forwarded only via `child.stdin.write(`${text}\n`)` and never logged.
- **T-10-11 (Tampering, argv assembly drift):** mitigated — `buildArgv` is pure; the locked-flags-identity test asserts `argv.slice(0, 5) === LOCKED_FLAGS.slice(0, 5)` verbatim; any future refactor that drifts the recipe fails CI.
- **T-10-12 (Tampering, version-gate spoofing):** mitigated — `runVersionCheck`'s skip env var is the documented escape hatch (ACHILLES_SKIP_CLAUDE_VERSION_CHECK); Phase 14 will surface a runtime warning if the production CLI runs with it set. JSDoc tags the env override as a test/dev seam.
- **T-10-SC (Package Legitimacy Gate):** N/A — zero new npm packages. Only Node built-ins (`node:child_process`, `node:buffer`, `node:events`, `node:stream`, `node:fs`, `node:path`, `node:url`) added on top of the 10-01 scaffold's `zod`.

## Issues Encountered

None blocking. The single auto-fixed deviation above was discovered during Task 1 GREEN verification and resolved by adding a second watchdog trip condition to the line parser. No other issues — Tasks 2 and 3 passed GREEN on the first run of each test file.

## User Setup Required

None. No new environment variables, no new external services, no new dashboard configuration. The `ACHILLES_SKIP_CLAUDE_VERSION_CHECK` env var from Plan 10-01 is now consumed by Plan 10-02 via `runVersionCheck`, but the wiring is internal — no user-facing change.

The `claude` CLI must be installed and at >= 2.0.0 in production environments. The version check throws `ClaudeVersionError` with an install hint (`npm install -g @anthropic-ai/claude-code`) when this is not satisfied. Tests bypass the check via the env var; Phase 12 will require it in CI integration tests.

## Next Phase Readiness

- **Plan 10-03 (cancellation primitive)** is unblocked: `session._internal.childPid` is exposed; the exit-event plumbing + close()'s graceful SIGTERM path are already in place; `deriveOutcome`'s `cancelled` flag is plumbed and tested. Plan 10-03 will add `cancel(): Promise<void>` that issues SIGINT-then-SIGTERM-then-SIGKILL with the documented escalation timers and biases the outcome attribution via `cancelled: true`.
- **Phase 12 (end-to-end integration)** is unblocked at the runtime level: `createClaudeSession` ships with the complete public surface (`events$`, `sessionId`, `lastTurnText`, `outcome`, `send`, `close`); both extractors are wireable; the `--resume` flow preserves sessionId across utterances.
- **Phase 14 (hardening)** is unblocked at the surface level: `parse_error` and `process_exit` events flow through `events$`; `outcome.exitCode` + `outcome.details` are populated; the stuck-thinking timeout (Pitfall #19) can attach a watchdog without touching the bridge internals.

No blockers, no concerns. The runtime spine is delivered and Wave 2 can proceed to Plan 10-03.

## Self-Check: PASSED

All 17 created files exist on disk; the atomic plan commit `efbfe1a` is in `git log`; all 116 phase-10-unit tests pass against the package on disk; phase-09-unit unchanged at 145/145; `dist/` builds clean with zero test files; `src/` has zero compiled-artifact pollution; the barrel exports all 16 expected runtime symbols verified via post-build ESM import; no Co-Authored-By trailer in the commit message; the oversized-line.ndjson fixture is properly `.gitignore`'d.

---
*Phase: 10-claude-code-bridge*
*Completed: 2026-06-06*
