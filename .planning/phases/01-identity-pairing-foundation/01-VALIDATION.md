---
phase: 1
slug: identity-pairing-foundation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-06
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + Playwright |
| **Config file** | `vitest.workspace.ts`, `playwright.config.ts` |
| **Quick run command** | `npm run test:phase-01:quick` |
| **Full suite command** | `npm run test:phase-01:full` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:phase-01:quick`
- **After every plan wave:** Run `npm run test:phase-01:full`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-A | 01 | 1 | AUTH-01, SEC-01, SEC-06 | unit / contract | `npm run test:phase-01:quick -- session` | ❌ W0 | ⬜ pending |
| 01-01-B | 01 | 1 | PAIR-03, PAIR-04 | unit / contract | `npm run test:phase-01:quick -- pairing` | ❌ W0 | ⬜ pending |
| 01-02-A | 02 | 2 | AUTH-01, AUTH-02, PAIR-01, PAIR-02, PAIR-05 | integration / e2e | `npm run test:phase-01:full -- auth-pairing` | ❌ W0 | ⬜ pending |
| 01-02-B | 02 | 2 | PAIR-03, PAIR-04, SEC-01, SEC-06 | integration / e2e | `npm run test:phase-01:full -- confirm` | ❌ W0 | ⬜ pending |
| 01-03-A | 03 | 3 | OPS-01 | integration / deploy smoke | `npm run test:phase-01:full -- health` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.workspace.ts` — workspace-level unit and integration test wiring
- [ ] `playwright.config.ts` — mobile viewport auth and pairing smoke harness
- [ ] `apps/web/tests/auth-pairing.spec.ts` — browser pairing path
- [ ] `apps/relay/tests/health.spec.ts` — health and ticket guard checks

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal QR readability and confirmation prompt clarity | PAIR-02, PAIR-04 | Requires real terminal rendering and human judgment | Run the pairing command in a normal terminal, confirm the QR is scannable, the fallback code is legible, and the verification phrase matches the browser |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
