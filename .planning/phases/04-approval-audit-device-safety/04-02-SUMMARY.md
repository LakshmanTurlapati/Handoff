---
phase: 04-approval-audit-device-safety
plan: 02
subsystem: auth
tags: [audit-trail, relay, nextjs, websocket, device-management, mobile-ui]
dependency_graph:
  requires:
    - phase: 04-approval-audit-device-safety
      provides: durable device-session truth, revoke plumbing, and device-management foundation
    - phase: 03-live-remote-ui-control
      provides: live session shell, relay/browser routing, and mobile interaction patterns
  provides:
    - shared audit event contract for web and relay trust-boundary events
    - durable audit helpers for ws-ticket mint/reject and approval responses
    - relay-side approval, reconnect, and disconnect audit persistence
    - compact recent security activity feed in the mobile device-management surface
    - regression coverage for audit writes and newest-first audit rendering
  affects:
    - packages/protocol/src/*
    - apps/web/lib/pairing-service.ts
    - apps/web/lib/session-audit.ts
    - apps/web/app/api/sessions/*
    - apps/web/app/api/devices/*
    - apps/web/app/devices/page.tsx
    - apps/web/components/device/*
    - apps/relay/src/browser/*
tech_stack:
  added: []
  patterns:
    - shared protocol-owned audit event names reused across web and relay
    - append-only audit writes at the actual trust boundaries that observe the event
    - mobile audit history rendered as a newest-first compact vertical feed
key_files:
  created:
    - packages/protocol/src/audit.ts
    - apps/web/lib/session-audit.ts
    - apps/web/components/device/audit-feed.tsx
    - apps/relay/tests/unit/session-router-audit.test.ts
    - apps/web/tests/unit/session-command-audit.test.ts
    - apps/web/tests/unit/device-audit-feed.test.tsx
  modified:
    - packages/protocol/src/index.ts
    - apps/web/lib/pairing-service.ts
    - apps/web/app/api/sessions/[sessionId]/connect/route.ts
    - apps/web/app/api/sessions/[sessionId]/command/route.ts
    - apps/web/app/api/devices/[deviceSessionId]/revoke/route.ts
    - apps/relay/src/browser/browser-registry.ts
    - apps/relay/src/browser/session-router.ts
    - apps/web/app/api/devices/route.ts
    - apps/web/app/devices/page.tsx
    - apps/web/tests/unit/device-management-page.test.tsx
    - apps/web/tests/unit/session-connect-route.test.ts
decisions:
  - "Audit event names are protocol-owned constants so web and relay cannot drift on load-bearing event strings."
  - "Audit rows are appended where the event is directly observed, not reconstructed later from terminal output."
  - "Recent device security history stays inline with the phone-first device-management page instead of a separate admin surface."
metrics:
  duration_seconds: 1800
  completed: 2026-04-18T16:16:00Z
  tasks_completed: 4
  tasks_total: 4
  files_created: 6
  files_modified: 11
requirements:
  - SEC-03
---

# Phase 04 Plan 02: Durable Audit Trail & Mobile Audit Visibility Summary

Shared audit event names, durable web/relay audit writes, and a compact recent security activity feed now make Phase 4 safety behavior inspectable from the phone UI.

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Create the shared audit event contract and move pairing events onto it | 36d3c6f | Added protocol-owned `AUDIT_EVENT_TYPES` and `AuditEventTypeSchema`, then moved pairing-service audit writes onto the shared contract |
| 2 | Record audit events from the web trust boundary for ws-ticket, approval decision, and revoke actions | d10c67b | Added `session-audit` helpers and durable web-side audit writes for ws-ticket mint/reject, approval response, and revoke flows |
| 3 | Record relay-side approval/reconnect/disconnect events and expose recent security activity in the device UI | 472cbc4 | Appended relay approval/reconnect/disconnect audit rows and rendered a newest-first mobile audit feed on `/devices` |
| 4 | Add regression coverage for audit writes and mobile audit ordering | fd7557d | Added relay/web regression tests for audit persistence and audit-feed ordering, plus supporting test fixture updates |

## Decisions Made

1. **One audit vocabulary:** Web and relay now import the same protocol constants for trust-boundary event names, keeping the append-only audit trail load-bearing and searchable across the stack.

2. **Trust-boundary-first persistence:** Ws-ticket mint/reject, approval responses, reconnect markers, and disconnect fanout are logged by the layer that directly observes them rather than inferred from terminal bytes or UI state.

3. **Compact phone audit UI:** The device-management page renders recent security activity as a newest-first vertical feed with outcome pills and subjects, preserving the existing mobile-first UI language.

## Deviations from Plan

### Auto-fixed Integration Gaps

**1. [Rule 2 - Missing Critical] Preserve the existing `pairing.confirm_failed` audit event while centralizing names**
- **Found during:** Task 1 (Create the shared audit event contract and move pairing events onto it)
- **Issue:** The plan listed the required new shared event names, but the pairing service already depended on `pairing.confirm_failed`. Dropping it would have silently broken an existing load-bearing audit path.
- **Fix:** Carried `pairing.confirm_failed` into `AUDIT_EVENT_TYPES` and updated the pairing service to consume the shared constant bag without changing the persisted event name.
- **Files modified:** `packages/protocol/src/audit.ts`, `apps/web/lib/pairing-service.ts`
- **Verification:** Task 1 grep checks passed and existing pairing audit references now route through `AUDIT_EVENT_TYPES`.
- **Committed in:** 36d3c6f

**2. [Rule 1 - Bug] Align approval decision audit coverage with the protocol schema**
- **Found during:** Task 4 (Add regression coverage for audit writes and mobile audit ordering)
- **Issue:** The new approval audit regression used `decision: "approve"`, but the live-session protocol schema accepts `approved`, `denied`, or `abort`.
- **Fix:** Updated the web audit helper typing and the route regression to use the existing `approved` protocol value.
- **Files modified:** `apps/web/lib/session-audit.ts`, `apps/web/tests/unit/session-command-audit.test.ts`
- **Verification:** `vitest run --project phase-01-unit apps/relay/tests/unit/session-router-audit.test.ts apps/web/tests/unit/session-command-audit.test.ts` passed after the fix.
- **Committed in:** fd7557d

---

**Total deviations:** 2 auto-fixed integration gaps
**Impact on plan:** Both fixes preserved planned behavior while keeping the new audit trail compatible with existing protocol and pairing semantics. No scope creep.

## Issues Encountered

- None within the scoped audit work. The targeted relay/web/jsdom verification slices all passed after the approval decision fixture was corrected.

## Next Phase Readiness

- Phase 04-03 can now distinguish transient reconnect from terminal trust loss while writing the resulting end-state changes into an existing durable audit trail.
- The device-management surface already exposes revoke and recent security activity, so terminal session-state UI can reuse the same mobile visual language without inventing a separate safety console.
- Relay/browser reconnect hardening can build directly on the new `session.reconnected`, `session.disconnected`, and `device.revoked` event flows.

## Self-Check

- All four planned task commits are present in git history.
- The `04-02` verification slice passed:
  - `vitest run --project phase-01-unit apps/relay/tests/unit/session-router-audit.test.ts apps/web/tests/unit/session-command-audit.test.ts`
  - `vitest run --project phase-03-web apps/web/tests/unit/device-audit-feed.test.tsx apps/web/tests/unit/device-management-page.test.tsx`
  - `rg -n 'approval\.requested|approval\.responded|ws_ticket\.minted|session\.disconnected|Recent security activity' packages/protocol/src/audit.ts apps/web/lib/session-audit.ts apps/relay/src/browser/session-router.ts apps/web/components/device/audit-feed.tsx`
- The required `04-02-SUMMARY.md` artifact exists for future phase context assembly.

---
*Phase: 04-approval-audit-device-safety*
*Completed: 2026-04-18*
