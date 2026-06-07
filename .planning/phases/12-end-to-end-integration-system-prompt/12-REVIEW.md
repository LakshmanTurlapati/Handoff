---
phase: 12-end-to-end-integration-system-prompt
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - packages/achilles-skill/package.json
  - packages/achilles-skill/tsconfig.json
  - packages/achilles-skill/src/index.ts
  - packages/achilles-skill/skill/prompts/companion.md
  - apps/achilles/src/main/sandwich-defence.ts
  - apps/achilles/src/main/normalisation.ts
  - apps/achilles/src/main/normalisation-fixtures.ts
  - apps/achilles/src/renderer/audio/downsample-worklet.ts
  - apps/achilles/src/renderer/audio/mic-capture.ts
  - apps/achilles/src/renderer/audio/playback-queue.ts
  - apps/achilles/src/renderer/audio/analyser-binding.ts
  - apps/achilles/src/main/session.ts
  - apps/achilles/src/main/key-source.ts
  - apps/achilles/src/main/mock-loop-clients.ts
  - apps/achilles/src/main/index.ts
  - apps/achilles/src/main/ipc-bridge.ts
  - apps/achilles/src/main/state-machine.ts
  - apps/achilles/src/main/store.ts
  - apps/achilles/src/shared/ipc-schemas.ts
  - apps/achilles/src/shared/constants.ts
findings:
  critical: 4
  warning: 9
  info: 6
  total: 19
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 12 wires the Achilles voice loop end-to-end: the embedded companion system
prompt (`packages/achilles-skill`), sandwich-defence + pre-TTS normalisation
(SAFE-04, PITFALLS #9/#16/#21), renderer audio modules (mic capture, downsample,
playback queue, analyser binding), and the per-utterance orchestrator
(`session.ts`) that composes Phase 09/10/11 modules into the production state
machine.

The core defensive primitives — sandwich-defence wrapping, manipulation detection
with structured PATTERN-NAME reports, pre-TTS normalisation with COUNTS-only
reports, secrets/path/ANSI masking, fenced-code drop, the locked 600-char cap —
are correctly implemented and the test coverage is strong. The companion.md
prompt body honours PROMPT-02..05 with no verbatim injection literals committed
to source. The locked constants (300 ms debounce, 16 kHz/320-sample frames,
DEFAULT_VOICE_ID) are pinned at every boundary.

However, the orchestrator's per-utterance lifecycle has multiple correctness
defects that void the half-duplex contract and the PITFALLS #17 PROMPT-05
authoritative-completion invariant on edge paths:

1. **CR-01**: A turn that never emits a parseable ack (e.g., process exits
   immediately, or the LLM emits no terminator within the ack region) leaves the
   state machine pinned in `processing`, the mic gate is never engaged, and TTS
   still plays the (failure) summary. PITFALLS #2 echo loop is wide open and
   PITFALLS #17 honest-failure narration plays back into an un-gated mic.

2. **CR-02**: `IPC_STT_TOKEN_REQUEST` invokes `session.onHotkeyPress()` which
   mutates state (listening→processing, or cancel from speaking). The comment
   labels this "intentionally idempotent" but it is the opposite. A renderer that
   asks for a fresh token at any time can force the state machine off the rails.

3. **CR-03**: Toggle-mode commit path is racey. `onHotkeyPress` while listening
   dispatches HOTKEY_PRESS (state→processing) BUT the renderer's STT commit will
   then be dropped by `onUtteranceCommit`'s `mirroredState !== "listening"`
   guard. The user's utterance is silently discarded.

4. **CR-04**: `bridge.send` and `claudeFactory` errors are swallowed at the IPC
   boundary, leaving the state machine in `processing` with no Claude session.
   Same recovery hole as CR-01.

There are also two security/defensive gaps (WR-01 outcome fallback drops tool
errors; WR-02 OSC regex doesn't cover ESC \ terminator) and several code
quality / lifecycle bugs in playback-queue / analyser-binding / mock-loop. The
mock TTS's out-of-order seq swap is broken (WR-08) — silently masking real
playback ordering bugs in tests with `outOfOrderProbability > 0`.

## Critical Issues

### CR-01: Missing ack means state stays in `processing`; mic gate never engages; failure summary plays into open mic

**File:** `apps/achilles/src/main/session.ts:535-617`
**Issue:** The orchestrator's `consumeClaudeEvents` loop only dispatches
`CLAUDE_RESULT_READY` (processing → speaking) and calls
`micCapture.pauseFrameDelivery()` inside the `assistant_text_delta` branch when
`extractAck()` returns non-null. If no delta arrives, or the delta accumulator
never contains a sentence terminator (PROMPT-02 requires `.`/`?`/`!` — but
defective streams / immediate process exits will not honour the contract), the
ack path is skipped entirely.

The `process_exit` branch then:
- Builds either the PROMPT-05 failure summary or the success fallback
- Calls `await openTtsClient()` (TTS opens; chunks fan out)
- Calls `currentTtsClient!.appendText(norm.normalised)` (TTS appends, the mock
  pushes chunks immediately)
- Does NOT call `dispatch({ type: "CLAUDE_RESULT_READY" })` or
  `CLAUDE_FAILURE_OVERRIDE`
- Does NOT call `micCapture.pauseFrameDelivery()`

Consequences:
- State stays `processing` forever. The renderer's `onTtsPlaybackComplete`
  signal is dropped because `onTtsPlaybackComplete` guards on
  `mirroredState !== "speaking"`. The SPEAKING_DEBOUNCE_MS timer is never
  scheduled. The state machine wedges until user cancel.
- Mic is NOT paused. PITFALLS #2 echo loop is wide open: the failure summary
  ("I ran into a problem. tool_error") plays through TTS into a live mic.
- PITFALLS #17 owner: this is the exact scenario where the LLM either crashes
  before emitting an ack OR emits a malformed ack. The orchestrator's job is
  precisely to plays the override; the mic-gate failure is a regression of the
  guarantee.

**Fix:** Add a `processToSpeaking` helper that any path that begins TTS playback
must invoke. The process_exit branch must dispatch `CLAUDE_RESULT_READY` (or
the dedicated `CLAUDE_FAILURE_OVERRIDE` tag) and call `pauseFrameDelivery()`
when the ack path did not. Pseudocode:
```typescript
function enterSpeakingForTurn(): void {
  if (mirroredState === "speaking") return;
  deps.micCapture.pauseFrameDelivery();
  dispatch({ type: "CLAUDE_RESULT_READY" });
}
// In assistant_text_delta ack branch:
//   ...openTtsClient...
//   enterSpeakingForTurn();
//   currentTtsClient!.appendText(norm.normalised);
// In process_exit branch, BEFORE appendText:
//   await openTtsClient();
//   enterSpeakingForTurn();
//   currentTtsClient!.appendText(norm.normalised);
```
A dedicated unit test should force `claudeFixture.ackText: ""` (or no
terminator) and assert the failure-summary path still pauses the mic and
schedules the 300 ms debounce.

---

### CR-02: `IPC_STT_TOKEN_REQUEST` calls `session.onHotkeyPress()`, mutating state and triggering cancel from speaking

**File:** `apps/achilles/src/main/ipc-bridge.ts:399-418`
**Issue:** The Phase 12 STT token-request handler routes through
`session.onHotkeyPress()`. The inline comment claims it is "intentionally
idempotent" but `onHotkeyPress` in `session.ts:632-666` is NOT idempotent:
- If state is `listening`, dispatch `HOTKEY_PRESS` → `processing`. The user's
  in-flight utterance is now in a half-committed state with no
  `onUtteranceCommit` call following.
- If state is `speaking` or `processing`, the handler calls `onCancel()` which
  closes the bridge + TTS, resumes mic, dispatches `CIRCLE_CLICK`.

Consequences:
- A compromised or buggy renderer can send IPC_STT_TOKEN_REQUEST repeatedly to
  force-cancel an in-flight Claude turn or push the state machine off track.
- A legitimate renderer that re-requests a token after a network reconnect mid-
  speaking will cancel the ongoing TTS and drop the user back to idle without
  having heard the spoken summary.

**Fix:** Split the token mint into a dedicated function that does NOT touch the
state machine:
```typescript
// In session.ts, add a new public method:
async function onSttTokenRefresh(): Promise<void> {
  if (disposed) return;
  try {
    const minted = await deps.mintSttToken();
    deps.sendIpc(IPC_STT_TOKEN, { token: minted.token, expiresAt: minted.expiresAt });
  } catch (err) {
    log(`[achilles] stt token refresh failed: ${(err as Error).message}`);
  }
}

// In ipc-bridge.ts handler:
void session.onSttTokenRefresh();
```

---

### CR-03: Toggle-mode commit racey — second hotkey press transitions state→processing before the renderer's commit arrives, then `onUtteranceCommit` drops it

**File:** `apps/achilles/src/main/session.ts:632-666, 668-715`
**Issue:** In toggle mode, the documented UX (UI-SPEC s4 row 2; reducer line 141)
is "press hotkey from listening → commit the in-flight utterance and start
processing". The orchestrator's `onHotkeyPress` while listening dispatches
`HOTKEY_PRESS`, which the reducer turns into `listening → processing`. State is
now `processing`.

The renderer-side STT client observes the state-changed broadcast and (per the
existing Phase 09 design) calls its own `commit()`, then sends
`IPC_UTTERANCE_COMMIT`. By the time main receives this IPC, state has already
moved to `processing`. `onUtteranceCommit` line 670 guards:
```typescript
if (mirroredState !== "listening") {
  log(`[achilles] dropping utterance-commit: state=${mirroredState}`);
  return;
}
```
…and silently drops the utterance. The user's voice never reaches the Claude
bridge.

**Fix:** Either:
1. Defer the state transition until the renderer's commit arrives — have the
   orchestrator REQUEST a commit from the renderer (new IPC channel
   `achilles:request-commit`) when toggle-mode hotkey fires while listening,
   then transition on receipt of `IPC_UTTERANCE_COMMIT` via `STT_COMMITTED`.
2. OR relax the `onUtteranceCommit` guard to accept commits from both
   `listening` AND `processing` states (with a documented justification that
   the toggle-hotkey path has already advanced the visible state but the
   commit is still in-flight).

Whichever path is chosen, add an `it("toggle-mode hotkey commit path: ...",
async () => { ... })` test that drives the EXACT race the user experiences,
asserts the transcript reaches `bridge.send`, and asserts no
`dropping utterance-commit` log line was emitted.

---

### CR-04: `claudeFactory()` and `bridge.send` errors are not caught in `onUtteranceCommit`, leaving state pinned in `processing`

**File:** `apps/achilles/src/main/session.ts:701-714`
**Issue:** After dispatching `STT_COMMITTED` (which transitions state to
`processing`), the orchestrator:
```typescript
dispatch({ type: "STT_COMMITTED", transcript: payload.text });
const bridge = deps.claudeFactory({...});
currentClaudeSession = bridge;
bridge.send(wrapped);
activeConsumerPromise = consumeClaudeEvents(bridge).catch((err) => {...});
```
`claudeFactory` and `bridge.send` are not wrapped in try/catch. The real
`createClaudeSession` runs `runVersionCheck` synchronously and throws
`ClaudeVersionError` on a too-old CLI. `send()` writes to `child.stdin` and
could throw on an EPIPE if the child has already exited.

If either throws, the exception propagates up to the IPC handler:
```typescript
// ipc-bridge.ts:347-360
try {
  const parsed = parseEnvelope(IPC_UTTERANCE_COMMIT, payload) as UtteranceCommitPayload;
  session.onUtteranceCommit(parsed);
} catch (err) {
  log(`[achilles] dropping invalid ${IPC_UTTERANCE_COMMIT} payload: ...`);
}
```
The error is swallowed. State is now `processing` permanently —
`currentClaudeSession` is set to the broken bridge (or undefined),
`activeConsumerPromise` was never assigned, mic was never gated.

**Fix:** Wrap the bridge construction + send in a try/catch that rolls back the
state machine (dispatch `CIRCLE_CLICK` to return to idle) and surfaces a
user-visible error:
```typescript
let bridge: ClaudeBridgeLike;
try {
  bridge = deps.claudeFactory({...});
  currentClaudeSession = bridge;
  bridge.send(wrapped);
} catch (err) {
  log(`[achilles] bridge construction failed: ${(err as Error).message}`);
  dispatch({ type: "CIRCLE_CLICK" });
  // Surface a user-facing error via INJECT_ERROR.
  dispatch({ type: "INJECT_ERROR", kind: "unknown" });
  return;
}
```

## Warnings

### WR-01: Process-exit outcome fallback `?? deriveOutcome({ toolErrors: [] })` drops tool errors and can mask a real failure as success

**File:** `apps/achilles/src/main/session.ts:570-573`
**Issue:** The defensive fallback:
```typescript
const outcome = session.outcome ?? deriveOutcome({
  exitCode: ev.exit_code,
  toolErrors: [],
});
```
silently drops the tool-error list. If `session.outcome` is unexpectedly null
when `process_exit` arrives (e.g., timing edge in a future bridge revision, or
a mocked bridge that doesn't populate `outcome`), `deriveOutcome` is called with
`toolErrors: []`. With `exit_code: 0`, this returns `{ kind: "success" }` even
if the turn actually had tool errors. The orchestrator then routes the LLM's
narrated `<spoken-summary>` body verbatim — exactly the PITFALLS #17 hallucinated
success path.

**Fix:** Either (a) fail-loud — throw or log a critical warning if
`session.outcome` is null at process_exit; (b) build a side-channel tool-error
list inside the orchestrator's consume loop by observing `tool_result` events
and pass that into the fallback `deriveOutcome` call. Recommended: (b), because
defense-in-depth says the orchestrator should not trust ANY one source.
```typescript
const observedToolErrors: string[] = [];
for await (const ev of session.events$) {
  ...
  } else if (ev.type === "tool_result" && ev.is_error === true) {
    observedToolErrors.push(ev.tool_use_id);
  } else if (ev.type === "process_exit") {
    const outcome = session.outcome ?? deriveOutcome({
      exitCode: ev.exit_code,
      toolErrors: observedToolErrors,
    });
    ...
  }
}
```

---

### WR-02: ANSI OSC regex misses `ESC \` (String Terminator) — only handles BEL terminator

**File:** `apps/achilles/src/main/normalisation.ts:77`
**Issue:** `ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;`

Real OSC sequences can terminate with either BEL (0x07) or the C1 String
Terminator (ESC \ = 0x1b 0x5c). Terminals using ST-terminated OSC bypass this
strip. While the LLM is also told not to emit ANSI in `<spoken-summary>` (the
prompt forbids ANSI escape sequences), defence-in-depth requires the
normaliser to catch the common cases. A stream that drops in an ST-terminated
OSC sequence (e.g., a paste from a remote terminal) would be read aloud
verbatim.

**Fix:**
```typescript
const ANSI_OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
```
And add a unit test that asserts an ST-terminated OSC is stripped.

---

### WR-03: `setPlaybackSource` re-binds the analyser per chunk — visual flicker / unnecessary disconnect-connect churn

**File:** `apps/achilles/src/renderer/audio/playback-queue.ts:118`,
`apps/achilles/src/renderer/audio/analyser-binding.ts:120-125`
**Issue:** Inside `scheduleAndPlay`, every chunk's `AudioBufferSourceNode` is
passed to `opts.analyserBinding.setPlaybackSource(source)`. The analyser
binding's `setPlaybackSource` is the latest source — it disconnects the
previous source from the analyser and connects the new one. With chunks
arriving in sequence, this means the analyser is reconnected for EACH chunk,
likely causing measurable amplitude flicker in the Waveform component.

A better model: connect a long-lived `GainNode` (or a single shared
`MediaStreamAudioDestinationNode`) to the analyser ONCE; route each
`BufferSourceNode` through that node. The analyser then reads a continuous
amplitude across the entire utterance.

**Fix:** Have the playback queue maintain a single mixer node:
```typescript
const playbackMixer = opts.audioContext.createGain();
playbackMixer.connect(opts.audioContext.destination);
opts.analyserBinding.setPlaybackSource(playbackMixer);
// scheduleAndPlay:
source.connect(playbackMixer);
source.start(startAt);
// ...
```
Setting analyser playback source ONCE at construction time eliminates the
per-chunk churn.

---

### WR-04: `openTtsClient` sets `currentTtsClient` before `await tts.open()` — failed open leaks an unopened client

**File:** `apps/achilles/src/main/session.ts:480-491`
**Issue:**
```typescript
async function openTtsClient(): Promise<OrchestratorTtsClient> {
  if (currentTtsClient !== null) return currentTtsClient;
  const tts = deps.ttsFactory({ voiceId: deps.voiceId });
  currentTtsClient = tts;        // <-- set BEFORE open
  try {
    await tts.open();
  } catch (err) {
    log(...);
    throw err;                    // <-- currentTtsClient still set
  }
  ttsOpenedForTurn = true;
  ...
}
```
On a failed open, `currentTtsClient` stays non-null and `ttsOpenedForTurn`
stays false. `dispose()` checks `currentTtsClient !== null && ttsOpenedForTurn`
to close — the failed client is NEVER closed. The TTS factory's internal
resources (WebSocket, pending fetch) leak.

`onCancel()` also checks `currentTtsClient !== null` and calls `close()`. So
cancel cleans up. But dispose path does not.

**Fix:** Either roll back `currentTtsClient` on failure, OR drop the
`ttsOpenedForTurn` guard in dispose (always close on dispose). Recommended:
```typescript
const tts = deps.ttsFactory({ voiceId: deps.voiceId });
try {
  await tts.open();
} catch (err) {
  log(`[achilles] tts open failed: ${(err as Error).message}`);
  throw err;
}
currentTtsClient = tts;
ttsOpenedForTurn = true;
```

---

### WR-05: `accumulatedText` is the delta concatenation, not the bridge's authoritative `lastTurnText` — primary success path may extract from inconsistent source

**File:** `apps/achilles/src/main/session.ts:404, 535-536, 579`
**Issue:** The orchestrator builds `accumulatedText` by appending
`assistant_text_delta.text` events. It then passes `accumulatedText` to
`extractSpokenSummary(accumulatedText)` in the process_exit branch. But the
bridge documents that `assistant_text_done.full_text` is "the authoritative
accumulated string" (claude-code-bridge/src/session.ts:17-20). If a delta is
dropped, re-ordered, or duplicated upstream, the orchestrator's accumulator
drifts from the authoritative full_text.

The fallback path correctly uses `session.lastTurnText`, but the primary
extraction path uses the local accumulator.

**Fix:** Replace `extractSpokenSummary(accumulatedText)` with
`extractSpokenSummary(session.lastTurnText)`. The bridge guarantees
`assistant_text_done` updates lastTurnText before process_exit. (See mock at
mock-loop-clients.ts:317-320 — it follows the same pattern.)

---

### WR-06: `onCancel` resumes the mic immediately, then dispatches CIRCLE_CLICK — mic could pick up a tail of TTS audio still draining

**File:** `apps/achilles/src/main/session.ts:753-793`
**Issue:** `onCancel` calls `deps.micCapture.resumeFrameDelivery()` BEFORE
dispatching `CIRCLE_CLICK`. But `tts.close()` returns a Promise that
asynchronously drains buffered audio. The renderer-side playback-queue is
still finishing the currently-playing chunk (the IPC-level `flush` only
returns when the renderer signals — there's no main-process equivalent).

For ~50–150 ms after `onCancel` returns, the speakers are still emitting
buffered audio, but the mic is already capturing again. PITFALLS #2 echo loop
fires on the cancellation tail.

**Fix:** Apply the same 300 ms half-duplex tail to the cancel path:
```typescript
function onCancel(): void {
  ...
  // Drain the playback queue first via IPC, then resume mic after the
  // SPEAKING_DEBOUNCE_MS tail elapses.
  clearDebounce();
  debounceToken = setT(() => {
    debounceToken = null;
    deps.micCapture.resumeFrameDelivery();
  }, SPEAKING_DEBOUNCE_MS);
  dispatch({ type: "CIRCLE_CLICK" });
  ...
}
```
This pushes the mic resume to the natural tail boundary, mirroring the success
path.

---

### WR-07: `onMicFrame` metric `framesDroppedDuringSpeaking` increments during `processing` too — name misleading; could hide a real bug

**File:** `apps/achilles/src/main/session.ts:717-723`
**Issue:** The guard `if (mirroredState === "speaking" || mirroredState === "processing")` counts dropped frames during BOTH states, but the metric is
named `framesDroppedDuringSpeaking`. If a future debug session shows
`framesDroppedDuringSpeaking > 0` while state-trace logs show no
`speaking` transition, the misnamed metric will obscure the actual half-duplex
gate failure (see CR-01 above).

**Fix:** Rename to `framesDroppedDuringHalfDuplexGate` (or split into two
counters: `framesDroppedDuringProcessing` and `framesDroppedDuringSpeaking`).

---

### WR-08: Mock TTS out-of-order seq swap can place `isFinal:true` on a non-highest seq, breaking the playback-queue completion detection

**File:** `apps/achilles/src/main/mock-loop-clients.ts:518-557`
**Issue:** The mock TTS uses an LCG to optionally swap adjacent seq numbers
within a segment, then assigns `isFinal = i === seqs.length - 1`. If `seqs` is
swapped from `[0, 1, 2]` to `[0, 2, 1]`, the chunk with seq=1 will be marked
isFinal:true (because i=2 is the last index). The chunk with seq=2 is marked
isFinal:false.

In the playback queue, `finalSeq = 1` (the only isFinal:true chunk). When
seq=1's `onended` fires:
- `liveSources.size` may be >0 (seq=2 still playing or buffered).
- Completion is deferred (correct).

When seq=2's `onended` fires:
- `seq === finalSeq` is `2 === 1` → false.
- Completion check fails. `onPlaybackComplete` NEVER fires. The renderer never
  signals main. The 300 ms debounce timer is never scheduled.

This silently masks real bugs in any test that sets
`outOfOrderProbability > 0`. The mock should mark `isFinal` based on the
HIGHEST seq, not the array index.

**Fix:**
```typescript
// Compute seqs first (with swap), then determine isFinal by max seq:
const maxSeq = Math.max(...seqs);
for (let i = 0; i < seqs.length; i++) {
  const seq = seqs[i]!;
  const isFinal = seq === maxSeq;
  push({ type: "chunk", chunk: { seq, mime: "audio/mpeg", bytes, isFinal } });
}
```

---

### WR-09: `CLAUDE_FAILURE_OVERRIDE` event tag is dead code — defined in reducer but never dispatched

**File:** `apps/achilles/src/main/state-machine.ts:87,182-191`;
`apps/achilles/src/main/session.ts:18` (comment references it)
**Issue:** The reducer accepts `CLAUDE_FAILURE_OVERRIDE` and routes
`processing → speaking`. The session orchestrator's documentation block
(session.ts lines 17-18) lists it as a Phase 12-04 production tag. But
`grep -rn CLAUDE_FAILURE_OVERRIDE apps/achilles/src/` shows it is only
DISPATCHED by the unit test (`state-machine.test.ts` lines 195, 205, 212).
The production orchestrator never dispatches it.

Either the design intends the orchestrator to dispatch it on failure (in which
case session.ts has a missing call site, partially related to CR-01) OR the
tag is genuinely dead code that should be removed to avoid implying behaviour
that doesn't exist.

**Fix:** Decide one of:
1. Dispatch `CLAUDE_FAILURE_OVERRIDE` in the process_exit failure branch
   instead of (or in addition to) `CLAUDE_RESULT_READY` so the reducer's
   distinction is meaningful at runtime. The reason payload lets a future
   logger report the failure attribution.
2. Remove the tag from the reducer and the test that exercises it, since
   nothing dispatches it.

## Info

### IN-01: `ipc-bridge.ts:343` registers Phase 12 handlers only when `opts.session` is supplied — degraded-mode boot is silent

**File:** `apps/achilles/src/main/ipc-bridge.ts:343-419`
**Issue:** When `ELEVENLABS_API_KEY` is absent, `main/index.ts:181-192`
catches `MissingApiKeyError` and proceeds with `session = null`. The bridge is
then constructed without the Phase 12 handlers. The renderer-side audio modules
will still attempt to send `IPC_UTTERANCE_COMMIT`, `IPC_MIC_FRAME`, etc. —
those messages reach the IPC layer with NO listener. They are silently dropped.

The renderer cannot distinguish "Phase 12 disabled" from "main process is
slow". A `not-configured` permission state or a banner message in the renderer
would clarify the user-visible degraded mode.

**Fix:** Surface a `IPC_PERMISSION_STATE` of `restricted` (or a new
`not-configured` permission state) to the renderer on the degraded path so
the user sees the "ELEVENLABS_API_KEY missing — run the init wizard" copy
instead of a silent dead-loop.

---

### IN-02: `dispose()` does not await `activeConsumerPromise` — possible hanging promise on shutdown

**File:** `apps/achilles/src/main/session.ts:795-822, 824-827`
**Issue:** The dispose path sets `disposed = true`, closes the current bridge,
closes the TTS. The bridge's `events$` iterator is supposed to detect
`disposed` and break on the next iteration (consumer loop line 534), but the
loop may be parked in `await session.events$[Symbol.asyncIterator]().next()`.
If the underlying bridge does not push another event, the loop waits forever
— and the captured `activeConsumerPromise` is never resolved.

The comment at line 824-827 acknowledges this: "intentionally captured so
dispose() COULD await it in a future hardening pass". Recommending the
hardening pass.

**Fix:** `bridge.close()` should cause `events$` to emit a final event and
end the stream (the mock's `close()` calls `endStream()` which resolves
parked waiters). Verify the real bridge does the same. If not, add an
explicit `Symbol.asyncIterator().return()` call to break the consumer.

---

### IN-03: `mintSttToken` rejection leaves state in `listening` without an error banner — user is stuck

**File:** `apps/achilles/src/main/session.ts:652-665`
**Issue:** When `mintSttToken` throws (network failure, key invalid), the
catch block only logs:
```typescript
} catch (err) {
  log(`[achilles] stt token mint failed: ${...}`);
  // The orchestrator does not rollback the state — the renderer
  // will surface an STT auth error path. Phase 14 owns the
  // graceful-degradation UX.
}
```
The state is now `listening` with no STT token; the user's voice cannot reach
STT. The comment defers this to Phase 14, but the deferral means the user is
silently stuck in the `listening` visual state. Adding an `INJECT_ERROR`
dispatch here would route to the error banner immediately.

**Fix:** Dispatch `INJECT_ERROR` with a new error kind (e.g., `stt_auth`) and
rollback to idle. ERROR_COPY needs a new entry; the constant tuple in
constants.ts already documents the AchillesErrorKind shape.

---

### IN-04: `extractAck` 120-char cap may truncate a sentence that's well-formed but >120 chars

**File:** `packages/claude-code-bridge/src/extractor.ts:108-112` (Phase 10);
referenced by `apps/achilles/src/main/session.ts:539`
**Issue:** The PROMPT-02 contract is ~12 words / 120 chars. If the LLM emits
"Reading the file at the location you mentioned and updating the value." (74
chars, well-formed), extractAck returns it correctly. But if the LLM emits a
single sentence that runs to 150 chars (rare but possible — the prompt says
"<=12 words" not "<=120 chars"), the slice at 120 cuts mid-word and drops the
terminator. The orchestrator then passes that mid-word truncation to TTS.

Not strictly a Phase 12 issue (extractor is Phase 10), but worth noting: a
defensive ack-too-long handler (drop the ack, fall through to the spoken-
summary path) would be safer than mid-word truncation.

---

### IN-05: `normalisation.ts` Windows-path regex requires capital drive letter

**File:** `apps/achilles/src/main/normalisation.ts:93-94`
**Issue:** `WINDOWS_PATH_REGEX = /(^|\s)([A-Z]:\\[A-Za-z0-9_.~\\-]+)(?=\s|$|[.,!?;])/g`
matches `C:\Users\...` but NOT `c:\Users\...` (lowercase drive). Windows paths
are case-insensitive on the drive letter. A user output `c:\Users\bob\secret`
would slip through.

**Fix:** Use `[A-Za-z]:\\...`.

---

### IN-06: `key-source.ts` log emits "[achilles] elevenlabs api key sourced from store" even when test/CI doesn't want side effects — no opt-out

**File:** `apps/achilles/src/main/key-source.ts:83-104`
**Issue:** A logger is injected, so test code passes a no-op. But the
production `console.error` default fires every Achilles boot. For users with
an env var or a stored key, the log line is operationally meaningful. For a
test that imports the module without a logger override, the log fires.

Not a defect — just noting the default behaviour. The K5 tests verify
contents, not the count.

---

## Notes on the prompt body, fixtures, and IPC schemas

- **companion.md (12-01)** correctly implements PROMPT-02..05 with the locked
  word caps, marker syntax, override phrase, and no emoji codepoints. The
  prompt-content.test.ts gates regressions. The H2 sections are exhaustive.
  No verbatim injection trigger strings committed.
- **sandwich-defence.ts (12-02)** correctly locks the delimiters, refuses
  delimiter collisions, and returns PATTERN-NAME identifiers only (no
  fragment leakage). The `detectManipulationTokens` regex shapes are
  reasonable and the test coverage from `generateAdversarialTranscripts`
  exercises each detector.
- **normalisation.ts (12-02)** correctly handles ANSI CSI, Unix + Windows
  absolute paths (sans IN-05), four secret prefixes, fenced code blocks, the
  600-char cap, and the truncation tail. The report carries COUNTS only; no
  redacted content leaks. The PITFALLS #21 fixture-padding fingerprint
  assertion is solid.
- **IPC schemas (12-03)** are all `.strict()`. `MicFramePayloadSchema` pins
  sampleRate=16000 / samplesPerFrame=320 as `z.literal(...)`. The Phase 12
  channels are appended cleanly; the schema map is complete.
- **playback-queue.ts (12-03)** correctly enforces PROMPT-04 sole-export
  structurally (P6 test) and handles in-order + out-of-order chunk delivery.
  The decode-error path drops the slot without stalling.
- **downsample-worklet.ts (12-03)** correctly pins 48 kHz → 16 kHz Int16 PCM
  with the locked frame size, clamps spikes, and rejects mismatched inputs.
  Test coverage exercises the zero-crossing round-trip.
- **mic-capture.ts (12-03)** correctly gates frame delivery at the worklet
  boundary (M4), keeping the MediaStreamTrack open during pause (PITFALLS #2
  permission-flicker mitigation). The cached rejection on getUserMedia denial
  prevents re-prompts (M7).
- **mock-loop-clients.ts (12-04)** correctly synthesises bridge events in the
  expected order. The capturedSends seam (test-only) is the right shape for
  asserting sandwich-defence wiring.

---

_Reviewed: 2026-06-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## FIX LOG

Applied 2026-06-07 (gsd-code-fixer, iteration 1). All 4 critical + 9
warning findings fixed. Info findings deferred (out of fix scope per
the orchestrator's `critical_warning` selection).

| Finding | Status | Commit  | Files |
|---------|--------|---------|-------|
| CR-01   | fixed  | 70ca89f | session.ts, session.test.ts |
| CR-02   | fixed  | ec1d8b6 | session.ts, session.test.ts, ipc-bridge.ts, ipc-bridge.test.ts |
| CR-03   | fixed  | 61f6ee4 | session.ts, session.test.ts |
| CR-04   | fixed  | 341cf02 | session.ts, session.test.ts |
| WR-01   | fixed  | 2a9e327 | session.ts, session.test.ts |
| WR-02   | fixed  | 5a34ba1e | normalisation.ts, normalisation.test.ts |
| WR-03   | fixed  | fc7e7df | renderer/audio/playback-queue.ts, .test.ts |
| WR-04   | fixed  | 309d748 | session.ts |
| WR-05   | fixed  | 2c311f8 | session.ts |
| WR-06   | fixed  | 78f42df | session.ts, session.test.ts |
| WR-07   | fixed  | 60768e4 | session.ts, ipc-bridge.test.ts |
| WR-08   | fixed  | 70b6ae0 | mock-loop-clients.ts, mock-loop-clients.test.ts |
| WR-09   | fixed  | a4ec25f | session.ts |

**Verification:**

- `MOCK_LOOP=1 npx vitest run --project phase-12-unit` -> 210/210 pass
  (200 baseline + 10 new regression tests for CR-01..04, WR-01, WR-02,
  WR-03, WR-08).
- `npm run typecheck --workspace apps/achilles` -> exit 0.
- Phase-09 regression: 145/145 (133 passed + 12 live-only skipped) -
  no regression.
- Phase-10 regression: 157/157 - no regression.
- Phase-11 regression: 423/423 - no regression.

**Per-finding fix summary:**

- **CR-01** Added `enterSpeakingForTurn()` helper that gates mic +
  dispatches the speaking transition exactly once per turn. Routed
  both the happy-path ack branch and the defensive `process_exit`
  branch through it so the state machine cleanly walks
  `processing -> speaking -> idle` even when no
  `assistant_text_delta` carries a sentence terminator.
- **CR-02** Added `session.requestSttToken()` that mints a fresh
  token and broadcasts `IPC_STT_TOKEN` without touching the state
  machine. Rerouted the `IPC_STT_TOKEN_REQUEST` handler through it
  instead of `onHotkeyPress()`.
- **CR-03** Relaxed `onUtteranceCommit` guard from
  `mirroredState !== "listening"` to `"listening" || "processing"` so
  the toggle-mode race (second hotkey press advances state ->
  processing BEFORE the renderer's commit IPC lands) no longer drops
  the user's voice.
- **CR-04** Wrapped `deps.claudeFactory(...)` and `bridge.send(...)`
  in try/catch. On `ClaudeVersionError` or EPIPE-shape exception, log
  the attribution, close the bridge best-effort, dispatch
  `INJECT_ERROR` (drives state machine -> error), and null out
  `currentClaudeSession`.
- **WR-01** Built a side-channel `observedToolErrors[]` accumulator
  and pass it into the `deriveOutcome` fallback so a defective bridge
  with `outcome:null` but `tool_result.is_error` events still routes
  the PROMPT-05 override.
- **WR-02** Extended `ANSI_OSC_REGEX` to match either BEL (0x07) or
  the C1 String Terminator (ESC \, i.e. `\x1b\\`).
- **WR-03** Replaced per-chunk `setPlaybackSource(source)` churn with
  a long-lived `GainNode` mixer; analyser binding is attached ONCE at
  construction.
- **WR-04** Moved `currentTtsClient = tts` to AFTER `await tts.open()`
  succeeds; best-effort close the unopened handle on failure.
- **WR-05** Replaced `extractSpokenSummary(accumulatedText)` with
  `extractSpokenSummary(session.lastTurnText)` to read the bridge's
  authoritative full_text.
- **WR-06** Deferred `resumeFrameDelivery()` in `onCancel` by
  `SPEAKING_DEBOUNCE_MS` so the mic does not pick up the cancellation
  playback tail.
- **WR-07** Split `framesDroppedDuringSpeaking` into two counters
  (`framesDroppedDuringSpeaking`, `framesDroppedDuringProcessing`)
  plus a derived sum `framesDroppedDuringHalfDuplexGate`.
- **WR-08** Mock TTS now computes `maxSeq = Math.max(...seqs)` and
  assigns `isFinal = seq === maxSeq` rather than
  `isFinal = i === seqs.length - 1`, so the post-swap chunk with the
  highest seq always carries the flag.
- **WR-09** `enterSpeakingForTurn(failureReason?)` dispatches the
  dedicated `CLAUDE_FAILURE_OVERRIDE` reducer tag when called from the
  process_exit failure branch; the ack branch still dispatches
  `CLAUDE_RESULT_READY` (no failureReason argument) because it fires
  before outcome is known.

_Fixed: 2026-06-07T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
