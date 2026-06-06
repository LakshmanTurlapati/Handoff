---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Achilles
status: planning
stopped_at: Completed 10-03-PLAN.md — cancellation primitive (SIGINT/SIGTERM/SIGKILL escalation + --resume after cancel) committed; Phase 10 complete
last_updated: "2026-06-06T14:44:25Z"
last_activity: 2026-06-06 — Plan 10-03 delivered LOOP-07 (cancellation primitive + resume-after-cancel)
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 13
  completed_plans: 11
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-06)

**Core value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.
**Current focus:** v1.2 Achilles — Phase 09 (Voice Vendor Wrappers) ready to plan

## Current Position

Phase: 10 of 14 (Claude Code Bridge) — COMPLETE
Plan: 03 complete; Phase 10 wrap-up done; ready to plan Phase 11 (Floating UI Shell) or Phase 12 (End-to-End Integration)
Status: Cancellation primitive shipped — session.cancel() SIGINT/SIGTERM/SIGKILL escalation + per-child WeakMap idempotency + drain-aware semantics + outcome.reason="cancelled" attribution + sessionId preservation for --resume continuation. All 4 Phase 10 success criteria met; all 6 Phase-10-owned pitfalls mitigated.
Last activity: 2026-06-06 — Plan 10-03 delivered LOOP-07 (cancellation primitive with 3 s upper-bound escalation + resume-after-cancel argv shape; 22 new tests bringing phase-10-unit to 138/138)

Progress: [████████░░] 77%

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.2)
- Average duration: — min
- Total execution time: — hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09. Voice Vendor Wrappers | 0 | 0 | — |
| 10. Claude Code Bridge | 0 | 0 | — |
| 11. Floating UI Shell | 0 | 0 | — |
| 12. End-to-End Integration & System Prompt | 0 | 0 | — |
| 13. Distribution — npm CLI + Skill + Installers | 0 | 0 | — |
| 14. Hardening, Privacy, Resilience | 0 | 0 | — |

**Recent Trend:**

- Last 5 plans: —
- Trend: — (first v1.2 phase not yet planned)

*Updated after each plan completion*
| Phase 10 P01 | 10 | 3 tasks | 14 files |
| Phase 10 P02 | 11 | 3 tasks | 18 files |
| Phase 10 P03 | 10 | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table and REQUIREMENTS.md Locked Decisions table.

Locked at v1.2 scoping (do not reopen during planning):

- Cloud-vs-local Claude Code target: Local Claude Code only in v1.2 (cloud routing deferred to v1.3)
- Mic trigger model: Both press-to-toggle AND push-to-talk (configurable via setting)
- Voice selection scope: One fixed default voice; `ELEVENLABS_VOICE_ID` env override honoured; no picker UI in v1.2
- Claude Code integration default: Subprocess `claude -p --output-format stream-json` is the bridge spine
- [Phase ?]: Mirror packages/voice-protocol shape verbatim for the @achilles/claude-code-bridge scaffold (package.json, tsconfig.json, src/.gitignore) — inherits Phase 09 CR-06 + CR-07 hardening for free.
- [Phase ?]: ClaudeStreamEventSchema validates only the 9 NDJSON wire-format variants; process_exit is synthesised at the runtime layer by Plan 10-02 and joins ClaudeBridgeEvent at the TypeScript layer only.
- [Phase ?]: extractSpokenSummary distinguishes 'markers absent' (returns null) from 'markers present but empty' (returns empty string ''). Phase 12 callers can use the distinction to drive different fallback behaviour.
- [Phase 10 P02]: send(text) routes the prompt via child.stdin (writes "text\n", calls stdin.end()) rather than as a positional argv argument — the spawn-then-send lifecycle conflicts with the positional-arg path. send(text) is idempotent in v1.2; multi-prompt-per-session is Phase 12's responsibility (likely via --resume on each utterance).
- [Phase 10 P02]: LDJSON watchdog has TWO trip conditions: (a) accumulator-without-newline exceeds MAX_LINE_BYTES (write-time) and (b) a completed line itself exceeds MAX_LINE_BYTES (split-time). The plan only specified (a); (b) was required by the oversized-line.ndjson fixture acceptance criterion.
- [Phase 10 P02]: events$ AsyncIterable is single-consumer with explicit terminal event — process_exit is yielded last, then the iterator terminates (subsequent .next() returns done:true immediately rather than throwing).
- [Phase 10 P03]: session.cancel() returns Promise<ProcessExitEvent> (not Promise<void>) — the plan's <interfaces> block and behaviour Test 9 both lock the return type; callers can log signal + exit_code if useful.
- [Phase 10 P03]: Cancellation primitive is NOT re-exported from the package barrel — consumers go through session.cancel() exclusively. The cancelChildProcess helper is JSDoc @internal; future direct-primitive callers (e.g., Phase 14 hardening watchdog) would import via the subpath alias.
- [Phase 10 P03]: Two-layer idempotency for cancel — session-level cancelPromise cache + per-child WeakMap in cancelChildProcess. Either alone passes the surface idempotency test; the dual cache matches the locked design and guards against future direct-primitive callers bypassing the surface.
- [Phase 10 P03]: Cancel-after-natural-exit fast path captures the original ProcessExitEvent in `capturedExitEvent` and resolves WITHOUT setting the `cancelled` flag — preserves the natural outcome (T-10-17 mitigation: prevents retroactive mis-attribution of failed runs to user intent).

### Pending Todos

- (v1.2) Plan Phase 09 — Voice Vendor Wrappers (entry point for v1.2 implementation)
- (v1.2) Sequence Phases 09 / 10 / 11 — parallel-safe; engineer choice on serial vs fan-out
- (v1.2) Acquire macOS code-signing identity before Phase 13 ships (known release blocker)
- (v1.2) Empirical iteration on the embedded system prompt during Phase 12 against representative tasks (refactor / bug fix / test run)

### Blockers/Concerns

- macOS code-signing identity (Apple Developer cert) must be acquired before Phase 13 publishes notarised builds — flagged in research as a known release blocker
- ElevenLabs rate-limit semantics on the production account's actual plan need a verification pass in Phase 14 against the real account (PITFALLS #4)

## Deferred Items

Items acknowledged and carried forward from v1.1 pause:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.1 Handoff | Phase 07 (Codex-Native `/handoff` Command) — 2/3 plans complete | Paused | 2026-04-20 |
| v1.1 Handoff | Phase 08 (Hosted Launch & Active-Session Handoff) | Paused | 2026-04-20 |
| v1.1 Handoff | Phase 08.1 (Authless Hosted Launch, INSERTED) | Paused, scoped | 2026-04-20 |
| v1.1 Carry-over | HOFF-01..04 requirements tracked in REQUIREMENTS.md "v2 / Future" | Deferred to post-v1.2 resumption | 2026-06-06 |

Resume file for v1.1: `.planning/phases/08.1-authless-hosted-launch/08.1-CONTEXT.md`

## Session Continuity

Last session: 2026-06-06T14:44:25Z
Stopped at: Completed 10-03-PLAN.md — cancellation primitive committed; Phase 10 (Claude Code Bridge) complete; all 4 ROADMAP success criteria met; LOOP-03, LOOP-04, LOOP-07 all delivered
Resume file: None — ready to plan Phase 11 (Floating UI Shell) or Phase 12 (End-to-End Integration & System Prompt) next
