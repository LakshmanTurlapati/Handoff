---
phase: 04
slug: approval-audit-device-safety
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-18
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`phase-01-unit` + `phase-03-web`) + Playwright mobile smoke |
| **Config file** | `vitest.workspace.ts`, `playwright.config.ts` |
| **Quick run command** | `vitest run --project phase-01-unit --project phase-03-web` |
| **Full suite command** | `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web && npx playwright test apps/web/tests/live-session-mobile.spec.ts apps/web/tests/device-safety-mobile.spec.ts` |
| **Estimated runtime** | ~45-120 seconds depending on browser coverage |

---

## Sampling Rate

- **After every task commit:** Run `vitest run --project phase-01-unit --project phase-03-web`
- **After every plan wave:** Run `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web`
- **Before `$gsd-verify-work`:** Full suite must be green and the device-safety mobile smoke path must be exercised
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | AUTH-03 | unit | `vitest run --project phase-01-unit packages/db/tests/device-sessions.test.ts packages/db/tests/audit-events.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | AUTH-03 | unit | `vitest run --project phase-01-unit apps/web/tests/unit/device-session-claim-route.test.ts apps/web/tests/unit/remote-principal.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | AUTH-03 | unit + jsdom | `vitest run --project phase-01-unit apps/web/tests/unit/device-revoke-route.test.ts && vitest run --project phase-03-web apps/web/tests/unit/device-management-page.test.tsx` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | SEC-03 | unit | `vitest run --project phase-01-unit apps/web/tests/unit/session-command-audit.test.ts apps/relay/tests/unit/session-router-audit.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | SEC-03 | jsdom | `vitest run --project phase-03-web apps/web/tests/unit/device-audit-feed.test.tsx` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | AUTH-04 | unit | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser-reconnect.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | SESS-06 | jsdom | `vitest run --project phase-03-web apps/web/tests/unit/session-shell-safety.test.tsx -t "terminal"` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 2 | LIVE-03 | jsdom + e2e | `vitest run --project phase-03-web apps/web/tests/unit/session-shell-safety.test.tsx -t "reconnect" && npx playwright test apps/web/tests/device-safety-mobile.spec.ts` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 2 | SEC-05 | unit | `vitest run --project phase-01-unit apps/relay/tests/unit/session-router-safety.test.ts apps/web/tests/unit/session-command-audit.test.ts -t "rejects unknown command"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/db/src/client.ts` — shared Postgres/Drizzle client for web and relay control-plane reads/writes
- [ ] `packages/db/tests/device-sessions.test.ts` — repository coverage for create/find/list/revoke/touch flows
- [ ] `packages/db/tests/audit-events.test.ts` — append-only audit repository coverage
- [ ] `apps/web/tests/unit/device-session-claim-route.test.ts` — claim-time persistence and idempotency
- [ ] `apps/web/tests/unit/remote-principal.test.ts` — durable device-session validation and failure cases
- [ ] `apps/web/tests/unit/device-revoke-route.test.ts` — revoke route auth, durable mutation, and relay fanout request
- [ ] `apps/web/tests/unit/device-management-page.test.tsx` — mobile device-management rendering and revoke affordances
- [ ] `apps/web/tests/unit/session-command-audit.test.ts` — web-side audit writes for ws-ticket and approval decision paths
- [ ] `apps/relay/tests/unit/session-router-audit.test.ts` — relay-side audit writes for approval request, reconnect, and disconnect events
- [ ] `apps/relay/tests/unit/ws-browser-reconnect.test.ts` — revoked/expired reconnect rejection and bridge-ended fanout
- [ ] `apps/relay/tests/unit/session-router-safety.test.ts` — ensure only prompt/steer/approval/interrupt commands are accepted
- [ ] `apps/web/tests/unit/session-shell-safety.test.tsx` — transient reconnect vs terminal-ended UI behavior
- [ ] `apps/web/tests/device-safety-mobile.spec.ts` — mobile smoke path for revoke/end-state and reconnect continuity

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Revoking the current paired device immediately ends the live session on a real phone browser | AUTH-03 / SESS-06 | Requires a live browser-relay-bridge session and real cookie state across revoke | Open a live session on a phone, revoke that device from the management surface, and verify the timeline transitions to a terminal revoked state with controls disabled. |
| A short network interruption preserves timeline context and backfills missed events without re-pairing | AUTH-04 / LIVE-03 | Needs a live relay/browser connection and a real network flap | With a live session open, disable browser network briefly, restore it, and confirm the reconnect banner appears, the timeline stays visible, and missed activity backfills into the existing session. |
| Bridge/Codex exit renders an ended state instead of infinite reconnect | SESS-06 | Requires killing the local bridge or Codex process during an attached session | Attach on a phone, stop the bridge or Codex process locally, and confirm the UI shows a terminal ended message rather than reconnecting forever. |
| Audit history remains readable on a phone and clearly distinguishes pairing/approval/revoke/disconnect events | SEC-03 | Final information density and chronology are easier to judge on hardware | Open the device-management screen on a phone, trigger at least one approval and one revoke/disconnect event, and confirm the recent security activity list remains readable and correctly ordered. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-18
