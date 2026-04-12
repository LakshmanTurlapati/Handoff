# Phase 2: Bridge & Codex Session Adapter - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the local bridge daemon that connects outbound to the hosted relay and maps Codex app-server semantics into the product protocol. The bridge discovers local Codex sessions, registers them with the relay, and relays live session events so a remote phone can attach and continue an existing conversation.

**Scope anchor:** Backend bridge + relay integration only. No phone-side UI (that's Phase 3). No approval UI (Phase 4). No multi-instance routing (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Bridge-to-Relay Connection
- **D-01:** WebSocket transport — persistent bidirectional channel for real-time session events. Phase 1 relay is Fastify-based with ws-ticket auth.
- **D-02:** WS ticket auth — bridge mints a 60-second single-use ticket (from Phase 1 `packages/auth/src/ws-ticket.ts`), presents it on WebSocket upgrade handshake.
- **D-03:** Exponential backoff reconnect (1s to 30s cap) with automatic re-auth via fresh ws-ticket on each reconnect attempt.
- **D-04:** JSON-RPC 2.0 message format over WebSocket. Request/response/notification patterns. All message types defined as zod schemas in `packages/protocol`.

### Codex Integration Model
- **D-05:** stdio transport — spawn `codex app-server` as child process, communicate via stdin/stdout JSON lines. Per STATE.md decision: "prefer stdio first" (WebSocket transport is documented as experimental).
- **D-06:** Session discovery via `codex app-server --list` (or equivalent CLI command) — returns active threads with metadata (id, title, model, started_at, status, turn_count).
- **D-07:** Attach semantics — bridge opens stdin/stdout channel to a specific session ID. Receives event stream (turns, tool calls, outputs). Bridge relays events to the relay as JSON-RPC notifications.
- **D-08:** Conversation history on attach — bridge requests last N turns from the session, sends as a `session.history` batch notification to the relay. Phone renders conversation from that point.

### Session Lifecycle + Security
- **D-09:** Thread-level session model — each Codex thread is one remote session. Bridge exposes `{sessionId, threadTitle, model, startedAt, status, turnCount}` to the relay.
- **D-10:** Sandbox enforcement via passthrough — bridge reads Codex's existing sandbox/approval config and includes it in session metadata sent to relay. Remote commands that would violate sandbox settings are rejected at the bridge before reaching Codex.
- **D-11:** Session end — bridge sends `session.ended` notification to relay when local Codex session terminates. Relay marks session unavailable. No auto-reconnect to a dead session.
- **D-12:** One active remote-controlled session per bridge instance at a time. Bridge registers availability for multiple local sessions (listing), but only one can be attached. Multi-session multiplexing deferred to Phase 5.

### Claude's Discretion
- Bridge daemon process model (long-running vs per-command)
- Heartbeat interval between bridge and relay
- JSON-RPC method naming conventions
- Error recovery when Codex process crashes mid-session
- Local session state persistence (in-memory for Phase 2)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 infrastructure (bridge builds on this)
- `apps/bridge/src/cli/pair.ts` -- Existing bridge CLI entry point with pairing flow
- `apps/bridge/src/lib/pairing-client.ts` -- HTTP client for pairing API (reusable patterns)
- `apps/relay/src/server.ts` -- Relay Fastify server (add WebSocket upgrade handler)
- `apps/relay/src/routes/health.ts` -- Relay health endpoints
- `packages/auth/src/ws-ticket.ts` -- WS ticket mint/verify (60s TTL, HS256, JTI single-use)
- `packages/protocol/src/session.ts` -- Session protocol contracts (WsTicketClaims, DeviceSessionPublic)
- `packages/protocol/src/pairing.ts` -- Pairing protocol contracts (reference for zod schema patterns)
- `docs/adr/0001-phase-1-trust-boundary.md` -- Trust boundary: browser -> web -> relay -> bridge -> codex

### Codex app-server
- Codex documentation for `app-server` stdio protocol (external — research phase will investigate)
- `codex exec --json` as fallback automation support

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/bridge/` -- existing npm workspace with CLI entry point, pairing client, QR lib
- `apps/relay/` -- existing Fastify server with health routes, ready for WebSocket upgrade
- `packages/protocol/` -- shared zod-based protocol contracts
- `packages/auth/` -- ws-ticket mint/verify helpers
- `packages/db/` -- Drizzle schema (may need session-related tables)

### Established Patterns
- npm workspaces with `@codex-mobile/` scope for shared packages
- zod schemas for all protocol contracts with `.strict()` validation
- Route handlers export named HTTP methods (GET, POST)
- In-memory stores for Phase 2 (Drizzle migration deferred)
- `--no-verify` commits in parallel execution, hooks validated post-wave

### Integration Points
- Bridge daemon: new `apps/bridge/src/daemon/` directory for long-running bridge process
- Relay WebSocket: extend `apps/relay/src/server.ts` with `@fastify/websocket` upgrade
- Protocol: new `packages/protocol/src/bridge.ts` for bridge-relay JSON-RPC message types
- Session events: new `packages/protocol/src/events.ts` for Codex event normalization

</code_context>

<specifics>
## Specific Ideas

- The bridge is the security boundary — it sits between the public relay and the private Codex process. Every command from the relay must be validated against Codex's sandbox config before being forwarded.
- stdio is the conservative choice for Codex integration. If Codex's WebSocket transport stabilizes, it can replace stdio in a future phase without changing the relay protocol.
- JSON-RPC 2.0 is well-understood and has existing zod validation patterns. Method names should follow `domain.action` convention (e.g., `session.list`, `session.attach`, `session.event`, `turn.send`).

</specifics>

<deferred>
## Deferred Ideas

- WebSocket transport for Codex app-server (experimental — reassess in Phase 5)
- Multi-session multiplexing (Phase 5: Multi-Instance Routing)
- Session persistence across bridge restarts (Phase 5: Production Hardening)
- Bridge auto-discovery via mDNS/Bonjour (out of v1.0 scope)

</deferred>

---

*Phase: 02-bridge-codex-session-adapter*
*Context gathered: 2026-04-12*
