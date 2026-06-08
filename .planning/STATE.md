---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Terminal-only Achilles
status: executing
stopped_at: "ROADMAP.md, REQUIREMENTS.md traceability, and STATE.md written; awaiting `/gsd:plan-phase 15`"
last_updated: "2026-06-08T09:45:27.393Z"
last_activity: 2026-06-08 -- Phase 16 execution started
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 8
  completed_plans: 4
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-08)

**Core value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.
**Current focus:** Phase 16 — tui-shell-state-machine-sox-mic-capture-energy-vad

## Current Position

Phase: 16 (tui-shell-state-machine-sox-mic-capture-energy-vad) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 16
Last activity: 2026-06-08 -- Phase 16 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity (v1.2 baseline for reference):**

- Total v1.2 plans completed: 22 across 6 phases (single-day milestone delivery)
- 120 commits, 86,024 inserted lines
- 1,227+ tests + 6/6 MOCK_LOOP=1 end-to-end integration

**v1.3 By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 15-20 | TBD | TBD | — |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. v1.3-specific decisions baked into the roadmap:

- Phase 15: Bun 1.3+ primary runtime + Node 22 LTS fallback via `optionalDependencies` platform-package pattern (esbuild/swc/biome precedent)
- Phase 16: Ink 7.0.5 + React 19.2.7 (supersedes the v1.3-terminal-pivot.md Ink 6 reference) + energy-threshold VAD with adaptive EWMA (silero deferred to v1.4 behind same `VadHandle` interface)
- Phase 17: All four voice packages (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`) stay byte-for-byte unchanged across the entire milestone (LOOP-02 constraint)
- Phase 18: API key hierarchy env → `@napi-rs/keyring` → encrypted file (libsodium secretbox 0o600); keytar explicitly forbidden (archived March 2026)
- Phase 19: Apple Developer ID acquisition is the phase-start release gate (signed v1.3.0 vs unsigned v1.3.0-beta with xattr workaround — both paths planned for)
- Phase 20: Three RBS asciicasts (RBS-1/2/3) + VS Code-integrated-terminal asciicast + 65 dBA noisy-environment field test are non-optional ship gate criteria — auditor cannot mark v1.3 anything but `tech_debt` without them

### Pending Todos

- (v1.3 Phase 19) Apple Developer ID acquisition decision before Phase 19 starts (release-operator owned; surface explicitly to release operator)
- (v1.3 Phase 16) Adaptive VAD EWMA tuning against representative noisy-room recordings before locking thresholds (NEEDS RESEARCH flag from research/SUMMARY.md)
- (v1.3 Phase 17) ffplay low-latency flag benchmark (100 trials of representative TTS chunks) before locking flags; Bun-on-tmux SIGTERM propagation verification on 3 OSes (NEEDS RESEARCH flag)
- (v1.3 Phase 20) asciinema + audio-capture tooling per platform; noisy-environment SC pass criteria (NEEDS RESEARCH flag)
- (v1.2 release operator) Live-environment validation — cross-OS fresh install, macOS code-signing identity acquisition, real ElevenLabs + Claude round-trip, real OS suspend/resume + device hot-swap, real LOOP-06 latency budget measurement (carryover from v1.2 audit)

### Milestone v1.2 Outcomes (carryover)

- All 30 v1.2 requirements verified code-side (audit verdict `tech_debt` with documented v1.3 followups)
- 1,227+ tests passing across phases 09-14 + 30 node-test build-script cases + 6/6 MOCK_LOOP=1 end-to-end integration
- 22 plans across 6 phases (09-14), single-day milestone delivery from audit to ship
- v1.2 silent-launch root cause documented at `.planning/debug/achilles-silent-launch.md` — v1.3 architecture pivot exists to structurally prevent that failure shape

### Blockers/Concerns

- **Apple Developer ID acquisition** (release-operator owned): if not acquired before Phase 19 start, v1.3 ships as v1.3.0-beta unsigned with documented xattr workaround. Surface decision explicitly to release operator at Phase 19 kickoff.
- **VS Code integrated-terminal TCC silent failure** on macOS Sequoia (microsoft/vscode#307364): mitigated by Phase 18 per-emulator remediation script + Phase 20 RBS-2 VS Code asciicast — but the underlying VS Code bug is outside our control.

## Deferred Items

Items acknowledged and carried forward — tracked in REQUIREMENTS.md v2 section, NOT in active v1.3 scope:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Voice Selection | VOICE-01 (curated ElevenLabs voice picker via `achilles config`) | Deferred to v1.4+ | v1.3 scoping 2026-06-08 |
| Advanced VAD | VAD-01 (silero-vad via `onnxruntime-node` behind same `VadHandle` interface) | Deferred to v1.4+ pending Bun #18079 onnxruntime resolution OR field-VAD-miss complaints | v1.3 scoping 2026-06-08 |
| TUI Evolution | TUI-08 (OpenTUI migration — Bun-FFI Zig core) | Deferred until OpenTUI ships 1.0 + 6 months stable | v1.3 scoping 2026-06-08 |
| Cloud Routing | CLOUD-01 (cloud-hosted Claude Code routing) | Deferred from v1.2 explicit ask; local-only ships in v1.3 | v1.3 scoping 2026-06-08 |
| Resumed Work | HOFF-01..04 (v1.1 Handoff install + `/handoff` + authless launch + bridge bootstrap) | Paused since v1.2 pivot; preserved at `.planning/phases/08.1-authless-hosted-launch/08.1-CONTEXT.md` | v1.2 pivot 2026-04-20 |
| Diagnostic | DIAG-01 (`achilles debug doctor`), DIAG-02 (persistent latency dashboard) | Deferred until support load justifies | v1.3 scoping 2026-06-08 |

## Prior Milestone Archive

- v1.0 Codex Mobile MVP — `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-MILESTONE-AUDIT.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`
- v1.2 Achilles — `.planning/milestones/v1.2-ROADMAP.md`, `.planning/milestones/v1.2-MILESTONE-AUDIT.md`, `.planning/milestones/v1.2-REQUIREMENTS.md`

## Session Continuity

Last session: 2026-06-08 — v1.3 milestone roadmap created (Phases 15-20)
Stopped at: ROADMAP.md, REQUIREMENTS.md traceability, and STATE.md written; awaiting `/gsd:plan-phase 15`
Resume file: None (next action is plan-phase, not resume)
