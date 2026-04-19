---
phase: 07-codex-native-handoff-command
plan: 02
subsystem: api
tags: [handoff, protocol, drizzle, nextjs, vitest]
requires:
  - phase: 07-01
    provides: packaged `/handoff` command surface and installer path in the bridge CLI
provides:
  - shared thread-bound handoff schemas for bridge and web
  - hosted mint-or-reuse route for short-lived thread handoffs
  - local `handoff codex-handoff` helper that merges hosted handoff data with daemon state
affects: [07-03, 08-hosted-launch-active-session-handoff]
tech-stack:
  added: []
  patterns:
    - bridge bootstrap token stays in the Authorization header while thread/session identity stays in the JSON body
    - thread handoff reuse is keyed to user, bridge installation, thread, and session with a short-lived hosted record
key-files:
  created:
    - packages/protocol/src/handoff.ts
    - packages/db/src/repositories/handoffs.ts
    - apps/web/app/api/handoffs/route.ts
    - apps/bridge/src/cli/codex-handoff.ts
    - apps/bridge/tests/unit/codex-handoff-command.test.ts
    - apps/web/tests/unit/handoff-route.test.ts
  modified:
    - packages/protocol/src/index.ts
    - packages/db/src/schema.ts
    - packages/db/src/index.ts
    - apps/bridge/src/lib/pairing-client.ts
    - apps/bridge/src/cli.ts
    - vitest.workspace.ts
key-decisions:
  - "The bridge client now carries the bootstrap token in the PairingClient constructor so `createHandoff` can keep the request body to bridge/thread/session identity only."
  - "Hosted handoff reuse is driven by a short-lived `thread_handoffs` table rather than local-only cache state so later launch flows can resolve the same descriptor."
patterns-established:
  - "Bridge-owned hosted routes use bearer bootstrap auth plus runtime schema validation before returning machine-readable payloads."
  - "The local `codex-handoff` helper silences daemon launch logs and emits only JSON when Codex requests `--format json`."
requirements-completed: [CMD-02, SAFE-01]
duration: 4min
completed: 2026-04-19
---

# Phase 07: Codex-Native `/handoff` Command Summary

**Added a thread-bound hosted handoff contract plus a local `codex-handoff` helper that returns concise JSON for the active Codex thread.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-19T22:08:34Z
- **Completed:** 2026-04-19T22:13:04Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added shared `ThreadHandoffRecordSchema` and `CodexHandoffResultSchema` contracts plus durable `thread_handoffs` storage and repository helpers.
- Added `POST /api/handoffs` with bridge-bootstrap auth, reuse-first behavior, and short-lived launch descriptors for one thread/session pair.
- Added `handoff codex-handoff` to the bridge CLI, reusing the Phase 6 launch seam and returning clean JSON with `daemon_started` or `daemon_reused`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the shared schema and hosted persistence contract for thread-bound handoffs** - `add2367` (feat)
2. **Task 2: Add the hosted handoff mint-or-reuse route and bridge client support** - `ac970d2` (feat)
3. **Task 3: Implement the internal `handoff codex-handoff` helper and test its thread-binding behavior** - `93b80b2` (feat)

## Files Created/Modified

- `packages/protocol/src/handoff.ts` - shared hosted/local handoff result schemas
- `packages/db/src/schema.ts` - `thread_handoffs` table with public id, ownership, thread, session, and expiry fields
- `packages/db/src/repositories/handoffs.ts` - create/reuse/revoke repository helpers
- `apps/web/app/api/handoffs/route.ts` - hosted mint-or-reuse route for bridge-owned handoff requests
- `apps/bridge/src/lib/pairing-client.ts` - typed `createHandoff` client method with schema validation
- `apps/bridge/src/cli/codex-handoff.ts` - local helper that launches the daemon, loads bootstrap state, and prints JSON
- `apps/bridge/src/cli.ts` - `codex-handoff` registration
- `apps/bridge/tests/unit/codex-handoff-command.test.ts` - missing-context, create, reuse, and daemon-action coverage
- `apps/web/tests/unit/handoff-route.test.ts` - create, reuse, replacement, and bootstrap-auth coverage
- `vitest.workspace.ts` - source aliases for shared packages during unit-test execution

## Decisions Made

- Used the existing bridge bootstrap token as the only auth credential for `POST /api/handoffs` and kept thread/session identity in the request body.
- Reused the Phase 6 launch seam first, then loaded bootstrap credentials, so the local helper does not create a parallel daemon-start path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Vitest source aliases for shared workspace packages**
- **Found during:** Task 2 (hosted handoff mint-or-reuse route and bridge client support)
- **Issue:** Vitest resolved `@codex-mobile/protocol` through the package entrypoint, which currently points at missing `dist/` output in this workspace, so the new route and client tests could not load the shared schemas.
- **Fix:** Added explicit source aliases for `@codex-mobile/protocol`, `@codex-mobile/auth`, and `@codex-mobile/db` in `vitest.workspace.ts`.
- **Files modified:** `vitest.workspace.ts`
- **Verification:** `npx vitest run apps/web/tests/unit/handoff-route.test.ts` and `npx vitest run apps/bridge/tests/unit/bootstrap-client.test.ts`
- **Committed in:** `ac970d2` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The alias fix was required only for local test execution. It did not widen the handoff scope or change the hosted/local contracts.

## Issues Encountered

- None beyond the local Vitest package-resolution blocker captured above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `/handoff` flow now has a real hosted descriptor and a real bridge helper instead of a placeholder contract.
- Wave 3 can harden authorization, revocation, expiry, and no-picker behavior against concrete route/helper code.
- Phase 8 can consume the `publicId`-backed launch URL shape instead of inventing a new launch descriptor format.

---
*Phase: 07-codex-native-handoff-command*
*Completed: 2026-04-19*
