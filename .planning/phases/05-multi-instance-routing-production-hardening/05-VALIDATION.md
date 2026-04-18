---
phase: 05
slug: multi-instance-routing-production-hardening
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-18
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`phase-01-unit`) for relay/db/bridge unit and WebSocket integration coverage |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | `vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts` |
| **Full suite command** | `npm run typecheck && vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts apps/relay/tests/unit/ownership-service.test.ts apps/relay/tests/unit/ws-browser-replay.test.ts apps/relay/tests/unit/ops-route.test.ts packages/db/tests/relay-ownership.test.ts` |
| **Estimated runtime** | ~30-90 seconds depending on new relay/db coverage |

---

## Sampling Rate

- **After every task commit:** Run the narrow task-specific Vitest slice for the touched ownership/routing/ops area
- **After every plan wave:** Run `npm run typecheck && vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts`
- **Before `$gsd-verify-work`:** Full suite must be green and the multi-instance replay path must be manually exercised
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | OPS-02 | unit | `vitest run packages/db/tests/relay-ownership.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | SEC-04 | unit | `vitest run apps/relay/tests/unit/ownership-service.test.ts apps/relay/tests/unit/session-router-safety.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | OPS-02, SEC-04 | integration | `vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts` | ✅ partial | ⬜ pending |
| 05-02-01 | 02 | 2 | OPS-03 | unit | `vitest run apps/relay/tests/unit/ws-browser-replay.test.ts apps/relay/tests/unit/ownership-service.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | SEC-04, OPS-03 | integration | `vitest run apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts` | ✅ partial | ⬜ pending |
| 05-02-03 | 02 | 2 | OPS-03 | bridge unit | `vitest run apps/bridge/tests/unit/relay-connection.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | OPS-04 | unit | `vitest run apps/relay/tests/unit/ops-route.test.ts apps/relay/tests/unit/readyz.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 3 | OPS-04 | integration | `vitest run apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/ws-browser-replay.test.ts` | ❌ W0 | ⬜ pending |
| 05-03-03 | 03 | 3 | SEC-04, OPS-04 | unit | `vitest run apps/relay/tests/unit/session-router-safety.test.ts apps/relay/tests/unit/ops-route.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭ gated/skipped*

---

## Wave 0 Requirements

- [ ] `packages/db/src/schema.ts` — ownership lease table/schema additions
- [ ] `packages/db/src/repositories/relay-ownership.ts` — repository helpers for create/refresh/replace/expire lookups
- [ ] `packages/db/tests/relay-ownership.test.ts` — repository coverage for lease lifecycle and stale-owner detection
- [ ] `apps/relay/src/ownership/ownership-service.ts` — authoritative owner lookup / fail-closed decision layer
- [ ] `apps/relay/tests/unit/ownership-service.test.ts` — stale/missing/conflicting lease handling
- [ ] `apps/relay/src/routes/ws-browser.ts` — wrong-instance replay before local WebSocket upgrade
- [ ] `apps/relay/tests/unit/ws-browser-replay.test.ts` — replay header generation and failure fallback
- [ ] `apps/relay/src/routes/readyz.ts` — ownership/pressure-aware readiness logic
- [ ] `apps/relay/tests/unit/readyz.test.ts` — readiness gating behavior
- [ ] `apps/relay/src/routes/ops.ts` — compact operator-facing ownership/pressure/disconnect surface
- [ ] `apps/relay/tests/unit/ops-route.test.ts` — ops snapshot correctness
- [ ] `apps/bridge/tests/unit/relay-connection.test.ts` — reconnect-driven lease refresh and bridge re-registration coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser attach lands on a non-owning Fly relay Machine and still reaches the correct bridge session | OPS-03 | Requires real Fly routing and multiple running relay Machines | Deploy at least two relay Machines, connect a bridge to one owner Machine, force the browser to hit a different Machine, and confirm the request replays to the owner without cross-user leakage. |
| Owner Machine loss does not cause silent cross-instance takeover | SEC-04, OPS-03 | Requires killing the owning Machine or bridge during a live remote session | With a live session attached, stop the owning relay Machine or sever the owner bridge connection and confirm the browser gets an explicit unavailable/retry state until the bridge refreshes ownership. |
| Operators can inspect stale-lease, replay-failure, and queue-pressure state during a degraded run | OPS-04 | Requires running the system under real multi-instance conditions and induced pressure | Trigger replay failures and slow-browser conditions in a staging deploy, then verify the ops surface/logs show active owner, disconnect reason, replay failure context, queue depth, and drop counters. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or an explicit Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-18
