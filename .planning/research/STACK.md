# Stack Research

**Domain:** Secure remote control for local Codex sessions
**Researched:** 2026-04-06
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Codex App Server | Match installed Codex CLI | Local Codex protocol surface | OpenAI documents app-server as the interface used for rich clients, including approvals, conversation history, and streamed agent events |
| Next.js | 16.2.2 | Public web UI and mobile-first PWA shell | Mature React-based frontend with straightforward deployment on Fly.io and good support for authenticated dashboards |
| React | 19.2.4 | Mobile/web interaction layer | Current stable React stack that pairs cleanly with Next.js |
| TypeScript | 6.0.2 | Shared types across bridge, relay, and web | Strong typing is critical for protocol adapters and trust-boundary validation |
| Fastify | 5.8.4 | Relay and control-plane HTTP service | Good fit for a long-lived Node service handling auth endpoints, health checks, and WebSocket upgrade coordination |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ws` | 8.20.0 | WebSocket transport | Use for the browser-to-relay and bridge-to-relay live channels |
| `jose` | 6.2.2 | Token signing and verification | Use for short-lived connection tickets, pairing tokens, and secure cookie/session flows |
| `zod` | 4.3.6 | Runtime validation | Validate every inbound relay message and every control-plane request |
| `qrcode` | 1.5.4 | QR generation | Render terminal pairing codes and browser fallback pairing flows |
| `drizzle-orm` | 0.45.2 | Database access layer | Model users, bridges, device sessions, pairing requests, and audit records with typed queries |
| `postgres` | 3.4.9 | PostgreSQL driver | Durable control-plane state for pairing, device sessions, and relay ownership metadata |
| `@tanstack/react-query` | 5.96.2 | Client cache and reconnect behavior | Useful for session lists, device revocation, and reconnect-heavy mobile dashboards |
| `@opentelemetry/api` | 1.9.1 | Observability hooks | Instrument queue pressure, disconnect reasons, and relay ownership routing |
| `@simplewebauthn/server` | 13.3.0 | Optional passkey upgrade path | Keep available if passwordless auth evolves beyond simple OAuth/magic-link flows |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js 22 LTS | App runtime | Strong compatibility with current Codex tooling, Next.js, and Fly.io Node workloads |
| Fly Machines + `fly-replay` | Web/relay deployment and request routing | Official Fly guidance supports replaying any HTTP request, including WebSockets, to the correct target machine |
| Drizzle Kit | Schema migrations | Keeps the control-plane schema auditable and contributor-friendly |

## Installation

```bash
# Core web + relay
npm install next react react-dom fastify ws jose zod drizzle-orm postgres qrcode @tanstack/react-query @opentelemetry/api

# Dev dependencies
npm install -D typescript @types/node @types/ws drizzle-kit
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `codex app-server` | `codex exec --json` | Use `exec` for CI jobs, one-shot automations, or fallback compatibility flows where rich session control is unnecessary |
| Fastify relay + WSS | Next.js-only API/SSE surface | Acceptable for a local proof of concept, but not ideal for a bidirectional internet-facing remote-control plane |
| Postgres + Drizzle | SQLite/local file state | Fine for solo local development, but not credible for multi-instance Fly deployment |
| HttpOnly session cookies + short-lived WS tickets | Bearer tokens in URL fragments, localStorage, or query params | Only tolerable for localhost tools like GSD's local web UI, not for a public multi-user control plane |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Exposing `codex app-server --listen ws://...` directly to the internet | The WebSocket transport is documented as experimental and would collapse product security and auth policy into the raw Codex boundary | Spawn app-server locally over stdio and mediate it through a product-owned bridge |
| Query-string bearer tokens as a public-session primitive | They leak too easily through logs, browser history, and proxy surfaces | Use HttpOnly sessions plus short-lived upgrade tickets |
| PTY scraping as the primary integration | It is brittle and loses structured approvals, thread lifecycle, and event semantics | Use app-server events as the canonical data model |
| General-purpose SSH/tmux tunneling as the core product | It expands the risk surface far beyond "remote Codex control" | Keep the product scoped to Codex-session mediation |

## Stack Patterns by Variant

**If shipping the fastest credible MVP:**
- Use a monorepo with `apps/web`, `apps/relay`, `apps/bridge`, and `packages/protocol`
- Keep browser-to-relay and bridge-to-relay traffic on a single WSS protocol
- Use Postgres only for durable control-plane state; keep live stream buffers in memory per relay instance

**If scaling to many simultaneous bridges and devices:**
- Split coordinator/router concerns from relay-worker concerns
- Persist relay ownership metadata so the browser can be routed to the relay instance that owns the bridge
- Use Fly routing features instead of assuming one relay process per deployment

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `next@16.2.2` | `react@19.2.4` | Current mainstream pairing for a modern React web app |
| `fastify@5.8.4` | `ws@8.20.0` | Good combination for a custom Node relay with explicit WebSocket control |
| `drizzle-orm@0.45.2` | `postgres@3.4.9` | Typed relational persistence without adding ORM runtime weight that the MVP does not need |

## Sources

- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server
- OpenAI Codex Non-interactive Mode docs: https://developers.openai.com/codex/noninteractive
- OpenAI Codex Agent Approvals & Security docs: https://developers.openai.com/codex/agent-approvals-security
- Anthropic Claude Code Remote Control docs: https://code.claude.com/docs/en/remote-control
- Fly.io "Connecting to User Machines": https://fly.io/docs/blueprints/connecting-to-user-machines/
- Package versions verified with `npm view` on 2026-04-06

---
*Stack research for: secure mobile remote control for local Codex sessions*
*Researched: 2026-04-06*
