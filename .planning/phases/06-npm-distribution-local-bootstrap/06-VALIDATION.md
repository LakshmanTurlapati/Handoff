---
phase: 06
slug: npm-distribution-local-bootstrap
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-19
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`phase-01-unit`) plus tarball smoke validation |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | `vitest run apps/bridge/tests/unit/relay-connection.test.ts apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts` |
| **Full suite command** | `npm run typecheck && vitest run apps/bridge/tests/unit/relay-connection.test.ts apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts apps/bridge/tests/unit/daemon-manager.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts && npm run validate:handoff-pack` |
| **Estimated runtime** | ~45-120 seconds depending on tarball build and new bridge/web tests |

---

## Sampling Rate

- **After every task commit:** Run the narrowest relevant Vitest slice or tarball smoke path for the touched files.
- **After every plan wave:** Run `npm run typecheck` plus the full Phase 06 suite.
- **Before `$gsd-verify-work`:** Full suite must be green and at least one clean-shell daemon reuse flow must be exercised manually.
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | DIST-01 | workspace build | `npm run build --workspace handoff && npm run build --workspace @codex-mobile/auth && npm run build --workspace @codex-mobile/protocol` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | DIST-02 | tarball smoke | `npm run validate:handoff-pack` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | DIST-01, DIST-02 | workspace typecheck | `npm run typecheck --workspace @codex-mobile/web && npm run typecheck --workspace handoff` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | DIST-03 | db + protocol unit | `vitest run apps/web/tests/unit/bridge-connect-ticket-route.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | DIST-03 | bridge unit | `vitest run apps/bridge/tests/unit/bootstrap-client.test.ts apps/bridge/tests/unit/local-state.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 2 | DIST-03 | integration-style unit | `vitest run apps/bridge/tests/unit/local-state.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | LAUNCH-04 | bridge unit | `vitest run apps/bridge/tests/unit/daemon-manager.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | DIST-03, LAUNCH-04 | bridge unit | `vitest run apps/bridge/tests/unit/relay-connection.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts` | ✅ yes / ❌ W0 mix | ⬜ pending |
| 06-03-03 | 03 | 3 | LAUNCH-04 | launch command unit | `vitest run apps/bridge/tests/unit/launch-command.test.ts apps/bridge/tests/unit/daemon-manager.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭ gated/skipped*

---

## Wave 0 Requirements

- [ ] `apps/bridge/tsconfig.json` — package-local bridge build config for dist output
- [ ] `apps/web/tsconfig.json` — package-local web typecheck config
- [ ] `packages/auth/tsconfig.json` — package-local auth build config
- [ ] `packages/db/tsconfig.json` — package-local db build config
- [ ] `apps/bridge/tests/unit/local-state.test.ts` — local bootstrap state and permission coverage
- [ ] `apps/bridge/tests/unit/bootstrap-client.test.ts` — bridge connect-ticket client coverage
- [ ] `apps/bridge/tests/unit/daemon-manager.test.ts` — daemon reuse and stale-lock coverage
- [ ] `apps/bridge/tests/unit/launch-command.test.ts` — `handoff launch` behavior coverage
- [ ] `apps/web/tests/unit/bridge-connect-ticket-route.test.ts` — hosted bootstrap token validation and ws-ticket minting coverage
- [ ] `scripts/validate-handoff-pack.mjs` — tarball extract + CLI help smoke

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npm install -g handoff` or `npx handoff --help` works from a clean shell without the monorepo on disk | DIST-01, DIST-02 | Requires validating the actual global-install or `npx` experience outside the repo workspace | Build/publish a staging tarball, install it in a temp Node environment, run `handoff --help`, `handoff pair --help`, and confirm no workspace-path errors appear. |
| Pair once, close the terminal, then start the daemon later without re-entering `CODEX_MOBILE_USER_ID` or `CODEX_MOBILE_DEVICE_SESSION_ID` | DIST-03 | Needs a real stored bootstrap credential and a restarted shell session | On a clean machine or VM, run `handoff pair`, confirm the phrase, close the shell, open a new shell, then run `handoff launch` and verify the bridge reconnects using only local state. |
| Re-running the local handoff entrypoint reuses one outbound-only bridge instead of spawning duplicate daemons | LAUNCH-04 | Requires observing real OS process reuse | Start a handoff daemon, run `handoff launch` twice more, and verify the status output reports `daemon_reused` and only one bridge process remains live. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or an explicit Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-19
