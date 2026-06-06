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

**v1.2 — Achilles (current):** Voice companion skill for Claude Code. New vertical, distinct from Handoff but living in the same monorepo.

## Current Milestone: v1.2 Achilles

**Goal:** Ship a voice companion that installs as a Claude Code skill and as an npm CLI, opens a small reactive UI (circle + waveform driven by the live mic), routes transcripts through ElevenLabs into Claude Code in the terminal, and speaks Claude Code's acknowledgement and completion back through ElevenLabs.

**Target features:**
- Achilles distributable as a Claude Code skill **and** as an npm-installable CLI from one source of truth
- Small floating UI surface — dynamic circle, waveform reacting to live microphone amplitude
- ElevenLabs STT: microphone capture transcribed to text in near real time
- ElevenLabs TTS: spoken acknowledgement when work starts, spoken summary when work completes
- Transcript piped into Claude Code in the terminal as if typed by the user
- Minimal embedded system prompt that instructs Claude Code to first acknowledge what it is about to do, then announce completion in a tone fit for spoken playback
- Cloud-hosted Claude Code is the primary install target this milestone

## Requirements

### Validated

No milestone is fully validated yet. v1.0 shipped with deferred manual verification and missing milestone verification artifacts across several phases. v1.1 is paused before validation.

### Active

<!-- v1.2 active requirements are populated by REQUIREMENTS.md after scoping. -->

- [ ] Install Achilles as a Claude Code skill from a single artifact
- [ ] Install Achilles as a global npm CLI from the same artifact
- [ ] Launch a small, always-on-top UI showing a circle and a waveform that react to live microphone amplitude
- [ ] Transcribe the user's voice via ElevenLabs and forward the transcript to Claude Code in the terminal
- [ ] Speak an acknowledgement before Claude Code starts work and a summary after Claude Code completes, using ElevenLabs TTS
- [ ] Ship a minimal embedded system prompt that drives the spoken acknowledgement and completion behaviour

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

The product direction shifted at v1.2: Handoff remains the existing remote-window product, but the immediate user goal is a voice front end for Claude Code that is installable everywhere (skill + npm) and works against cloud-hosted Claude Code first. v1.1 Handoff work is paused — its phases stay in `.planning/phases/` for resumption after v1.2 ships.

## Next Milestone Goals

- Deliver an installable voice companion (Claude Code skill + npm CLI) with the small reactive UI
- Wire end-to-end voice flow: mic capture → ElevenLabs STT → Claude Code stdin → Claude Code stdout → ElevenLabs TTS playback
- Author the minimal embedded system prompt that drives spoken acknowledgement and completion
- Keep Handoff v1.0 audit debt and v1.1 install work deferred unless they directly block Achilles

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
*Last updated: 2026-06-06 after pivoting to v1.2 Achilles (voice companion for Claude Code). v1.1 Handoff Install & Launch paused.*
