# Codex Mobile

## What This Is

Codex Mobile is a secure remote-control layer for local Codex sessions, optimized for phone-sized browsers. A developer runs a local bridge beside Codex, pairs a device by scanning a QR code rendered in the terminal, and continues the same local session through a Fly.io-hosted web UI and relay without opening inbound ports on the laptop.

The product is intentionally not a cloud-hosted coding agent. It is a remote window into a developer's existing local Codex environment, with security, session control, and mobile usability treated as first-order product requirements.

## Core Value

A developer can safely continue a local Codex session from anywhere, with live progress and approvals, without exposing raw shell access or moving their local environment into the cloud.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Secure QR-based device pairing with terminal confirmation and 7-day device sessions
- [ ] Live mobile/web remote control for local Codex sessions using structured event streaming
- [ ] Secure-by-default auth, approval, and audit model for an internet-facing relay
- [ ] Fly.io deployment and routing model that scales beyond a single relay instance
- [ ] Open-source, web-first developer experience that is simple to self-host and extend

### Out of Scope

- Fully hosted Codex execution or cloud workspaces in v1 — the product value is local session continuation, not replacing the developer's local environment
- General-purpose remote shell, SSH, or tmux replacement — this expands the blast radius far beyond "remote Codex control"
- Native iOS/Android apps in v1 — a mobile web app is sufficient for the first validation loop
- Team collaboration and shared-edit sessions in v1 — single-user remote continuation is the first market and security boundary to validate

## Context

This repository is currently a project wrapper plus a mapped brownfield reference tree under `resources/gsd-2/`. The mapped GSD2 codebase is useful as implementation substrate and design reference because it already demonstrates adjacent primitives such as headless orchestration in `resources/gsd-2/src/headless.ts`, remote-question flows in `resources/gsd-2/src/resources/extensions/remote-questions/`, and web auth plus event streaming in `resources/gsd-2/web/lib/auth.ts`, `resources/gsd-2/web/proxy.ts`, and `resources/gsd-2/web/app/api/session/events/route.ts`.

The user request referenced "Cloud Code mobile" behavior; this has been interpreted as Anthropic Claude Code Remote Control because the requested behavior matches the official product pattern: local execution, remote phone/browser continuation, QR-based connection, and live synchronized session state. The goal is to build an equivalent experience for Codex, but using Codex-native integration points instead of terminal scraping whenever possible.

External research strongly points to `codex app-server` as the primary integration surface for this product. OpenAI documents app-server as the rich-client protocol Codex uses for approvals, conversation history, and streamed agent events; `codex exec --json` remains a useful fallback for one-shot automation, but not as the core protocol for an interactive mobile control plane. Fly.io documentation also provides a clear scale-out routing pattern for WebSocket-capable HTTP services via `fly-replay`, which aligns with a relay-ownership model for browser-to-bridge connections.

## Constraints

- **Deployment**: Public web app and relay service must run on Fly.io — the local developer machine should use outbound connectivity only
- **Security**: Device sessions expire after 7 days — pairing credentials and connection credentials must be short-lived and single-purpose
- **Integration**: Codex approval and sandbox semantics must be preserved — the remote UI should not bypass them
- **UX**: The primary interaction surface is a phone browser — live progress and approvals must remain readable and actionable on small screens
- **Scope**: v1 should be open-source and contributor-friendly — architecture and protocols should be documentable without hidden control-plane magic

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use `codex app-server` as the primary local Codex integration | OpenAI positions app-server as the interface for rich clients with approvals, history, and streamed agent events | — Pending |
| Treat `codex exec --json` as fallback automation support, not the main remote-control protocol | `codex exec` is better suited to scripts and CI than a long-lived interactive remote session | — Pending |
| Use a local bridge that talks to Codex over local stdio and to the cloud over outbound WSS | This avoids exposing the local machine directly while keeping protocol control in our product layer | — Pending |
| Pair devices with authenticated web sessions, short-lived QR tokens, and terminal confirmation phrases | OWASP QR-login guidance makes QR hijacking a primary risk that must be mitigated explicitly | — Pending |
| Use Fly.io as a relay/control plane, with routing based on relay ownership rather than a single in-memory node | This keeps the first version deployable while leaving a credible path to multi-instance scale | — Pending |

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
*Last updated: 2026-04-06 after initialization*
