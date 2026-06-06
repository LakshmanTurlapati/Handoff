---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Achilles
status: executing
stopped_at: Completed 11-01-PLAN.md — apps/achilles scaffold (window + state machine + hotkey + electron-store + IPC schemas); Wave 1 of Phase 11 complete
last_updated: "2026-06-06T20:58:57Z"
last_activity: 2026-06-06 — Plan 11-01 delivered the Wave-1 substrate for Phase 11 (UI-01 + UI-06 + IPC schemas + workspace plumbing)
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 13
  completed_plans: 12
  percent: 27
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-06)

**Core value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.
**Current focus:** v1.2 Achilles — Phase 09 (Voice Vendor Wrappers) ready to plan

## Current Position

Phase: 11 of 14 (Floating UI Shell) — Wave 1 of 2 complete
Plan: 01 complete (Wave 1); Plans 11-02 + 11-03 are Wave 2 and can run in parallel
Status: apps/achilles scaffold shipped — locked BrowserWindow contract (UI-01) + pure state machine reducer + .strict() Zod IPC schemas + electron-store with safeStorage fallback + global hotkey honouring toggle + PTT (UI-06) + preload contextBridge surface + MockAchillesBridge test seam + workspace plumbing. 89/89 unit tests + 3/3 Playwright scaffold specs pass. NO Electron launch in CI (per CLAUDE.md global + CONTEXT.md test strategy).
Last activity: 2026-06-06 — Plan 11-01 delivered the Wave-1 substrate for Phase 11 (UI-01 BrowserWindow contract, AchillesState reducer, 12 IPC channel schemas, electron-store wrapper, hotkey + PTT key-up substrate, MockAchillesBridge seam, tsconfig + vitest + playwright project plumbing)

Progress: [████████░░] 78%

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
| Phase 11 P01 | ~75 | 2 tasks | 30 files |

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
- [Phase 11 P01]: Renamed src/preload/global.d.ts → src/preload/global.ts (Rule 1 fix). The plan's files list named global.d.ts while the CR-07 verification check required zero .d.ts in src/. TypeScript allows `declare global { ... }` inside a regular .ts module (with at least one top-level export); the .ts rename preserves the typed window augmentation and clears CR-07 unambiguously.
- [Phase 11 P01]: Added apps/achilles/vite.headless.config.ts as a separate plain-vite config (Rule 3 fix). electron-vite lacks a clean "skip main+preload, build only the renderer against an alternate HTML root" mode; the plain-vite config is ~30 lines and runs against test/mocks/index.html which pre-injects mock-bridge.ts so window.__mockBridge populates before main.tsx hydrates.
- [Phase 11 P01]: Locked timer durations live in shared/constants.ts (LISTENING_VAD_DELAY_MS=1200, PROCESSING_DELAY_MS=800, SPEAKING_DELAY_MS=2000, ERROR_AUTO_DISMISS_MS=8000) so Phase 12's real voice loop has a single source of truth to swap into.
- [Phase 11 P01]: getBridge() adapter pattern — the renderer never branches on bridge identity; bridge.ts returns a unified AchillesBridge surface backed by window.__mockBridge in headless tests or window.achilles in production. Plans 11-02 + 11-03 import only getBridge.

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

Last session: 2026-06-06T20:58:57Z
Stopped at: Completed 11-01-PLAN.md — Wave 1 of Phase 11 (Floating UI Shell) substrate shipped; ready to execute Plans 11-02 (visual components) and 11-03 (drag/permission/settings/error) in parallel
Resume file: None — Wave 2 of Phase 11 ready to dispatch
