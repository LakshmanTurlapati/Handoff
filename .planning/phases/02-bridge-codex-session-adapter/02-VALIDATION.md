---
phase: 02
slug: bridge-codex-session-adapter
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-18
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for bridge, relay, and Codex adapter feedback sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest workspace (`phase-01-unit`) for bridge + relay unit/integration coverage |
| **Config file** | `vitest.workspace.ts` |
| **Quick run command** | `vitest run --project phase-01-unit apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/codex-event-normalizer.test.ts apps/bridge/tests/unit/session-flow.test.ts apps/bridge/tests/unit/event-relay.test.ts apps/relay/tests/unit/ws-bridge.test.ts` |
| **Full suite command** | `npm run typecheck && vitest run --project phase-01-unit` |
| **Estimated runtime** | ~20-60 seconds depending on mocked integration coverage |

---

## Sampling Rate

- **After every task commit:** Run the narrow task-specific Vitest slice
- **After every plan wave:** Run `vitest run --project phase-01-unit`
- **Before deferred end-to-end verification:** Run full bridge + relay unit/integration coverage, then human test with a live local Codex process
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SESS-01 | unit | `vitest run --project phase-01-unit apps/bridge/tests/relay-connection.test.ts apps/relay/tests/ws-bridge.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | SESS-02 | unit | `vitest run --project phase-01-unit apps/bridge/tests/unit/codex-adapter.test.ts` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | SESS-03 | unit | `vitest run --project phase-01-unit apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/codex-event-normalizer.test.ts` | ✅ | ✅ green |
| 02-02-03 | 02 | 2 | SEC-02 | unit | `vitest run --project phase-01-unit apps/bridge/tests/unit/codex-event-normalizer.test.ts` | ✅ | ✅ green |
| 02-03-01 | 03 | 2 | SESS-02 | integration | `vitest run --project phase-01-unit apps/bridge/tests/unit/session-flow.test.ts` | ✅ | ✅ green |
| 02-03-02 | 03 | 2 | SESS-03 | integration | `vitest run --project phase-01-unit apps/bridge/tests/unit/session-flow.test.ts apps/bridge/tests/unit/event-relay.test.ts` | ✅ | ✅ green |
| 02-03-03 | 03 | 2 | SEC-02 | integration | `vitest run --project phase-01-unit apps/bridge/tests/unit/event-relay.test.ts apps/relay/tests/unit/ws-bridge.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⏭ gated/skipped*

---

## Wave 0 Requirements

- [x] `apps/bridge/src/daemon/codex-adapter.ts` — stdio app-server adapter with initialize handshake
- [x] `apps/bridge/src/daemon/codex-event-normalizer.ts` — Codex notification to live-session translation
- [x] `apps/bridge/src/daemon/session-manager.ts` — one-active-session guard and session metadata cache
- [x] `apps/bridge/src/daemon/bridge-daemon.ts` — bridge orchestration for relay + Codex adapter
- [x] `apps/bridge/src/daemon/message-router.ts` — session list/attach/command routing
- [x] `apps/bridge/src/cli/daemon.ts` — daemon entry point
- [x] `apps/bridge/tests/unit/codex-adapter.test.ts` — mocked stdio adapter coverage
- [x] `apps/bridge/tests/unit/codex-event-normalizer.test.ts` — normalized event coverage
- [x] `apps/bridge/tests/unit/session-flow.test.ts` — list/attach/history integration coverage
- [x] `apps/bridge/tests/unit/event-relay.test.ts` — event fanout and failure handling coverage
- [x] `apps/relay/tests/unit/ws-bridge.test.ts` — bridge route expectations remain green with richer bridge traffic

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bridge daemon boots against a real local `codex app-server` and completes its handshake | SESS-02 | Automated tests mock stdio and cannot prove compatibility with the locally installed Codex CLI | Start the bridge daemon locally, confirm the app-server process starts cleanly, and verify the bridge reaches a ready state without handshake errors. |
| Remote attach resumes an existing local Codex conversation instead of creating a fresh unrelated session | SESS-03 | Requires a real local Codex thread with meaningful history | Open an existing Codex thread locally, attach through the bridge/relay path, and confirm the phone/browser sees the same historical conversation before new activity starts. |
| Sandbox and approval semantics are preserved through the bridge boundary | SEC-02 | Requires a real Codex command that would trigger approval or sandbox rejection | Trigger a command/file-change approval locally through the remote flow and confirm the bridge surfaces the approval instead of bypassing it or silently widening permissions. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or an explicit Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Manual-only checks are called out for live Codex compatibility
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-18
