---
phase: 10-claude-code-bridge
reviewed: 2026-06-06T14:56:59Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - packages/claude-code-bridge/package.json
  - packages/claude-code-bridge/tsconfig.json
  - packages/claude-code-bridge/src/index.ts
  - packages/claude-code-bridge/src/constants.ts
  - packages/claude-code-bridge/src/types.ts
  - packages/claude-code-bridge/src/errors.ts
  - packages/claude-code-bridge/src/event-schemas.ts
  - packages/claude-code-bridge/src/extractor.ts
  - packages/claude-code-bridge/src/line-parser.ts
  - packages/claude-code-bridge/src/wire-mapper.ts
  - packages/claude-code-bridge/src/version-check.ts
  - packages/claude-code-bridge/src/outcome.ts
  - packages/claude-code-bridge/src/session.ts
  - packages/claude-code-bridge/src/cancellation.ts
  - packages/claude-code-bridge/src/cancellation.test.ts
  - packages/claude-code-bridge/src/session.test.ts
  - packages/claude-code-bridge/src/line-parser.test.ts
  - packages/claude-code-bridge/src/wire-mapper.test.ts
  - packages/claude-code-bridge/src/version-check.test.ts
  - packages/claude-code-bridge/src/outcome.test.ts
  - packages/claude-code-bridge/test/mock-claude-process.ts
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-06T14:56:59Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 10 ships the `@achilles/claude-code-bridge` package — a subprocess wrapper around `claude -p --output-format stream-json` with NDJSON parsing, an authoritative outcome derivation, a SIGINT/SIGTERM/SIGKILL cancellation primitive, and a version-check gate. The implementation is thoughtful: the watchdog discipline in `line-parser.ts`, the priority ordering in `deriveOutcome`, the synchronous SIGINT-before-await guarantee in `cancellation.ts`, and the read-only purity of `extractor.ts` all reflect careful attention to the pitfall mitigations listed in CONTEXT.md.

The review found **3 Critical bugs** that will cause process-level failure in production and **6 Warnings** that degrade robustness and contractual fidelity:

- **Critical / CR-01**: No `child.on('error', ...)` listener — when `claude` is missing (ENOENT) or `spawn` fails post-construction, Node emits an `'error'` event on the child. Without a listener, Node escalates the unhandled `'error'` into an uncaught exception that crashes the host process. The existing tests do not cover this path because the fake spawn always succeeds.
- **Critical / CR-02**: No `child.stdin.on('error', ...)` listener inside `send()` — a child that closes stdin before `send()` (or that exits between version check and `send()`) will produce an EPIPE error that, again, has no listener and crashes the host.
- **Critical / CR-03**: Stderr is never wired or drained. `claude` writes diagnostics to stderr (including version banners, prompt-validation errors, and panic traces). The unread stderr pipe will eventually fill its OS buffer and **block the child's write**, freezing the entire subprocess — a classic pipe-deadlock. This will manifest as orphaned children that never exit, defeating the whole cancellation/outcome story.

The 6 Warnings include: wire-mapper losing multi-block assistant content, `parser.flush()` being invoked twice (once by stdout `'end'`, once by `child.on('exit')`) which can double-emit a trailing-partial `parse_error`, the missing close()/cancel() race with stdin-not-yet-ended, and a soft-fail in the resume-session-id input validation. Details and concrete fixes follow.

The test suite is high quality (fixtures, fake timers, deterministic injection seams). Critical-1/2/3 are gaps in production wiring that the tests cannot catch because the test scaffold always provides fake children that never emit `'error'`.

## Critical Issues

### CR-01: Missing `child.on('error', ...)` listener — `spawn` failure crashes the host

**File:** `packages/claude-code-bridge/src/session.ts:154-158`
**Issue:**
After `spawnImpl(...)` returns a `ChildProcess`, the implementation only wires `child.stdout.on('data'|'end')` and `child.on('exit')`. There is no `child.on('error', ...)` listener anywhere in the file (`grep -n "on('error'" session.ts` returns no matches).

Two production scenarios trigger an `'error'` event on the child:
1. `claude` is not on `PATH` (ENOENT). Node.js emits `'error'` asynchronously after returning the `ChildProcess` handle. The version check would normally catch this, but if `SKIP_VERSION_CHECK_ENV_VAR=1` is set (the documented test bypass — which CONTEXT.md says is also used in dev), the version check is skipped and the streaming spawn is the first thing to try `claude` resolution.
2. `claude` is on PATH but the actual exec fails (EACCES on the binary, ulimit nproc reached, etc.).

When an `'error'` event has no listener, Node escalates it to `'uncaughtException'`. The bridge's host process (Electron renderer or the relay worker, per CONTEXT.md) crashes.

The existing test suite cannot catch this because `makeFakeSpawn()` returns a stub child that never emits `'error'`.

**Fix:**
Add an error listener that synthesises a `process_exit` event so callers see the failure on the normal `events$` stream and `session.outcome` resolves to failure:

```ts
child.on("error", (err: Error) => {
  if (exited) return;
  exited = true;
  exitCode = null;
  exitSignal = null;
  // Emit a parse_error-style notice for observability and synthesise
  // a ProcessExit so the events$ iterator terminates cleanly.
  pushEvent({
    type: "parse_error",
    error: `spawn_error: ${err.message}`,
  });
  const exitEvent: ProcessExitEvent = {
    type: "process_exit",
    exit_code: null,
    signal: null,
  };
  capturedExitEvent = exitEvent;
  pushEvent(exitEvent);
  outcome = deriveOutcome({ exitCode, toolErrors, cancelled });
  endStream();
  while (exitWaiters.length > 0) {
    const next = exitWaiters.shift();
    if (next !== undefined) next();
  }
});
```

Add a test that injects a `spawnImpl` returning a child that synchronously emits `'error'`, and assert `session.outcome.kind === "failure"` and that no uncaught exception fires.

---

### CR-02: `stdin.write` and `stdin.end` are unguarded — EPIPE crashes the host

**File:** `packages/claude-code-bridge/src/session.ts:407-415`
**Issue:**
```ts
function send(text: string): void {
  if (sendCalled) return;
  sendCalled = true;
  const stdin = child.stdin;
  if (stdin === null) return;
  stdin.write(`${text}\n`);
  stdin.end();
}
```

If the child has already exited (because the version check passed but the actual `claude` exec failed asynchronously after spawn, or because the user cancel()led between construction and the first send()), `child.stdin` is non-null but `.write()` will emit an `'error'` event on the stream with EPIPE. There is no `stdin.on('error', ...)` listener, so Node escalates to `'uncaughtException'` and crashes the host. The `'error'` event is asynchronous: the `stdin.write(...)` call itself does NOT throw; the host's promise scheduler dies a tick later.

Same hazard for `stdin.end()` if the writable side has already errored.

**Fix:**
Wire an error listener once per spawned child, OR wrap both calls in a try/swallow and add an idempotent error listener at construction:

```ts
// In createSessionState, right after spawn:
if (child.stdin !== null) {
  child.stdin.on("error", (err: Error) => {
    // EPIPE during send() is non-fatal: the exit listener will resolve
    // the events$ stream; surface as a parse_error for observability.
    pushEvent({ type: "parse_error", error: `stdin_error: ${err.message}` });
  });
}

// In send():
function send(text: string): void {
  if (sendCalled) return;
  sendCalled = true;
  const stdin = child.stdin;
  if (stdin === null || stdin.destroyed || stdin.writableEnded) return;
  try {
    stdin.write(`${text}\n`);
    stdin.end();
  } catch {
    // sync throw path — the 'error' listener above handles async EPIPE.
  }
}
```

---

### CR-03: Stderr is never drained — pipe-deadlock will freeze the child

**File:** `packages/claude-code-bridge/src/session.ts:154-158, 335-343`
**Issue:**
The spawn options pass `stdio: ["pipe", "pipe", "pipe"]`, which means stderr is captured by Node. However, **the implementation never attaches a `'data'` listener to `child.stderr`** and never calls `child.stderr.resume()` or `.destroy()`.

When the OS pipe buffer fills (typically 64 KiB on Linux/macOS), `write(2)` on the child blocks. Once stderr writes block, the child can also stall on stdout writes (writev-style I/O is correlated). The child never exits, `events$` never terminates, and `cancel()` is the only escape — but cancel-via-signal also relies on the child being responsive enough to handle SIGINT before SIGKILL kicks in 3 s later. The end state: orphaned children that survive process death (on macOS specifically — they re-parent to launchd, defeating CONTEXT.md's "child process always reaped" guarantee).

This is documented as a classic Node `child_process` gotcha (see Node.js docs note on `child.stderr` blocking when piped but not read).

**Fix:** Drain stderr in one of two ways:

Option A (preferred — log for debug, never log to user-visible channels per Logging note in CONTEXT.md):
```ts
if (child.stderr !== null) {
  child.stderr.on("data", () => {
    // Drain only. Do NOT log content: stderr can contain prompt
    // fragments or path names per Claude Code wire format.
  });
  child.stderr.on("error", () => {
    // Defensive: swallow EPIPE on stderr too.
  });
}
```

Option B (simpler, if no debug capture is wanted):
```ts
// Change stdio so Node discards stderr at the OS level:
stdio: ["pipe", "pipe", "ignore"],
```

Add a test that streams >64 KiB of fake-stderr bytes through the child stub and asserts that stdout/exit still arrive on schedule.

---

## Warnings

### WR-01: Wire mapper drops content blocks beyond `content[0]` — `tool_use` after a text block is lost

**File:** `packages/claude-code-bridge/src/wire-mapper.ts:117-150`
**Issue:**
The `assistant` case reads `message.content[0]` only:
```ts
const first = content[0];
// ...
if (blockType === "text") { ... return ... }
if (blockType === "tool_use") { ... return ... }
return null;
```

Claude Code's stream-json emits assistant messages whose `content` array routinely contains multiple blocks (a `text` block of "thinking aloud" followed by a `tool_use` block in the same message is the canonical shape for tool-using turns). With the current implementation, only the first block is mapped; subsequent `tool_use` blocks in the same line are silently dropped.

This is not a Pitfall #17 violation for outcome correctness (because tool RESULTS, not tool USES, drive `deriveOutcome`), but downstream `events$` consumers will be missing tool-call announcements. The hidden tool_uses also mean Phase 12's permission auto-decline cannot see the request without a separate listener.

The test fixtures all happen to be single-content-block messages, so the bug is invisible to the suite.

**Fix:**
Iterate over `content[]` and emit one mapped event per block. Restructure `constructVariant` to return `ClaudeStreamEvent[] | null`, then have `mapWireEvent` consumers iterate. Alternatively (less invasive), introduce a `mapWireEvents(wire): ClaudeStreamEvent[]` helper and route `parser.on("json")` through it in `session.ts`:

```ts
parser.on("json", (obj: unknown) => {
  for (const event of mapWireEvents(obj)) {
    pushEvent(event);
  }
});
```

Add a test fixture with `content: [{type:"text",text:"thinking..."},{type:"tool_use",id:"tu-1",name:"Read",input:{...}}]` and assert two events emit in order.

---

### WR-02: `parser.flush()` runs twice on natural exit — may double-emit `trailing_partial` parse_error

**File:** `packages/claude-code-bridge/src/session.ts:340-342, 347-356`
**Issue:**
The exit listener calls `parser.flush()` at line 356, with the comment "Defensive: child.stdout may have already emitted 'end' but we run flush() again." The stdout `'end'` handler at line 341 also calls `parser.flush()`.

When the child exits naturally (stdout drains, then `'end'` fires, then `'exit'` fires), `flush()` runs twice. The parser's flush method:
```ts
function flush(): void {
  if (accumulator.length === 0) return;
  // ... else parse-or-error ...
  accumulator = Buffer.alloc(0);
}
```

The accumulator is reset on the first flush, so the second is a safe no-op. So far so good. **But** there's a subtle issue: when the flush emits a `trailing_partial: <msg>` parse_error on the FIRST flush, the accumulator is cleared, so the SECOND flush is a no-op. Net: no double-emit in the natural-exit case.

**However**, on signal-kill paths where stdout produces no `'end'`, `flush()` runs once via the exit listener (correct). The "defensive" flush comment is misleading because the test scaffold's `replayFixture` calls `child.stdout.end()` before `child.emit("exit")`, so stdout `'end'` always fires first in tests. In production, the order can flip (the OS may deliver SIGTERM and let the child die before stdout fully closes).

While the current code happens to be correct because of the accumulator-reset trick, the duplicated-`flush()` strategy is brittle and the rationale comment under-specifies the contract.

**Fix:**
Track flush state explicitly:
```ts
let flushed = false;
function flushOnce() {
  if (flushed) return;
  flushed = true;
  parser.flush();
}
child.stdout?.on("end", flushOnce);
child.on("exit", () => { flushOnce(); /* ... */ });
```

This survives future refactors of `LineParser` that might not guarantee the accumulator-reset behaviour.

---

### WR-03: `close()` does not end stdin — child may wait forever for prompt input

**File:** `packages/claude-code-bridge/src/session.ts:418-440`
**Issue:**
`close()` sends `SIGTERM` to the child but never closes `child.stdin`. If `send()` was never called (the caller decided to abort before sending a prompt), the child is sitting on `claude -p ...` waiting for input on stdin. `SIGTERM` is conventionally interceptable; the `claude` CLI almost certainly handles it cleanly, but a child that's mid-startup may not have installed the SIGTERM handler yet — in which case the child won't terminate until the OS forcibly kills it (which doesn't happen automatically).

Compare to `send()`, which always closes stdin. The asymmetry is a latent bug: `close()` without a prior `send()` can hang.

Additionally, `close()` has no escalation. Unlike `cancel()` (which goes SIGINT → SIGTERM → SIGKILL), `close()` sends SIGTERM and waits indefinitely on `exitWaiters.push(resolve)`. If the child ignores SIGTERM, the close() promise never resolves.

**Fix:**
1. Close stdin in `close()` if it hasn't been ended:
```ts
function close(): Promise<void> {
  if (exited) return Promise.resolve();
  try {
    if (child.stdin && !child.stdin.writableEnded) child.stdin.end();
  } catch { /* ignore */ }
  // ... rest unchanged ...
}
```
2. Add an escalation timer for `close()` analogous to `cancel()` but with a longer grace (e.g., 5 s SIGTERM → SIGKILL).

---

### WR-04: `resumeSessionId` and `systemPromptFile` are passed to argv without validation

**File:** `packages/claude-code-bridge/src/session.ts:202-228`
**Issue:**
The values are accepted as-is. `child_process.spawn` with `shell: false` (the default in this code) does NOT shell-interpret argv, so command-injection-through-spawn is not directly possible. However:

1. A caller passing `resumeSessionId: "--inject-flag"` would cause `claude` itself to interpret the value as a flag. Claude's argv parser would see `--resume --inject-flag` and either error out or, worse, treat `--inject-flag` as a flag value. Not exploitable from outside the trusted module boundary, but the LOOP-07 spec depends on the session id being well-formed (matching whatever shape session_init emitted).

2. `systemPromptFile` is inserted verbatim. If a Phase 12 wiring bug ever passes a path with embedded newlines or NUL bytes, `spawn` will throw on argv preparation but the failure happens late.

**Fix:**
Tighten the input contract in `buildArgv()` and document it on `CreateClaudeSessionOptions`:
```ts
function buildArgv(systemPromptFile: string, resumeSessionId: string | undefined): readonly string[] {
  if (systemPromptFile.length === 0 || systemPromptFile.includes("\0")) {
    throw new Error("systemPromptFile must be a non-empty NUL-free path");
  }
  if (resumeSessionId !== undefined) {
    // Conservative: session ids are opaque but should look like an id.
    if (!/^[A-Za-z0-9_.:-]+$/.test(resumeSessionId)) {
      throw new Error("resumeSessionId contains characters that argv may misinterpret");
    }
  }
  // ... rest unchanged ...
}
```

---

### WR-05: `Buffer.subarray()` retains a reference to the original buffer — slow memory growth on long sessions

**File:** `packages/claude-code-bridge/src/line-parser.ts:148-149`
**Issue:**
```ts
const linePrefix = accumulator.subarray(0, newlineIdx);
accumulator = accumulator.subarray(newlineIdx + 1);
```

`Buffer.subarray()` (alias of `Buffer.slice()` on newer Node) returns a buffer that shares memory with the parent. The next `Buffer.concat([accumulator, chunk])` allocates a fresh buffer and copies, so the reference is cleared on each write — **so long as a write actually happens**. But on quiet streams (a tool call that takes 30 s to return), the accumulator can hold a sliced view of an old buffer for a long time, indirectly retaining the full original chunk. Over many turns, this is a minor steady-state memory ceiling, not a leak.

Looking at the data flow more carefully, on each `write()`:
1. `accumulator = Buffer.concat([accumulator, chunk])` allocates a new buffer that copies both the slice view AND the new chunk. The old underlying buffer's references are released.

So the issue self-heals on every write. **However**, on shutdown of a child that produced one big buffer with many lines, every `subarray` step before the final write keeps a reference to the whole buffer in the per-line dispatch path. For `1 MiB` lines under the watchdog this is fine; for normal-sized lines it's a non-issue. Filing as Warning rather than Critical because the worst case is bounded by `MAX_LINE_BYTES + last chunk size`.

**Fix:**
After completing a line slice, copy:
```ts
const linePrefix = Buffer.from(accumulator.subarray(0, newlineIdx));
accumulator = Buffer.from(accumulator.subarray(newlineIdx + 1));
```
This trades a per-line allocation for a guarantee that the underlying ArrayBuffer can be GC'd as soon as the parser is done with the line.

---

### WR-06: Test "behaviour 8: cancel BEFORE the streaming spawn" does not test what its name claims

**File:** `packages/claude-code-bridge/src/session.test.ts:709-760`
**Issue:**
The test comment is candid:
> "in this scaffold the spawn IS synchronous (the fake spawnImpl returns the child immediately). To exercise the 'child not yet alive' branch we simulate the same condition by..."
> "We approximate by spawning the child and then immediately tearing it down — same observable behaviour from the cancel() caller's perspective."

The test verifies the post-spawn cancel path (which behaviour 1 already covers) and asserts `signal: null` rather than the documented `signal: null` AND `exit_code: null` synthetic event from a pre-spawn cancel. The plan's stated boundary (cancel during the synchronous window before `child.spawn` lands) is not exercised. As a regression test, it cannot fail when production code introduces a real pre-spawn cancel path bug.

The implementation in `session.ts` does NOT actually have a pre-spawn cancel branch — `cancel()` always calls `cancelChildProcess({ child })`, which is fine because the child handle exists synchronously after `spawnImpl()` returns. But the plan's specification of a "synthetic exit" is then orphaned.

**Fix:**
Either:
1. Remove the synthetic-exit language from the plan (the real implementation doesn't need it because spawn is synchronous), and rename the test to "cancel immediately after construction".
2. Add a real injection seam: a `SessionDeps.spawnImpl` that returns `null` to model construction failure, with `createClaudeSession` then synthesising the exit event and returning a degenerate session. Test that branch explicitly.

---

## Info

### IN-01: `// eslint-disable-next-line no-constant-condition` should be replaced with a labelled loop or boolean flag

**File:** `packages/claude-code-bridge/src/line-parser.ts:128`
**Issue:** `while (true)` with a disable comment. The TypeScript modern equivalent is `for (;;)` (no rule) or refactor to `while (accumulator.length > 0)` once the watchdog state is hoisted.
**Fix:** `for (;;) { ... }` — same semantics, no lint disable required.

---

### IN-02: `void exitSignal;` is a code smell that hides intent

**File:** `packages/claude-code-bridge/src/session.ts:376-380`
**Issue:**
```ts
// Suppress the implicit unused warning on exitSignal: it is set for
// potential future telemetry and to make the exit-trace debuggable
// via the closure scope.
void exitSignal;
```

`exitSignal` is used at line 463 inside `cancel()`'s post-exit fast path, so it IS read elsewhere. The `void` operator and comment are misleading. Either:
1. The variable is actually used (it is — at line 463); the suppression is unnecessary.
2. If TS strict-unused still complains, prefix with `_` (`_exitSignal`) or use it from a getter.

**Fix:** Delete the `void exitSignal;` line. TypeScript should not flag a variable that's referenced inside a closure-captured function (`cancel()`).

---

### IN-03: `is_error` optional booleans are silently coerced to `false`-equivalent when the LLM omits the field

**File:** `packages/claude-code-bridge/src/wire-mapper.ts:178-180`
**Issue:**
```ts
if (typeof first["is_error"] === "boolean") {
  out.is_error = first["is_error"];
}
```

When Claude omits `is_error`, the field is omitted on the mapped event. The session's `pushEvent` then does:
```ts
} else if (ev.type === "tool_result" && ev.is_error === true) {
  toolErrors.push(ev.tool_use_id);
}
```
Which treats `is_error === undefined` as "not an error". That matches the spec ("most successful tools omit it") but the chained behaviour is a known place where a future schema change could silently regress outcome derivation. Adding a brief assertion test ("undefined is_error means not pushed to toolErrors") would lock it in.

**Fix:** Add a unit test for `deriveOutcome({exitCode: 0, toolErrors: []})` paired with a `mapWireEvent` test that omits `is_error` and verifies the event has no `is_error` field, so a future shift to `is_error: false` default in the schema would fail the test.

---

### IN-04: Test "behaviour 9: cancel AFTER a natural exit" asserts `child.kill).not.toHaveBeenCalled()` which depends on test execution order

**File:** `packages/claude-code-bridge/src/session.test.ts:791`
**Issue:**
```ts
expect(child.kill).not.toHaveBeenCalled();
```

This passes only because `vi.fn()` is created fresh by `makeFakeChild()` for each test. If a future refactor shares a child stub across tests, this assertion would break. The comment at lines 788-790 acknowledges the dependency:
> "child.kill was never called: the fast path in cancelChildProcess detects child.exitCode !== null at call time. Note: behaviour 1's test left SIGINT calls on child.kill; in this test the fresh child was never killed."

**Fix:** Either tighten the assertion to `expect(child.kill).toHaveBeenCalledTimes(0)` (semantically identical but more explicit), or reset the mock at the start of each test via `vi.clearAllMocks()` in a `beforeEach`. The current code is correct but fragile.

---

## Strengths

A few aspects warrant explicit acknowledgement so the next review (and the fixer agent) does not regress them:

1. **`deriveOutcome` strictly excludes LLM narration.** The signature accepts only `exitCode`, `toolErrors`, `cancelled`. Pitfall #17 is structurally enforced. The Pitfall #17 regression test ("the model says 'I successfully read the file' while is_error=true was emitted") confirms it.
2. **The `cancelled` flag override priority** (`cancelled > tool_error > exit_code`) matches the CONTEXT.md attribution doctrine, and the unit tests cover the override correctly.
3. **Cancellation idempotency** is layered: session-level (`cancelPromise`) AND primitive-level (`WeakMap<ChildLike, Promise>`). Both layers are tested.
4. **The `SIGINT-before-await`** guarantee is correctly implemented (lines 214-220 of cancellation.ts).
5. **`extractor.ts` is genuinely pure** — module-scoped regex, no `g` flag, no clock/RNG/IO. The purity tests are well chosen.
6. **The fixture-based test strategy** keeps `claude` itself out of the unit suite, satisfying the "No live `claude` calls in CI" guardrail.
7. **Error class `ClaudeVersionError`** carries structured fields (`actualVersion`, `requiredVersion`) and the message is a fixed template — no env, cwd, prompt, or API-key leakage. T-10-02 mitigation is solid.
8. **`zod` schemas use `.strict()`** so wire-format field additions are visible (forced through `unknown_event` rather than silently absorbed).

## Verdict

**REQUEST CHANGES** — three Critical bugs (CR-01/02/03) will surface in production as crashes or hung children the moment the bridge runs against a real `claude` process. None of them are caught by the current test suite because the test scaffold's fake child does not exercise the failure modes. The Warnings are not blockers individually, but WR-01 (wire-mapper dropping content blocks) is likely to bite Phase 12 wiring when permission_request events go missing because they sit at `content[1]`.

Recommended order of fixes for the fixer agent: CR-03 (stderr drain — single-line fix with the largest production impact), CR-01 (child error listener), CR-02 (stdin error handling), WR-01 (multi-block content), then the remaining Warnings/Info as quality follow-ups.

---

_Reviewed: 2026-06-06T14:56:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
