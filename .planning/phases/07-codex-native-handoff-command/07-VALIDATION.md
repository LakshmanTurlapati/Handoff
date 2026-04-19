---
phase: 07
slug: codex-native-handoff-command
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-19
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace plus bridge/web unit slices for slash-command and handoff metadata flows |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | `npx vitest run apps/bridge/tests/unit/codex-command-install.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts apps/bridge/tests/unit/codex-handoff-safety.test.ts` |
| **Full suite command** | `npx vitest run apps/bridge/tests/unit/codex-command-install.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts apps/bridge/tests/unit/codex-handoff-safety.test.ts apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/web/tests/unit/handoff-route.test.ts` |
| **Estimated runtime** | ~20-60 seconds depending on how much hosted handoff-route coverage lands in Phase 07-02 |

---

## Sampling Rate

- **After every task commit:** Run the narrowest relevant Phase 7 Vitest slice for the touched files.
- **After every plan wave:** Run the full Phase 7 suite and confirm no existing `launch` or adapter tests regressed.
- **Before `$gsd-verify-work`:** Full suite must be green and one real `/handoff` invocation must be exercised from inside Codex.
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | CMD-01 | bridge unit | `npx vitest run apps/bridge/tests/unit/codex-command-install.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | CMD-01, SAFE-01 | asset + command contract | `rg -n 'description:|## Preflight|## Plan|## Commands|## Verification|## Summary|## Next Steps' apps/bridge/resources/codex/commands/handoff.md` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | CMD-01 | package surface | `rg -n 'codex-handoff|resources/codex|commands/handoff.md' apps/bridge/package.json apps/bridge/src/cli.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | CMD-02 | bridge unit | `npx vitest run apps/bridge/tests/unit/codex-handoff-command.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | CMD-02, SAFE-01 | hosted route unit | `npx vitest run apps/web/tests/unit/handoff-route.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 2 | CMD-02 | schema + state contract | `rg -n 'threadId|sessionId|launchUrl|qrText|expiresAt|reused' packages/protocol/src/handoff.ts apps/bridge/src/lib/local-state.ts apps/bridge/src/cli/codex-handoff.ts` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 3 | SAFE-01 | safety unit | `npx vitest run apps/bridge/tests/unit/codex-handoff-safety.test.ts` | ❌ W0 | ⬜ pending |
| 07-03-02 | 03 | 3 | SAFE-01, CMD-02 | adapter + launch regression | `npx vitest run apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts` | ✅ yes / ❌ W0 mix | ⬜ pending |
| 07-03-03 | 03 | 3 | SAFE-01 | contract grep | `rg -n 'missing_active_thread_context|missing_bridge_bootstrap_state|reused|fail closed|no session picker' apps/bridge/src/cli/codex-handoff.ts apps/bridge/resources/codex/commands/handoff.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭ gated/skipped*

---

## Wave 0 Requirements

- [ ] `apps/bridge/resources/codex/commands/handoff.md` — packaged slash-command asset for `/handoff`
- [ ] `apps/bridge/src/lib/codex-command-install.ts` — Codex command install/update helper
- [ ] `apps/bridge/src/cli/codex-handoff.ts` — internal local helper for thread-bound `/handoff`
- [ ] `packages/protocol/src/handoff.ts` — shared handoff result and metadata schema
- [ ] `apps/bridge/tests/unit/codex-command-install.test.ts` — install/update coverage
- [ ] `apps/bridge/tests/unit/codex-handoff-command.test.ts` — thread binding and reuse coverage
- [ ] `apps/bridge/tests/unit/codex-handoff-safety.test.ts` — fail-closed and no-picker regression coverage
- [ ] `apps/web/tests/unit/handoff-route.test.ts` — hosted handoff mint/reuse coverage if a hosted route lands in Phase 07-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/handoff` is visible and runnable inside a real Codex session after installing the packaged command asset | CMD-01 | Requires a real Codex runtime and slash-command discovery path | Install/update the command asset into the local Codex home, open a real Codex thread, type `/handoff`, and confirm Codex resolves the command instead of treating it as plain text. |
| Re-running `/handoff` in the same thread reuses the still-valid handoff instead of minting a second one | CMD-02 | Requires real thread identity and stored handoff metadata across command invocations | Invoke `/handoff` twice in the same thread, verify the second response reports reuse, and confirm no second live handoff record is created for the same still-valid thread. |
| Invoking `/handoff` without a valid active thread fails closed with actionable guidance and no session picker | SAFE-01 | Needs the actual Codex command environment to prove the no-picker behavior | Trigger the command from a context without a resolvable active thread, confirm the response contains explicit repair guidance, and confirm the flow does not list threads or offer generic selection. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or an explicit Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-19
