---
phase: 09
phase_name: voice-vendor-wrappers
status: findings
depth: standard
reviewed_at: 2026-06-06
reviewed_by: gsd-code-reviewer
finding_count:
  critical: 7
  warning: 11
  info: 5
---

# Phase 09 Code Review

## Summary

The phase delivers a credible SAFE-01/SAFE-03 boundary (renderer-safe barrel, separate token-mint subpath, single allowlist matcher, strict Zod IPC envelopes), and the headline LOOP-01 round-trip + PITFALLS #6 ordering tests genuinely exercise the contracts they claim. The schema layer is tight: `.strict()` on every object, refusal of raw-key shapes, label-boundary allowlist matching. However, the WebSocket lifecycle in BOTH wrappers has real concurrency defects — `stop()` / `close()` do not reliably cancel pending reconnects or in-flight opens, and the TTS `close()` can hang indefinitely if the WebSocket never reaches the open state. Several other defects matter for production: the declared ElevenLabs SDK dependencies (`@elevenlabs/client`, `@elevenlabs/elevenlabs-js`, `ws`) are imported nowhere — the wrappers hand-roll the protocol, which is a significant deviation from CONTEXT.md's "thin client" decision; the voice-protocol tsconfig ships test files into `dist/`; and the wrapper's `try/catch` fallback for browser-style WebSocket constructors silently drops the `xi-api-key` header on the failure path, which means production TTS could degrade to an unauthenticated connection without surfacing the auth-mode mismatch. Verdict: `findings` — the SAFE-01/SAFE-03 stance survives review, but lifecycle correctness and packaging hygiene need fixes before this code merges.

## Findings

### Critical (7)

#### CR-01 — `stop()` does not cancel pending reconnect `setTimeout` callbacks

- **File:** `packages/voice-stt/src/realtime-client.ts:425-446`
- **Category:** Concurrency / resource leak
- **Issue:** `scheduleReconnect` checks `lifecycle === "closing" || "closed"` at SCHEDULE time (line 426) but the `setTimeout(() => { void connect(); }, delay)` at line 443-445 fires unconditionally. If `stop()` is invoked during the backoff window, the timer still fires `connect()`, which sets `lifecycle = "connecting"` (line 266), calls `getToken()`, constructs a NEW WebSocket, and attaches listeners that will set `lifecycle = "open"` on connect. The wrapper's `socket` reference is overwritten with a live connection AFTER the consumer requested teardown. The closed iterable still holds, so events are silently dropped, but the WebSocket itself remains open — a real resource and quota leak (extra ElevenLabs concurrent-connection count, PITFALLS #4).
- **Repro:** `start()` -> abnormal close (code 1006) -> `scheduleReconnect` fires -> while timer is pending, call `stop()` -> after delay, observe a new WebSocket constructed and connected.
- **Fix:** Track the reconnect handle and clear it on `stop()`:
  ```ts
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReconnect(reason: "network" | "rate_limit"): void {
    if (lifecycle === "closing" || lifecycle === "closed") return;
    // ...
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (lifecycle === "closing" || lifecycle === "closed") return;
      void connect();
    }, delay);
  }
  async function stop(): Promise<void> {
    lifecycle = "closing";
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    // ... existing teardown
  }
  ```
- **Guardrail:** PITFALLS #4 — WebSocket lifecycle correctness; SAFE-03 (a leaked connection still talks to ElevenLabs after consumer requested stop).

#### CR-02 — `connect()` does not check lifecycle after `await getToken()` (stop()-while-starting race)

- **File:** `packages/voice-stt/src/realtime-client.ts:265-295`
- **Category:** Concurrency / resource leak
- **Issue:** When `start()` calls `connect()`, the function awaits `getToken()` (line 269). If `stop()` is invoked during that await, `stop()` sees `socket === null`, skips the close branch, and sets `lifecycle = "closed"` + closes the iterable. When `connect()` resumes, it does NOT re-check lifecycle — it unconditionally constructs the WebSocket (line 286), assigns `socket = ws` (line 295), and attaches listeners. The `open` listener sets `lifecycle = "open"` (line 298), undoing the closed state. The consumer believes the wrapper is stopped; the wrapper is in fact about to send audio.
- **Repro:** Wrap `getToken` in a 200 ms delay, call `start()`, then `stop()` 50 ms later, then advance time. Observe a connected WebSocket whose lifecycle is "open" and whose iterable is closed (zombie state).
- **Fix:** Add a re-check after every `await` in `connect()`:
  ```ts
  async function connect(): Promise<void> {
    lifecycle = "connecting";
    let token: string;
    try { token = (await getToken()).token; } catch (e) { /* existing */ }
    if (lifecycle === "closing" || lifecycle === "closed") return;
    // ... construct WS
  }
  ```
- **Guardrail:** PITFALLS #4.

#### CR-03 — TTS `close()` can hang indefinitely awaiting an open that never resolves

- **File:** `packages/voice-tts/src/stream-client.ts:481-504`
- **Category:** Concurrency / liveness bug
- **Issue:** `close()` awaits `openPromise` (line 491) when one is in flight. The `openPromise` IIFE awaits `new Promise(resolve => onopen = ...)` (line 419-423) which only resolves when the WebSocket fires `onopen`. If the WebSocket fails BEFORE open (DNS failure, connection refused, immediate server reject), `onopen` never fires; `onclose` fires instead. The `onclose` handler in `attachWsHandlers` calls `scheduleReconnect()` (or `complete()` if `closedByCaller`), but neither path resolves or rejects the open Promise. The `close()` call hangs forever waiting on `openPromise`.
- **Repro:** Inject a WebSocket constructor whose instance never fires `onopen` (only `onclose` after a tick), then call `appendText("x")` immediately followed by `await client.close()`. Observe `close()` hangs.
- **Fix:** Race the open against close/error events:
  ```ts
  openPromise = (async () => {
    const key = await callKeySource(opts.keySource);
    // ... construct ws
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => resolve();
      const onCloseDuringOpen = () => reject(new Error("[voice-tts] WebSocket closed before open"));
      (ws as { onopen: () => void }).onopen = onOpen;
      const prior = (ws as { onclose?: (e: { code: number }) => void }).onclose;
      (ws as { onclose: (e: { code: number }) => void }).onclose = (e) => {
        onCloseDuringOpen();
        if (prior) prior(e);
      };
    });
    // ... rest
  })();
  ```
  Or, simpler: wrap the `await openPromise` in `close()` with `Promise.race` against a small timeout.
- **Guardrail:** PITFALLS #4; the executor's noted "auto-fix" for `close()` awaiting open did not address the failure mode.

#### CR-04 — TTS `scheduleReconnect` setTimeout cannot be cancelled by `close()`

- **File:** `packages/voice-tts/src/stream-client.ts:361-379`
- **Category:** Concurrency / resource leak
- **Issue:** Same defect as CR-01 on the TTS side. The `setTimeout` at line 371-378 has a `closedByCaller` guard at line 372, which DOES protect against re-opening after close — but the timer handle is not retained, so the closure (including `ensureOpen`, captured outer state, the entire wrapper instance) stays in memory until the timer fires. More importantly, the wrapper has no way to cancel the reconnect window early; if the consumer wants `close()` to be deterministic, the timer remains queued for up to `2^5 * 250 = 8000 ms` after close returns.
- **Fix:** Same as CR-01: track the handle and `clearTimeout` in `close()`.
- **Guardrail:** PITFALLS #4.

#### CR-05 — TTS WebSocket constructor fallback silently drops the `xi-api-key` header

- **File:** `packages/voice-tts/src/stream-client.ts:397-412`
- **Category:** Security / auth degradation
- **Issue:** The wrapper first tries `new WsCtor(url, undefined, { headers: { "xi-api-key": key } })` (line 398-406). On ANY throw (line 407 — bare `catch` catches everything including TypeErrors, memory errors, security errors), it falls back to `new WsCtor(url)` (line 409-411), which has NO header — meaning the WebSocket is constructed WITHOUT the API key. The comment on line 396 says "the test stub does not need authentication" — but in PRODUCTION, the only code path that would throw on the three-arg form is a constructor that doesn't accept three args, which is the browser `WebSocket`. If the package is ever used in a context where `globalThis.WebSocket` is the browser-style constructor (renderer, edge runtimes), the wrapper silently degrades to unauthenticated, which the upstream will reject after open with an opaque close code. The user sees "WS closed unexpectedly" with no auth-mode signal.
- **Fix:** Either (a) require `webSocketCtor` to be an explicit `ws.WebSocket` in main-process consumers (since the package targets main per CONTEXT.md) and remove the browser fallback, or (b) detect the runtime and bind only to a known-good constructor, surfacing an explicit error otherwise. The current "throw -> fallback" path masks a real misconfiguration.
- **Guardrail:** PITFALLS #22 (API key handling), SAFE-01 (the auth boundary becomes meaningless if auth silently degrades).

#### CR-06 — `voice-protocol/tsconfig.json` does not exclude test files; dist ships `*.test.js`

- **File:** `packages/voice-protocol/tsconfig.json:12`
- **Category:** Packaging defect / supply chain
- **Issue:** `exclude: ["node_modules", "dist"]` is missing the `"src/**/*.test.ts"` entry that voice-stt and voice-tts both have. As a result `npm run build` compiles `index.test.ts`, `ipc.test.ts`, `stt-events.test.ts`, `tts-events.test.ts` into `dist/`. `package.json` ships everything under `dist/` (the `files` field is `["dist"]`). Verified by `ls dist/`: `index.test.js`, `ipc.test.js`, `stt-events.test.js`, `tts-events.test.js` plus their `.d.ts` / `.map` files. Published consumers receive test code in the package payload. This expands attack surface, leaks internal fixture imports (`vitest`), and may also cause TS resolution issues for downstream consumers that scan dist.
- **Fix:** Add `"src/**/*.test.ts"` to the exclude array in `packages/voice-protocol/tsconfig.json` and rebuild. Verify `ls dist/` no longer contains `*.test.*`.
- **Guardrail:** CONVENTIONS.md packaging hygiene; SAFE-03 boundary (test code may import behavior the package doesn't intend to ship).

#### CR-07 — Compiled JavaScript and declaration files exist inside `src/` (build pollution)

- **File:** `packages/voice-protocol/src/*.js`, `packages/voice-protocol/src/*.d.ts`, `packages/voice-protocol/src/*.js.map`, `packages/voice-protocol/src/*.d.ts.map`
- **Category:** Build hygiene / correctness
- **Issue:** `stat` shows `src/index.js` is NEWER than `src/index.ts` (Jun 6 07:24 vs Jun 6 07:07). The `package.json` build script writes to `dist/` only, yet compiled artifacts sit in `src/`. This indicates someone ran `tsc` without the project config (or a previous misconfigured run) and the artifacts were never cleaned. On next compile pass these `.js` files are treated as project inputs by TypeScript's resolver, and Vitest's workspace aliases (which point at `.ts` files) may now compete with the `.js` siblings under certain consumer configurations. The `safe-01.test.ts` grep guard scans `dist/`, not `src/`, so the SAFE-01 contract on rendered output is unaffected — but the source tree pollution is a real maintenance hazard.
- **Fix:** `rm packages/voice-protocol/src/*.{js,d.ts,js.map,d.ts.map}` (preserving `*.ts`). Add a `.gitignore` rule under `packages/voice-protocol/src/` to prevent re-introduction. Audit voice-stt and voice-tts `src/` directories for the same pollution (initial `ls` showed they appear clean, but verify).
- **Guardrail:** CONVENTIONS.md repo hygiene.

### Warning (11)

#### WR-01 — Schema validation failures silently drop transcript events (no error surfaced)

- **File:** `packages/voice-stt/src/realtime-client.ts:357-360, 374-377`
- **Category:** Error handling discipline
- **Issue:** On `partial_transcript` and `committed_transcript`, the wrapper builds a candidate and calls `SchemaName.safeParse(candidate)`. If `result.success` is false, the event is silently dropped with no `console.error` and no `SttErrorEvent` emitted. For partial transcripts this can happen when the server emits an empty `text` (Zod rejects `z.string().min(1)`) — possible for very short utterances. For committed transcripts the same applies. The consumer sees no event and no error; the wrapper appears hung. This contradicts the "no silent failures" discipline the rest of the package observes.
- **Fix:** On `result.success === false`, log via `console.error` with the Zod issue and emit an `unknown`-coded `SttErrorEvent` so the UI surfaces "transcription dropped". The existing `emitErrorEvent("unknown", true)` helper is suitable.

#### WR-02 — `voice-tts/stream-client.ts` `complete()` does not close the WebSocket

- **File:** `packages/voice-tts/src/stream-client.ts:206-216, 293-296, 346-347`
- **Category:** Resource leak
- **Issue:** When `onclose` fires with code 1000, `complete()` is invoked (line 295). When `stream_complete` arrives, `complete()` is called (line 346) but the underlying `ws` is NOT torn down. `complete()` only marks the iterable as `completed`; it never assigns `ws = null` nor calls `ws.close()`. The server normally closes after `stream_complete`, but if the connection persists (e.g., server bug, network mid-flight), the WebSocket stays open and the consumer cannot tell. The consumer must remember to call `await client.close()` even after seeing the `complete` event — undocumented.
- **Fix:** Inside `complete()`, after marking completed, call `ws?.close(1000, "stream-complete")` and null out `ws`. Document that `complete` is terminal and consumers don't need a separate `close()`.

#### WR-03 — Single-consumer AsyncIterable contract is implicit, not enforced

- **File:** `packages/voice-stt/src/realtime-client.ts:237-254`, `packages/voice-tts/src/stream-client.ts:218-235`
- **Category:** API contract / silent failure
- **Issue:** Both wrappers expose `events$: AsyncIterable<...>` and return a new iterator from `[Symbol.asyncIterator]()` each call, BUT all iterators share the same `pendingEvents` / `buffer` and `awaiter`. Two concurrent `for await` loops will silently overwrite each other's `awaiter` and race for the shared `shift()` — events go to whichever iterator wakes up first, with no fairness. This is a foot-gun for downstream consumers; the contract is "single consumer" but neither type nor runtime enforces it.
- **Fix:** Either (a) make `[Symbol.asyncIterator]()` throw on second invocation while the first is active, or (b) document the single-consumer contract loudly in TSDoc, or (c) buffer per-iterator. Cheapest: a boolean `iteratorClaimed` that throws on second call.

#### WR-04 — Old WebSocket event listeners are never removed on reconnect

- **File:** `packages/voice-stt/src/realtime-client.ts:297-336`
- **Category:** Resource leak / stale event handling
- **Issue:** `SttWebSocketLike` declares an optional `removeEventListener` (line 70-73), but the code calls only `addEventListener`. When a reconnect replaces the socket (CR-01 fix or normal abnormal-close path), the old socket's listeners stay attached. If the runtime fires a late `close` event on the old socket AFTER the new socket has been wired (race condition with WS implementations), the old `close` handler still runs and calls `scheduleReconnect("network")` (line 325) — provoking ANOTHER reconnect that the wrapper didn't intend. Compounds with CR-01.
- **Fix:** Before nulling out `socket`, call `removeEventListener` for each (open, close, message, error). Keep handler references for removal:
  ```ts
  const openHandler = () => { /* ... */ };
  const closeHandler = (ev) => { /* ... */ };
  // ... attach
  function detachAll() {
    socket?.removeEventListener?.("open", openHandler);
    socket?.removeEventListener?.("close", closeHandler);
    // ...
  }
  ```

#### WR-05 — `try/catch` around browser WebSocket fallback also catches non-`TypeError` runtime errors

- **File:** `packages/voice-tts/src/stream-client.ts:397-412`
- **Category:** Error handling discipline
- **Issue:** Bare `catch {}` on line 407 catches everything — out-of-memory, security errors, `URL` parse errors thrown by some `ws` constructors, etc. The comment on line 408 says "browser-style constructor with no options arg" but the catch is far broader. Combined with CR-05, this can mask real bugs.
- **Fix:** Catch only `TypeError` (the documented narrow-form failure mode) or use runtime detection (`typeof process !== "undefined"`) to choose the constructor variant.

#### WR-06 — `buildInitialFrame` returns an `apiKey` field that is read nowhere

- **File:** `packages/voice-tts/src/stream-client.ts:246-260`
- **Category:** Code smell / confusing contract
- **Issue:** The function's return value is destructured as `const { headerFrame } = buildInitialFrame(key)` (line 390). The returned `apiKey: key` is discarded. The function comment says "key is not embedded in the JSON body" (line 250) but then returns it in the result object. The `void key;` on line 250 is also vestigial — `key` is used in the return literal on the next line. This is misleading code that suggests the key flows somewhere it doesn't.
- **Fix:** Remove the `apiKey` return field. Drop `void key;`. Reduce to:
  ```ts
  function buildInitialFrame(): string {
    return JSON.stringify({ text: " ", model_id: FLASH_MODEL, chunk_length_schedule: Array.from(CHUNK_LENGTH_SCHEDULE), output_format: outputFormat });
  }
  ```

#### WR-07 — Mock TTS WebSocket does not exercise the three-arg auth path

- **File:** `packages/voice-tts/test/fixtures/mock-elevenlabs-tts-server.ts:120-134`
- **Category:** Test coverage gap
- **Issue:** The mock constructor signature is `constructor(url: string | URL, _protocols?: string | string[])` — only two parameters. The wrapper invokes `new WsCtor(url, undefined, { headers: { "xi-api-key": key } })` (line 398-406). JavaScript silently discards the third arg. So the test path that "passes" never verifies the auth header is actually set — and the silent fallback (CR-05, WR-05) is never triggered or detected. The contract "key forwarded via xi-api-key header" is asserted only in the dist grep guard, not in functional tests.
- **Fix:** Expand the mock constructor to accept and record `(url, protocols, options)`. Add a test that asserts `options.headers["xi-api-key"]` is forwarded.

#### WR-08 — `stop()` test only verifies close was CALLED, not that the WebSocket actually tore down

- **File:** `packages/voice-stt/src/realtime-client.test.ts:265-289`
- **Category:** Test quality / weak assertion
- **Issue:** The test wraps `socket.close` with a spy, asserts `closeSpy` was called, then ends. But `createStubWebSocket`'s default `close(_code)` body is `void _code;` (mock-elevenlabs-server.ts:235-238) — a no-op. The socket's `readyState` is never advanced to `3`, no close event is fired through `__fire`, and the wrapper's `onclose` handler never runs. So the test confirms only that `stop()` invokes `socket.close`, NOT that the lifecycle actually transitions to `closed` via the close-event pathway. CR-02 (the in-flight stop race) is not exercised by this test.
- **Fix:** After `client.stop()`, fire `inst.__fire({ type: "close", code: 1000 })` to drive the wrapper through its real close-handling path. Assert lifecycle observable via the iterable returning `{done: true}`.

#### WR-09 — Renderer-safe barrel uses a generic CONST type cast that bypasses noUncheckedIndexedAccess

- **File:** `packages/voice-tts/src/sequence-buffer.ts:91-100`
- **Category:** Type safety / noUncheckedIndexedAccess discipline
- **Issue:** `const item = this.buffered.get(this.nextExpected_) as T;` (line 92). The `Map.get` return type is `T | undefined`. The cast asserts non-undefined based on the `has()` check on the prior line (91). This is correct at runtime — `Map.has(k)` then `Map.get(k)` is well-defined — but the cast suppresses the type system's warning if a future refactor breaks the invariant. Prefer a narrow check rather than an `as`:
  ```ts
  const item = this.buffered.get(this.nextExpected_);
  if (item === undefined) break;
  ```
- **Fix:** Replace `as T` with a defensive undefined check. Same pattern at line 247 of realtime-client.ts (`const value = pendingEvents.shift() as SttEvent;`) — shift() returns `T | undefined`; the prior `pendingEvents.length > 0` check covers it, but a defensive guard is cheap.

#### WR-10 — Vitest workspace `passWithNoTests` is unsupported at the project level

- **File:** `vitest.workspace.ts:82, 98, 113`
- **Category:** Config defect (carried into Phase 09 by 09-01)
- **Issue:** The `passWithNoTests: true` flag appears at the project root inside each `test:` block but on Vitest 2.x the property is not part of `defineWorkspace`'s `ProjectConfig` type — see `deferred-items.md`. Phase 09 extended this pattern when it added the `phase-09-unit` project (line 113). The flag may be silently ignored at runtime, or it may move under a different key in a future Vitest minor. The current `deferred-items.md` notes it as pre-existing; Phase 09 should not have propagated the bad pattern.
- **Fix:** Verify whether the flag works (run `vitest --project phase-09-unit` against an empty include glob and check exit code). If unsupported, remove the flag and rely on Vitest's default behavior, or move to the CLI invocation.

#### WR-11 — `voice-tts/key-source.ts` MIN_KEY_LENGTH = 8 is far too permissive for ElevenLabs `sk_…` keys

- **File:** `packages/voice-tts/src/key-source.ts:45`
- **Category:** Defensive validation
- **Issue:** The comment on line 39-44 says "Achilles' real ElevenLabs keys start with `sk_` and run well beyond 30 characters; the 8-character floor is purely defence in depth". But this means a 9-character placeholder like `"sk_short9"` passes the check. The wrapper then sets `xi-api-key: sk_short9` and opens a WebSocket — wasting a connect cycle and surfacing the "auth failed" error from the server rather than from the wrapper. Set the floor closer to the real key length (e.g., 32) so misconfigurations fail at the wrapper boundary with a clear message.
- **Fix:** Raise `MIN_KEY_LENGTH` to at least 32 (matches `ELEVENLABS_KEY_MIN_LENGTH` in voice-protocol/ipc.ts:53). Add a comment explaining the value matches the real-key floor.

### Info (5)

#### IN-01 — Declared ElevenLabs SDK dependencies are imported nowhere (deviation from CONTEXT.md)

- **File:** `packages/voice-stt/package.json:34`, `packages/voice-tts/package.json:30-31`
- **Category:** Dead dependency / architectural deviation
- **Issue:** `@elevenlabs/client` (1.9.0), `@elevenlabs/elevenlabs-js` (2.51.0), and `ws` (8.18.0) are declared as production dependencies, but no source file imports them. The wrappers hand-roll the ElevenLabs WebSocket envelope serialization (`input_audio_chunk` for STT, `model_id` / `chunk_length_schedule` for TTS). CONTEXT.md decisions state these packages are "thin client[s] around" the named SDKs; the implementation deviates by reimplementing the protocol from scratch. The dead deps bloat install size and increase supply-chain attack surface.
- **Fix:** Either (a) actually use the SDKs as planned (replace the hand-rolled envelopes), or (b) remove the unused deps and update CONTEXT.md to reflect the "we wrote our own" choice. Current state is the worst of both — the cost of the dep without the benefit.

#### IN-02 — Allowlist matcher rejects valid trailing-dot FQDNs (`api.elevenlabs.io.`)

- **File:** `packages/voice-protocol/src/transport.ts:59-79`
- **Category:** Correctness edge case
- **Issue:** `URL` parses `https://api.elevenlabs.io.` with hostname `"api.elevenlabs.io."`. `split(".")` yields `["api", "elevenlabs", "io", ""]`. The last two labels are `["io", ""]`, which doesn't match `["elevenlabs", "io"]`, so the matcher rejects. Trailing-dot hostnames are a legitimate FQDN form (root-label terminator). Not a security issue, but technically incorrect rejection.
- **Fix:** Strip trailing dot before tokenizing: `const normalized = host.toLowerCase().replace(/\.$/, "");`

#### IN-03 — STT WebSocket subprotocol carries the token verbatim (logged by proxies / DevTools)

- **File:** `packages/voice-stt/src/realtime-client.ts:286`
- **Category:** Token exposure surface
- **Issue:** `webSocketCtor(url, ["xi-realtime-token", token])` passes the single-use token in the `Sec-WebSocket-Protocol` header. This is the documented ElevenLabs path (CONTEXT.md confirms) and the token is short-lived (~15 min), but the header is logged by intermediate HTTP proxies and visible in browser DevTools' Network tab. Worth documenting in the package README so consumers know the token is "client-visible" by design and they shouldn't extend it lifetime-wise. Not a defect — informational only.
- **Fix:** Add a TSDoc note above the `webSocketCtor` call explaining the subprotocol exposure and the rationale (matches ElevenLabs docs).

#### IN-04 — Duplicate `BACKOFF_BASE_MS` constants in voice-stt and voice-tts

- **File:** `packages/voice-stt/src/backoff.ts:41`, `packages/voice-tts/src/backoff.ts:24`
- **Category:** Code duplication
- **Issue:** Both packages declare the same `BACKOFF_BASE_MS = 250` constant and the same `computeBackoffMs` implementation. CONTEXT.md notes this is intentional ("Refactor candidate for v1.3 once both packages have stabilised") but the duplication is non-trivial — any future change must touch both copies. The voice-stt version exports the constant; the voice-tts version keeps it private. Pull both into `@achilles/voice-protocol`.
- **Fix:** Move `computeBackoffMs` and `BACKOFF_BASE_MS` into `@achilles/voice-protocol`. Both packages import them. Removes ~60 lines of duplication and one v1.3 deferred item.

#### IN-05 — Single-use token mint body is hardcoded but the schema requires a model literal

- **File:** `packages/voice-protocol/src/ipc.ts:68-73`, `packages/voice-stt/src/token-mint.ts:60`
- **Category:** Redundant API surface
- **Issue:** `MintSttTokenRequestSchema` requires the renderer to send `model: "scribe_v2_realtime"` over IPC. The main-process mint helper then POSTs a body of `{ type: "realtime_scribe" }` (an unrelated literal). The `model` field carries no information — it's a single hardcoded value that exists only to be validated by `.strict()`. It does provide some defence (any future expansion to multiple models will require explicit code path changes) but it's also overhead. Acceptable as-is; flagging for discussion.
- **Fix:** None required. Consider whether the `model` field should be removed when the schema is otherwise next revised.

## Strengths

- **SAFE-01 boundary integrity:** The renderer-facing barrel exports only renderer-safe symbols, the main-process `mintSttToken` is on a separate exports subpath, and the dist-grep tests prove no `xi-api-key` or `sk_…` literal slips into the renderer-exported files. The construction of `DEPRECATED_TURBO_MODEL_ID` from parts in `voice-tts/constants.ts:118` to keep the grep-guard on `FLASH_MODEL` clean is good craft.
- **SAFE-03 single source of truth:** Both wrappers import the SAME `assertElevenLabsHost` from `@achilles/voice-protocol`, eliminating drift. The label-boundary parse correctly refuses substring attacks (`api.elevenlabs.io.evil.com`). The matcher is called BEFORE any I/O at every outbound site.
- **Strict Zod everywhere:** Every object schema uses `.strict()`; the IPC envelope refuses both extra fields and raw-key shapes via `.refine`. The discriminated unions are well-formed.
- **Round-trip and ordering tests are real:** The LOOP-01 round-trip drives a fixture WAV through the wrapper and asserts verbatim transcript matching (normalised); the PITFALLS #6 ordering test uses a deterministic Fisher-Yates scramble of 60 chunks and asserts strictly monotonic emission. These tests exercise the contracts they claim, not strawmen.
- **No `any`, no `@ts-ignore`, no `@ts-expect-error`:** The source is `any`-free; type assertions are localised and commented.
- **Constants vs literals:** `scribe_v2_realtime` appears once (as `SCRIBE_MODEL`); `eleven_flash_v2_5` appears once (as `FLASH_MODEL`); `CHUNK_LENGTH_SCHEDULE` is the only schedule literal. Grep-guards confirm.
- **Error handling discipline (mostly):** Caught values are converted via `asError` / `cause instanceof Error ? .message : String(cause)`. `console.error` is used with stable `[voice-stt]` / `[voice-tts]` prefixes. The few silent drops (WR-01) are the exception.

## Out of Scope

- TS17004 / TS2352 errors in `apps/web/*` and `tests/auth-pairing.spec.ts` (pre-existing; see `deferred-items.md`).
- `vitest.workspace.ts` `passWithNoTests` typing (raised as WR-10 because Phase 09 propagated the pattern; root cause is pre-existing).
- Live ElevenLabs network testing (CI uses fixtures by design).
- Renderer-side AudioContext audible-gap perceptual check (MH-04 second half — Phase 11/14 scope per VERIFICATION.md).
- OS keystore wiring (`safeStorage` / Keychain / DPAPI / libsecret) — Phase 11 scope; this phase ships the `KeySource` callback contract.

## Verdict

`findings`

Seven Critical findings cluster around two themes: (1) WebSocket lifecycle correctness in both wrappers (CR-01, CR-02, CR-03, CR-04 — stop/close does not reliably cancel pending opens or reconnects, and TTS close can hang), and (2) packaging hygiene (CR-05 silent auth degradation, CR-06 test files in published dist, CR-07 build artifacts polluting source). Eleven Warnings cover error-handling silence, leak hardening, test coverage gaps, and over-permissive validators. The SAFE-01/SAFE-03 stance survives review — the secret boundary is well-defended — but lifecycle bugs are real and Phase 11/12 integration will surface them under any retry/restart path. Recommended sequence: fix CR-01..CR-04 (lifecycle), then CR-06 + CR-07 (packaging), then CR-05 (auth fallback), then chase the warnings.

---

_Reviewed: 2026-06-06_
_Reviewer: gsd-code-reviewer_
_Depth: standard_

---

## FIX LOG

Fixes applied on 2026-06-06 by `gsd-code-fixer` against the `Achilles` branch via an isolated `gsd-reviewfix/09-*` worktree. Test count rose from 143 (12 of which were skipped pending dist) to 145 (zero skipped — SAFE-01 grep guard now runs against the rebuilt dist).

| ID    | Status   | Fix summary                                                                                                                                                                                                                                                                       | Commit    |
|-------|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| CR-01 | fixed    | `scheduleReconnect` retains the `setTimeout` handle; `stop()` clears it before tearing down the socket. Defensive lifecycle re-check inside the timer body.                                                                                                                       | be8ac14   |
| CR-02 | fixed    | `connect()` re-reads `lifecycle` through a non-narrowing closure after `await getToken()`; a `stop()` during the token fetch now silently aborts before a fresh WebSocket is constructed.                                                                                          | be8ac14   |
| CR-03 | fixed    | `close()` races `openPromise` against a 250 ms timeout and a `closeSignal` Promise that `ensureOpen()` awaits in parallel with `onopen`. `close()` now always resolves in finite time even when the WebSocket never opens.                                                          | 80778d9   |
| CR-04 | fixed    | TTS `scheduleReconnect` retains the `setTimeout` handle; `close()` clears it. Pre-existing `closedByCaller` guard inside the timer remains.                                                                                                                                       | 80778d9   |
| CR-05 | fixed    | Removed the silent two-arg fallback. Browser-style WebSocket constructors now throw the explicit auth-mode error: `voice-tts WebSocket transport requires Node.js-style WebSocket constructor accepting headers; got browser-style. This package must run in the main process.`   | 80778d9   |
| CR-06 | fixed    | Added `"src/**/*.test.ts"` and `"test/**"` to the exclude arrays of `packages/voice-protocol/tsconfig.json` (was missing entirely) and added `"test/**"` to voice-stt and voice-tts. Verified `dist/` no longer contains `*.test.*` files via `npm run build`.                       | de34785   |
| CR-07 | fixed    | Added `src/.gitignore` to each of voice-protocol / voice-stt / voice-tts with rules for `*.js`, `*.d.ts`, `*.js.map`, `*.d.ts.map`. Current trees verified clean via `find`; gitignore is defence in depth so a future `tsc` without `-p` cannot land artefacts in `git`.            | 01c93c4   |
| WR-01 | fixed    | Schema-parse failures for partial/committed transcripts now `console.error` with the Zod issue and emit a synthetic `SttErrorEventSchema` event (code "unknown", retryable=true) via the existing `emitErrorEvent` helper.                                                          | b09f9ef   |
| WR-02 | fixed    | New `finishStream()` helper closes the WS (code 1000, "stream-complete") and marks the iterable complete in one idempotent step. `stream_complete` and the normal-1000 onclose path both route through it.                                                                          | 80778d9   |
| WR-03 | fixed    | Both wrappers' `events$` now throw on the second `[Symbol.asyncIterator]()` call with a clear "single-consumer" error; protects against silent concurrent-consumer races on shared shift()/awaiter.                                                                                | 82f99d6   |
| WR-04 | fixed    | Listeners are stored in a named bag and removed via `detachAll()` before the socket is replaced. The close handler also compares its own bag to the active `listeners` reference and bails out on mismatch.                                                                       | be8ac14   |
| WR-05 | fixed    | Narrowed the WebSocket-constructor catch to `TypeError` only. OOM/security/URL-parse errors now bubble up unchanged.                                                                                                                                                              | 80778d9   |
| WR-06 | fixed    | `buildInitialFrame` is now a zero-arg function returning the JSON string; the misleading `{ headerFrame, apiKey }` return shape is gone.                                                                                                                                          | 80778d9   |
| WR-07 | fixed    | Mock TTS server constructor now accepts `(url, _protocols?, options?)` and exposes an `optionsSink` callback; new stream-client test asserts `options.headers["xi-api-key"] === TEST_KEY`.                                                                                          | 070a7ac   |
| WR-08 | fixed    | New realtime-client test drives the wrapper through the real close-event pathway, asserts the iterator resolves `done=true`, and asserts no further `onEvent` calls occur after `stop()` even if the mock socket attempts to push.                                                  | aa13df3   |
| WR-09 | fixed    | Replaced both `as SttEvent` / `as TtsEvent` casts on `shift()` with defensive undefined checks; preserves the runtime behaviour but lets the type system enforce the invariant.                                                                                                    | 82f99d6   |
| WR-10 | deferred (documented) | The `passWithNoTests` flag works at runtime (verified against Vitest 2.x's `ResolvedConfig`); the ProjectConfig type gap is pre-existing and tracked in `deferred-items.md`. Added an inline comment in `vitest.workspace.ts` referencing it.                                       | a5e7650   |
| WR-11 | fixed    | Raised `MIN_KEY_LENGTH` from 8 to 32 (matches `ELEVENLABS_KEY_MIN_LENGTH` in `voice-protocol/ipc.ts`). Test fixtures updated to use `sk_test_` + 32 hex chars (40-char total). Added explicit 31-char rejection test to assert the floor value.                                     | 520d30c   |
| IN-01 | deferred (v1.3) | Per fix-scope instructions, added a one-line top-of-file comment to `realtime-client.ts` and `stream-client.ts` documenting that the v1.2 implementation hand-rolls the wire protocol for CI offline-testability; v1.3 will migrate to `@elevenlabs/*` SDKs once a sandbox account is provisioned. The declared SDK dependencies remain in `package.json` for v1.3 migration. | aab9ab8   |
| IN-02 | skipped (Info, out of scope) | Allowlist matcher rejects trailing-dot FQDNs. Not in the fix scope (Critical + Warning only).                                                                                                                                                                                | —         |
| IN-03 | skipped (Info, out of scope) | STT WebSocket subprotocol token-in-header exposure surface. Informational only; not in the fix scope.                                                                                                                                                                       | —         |
| IN-04 | skipped (Info, out of scope) | Duplicate `BACKOFF_BASE_MS` constants. CONTEXT.md notes this is an intentional v1.3 refactor candidate.                                                                                                                                                                       | —         |
| IN-05 | skipped (Info, out of scope) | Mint body `model` literal redundancy. Reviewer's recommendation was "None required".                                                                                                                                                                                          | —         |

### Verification

- `npx vitest run --project phase-09-unit` → 145 passed (was 143; +1 WR-07 header-forwarding assertion, +1 WR-08 strengthened stop test; SAFE-01 grep guard previously 12-of-14 skipped now 0-skipped after `npm run build`).
- `npm test --workspace @achilles/voice-protocol` → 57 passed.
- `npm test --workspace @achilles/voice-stt` → 46 passed.
- `npm test --workspace @achilles/voice-tts` → 42 passed.
- `npx tsc -p packages/voice-protocol/tsconfig.json --noEmit` → clean.
- `npx tsc -p packages/voice-stt/tsconfig.json --noEmit` → clean.
- `npx tsc -p packages/voice-tts/tsconfig.json --noEmit` → clean.
- `npm run build --workspace @achilles/voice-{protocol,stt,tts}` → all three dists rebuilt; no `*.test.*` files in any dist (CR-06 verified at runtime).

_Fixes applied: 2026-06-06_
_Fixer: gsd-code-fixer_
_Worktree: `gsd-reviewfix/09-51880` (transactionally fast-forwarded to `Achilles` on completion)_
