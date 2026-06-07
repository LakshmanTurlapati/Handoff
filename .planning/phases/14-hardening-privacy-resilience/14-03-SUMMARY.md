---
phase: 14-hardening-privacy-resilience
plan: 03
subsystem: achilles-main + achilles-renderer
tags: [SAFE-05, graceful-degradation, circuit-breaker, incident-detection, typed-fallback, IPC, observability]
requires:
  - 14-01 (LatencyProbe DI precedent and the markSpeechEnd / recordStage seam used by handleTypedPrompt)
  - 14-02 (TranscriptStore wiring at user + assistant utterance boundaries reused by commitText)
  - 12-04 (session.ts orchestrator + AchillesSessionDeps + sandwich-defence + normalisation reused for handleTypedPrompt)
  - 12-02 (sandwich-defence.wrapTranscript + detectManipulationTokens reused identically for typed prompts)
  - 11-02 (FloatingShell composition root + components.css extension pattern reused by TypedFallback + IncidentStatus)
provides:
  - createCircuitBreaker + classifyHttpError + computeBackoffMs + CircuitBreaker / ClassifiedError / CircuitState types (apps/achilles/src/main/incident-detection.ts)
  - TypedFallback React component with Enter-to-submit / Esc-to-dismiss (apps/achilles/src/renderer/components/TypedFallback.tsx)
  - IncidentStatus React component with green/yellow/red dot reflecting composed health (apps/achilles/src/renderer/components/IncidentStatus.tsx)
  - IPC_INCIDENT_STT_FAIL / IPC_INCIDENT_TTS_FAIL / IPC_INCIDENT_STATUS / IPC_TYPED_FALLBACK_SUBMIT channels + Zod schemas
  - session.handleTypedPrompt(text) routes through the SAME sandwich-defence + bridge.send pipeline as a spoken utterance (single code path)
  - commitText shared helper extracted from onUtteranceCommit so both spoken + typed paths reuse one pipeline
  - sttCircuit / ttsCircuit deps fields on AchillesSessionDeps wrapping mintSttToken and tts.open()
  - broadcastIncidentStatus helper composing per-surface circuit health into the IncidentStatus IPC payload
  - sendIpc tap in main/index.ts writing TTS failure summary to process.stderr (PITFALLS #18 launching-terminal contract)
affects:
  - apps/achilles/src/main/session.ts (sttCircuit + ttsCircuit deps; openTtsClient + onHotkeyPress + requestSttToken route through the breakers; commitText helper extracted; handleTypedPrompt added; cachedSummaryText closure for IPC_INCIDENT_TTS_FAIL payload)
  - apps/achilles/src/main/ipc-bridge.ts (IPC_TYPED_FALLBACK_SUBMIT handler registered + disposed when session is provided)
  - apps/achilles/src/main/index.ts (sttCircuit + ttsCircuit constructed with locked thresholds; sendIpcWithStderrTap wraps deps.sendIpc)
  - apps/achilles/src/shared/constants.ts (4 new channel constants)
  - apps/achilles/src/shared/ipc-schemas.ts (4 new .strict() Zod schemas + IncidentFailureKindSchema union)
  - apps/achilles/src/shared/ipc-schemas.test.ts (channel count test bumped from 27 to 31)
  - apps/achilles/src/renderer/App.tsx (3 incident subscriptions + TypedFallback + IncidentStatus rendered as siblings of FloatingShell)
  - apps/achilles/src/renderer/bridge.ts (4 optional bridge methods for incident subscriptions + typed-fallback send)
  - apps/achilles/src/renderer/styles/tokens.css (3 status color tokens)
  - apps/achilles/src/renderer/styles/components.css (typed-fallback + incident-status-dot styles)
  - vitest.workspace.ts (phase-14-unit includes incident-detection / TypedFallback / IncidentStatus tests)
tech-stack:
  added: []
  patterns:
    - "Circuit-breaker with deterministic seams (nowImpl + randomImpl + classifyError + logger) — every threshold + clock + randomness is injectable so tests are bit-for-bit deterministic"
    - "Discriminated AttemptOutcome shape ({result} | {error}) so callers cannot accidentally swallow failures — `'result' in outcome` is the routing predicate"
    - "AWS-style full-jitter exponential backoff helper computed as min(cap, base * 2^(attempt-1)) * random — exposed for direct test invocation"
    - "Single-pipeline invariant: handleTypedPrompt and onUtteranceCommit both call commitText so there is exactly ONE sandwich-defence + bridge.send code path (SE20 verifies the captured payload starts with DELIM_START)"
    - "Cached spoken-summary text in session closure populated BEFORE the (potentially failing) openTtsClient call so IPC_INCIDENT_TTS_FAIL payload carries the text the user did NOT hear (PITFALLS #18 cache-most-recent contract)"
    - "Stderr tap pattern in main/index.ts: wrap deps.sendIpc to route only IPC_INCIDENT_TTS_FAIL's summaryText to process.stderr; no API key, no transcript text, no other channel's payload reaches stderr"
    - "Optional-chain breaker wiring (deps.sttCircuit?.attempt / deps.ttsCircuit?.attempt with legacy fallback) preserves bit-for-bit pre-14-03 behaviour when breakers are undefined"
key-files:
  created:
    - apps/achilles/src/main/incident-detection.ts
    - apps/achilles/src/main/incident-detection.test.ts
    - apps/achilles/src/renderer/components/TypedFallback.tsx
    - apps/achilles/src/renderer/components/TypedFallback.test.tsx
    - apps/achilles/src/renderer/components/IncidentStatus.tsx
    - apps/achilles/src/renderer/components/IncidentStatus.test.tsx
  modified:
    - apps/achilles/src/main/session.ts
    - apps/achilles/src/main/session.test.ts
    - apps/achilles/src/main/ipc-bridge.ts
    - apps/achilles/src/main/ipc-bridge.test.ts
    - apps/achilles/src/main/index.ts
    - apps/achilles/src/renderer/App.tsx
    - apps/achilles/src/renderer/bridge.ts
    - apps/achilles/src/renderer/styles/tokens.css
    - apps/achilles/src/renderer/styles/components.css
    - apps/achilles/src/shared/constants.ts
    - apps/achilles/src/shared/ipc-schemas.ts
    - apps/achilles/src/shared/ipc-schemas.test.ts
    - vitest.workspace.ts
decisions:
  - "Breaker module is PURE — no fs / http / process.env reads. Verified by grep guard (active code is empty after dropping JSDoc comments). All side effects route through the injected logger seam (default console.error)."
  - "Auth and rate_limit kinds open the breaker IMMEDIATELY regardless of consecutive-failure count — PITFALLS #4 lock. Burning 5 backoff cycles on a bad credential wastes 30+ seconds; the right user-facing surface is the typed fallback, not silent burn-through."
  - "Half-open probe semantics: status() lazily transitions open -> half-open when cooldownMs has elapsed (read from nowImpl); the next attempt is the probe. A successful probe re-closes; a failed probe re-opens. Verified by ID7."
  - "Single commitText helper extracted from onUtteranceCommit so the typed-fallback path and the spoken path share ONE pipeline — there is no parallel code path. SE20 asserts the captured payload starts with DELIM_START + contains REMINDER_LINE bit-for-bit."
  - "Typed prompts accepted regardless of mirroredState — the user's STT is broken; refusing the prompt because the state machine thinks we are still 'idle' would defeat the SAFE-05 contract. The reducer's STT_COMMITTED case ignores the event in non-listening states anyway, so the dispatch is safe."
  - "Latency probe treats typed prompts as zero-STT-cost utterances — markSpeechEnd anchored at Date.now() with synthesized utteranceId `typed-${nowMs}`, stt_committed recorded immediately because there is no STT round-trip."
  - "cachedSummaryText populated inside consumeClaudeEvents process_exit branch BEFORE the openTtsClient call. When the TTS circuit opens during the catch path, the IPC_INCIDENT_TTS_FAIL payload carries the text the user did NOT hear. PITFALLS #18 cache-most-recent contract."
  - "Stderr tap is intentionally narrow — only IPC_INCIDENT_TTS_FAIL's summaryText routes to process.stderr. No API key, no transcript text, no other channel's payload reaches stderr. The summary already went through Plan 12 normalisation (PITFALLS #16 + #21 redaction)."
  - "IncidentStatus composition rule: both ok -> ok; both failed -> failed; any failed paired with degraded -> failed; everything else -> degraded. Verified by truth-table test covering the full 3x3 matrix."
  - "TypedFallback returns null when active=false (no DOM produced) — controlled component, subscribes to nothing. App.tsx owns the IPC subscription and prop wiring so the component is trivially testable and reusable."
metrics:
  duration_minutes: 18
  completed_at: 2026-06-06T22:58:00Z
  tasks_completed: 3
  files_created: 6
  files_modified: 13
  tests_added: 60
---

# Phase 14 Plan 03: Graceful Degradation (SAFE-05) Summary

ElevenLabs incident detection (circuit-breaker + exponential-backoff-with-full-jitter classifier wrapping STT and TTS clients) + typed-prompt fallback overlay when STT is down + visible/audible-text routing for the spoken summary the user did not hear when TTS is down + a health-status dot in the floating window corner — all the SAFE-05 graceful-degradation pieces wired through the orchestrator with bit-for-bit preservation of pre-14-03 behaviour when the breakers are undefined.

## One-liner

Circuit-breaker incident detection (3 failures within 60 s -> open; 30 s cooldown; full-jitter backoff cap 5 s; auth/rate-limit short-circuit) wrapping STT and TTS, with a TypedFallback overlay routing typed prompts through the same sandwich-defence + bridge.send pipeline as a spoken utterance, an IncidentStatus dot reflecting composed health, and a sendIpc tap writing the missed TTS summary to the launching terminal.

## Tasks completed

### Task 1: Circuit-breaker and incident-detection module

Created `apps/achilles/src/main/incident-detection.ts` (~487 lines) exposing:

- `createCircuitBreaker({label, maxConsecutiveFailures, windowMs, cooldownMs, backoffBaseMs, backoffCapMs, classifyError, nowImpl, randomImpl, logger})` returning a `CircuitBreaker` handle with `attempt(fn)` and `status()`.
- `classifyHttpError(err)` — pure shape-based classifier:
  - HTTP 401/403 -> `'auth'`
  - HTTP 429 -> `'rate_limit'`
  - HTTP 5xx -> `'server'`
  - Node-socket codes (ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, EPIPE, ECONNABORTED) -> `'network'`
  - Otherwise -> `'unknown'`
- `computeBackoffMs(attempt, baseMs, capMs, randomImpl)` — AWS-style full-jitter formula `min(capMs, baseMs * 2^(attempt-1)) * randomImpl()`.
- Exported types: `ClassifiedError`, `ClassifiedErrorKind`, `CircuitState`, `CircuitStatus`, `AttemptOutcome`, `AttemptSuccess`, `AttemptFailure`.

Behaviour invariants verified by the 24-test ID1..ID12 suite (~487 lines):

- ID1: handle exposes `attempt` and `status` functions.
- ID2: discriminated outcome shape (`'result' in outcome` vs `'error' in outcome`).
- ID3: successful attempt zeroes consecutiveFailures and clears the sliding window.
- ID4: auth / rate_limit open the breaker IMMEDIATELY (exhausted=true on first failure).
- ID5: retryable failures accumulate in a sliding window; breaker opens at threshold. Failures separated by more than windowMs are evicted.
- ID6: full-jitter formula verified at multiple attempt values (1, 2, 3, 10, 20).
- ID7: cooldown state transitions (open -> half-open after cooldownMs; successful probe re-closes; failed probe re-opens).
- ID8: classifier maps every shape to the right kind (401/403/429/5xx/Node codes/unknown). HTTP shape wins over Node code when both present.
- ID9: deterministic with fixed randomImpl. (attempt=3, base=250, cap=5000, random=0.5) yields exactly 500 ms.
- ID10: logger lines NEVER include API key or transcript fragment; only label + kind + attempt + opened boolean.
- ID11: two breakers operate independently (labelled state isolation).
- ID12: open breaker short-circuits attempt without invoking fn (attemptCount=0).

Module is PURE — grep guard verifies no fs / http / process.env / fetch references in active code (the JSDoc comments mentioning these as exclusions are dropped by the verification pipeline's `grep -v '^\s*\*'`).

### Task 2: TypedFallback + IncidentStatus components + IPC schemas + App composition

**TypedFallback.tsx** — pure React functional component with props `{active, onSubmit, onCancel}`.

- TF1: active=true renders overlay with locked label "STT unavailable. Type your prompt.", autofocused input with placeholder "Type your prompt".
- TF1b: active=false returns null (no DOM produced).
- TF2: Enter on non-empty (trimmed) value invokes `onSubmit(text)`; input cleared after submit.
- TF3: Escape invokes `onCancel`.
- TF4: Empty / whitespace-only submission silently ignored.
- TF5: data-testids `typed-fallback`, `typed-fallback-input`, `typed-fallback-label`. role="dialog", aria-label matches the locked text.

12 tests pass.

**IncidentStatus.tsx** — pure React functional component with props `{sttHealth, ttsHealth}`.

- Composition rule (`composeIncidentStatus` exported as pure helper for round-trip testing):
  - both `'ok'` -> `'ok'`
  - both `'failed'` -> `'failed'`
  - any `'failed'` paired with `'degraded'` -> `'failed'`
  - everything else -> `'degraded'`
- Renders a single 12 px dot with `data-testid="incident-status-dot"`, `data-status` matching the composed kind, className `incident-status-dot incident-status-{kind}`, and a title tooltip reading `STT: <sttHealth>; TTS: <ttsHealth>`.
- aria-label mirrors the title; role="status" for assistive tech.

12 tests pass including a full 3x3 truth-table for `composeIncidentStatus`.

**IPC + Zod schemas added:**

- `IPC_INCIDENT_STT_FAIL = "achilles:incident-stt-fail"` -> `IncidentSttFailPayloadSchema {kind, attemptCount}.strict()`.
- `IPC_INCIDENT_TTS_FAIL = "achilles:incident-tts-fail"` -> `IncidentTtsFailPayloadSchema {kind, summaryText, attemptCount}.strict()`.
- `IPC_INCIDENT_STATUS = "achilles:incident-status"` -> `IncidentStatusPayloadSchema {sttHealth, ttsHealth}.strict()`.
- `IPC_TYPED_FALLBACK_SUBMIT = "achilles:typed-fallback-submit"` -> `TypedFallbackSubmitPayloadSchema {text: string min(1)}.strict()`.
- Shared `IncidentFailureKindSchema` union: `'auth' | 'rate_limit' | 'server' | 'network' | 'unknown'`.
- Channel-keyed schema map updated; `ipc-schemas.test.ts` channel-count assertion bumped from 27 to 31.

**App.tsx composition:**

- Three new bridge subscriptions: `onIncidentSttFail`, `onIncidentTtsFail`, `onIncidentStatus`.
- New state: `typedFallbackActive`, `missedSummaries`, `sttHealth`, `ttsHealth`.
- `TypedFallback` rendered as a sibling of `FloatingShell`; `onSubmit` calls `bridge.sendTypedFallbackSubmit({text})` AND closes the overlay.
- `IncidentStatus` rendered as a sibling of `FloatingShell` reflecting the current composed health.
- `bridge.ts` extended with optional `onIncidentSttFail` / `onIncidentTtsFail` / `onIncidentStatus` / `sendTypedFallbackSubmit` methods.

**CSS:**

- `tokens.css` — three new tokens: `--achilles-status-ok`, `--achilles-status-degraded`, `--achilles-status-failed`.
- `components.css` — `.typed-fallback` overlay (absolute-positioned over the transcript region), `.typed-fallback-input` focused-ring affordance, `.incident-status-dot` fixed-positioned 12 px circle at top-left.

### Task 3: session.ts circuit wiring + handleTypedPrompt + ipc-bridge + index.ts wiring + stderr fallback

**session.ts:**

- Added `sttCircuit?: CircuitBreaker` and `ttsCircuit?: CircuitBreaker` to `AchillesSessionDeps`.
- Extracted `commitText(rawText)` helper from `onUtteranceCommit` — applies detectManipulationTokens + wrapTranscript + transcriptStore.appendTurn(user) + STT_COMMITTED dispatch + claudeFactory + bridge.send + consumeClaudeEvents drain. Both `onUtteranceCommit` and the new `handleTypedPrompt` route through this helper (SE20 verifies single-pipeline invariant).
- `handleTypedPrompt(text)` — accepts regardless of state, resets turn locals, anchors the latency probe at `Date.now()` with synthesized utteranceId `typed-${nowMs}`, calls `commitText(text)`.
- `onHotkeyPress` and `requestSttToken` route through `sttCircuit.attempt(() => deps.mintSttToken())` when the breaker is configured. On `exhausted=true` they broadcast `IPC_INCIDENT_STT_FAIL` + `broadcastIncidentStatus()`; `onHotkeyPress` additionally dispatches `INJECT_ERROR` (the refresh path does NOT to avoid flipping mid-turn state to error).
- `openTtsClient` routes `tts.open()` through `ttsCircuit.attempt(...)`. On `exhausted=true` it broadcasts `IPC_INCIDENT_TTS_FAIL` with the cached `summaryText` + classified kind + attempt count.
- Added `cachedSummaryText` closure variable, populated in `consumeClaudeEvents` process_exit branch BEFORE the (potentially failing) `openTtsClient` call. Reset every turn via `resetTurnLocals`.
- Added `bucketCircuitHealth` + `broadcastIncidentStatus` helpers composing per-surface breaker status into the IncidentStatus IPC payload.
- AchillesSession surface gains `handleTypedPrompt`.

**SE20..SE23 tests added (10 new tests):**

- SE20: typed-prompt bridge.send payload starts with DELIM_START + contains REMINDER_LINE bit-for-bit (single pipeline). Persists RAW user text (not the sandwich envelope) via transcriptStore. Accepted regardless of state.
- SE21: STT circuit exhausted=true broadcasts IPC_INCIDENT_STT_FAIL with the classified kind + attemptCount; IPC_INCIDENT_STATUS shows sttHealth='failed'. Successful attempt yields IPC_STT_TOKEN with no incident broadcast.
- SE22: TTS circuit accumulates 3 server failures and opens the breaker, broadcasting IPC_INCIDENT_TTS_FAIL with the cached summary text + kind='server'.
- SE23: composed health snapshot reflects breaker states correctly. When both breakers are undefined, no SAFE-05 broadcasts fire (legacy behaviour preserved).

**ipc-bridge.ts:**

- Added IPC_TYPED_FALLBACK_SUBMIT handler (only registered when `session` is provided) — parses through TypedFallbackSubmitPayloadSchema, forwards to `session.handleTypedPrompt(parsed.text)`. WR-06 sender-check applied.
- `dispose()` removes the IPC_TYPED_FALLBACK_SUBMIT listener.
- `makeFakeSession` helper updated to include `handleTypedPrompt` spy.

**IB8 + IB9 tests added (6 new tests):**

- IB8: valid payload forwards to `session.handleTypedPrompt`. Invalid payloads (empty text, missing field) are dropped with a log line. Foreign senders are rejected.
- IB9: dispose() unregisters the handler. No registration when session is undefined.

**index.ts:**

- Constructs both circuit breakers at bootstrap with the locked v1.2 defaults (maxConsecutiveFailures=3, windowMs=60000, cooldownMs=30000, backoffBaseMs=250, backoffCapMs=5000).
- Wraps `deps.sendIpc` with `sendIpcWithStderrTap` — when channel === IPC_INCIDENT_TTS_FAIL AND payload.summaryText is a non-empty string, writes `[achilles] TTS unavailable: ${summaryText}\n` to `process.stderr`. No API key, no transcript text, no other channel's payload reaches stderr.
- Passes both breakers into `createSession` via the new `sttCircuit` / `ttsCircuit` deps fields.

## Verification

All commands from the plan's verification section pass:

```
npx vitest run --project phase-14-unit
   -> 120 tests pass (24 incident-detection + 12 TypedFallback + 12 IncidentStatus + 8 RecordingIndicator + previous 14-01 + 14-02 tests)

MOCK_LOOP=1 npx vitest run --project phase-12-unit apps/achilles/src/main/session.test.ts apps/achilles/src/main/ipc-bridge.test.ts
   -> 58 tests pass (38 session + 20 ipc-bridge, including SE20-SE23 + IB8 + IB9)

npm run typecheck --workspace apps/achilles
   -> exit 0 (tsc clean on both tsconfig.node.json and tsconfig.web.json)

Full regression (phase-09 + 10 + 11 + 12 + 13 + 14)
   -> 1333 tests pass | 4 skipped (98 test files)

grep -c "handleTypedPrompt" apps/achilles/src/main/session.ts   -> 4
grep -c "sttCircuit" apps/achilles/src/main/session.ts          -> 7
grep -c "ttsCircuit" apps/achilles/src/main/session.ts          -> 7
grep -c "IPC_TYPED_FALLBACK_SUBMIT" apps/achilles/src/main/ipc-bridge.ts -> 6
grep -c "computeBackoffMs" apps/achilles/src/main/incident-detection.ts -> 5

Pure-module grep guard (no fs / http / process.env in active code):
   (grep -E "fetch|http\\.|node:http|node:fs|process\\.env" apps/achilles/src/main/incident-detection.ts | grep -v '^\s*\*' | grep -v '^//'; test $? -eq 1)
   -> PASS (exit 1 = no matches in active code)

No emojis in modified files:
   grep -l "..." apps/achilles/src/renderer/components/TypedFallback.tsx apps/achilles/src/renderer/components/IncidentStatus.tsx apps/achilles/src/main/incident-detection.ts ...
   -> exit 1 (no matches)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] Updated ipc-schemas.test.ts channel count from 27 to 31**

- **Found during:** Task 2 (after adding the 4 new IPC channel schemas)
- **Issue:** Existing test asserts `IPC_PAYLOAD_SCHEMAS` map has exactly 27 entries; adding the 4 new SAFE-05 schemas bumped the count to 31 and failed the assertion.
- **Fix:** Updated the assertion to `expect(keys.length).toBe(31)` AND extended the documentation comment to record the Plan 14-03 contribution (4 new channels).
- **Files modified:** `apps/achilles/src/shared/ipc-schemas.test.ts`
- **Rationale:** The test is a structural invariant that intentionally needs to track new channel additions; the count bump is the documented signal that a new channel landed.

No other deviations — Tasks 1, 2, and 3 executed per the plan's specifications.

## Threat Flags

Plan's `<threat_model>` covers T-14-13 through T-14-18. The implementation honours every mitigation disposition:

- T-14-13 (tampering, typed prompt injection): mitigated. TypedFallback routes text through `session.handleTypedPrompt` which calls the shared `commitText` helper applying `detectManipulationTokens` (warn-only log) + `wrapTranscript` (SAFE-04 sandwich-defence) bit-for-bit identically to a spoken utterance. SE20 asserts the captured payload starts with DELIM_START.
- T-14-14 (DoS, retry storm on transient failure): mitigated. Circuit-breaker opens after 3 consecutive failures within 60 s; cooldown 30 s before re-attempting. PITFALLS #4 protection preserved.
- T-14-15 (info disclosure, TTS failure stderr print includes summary): mitigated. The stderr tap writes ONLY the normalised summary text (which already went through Plan 12 normalisation: ANSI strip, path mask, secret-prefix mask, fenced-code drop). No API key, no transcript text, no other channel's payload reaches stderr.
- T-14-16 (info disclosure, circuit-breaker log lines): mitigated. ID10 test asserts log lines contain only label + kind + attempt + opened boolean; never the cause body, never the API key, never the transcript. Pure-module grep guard verifies no fs / http / process.env references in active code.
- T-14-17 (spoofing, rogue renderer process sending IPC_TYPED_FALLBACK_SUBMIT): mitigated. `withSenderCheck` wraps the handler so events from unexpected webContents are dropped (IB8 test asserts foreign sender id=999 is rejected).
- T-14-18 (repudiation, status dot misleading user): accepted. The dot is informational; the truth source is the main-side circuit-breaker state. The hover tooltip surfaces the actual per-surface state.

No NEW threat surface introduced — every modification routes through existing trust boundaries (renderer<->main IPC validated by Zod schemas, main->ElevenLabs wrapped by circuit breakers, main->launching-terminal stderr narrow-tapped only for IPC_INCIDENT_TTS_FAIL summaryText).

## Self-Check: PASSED

Verified all claims:

- apps/achilles/src/main/incident-detection.ts -> FOUND
- apps/achilles/src/main/incident-detection.test.ts -> FOUND
- apps/achilles/src/renderer/components/TypedFallback.tsx -> FOUND
- apps/achilles/src/renderer/components/TypedFallback.test.tsx -> FOUND
- apps/achilles/src/renderer/components/IncidentStatus.tsx -> FOUND
- apps/achilles/src/renderer/components/IncidentStatus.test.tsx -> FOUND
- All 1333 tests pass across phases 09-14 (98 test files).
- Typecheck clean.
- No emojis in any modified file (grep guard).
- Pure-module grep guard passes (no fs / http / process.env in active code of incident-detection.ts).
