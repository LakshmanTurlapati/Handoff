---
phase: 03
slug: live-remote-ui-control
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-18
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`phase-01-unit` + jsdom `phase-03-web`) + Playwright mobile smoke |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | `vitest run --project phase-01-unit --project phase-03-web` |
| **Full suite command** | `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web && npx playwright test apps/web/tests/live-session-mobile.spec.ts` |
| **Estimated runtime** | ~30-90 seconds depending on browser coverage |

---

## Sampling Rate

- **After every task commit:** Run `vitest run --project phase-01-unit --project phase-03-web`
- **After every plan wave:** Run `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web`
- **Before `$gsd-verify-work`:** Full suite must be green and the mobile smoke path must be exercised
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | LIVE-04 | unit | `vitest run --project phase-01-unit apps/web/tests/unit/live-session-reducer.test.ts` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | LIVE-02 | unit | `vitest run --project phase-01-unit apps/web/tests/unit/live-session-reducer.test.ts` | ✅ | ✅ green |
| 03-02-01 | 02 | 1 | LIVE-01 | unit | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser.test.ts apps/web/tests/unit/session-connect-route.test.ts` | ✅ | ✅ green |
| 03-02-02 | 02 | 1 | SESS-04 | unit | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser.test.ts apps/web/tests/unit/session-connect-route.test.ts` | ✅ | ✅ green |
| 03-02-03 | 02 | 1 | SESS-05 | unit | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser.test.ts apps/web/tests/unit/session-connect-route.test.ts` | ✅ | ✅ green |
| 03-03-01 | 03 | 2 | LIVE-01 | unit | `vitest run --project phase-03-web apps/web/tests/unit/session-shell.test.tsx` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | SESS-04 | e2e | `npx playwright test apps/web/tests/live-session-mobile.spec.ts` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | SESS-05 | e2e | `npx playwright test apps/web/tests/live-session-mobile.spec.ts` | ❌ W0 | ⬜ pending |
| 03-03-04 | 03 | 2 | LIVE-04 | e2e | `npx playwright test apps/web/tests/live-session-mobile.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/web/tests/unit/live-session-reducer.test.ts` — reducer coverage for turn grouping, follow mode, and pending interrupt
- [ ] `apps/web/package.json` — add `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom`
- [ ] `apps/web/tests/setup.ts` — shared RTL/jest-dom setup for jsdom tests
- [ ] `apps/web/tests/unit/session-shell.test.tsx` — connected shell coverage for reconnect, approval, and `Jump to live`
- [x] `apps/relay/tests/unit/ws-browser.test.ts` — relay browser upgrade auth, replay rejection, and owner routing
- [x] `apps/web/tests/unit/session-connect-route.test.ts` — ws-ticket boot route validation and no URL credential leakage
- [ ] `apps/web/tests/live-session-mobile.spec.ts` — mobile smoke coverage for composer, reconnect, and approval visibility
- [ ] `vitest.workspace.ts` — `phase-03-web` jsdom project for `.test.tsx` files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sticky composer remains usable with a real phone soft keyboard open | LIVE-04 | Headless browser tests do not reliably emulate the on-screen keyboard and safe-area behavior | Open the live session on a phone-sized browser, focus the composer, type a multi-line prompt, and confirm `Send Prompt`, `Steer`, and `Interrupt` remain visible and tappable. |
| Reconnect inserts a subtle `Reconnected` separator without wiping the timeline | LIVE-01 | Requires forcing a live network interruption against a real relay/browser connection | With a live session open, temporarily drop the browser network, restore it, and confirm the timeline stays visible, a reconnect banner appears, then a `Reconnected` separator is inserted when missed events are backfilled. |
| Approval card is visually obvious and context-preserving on a real phone | SESS-04 | Final tap-target clarity and turn proximity are easier to judge on hardware than in a synthetic viewport | Trigger an approval request from Codex, open the session on a phone, and verify the `Waiting for approval` card appears near the active turn with readable approve/deny/abort actions. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-18
