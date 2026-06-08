# Codex Mobile

## What This Is

This repository hosts two related product surfaces for living alongside terminal coding agents:

1. **Handoff (v1.0 / v1.1)** — a secure remote-control layer for local Codex sessions, optimized for phone-sized browsers. A developer runs a local bridge, pairs a device by scanning a QR code from the terminal, and continues the same local session through a Fly.io-hosted web UI and relay without opening inbound ports on the laptop.
2. **Achilles (v1.2, current)** — a voice companion that installs as a Claude Code skill and as an npm CLI, opens a small floating UI with a reactive circle and waveform, captures microphone input, transcribes via ElevenLabs, pipes the transcript into Claude Code in the terminal, and speaks Claude Code's progress and completion back through ElevenLabs.

Both surfaces are TypeScript inside a single monorepo. Handoff stays in place under `apps/` and `packages/`; Achilles is a new vertical that targets cloud-hosted Claude Code first.

## Core Value

A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.

## Current State

**v1.0 — Codex Mobile MVP (archived):** Shipped the full planned Handoff path (QR pairing, outbound-only bridge, phone-first live control UI, durable device sessions, audit, multi-instance relay routing). Archived with accepted verification debt rather than a fully passed milestone audit. See `.planning/MILESTONES.md` and `.planning/milestones/v1.0-MILESTONE-AUDIT.md`.

**v1.1 — Handoff Install & Launch (paused):** In progress at the time of the v1.2 pivot. Two phases completed (npm distribution, Codex-native `/handoff`); Phase 08.1 (authless hosted launch) was inserted and partially scoped. v1.1 artifacts remain in `.planning/phases/06-*`, `07-*`, and `08.1-*` for resumption after v1.2 ships.

**v1.2 — Achilles (shipped 2026-06-07):** Voice companion for Claude Code. Three packages (`@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`) + Claude Code bridge subprocess wrapper + Electron floating-UI shell + end-to-end orchestrator with embedded companion system prompt + dual-distribution surface (npm CLI + Claude Code skill from one source of truth) + signed cross-platform installers + cross-cutting hardening (latency probe, opt-in transcript persistence, circuit-breaker incident detection, stuck-thinking watchdog, suspend/resume + device-change handlers). All 30 v1.2 requirements verified code-side; audit verdict `tech_debt` with documented v1.3 followups. Live-validation discovered the renderer voice loop never shipped end-to-end in the v1.2 binary (debug session `.planning/debug/achilles-silent-launch.md`) — root cause that triggered the v1.3 architectural pivot. See `.planning/milestones/v1.2-ROADMAP.md` and `.planning/milestones/v1.2-MILESTONE-AUDIT.md`.

**v1.3 — Terminal-only Achilles (active):** Rebuild the voice companion as a single Bun-runtime (Node 22+ fallback) terminal package. Drops the Electron app + .app distribution entirely. Ink 6 + React 19 TUI rendering a reactive pulsing blob and braille waveform inside the calling terminal. sox child for 16k mono PCM mic capture, ffplay child for gapless MP3 TTS playback, energy-threshold + 300ms debounce VAD always-listening (drops the PTT hotkey). Reuses `voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge` packages untouched. Distribution as single npm package + per-platform Bun-compiled binaries via `optionalDependencies` + pure-JS fallback. See `.planning/research/v1.3-terminal-pivot.md` for full architecture rationale and `.planning/research/v1.2-reuse-audit.md` for the reuse map.

## Current Milestone: v1.3 Terminal-only Achilles

**Goal:** Rebuild the voice companion as a single Bun-runtime terminal package that runs the full voice loop inside the calling terminal, deleting the Electron .app and renderer entirely while reusing every voice + bridge package untouched.

**Target features:**
- TUI shell (Ink 6 + React 19) with reactive pulsing blob (Unicode block characters) and braille sparkline waveform (U+2800-U+28FF) rendered at 20fps inside the calling terminal
- VAD always-listening (energy threshold + 300ms silence debounce) replacing the v1.2 Cmd+Shift+A PTT/toggle hotkey
- `sox` child process for 16k mono PCM s16le mic capture (replaces v1.2 renderer MediaStream + AudioWorklet)
- `ffplay` child process for gapless MP3 TTS playback piped via stdin (replaces v1.2 Web Audio PlaybackQueue)
- Reuse of all 4 voice packages + `claude-code-bridge` untouched via existing dependency-injection seams
- Skill manifest rewire: `achilles launch` → `achilles voice` (one-line diff to `packages/achilles-skill/skill/SKILL.md`)
- Distribution: single `achilles` npm package + per-platform `@achilles/cli-<platform>` Bun-compiled binaries via `optionalDependencies` + 30-line JS bin shim fallback
- Hardening parity with v1.2: suspend/resume, device hot-swap, circuit-breaker, latency probe — adapted to the terminal runtime

## Requirements

### Validated

**v1.2 (30 requirements, all verified code-side; live-environment validation routed to release operator):**
- DIST-01..05 (distribution: npm install + install-skill + one-source-of-truth + init wizard + signed installers)
- UI-01..07 + LOOP-02 (floating UI shell: panel + 5 states + reactive circle + waveform + drag + hotkey + macOS mic permission + transcript display)
- LOOP-01, LOOP-03..07 (mic capture, Claude subprocess injection, ack/spoken-summary extraction, half-duplex turn-taking, latency budget, cancel)
- PROMPT-01..05 (embedded companion prompt + word caps + selective TTS routing + failure override)
- SAFE-01..06 (API key main-process-only + opt-in persistence + ElevenLabs-only allowlist + sandwich-defence + graceful degradation + stuck-thinking/suspend/device-change)

v1.0 and v1.1 milestones each retain their original validation status (v1.0 archived with verification debt; v1.1 paused before validation).

### Active

v1.3 Terminal-only Achilles — requirements being scoped. See `## Current Milestone` above for goal and target features.

### Paused (v1.1 — Handoff Install & Launch)

- [ ] Install Handoff from npm without cloning the monorepo
- [ ] Run `/handoff` inside Codex to generate a hosted handoff URL and QR code
- [ ] Open the hosted Fly site, complete pairing, and land on the active session rather than a generic picker
- [ ] Start or reuse the local bridge automatically without manual `userId` and `deviceSessionId` env wiring

### Out of Scope

- Fully hosted Codex execution or cloud workspaces in v1 — the product value is local session continuation, not replacing the developer's local environment
- General-purpose remote shell, SSH, or tmux replacement — this expands the blast radius far beyond "remote Codex control"
- Native iOS/Android apps in v1 — a mobile web app is sufficient for the first validation loop
- Team collaboration and shared-edit sessions in v1 — single-user remote continuation is the first market and security boundary to validate
- A milestone-wide sweep of all archived v1.0 verification debt — that remains separate follow-up work unless it directly blocks `/handoff` or Achilles
- A custom in-house STT/TTS stack in v1.2 — ElevenLabs is the chosen vendor; rolling our own audio models is not a v1.2 goal
- A bespoke voice agent independent of Claude Code in v1.2 — Achilles is a voice front end for Claude Code, not a standalone assistant
- Multi-user voice rooms or shared voice sessions in v1.2 — single-user voice-to-terminal is the first validation loop

## Context

The repository contains first-party product code under `apps/` and `packages/`, with the original `resources/gsd-2/` tree kept as reference material rather than the product root. The existing Handoff system is:

- `apps/web`: mobile-first Next.js UI for pairing, sessions, approvals, device management, and live control
- `apps/relay`: Fastify + `ws` relay on Fly.io for auth-gated APIs, browser/bridge routing, replay, readiness, and ops state
- `apps/bridge`: local daemon that talks outbound to the relay and locally to `codex app-server`
- `packages/protocol`, `packages/db`, and related shared packages: protocol schemas, control-plane repositories, and shared helpers

Achilles will land as a new vertical inside the same monorepo (working name `apps/achilles` and supporting `packages/voice-*` modules — exact layout decided during planning). It does **not** depend on the Handoff bridge/relay path; it talks directly to Claude Code on the developer's machine and to ElevenLabs over outbound HTTPS/WSS.

The product direction shifted at v1.2: Handoff remains the existing remote-window product, but the immediate user goal is a voice front end for Claude Code. v1.2 shipped on 2026-06-07; v1.1 Handoff work remains paused and ready for resumption.

Per the v1.2 audit, the v1.3 candidate scope includes: (a) IN-01 ElevenLabs SDK migration once a sandbox account is provisioned, (b) renderer-side device-change composition-root binding to fully close SAFE-06, (c) voice picker UI (VOICE-01), (d) cloud Claude Code routing (CLOUD-01), or (e) resuming v1.1 Handoff install work (HOFF-01..04). The release operator owns live-environment validation: cross-OS fresh install, macOS code-signing identity, real ElevenLabs + Claude round-trip, real OS suspend/resume + device hot-swap, and real LOOP-06 latency budget measurement.

## Next Milestone Goals

(Post-v1.3 candidates — not yet scoped)

- Resume v1.1 Handoff install + `/handoff` command work (HOFF-01..04)
- Voice picker UI (VOICE-01) — let users choose from a curated set of ElevenLabs voices
- Cloud Claude Code routing (CLOUD-01) — the original v1.2 cloud target deferred to local-only
- IN-01 ElevenLabs SDK migration if/when sandbox account is provisioned and the hand-rolled wire protocol becomes a maintenance burden
- Silero VAD ONNX upgrade if energy-threshold VAD proves too noisy in field use

## Constraints

- **Deployment (Handoff)**: Public web app and relay service must run on Fly.io — the local developer machine should use outbound connectivity only
- **Deployment (Achilles)**: Voice skill must run on the developer's machine; outbound-only network calls (ElevenLabs APIs, Claude Code) — no inbound ports
- **Distribution (Achilles)**: Single source of truth must ship as both a Claude Code skill and an npm-installable CLI — duplicate codebases are not acceptable
- **Integration (Achilles)**: Achilles drives Claude Code as an external user (stdin/stdout, or the Claude Code CLI's documented entrypoints) — it does not reach into Claude Code internals
- **Security (Handoff)**: Device sessions expire after 7 days — pairing credentials and connection credentials must be short-lived and single-purpose
- **Security (Achilles)**: ElevenLabs API keys and any captured audio must stay local to the developer's machine — no audio uploaded anywhere other than the chosen vendor endpoint
- **Integration (Handoff)**: Codex approval and sandbox semantics must be preserved — the remote UI should not bypass them
- **UX (Handoff)**: The primary interaction surface is a phone browser — live progress and approvals must remain readable and actionable on small screens
- **UX (Achilles)**: The UI is small and unobtrusive (floating window with circle + waveform). Latency from speech-end to spoken acknowledgement must feel conversational
- **Scope**: v1 should be open-source and contributor-friendly — architecture and protocols should be documentable without hidden control-plane magic

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `codex app-server` as the primary local Codex integration | OpenAI positions app-server as the interface for rich clients with approvals, history, and streamed agent events | ✓ Good |
| Treat `codex exec --json` as fallback automation support, not the main remote-control protocol | `codex exec` is better suited to scripts and CI than a long-lived interactive remote session | — Pending |
| Use a local bridge that talks to Codex over local stdio and to the cloud over outbound WSS | This avoids exposing the local machine directly while keeping protocol control in our product layer | ✓ Good |
| Pair devices with authenticated web sessions, short-lived QR tokens, and terminal confirmation phrases | QR-based login is hijack-prone without explicit human confirmation and short-lived trust material | ✓ Good |
| Model remote activity as product-owned structured events instead of terminal-byte scraping | Structured events preserve approvals, history, and typed mobile rendering without pretending the terminal is the source of truth | ✓ Good |
| Use Fly.io relay ownership and replay routing instead of a single in-memory node | This keeps the first version deployable while leaving a credible path to multi-instance scale | ⚠ Revisit after staged Fly validation |
| Pivot at v1.2 to a voice companion (Achilles) instead of finishing v1.1 Handoff install in this cycle | The voice surface is the next-most-valuable hand-off to terminal coding agents; v1.1 work is preserved for resumption after v1.2 | — Pending |
| Use ElevenLabs for both STT and TTS in Achilles | Single vendor for both speech surfaces simplifies install/keys and keeps voice character consistent across acknowledgement and completion | — Pending |
| Distribute Achilles as both a Claude Code skill and an npm CLI from one codebase | Users want it installable on everything; dual-target distribution from one source is achievable and avoids drift | — Pending |
| Target cloud-hosted Claude Code as the v1.2 install surface | The user explicitly named cloud as the v1.2 target; local-CLI install can come later if needed | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check -> still the right priority?
3. Audit Out of Scope -> reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-08 — v1.3 Terminal-only Achilles milestone opened after v1.2 live-validation discovered the renderer voice loop never shipped end-to-end. Architecture pivot to single Bun-runtime terminal package; Electron app deleted.*
