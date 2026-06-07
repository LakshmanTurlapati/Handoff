---
phase: 10-claude-code-bridge
plan: 03
subsystem: claude-code-bridge
tags: [typescript, vitest, claude-code, cancellation, sigint, sigterm, sigkill, weakmap, idempotency, fake-timers, async-iterable]

# Dependency graph
requires:
  - phase: 10-claude-code-bridge
    plan: 01
    provides: "ProcessExitEvent type, ClaudeOutcome type with reason='cancelled', ClaudeBridgeEvent union, MAX_LINE_BYTES, LOCKED_FLAGS"
  - phase: 10-claude-code-bridge
    plan: 02
    provides: "createClaudeSession factory with child handle + exit-event plumbing, createLineParser, mapWireEvent, deriveOutcome with cancelled flag, MockClaudeProcess fixture replayer, golden NDJSON fixtures"
provides:
  - "cancelChildProcess — pure SIGINT/SIGTERM/SIGKILL escalation state machine with per-child WeakMap idempotency cache and configurable grace windows"
  - "ChildLike minimum surface type — interoperates with node:child_process ChildProcess and with hand-rolled test stubs"
  - "session.cancel(): Promise<ProcessExitEvent> — public forceful-interruption surface on ClaudeSession; idempotent at the session layer (cancelPromise cache) and at the primitive layer (WeakMap)"
  - "session.outcome.reason === 'cancelled' attribution — overrides exit_code and tool_error when cancel() initiated the exit (Plan 10-02's deriveOutcome already supported the cancelled flag; this plan plumbs the flag through the session's exit-listener path)"
  - "cancel-mid-stream.ndjson fixture (session_init + partial assistant_text_delta + abrupt close)"
affects:
  - "12-end-to-end-integration (apps/achilles main session can now wire PTT re-press to session.cancel() and rely on a clean outcome.reason === 'cancelled' attribution + session.sessionId preservation for --resume continuation on the next utterance)"
  - "14-hardening (the cancellation primitive's idempotency cache and the 3 s upper-bound escalation timing land at the same layer Phase 14's stuck-thinking timeout will compose against; events$ termination contract holds for cancel flows the same way it does for natural exits)"

# Tech tracking
tech-stack:
  added: []  # zero new npm dependencies
  patterns:
    - "Per-child WeakMap idempotency cache for the in-flight cancel Promise (T-10-14 mitigation; survives 3+ concurrent cancel calls returning the same Promise reference)"
    - "Synchronous-first escalation: SIGINT is sent BEFORE the first await in the Promise executor so the Phase 10 success criterion 3 SIGINT-within-50ms budget holds regardless of microtask queue depth"
    - "Two-layer idempotency: session.cancel() caches cancelPromise at the session surface AND cancelChildProcess caches in the per-child WeakMap; either layer alone would satisfy Test 6 but the dual cache matches the plan's locked design and gives downstream callers a redundant guard"
    - "Test-injection seam via deps?.setTimeout + deps?.clearTimeout + deps?.sigintGraceMs + deps?.sigtermGraceMs — vitest fake timers verify the 1 s + 2 s escalation deadlines in 0 real time without monkey-patching globals"
    - "ChildLike structural typing — minimum surface (kill, killed, exitCode, on, removeListener) so real ChildProcess instances AND test stubs satisfy the same interface"

key-files:
  created:
    - packages/claude-code-bridge/src/cancellation.ts
    - packages/claude-code-bridge/src/cancellation.test.ts
    - packages/claude-code-bridge/test/fixtures/cancel-mid-stream.ndjson
  modified:
    - packages/claude-code-bridge/src/session.ts
    - packages/claude-code-bridge/src/session.test.ts

key-decisions:
  - "cancel() returns Promise<ProcessExitEvent>, not Promise<void> — per Plan 10-03 <interfaces> block + behaviour Test 9 ('resolved value has exit_code and signal fields matching what child emitted on exit'). The execute_context's signature description ('Promise<void>') would have failed Test 9; the plan's source of truth was followed."
  - "cancelChildProcess takes a single args object ({ child, deps? }) — per Plan 10-03 <action> block. The execute_context's two-positional-arg signature ('(child, opts)') was an unintended paraphrase; the plan's explicit signature was followed to keep dependency injection (timer functions + grace windows) consistent with the rest of the codebase."
  - "session.cancel() before-spawn boundary (plan Test 8) resolves with { exit_code: null, signal: null } — per the plan's explicit Test 8 spec. The execute_context's wording ('signal: SIGINT') conflicts with the plan's enumerated behaviour Test 8 ('signal: null') so the plan was followed."
  - "Cancellation primitive is NOT re-exported from the package barrel (src/index.ts) — per the plan's action 'The cancellation.ts helper is internal — consumers go through session.cancel() exclusively'. session.cancel() is the public surface; cancelChildProcess is a JSDoc @internal helper."
  - "Two-layer idempotency: a session-level `cancelPromise` cache and a per-child WeakMap. Either alone would pass Test 6, but the dual cache is what the plan's frontmatter `truths` (cancel idempotent at the surface) plus the per-child WeakMap (mitigates T-10-14 across hypothetical future direct-primitive callers) describe. Both are exercised in tests."
  - "session.test.ts cancel describe block does NOT use vi.useFakeTimers() — the escalation timing is already covered in cancellation.test.ts. Using fake timers in the session block was attempted first but `setImmediate` (which the tests use to flush stdin/stdout chunks) gets caught by vitest's fake-timer module and the tests hung. Real timers + immediate exit emission is the clean expression site for the surface wiring tests."
  - "Fast-path for cancel-after-natural-exit (Test 9): captures the exit event in `capturedExitEvent` in the existing child.on('exit') handler so a post-exit cancel resolves with the captured event WITHOUT setting the cancelled flag. This preserves the natural outcome (success or failure-by-exit_code/tool_error) and prevents a buggy caller from retroactively mis-attributing the run to user intent (T-10-17 mitigation)."

patterns-established:
  - "Synchronous-first cancellation pattern: the executor body sends the first kill signal BEFORE any await, guaranteeing the cross-package timing budget regardless of host event-loop pressure."
  - "Two-layer idempotency for concurrent cleanup paths: a surface-level Promise cache (session.cancel) PLUS a per-resource WeakMap (cancelChildProcess). Either alone is sufficient under normal call patterns; both together protect against the edge case where a future caller bypasses the surface."
  - "Test-injection seam pattern, generalised: deps?.{setTimeout, clearTimeout, customGraceMs} let vitest fake timers verify time-based behaviour without sleeping. Production callers omit deps; the primitive falls back to host globals. JSDoc tags the seam as @internal."

requirements-completed: [LOOP-07]

# Metrics
duration: 10min
completed: 2026-06-06
---

# Phase 10 Plan 03: Cancellation Primitive — SIGINT/SIGTERM/SIGKILL Escalation + Resume-After-Cancel Summary

**Cancellation primitive that closes Phase 10: cancel-aware session.cancel() with a 3 s upper-bound SIGINT->SIGTERM->SIGKILL escalation, per-child WeakMap idempotency cache, drain-aware semantics, and outcome.reason="cancelled" attribution. Re-utterance race (Pitfall #10) mitigated; subsequent createClaudeSession({ resumeSessionId }) preserves conversation context via --resume <sid>.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-06T14:34:49Z
- **Completed:** 2026-06-06T14:44:25Z
- **Tasks:** 2 (executed atomically per single-commit policy)
- **Files modified:** 5 (3 created + 2 modified)
- **Tests added:** 22 (13 cancellation + 9 cancel-session — bringing phase-10-unit from 116 -> 138)
- **Tests passing:** 138/138 phase-10-unit; phase-09-unit 145/145 unchanged (no regression)

## Accomplishments

- LOOP-07 delivered: `session.cancel()` returns `Promise<ProcessExitEvent>`, sends SIGINT synchronously, escalates to SIGTERM after 1 s and SIGKILL after a further 2 s, and resolves once the child exits.
- Phase 10 success criterion 3 met: the SIGINT-within-50ms timing is verified in `cancellation.test.ts` behaviour 1 against a wall-clock `Date.now()` budget; the SIGINT call is the FIRST synchronous step in the Promise executor so the budget holds regardless of microtask queue depth.
- Pitfall #10 (re-utterance race) mitigated end-to-end: stdout chunks that arrive between `cancel()` and the actual exit are still parsed and emitted on `events$` (behaviour 3 / drain semantics), and `session.sessionId` is preserved across the cancel so the next utterance's `createClaudeSession({ resumeSessionId })` produces argv ending in `["--resume", <prevSid>]` (behaviour 5 / LOOP-07 acceptance).
- T-10-14 (Race condition: double cancel) mitigated by a two-layer idempotency cache: `session.cancel()` returns the same Promise on a second call (Test 6) AND `cancelChildProcess`'s per-child `WeakMap` ensures `child.kill` is invoked exactly once per signal across concurrent callers (cancellation behaviour 6).
- T-10-17 (Repudiation: cancelled attribution after natural exit) mitigated by the cancel-after-exit fast path (Test 9): `session.outcome` retains its pre-cancel value (success or failure-by-exit_code/tool_error) and the `cancelled` flag is NOT retroactively set. This prevents a buggy caller from mis-attributing a failed run to user intent.
- T-10-13 (DoS: child ignores SIGINT) mitigated by the deterministic 3 s upper-bound escalation: SIGKILL cannot be ignored by the child, so cancellation always terminates within `sigintGraceMs + sigtermGraceMs` of the call site.
- ZERO new npm dependencies. The primitive uses only Node built-ins (`setTimeout`, `clearTimeout`, `WeakMap`) on top of the 10-02 runtime spine.
- `dist/cancellation.js` + `dist/cancellation.d.ts` build clean (CR-06 + CR-07 hygiene preserved: 0 test files in dist, 0 compiled artifacts in src).
- The cancellation helper is intentionally NOT re-exported from the package barrel — consumers go through `session.cancel()` exclusively (per the plan's `<action>` block).

## Task Commits

This plan was delivered as a single atomic commit per the execute-context policy:

1. **Task 1: Cancellation primitive — SIGINT/SIGTERM/SIGKILL escalation state machine** — part of the atomic plan commit
2. **Task 2: Wire cancel() into session.ts + resume-after-cancel integration test** — part of the atomic plan commit

**Atomic plan commit:** `feat(10-03): cancellation primitive with SIGINT/SIGTERM/SIGKILL escalation + --resume after cancel`

_Note: Each task followed RED-GREEN inside the commit-assembly window. Task 1 RED was verified by running cancellation.test.ts against a missing `./cancellation.js` (Vite error: `Failed to load url ./cancellation.js`). Task 2 RED was verified by running session.test.ts after adding the 9 new cancel behaviours but BEFORE wiring cancel() into session.ts (9 failures with `TypeError: session.cancel is not a function`). Both reached GREEN before the commit was assembled._

## LOOP-07 Verification

**Test 5 (resume-after-cancel argv shape):** The integration test in `session.test.ts` instantiates session A, replays the `cancel-mid-stream.ndjson` fixture so session.sessionId captures `"sid-cancel-001"`, calls `sessionA.cancel()` and awaits the SIGINT-driven exit, then creates session B via `createClaudeSession({ systemPromptFile: "/tmp/companion.md", resumeSessionId: sessionA.sessionId })` and asserts `sessionB._internal.argv` ends with `["--resume", "sid-cancel-001"]`.

The full argv shape for session B:
```
["-p", "--output-format", "stream-json", "--include-partial-messages",
 "--append-system-prompt-file", "/tmp/companion.md",
 "--resume", "sid-cancel-001"]
```

Both halves of the LOOP-07 contract land:
1. cancel reaches the child (SIGINT fired within the 50 ms wall budget; child.kill spy was called with `"SIGINT"`).
2. the next createClaudeSession with `resumeSessionId` preserves conversation context (argv tail is `["--resume", "sid-cancel-001"]`).

## Pitfall #10 Verification (Re-utterance race)

**Behavior 3 (drain semantics):** During the test, the cancel-mid-stream fixture is written into the session's stdout (session_init + a partial assistant_text_delta). Then `session.cancel()` is called. Then ONE MORE stdout chunk is written (a second partial delta carrying `"final byte"`). Then the exit is emitted. The events$ iterator yields:
```
session_init
assistant_text_delta { text: "Working on the rename now" }   // from fixture
assistant_text_delta { text: "final byte" }                  // post-cancel chunk
process_exit { exit_code: null, signal: "SIGINT" }
```

The post-cancel chunk is still observable to consumers — the cancellation primitive does not race with the line parser. This is what mitigates Pitfall #10's "warning sign" of stale acknowledgement: the consumer sees what Claude wrote up to the interruption point and can route the cancel-stash event correctly (Phase 12's responsibility per CONTEXT.md "Cancellation" — the bridge surface here makes that routing possible).

**Behavior 2 (outcome.reason attribution):** After `cancel()` resolves, `session.outcome` is:
```
{ kind: "failure", reason: "cancelled" }
```
This is what Phase 12 will switch over to discard the cancelled turn's spoken-completion rather than play it.

**Behavior 6 (idempotency cache):** Two concurrent `session.cancel()` calls return the SAME Promise reference, and `child.kill` is invoked exactly once with `"SIGINT"` across both callers. The plan's cancellation.test.ts behaviour 6 extends this to three concurrent callers on the primitive directly.

## Public cancel() Contract

```ts
import { createClaudeSession } from "@achilles/claude-code-bridge";

const session = createClaudeSession({ systemPromptFile, resumeSessionId });
session.send(transcript);

// Mid-stream cancel (user re-utters):
const exitEvent: ProcessExitEvent = await session.cancel();
// session.outcome === { kind: "failure", reason: "cancelled" }
// session.sessionId is still set (preserved from the prior session_init)
// events$ has terminated (the final yielded event was the ProcessExit)

// Subsequent turn — resume the conversation:
const nextSession = createClaudeSession({
  systemPromptFile,
  resumeSessionId: session.sessionId!,
});
// nextSession._internal.argv ends with ["--resume", "<previous-sid>"]
```

Semantics:
- **Synchronous SIGINT**: `child.kill("SIGINT")` is called BEFORE the first await in `cancel()`. Phase 10 success criterion 3 (50 ms budget) holds even under microtask pressure.
- **Escalation**: SIGINT (immediate) -> SIGTERM (+1000 ms) -> SIGKILL (+2000 ms after SIGTERM). Total upper bound: ~3 s.
- **Idempotency**: two `cancel()` calls share the same Promise; `child.kill` runs exactly once per signal.
- **Drain-aware**: stdout chunks arriving between `cancel()` and the actual exit are parsed through the existing line-parser pipeline and emitted on `events$`.
- **Outcome attribution**: `cancelled` flag overrides `exit_code` and `tool_error` in `deriveOutcome`. The flag is NOT set on a fast-path cancel-after-natural-exit (Test 9 boundary).
- **Boundary: cancel-before-spawn**: in the v1.2 scaffold the synchronous version check runs BEFORE the streaming spawn, so the only window where the child handle is missing is construction failure (which throws). Test 8 documents the synthetic `{ exit_code: null, signal: null }` shape the implementation produces.

## Phase 10 Wrap-Up Notes

All 4 Phase 10 ROADMAP success criteria are now satisfied across the three plans:

| Criterion | Plan | Verification |
|-----------|------|--------------|
| 1. Locked flag set honoured exactly | 10-02 | session.test.ts behaviour 1 + 2 + locked-flags-identity test (argv shape verified verbatim) |
| 2. Partial JSON across reads parses cleanly | 10-02 | session.test.ts behaviour 9 (partial-json.ndjson chunked at byte 60; zero parse_error events) |
| 3. cancel() sends SIGINT within 50 ms + --resume continuation | 10-03 | cancellation.test.ts behaviour 1 + 9; session.test.ts behaviour 1 + 5 |
| 4. Authoritative outcome ignores LLM narration | 10-02 | session.test.ts behaviour 8 (tool-error.ndjson; outcome.failure / tool_error despite "I successfully read the file" narration) |

All 6 Phase-10-owned pitfalls mitigated:

| Pitfall | Plan | Mitigation |
|---------|------|------------|
| #7 (Ink stdin gotcha) | 10-02 | Non-interactive `-p` mode + pipes used throughout, NOT PTY (architectural choice) |
| #8 (Partial JSON across reads) | 10-02 | LDJSON line parser with MAX_LINE_BYTES watchdog (two trip conditions: write-time + split-time) |
| #10 (Re-utterance race) | 10-03 | Cancellation primitive with SIGINT escalation + per-child WeakMap idempotency + drain-aware semantics + outcome.reason="cancelled" attribution + sessionId preservation for --resume |
| #17 (Hallucinated success) | 10-02 | Authoritative outcome from exit code + tool_result.is_error; tool-error.ndjson regression fixture |
| #19 (Stuck thinking event surface) | 10-02 | events$ exposes the heartbeat-friendly event stream Phase 14 will consume for the user-facing timeout |
| #24 (Claude version) | 10-01 + 10-02 | runVersionCheck with MIN_CLAUDE_VERSION = "2.0.0" + ClaudeVersionError synchronous gate |

**No live Claude calls in CI default:** All Phase 10 tests are fixture-driven. The `ACHILLES_LIVE_CLAUDE=1` gated integration test is intentionally deferred to Phase 12 / Phase 14 hardening per CONTEXT.md "Optional; CI default is fixture-driven".

## Hooks Phase 12 Will Consume

Phase 12 (end-to-end integration) now has the complete bridge surface:

```ts
import {
  createClaudeSession,
  extractAck,           // Plan 10-01
  extractSpokenSummary, // Plan 10-01
  type ClaudeBridgeEvent,
  type ProcessExitEvent,
  type ClaudeOutcome,
} from "@achilles/claude-code-bridge";

const session = createClaudeSession({ systemPromptFile, resumeSessionId });
session.send(transcript);

for await (const ev of session.events$) {
  if (ev.type === "assistant_text_delta") {
    const ack = extractAck(session.lastTurnText);
    if (ack !== null && !ackPlayed) { ttsClient.speak(ack); ackPlayed = true; }
  }
  // ... etc
}

if (session.outcome?.reason === "cancelled") {
  // Phase 12 Pitfall #10 "stash event" — discard cancelled turn's TTS routing
} else if (session.outcome?.kind === "success") {
  const summary = extractSpokenSummary(session.lastTurnText);
  if (summary !== null && summary !== "") ttsClient.speak(summary);
} else {
  ttsClient.speak(`I ran into a problem (${session.outcome?.reason}).`);
}

// PTT re-press mid-turn:
// userPressesPTTAgain(() => session.cancel());
```

The complete public surface Phase 12 consumes from this package:
- `events$` (Plan 10-02 + cancel-aware termination from this plan)
- `sessionId` (Plan 10-02 + preserved across cancel from this plan)
- `lastTurnText` (Plan 10-02 + accumulated up to the interruption point on cancel)
- `outcome` (Plan 10-02 + reason="cancelled" attribution from this plan)
- `send` (Plan 10-02)
- `cancel` (this plan)
- `close` (Plan 10-02)
- `extractAck`, `extractSpokenSummary` (Plan 10-01)

## Decisions Made

- **cancel() returns Promise<ProcessExitEvent>, not Promise<void>.** The plan's `<interfaces>` block explicitly types `ClaudeSession.cancel(): Promise<ProcessExitEvent>` and behaviour Test 9 asserts the resolved value's exit_code/signal fields. The execute_context's prose summary used `Promise<void>` — likely a paraphrase artifact. The plan's typed contract was followed; Test 9 would have failed under `Promise<void>`.
- **cancelChildProcess takes a single args object.** Per the plan's `<action>` block (`function cancelChildProcess(args: { child, deps? })`). The execute_context's two-positional-arg signature was a paraphrase; the plan's signature keeps dependency injection consistent with the existing `runVersionCheck({ env, ... })` pattern in this package.
- **cancel-before-spawn boundary resolves with { exit_code: null, signal: null }.** Per the plan's explicit Test 8 behaviour ("synthetic ProcessExitEvent { exit_code: null, signal: null }"). The execute_context mentioned `signal: "SIGINT"` for this case but the plan's enumerated test spec is authoritative.
- **The cancellation primitive is internal.** Not re-exported from the barrel — per the plan's `<action>` block. Consumers use `session.cancel()`. Future direct-primitive callers (e.g., Phase 14 hardening adding a watchdog cancel from outside the session) would import via `@achilles/claude-code-bridge/cancellation`, which works via the existing tsconfig path alias but is undocumented in the v1.2 barrel.
- **Two-layer idempotency.** session.cancel() caches `cancelPromise` at the surface; cancelChildProcess uses a per-child WeakMap. Either alone passes the plan's Test 6 idempotency check, but the dual cache matches the plan's described design (Test 6 of cancellation.test.ts AND Test 6 of session.test.ts both pass without compromising on the same-Promise guarantee).
- **session.test.ts cancel describe block does NOT use fake timers.** The escalation timing is exercised in cancellation.test.ts. The session-level tests use real timers because they need `setImmediate` to flush stdin/stdout chunks through PassThrough streams, and `setImmediate` is captured by vitest's fake timer module. Real timers + immediate exit emission is the clean expression site for the surface-wiring tests.
- **Cancel-after-natural-exit captures the exit event in `capturedExitEvent`.** The existing child.on("exit") handler now stores the exit event on the closure; the cancel() fast path resolves with this captured value WITHOUT setting the cancelled flag, preserving the natural outcome (T-10-17 mitigation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vi.now() is not available in vitest 2.x; switched to Date.now() for the 50 ms wall-budget assertion**
- **Found during:** Task 1 GREEN verification (cancellation.test.ts behaviour 1).
- **Issue:** The plan's action block describes using `vi.now()` (or equivalent) to capture the simulated time. vitest 2.x does not expose `vi.now()`; the suite would throw `TypeError: vi.now is not a function`. The same test would also be technically incorrect with fake timers: `vi.now()` measures SIMULATED time, but the assertion's intent is to verify that NO real-time await happened between the cancel call and the SIGINT issuance. Date.now() is the correct primitive for that semantic.
- **Fix:** Replaced `vi.now()` with `Date.now()`. The assertion `expect(Date.now() - start).toBeLessThan(50)` verifies the wall-clock budget Phase 10 success criterion 3 actually budgets; the SIGINT call is the FIRST synchronous step in the Promise executor so the elapsed time is ~0 in practice.
- **Files modified:** `packages/claude-code-bridge/src/cancellation.test.ts` (behaviour 1 only).
- **Verification:** Re-running cancellation.test.ts showed 13/13 passing.
- **Committed in:** atomic plan commit.

**2. [Rule 3 - Blocking] Adjusted FakeChildProcess in session.test.ts to set `exitCode: null` and `killed: false` explicitly**
- **Found during:** Task 2 GREEN verification (first run of session.test.ts after wiring cancel()).
- **Issue:** The Plan 10-02 fake-child helper did not set `exitCode` or `killed` fields. When session.cancel() delegated to cancelChildProcess, the primitive's fast-path check (`child.exitCode !== null || child.killed`) interpreted the missing `exitCode` field as `undefined !== null` → true, triggering the fast path. SIGINT was never sent, and the tests failed with `expected "spy" to be called with arguments: [ 'SIGINT' ]`.
- **Fix:** Added `exitCode: null` and `killed: false` to the FakeChildProcess interface and the `makeFakeChild()` factory. These are the canonical defaults Node's real ChildProcess uses while a child is live. Test stubs now match the real shape, so the primitive's fast-path check correctly identifies the child as alive.
- **Files modified:** `packages/claude-code-bridge/src/session.test.ts` (FakeChildProcess interface + makeFakeChild factory).
- **Verification:** Re-running session.test.ts showed 23/23 passing after the fix.
- **Committed in:** atomic plan commit.

**3. [Rule 3 - Blocking] Removed vi.useFakeTimers() from session.test.ts cancel describe block**
- **Found during:** Task 2 GREEN verification (second run after deviation 2 fix).
- **Issue:** vitest 2.x's `vi.useFakeTimers()` captures `setImmediate` by default. The drain-aware behaviour tests (3, 4, 5) use `await new Promise(r => setImmediate(r))` to let the line parser process stdout chunks before continuing. With fake timers active, setImmediate never fired and the tests timed out at 5000 ms.
- **Fix:** Removed `beforeEach(() => vi.useFakeTimers())` / `afterEach(() => vi.useRealTimers())` from the cancel describe block in session.test.ts. The SIGINT/SIGTERM/SIGKILL escalation timing is already verified in cancellation.test.ts (which uses fake timers because the cancellation primitive is pure and does not race with stream-based parsing). The session-level tests only need to verify surface wiring — they emit `child.emit("exit", ...)` immediately so no time advancement is needed.
- **Files modified:** `packages/claude-code-bridge/src/session.test.ts` (removed the beforeEach/afterEach + the unused `beforeEach`/`afterEach` imports).
- **Verification:** Re-running session.test.ts showed 23/23 passing in 27 ms (down from 15 s of timeouts).
- **Committed in:** atomic plan commit.

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking adaptations to vitest 2.x semantics and to the Plan 10-02 fake-child helper's defaults). No scope creep, no architectural change, no contract deviation. The 10 documented behaviours (cancellation.test.ts) + 9 documented behaviours (session.test.ts) all pass as written; the deviations are purely test-scaffolding adaptations.

## Threat Flags

None. The 6 STRIDE entries in the plan's `<threat_model>` (T-10-13..T-10-17 + T-10-SC) are all addressed:

- **T-10-13 (DoS, child ignores SIGINT):** mitigated — the SIGINT (+1 s) → SIGTERM (+2 s) → SIGKILL escalation has a hard 3 s upper bound; SIGKILL cannot be ignored. Verified in cancellation.test.ts behaviours 3, 4, 5.
- **T-10-14 (Race condition, double cancel):** mitigated — two-layer idempotency (session-level cancelPromise cache + per-child WeakMap inside cancelChildProcess). Verified in cancellation.test.ts behaviour 6 (3 concurrent callers share the same Promise; child.kill is invoked exactly once per signal) and session.test.ts behaviour 6 (two concurrent session.cancel() calls share the same Promise).
- **T-10-15 (Information Disclosure, stale assistant text):** mitigated — events$ terminates after ProcessExit (the existing Plan 10-02 contract holds across the cancel flow). session.lastTurnText accumulates up to the interruption point; Phase 12's session orchestrator is responsible for the routing decision (the bridge surface here exposes `outcome.reason === "cancelled"` so Phase 12 can distinguish cancelled outcomes from natural completions and discard the stash event).
- **T-10-16 (Tampering, deps injection):** accepted — the deps?.setTimeout / deps?.clearTimeout injection is for vitest fake timers. Production callers omit deps; the primitive falls back to global setTimeout/clearTimeout. JSDoc tags the seam as `@internal`.
- **T-10-17 (Repudiation, cancelled attribution after natural exit):** mitigated — Test 9 enforces the cancel-after-exit fast path: `session.outcome` retains its pre-cancel value and the `cancelled` flag is NOT retroactively set. This prevents a buggy caller from mis-attributing a failed run to user intent.
- **T-10-SC (Tampering, package legitimacy):** N/A — zero new npm packages. The primitive uses only Node built-ins (`setTimeout`, `clearTimeout`, `WeakMap`) on top of the existing dependencies.

No new security-relevant surface was introduced beyond the documented threat register.

## Issues Encountered

None blocking. The three Rule 3 deviations above were discovered during the GREEN verification gate and resolved by adapting the test scaffold to vitest 2.x semantics. No production-code issues; all primitive behaviour landed correctly on the first GREEN run.

## User Setup Required

None. No new environment variables, no new external services, no new dashboard configuration. The cancellation primitive uses only existing dependencies (the 10-02 runtime spine + Node built-ins).

## Next Phase Readiness

- **Phase 12 (end-to-end integration)** is fully unblocked. The bridge ships the complete public surface (events$, sessionId, lastTurnText, outcome, send, cancel, close) plus the Plan 10-01 extractors (extractAck, extractSpokenSummary). Phase 12's session orchestrator can wire PTT re-press to `session.cancel()` and rely on `outcome.reason === "cancelled"` to discard the cancelled turn's spoken-completion routing per Pitfall #10's stash-event guidance.
- **Phase 14 (hardening)** is unblocked at the surface level: events$ exposes the heartbeat-friendly event stream (assistant_text_delta + tool_use + tool_result + assistant_done arrive in order); ProcessExit always closes the iterator; `outcome.exitCode` + `outcome.details` are populated for telemetry. The stuck-thinking timeout (Pitfall #19) can compose against `session.cancel()` without renegotiating the contract.

No blockers, no concerns. Phase 10 is complete; Wave 3 ends here.

## Self-Check: PASSED

- `packages/claude-code-bridge/src/cancellation.ts` exists.
- `packages/claude-code-bridge/src/cancellation.test.ts` exists (13 tests passing).
- `packages/claude-code-bridge/test/fixtures/cancel-mid-stream.ndjson` exists (2 content lines + trailing newline; 234 bytes; line 1 = session_init for sid-cancel-001; line 2 = partial assistant_text_delta).
- `packages/claude-code-bridge/src/session.ts` modified — cancel() added to the ClaudeSession interface and to the createSessionState closure; deriveOutcome call site now includes the cancelled flag; capturedExitEvent stored in the child.on("exit") handler.
- `packages/claude-code-bridge/src/session.test.ts` modified — 9 new cancel behaviours added in a separate describe block; FakeChildProcess updated with exitCode/killed defaults.
- 138/138 phase-10-unit tests pass (116 baseline + 13 cancellation + 9 cancel-session).
- 145/145 phase-09-unit tests pass (no regression).
- `tsc --noEmit -p tsconfig.json` exits 0.
- `find packages/claude-code-bridge/src -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' | wc -l` returns 0 (CR-07 hygiene).
- `dist/cancellation.js` and `dist/cancellation.d.ts` build clean; no test files in dist (CR-06 hygiene).
- Post-build barrel sanity check: `createClaudeSession.toString()` includes "cancel" — exit code 0.
- The cancellation primitive is NOT re-exported from src/index.ts — consumers go through session.cancel() exclusively, matching the plan's `<action>` block.

---
*Phase: 10-claude-code-bridge*
*Completed: 2026-06-06*
