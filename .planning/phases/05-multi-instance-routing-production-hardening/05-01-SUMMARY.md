---
phase: 05-multi-instance-routing-production-hardening
plan: 01
subsystem: infra
tags: [fly, postgres, websocket, relay, ownership]
requires:
  - phase: 04
    provides: fail-closed reconnect and device-session safety rules
provides:
  - durable relay bridge leases in Postgres
  - relay instance identity and owner-resolution service
  - browser route guards that distinguish missing owner vs wrong instance
affects: [05-02, 05-03, browser-routing, relay-ops]
tech-stack:
  added: []
  patterns:
    - durable control-plane ownership leases keyed by user
    - relay/browser ownership checks before trusting process-local bridge state
key-files:
  created:
    - packages/db/src/repositories/relay-ownership.ts
    - apps/relay/src/ownership/relay-instance.ts
    - apps/relay/src/ownership/ownership-service.ts
    - packages/db/tests/relay-ownership.test.ts
    - apps/relay/tests/unit/ownership-service.test.ts
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/index.ts
    - apps/relay/src/bridge/bridge-registry.ts
    - apps/relay/src/browser/session-router.ts
    - apps/relay/src/routes/ws-bridge.ts
    - apps/relay/src/routes/ws-browser.ts
key-decisions:
  - "Keep one durable relay lease row per user and refresh/disconnect it using both userId and bridgeInstanceId to avoid stale socket races."
  - "Guard browser HTTP and WebSocket ingress with ownership resolution before local relay processing, but still close missing-owner WebSocket attaches with 1013 to preserve the current browser contract."
  - "Record and clear attachedSessionId from SessionRouter as best-effort lease metadata so later replay routing can target active sessions."
patterns-established:
  - "Ownership pattern: durable lease decides authority first, in-memory bridge registry is only the local socket cache."
  - "Routing pattern: wrong-instance responses return explicit owner metadata headers for later Fly replay work."
requirements-completed: [SEC-04, OPS-02]
duration: 9min
completed: 2026-04-18
---

# Phase 05-01 Summary

**Postgres-backed relay bridge leases with local-owner guards now gate browser attach, listing, and command forwarding before the relay trusts its in-memory bridge cache.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-18T20:59:47Z
- **Completed:** 2026-04-18T21:09:11Z
- **Tasks:** 4
- **Files modified:** 15

## Accomplishments
- Added `relay_bridge_leases` schema and repository helpers for lease upsert, heartbeat refresh, active owner lookup, attached-session updates, and disconnect cleanup.
- Tagged bridge registrations with Fly machine identity and propagated durable ownership state through `ws-bridge`, `ws-browser`, and `SessionRouter`.
- Added repository, ownership-service, bridge-route, and browser-route regression coverage around local owner checks and disconnect handling.

## Task Commits

Each task was committed atomically:

1. **Tasks 1-3: durable lease schema, bridge lifecycle, and owner-resolution routing** - `3445308` (feat)
2. **Task 4: repository and relay-unit ownership coverage** - `ab6dec6` (test)

**Plan metadata:** Recorded in the docs commit that adds this summary and advances Phase 5 plan tracking.

## Files Created/Modified
- `packages/db/src/schema.ts` - adds the durable `relay_bridge_leases` table and exported row type.
- `packages/db/src/repositories/relay-ownership.ts` - implements the lease repository used by relay ownership flows.
- `apps/relay/src/ownership/relay-instance.ts` - derives the local Fly app, machine, and region identity.
- `apps/relay/src/ownership/ownership-service.ts` - classifies leases as local, remote, or missing and manages attached-session metadata.
- `apps/relay/src/routes/ws-bridge.ts` - writes, refreshes, and disconnects durable leases alongside bridge socket lifecycle events.
- `apps/relay/src/routes/ws-browser.ts` - enforces owner-resolution checks and wrong-instance metadata headers before local processing.
- `apps/relay/src/browser/session-router.ts` - records and clears attached-session pointers as bridge/session lifecycle changes.
- `packages/db/tests/relay-ownership.test.ts` - covers durable lease repository behavior.
- `apps/relay/tests/unit/ownership-service.test.ts` - covers local, remote, and stale owner classification.

## Decisions Made
- Used one durable row per active bridge owner with `attachedSessionId` rather than introducing separate per-session ownership rows in Wave 1.
- Required `bridgeInstanceId` on heartbeat refresh and disconnect cleanup so an old socket cannot invalidate a newer bridge lease for the same user.
- Treated a local durable owner without a live local bridge socket as `bridge_owner_missing`, so browser HTTP routes fail explicitly instead of silently returning empty or unavailable relay responses.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Early test fixtures used lease expiry timestamps that were already stale relative to the current date, which made the ownership service correctly classify them as missing owners. The fixtures were updated to future timestamps before the final test run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 2 can build replay routing directly on `ownerMachineId` and `ownerRegion` from the durable lease contract.
- Browser ingress now exposes a stable `owner_not_local` / `bridge_owner_missing` distinction that can be converted into Fly replay behavior without reopening the ownership model.

---
*Phase: 05-multi-instance-routing-production-hardening*
*Completed: 2026-04-18*
