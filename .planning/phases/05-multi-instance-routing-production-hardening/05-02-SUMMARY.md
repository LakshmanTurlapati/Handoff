---
phase: 05-multi-instance-routing-production-hardening
plan: 02
subsystem: infra
tags: [fly, replay, websocket, relay, routing]
requires:
  - phase: 05-01
    provides: durable relay owner metadata and browser owner-resolution guards
provides:
  - Fly replay responses for wrong-instance browser traffic
  - explicit owner_unavailable handling after replay failure
  - reconnect identity coverage for bridge.register
affects: [05-03, browser-routing, relay-ops]
tech-stack:
  added: []
  patterns:
    - same-app Fly replay using owner machine metadata from durable leases
    - replay-failed requests fail closed before local websocket upgrade
key-files:
  created:
    - apps/relay/src/ownership/replay-routing.ts
    - apps/relay/tests/unit/ws-browser-replay.test.ts
    - apps/bridge/tests/unit/relay-connection.test.ts
  modified:
    - apps/relay/src/routes/ws-browser.ts
    - apps/relay/tests/unit/ws-browser.test.ts
key-decisions:
  - "Return Fly replay JSON from the relay edge instead of teaching owner-specific relay URLs to the browser."
  - "Treat `fly-replay-failed` and replayed stale-owner requests as `owner_unavailable` so wrong-instance requests never fall back to local adoption."
  - "Preserve a stable bridgeInstanceId across reconnects and validate it at the bridge daemon boundary instead of inventing a second ownership identifier."
patterns-established:
  - "Replay pattern: wrong-instance browser routes emit `application/vnd.fly.replay+json` with owner machine state before local handling."
  - "Failure pattern: replay-attempt headers short-circuit to explicit 503 owner_unavailable responses."
requirements-completed: [OPS-03, SEC-04]
duration: 5min
completed: 2026-04-18
---

# Phase 05-02 Summary

**Wrong-instance browser requests now replay to the owning Fly machine, and replay-failed requests fail closed with explicit owner-unavailable responses instead of drifting into local relay handling.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-18T21:10:12Z
- **Completed:** 2026-04-18T21:15:04Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Added a dedicated Fly replay helper and routed wrong-instance browser HTTP and WebSocket traffic through it before any local attach logic runs.
- Added explicit `owner_unavailable` handling and structured replay branch logging for `fly-replay-failed` and replayed stale-owner cases.
- Added relay/browser and bridge reconnect tests that lock the replay contract and stable `bridgeInstanceId` behavior in place.

## Task Commits

Each task was committed atomically:

1. **Tasks 1-2: Fly replay helper and replay-failure routing behavior** - `febeb7f` (feat)
2. **Task 3: replay-routing and bridge reconnect coverage** - `9ef6437` (test)

**Plan metadata:** Recorded in the docs commit that adds this summary and advances Phase 5 plan tracking.

## Files Created/Modified
- `apps/relay/src/ownership/replay-routing.ts` - emits Fly replay JSON bodies targeting the owner machine.
- `apps/relay/src/routes/ws-browser.ts` - converts wrong-instance routes to replay responses and replay failures to `owner_unavailable`.
- `apps/relay/tests/unit/ws-browser-replay.test.ts` - verifies replay responses for session listing, command forwarding, and websocket attach.
- `apps/relay/tests/unit/ws-browser.test.ts` - verifies replay-failure behavior does not adopt local ownership.
- `apps/bridge/tests/unit/relay-connection.test.ts` - verifies reconnect reuses the same `bridgeInstanceId` on `bridge.register`.

## Decisions Made
- Kept replay state strings explicit as `browser:{userId}:{sessionId|list}:{deviceSessionId}` so logs and future ops surfaces can correlate replay attempts without additional translation.
- Logged replay branches with normalized `ownerMachineId`, `ownerRegion`, `replayState`, `replaySource`, and `replayFailed` fields to keep operator analysis machine-readable.
- Left the canonical public relay URL unchanged; all topology changes remain inside the relay layer as required by the product boundary.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 3 can now build ops visibility and backpressure policy on top of stable replay/failure signals instead of speculative owner routing.
- The browser route now exposes concrete replay and replay-failure branches that ops endpoints can count and report.

---
*Phase: 05-multi-instance-routing-production-hardening*
*Completed: 2026-04-18*
