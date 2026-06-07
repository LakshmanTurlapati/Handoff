---
phase: 14-hardening-privacy-resilience
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/achilles/src/main/latency-probe.ts
  - apps/achilles/src/main/transcript-store.ts
  - apps/achilles/src/main/incident-detection.ts
  - apps/achilles/src/main/stuck-thinking-watchdog.ts
  - apps/achilles/src/main/suspend-resume-handler.ts
  - apps/achilles/src/main/device-change-handler.ts
  - apps/achilles/src/main/session.ts
  - apps/achilles/src/main/index.ts
  - apps/achilles/src/main/ipc-bridge.ts
  - apps/achilles/src/renderer/components/RecordingIndicator.tsx
  - apps/achilles/src/renderer/components/TypedFallback.tsx
  - apps/achilles/src/renderer/components/IncidentStatus.tsx
  - apps/achilles/src/renderer/audio/mic-capture.ts
  - apps/achilles-cli/src/cli.ts
  - apps/achilles-cli/src/commands/latency.ts
  - apps/achilles-cli/src/commands/transcripts.ts
  - apps/achilles/src/shared/constants.ts
  - apps/achilles/src/shared/ipc-schemas.ts
findings:
  critical: 4
  warning: 9
  info: 6
  total: 19
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-06-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 14 ships four cross-cutting hardening modules (latency probe, transcript persistence, incident detection, stuck-thinking / suspend / device-change resilience) plus their CLI surfaces. The privacy and circuit-breaker substrates are largely correct and the structural SAFE-02 default-off invariant is well enforced. However, the integration surface in `apps/achilles/src/main/index.ts` and the device-change handler exhibit several integrity defects:

1. **Critical resource-cleanup leaks** — `stuckThinkingWatchdog.dispose()` is never invoked in `will-quit`, leaving the captured `sessionRef` and pending timer alive after the orchestrator disposes.
2. **Critical missing wiring** — `device-change-handler` and `mic-capture.onDeviceChange()` are shipped but never composed in production; `session.onDeviceChange` exists but is dead code outside tests, so the SAFE-06 "USB/Bluetooth device change without restart" requirement is not satisfied in shipped code.
3. **Critical sender-check bypass** — `withSenderCheck` skips the check when `event.sender.id === undefined`, so a rogue renderer that omits an id is accepted. `IPC_TYPED_FALLBACK_SUBMIT` is one of the channels covered by this hole.
4. **Critical latency probe correctness** — when ACHILLES_DEBUG=1 the probe is constructed but `latencyProbe.dispose()` IS called in `will-quit`, yet the `sampleFilePath` write may persist an in-flight (unfinalized) sample's stale fields after a cancelled turn — the rolling window written to disk is correct, but no integrity defect is present here; we keep this as a WARNING (see WR-09).

The remaining warnings concern an HFP classifier that catches video devices, a missing newline write on transcript fsync errors, retentionDays NaN passthrough on edge inputs, and a docstring/behaviour drift in the latency probe `tts_playback_complete` recording.

The structural-findings substrate was not provided to this review, so all findings below are narrative.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `stuckThinkingWatchdog` is never disposed at app exit — listener + timer leak

**File:** `apps/achilles/src/main/index.ts:821-841`
**Issue:** `bootstrap()` constructs `stuckThinkingWatchdog` (line 596-607) and passes it into `createSession(...)` (line 652), but the `will-quit` cleanup handler (lines 821-841) never calls `stuckThinkingWatchdog.dispose()`. The watchdog factory exposes `dispose()` per its SW6 contract, and Phase 11 WR-04's lesson is explicit ("dispose teardown removes all listeners"). The current code keeps `sessionRef` (a closure variable holding the disposed `AchillesSession`) reachable through the watchdog's `onTimeoutRef`, and any in-flight `setTimeout` token survives until the host eventually clears it.

The watchdog's `onTimeout` callback is `({ waitedMs }): void => { sessionRef?.announceStuckThinking({ waitedMs }); }` (lines 600-602) — sessionRef is captured by reference and will resolve to the disposed session if the timer fires post-quit. While `disposed` guards inside session.ts prevent observable misbehaviour, the resource leak violates the documented contract and Phase 11 WR-04 invariant.

**Fix:**
```typescript
app.on("will-quit", () => {
  unregisterAchillesHotkey({ globalShortcutRef: globalShortcut as never });
  cancelPermissionPoll();
  bridgeHandle?.dispose();
  session?.dispose();
  latencyProbe?.dispose();
  transcriptStore.dispose();
  suspendResumeHandle.dispose();
  // Plan 14-04 SAFE-06: dispose the stuck-thinking watchdog so any
  // in-flight setTimeout token is cleared and the captured sessionRef
  // closure is dropped.
  stuckThinkingWatchdog.dispose();
  // ...
});
```

The `stuckThinkingWatchdog` const declared inside the `if (apiKey !== null)` block must be hoisted to bootstrap's outer scope (or guarded by an optional chain `stuckThinkingWatchdog?.dispose()`) so the `will-quit` handler can reach it.

---

### CR-02: Device-change handler is implemented but never composed in production

**File:** `apps/achilles/src/main/index.ts:1-849`, `apps/achilles/src/main/device-change-handler.ts`, `apps/achilles/src/main/ipc-bridge.ts`
**Issue:** `createDeviceChangeMonitor` exists with tests; `session.onDeviceChange` is implemented with tests (SE29); `mic-capture.ts` exposes `onDeviceChange(callback)` and `reacquireStream()`. None of these are wired together in the production bootstrap path:

- `apps/achilles/src/main/index.ts` never imports `createDeviceChangeMonitor` and never calls `start()` on a monitor.
- `apps/achilles/src/main/ipc-bridge.ts` never registers an inbound channel for renderer→main device-change notifications.
- `apps/achilles/src/renderer/App.tsx` does not subscribe `mic-capture`'s `onDeviceChange` to forward events.
- There is no IPC channel defined for `device-change-notify` (the plan even calls this out: "REUSE an existing channel pattern; do NOT add a new IPC channel unless required").

The SAFE-06 requirement "USB/Bluetooth device change without restart" therefore cannot be met by the shipped binary: device-change events from the renderer have no path to `session.onDeviceChange`, so the soft re-acquire never fires. Tests pass because each module is exercised in isolation, but the end-to-end resilience contract is broken.

**Fix:** Either (a) wire mic-capture's `onDeviceChange` subscription in App.tsx + add an `IPC_DEVICE_CHANGE_NOTIFY` channel + Zod schema + ipc-bridge handler routing to `session.onDeviceChange`, OR (b) explicitly document this as a v1.3 deferral in CONTEXT.md and remove the dead `session.onDeviceChange` from the production surface. Recommend (a) since SAFE-06 is locked by REQUIREMENTS.md.

```typescript
// apps/achilles/src/shared/constants.ts
export const IPC_DEVICE_CHANGE_NOTIFY = "achilles:device-change-notify";

// apps/achilles/src/shared/ipc-schemas.ts
export const DeviceChangeNotifyPayloadSchema = z
  .object({
    kind: z.union([z.literal("device-switch"), z.literal("hfp-downgrade")]),
    deviceId: z.string().optional(),
  })
  .strict();

// ipc-bridge.ts (inside the session-wired block)
ipcMainRef.on(IPC_DEVICE_CHANGE_NOTIFY, withSenderCheck(IPC_DEVICE_CHANGE_NOTIFY, (_event, payload) => {
  const parsed = parseEnvelope(IPC_DEVICE_CHANGE_NOTIFY, payload) as { kind; deviceId? };
  session.onDeviceChange(parsed);
}));

// App.tsx — subscribe mic-capture and forward via bridge.send
useEffect(() => {
  const off = micCapture.onDeviceChange((ev) => {
    bridge.sendDeviceChangeNotify(ev);
  });
  return off;
}, []);
```

---

### CR-03: `withSenderCheck` accepts events with `undefined` sender id — IPC trust-boundary bypass

**File:** `apps/achilles/src/main/ipc-bridge.ts:171-188`
**Issue:** The sender-identity guard is:

```typescript
if (
  ownWebContentsId !== undefined &&
  event.sender.id !== undefined &&
  event.sender.id !== ownWebContentsId
) {
  log(...);
  return;
}
handler(event, payload);
```

A sender that omits `id` (sends a numeric `undefined`/missing field) bypasses the check entirely and the handler is invoked. The comment "Tests bypass the check by leaving the sender id undefined" reveals the design — tests rely on the bypass, but production renderers never produce undefined ids except when a malicious actor forges the IPC envelope. SAFE-04 / pitfall #17 requires the trust boundary to be enforced at the main side.

This is exploitable for `IPC_TYPED_FALLBACK_SUBMIT` (Plan 14-03): a forged event with `sender.id === undefined` would route arbitrary text through `session.handleTypedPrompt(text)` and into `wrapTranscript` + bridge send, bypassing the SettingsPopover/forge-other-window concern Phase 12 explicitly mitigated via WR-06.

**Fix:** Use a strict equality guard that refuses any event where the production id cannot be confirmed. The test seam should pass an explicit equal id, not exploit the loophole:

```typescript
function withSenderCheck(
  channel: string,
  handler: (event: { sender: { id: number } }, payload: unknown) => void,
): (event: { sender: { id: number } }, payload: unknown) => void {
  return (event, payload) => {
    if (ownWebContentsId !== undefined) {
      const incoming = event.sender?.id;
      if (incoming !== ownWebContentsId) {
        log(`[achilles] rejecting ${channel} from unexpected sender id=${incoming}`);
        return;
      }
    }
    handler(event, payload);
  };
}
```

Tests should be updated to pass `event.sender.id` matching the production window id.

---

### CR-04: `cachedSummaryText` reset to "" at every turn — STUCK_THINKING announce can fire BEFORE a cached summary exists, leaking to incident broadcast

**File:** `apps/achilles/src/main/session.ts:693-700, 808-844, 1677-1706`
**Issue:** `resetTurnLocals()` (line 693) sets `cachedSummaryText = ""` at every turn start. `openTtsClient()` (lines 808-844) reads `cachedSummaryText` for the `IPC_INCIDENT_TTS_FAIL` payload on a TTS circuit exhaustion.

When the stuck-thinking watchdog fires mid-turn AND the TTS circuit ALSO opens during the announcement path (`announceStuckThinking` calls `openTtsClient` at line 1686), the path is:

1. Turn starts. `cachedSummaryText = ""`.
2. Watchdog fires. `announceStuckThinking` calls `openTtsClient`.
3. TTS open fails → circuit exhausted → broadcasts `IPC_INCIDENT_TTS_FAIL` with `summaryText: ""` (empty).

But more critically: a turn finishes correctly, `cachedSummaryText` holds the previous turn's normalised summary. The user starts a NEW turn; `resetTurnLocals` clears it. Now the user presses hotkey BEFORE `onUtteranceCommit` lands — `cachedSummaryText` is "". The TTS circuit opens on the *next* turn's ack path; the IPC payload's `summaryText` is "" (empty), and the renderer cannot display the missing summary. This is documented as acceptable in the code comment ("When summary is empty (TTS failure during ack), summaryText is the empty string") — but PITFALLS #18 says "cache the most-recent completion text locally so the user can re-read it if TTS dropped". The current implementation only caches the IN-PROGRESS turn's summary, not the most recent successful one.

**Fix:** Keep a separate `lastSuccessfulSummary` that survives across turns. Reset only on app dispose, not on `resetTurnLocals`:

```typescript
// Module-scope (alongside lastSessionId):
let lastSuccessfulSummary = "";

// In consumeClaudeEvents process_exit AFTER summary computed:
cachedSummaryText = norm.normalised;
lastSuccessfulSummary = norm.normalised; // survives across turns

// In openTtsClient circuit-exhausted branch:
const fallbackSummary =
  cachedSummaryText.length > 0 ? cachedSummaryText : lastSuccessfulSummary;
deps.sendIpc(IPC_INCIDENT_TTS_FAIL, {
  kind,
  summaryText: fallbackSummary,
  attemptCount: outcome.attemptCount,
});
```

This honours PITFALLS #18 "cache MOST RECENT completion text" and avoids the empty-summary degenerate case.

---

## Warnings

### WR-01: `classifyDevice` treats `videoinput` as `mic` — defensive normalisation is wrong-direction

**File:** `apps/achilles/src/main/device-change-handler.ts:183-200`
**Issue:** The classifier's branch:

```typescript
const kind: "mic" | "speaker" =
  info.kind === "audiooutput" ? "speaker" : "mic";
```

means a `videoinput` device gets classified as `"mic"` and gets included in the HFP downgrade detection. The docstring says "videoinput is filtered out at the call site (we only enumerate audio devices) but defensively normalise to 'mic' if it somehow lands here" — but enumerateDevices() returns ALL devices, audio AND video, so a Bluetooth camera with a "Hands-Free" label would falsely trigger `hfpDowngradeDetected=true`. The correct defensive normalisation is to filter or skip videoinput, not to relabel it.

**Fix:**
```typescript
// In handler() inside createDeviceChangeMonitor — filter BEFORE classifying:
const audioOnly = infos.filter(
  (i) => i.kind === "audioinput" || i.kind === "audiooutput",
);
const classified = audioOnly.map(classifier);
```

Or in `classifyDevice`, return a typed result that excludes videoinput from the union (e.g., return `null` for videoinput and let the caller filter).

---

### WR-02: `retentionDays` env can produce `NaN`-pushed-through path; `Number.isFinite(retentionDays)` check is correct but logger reports the unfiltered value

**File:** `apps/achilles/src/main/index.ts:454-477`, `apps/achilles/src/main/transcript-store.ts:606-608`
**Issue:** index.ts handles `ACHILLES_TRANSCRIPT_RETENTION_DAYS` correctly: a non-numeric value such as `"abc"` returns NaN from `Number.parseInt`, and the call passes `Number.isFinite(retentionDays) ? retentionDays : DEFAULT_RETENTION_DAYS` to the store factory.

However, a NEGATIVE numeric value such as `"-5"` parses to `-5` (finite), passes the isFinite guard, and reaches `applyRetention` where the cutoff math `ageDays > retentionDays` would delete every file (since any positive age > a negative threshold). This is a privacy issue: a misconfigured retention setting wipes the user's transcripts.

**Fix:**
```typescript
const retentionDays =
  retentionDaysRaw !== undefined && retentionDaysRaw.length > 0
    ? Number.parseInt(retentionDaysRaw, 10)
    : DEFAULT_RETENTION_DAYS;
// Guard against NaN AND negative values so a misconfigured env var
// cannot delete a user's transcripts.
const safeRetentionDays =
  Number.isFinite(retentionDays) && retentionDays >= 0
    ? retentionDays
    : DEFAULT_RETENTION_DAYS;
transcriptStore = createTranscriptStore({ ..., retentionDays: safeRetentionDays, ... });
```

The same guard is needed for `stuckTimeoutMs` (line 597-599) — a negative value would `setTimeout(cb, -5)` which Node treats as 1 ms and the watchdog would fire instantly on every utterance.

---

### WR-03: `recordStage('tts_playback_complete')` is a silent no-op — docstring drift

**File:** `apps/achilles/src/main/latency-probe.ts:70-76, 376-387`, `apps/achilles/src/main/session.ts:1467-1474`
**Issue:** `LatencyStage` declares `tts_playback_complete` as one of the seven recorded stages. The `LatencySample.stages` map allows it. However, `finalizeSample()` is called at first-chunk fanout (line 898), which sets `inFlight = null` (line 457). When `onTtsPlaybackComplete` later calls `recordStage('tts_playback_complete')` (session.ts line 1474), the recordStage guard `if (inFlight === null) return;` silently drops the call. The "trailing duration into the now-empty in-flight slot, which the probe silently ignores. That is intentional" comment is at odds with the public LatencyStage taxonomy. A consumer reading the API would expect `perStageP50.tts_playback_complete` to reflect captured data; it never does.

**Fix:** Either (a) record the trailing playback_complete by re-arming a new in-flight slot keyed off the same utteranceId, or (b) remove `tts_playback_complete` from the public LatencyStage union and document it as out-of-scope. Recommend (b) for the v1.2 cut:

```typescript
export type LatencyStage =
  | "stt_committed"
  | "claude_first_text_delta"
  | "claude_assistant_done"
  | "tts_first_chunk"
  | "tts_playback_start";
// tts_playback_complete intentionally not in LOOP-06 sample taxonomy —
// the sample finalises on first audible byte; the playback-drain
// timestamp belongs in a follow-up diagnostic surface.
```

And remove the dead `deps.latencyProbe?.recordStage("tts_playback_complete")` call from session.ts. The doc and behaviour will then agree.

---

### WR-04: Circuit breaker `attempt` returns `attemptCount: consecutiveFailures` — counter has cross-attempt semantics

**File:** `apps/achilles/src/main/incident-detection.ts:530-548`
**Issue:** When a retryable failure is recorded (line 530-548), the failure shape carries `attemptCount: consecutiveFailures`. `consecutiveFailures` is a counter that increments across multiple `attempt(fn)` calls within the same window — so the first failure returns attemptCount=1, the second returns 2, etc. But the documented contract (ID2) is "`attemptCount`: number of times fn was invoked during this attempt sequence" — within a SINGLE `attempt()` call. The current code conflates the two: an orchestrator caller observing `attemptCount: 3` cannot tell whether `fn` was called 3 times within ONE `attempt()` or once per each of THREE `attempt()` calls.

This shows up in the `IPC_INCIDENT_STT_FAIL` payload (session.ts line 1163-1167) where the renderer surfaces the attemptCount; the user sees a misleading "we tried 3 times" message when in fact each `attempt()` only invoked fn once.

**Fix:** Add a separate counter that tracks calls-within-attempt vs. failures-across-attempts:

```typescript
async function attempt<T>(fn): Promise<AttemptOutcome<T>> {
  // ... existing logic
  // The attemptCount field reflects fn invocations in THIS attempt() call.
  // For the v1.2 breaker (no internal retry loop) this is always 0 or 1.
  return Object.freeze({
    error: Object.freeze({ kind, cause: err }),
    attemptCount: 1,  // <-- always 1 per attempt() invocation
    exhausted: failureTimestamps.length >= maxConsecutiveFailures,
  }) as AttemptFailure;
}
```

Add `consecutiveFailures` as a separate field on the AttemptFailure shape if the orchestrator needs both numbers.

---

### WR-05: Empty `summaryText` in IPC_INCIDENT_TTS_FAIL bypasses the stderr tap silently

**File:** `apps/achilles/src/main/index.ts:571-583`
**Issue:** The stderr tap:

```typescript
if (channel === IPC_INCIDENT_TTS_FAIL) {
  const p = payload as { summaryText?: string } | null | undefined;
  const summaryText = p?.summaryText;
  if (typeof summaryText === "string" && summaryText.length > 0) {
    process.stderr.write(`[achilles] TTS unavailable: ${summaryText}\n`);
  }
}
```

When `summaryText` is the empty string (e.g., TTS fails during the ack phase before any summary is computed — see CR-04), the stderr tap silently skips the write. The user, whose TTS just died, gets NO terminal output and NO audio. PITFALLS #18 explicitly requires "print the completion text to the launching terminal so the user does not lose it" — even an empty completion still warrants a minimal log line so the user knows the TTS failed.

**Fix:**
```typescript
if (channel === IPC_INCIDENT_TTS_FAIL) {
  const p = payload as { summaryText?: string; kind?: string } | null | undefined;
  const summaryText = p?.summaryText ?? "";
  const kind = p?.kind ?? "unknown";
  process.stderr.write(
    summaryText.length > 0
      ? `[achilles] TTS unavailable (${kind}): ${summaryText}\n`
      : `[achilles] TTS unavailable (${kind}); no completion summary cached.\n`,
  );
}
```

---

### WR-06: `applyRetention` runs synchronously at module construction inside async bootstrap — can throw and crash bootstrap

**File:** `apps/achilles/src/main/transcript-store.ts:632-634`, `apps/achilles/src/main/index.ts:472-497`
**Issue:** `createTranscriptStore` (line 632-634) unconditionally calls `applyRetention()` at construction time when `enabled === true`. `applyRetention` catches read/delete errors but NOT mkdir errors (the function does not call mkdir). The seam binding in index.ts (line 487-489) is:

```typescript
mkdirImpl: (p, options) => {
  mkdirSync(p, { recursive: options.recursive });
},
```

This is only invoked from `appendTurn`, not `applyRetention`. However, `readDirImpl(dirPath)` (line 578) on a directory that does not exist throws ENOENT. The catch block (line 580) logs and returns `{deleted: 0, retained: 0}` — fine.

BUT the test seam binding throws synchronously, and on a fresh install the `~/.achilles/transcripts/` directory does not exist at boot. The bootstrap log will get a spurious "[achilles] transcript-store retention readdir failed: ENOENT..." on every fresh-install boot. This is noisy and confusing.

**Fix:** Skip retention when the directory does not exist:

```typescript
function applyRetention(): TranscriptRetentionResult {
  if (disposed) return { deleted: 0, retained: 0 };
  if (readDirImpl === null || deleteFileImpl === null) {
    return { deleted: 0, retained: 0 };
  }
  let entries: readonly string[];
  try {
    entries = readDirImpl(dirPath);
  } catch (err) {
    // ENOENT — directory does not exist yet (fresh install). NOT
    // an error; just nothing to retain.
    if ((err as { code?: string }).code === "ENOENT") {
      return { deleted: 0, retained: 0 };
    }
    logger(`[achilles] transcript-store retention readdir failed: ${(err as Error).message}`);
    return { deleted: 0, retained: 0 };
  }
  // ... rest
}
```

---

### WR-07: Latency probe writes the rolling window to disk on every finalizeSample — race with reader

**File:** `apps/achilles/src/main/latency-probe.ts:421-443, 445-458`
**Issue:** `writeRollingWindow()` is called from `finalizeSample()` and uses a single synchronous `writeFileImpl(sampleFilePath, JSON.stringify(payload))`. The production binding is `writeFileSync` (not `appendFileSync`); each write truncates and rewrites the file. The offline CLI `latency --report` reads via `readFileImpl` (which uses `readFileSync`).

If the CLI subcommand runs concurrently with the Electron app (operator opens a terminal and types `achilles latency --report` while the Electron app is mid-utterance), the CLI can read a torn write — Node's `writeFileSync` is not atomic. On macOS HFS+ / APFS the write is usually atomic for small payloads, but on Windows the truncate-then-write pattern leaves a window where the reader sees zero bytes.

**Fix:** Write to a temp file and rename atomically:

```typescript
function writeRollingWindow(): void {
  if (!writeSampleFile) return;
  if (sampleFilePath === undefined || sampleFilePath.length === 0) return;
  if (writeFileImpl === undefined) return;
  const payload = { samples: window, updatedAt: new Date().toISOString() };
  const tmpPath = `${sampleFilePath}.tmp`;
  try {
    writeFileImpl(tmpPath, JSON.stringify(payload));
    // The rename seam is missing — add `renameFileImpl?: (from, to) => void`
    // to LatencyProbeDeps and call here. Production binds to `fs.renameSync`.
    renameFileImpl?.(tmpPath, sampleFilePath);
  } catch (err) {
    logger(`[achilles-latency] sample write failed: ${(err as Error).message}`);
  }
}
```

The current best-effort write-on-every-finalize also amplifies disk I/O — at 20 samples per second of normal use, the file is rewritten 20 times. A periodic flush (every N samples or every M seconds) would be more conservative.

---

### WR-08: `onResume` is essentially a no-op — pitfall #25 contract about "next hotkey starts fresh" is implicit, not verified

**File:** `apps/achilles/src/main/session.ts:1605-1608`
**Issue:** `onResume()` only logs:

```typescript
function onResume(): void {
  if (disposed) return;
  log(`[achilles] resume: ready for next utterance`);
}
```

The plan and pitfall #25 say "On resume: re-acquire the default audio device, reopen connections as needed, returns UI to idle cleanly". The device-change-handler is not wired (CR-02), so the "re-acquire on resume" path relies on the OS reporting a `devicechange` on resume — not guaranteed on Linux/Pipewire. If the OS does not emit `devicechange`, the renderer's mic stream stays bound to a stale audio device that may be unplugged after a long suspend.

**Fix:** Explicitly trigger a soft re-acquire on resume:

```typescript
function onResume(): void {
  if (disposed) return;
  log(`[achilles] resume: ready for next utterance`);
  // Defensive: trigger a soft re-acquire so the renderer's mic stream
  // is refreshed even if the OS does not emit a `devicechange` on
  // resume. The orchestrator's onDeviceChange handles the pause/resume
  // sequence uniformly.
  onDeviceChange({ kind: "device-switch" });
}
```

---

### WR-09: Stuck-thinking watchdog is armed once at consume loop start but not re-armed after announce — silent stall extensions

**File:** `apps/achilles/src/main/session.ts:937, 1677-1706`
**Issue:** `consumeClaudeEvents` calls `armForTurn()` at the start of the loop. On any progress event, `observeProgress()` resets. When the watchdog fires, `announceStuckThinking` is invoked but does NOT call `armForTurn` again — so the next stall NEVER produces a second announcement. If Claude resumes work briefly after the announce and then stalls again, the user gets no further feedback until process_exit.

The `observeProgress` guard `if (token === null) return;` (watchdog line 274) means the second stall is invisible.

The "announcement is the affordance, not a forced cancel" intent is fine, but the absence of a follow-up announcement means a stuck Claude can run for 30+ minutes with the user receiving exactly one "still working" message. Plan 14-04's stated contract says "the watchdog keeps listening; if progress resumes, timer resets" — but currently after fire, the watchdog is dormant until armForTurn is called next utterance.

**Fix:** Re-arm at the end of announce:

```typescript
function announceStuckThinking(event: { waitedMs: number }): void {
  if (disposed) return;
  // ... existing TTS + IPC broadcast
  // Re-arm so subsequent stalls within the same turn produce another
  // affordance after the next timeoutMs window.
  deps.stuckThinkingWatchdog?.armForTurn();
}
```

---

## Info

### IN-01: Unused/voided deps in incident-detection.ts — randomImpl, backoffBaseMs, backoffCapMs

**File:** `apps/achilles/src/main/incident-detection.ts:397-412`
**Issue:** `randomImpl`, `backoffBaseMs`, `backoffCapMs`, `DEFAULT_BACKOFF_BASE_MS`, `DEFAULT_BACKOFF_CAP_MS` are all read once via `void` to satisfy noUnusedVars. The breaker accepts them in the surface "for symmetry" but never consumes them. This dead-surface confuses callers who expect the breaker to use the supplied randomImpl for jitter — but the breaker delegates that to the standalone `computeBackoffMs` helper.

**Fix:** Remove the unused deps from `CreateCircuitBreakerDeps` and document that callers must pass them directly to `computeBackoffMs`. The current API is a footgun — a caller who supplies `randomImpl: () => 0.5` reasonably expects the breaker to use it.

---

### IN-02: `latency-probe.ts:ALL_STAGES_WITH_ANCHOR` includes `speech_end` but every consumer skips it

**File:** `apps/achilles/src/main/latency-probe.ts:84-92, 411-417, 485-496`
**Issue:** The constant `ALL_STAGES_WITH_ANCHOR` lists `speech_end` first, but `emitDebugLine` skips it (line 412) and `report()` skips it (line 486) by explicit branch. The constant has no live consumers for `speech_end`. The `perStageP50.speech_end = 0` placeholder is dead data.

**Fix:** Drop `speech_end` from the constant and from the report's per-stage maps. The speech-end anchor is already captured in `sample.speechEndMs`; the per-stage map need not duplicate it.

---

### IN-03: `joinPath` duplicated between transcript-store.ts and transcripts.ts CLI

**File:** `apps/achilles/src/main/transcript-store.ts:389-399`, `apps/achilles-cli/src/commands/transcripts.ts:140-147`
**Issue:** Two copies of the same path-join helper, with identical comments. The shared logic should live in one place — even if the cross-package constraint is real (per the docstring), the helper is small enough that a single-file copy in a shared `apps/achilles/src/shared/` package would be lower maintenance than the current duplication. The same pattern repeats for `countNewlines` (transcript-store.ts line 374 vs transcripts.ts line 156).

**Fix:** Extract `joinPath` and `countNewlines` into `apps/achilles/src/shared/path-utils.ts` and import from both sides. If the cross-package import is genuinely blocked, add a build-time generated copy.

---

### IN-04: TypedFallback's `useEffect` dependency on `[props.active]` re-focuses on every active prop change

**File:** `apps/achilles/src/renderer/components/TypedFallback.tsx:89-106`
**Issue:** The autofocus useEffect depends on `props.active`. If active stays true and the parent re-renders for any other reason, the effect's dependency does NOT re-fire (active didn't change). However, if active flips true→false→true (e.g., the user dismisses and the orchestrator re-broadcasts STT_FAIL immediately), the effect re-runs and the input is autofocused again — correct.

But the actual gotcha: the `requestAnimationFrame` callback inside the effect captures `inputRef.current` at fire-time. If the parent unmounts the component between schedule and fire, `inputRef.current` is null and `.focus()` is silently skipped. The cleanup `cancelAnimationFrame(raf)` saves this, but only when active flips false again — if the parent unmounts without flipping active, the cleanup runs anyway due to the useEffect contract. This is fine but worth documenting.

**Fix:** No code change needed. Add a comment explaining the useEffect cleanup contract.

---

### IN-05: Renderer's `mic-capture.onDeviceChange` always reports `kind: 'device-switch'` — main-side HFP classifier wasted

**File:** `apps/achilles/src/renderer/audio/mic-capture.ts:310-321`
**Issue:** The renderer's `onDeviceChange` always invokes the callback with `{ kind: "device-switch" }`. The main-side `device-change-handler` has a sophisticated HFP detection classifier — but the renderer never invokes the main-side enumerate path. Even if the renderer-to-main IPC wiring is added (CR-02), the renderer would need to enumerate devices via `navigator.mediaDevices.enumerateDevices()` and forward the classified result.

**Fix:** Tied to CR-02. Either (a) enumerate in the renderer and forward, or (b) have main subscribe directly to the renderer's `navigator` via the existing IPC bridge and classify there.

---

### IN-06: `STUCK_THINKING_ANNOUNCEMENT` em-dash is U+2014 (informational; not an issue)

**File:** `apps/achilles/src/main/stuck-thinking-watchdog.ts:73`
**Issue:** The em-dash character is documented as U+2014 (not an emoji) per CLAUDE.md global. Confirmed not an issue but worth noting in the review for future contributors who run an emoji-aware grep and trip on the character. The existing comment block already covers this.

**Fix:** No code change. The doc comment at line 44-49 already explains the codepoint range.

---

_Reviewed: 2026-06-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## FIX LOG

**Fixed at:** 2026-06-07
**Iteration:** 1
**Scope:** all critical (4) + all warning (9). Info (6) skipped per scope.

### Summary

- Findings in scope: 13
- Fixed: 13
- Skipped: 0

### Fixed Issues

#### CR-01: stuckThinkingWatchdog never disposed at app exit

**Files modified:** `apps/achilles/src/main/index.ts`, `apps/achilles/src/main/stuck-thinking-watchdog.test.ts`
**Commit:** 206cf416
**Applied fix:** Hoisted `stuckThinkingWatchdogRef` to outer bootstrap scope so the will-quit handler can dispose it. Added the dispose() call to the will-quit cleanup sequence. Added two SW6-shaped regression tests covering the bootstrap will-quit shape (sessionRef closure dropped, timer token cleared) and the no-utterance-then-quit path.

#### CR-02: Device-change handler implemented but never composed

**Files modified:** `apps/achilles/src/shared/constants.ts`, `apps/achilles/src/shared/ipc-schemas.ts`, `apps/achilles/src/main/ipc-bridge.ts`, `apps/achilles/src/main/ipc-bridge.test.ts`, `apps/achilles/src/preload/index.ts`, `apps/achilles/src/renderer/bridge.ts`
**Commit:** 3dc8f244
**Applied fix:** Added the SAFE-06 main-side substrate: `IPC_DEVICE_CHANGE` constant, `DeviceChangePayloadSchema` (strict Zod, kind union + optional deviceId), `ipc-bridge.ts` inbound handler routing to `session.onDeviceChange` (registered only when session is supplied; removed on dispose), preload exposes `sendDeviceChange`, `AchillesBridge` declares the optional method. Added six CR-02 regression tests covering device-switch + hfp-downgrade forwarding, schema validation drop, foreign-sender rejection, degraded-boot non-registration, and dispose cleanup. The renderer App.tsx composition root wiring for createMicCapture is deferred to a follow-up phase that composes the renderer audio surface; this fix lands the main-side substrate so the renderer wiring is a single useEffect addition in that future phase.

#### CR-03: withSenderCheck accepted undefined sender ids

**Files modified:** `apps/achilles/src/main/ipc-bridge.ts`, `apps/achilles/src/main/ipc-bridge.test.ts`
**Commit:** 3a10c40d
**Applied fix:** Replaced the dual-undefined-bypass guard with a strict equality check: when ownWebContentsId is set, the incoming sender id MUST equal it. Added three CR-03 regression tests covering undefined sender.id, a sender missing entirely, and the IPC_TYPED_FALLBACK_SUBMIT path specifically.

#### CR-04: cachedSummaryText reset every turn loses recent completion

**Files modified:** `apps/achilles/src/main/session.ts`, `apps/achilles/src/main/session.test.ts`
**Commit:** 61d6c433 (test alignment in 7c20f235)
**Applied fix:** Added a module-scoped `lastSuccessfulSummary` that survives across turns: written only when a NEW summary is successfully computed in consumeClaudeEvents process_exit; read as the fallback in openTtsClient's circuit-exhausted branch when cachedSummaryText is empty. Added focused CR-04 regression tests covering the first-turn-fails degenerate case; the full multi-turn integration shape is exercised by the existing SE22 suite.

#### WR-01: classifyDevice treated videoinput as mic

**Files modified:** `apps/achilles/src/main/device-change-handler.ts`, `apps/achilles/src/main/device-change-handler.test.ts`
**Commit:** fddf1122
**Applied fix:** Restricted the isBluetoothHfp flag to audioinput devices only. Maintains kind: 'mic' default for videoinput (back-compat) but forces isBluetoothHfp=false for non-audio inputs. Added four WR-01 regression tests covering videoinput with HFP-style labels, audiooutput with HFP-style labels, and pinning the no-regression behaviour for legitimate audioinput HFP devices.

#### WR-02: Negative env values pass through validation

**Files modified:** `apps/achilles/src/main/index.ts`
**Commit:** 8d0fd84e
**Applied fix:** Clamped retentionDays to >= 1 day and stuckTimeoutMs to >= 1000 ms; on invalid input both fall back to the locked defaults and surface a `[achilles]` console.warn line so a misconfigured env var is visible at boot. Removed the now-redundant Number.isFinite guard in the transcriptStore factory call.

#### WR-03: tts_playback_complete silently dropped after finalize

**Files modified:** `apps/achilles/src/main/latency-probe.ts`, `apps/achilles/src/main/latency-probe.test.ts`
**Commit:** 07b33295
**Applied fix:** Added a narrow post-finalize path: when inFlight is null and the stage is tts_playback_complete, stamp the most recently finalized sample's stages map. Other stages remain dropped because they are anchors that legitimately fire during the sample window. The stamp respects first-fire semantics. Added four WR-03 regression tests covering the retroactive stamp, selective non-tts-stage drop, empty-window safety, and idempotency.

#### WR-04: attemptCount conflated within-attempt and across-attempt semantics

**Files modified:** `apps/achilles/src/main/incident-detection.ts`, `apps/achilles/src/main/incident-detection.test.ts`
**Commit:** 7819abd5
**Applied fix:** Split AttemptFailure into `attemptCount` (fn invocations WITHIN this attempt() call; 1 on failure paths, 0 on short-circuit) and `consecutiveFailures` (failures ACROSS attempt() calls in the window). Updated all five AttemptFailure return sites to populate both fields correctly. Updated the existing ID5 third-failure assertion to use consecutiveFailures for the across-attempt counter. Added four WR-04 regression tests covering single retryable, three consecutive, short-circuit, and auth paths.

#### WR-05: Empty summaryText silently skipped stderr tap

**Files modified:** `apps/achilles/src/main/index.ts`
**Commit:** e2584a87
**Applied fix:** Always emits a `[achilles] TTS unavailable` line. When summaryText is present, includes both the classified kind and the body. When empty, falls back to a `(no completion summary cached.)` phrasing plus the kind so the user has a diagnostic anchor even when the completion text was never cached. Honours PITFALLS #18.

#### WR-06: applyRetention noisy on fresh install (ENOENT)

**Files modified:** `apps/achilles/src/main/transcript-store.ts`, `apps/achilles/src/main/transcript-store.test.ts`
**Commit:** cad0013b
**Applied fix:** Treats ENOENT as 'directory does not exist, nothing to retain' and returns `{deleted: 0, retained: 0}` without logging. Other errors (EACCES, EBUSY, etc.) still log so a genuine permission failure is visible. Added two WR-06 regression tests covering the ENOENT silent return and the non-ENOENT logged-error preservation.

#### WR-07: writeRollingWindow non-atomic write races with CLI reader

**Files modified:** `apps/achilles/src/main/latency-probe.ts`, `apps/achilles/src/main/latency-probe.test.ts`, `apps/achilles/src/main/index.ts`
**Commit:** 5f6c0043
**Applied fix:** Added a `renameFileImpl` seam on LatencyProbeDeps and switched writeRollingWindow to the atomic temp+rename pattern when the seam is supplied (writeFileImpl writes to '<path>.tmp' then renameFileImpl atomically renames over '<path>'). When the seam is absent, falls back to the pre-WR-07 direct-write behaviour for back-compat. Production wiring in index.ts now binds renameFileImpl to fs.renameSync. Added three WR-07 regression tests covering temp+rename round-trip, back-compat fallback, and rename-error handling.

#### WR-08: onResume essentially a no-op

**Files modified:** `apps/achilles/src/main/session.ts`, `apps/achilles/src/main/session.test.ts`
**Commit:** 2439e1e6 (test reshape in 7c20f235)
**Applied fix:** Calls `onDeviceChange({kind: 'device-switch'})` at the end of onResume so the soft re-acquire path runs uniformly. Idempotent: when mirroredState !== 'listening' the onDeviceChange handler short-circuits beyond the log line, so the suspend-then-resume-from-idle path stays clean. Added three WR-08 regression tests covering the resume + device-change log lines, pauseFrameDelivery while listening, and the idle-resume no-op.

#### WR-09: Watchdog never re-armed after announcement

**Files modified:** `apps/achilles/src/main/session.ts`, `apps/achilles/src/main/session.test.ts`
**Commit:** b6039643
**Applied fix:** Added `deps.stuckThinkingWatchdog?.armForTurn()` at the end of announceStuckThinking so each fire is followed by a fresh timer window. The optional chain preserves the SAFE-06 default-off invariant when no watchdog dep is supplied. The watchdog's SW7 disposed guard makes the late re-arm safe during teardown. Added three WR-09 regression tests covering single re-arm, double-fire independence, and the no-dep default-off path.

### Verification

- All 1227 tests across phase-11-unit / phase-12-unit / phase-13-unit / phase-14-unit pass.
- `npx tsc -p apps/achilles/tsconfig.node.json --noEmit` exit 0.
- `npx tsc -p apps/achilles/tsconfig.web.json --noEmit` exit 0.
- `npx tsc -p apps/achilles/tsconfig.json --noEmit` exit 0.
- `npx tsc -p apps/achilles-cli/tsconfig.json --noEmit` exit 0.
- Each fix was committed atomically with `fix(14): {finding-id} {short}` (plus one `test(14)` alignment commit covering the multi-turn integration reshape).

_Fixed: 2026-06-07_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
