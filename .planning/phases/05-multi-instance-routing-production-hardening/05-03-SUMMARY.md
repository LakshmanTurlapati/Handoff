---
phase: 05-multi-instance-routing-production-hardening
plan: 03
subsystem: infra
tags: [ops, readyz, backpressure, relay, fly]
requires:
  - phase: 05-01
    provides: durable relay ownership metadata and local owner resolution
  - phase: 05-02
    provides: wrong-instance replay routing and explicit replay-failure handling
provides:
  - bounded browser fanout with priority-aware backpressure behavior
  - compact relay ops snapshot and ownership/pressure-aware readiness gating
  - Fly top-level ops monitoring and relay-local typecheck configuration
affects: [relay-ops, relay-readiness, browser-fanout, fly-observability]
tech-stack:
  added: []
  patterns:
    - degrade best-effort browser fanout before dropping critical session state
    - derive `/readyz` and `/ops/relay` from the same local relay counters
    - keep replay-failure evidence available as structured operator state, not just logs
key-files:
  created:
    - apps/relay/src/routes/ops.ts
    - apps/relay/tests/unit/ops-route.test.ts
    - apps/relay/tests/unit/readyz.test.ts
    - apps/relay/tsconfig.json
  modified:
    - apps/relay/src/browser/browser-registry.ts
    - apps/relay/src/browser/session-router.ts
    - apps/relay/src/routes/readyz.ts
    - apps/relay/src/routes/ws-browser.ts
    - apps/relay/src/server.ts
    - apps/relay/fly.toml
    - apps/relay/tests/unit/ws-bridge.test.ts
    - apps/relay/tests/unit/ws-browser.test.ts
    - apps/relay/tests/unit/ws-browser-replay.test.ts
    - apps/relay/tests/unit/ws-browser-reconnect.test.ts
    - packages/db/src/repositories/relay-ownership.ts
key-decisions:
  - "Best-effort live detail is dropped before critical session events, and a browser socket is only cut off after sustained overload."
  - "Readiness and operator inspection stay separate endpoints, but both are derived from the same ownership and pressure snapshot."
  - "Replay failures are recorded into relay-local ops state immediately so operators do not have to reconstruct them from logs."
patterns-established:
  - "Pressure pattern: slow browsers accumulate pending sends, best-effort events are shed first, and repeated overload closes with `1013 backpressure`."
  - "Ops pattern: `/ops/relay` exposes local bridge/browser/lease pressure plus recent replay/disconnect context in one JSON snapshot."
requirements-completed: [OPS-04, SEC-04]
duration: 16min
completed: 2026-04-18
---

# Phase 05-03 Summary

**Phase 5 now has the production-hardening layer it was missing: bounded browser fanout under pressure, a compact relay ops snapshot, readiness that degrades only on real routing-impacting conditions, and Fly monitoring for the operator surface.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-04-18T21:15:48Z
- **Completed:** 2026-04-18T21:31:21Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments

- Added priority-aware browser fanout accounting so the relay sheds `best_effort` live detail before it risks losing critical approval or session-ended state.
- Added `/ops/relay` as the compact operator-facing snapshot for local ownership, queue pressure, disconnect reasons, replay failures, and readiness state.
- Made `/readyz` ownership-storage-aware and pressure-aware while keeping `/healthz` unchanged, then wired a separate top-level Fly ops check to the new snapshot.
- Restored the relay package’s missing `tsconfig.json` so the package-local `typecheck` script now exercises real relay sources instead of failing immediately on missing config.

## Verification

- `npm run typecheck --workspace @codex-mobile/relay`
- `npx vitest run packages/db/tests/relay-ownership.test.ts apps/relay/tests/unit/ownership-service.test.ts apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-replay.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts apps/relay/tests/unit/session-router-audit.test.ts apps/relay/tests/unit/ops-route.test.ts apps/relay/tests/unit/readyz.test.ts apps/bridge/tests/unit/relay-connection.test.ts`

## Files Created/Modified

- `apps/relay/src/routes/ops.ts` - exposes the relay-local operator snapshot and replay-failure recorder.
- `apps/relay/src/routes/readyz.ts` - now degrades when ownership storage is unavailable or pressure crosses the local threshold.
- `apps/relay/src/browser/browser-registry.ts` - tracks pending sends, best-effort drops, disconnect reasons, and current backpressured sockets.
- `apps/relay/src/browser/session-router.ts` - classifies outbound events by delivery priority and surfaces browser pressure stats for ops.
- `apps/relay/src/routes/ws-browser.ts` - records replay-failure branches into operator-visible state.
- `packages/db/src/repositories/relay-ownership.ts` - adds relay-machine lease counting for readiness and ops reporting.
- `apps/relay/fly.toml` - adds the top-level `[checks.relay_ops]` probe for `/ops/relay`.
- `apps/relay/tests/unit/ops-route.test.ts`, `apps/relay/tests/unit/readyz.test.ts`, and `apps/relay/tests/unit/ws-browser-reconnect.test.ts` - lock the new ops/readiness/backpressure behavior in place.
- `apps/relay/tsconfig.json` - makes the relay workspace typecheck/build scripts point at a real project config.

## Decisions Made

- Kept `/readyz` scoped to traffic-admission health while exposing the fuller operator context on `/ops/relay`; the route semantics diverge, but the counters do not.
- Counted lease health by local relay machine so each Fly instance can report only the ownership state it is actually responsible for.
- Treated replay-failure context as short-lived in-memory operator evidence, which matches the local relay ownership model and avoids pretending this is a cross-instance metrics system.

## Deviations from Plan

- Added `apps/relay/tsconfig.json` while closing verification because the relay package scripts already assumed it existed; without it, the package-local typecheck was a false negative unrelated to the wave 3 logic.

## Issues Encountered

- The relay workspace lacked `tsconfig.json`, so `npm run typecheck --workspace @codex-mobile/relay` initially failed by printing compiler help instead of checking code. This was fixed in-wave.
- The new typecheck exposed one real narrowing issue in `buildEndedEvent`; tightening the helper return type resolved it without changing runtime behavior.

## User Setup Required

- Manual staging verification is still required for real multi-instance Fly routing, owner-loss behavior, and degraded-pressure inspection before broader rollout.

## Next Phase Readiness

- Phase 5 implementation is complete. The remaining work is manual `$gsd-verify-work` coverage and milestone closeout rather than more build work in this phase.

---
*Phase: 05-multi-instance-routing-production-hardening*
*Completed: 2026-04-18*
