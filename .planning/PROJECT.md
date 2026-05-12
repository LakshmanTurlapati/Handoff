# Codex Mobile

## What This Is

Codex Mobile is a secure remote-control layer for local Codex sessions, optimized for phone-sized browsers. A developer runs a local bridge beside Codex, pairs a device by scanning a QR code rendered in the terminal, and continues the same local session through a Fly.io-hosted web UI and relay without opening inbound ports on the laptop.

The shipped v1.0 product is a TypeScript monorepo with a mobile-first Next.js web app, a Fastify/WebSocket relay on Fly.io, and an outbound-only local bridge that integrates with `codex app-server` over stdio. The product is intentionally not a cloud-hosted coding agent or a general-purpose remote shell; it is a remote window into a developer's existing local Codex environment, with security, session control, and mobile usability treated as first-order requirements.

## Core Value

A developer can safely continue a local Codex session from anywhere, with live progress and approvals, without exposing raw shell access or moving their local environment into the cloud.

## Current State

v1.0 shipped the full planned product path:

- Secure browser auth, QR pairing, verification-phrase confirmation, and durable device sessions
- An outbound-only bridge that registers with the relay, integrates with `codex app-server`, and preserves Codex approval and sandbox semantics
- A phone-first live session UI with structured activity rendering, prompt/steer/interrupt controls, approval handling, reconnect UX, and terminal session states
- Durable device management, revoke, and append-only audit flows
- Relay ownership leases, wrong-instance Fly replay routing, readiness checks, operator visibility, and browser backpressure controls

The archive state is intentionally conservative. Implementation is complete, but v1.0 was archived with accepted verification debt rather than a fully passed milestone audit. See `.planning/MILESTONES.md` and `.planning/milestones/v1.0-MILESTONE-AUDIT.md`.

## Current Milestone

_(none — v1.1 shipped 2026-05-12. Run `/gsd-new-milestone` to start the next cycle.)_

## Recently Shipped: v1.1 Handoff Install & Launch (2026-05-12)

**Delivered:** Handoff is now installable from npm and invokable from inside Codex via `$handoff`. The skill mints a single-use Fly-hosted `/launch/<publicId>` URL plus terminal QR, the authless launch flow exchanges the publicId for a durable device session, and the phone lands directly on the active session that initiated the handoff. Status: tech_debt — code complete, one-time hosted pairing bootstrap deferred as HUMAN-UAT.

## Requirements

### Validated

- v1.0 (Codex Mobile MVP, 2026-04-18) — secure remote-control substrate; archived with accepted verification debt.
- v1.1 (Handoff Install & Launch, 2026-05-12) — 12/12 requirements satisfied, audit status `tech_debt`:
  - DIST-01/02/03 — npm install, usable CLI, bootstrap without raw env wiring
  - LAUNCH-01/02/03/04 — single-use Fly-hosted URL + QR, authless launch, active-session deep-link, no inbound ports
  - CMD-01/02 — Codex `$handoff` skill bound to active thread
  - SAFE-01/02 — approval/sandbox semantics preserved, short-lived single-purpose credentials
  - DX-01 — public install + usage docs

### Active

- [ ] HUMAN-UAT: complete one-time hosted pairing bootstrap in a real signed-in browser (`08.1-HUMAN-UAT.md`)
- [ ] HUMAN-UAT: `$handoff` end-to-end smoke from a real Codex thread (`08.1-HUMAN-UAT.md`, supersedes `07-HUMAN-UAT.md`)
- [ ] Address pre-existing `apps/bridge/tests/unit/event-relay.test.ts` failures (out of v1.1 scope, carried into next milestone)

### Out of Scope

- Fully hosted Codex execution or cloud workspaces in v1 — the product value is local session continuation, not replacing the developer's local environment
- General-purpose remote shell, SSH, or tmux replacement — this expands the blast radius far beyond "remote Codex control"
- Native iOS/Android apps in v1 — a mobile web app is sufficient for the first validation loop
- Team collaboration and shared-edit sessions in v1 — single-user remote continuation is the first market and security boundary to validate
- A milestone-wide sweep of all archived v1.0 verification debt — that remains separate follow-up work unless it directly blocks `/handoff`

## Context

The repository now contains first-party product code under `apps/` and `packages/`, with the original `resources/gsd-2/` tree kept as reference material rather than the product root. The active system is:

- `apps/web`: mobile-first Next.js UI for pairing, sessions, approvals, device management, and live control
- `apps/relay`: Fastify + `ws` relay on Fly.io for auth-gated APIs, browser/bridge routing, replay, readiness, and ops state
- `apps/bridge`: local daemon that talks outbound to the relay and locally to `codex app-server`
- `packages/protocol`, `packages/db`, and related shared packages: protocol schemas, control-plane repositories, and shared helpers

The product direction remains the same as at initialization: remote continuation of local Codex sessions, not hosted execution. The immediate product gap is no longer the hosted pairing or live-control substrate; it is the install and entrypoint UX. Today Handoff is still a repo-local bridge CLI plus hosted website. This milestone turns that into the shape the user actually wants: `npm install handoff`, then `/handoff` inside Codex.

## Next Milestone Goals

- Package Handoff as a distributable CLI with a stable bootstrap path
- Add Codex-native `/handoff` invocation that captures the active session context
- Route the generated URL through the existing Fly-hosted site and active-session handoff flow
- Keep the older v1.0 audit debt deferred unless it blocks the new install-and-launch path

## Constraints

- **Deployment**: Public web app and relay service must run on Fly.io — the local developer machine should use outbound connectivity only
- **Security**: Device sessions expire after 7 days — pairing credentials and connection credentials must be short-lived and single-purpose
- **Integration**: Codex approval and sandbox semantics must be preserved — the remote UI should not bypass them
- **UX**: The primary interaction surface is a phone browser — live progress and approvals must remain readable and actionable on small screens
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
| Use a Codex CLI skill (`$handoff` / `/skills`) instead of a custom `/handoff` slash command | The custom slash-command surface was not actually supported by the Codex CLI runtime, while the skills surface is | ✓ Good — shipped in v1.1 (phase 07.1) |
| Make the hosted `/launch/[publicId]` flow authless and back the browser principal by the durable device session | A single-use launch token plus a server-issued device-session cookie is the smallest hosted trust boundary that still lands a phone on the active session, and it avoids a second GitHub round-trip on every handoff | ✓ Good — shipped in v1.1 (phase 08.1) |

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
*Last updated: 2026-05-12 after completing v1.1 milestone*
