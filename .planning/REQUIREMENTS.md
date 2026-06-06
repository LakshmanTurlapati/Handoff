# Requirements: v1.2 Achilles

**Milestone:** v1.2 Achilles — voice companion for Claude Code
**Defined:** 2026-06-06
**Core Value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.

## Locked Decisions (from research scoping)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cloud-vs-local Claude Code target | **Local Claude Code only** | All research outputs flagged that cloud-hosted Claude Code cannot reach the local mic or render the floating UI. v1.2 ships local-first; cloud routing deferred to v1.3. Distribution channels (npm, skill) remain "cloud" in the install-everywhere sense. |
| Mic trigger model | **Both press-to-toggle AND push-to-talk (configurable)** | Press-to-toggle matches ChatGPT and is better for longer utterances; push-to-talk matches Claude Code `/voice` and lowers false-trigger risk. Shipping both with a setting honours either workflow. |
| Voice selection scope | **One fixed default voice (env var override allowed)** | One tuned ElevenLabs voice ID ships in v1.2. An ELEVENLABS_VOICE_ID env var is honoured for power users. No built-in picker UI — deferred to v1.3. |
| Claude Code integration default | **Subprocess: `claude -p --output-format stream-json`** | Universal, version-independent, works with cloud auth, avoids the Ink stdin gotcha (anthropics/claude-code#15553). Agent SDK is the in-process alternative but is not the v1.2 default. |

## v1.2 Requirements

Six categories, mapped to phases by the roadmapper.

### Distribution & Install (DIST)

- [ ] **DIST-01**: User can install Achilles as a global npm CLI (`npm install -g achilles`) and launch it with `achilles` on macOS, Windows, and Linux.
- [ ] **DIST-02**: User can install Achilles as a Claude Code skill via `achilles install-skill`, which symlinks the skill body into `~/.claude/skills/achilles/` so Claude Code discovers it on next launch.
- [ ] **DIST-03**: The Claude Code skill body and the npm CLI ship from one source-of-truth artifact — the embedded system prompt, voice config, and binaries are not duplicated.
- [ ] **DIST-04**: A first-run `achilles init` wizard collects the ElevenLabs API key, requests microphone permission via the Electron host, and runs an end-to-end smoke round-trip ("say something — hear something back") before exiting.
- [ ] **DIST-05**: Signed and notarised installers are produced from one build pipeline: `.dmg` for macOS (hardened runtime + `NSMicrophoneUsageDescription`), `.exe` (NSIS) for Windows, `.AppImage` for Linux.

### Floating UI & Voice Capture (UI)

- [ ] **UI-01**: Achilles opens a frameless, transparent, always-on-top window (~220–300 px square) configured as a panel on macOS so it survives Spaces and full-screen apps without stealing focus.
- [ ] **UI-02**: The UI renders five visible states — idle, listening, processing, speaking, error — each with a distinct visual treatment.
- [ ] **UI-03**: A central reactive circle pulses with live mic amplitude during listening and with TTS amplitude during speaking; idle state shows a slow breathing animation.
- [ ] **UI-04**: A live waveform driven off `AnalyserNode` renders next to the circle; its audio source switches between the mic (during listening) and the TTS playback (during speaking).
- [ ] **UI-05**: The user can drag the window to reposition it; window position persists across launches in encrypted local storage.
- [ ] **UI-06**: User can trigger listening via a configurable global hotkey or an on-screen click; both press-to-toggle and push-to-talk modes are supported and switchable via a setting.
- [ ] **UI-07**: macOS microphone permission is requested by the Electron host (not the launching terminal), with explicit remediation copy that deep-links to System Settings → Privacy → Microphone when denied.

### STT → Claude Code → TTS Loop (LOOP)

- [ ] **LOOP-01**: Mic audio is captured in the renderer via `getUserMedia`, downsampled to 16 kHz mono Int16 PCM in an AudioWorklet, and streamed to ElevenLabs Scribe v2 Realtime over a renderer-side WebSocket authenticated with a single-use token minted by the main process.
- [ ] **LOOP-02**: Partial and committed transcripts surface live in the floating UI as confirmation (display only — not editable; re-utter to correct).
- [x] **LOOP-03**: On utterance commit, the transcript is injected into a child `claude` process via `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <companion.md> --resume <sid>`; the session ID persists across utterances so context accumulates within an Achilles session.
- [x] **LOOP-04**: Claude's streamed assistant output is parsed line-by-line (NDJSON); the spoken acknowledgement and `<spoken-summary>` block are extracted and routed to ElevenLabs Flash v2.5 streaming TTS in the main process.
- [ ] **LOOP-05**: TTS audio chunks play back in arrival order via the renderer's AudioContext; the mic is gated during playback (half-duplex) and re-enabled ~300 ms after the last audio chunk drains.
- [ ] **LOOP-06**: P50 latency from speech-end to first audible TTS byte is under 1 s under normal network conditions; P95 is under 1.5 s. A latency probe surfaces in `--debug` mode.
- [ ] **LOOP-07**: The user can cancel an in-flight Claude Code job (press the hotkey again, or click a cancel control); SIGINT is sent to the child, TTS playback stops, and the UI returns to idle.

### Embedded System Prompt & Spoken Behaviour (PROMPT)

- [ ] **PROMPT-01**: Achilles ships a minimal embedded system prompt at `packages/achilles-skill/skill/prompts/companion.md`, loaded via `--append-system-prompt-file` and referenced from the skill body so both distribution surfaces use the same prompt.
- [ ] **PROMPT-02**: The prompt mandates a one-sentence spoken acknowledgement (<=12 words) emitted before any tool calls so the user hears confirmation that Claude is starting work.
- [ ] **PROMPT-03**: The prompt mandates a tight `<spoken-summary>` block (<=40 words) emitted as the final assistant action — no paths, code, symbols, ANSI escapes, or list formatting.
- [ ] **PROMPT-04**: Only the acknowledgement and the contents of `<spoken-summary>` are routed to TTS; tool calls, code edits, file diffs, and intermediate explanations are silent (visible in the terminal, not spoken).
- [ ] **PROMPT-05**: When the Claude Code run errored (non-zero exit, tool errors, refused-permission), the spoken completion is overridden with an honest "I ran into a problem" message derived from the exit code + `tool_result` events, regardless of what the LLM narrated.

### Privacy, Security & Resilience (SAFE)

- [ ] **SAFE-01**: The ElevenLabs API key is stored only in the main-process OS keystore (macOS Keychain / Windows DPAPI / libsecret) and never appears in the renderer, the npm tarball, logs, or sent over IPC.
- [ ] **SAFE-02**: Transcript and audio persistence is OFF by default; an opt-in `--save-transcripts` flag enables local-only retention with explicit on-screen copy and a `achilles transcripts purge` subcommand to delete them.
- [ ] **SAFE-03**: Outbound network is restricted to ElevenLabs endpoints and the local `claude` child; no third-party telemetry, no inbound ports, no audio leaves the developer's machine except to ElevenLabs.
- [ ] **SAFE-04**: Transcript content is wrapped in the system prompt as untrusted user input (sandwich-defence pattern) so spoken instruction-shaped commands that attempt to disregard the embedded contract cannot break the ack/completion behaviour.
- [ ] **SAFE-05**: When STT fails, the user can type a prompt as a fallback; when TTS fails, the completion text is surfaced visibly in the UI and printed to the terminal.
- [ ] **SAFE-06**: A 60-second stuck-thinking timeout audibly announces the stall and offers a cancel gesture. Suspend/resume of the developer's machine and USB/Bluetooth audio device changes are handled without process restart.

## v2 / Future Requirements

Tracked but not in the v1.2 roadmap.

### Voice Selection & Personalisation
- **VOICE-01**: Built-in voice picker UI listing curated ElevenLabs voices, swappable at runtime
- **VOICE-02**: Custom voice cloning workflow integrated with the ElevenLabs Voice Cloning API
- **VOICE-03**: Per-project voice profile that persists across Achilles sessions

### Cloud-Hosted Claude Code Routing
- **CLOUD-01**: Split-mode transport that routes transcripts from a local Achilles to a cloud-hosted Claude Code session (likely reusing the existing Handoff relay or a new outbound channel)
- **CLOUD-02**: Cloud-side spoken acknowledgement that surfaces in the local Achilles UI for cloud-only flows

### Advanced Voice UX
- **ADV-01**: Wake-word activation ("Hey Achilles")
- **ADV-02**: Always-listening continuous VAD mode
- **ADV-03**: Full barge-in with full-duplex AEC (mid-TTS interrupt)
- **ADV-04**: Editable in-window transcript before send

### Claude Code Deeper Integration
- **CC-01**: Status-line surfacing of Claude Code tool activity in the Achilles UI
- **CC-02**: Agent SDK as an alternative integration path behind a flag, with feature parity tests
- **CC-03**: Multi-user voice rooms / shared voice sessions

### Cross-Platform Surfaces
- **PLAT-01**: Native iOS / Android apps
- **PLAT-02**: Local Whisper STT fallback for offline use

### Carry-over from paused v1.1 Handoff Install & Launch
- **HOFF-01**: Install Handoff from npm without cloning the monorepo
- **HOFF-02**: Run `/handoff` inside Codex to generate a hosted handoff URL and QR code
- **HOFF-03**: Open the hosted Fly site, complete pairing, and land on the active session rather than a generic picker
- **HOFF-04**: Start or reuse the local bridge automatically without manual `userId` and `deviceSessionId` env wiring

## Out of Scope

Explicitly excluded in v1.2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud-hosted Claude Code as runtime target | Structural incompatibility with local mic + floating UI; resolved to local-only in v1.2 |
| Wake-word activation | Terminal users prefer explicit triggers; Claude Code `/voice` also chose no wake word |
| Always-listening continuous VAD | Privacy norm violation in developer environments |
| Full barge-in with full-duplex AEC | 2026 production bar is heavy infra; ship half-duplex + "press again to cancel" instead |
| Editable in-window transcript | The point of Achilles is to avoid typing — re-utter to correct |
| Built-in voice picker UI | One fixed default voice in v1.2; ELEVENLABS_VOICE_ID env var honoured for power users |
| Voice cloning workflows | Adds API surface and onboarding; defer to VOICE-02 |
| Reading entire Claude Code transcript aloud | Hostile UX (Suki precedent); only ack + `<spoken-summary>` are spoken |
| Custom STT/TTS models | ElevenLabs is the chosen vendor for v1.2 |
| Multi-user voice rooms / shared voice sessions | Single-user voice-to-terminal is the first validation loop |
| Native iOS / Android apps | Desktop floating UI is the v1.2 surface |
| Local Whisper / on-device STT fallback | Adds binary footprint and accuracy regressions; defer |
| Status-line surfacing of Claude Code tool activity in the UI | Useful but expands UI surface and IPC schema; defer to CC-01 |
| Sweep of v1.0 audit debt or v1.1 install/launch work | Preserved for resumption; does not block v1.2 voice loop |

## Traceability

Which phases cover which requirements. Populated by roadmapper on 2026-06-06.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIST-01 | Phase 13 — Distribution | Pending |
| DIST-02 | Phase 13 — Distribution | Pending |
| DIST-03 | Phase 13 — Distribution | Pending |
| DIST-04 | Phase 13 — Distribution | Pending |
| DIST-05 | Phase 13 — Distribution | Pending |
| UI-01 | Phase 11 — Floating UI Shell | Pending |
| UI-02 | Phase 11 — Floating UI Shell | Pending |
| UI-03 | Phase 11 — Floating UI Shell | Pending |
| UI-04 | Phase 11 — Floating UI Shell | Pending |
| UI-05 | Phase 11 — Floating UI Shell | Pending |
| UI-06 | Phase 11 — Floating UI Shell | Pending |
| UI-07 | Phase 11 — Floating UI Shell | Pending |
| LOOP-01 | Phase 09 — Voice Vendor Wrappers | Pending |
| LOOP-02 | Phase 11 — Floating UI Shell | Pending |
| LOOP-03 | Phase 10 — Claude Code Bridge | Complete |
| LOOP-04 | Phase 10 — Claude Code Bridge | Complete |
| LOOP-05 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| LOOP-06 | Phase 14 — Hardening, Privacy, Resilience | Pending |
| LOOP-07 | Phase 10 — Claude Code Bridge | Pending |
| PROMPT-01 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| PROMPT-02 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| PROMPT-03 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| PROMPT-04 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| PROMPT-05 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| SAFE-01 | Phase 09 — Voice Vendor Wrappers | Pending |
| SAFE-02 | Phase 14 — Hardening, Privacy, Resilience | Pending |
| SAFE-03 | Phase 09 — Voice Vendor Wrappers | Pending |
| SAFE-04 | Phase 12 — End-to-End Integration & System Prompt | Pending |
| SAFE-05 | Phase 14 — Hardening, Privacy, Resilience | Pending |
| SAFE-06 | Phase 14 — Hardening, Privacy, Resilience | Pending |

**Coverage:**
- v1.2 requirements: 30 total (5 DIST, 7 UI, 7 LOOP, 5 PROMPT, 6 SAFE)
- Mapped to phases: 30 (100%)
- Unmapped: 0

**Per-phase requirement counts:**
- Phase 09 — Voice Vendor Wrappers: 3 (LOOP-01, SAFE-01, SAFE-03)
- Phase 10 — Claude Code Bridge: 3 (LOOP-03, LOOP-04, LOOP-07)
- Phase 11 — Floating UI Shell: 8 (UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, LOOP-02)
- Phase 12 — End-to-End Integration & System Prompt: 7 (PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-04, PROMPT-05, LOOP-05, SAFE-04)
- Phase 13 — Distribution: 5 (DIST-01, DIST-02, DIST-03, DIST-04, DIST-05)
- Phase 14 — Hardening, Privacy, Resilience: 4 (LOOP-06, SAFE-02, SAFE-05, SAFE-06)

Total: 3 + 3 + 8 + 7 + 5 + 4 = 30 ✓

---
*Requirements defined: 2026-06-06*
*Last updated: 2026-06-06 — roadmapper populated traceability table; 30/30 requirements mapped to Phases 09-14*
