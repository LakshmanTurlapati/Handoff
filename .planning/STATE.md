---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Achilles
status: "Plan 12-04 session orchestrator shipped — apps/achilles/src/main/session.ts composes Phase 09/10/11/12-01/12-02/12-03 deliverables into the per-utterance voice loop with SAFE-04 sandwich-defence wrapping, pre-TTS normalisation, half-duplex gating (mic paused on processing → speaking + 300 ms debounce after TTS playback drains), and the PROMPT-05 runtime override that emits 'I ran into a problem. <reason>' regardless of LLM narration whenever deriveOutcome returns failure. ElevenLabs API key surface single read point in main only (store-first + env fallback + MissingApiKeyError graceful degradation). Plan 11-01 mock-timer back-compat preserved via MOCK_* event tags. 200/200 phase-12-unit tests (4 EE tests skip cleanly without MOCK_LOOP=1; all 200 pass under MOCK_LOOP=1). 413/413 phase-11-unit pass (no regression). 302/302 phase-09 + phase-10 pass (no regression). Typecheck clean. CR-07 hygiene clean."
stopped_at: Completed 12-04-PLAN.md — Wave 3 of Phase 12 (session orchestrator composing voice-stt + claude-bridge + voice-tts + sandwich-defence + normalisation + half-duplex + error override) shipped
last_updated: "2026-06-06T18:55:00.000Z"
last_activity: 2026-06-06 — Plan 12-04 delivered the per-utterance orchestrator at apps/achilles/src/main/session.ts wired into main/index.ts production composition root, the single-read-point ElevenLabs API key surface at apps/achilles/src/main/key-source.ts, the deterministic mock-loop-clients factories, and the MOCK_LOOP=1 integration test
progress:
  total_phases: 10
  completed_phases: 4
  total_plans: 20
  completed_plans: 18
  percent: 45
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-06)

**Core value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.
**Current focus:** v1.2 Achilles — Phase 09 (Voice Vendor Wrappers) ready to plan

## Current Position

Phase: 12 of 14 (End-to-End Integration & System Prompt) — Wave 3 plan-04 complete
Plan: 04 complete (Wave 3 / plan-04); all 4 plans of Phase 12 shipped
Status: Plan 12-04 session orchestrator shipped — apps/achilles/src/main/session.ts composes Phase 09/10/11/12-01/12-02/12-03 deliverables into the per-utterance voice loop. SAFE-04 sandwich-defence wraps every transcript before bridge.send. Pre-TTS normalisation strips ANSI/paths/secret-prefixes from both the ack AND the spoken-summary body. Half-duplex gating: micCapture.pauseFrameDelivery on processing → speaking + MIC_FRAME drop during speaking + 300 ms (SPEAKING_DEBOUNCE_MS) tail before transitioning to idle. PROMPT-05 runtime override: deriveOutcome failure → "I ran into a problem. <humanReason>" regardless of LLM body. ElevenLabs API key surface single read point in main only (apps/achilles/src/main/key-source.ts with store-first + env fallback + MissingApiKeyError graceful degradation). 4 new state-machine event tags (STT_COMMITTED, CLAUDE_RESULT_READY, TTS_PLAYBACK_DRAINED, CLAUDE_FAILURE_OVERRIDE) + 4 new ipc-bridge inbound handlers + apps/achilles/src/main/mock-loop-clients.ts deterministic fakes + apps/achilles/test/integration/end-to-end-loop.test.ts gated by MOCK_LOOP=1. Plan 11-01 MOCK_* back-compat preserved. Cumulative: 200/200 phase-12-unit tests + 413/413 phase-11-unit + 302/302 phase-09/10 (no regression). Typecheck clean.
Last activity: 2026-06-06 — Plan 12-04 shipped the per-utterance orchestrator composing every Phase 09/10/11/12-01/12-02/12-03 deliverable with structural enforcement of LOOP-05 half-duplex + PROMPT-05 PITFALLS #17 runtime override + SAFE-01 API key isolation + SAFE-04 sandwich-defence

Progress: [█████████░] 90%

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
| Phase 11 P02 | ~60 | 2 tasks | 17 files |
| Phase 12 P04 | 30 | 3 tasks | 17 files (7 new + 10 modified) |

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
- [Phase 11 P02]: Per-file jsdom environment via `// @vitest-environment jsdom` docblock — phase-11-unit project keeps node default; component tests opt in per file. Cleaner than splitting the project into two workspace entries.
- [Phase 11 P02]: Canvas 2D shim in test setup, not the `canvas` npm package — jsdom 26 does NOT ship Canvas2D (returns null). A 30-line getContext('2d') stub recording fillStyle / fillRect calls satisfies WF1-WF4 without ballooning the dev dependency footprint with Cairo + pixman.
- [Phase 11 P02]: Headless debug surface gated by `import.meta.env.MODE === 'headless' || 'development' || 'test'` — vite.headless.config.ts defines MODE='headless' so the debug conditional resolves true only there; production electron-vite path sets MODE='production' so the branch is dead code.
- [Phase 11 P02]: MockAnalyser inlines the LCG generator instead of importing createMockAmplitudeStream from src/main — renderer / main process separation lock. Seed convention (42) + Numerical Recipes constants duplicated so streams pair up for fixture comparison without crossing the process boundary.
- [Phase 11 P02]: Per-state accent via CSS custom property cascade — `[data-state='X']` selectors set `--circle-color-current` to `var(--achilles-X)`. The state-distinctness e2e reads the resolved property and asserts pairwise distinctness across all 5 states without hard-coding hex values.
- [Phase 11 P02]: useAchillesState reducer clamps mic/TTS amplitude into [0,1] (T-11-08 defence in depth). ReactiveCircle has a second-line clamp in its inline --circle-scale calculation. Both defences cap the scaled circle at 1.4× the natural size.
- [Phase 12 P04]: Plan 12-04 layers Plan 12-04 production state-machine tags ALONGSIDE the Phase 11 MOCK_* tags. The MOCK_* tags remain functional so the Phase 11 Playwright e2e specs run unchanged. The new tags (STT_COMMITTED, CLAUDE_RESULT_READY, TTS_PLAYBACK_DRAINED, CLAUDE_FAILURE_OVERRIDE) drive the same listening → processing → speaking → idle transitions; CLAUDE_FAILURE_OVERRIDE carries a `reason` payload the orchestrator inspects separately to know the spoken summary must be the PROMPT-05 override.
- [Phase 12 P04]: createSessionStateController is a thin wrapper over createMockStateController with no-op timer scheduling. The reducer is the same in both modes; only the timer pump differs.
- [Phase 12 P04]: session.ts captures the API key in a closure at construction time via deps.readApiKey(). It never logs, returns, or broadcasts the key. The SE13 logger-spy assertion pins this invariant: no log line ever contains the key bytes or raw transcript content.
- [Phase 12 P04]: tsconfig.node.json overrides the path mappings to point at the workspace packages' dist/ .d.ts files (instead of src/ .ts). This keeps rootDir:src intact while letting session.ts import deriveOutcome/extractAck/etc as runtime values resolved via Node's package resolution. The vitest workspace alias still points at src/ for tests so the dev loop reads from source.
- [Phase 12 P04]: The integration test (apps/achilles/test/integration/end-to-end-loop.test.ts) gates every it() via `process.env.MOCK_LOOP`. Without the env var the suite skips cleanly (4 skipped / 2 pass for the locked-constant invariants), satisfying the CLAUDE.md no-live-network default.
- [Phase 12 P04]: DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM" is a locked v1.2 module-level constant in shared/constants.ts. main/index.ts reads process.env.ELEVENLABS_VOICE_ID with this constant as fallback (per REQUIREMENTS.md locked decisions — "One fixed default voice (env var override allowed)").
- [Phase 12 P04]: FAILURE_OVERRIDE_PREFIX = "I ran into a problem." is the locked runtime constant in session.ts. The matching phrase is pinned in packages/achilles-skill/skill/prompts/companion.md (Plan 12-01). A drift between the two locations causes Plan 12-01 prompt-content.test.ts OR session.test.ts SE6/SE7 to fail.
- [Phase 12 P04]: The IPC_STT_TOKEN_REQUEST handler forwards to session.onHotkeyPress so the renderer's STT bootstrap re-mints when the WebSocket needs a fresh token; the call is idempotent at the state-machine layer (HOTKEY_PRESS from idle → listening; from listening it commits the in-flight utterance which the orchestrator then drops if no transcript is pending).

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

Last session: 2026-06-06T21:51:53Z
Stopped at: Completed 11-02-PLAN.md — Wave 2 plan-02 of Phase 11 (4 renderer components + 4 e2e specs proving UI-02/03/04 + LOOP-02) shipped; Plan 11-03 (Wave-2 sibling) ships drag/permission/settings/error overlay components in parallel
Resume file: None — Phase 11 Wave 2 nearing completion; Plan 11-03 still in progress as parallel sibling
