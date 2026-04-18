---
phase: 04-approval-audit-device-safety
plan: 01
subsystem: auth
tags: [postgres, drizzle, nextjs, relay, device-sessions, revocation]
dependency_graph:
  requires:
    - phase: 01.1-browser-device-session-claim-flow-d-07-01-hotfix
      provides: browser device-session claim flow and cookie issuance
    - phase: 03-live-remote-ui-control
      provides: mobile session shell, relay browser routes, and live-session server helpers
  provides:
    - durable device-session repository and audit repository access
    - claim-time device-session persistence and durable principal validation
    - mobile paired-device management page with explicit revoke control
    - relay device-scoped browser teardown with device_session_revoked end events
    - regression coverage for claim, principal, revoke, and device-management UI flows
  affects:
    - packages/db/src/*
    - apps/web/app/api/pairings/[pairingId]/claim/route.ts
    - apps/web/lib/live-session/server.ts
    - apps/web/app/api/devices/*
    - apps/web/app/devices/page.tsx
    - apps/relay/src/browser/*
    - apps/relay/src/routes/ws-browser.ts
tech_stack:
  added: []
  patterns:
    - shared Drizzle repository helpers for control-plane trust data
    - durable device-session validation before ticket minting or live control
    - device-scoped relay socket teardown with targeted session.ended fanout
key_files:
  created:
    - packages/db/src/client.ts
    - packages/db/src/repositories/device-sessions.ts
    - packages/db/src/repositories/audit-events.ts
    - apps/web/app/api/devices/route.ts
    - apps/web/app/api/devices/[deviceSessionId]/revoke/route.ts
    - apps/web/app/devices/page.tsx
    - apps/web/components/device/device-management-list.tsx
    - apps/web/tests/unit/device-session-claim-route.test.ts
    - apps/web/tests/unit/remote-principal.test.ts
    - apps/web/tests/unit/device-revoke-route.test.ts
    - apps/web/tests/unit/device-management-page.test.tsx
  modified:
    - packages/db/src/index.ts
    - apps/web/lib/device-session.ts
    - apps/web/app/api/pairings/[pairingId]/claim/route.ts
    - apps/web/lib/live-session/server.ts
    - apps/web/app/api/sessions/route.ts
    - apps/web/app/api/sessions/[sessionId]/connect/route.ts
    - apps/web/app/api/sessions/[sessionId]/command/route.ts
    - apps/relay/src/browser/browser-registry.ts
    - apps/relay/src/browser/session-router.ts
    - apps/relay/src/routes/ws-browser.ts
    - apps/web/app/page.tsx
decisions:
  - "Device-session cookies remain structural envelopes only; live control now depends on the durable device_sessions row."
  - "Device revocation tears down only browser sockets owned by the revoked device session instead of broadcasting a session-wide end event."
  - "The device-management screen extends the existing inline-style phone UI rather than introducing a separate admin console pattern."
metrics:
  duration_seconds: 723
  completed: 2026-04-18T14:48:40Z
  tasks_completed: 4
  tasks_total: 4
  files_created: 11
  files_modified: 11
requirements:
  - AUTH-03
---

# Phase 04 Plan 01: Durable Device Session & Revoke Foundation Summary

Durable device-session repositories, claim-time persistence, remote-principal trust checks, paired-device management, and relay-side revoke teardown now anchor the Phase 4 safety model.

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Add shared control-plane DB client and durable device/audit repositories | c3f896e | Added memoized Drizzle/Postgres client plus repository helpers for durable device-session and audit-event access |
| 2 | Persist device sessions at claim time and harden remote principal validation | 5a5eb1c | Claim route now persists device_sessions rows, idempotent re-claim resolves the stored durable id, and requireRemotePrincipal checks durable row validity before live control |
| 3 | Add device-management listing, revoke API, and relay-side browser teardown | 4b45cd8 | Added `/devices`, paired-device revoke controls, relay internal revoke endpoint, and device-scoped browser socket shutdown with `device_session_revoked` |
| 4 | Add route and UI coverage for claim persistence, principal validation, and revoke behavior | 7c4ba49 | Added fast unit/jsdom regression tests for claim persistence, durable principal rejection paths, revoke route behavior, and device-management rendering |

## Decisions Made

1. **Durable row over cookie claims:** The device cookie is no longer treated as the source of truth. The signed cookie is verified first, then matched against the durable `device_sessions` record for ownership, revocation, expiry, and hash integrity.

2. **Targeted revoke fanout:** Revoking a device sends `session.ended` with `device_session_revoked` only to sockets owned by that device session. Other viewers of the same Codex session are left untouched.

3. **Mobile-first management surface:** Device management shipped as a compact phone-first page with separate paired-device and active-session sections, preserving the existing product-owned inline UI style from Phase 3.

## Deviations from Plan

### Auto-fixed Integration Gaps

**1. Existing session API routes needed new device-session error handling**
- **Found during:** Task 2 (Persist device sessions at claim time and harden remote principal validation)
- **Issue:** `requireRemotePrincipal()` gained `device_session_revoked` and `device_session_expired`, but the existing session connect/list/command routes would have returned `500` for those cases.
- **Fix:** Updated the three existing session API routes to translate the new trust errors into `401`/`403` responses.
- **Files modified:** `apps/web/app/api/sessions/route.ts`, `apps/web/app/api/sessions/[sessionId]/connect/route.ts`, `apps/web/app/api/sessions/[sessionId]/command/route.ts`
- **Verification:** Existing `session-connect-route` unit test remained green after the change.
- **Committed in:** 5a5eb1c

**2. Claim re-idempotency needed a durable pairing lookup helper**
- **Found during:** Task 2 (Persist device sessions at claim time and harden remote principal validation)
- **Issue:** Once `claimedAt` is set, the route must return the existing durable `device_sessions.id`, but the new repository surface had no lookup keyed by pairing id.
- **Fix:** Added `findDeviceSessionByPairingId` to the device-session repository and used it in the idempotent claim path.
- **Files modified:** `packages/db/src/repositories/device-sessions.ts`, `apps/web/app/api/pairings/[pairingId]/claim/route.ts`
- **Verification:** New `device-session-claim-route` unit test covers the idempotent re-claim path.
- **Committed in:** 5a5eb1c

---

**Total deviations:** 2 auto-fixed integration gaps
**Impact on plan:** Both changes were required to keep the new durable trust model coherent. No scope creep beyond making planned behavior reachable and safe.

## Issues Encountered

- A broad `tsc -p tsconfig.base.json --noEmit` pass is currently blocked by unrelated syntax/type issues outside this plan’s code path: `resources/gsd-2` template syntax, existing relay websocket typing gaps, and missing `next-auth` type resolution in the current workspace. The plan’s direct vitest slices for web/unit/jsdom all passed.

## Next Phase Readiness

- The hosted layer now has durable device truth, explicit revoke controls, and relay teardown primitives ready for Phase 04-02 audit capture.
- Phase 04-02 can build on the shared DB repositories and the revoke path’s `device.revoked` event pattern instead of inventing new persistence seams.
- Phase 04-03 can reuse the new `device_session_revoked` transport end reason and the device-management surface when it adds terminal ended/reconnect-safe UI states.

## Self-Check

- All four planned task commits are present in git history.
- The `04-01` verification slice passed:
  - `vitest run --project phase-01-unit apps/web/tests/unit/device-session-claim-route.test.ts apps/web/tests/unit/remote-principal.test.ts apps/web/tests/unit/device-revoke-route.test.ts`
  - `vitest run --project phase-03-web apps/web/tests/unit/device-management-page.test.tsx`
- The required `04-01-SUMMARY.md` artifact exists for future phase context assembly.

---
*Phase: 04-approval-audit-device-safety*
*Completed: 2026-04-18*
