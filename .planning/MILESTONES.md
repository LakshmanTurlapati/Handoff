# Project Milestones: Codex Mobile

## v1.0 Codex Mobile MVP (Shipped: 2026-04-18)

**Delivered:** A secure remote-control layer for local Codex sessions with QR pairing, an outbound-only local bridge, a phone-first live control UI, device/audit safety flows, and Fly-ready relay ownership and replay routing.

**Phases completed:** 1-5 with inserted `01.1` hotfix (21 plans total)

**Key accomplishments:**
- Shipped secure QR pairing, terminal confirmation, and durable 7-day device sessions across the web app and local bridge.
- Integrated the outbound-only bridge with `codex app-server` over stdio so remote users can attach to and continue real local Codex sessions.
- Delivered a mobile-first live control surface with structured activity rendering, prompt/steer/interrupt controls, reconnect UX, approvals, and explicit terminal end states.
- Added durable device revoke, append-only audit capture, and trust-boundary-safe reconnect handling across the hosted layer.
- Added durable relay ownership, Fly wrong-instance replay, readiness/ops visibility, and browser backpressure controls for multi-instance routing.

**Stats:**
- 205 files changed
- 33,545 inserted lines across the implementation range
- 6 phases, 21 plans, 43 recorded tasks
- 9 days from first implementation commit to final plan closeout

**Git range:** `feat(01-01)` → `feat(05-03)`

### Known Gaps

- Pairing and hosted trust validation debt: `AUTH-01`, `AUTH-02`, `PAIR-01`, `PAIR-02`, `PAIR-03`, `PAIR-04`, `PAIR-05`, `SEC-01`, `SEC-06`, `OPS-01`
- Bridge/session milestone verification debt: `SESS-01`, `SESS-02`, `SESS-03`, `SEC-02`
- Live-control and safety verification debt: `AUTH-03`, `AUTH-04`, `SESS-04`, `SESS-05`, `SESS-06`, `LIVE-01`, `LIVE-02`, `LIVE-03`, `LIVE-04`, `SEC-03`, `SEC-05`
- Multi-instance staging validation debt: `SEC-04`, `OPS-02`, `OPS-03`, `OPS-04`

**What's next:** Convert the archived v1.0 audit and paused UAT into explicit follow-up work with `$gsd-plan-milestone-gaps`, or define the next scoped milestone with `$gsd-new-milestone`.

---

## v1.1 Handoff Install & Launch (Paused: 2026-04-20)

**Status:** PAUSED for v1.2 pivot. Preserved for resumption.

**Delivered before pause:**
- Phase 06 (npm Distribution & Local Bootstrap): 3/3 plans complete.
- Phase 07 (Codex-Native `/handoff` Command): 2/3 plans complete; final plan not started.
- Phase 08.1 (Authless Hosted Launch, INSERTED): scoped but not executed.

**Paused requirements (carried forward as v2/future in subsequent milestone):** HOFF-01..04 (npm install without monorepo, `/handoff` invocation, authless launch land-on-active-session, automatic local bridge bootstrap).

**Resume entry point:** `.planning/phases/08.1-authless-hosted-launch/08.1-CONTEXT.md`

---

## v1.2 Achilles (Shipped: 2026-06-07)

**Delivered:** A voice companion for Claude Code — small reactive floating Electron UI (260x260 px panel with state-driven circle + waveform), ElevenLabs Scribe v2 Realtime STT, embedded companion system prompt driving spoken acknowledgement + `<spoken-summary>` block, half-duplex `claude -p --output-format stream-json` subprocess orchestration, ElevenLabs Flash v2.5 streaming TTS, authoritative outcome derived from exit code + tool_result (never LLM narration), single-source-of-truth dual distribution (npm CLI + Claude Code skill from one tarball), signed cross-platform installers (DMG + NSIS + AppImage), and a four-module hardening surface (latency probe, opt-in transcript persistence with 30-day retention, circuit-breaker incident detection with typed-input + visible-text fallback, stuck-thinking watchdog + suspend/resume + USB/Bluetooth device-change).

**Phases completed:** 09-14 (6 phases, 22 plans total).

**Key accomplishments:**
- Shipped three voice-vendor packages (`@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`) with single-use-token STT auth and sequence-tracked TTS playback.
- Shipped `@achilles/claude-code-bridge` with Zod-validated event union, LDJSON watchdog parser, authoritative outcome, and idempotent SIGINT->SIGTERM->SIGKILL cancellation.
- Delivered the `apps/achilles` Electron app with five visually distinct states, reactive circle + waveform, drag-persisted floating panel, configurable hotkey (toggle AND PTT), and macOS mic permission attribution via the Electron host.
- Composed the end-to-end voice loop with sandwich-defence transcript wrapping, pre-TTS normalisation (ANSI / paths / secrets / fenced code), and the failure-override path.
- Shipped `achilles` npm CLI + Claude Code skill + signed cross-platform installers from one source of truth, CI-gated by SHA-256 prompt-content diff and seven-pattern tarball secret scan.
- Closed v1.2 with cross-cutting hardening: per-stage latency probe, opt-in transcript persistence (default OFF, 30-day retention, transcripts purge/list), circuit-breaker incident detection with typed input fallback and visible-text TTS fallback, stuck-thinking 60 s watchdog, suspend/resume handler, and USB/Bluetooth device-change handler.

**Stats:**
- 309 files changed
- 86,024 inserted lines / 49 deleted
- 6 phases, 22 plans, 120 commits (no merges)
- 1,227+ tests passing across all phases + 30 node-test build-script cases + 6/6 MOCK_LOOP=1 end-to-end integration
- 1 day from milestone audit to ship (entire milestone delivered in single autonomous run)

**Git range:** `1a27aab` (roadmap creation) -> `e94fa4d6` (milestone audit) -> v1.2 tag

### Known Tech Debt (acknowledged at audit; routed to v1.3)

- **IN-01:** ElevenLabs SDK dependencies declared but wire protocol hand-rolled in v1.2 for offline CI testability. v1.3 migration to `@elevenlabs/client` + `@elevenlabs/elevenlabs-js` once a sandbox account is provisioned.
- **CR-02 follow-up:** main-side device-change substrate is wired end-to-end; renderer App.tsx binding of `createMicCapture.onDeviceChange -> bridge.sendDeviceChange` is the documented composition-root follow-up.
- 13 phase-level Info findings deferred as polish.

### Human Verification Debt (routed to release operator)

- Live ElevenLabs round-trip (Scribe v2 Realtime STT + Flash v2.5 TTS) on a real account
- Real Claude Code subprocess end-to-end (vs MOCK_LOOP fakes used in CI)
- Real LOOP-06 latency budget measurement (P50 < 1 s, P95 < 1.5 s) against representative tasks
- Real OS suspend/resume mid-session + USB / Bluetooth mic hot-swap with HFP downgrade
- Real macOS TCC microphone permission attribution on a fresh account
- macOS code-signing identity acquisition (env vars per `apps/achilles/build/README.md`)
- Cross-OS fresh-install verification on a fresh macOS account + Windows 11 VM + Linux container

**What's next:** Define v1.3 with `$gsd-new-milestone`. Candidate scope: SDK migration (IN-01), voice picker UI (VOICE-01), cloud Claude Code routing (CLOUD-01), and/or resume v1.1 Handoff install work (HOFF-01..04).

---
