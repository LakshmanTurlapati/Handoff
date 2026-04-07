# Architecture Research

**Domain:** Secure remote control for local Codex sessions
**Researched:** 2026-04-06
**Confidence:** HIGH

## Standard Architecture

### System Overview

```text
┌────────────────────────────────────────────────────────────────────┐
│                          Mobile / Web Layer                       │
├────────────────────────────────────────────────────────────────────┤
│  Phone browser  │  Session list UI  │  Approval UI  │  Audit UI   │
└─────────┬──────────────────────────────────────────────────────────┘
          │ HTTPS / WSS
┌─────────▼──────────────────────────────────────────────────────────┐
│                      Hosted Control Plane (Fly.io)                │
├────────────────────────────────────────────────────────────────────┤
│  Auth + pairing API  │  Relay router  │  Relay worker ownership   │
│  Session metadata    │  Audit log     │  Presence / health        │
└─────────┬──────────────────────────────────────────────────────────┘
          │ outbound WSS only
┌─────────▼──────────────────────────────────────────────────────────┐
│                    Local Developer Machine                         │
├────────────────────────────────────────────────────────────────────┤
│  Codex Mobile bridge daemon                                       │
│    ├── pairing/approval notifier                                  │
│    ├── relay client                                               │
│    └── Codex adapter                                              │
│          └── codex app-server (local stdio)                       │
└────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Web app | Auth, device/session views, mobile UX, live session controls | `apps/web` with Next.js + React |
| Pairing API | Create, redeem, confirm, and expire pairing sessions | Relay/control-plane HTTP endpoints |
| Relay router | Route browser connections to the relay worker that owns a local bridge | Fastify route layer plus ownership lookup |
| Relay worker | Maintain bounded live channels and event fanout | Node process with `ws`, in-memory connection maps, and backpressure |
| Local bridge daemon | Hold outbound connection, manage session lifecycle, and translate protocols | `apps/bridge` spawned locally by the user |
| Codex adapter | Start or resume local Codex threads and normalize Codex events | Local stdio child process around `codex app-server` |
| Postgres | Store users, devices, pairings, relay ownership metadata, and audit events | Shared control-plane database |

## Recommended Project Structure

```text
apps/
├── web/                 # Next.js mobile-first web UI and auth flows
├── relay/               # Fly.io relay/control-plane service
└── bridge/              # Local CLI/daemon that talks to Codex locally

packages/
├── protocol/            # Shared event schema and message contracts
├── auth/                # Cookie, token, and pairing primitives
├── db/                  # Drizzle schema and queries
├── ui/                  # Shared UI components and formatting helpers
└── observability/       # Metrics, tracing, and logging helpers
```

### Structure Rationale

- **`apps/web/`**: Keeps phone UX and browser auth isolated from long-lived relay concerns
- **`apps/relay/`**: Lets the hosted control plane evolve independently from the local bridge runtime
- **`apps/bridge/`**: Makes the local bridge a first-class product surface instead of hidden glue code
- **`packages/protocol/`**: Shared types are mandatory when the same event model crosses local and hosted boundaries

## Architectural Patterns

### Pattern 1: Outbound Bridge Pattern

**What:** The local machine never accepts inbound traffic. The bridge always connects out to the hosted relay.
**When to use:** Always, unless the product deliberately becomes a self-hosted LAN-only tool.
**Trade-offs:** Stronger default security and easier NAT traversal, but requires a hosted relay and ownership registry.

**Example:**
```typescript
// Local bridge boot
const relay = new WebSocket(relayUrl, {
  headers: { Authorization: `Bearer ${shortLivedBridgeToken}` },
})
relay.on("open", () => registerBridge(localBridgeMetadata))
```

### Pattern 2: Protocol Adapter Pattern

**What:** The bridge talks to Codex over local stdio using app-server JSON-RPC, then emits a product-owned event schema to the relay.
**When to use:** Whenever the upstream agent protocol is richer than the public product protocol should be.
**Trade-offs:** More adapter code, but clearer trust boundaries and better forward compatibility than PTY scraping.

**Example:**
```typescript
// Codex app-server -> product event
if (msg.method === "item/agentMessage/delta") {
  relay.send(encode({
    type: "agent.message.delta",
    threadId,
    turnId,
    text: msg.params.delta,
  }))
}
```

### Pattern 3: Relay Ownership Routing

**What:** Each local bridge is attached to one relay worker. Browser traffic must reach that same owner worker.
**When to use:** As soon as relay instances can scale horizontally.
**Trade-offs:** Adds routing metadata and operational complexity, but avoids global fanout and cross-instance chatter for every event.

**Example:**
```typescript
// Router decides which relay instance owns the bridge
if (ownerMachineId && ownerMachineId !== currentMachineId) {
  return reply
    .header("fly-replay", `instance=${ownerMachineId},state=${signedReplayState}`)
    .status(307)
    .send()
}
```

## Data Flow

### Request Flow

```text
[Phone Browser]
    ↓
[Web App + Auth]
    ↓
[Relay Router / Worker]
    ↓
[Local Bridge]
    ↓
[codex app-server]
    ↓
[Codex agent + tools]
```

### State Management

```text
[Postgres]
    ↓ durable state
[Relay ownership + audit + devices]
    ↓ subscribe / fetch
[Web app views] ←→ [Control actions] → [Relay worker] → [Local bridge]
```

### Key Data Flows

1. **Pairing flow:** Terminal starts pairing -> relay creates short-lived pairing record -> QR opens authenticated web flow -> terminal confirmation completes device trust
2. **Live session flow:** Browser attaches to session -> relay resolves bridge owner -> bridge streams Codex events -> browser renders structured live activity
3. **Approval/control flow:** Browser sends steer or interrupt -> relay validates ownership -> bridge calls Codex turn method -> resulting event stream updates the browser

## Recommended Build Order

1. Shared protocol package and trust-boundary message shapes
2. Web auth and secure pairing flow
3. Local bridge lifecycle and Codex app-server adapter
4. Live mobile session UI and controls
5. Relay ownership routing, observability, and production hardening

## Sources

- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server
- OpenAI Codex Non-interactive Mode docs: https://developers.openai.com/codex/noninteractive
- Fly.io "Connecting to User Machines": https://fly.io/docs/blueprints/connecting-to-user-machines/
- GSD2 local reference files:
  - `resources/gsd-2/src/headless.ts`
  - `resources/gsd-2/src/web/bridge-service.ts`
  - `resources/gsd-2/web/app/api/session/events/route.ts`
  - `resources/gsd-2/web/proxy.ts`

---
*Architecture research for: secure mobile remote control for local Codex sessions*
*Researched: 2026-04-06*
