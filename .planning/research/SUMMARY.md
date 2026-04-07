# Project Research Summary

**Project:** Codex Mobile
**Domain:** Secure mobile remote control for local Codex sessions
**Researched:** 2026-04-06
**Confidence:** HIGH

## Executive Summary

Codex Mobile should be built as a secure remote window into a developer's local Codex runtime, not as a hosted coding workspace. The closest public product pattern is Anthropic's Claude Code Remote Control: the local session stays on the developer machine while remote clients attach through a hosted control layer. For Codex specifically, the best technical fit is OpenAI's `codex app-server`, which is explicitly documented as the protocol surface for rich clients with approvals, conversation history, and streamed agent events.

The architecture should therefore center on a local bridge daemon, a Fly.io-hosted relay/control plane, and a phone-first web UI. The local bridge talks to Codex over local stdio, not over an internet-exposed socket. Pairing must use single-use QR tokens plus terminal confirmation to avoid QR hijacking. The hosted layer should own authentication, device sessions, auditing, and relay ownership routing. A fallback automation path using `codex exec --json` is useful, but it should not define the main remote-control protocol.

## Key Findings

### Recommended Stack

The strongest stack shape is a TypeScript monorepo with a Next.js web app, a Fastify-based relay/control plane, a local bridge daemon, and a shared protocol package. Postgres is the right durable state store for devices, pairings, audit logs, and relay ownership metadata, while live event buffers stay local to the owning relay instance. For the actual Codex integration, `codex app-server` should be the first-class protocol and `codex exec --json` should remain a one-shot automation fallback.

**Core technologies:**
- Codex App Server: primary integration surface for approvals, conversation history, and streamed agent events
- Next.js + React: mobile-first authenticated web UI
- Fastify + `ws`: relay/control plane for browser and bridge connections
- Postgres + Drizzle: durable metadata for devices, pairings, sessions, ownership, and audit

### Expected Features

Remote-control products in this category need secure sign-in, QR-based pairing, live synced session views, remote prompt/steer controls, approval visibility, reconnect behavior, and device revocation. These are not polish items; they are the table stakes for making an internet-facing remote-control tool feel safe and credible. The main product differentiators here are Codex-native protocol integration, outbound-only bridge connectivity, and explicit anti-hijack measures around pairing.

**Must have (table stakes):**
- Authenticated web session and 7-day device session management
- QR-based device pairing with terminal confirmation
- Live structured session streaming plus prompt/steer/interrupt controls
- Approval visibility, reconnect behavior, and revocation/audit

**Should have (competitive):**
- Codex-native app-server integration instead of PTY scraping
- Relay ownership routing for scale on Fly.io
- Open-source, self-hostable relay and bridge

**Defer (v2+):**
- Native mobile apps
- Team collaboration and shared sessions
- Hosted workspaces or cloud execution

### Architecture Approach

The recommended architecture is: authenticated phone browser -> Fly.io web/relay -> outbound-connected local bridge -> local `codex app-server` -> Codex session. The relay owns identity, audit, and routing; the bridge owns the local Codex process boundary; the browser never talks directly to the local machine. This separates internet-facing concerns from local agent concerns while preserving the "same local session, new device" product promise.

**Major components:**
1. Web app — auth, device/session management, mobile UX, live controls
2. Relay/control plane — pairing, routing, ownership, audit, observability
3. Local bridge — app-server adapter, outbound connectivity, local lifecycle management

### Critical Pitfalls

1. **QR pairing without anti-hijack controls** — single-use tokens and terminal confirmation are mandatory
2. **Direct internet exposure of local Codex protocols** — keep app-server local and mediate it through a product-owned bridge
3. **Reusing localhost token patterns in a public relay** — use HttpOnly sessions and short-lived WS tickets, not localStorage/query tokens
4. **Designing for one relay instance** — persist ownership and route explicitly before scale forces a rewrite
5. **Making terminal output the canonical protocol** — use structured Codex events first, terminal rendering second

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Identity & Pairing Foundation
**Rationale:** Security and trust boundaries must exist before any remote control is enabled.
**Delivers:** Web auth, short-lived pairing records, terminal QR flow, terminal confirmation, and initial Fly deployment
**Addresses:** Auth, pairing, and public-edge security requirements
**Avoids:** QR hijacking and public-token leakage

### Phase 2: Bridge & Codex Session Adapter
**Rationale:** The local Codex boundary should be stable before the mobile UI grows around it.
**Delivers:** Local bridge daemon, outbound relay connection, app-server adapter, and attach-to-session behavior
**Uses:** Codex app-server and shared protocol contracts
**Implements:** The core local-to-cloud bridge boundary

### Phase 3: Live Remote UI & Control
**Rationale:** Once session identity exists, the product can deliver the core remote-control loop.
**Delivers:** Phone-optimized live session timeline, prompt/steer/interrupt controls, and structured activity rendering

### Phase 4: Approval, Audit & Device Safety
**Rationale:** Once control is live, the next highest risk is making it safe to use repeatedly.
**Delivers:** Device revocation, reconnect behavior, approval surfaces, and audit events

### Phase 5: Multi-Instance Routing & Production Hardening
**Rationale:** Scaling should happen after the single-user flow works but before beta exposure grows.
**Delivers:** Relay ownership routing, Fly-aware request routing, observability, and backpressure handling

### Phase Ordering Rationale

- Pairing and identity come before bridge and UI because the system is internet-facing from day one
- The bridge comes before the mobile UI because the product should model real Codex semantics, not invent them later
- Scale and routing are intentionally after the core loop, but their architecture is accounted for early

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** final auth choice (OAuth-only vs magic link vs passkey hybrid)
- **Phase 5:** exact Fly.io routing implementation and operational ownership model at multi-instance scale

Phases with standard patterns (skip heavy research-phase):
- **Phase 2:** local bridge lifecycle and protocol adaptation
- **Phase 3:** mobile timeline and live-control UI once protocol events are available

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official OpenAI and Fly docs line up well with the proposed architecture |
| Features | HIGH | Product expectations are clear from the reference pattern and user goals |
| Architecture | HIGH | The bridge/relay/browser split is strongly supported by the researched constraints |
| Pitfalls | HIGH | QR hijacking, token leakage, and scale routing are clear primary risks |

**Overall confidence:** HIGH

### Gaps to Address

- Exact authentication UX for v1: choose the lightest secure model that still feels friendly
- Final relay ownership implementation on Fly: `fly-replay`, sticky ownership, or a hybrid approach
- How much raw terminal rendering belongs in v1 versus a purely semantic activity timeline

---
*Research summary for: Codex Mobile*
*Researched: 2026-04-06*
