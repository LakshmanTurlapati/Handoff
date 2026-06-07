# Roadmap: Codex Mobile

## Archived Milestones

- [x] [v1.0 Codex Mobile MVP](./milestones/v1.0-ROADMAP.md) — 6 phases, 21 plans, shipped 2026-04-18, archived with accepted verification gaps
- [x] [v1.2 Achilles](./milestones/v1.2-ROADMAP.md) — 6 phases (09-14), 22 plans, shipped 2026-06-07, audit `tech_debt` (all 30 REQs verified code-side; IN-01 SDK migration and renderer composition-root binding deferred to v1.3)

## Paused Milestones

- [ ] **v1.1 Handoff Install & Launch** — Phases 06 (complete), 07 (2/3 plans), 08 (planning), 08.1 (inserted, scoped) — paused at v1.2 pivot, preserved under `.planning/phases/` for resumption

## Current Milestone

No active milestone. Run `/gsd:new-milestone` to start v1.3, or resume v1.1 from `.planning/phases/08.1-authless-hosted-launch/08.1-CONTEXT.md`.

## Phase Details

<details>
<summary>v1.0 Codex Mobile MVP (Phases 01-05.x) — SHIPPED 2026-04-18</summary>

Archived under `.planning/milestones/v1.0-ROADMAP.md`. Phase directories preserved under `.planning/phases/01-*` through `.planning/phases/05-*` and the inserted `01.1-*` hotfix.

</details>

<details>
<summary>v1.1 Handoff Install & Launch (Phases 06-08.1) — PAUSED at v1.2 pivot</summary>

### Phase 06: npm Distribution & Local Bootstrap
**Status:** Complete (2026-04-19)

### Phase 07: Codex-Native `/handoff` Command
**Status:** Plans 07-01 and 07-02 complete; final plan not started.

### Phase 08: Hosted Launch & Active-Session Handoff
**Status:** Paused before any plan completed.

### Phase 08.1: Authless Hosted Launch (INSERTED)
**Status:** Inserted and scoped; not executed before v1.2 pivot. Resume file at `.planning/phases/08.1-authless-hosted-launch/08.1-CONTEXT.md`.

</details>

<details>
<summary>v1.2 Achilles (Phases 09-14) — SHIPPED 2026-06-07</summary>

Archived under `.planning/milestones/v1.2-ROADMAP.md` with full per-phase plan details, success criteria, pitfall mitigations, and outcomes. Phase directories preserved under `.planning/phases/09-*` through `.planning/phases/14-*`.

Six phases delivered: voice vendor wrappers (09), Claude Code bridge (10), floating UI shell (11), end-to-end integration + system prompt (12), distribution npm CLI + skill + installers (13), hardening + privacy + resilience (14). 22 plans, 120 commits, 86k inserted lines, 1227+ tests passing across all phases, MOCK_LOOP=1 end-to-end integration 6/6 passing. Audit verdict `tech_debt`: all 30 REQs verified code-side; live-environment validation routed to release operator and architectural IN-01 (SDK migration) plus renderer device-change binding deferred to v1.3.

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 06. npm Distribution & Local Bootstrap | v1.1 | 3/3 | Complete | 2026-04-19 |
| 07. Codex-Native `/handoff` Command | v1.1 | 2/3 | Paused | - |
| 08. Hosted Launch & Active-Session Handoff | v1.1 | 0/3 | Paused | - |
| 08.1. Authless Hosted Launch | v1.1 | 0/3 | Paused | - |
| 09. Voice Vendor Wrappers | v1.2 | 3/3 | Complete | 2026-06-06 |
| 10. Claude Code Bridge | v1.2 | 3/3 | Complete | 2026-06-06 |
| 11. Floating UI Shell | v1.2 | 3/3 | Complete | 2026-06-06 |
| 12. End-to-End Integration & System Prompt | v1.2 | 4/4 | Complete | 2026-06-06 |
| 13. Distribution — npm CLI + Skill + Installers | v1.2 | 4/4 | Complete | 2026-06-07 |
| 14. Hardening, Privacy, Resilience | v1.2 | 4/4 | Complete | 2026-06-07 |
