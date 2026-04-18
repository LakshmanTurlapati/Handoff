---
phase: 04-approval-audit-device-safety
plan: 03
subsystem: ui
tags: [reconnect, terminal-state, relay, websocket, mobile-ui, safety]
dependency_graph:
  requires:
    - phase: 04-approval-audit-device-safety
      provides: durable device-session trust, revoke teardown, and append-only audit capture
    - phase: 03-live-remote-ui-control
      provides: mobile session shell, reconnect banner, live timeline reducer, and relay/browser transport
  provides:
    - explicit terminal end-reason contract across bridge, relay, and browser live-session flows
    - relay-side reconnect gating against durable revoked or expired device-session state
    - bridge-loss fanout that emits `bridge_unavailable` before terminal browser close
    - terminal phone UI states that disable prompt, steer, interrupt, and approval controls
    - regression coverage for reconnect rejection, command-surface safety, terminal-state UI, and mobile smoke gating
  affects:
    - packages/protocol/src/live-session.ts
    - packages/protocol/src/bridge.ts
    - packages/db/src/repositories/device-sessions.ts
    - apps/relay/src/browser/*
    - apps/relay/src/routes/ws-browser.ts
    - apps/relay/src/routes/ws-bridge.ts
    - apps/web/lib/live-session/*
    - apps/web/app/session/[sessionId]/session-shell.tsx
    - apps/web/components/session/*
tech_stack:
  added: []
  patterns:
    - shared terminal end reasons across bridge-to-relay and relay-to-browser contracts
    - relay publishes terminal session state before closing browser sockets
    - browser transport treats terminal end reasons as non-reconnectable and disables unsafe controls
key_files:
  created:
    - apps/web/components/session/session-ended-card.tsx
    - apps/relay/tests/unit/ws-browser-reconnect.test.ts
    - apps/relay/tests/unit/session-router-safety.test.ts
    - apps/web/tests/unit/session-shell-safety.test.tsx
    - apps/web/tests/device-safety-mobile.spec.ts
  modified:
    - packages/protocol/src/live-session.ts
    - packages/protocol/src/bridge.ts
    - packages/db/src/repositories/device-sessions.ts
    - apps/relay/src/routes/ws-browser.ts
    - apps/relay/src/browser/browser-registry.ts
    - apps/relay/src/browser/session-router.ts
    - apps/relay/src/routes/ws-bridge.ts
    - apps/web/lib/live-session/session-model.ts
    - apps/web/lib/live-session/reducer.ts
    - apps/web/lib/live-session/transport.ts
    - apps/web/app/session/[sessionId]/session-shell.tsx
    - apps/web/components/session/composer.tsx
    - apps/web/components/session/approval-card.tsx
    - apps/web/components/session/turn-card.tsx
    - apps/relay/tests/unit/session-router-audit.test.ts
    - apps/relay/tests/unit/ws-bridge.test.ts
decisions:
  - "Terminal end reasons are now an explicit shared enum, not free-form strings, so reconnect and ended-state behavior cannot drift between bridge, relay, and browser."
  - "The relay broadcasts terminal `session.ended` events before closing affected browser sockets, preserving visible end-state context on the phone."
  - "Once terminal trust is gone, the browser transport stops retrying and the UI disables prompt, steer, interrupt, and approval actions instead of pretending the session is recoverable."
metrics:
  duration_seconds: 718
  completed: 2026-04-18T16:31:44Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 16
requirements:
  - AUTH-04
  - SESS-06
  - LIVE-03
  - SEC-05
---

# Phase 04 Plan 03: Reconnect Safety & Terminal Session States Summary

Reconnect now survives only transient drops, while revoked, expired, bridge-ended, or Codex-ended sessions switch into explicit terminal phone states with unsafe controls disabled.

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Define terminal end reasons and block reconnect for revoked or expired device sessions | d1e8f8b | Added shared terminal end-reason enums and relay reconnect gating against durable device-session validity before browser attach |
| 2 | Fan bridge-health end events to the browser and render explicit terminal phone states | 206090a | Relay now emits terminal `session.ended` events before browser teardown, the transport stops reconnecting on terminal reasons, and the phone UI renders explicit ended/revoked states with controls disabled |
| 3 | Add reconnect, terminal-state, and command-surface regression coverage | 407363d | Added relay reconnect and command-surface tests, session-shell terminal-state coverage, and a gated mobile smoke spec for revoke/end-state readability |

## Decisions Made

1. **Single terminal vocabulary:** `device_session_revoked`, `device_session_expired`, `bridge_unavailable`, `codex_process_exited`, and `detached` now define the complete terminal reason set for live sessions across the stack.

2. **Broadcast before close:** Relay teardown paths publish `session.ended` to browser sockets before the sockets are closed, so the UI can render the final safety state instead of dropping into a generic disconnected loop.

3. **Terminal means read-only:** The browser transport stops scheduling reconnect after any terminal reason, and the phone UI disables `Send Prompt`, `Steer`, `Interrupt`, and approval actions once trust is gone.

## Deviations from Plan

### Auto-fixed Integration Gaps

**1. [Rule 1 - Bug] Relay reconnect validation needed a repo helper that did not require placeholder cookie hashes**
- **Found during:** Task 1 (Define terminal end reasons and block reconnect for revoked or expired device sessions)
- **Issue:** `findDeviceSessionForPrincipal()` still required a cookie hash even when the relay only needed durable device ownership, expiry, and revocation checks. Using placeholder data would have made the new relay gate brittle and misleading.
- **Fix:** Made the repository helper filter by `userId` and `cookieTokenHash` only when those fields are provided, so the web boundary keeps strict hash validation while the relay can perform a clean owner+expiry check.
- **Files modified:** `packages/db/src/repositories/device-sessions.ts`, `apps/relay/src/routes/ws-browser.ts`
- **Verification:** `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser-reconnect.test.ts`
- **Committed in:** d1e8f8b

**2. [Rule 1 - Bug] Bridge-to-relay terminal events still accepted arbitrary reason strings**
- **Found during:** Task 2 (Fan bridge-health end events to the browser and render explicit terminal phone states)
- **Issue:** The browser-side end-reason enum had been tightened, but `packages/protocol/src/bridge.ts` still allowed any string for bridge `session.ended` notifications. That would have let bridge and browser reason sets drift again.
- **Fix:** Reused `LiveSessionEndedReasonSchema` inside the bridge params contract so bridge, relay, and browser share one terminal reason vocabulary.
- **Files modified:** `packages/protocol/src/bridge.ts`
- **Verification:** Relay unit slice passed with the stricter `session.ended` contract in place.
- **Committed in:** 206090a

**3. [Rule 1 - Bug] Existing relay tests still assumed pre-terminal-contract reason values and close timing**
- **Found during:** Task 3 (Add reconnect, terminal-state, and command-surface regression coverage)
- **Issue:** Existing tests used stale reason fixtures like `bridge_disconnected` / `codex_session_ended` and asserted registry cleanup before the bridge close handler had completed.
- **Fix:** Updated the tests to use `bridge_unavailable` and `codex_process_exited`, then awaited close cleanup before asserting registry teardown.
- **Files modified:** `apps/relay/tests/unit/session-router-audit.test.ts`, `apps/relay/tests/unit/ws-bridge.test.ts`
- **Verification:** Full Phase 4 relay unit slice passed after the fixture/timing updates.
- **Committed in:** 407363d

---

**Total deviations:** 3 auto-fixed integration gaps
**Impact on plan:** All three fixes were narrow correctness alignments required to keep the new reconnect safety model internally consistent. No scope creep beyond the planned trust and terminal-state behavior.

## Issues Encountered

- The only failures during verification were stale test fixtures and assertion timing around the new terminal contract. No implementation regressions remained after those tests were updated.

## Next Phase Readiness

- Phase 5 can reuse the now-explicit terminal reason contract when it routes browser traffic to the relay instance that owns a bridge connection.
- Multi-instance relay routing can build on the new user-scoped and session-scoped browser teardown helpers rather than inventing a second disconnect path.
- Final milestone verification can now exercise revoke, reconnect, bridge loss, and ended-session behavior using stable browser-visible safety states instead of inferring them from reconnect loops.

## Self-Check

- All three planned task commits are present in git history.
- The `04-03` verification slice passed:
  - `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts apps/relay/tests/unit/session-router-audit.test.ts apps/web/tests/unit/device-session-claim-route.test.ts apps/web/tests/unit/remote-principal.test.ts apps/web/tests/unit/device-revoke-route.test.ts apps/web/tests/unit/session-command-audit.test.ts`
  - `vitest run --project phase-03-web apps/web/tests/unit/device-management-page.test.tsx apps/web/tests/unit/device-audit-feed.test.tsx apps/web/tests/unit/session-shell.test.tsx apps/web/tests/unit/session-shell-safety.test.tsx`
  - `npx playwright test apps/web/tests/device-safety-mobile.spec.ts` completed as a gated smoke and skipped without `CODEX_MOBILE_E2E_LIVE=1` and `CODEX_MOBILE_E2E_DEVICE_SAFETY=1`
- The required `04-03-SUMMARY.md` artifact exists for future phase context assembly.

---
*Phase: 04-approval-audit-device-safety*
*Completed: 2026-04-18*
