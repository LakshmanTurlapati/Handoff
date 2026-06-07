# Phase 14: Hardening, Privacy, Resilience - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (auto-optimized) — closes v1.2 milestone with cross-cutting hardening

<domain>
## Phase Boundary

Phase 14 closes v1.2 by turning the working loop (Phase 09-13) into a shippable, resilient product. Four cross-cutting concerns:

1. **Latency probe + budget verification (LOOP-06)** — `--debug` flag surfaces a per-stage latency breakdown; P50 < 1 s, P95 < 1.5 s targets verified against representative tasks (refactor / bug fix / test run). Phase 13 left the `--debug` slot in the CLI as a placeholder; Phase 14 implements it.

2. **Opt-in transcript persistence (SAFE-02)** — Default OFF. `--save-transcripts` flag enables local-only retention with bounded retention. `achilles transcripts purge` deletes them. No raw audio outside explicit `--debug-audio` mode with a loud on-screen indicator. Phase 13 shipped the subcommand stub; Phase 14 implements the storage layer.

3. **Graceful degradation (SAFE-05)** — STT failure -> "type your prompt" fallback in the UI; TTS failure -> completion text surfaced visibly in the UI and printed to the launching terminal. ElevenLabs incident detection + exponential backoff with full jitter.

4. **Stuck-thinking + device-change resilience (SAFE-06)** — 60-second stuck-thinking timeout that audibly announces the stall and offers a cancel gesture. Suspend/resume of the developer's machine and USB/Bluetooth audio device changes handled without process restart.

Out of scope for Phase 14:
- v1.3 cloud Claude Code routing (deferred per Phase 1 decision)
- Voice picker UI (v1.3)
- Wake-word, always-listening, full barge-in (out of scope)
- Native iOS/Android (out of scope)
- Custom Whisper STT fallback (out of scope)
- npm provenance, auto-update (v1.3)
- Resuming v1.1 Handoff work (paused)

</domain>

<decisions>
## Implementation Decisions

### Locked by REQUIREMENTS.md (do not reopen)
- Latency budget LOOP-06: P50 < 1 s, P95 < 1.5 s under normal network conditions
- SAFE-02: persistence default OFF; opt-in `--save-transcripts`; `achilles transcripts purge` exists
- SAFE-05: STT failure -> typed fallback; TTS failure -> visible text in UI and terminal
- SAFE-06: 60 s stuck-thinking timeout; suspend/resume; USB/Bluetooth device-change without restart

### Latency probe (LOOP-06)
- `apps/achilles/src/main/latency-probe.ts` — records timestamps at each stage:
  - `mic_capture_start`
  - `stt_first_partial`
  - `stt_committed`
  - `claude_first_text_delta`
  - `claude_assistant_done`
  - `tts_first_chunk`
  - `tts_playback_start`
  - `tts_playback_complete`
- Computes per-stage durations and end-to-end (speech-end -> first audible byte)
- `--debug` flag in the CLI exposes the probe; logged via `console.log` with `[achilles-latency]` prefix
- The session.ts orchestrator records timestamps at each transition; latency-probe.ts reads them
- An aggregated rolling window of 20 utterances powers the P50/P95 calculation
- `achilles latency --report` CLI subcommand prints a summary of recent samples
- NO live ElevenLabs measurement in CI; tests use deterministic fake timings via the existing mock-loop-clients

### Opt-in transcript persistence (SAFE-02)
- `apps/achilles/src/main/transcript-store.ts` — manages on-disk JSONL log under `~/.achilles/transcripts/` (or `$XDG_DATA_HOME/achilles/transcripts/`)
- Filename: `YYYY-MM-DD.jsonl` (one file per day); each line is `{ts, role: 'user' | 'assistant', text}`
- ONLY appends when `--save-transcripts` is passed at launch (via env var `ACHILLES_SAVE_TRANSCRIPTS=1`)
- Retention: rolling 30-day window by default (configurable via `ACHILLES_TRANSCRIPT_RETENTION_DAYS`)
- A loud on-screen indicator in the floating UI shows "Recording transcripts" when active
- `achilles transcripts purge` deletes all files in the directory; prints count + bytes freed
- `achilles transcripts list` lists files with counts
- `--debug-audio` flag is SEPARATE from `--save-transcripts`; only enables raw audio recording (PCM frames + TTS bytes) with a loud red indicator. Defaults to OFF; documented as developer-only.
- No transcript content logged via `console.*` at any point

### Graceful degradation (SAFE-05)
- `apps/achilles/src/main/incident-detection.ts` — wraps STT and TTS clients with circuit-breaker semantics:
  - 3 consecutive failures within 60 s -> circuit opens
  - 30 s cooldown before re-attempting
  - Exponential backoff with full jitter for retries (cap 5)
  - Distinguishes 4xx (auth, rate limit, model error) from 5xx (server) from network errors
- STT failure handler in session.ts:
  - Surfaces a "type your prompt" input in the floating UI (new transient overlay)
  - User can type a prompt; pressed Enter sends to Claude via the existing send() path
  - Returns to normal voice mode after the typed prompt completes
- TTS failure handler in session.ts:
  - Spoken ack and spoken-summary text are surfaced visibly in the floating UI's transcript area
  - The text is ALSO printed to the launching terminal (via main's stderr/stdout pipe)
  - User does not lose the completion summary even if no audio plays
- ElevenLabs incident detection: a small status icon (green/yellow/red) in the floating UI corner reflects current voice service health

### Stuck-thinking + device-change (SAFE-06)
- `apps/achilles/src/main/stuck-thinking-watchdog.ts`:
  - Listens for Claude progress events (`assistant_text_delta`, `tool_use`, `tool_result`)
  - Resets a 60 s timer on each progress event
  - On timer expiry: emits a `stuck-thinking` IPC + audibly announces via TTS ("Claude is still working, I'll let you know") + offers cancel via the existing hotkey
  - Continues to listen; if progress resumes, timer resets
- `apps/achilles/src/main/suspend-resume-handler.ts`:
  - Listens for Electron's `powerMonitor` events (`suspend`, `resume`, `lock-screen`, `unlock-screen`)
  - On suspend: pauses mic capture, closes STT WebSocket gracefully, stops any TTS playback
  - On resume: re-acquires the default audio device, reopens connections as needed, returns UI to idle
- `apps/achilles/src/main/device-change-handler.ts`:
  - Listens to `navigator.mediaDevices.ondevicechange` (renderer) and `systemPreferences.getMediaAccessStatus` (main)
  - On device change: tear down existing mic capture, re-acquire from new default device, restart STT stream
  - Bluetooth-HFP downgrade warning: when a Bluetooth headset switches to HFP (lower quality), log a warning but continue

### Configuration
- New `~/.achilles/config.json` for cross-process settings (latency-probe enabled, transcript retention days, debug-audio enabled). Reads via the existing `electron-store` pattern.
- CLI flags pass through to the Electron app via environment variables:
  - `ACHILLES_DEBUG=1`
  - `ACHILLES_SAVE_TRANSCRIPTS=1`
  - `ACHILLES_DEBUG_AUDIO=1`
  - `ACHILLES_TRANSCRIPT_RETENTION_DAYS=30`

### Testing strategy
- Unit tests for each new module (latency-probe, transcript-store, incident-detection, stuck-thinking-watchdog, suspend-resume-handler, device-change-handler)
- Use deterministic fake clocks (vitest `vi.useFakeTimers()`) for timeout testing
- Use mocked filesystem for transcript-store testing
- Use mocked Electron `powerMonitor` for suspend-resume testing
- Reuse Phase 12's MOCK_LOOP=1 integration for latency probe measurement (deterministic timings inject known durations; probe asserts the rollup)
- NO real Electron launch in CI
- NO real ElevenLabs / Claude calls in CI
- NO real OS suspend/resume in CI

### Documentation
- `apps/achilles/docs/operations.md` — operator guide covering debug mode, transcript flags, latency probe, ElevenLabs incident response
- README updates: new CLI flags documented

### NO emojis (CLAUDE.md global)

### Claude's Discretion
- File partitioning inside `apps/achilles/src/main/` for the new modules
- Exact phrasing of the stuck-thinking audible announcement
- Status-icon design (color palette extending Phase 11 tokens)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/achilles/src/main/session.ts` (Phase 12) — orchestrator the new modules hook into
- `apps/achilles/src/main/store.ts` (Phase 11/12) — electron-store wrapper
- `apps/achilles/src/main/key-source.ts` (Phase 12)
- `apps/achilles/src/main/mock-loop-clients.ts` (Phase 12) — deterministic fakes for testing
- `apps/achilles-cli/src/commands/transcripts.ts` (Phase 13 stub) — to be replaced with full implementation
- Phase 13's CLI flag pattern (commander)

### Files to Create
- `apps/achilles/src/main/latency-probe.ts`
- `apps/achilles/src/main/transcript-store.ts`
- `apps/achilles/src/main/incident-detection.ts`
- `apps/achilles/src/main/stuck-thinking-watchdog.ts`
- `apps/achilles/src/main/suspend-resume-handler.ts`
- `apps/achilles/src/main/device-change-handler.ts`
- `apps/achilles/src/renderer/components/TypedFallback.tsx`
- `apps/achilles/src/renderer/components/IncidentStatus.tsx`
- `apps/achilles-cli/src/commands/latency.ts` (new subcommand)
- `apps/achilles/docs/operations.md`

### Files to Modify
- `apps/achilles/src/main/session.ts` — wire all 4 hardening modules
- `apps/achilles/src/main/index.ts` — register powerMonitor listeners
- `apps/achilles/src/shared/ipc-schemas.ts` — new channels for stuck-thinking, incident status, typed fallback
- `apps/achilles-cli/src/cli.ts` — `--debug`, `--save-transcripts`, `--debug-audio` flags + `latency` + `transcripts` subcommands
- `apps/achilles-cli/src/commands/transcripts.ts` — replace stub with full impl
- `vitest.workspace.ts` — add `phase-14-unit` project

</code_context>

<specifics>
## Specific Ideas

- The latency probe is a thin observability layer over the session.ts state machine. It SHOULD reuse Phase 12's `outcomeListener` pattern (the orchestrator already emits state-transition events; the probe is just a consumer that timestamps them).
- The 60-second stuck-thinking timeout is intentionally generous (Claude can take minutes on hard tasks). The TIMEOUT should be configurable but default 60 s. The audible announcement is the affordance, not a forced cancel.
- The `--save-transcripts` flag has STRICT privacy semantics: no audio (only text), local-only (no remote write), 30-day rolling default. The on-screen indicator must be visible — pulse a red dot in the floating window corner to make it impossible to forget.
- The graceful-degradation typed fallback is a UX critical path. The "type your prompt" input must be obvious, fast, and integrate cleanly with the existing TranscriptOverlay component.

</specifics>

<deferred>
## Deferred Ideas

- Cloud Claude Code routing — v1.3 (CLOUD-01)
- Voice picker UI — v1.3 (VOICE-01)
- Custom voice cloning workflow — v2+ (VOICE-02)
- Wake-word / always-listening / full barge-in — out of scope
- Native iOS/Android — out of scope
- Local Whisper fallback — out of scope
- Status-line of Claude Code tool activity — v1.3 (CC-01)
- Agent SDK as alternative integration — v1.3 (CC-02)
- Resume v1.1 Handoff install work — separate milestone

</deferred>
