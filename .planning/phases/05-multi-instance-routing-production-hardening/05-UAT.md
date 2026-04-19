---
status: partial
phase: 05-multi-instance-routing-production-hardening
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md]
started: 2026-04-19T00:42:47Z
updated: 2026-04-19T00:47:22Z
---

## Current Test

[testing paused — 7 items outstanding]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running relay/service. Clear ephemeral state such as temp files, caches, and stale local outputs. Start the relay from scratch. It should boot without errors, and basic checks like `GET /healthz` and `GET /readyz` should return live JSON instead of startup failures.
result: pending

### 2. Wrong-Instance Browser Replay
expected: With at least two Fly relay Machines and one active bridge owner, opening the browser session through a non-owning Machine should still land on the correct live session because the request replays to the owning relay instead of attaching locally.
result: pending

### 3. Replay Failure Fails Closed
expected: If replay to the owning Machine fails or the ownership state is stale, the browser should get an explicit unavailable response instead of silently attaching to a non-owner relay.
result: pending

### 4. Owner Loss During Live Session
expected: While attached to a live session, stopping the owning bridge or relay Machine should end the browser session with an explicit unavailable/disconnect state rather than silently switching owners.
result: pending

### 5. Relay Ops Snapshot
expected: `GET /ops/relay` should return the local relay machine and region, active bridge/browser counts, active and stale lease counts, queue-pressure counters, recent disconnect reasons, recent replay failures, and a `readyzStatus` field in one compact JSON response.
result: pending

### 6. Backpressure Degrades Best-Effort First
expected: Under a deliberately slow browser connection, critical session state should continue to win over best-effort detail first, and severe overload should eventually surface as a backpressure disconnect that is visible in relay ops state.
result: pending

### 7. Readiness Only Degrades for Real Routing Risk
expected: `/readyz` should stay ready under normal conditions but degrade when ownership storage is unavailable or local backpressured sockets cross the configured threshold, while `/healthz` remains an unaffected liveness check.
result: pending

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
