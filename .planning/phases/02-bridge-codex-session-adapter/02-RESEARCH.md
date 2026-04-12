# Phase 2: Bridge & Codex Session Adapter - Research

**Researched:** 2026-04-10
**Domain:** WebSocket relay transport, Codex app-server stdio integration, JSON-RPC 2.0 protocol bridge
**Confidence:** HIGH

## Summary

Phase 2 builds the local bridge daemon that opens an outbound WebSocket to the hosted relay, discovers local Codex threads via the `codex app-server` stdio protocol, and relays session events so a remote phone can list, attach to, and follow an existing conversation. The bridge is the security boundary between the public relay and the private Codex process.

The Codex app-server has a well-documented JSON-RPC 2.0 protocol over stdio (JSONL) with a mandatory `initialize`/`initialized` handshake, rich thread lifecycle methods (`thread/list`, `thread/read`, `thread/resume`), structured turn events (`turn/started`, `item/agentMessage/delta`, `item/commandExecution/requestApproval`, `turn/completed`), and explicit approval request/response flows. The bridge's job is to translate between this local protocol and the bridge-relay JSON-RPC 2.0 WebSocket channel.

**Primary recommendation:** Hand-roll a thin JSON-RPC 2.0 message layer with zod validation (matching existing project patterns) rather than pulling in a third-party JSON-RPC library. Use `@fastify/websocket` on the relay side for WebSocket upgrade with ws-ticket auth validation. Use Node.js `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']` for the Codex app-server process.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** WebSocket transport -- persistent bidirectional channel for real-time session events. Phase 1 relay is Fastify-based with ws-ticket auth.
- **D-02:** WS ticket auth -- bridge mints a 60-second single-use ticket (from Phase 1 `packages/auth/src/ws-ticket.ts`), presents it on WebSocket upgrade handshake.
- **D-03:** Exponential backoff reconnect (1s to 30s cap) with automatic re-auth via fresh ws-ticket on each reconnect attempt.
- **D-04:** JSON-RPC 2.0 message format over WebSocket. Request/response/notification patterns. All message types defined as zod schemas in `packages/protocol`.
- **D-05:** stdio transport -- spawn `codex app-server` as child process, communicate via stdin/stdout JSON lines. Per STATE.md decision: "prefer stdio first" (WebSocket transport is documented as experimental).
- **D-06:** Session discovery via `codex app-server` `thread/list` -- returns active threads with metadata (id, title, model, started_at, status, turn_count).
- **D-07:** Attach semantics -- bridge opens stdin/stdout channel to a specific session ID. Receives event stream (turns, tool calls, outputs). Bridge relays events to the relay as JSON-RPC notifications.
- **D-08:** Conversation history on attach -- bridge requests last N turns from the session, sends as a `session.history` batch notification to the relay. Phone renders conversation from that point.
- **D-09:** Thread-level session model -- each Codex thread is one remote session. Bridge exposes `{sessionId, threadTitle, model, startedAt, status, turnCount}` to the relay.
- **D-10:** Sandbox enforcement via passthrough -- bridge reads Codex's existing sandbox/approval config and includes it in session metadata sent to relay. Remote commands that would violate sandbox settings are rejected at the bridge before reaching Codex.
- **D-11:** Session end -- bridge sends `session.ended` notification to relay when local Codex session terminates. Relay marks session unavailable. No auto-reconnect to a dead session.
- **D-12:** One active remote-controlled session per bridge instance at a time. Bridge registers availability for multiple local sessions (listing), but only one can be attached. Multi-session multiplexing deferred to Phase 5.

### Claude's Discretion
- Bridge daemon process model (long-running vs per-command)
- Heartbeat interval between bridge and relay
- JSON-RPC method naming conventions
- Error recovery when Codex process crashes mid-session
- Local session state persistence (in-memory for Phase 2)

### Deferred Ideas (OUT OF SCOPE)
- WebSocket transport for Codex app-server (experimental -- reassess in Phase 5)
- Multi-session multiplexing (Phase 5: Multi-Instance Routing)
- Session persistence across bridge restarts (Phase 5: Production Hardening)
- Bridge auto-discovery via mDNS/Bonjour (out of v1.0 scope)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | Local bridge can register a Codex session with the hosted relay using outbound secure connectivity only | Bridge opens outbound WSS to relay with ws-ticket auth (D-01, D-02). Relay receives `session.register` from bridge. All connectivity is outbound from bridge. |
| SESS-02 | User can see active and recent Codex sessions available for remote control | Bridge calls `thread/list` on Codex app-server, normalizes `ConversationSummary` into `DeviceSessionPublic`-style metadata, forwards to relay via `session.list` response. |
| SESS-03 | User can attach to an existing Codex session and continue the same conversation history remotely | Bridge calls `thread/resume` + `thread/read` (with `includeTurns: true`) to load history, streams events from Codex via stdio, relays to phone via WebSocket JSON-RPC notifications. |
| SEC-02 | Remote control preserves Codex sandbox and approval semantics instead of bypassing them | Bridge reads sandbox policy via `config/read` and `configRequirements/read`, includes in session metadata. Approval requests from Codex (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) are forwarded to relay for phone-side decision. Bridge validates commands against sandbox before forwarding. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | 8.20.0 | WebSocket client (bridge) and server backing (relay via @fastify/websocket) | Already in both `apps/bridge/package.json` and `apps/relay/package.json` [VERIFIED: project codebase] |
| `@fastify/websocket` | 11.2.0 | Fastify WebSocket upgrade plugin for relay-side connection handling | Standard Fastify ecosystem plugin for WS upgrade, built on ws@8 [VERIFIED: npm registry] |
| `fastify` | 5.8.4 | Relay HTTP/WS server framework | Already in `apps/relay/package.json` [VERIFIED: project codebase] |
| `zod` | 4.3.6 | Schema validation for all JSON-RPC messages | Already used project-wide for protocol contracts [VERIFIED: project codebase] |
| `jose` | 6.2.2 | JWT signing/verification for ws-ticket | Already in `apps/relay/package.json`, used by `packages/auth/src/ws-ticket.ts` [VERIFIED: project codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `child_process` | built-in | Spawn `codex app-server` process with stdio pipes | Core bridge-Codex integration [VERIFIED: Node.js 25.6.1 built-in] |
| Node.js `readline` | built-in | Parse JSONL from Codex stdout line-by-line | Safer than manual buffer splitting for newline-delimited JSON [VERIFIED: Node.js built-in] |
| `@codex-mobile/auth` | 0.1.0 | ws-ticket mint/verify | Bridge mints ticket for relay connection [VERIFIED: project codebase] |
| `@codex-mobile/protocol` | 0.1.0 | Shared protocol contracts | All JSON-RPC message types defined here [VERIFIED: project codebase] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled JSON-RPC layer | `json-rpc-2.0` (1.7.1) or `rpc-websockets` | External deps add complexity; hand-rolled is ~100 lines with zod, matches project patterns, gives full control over message routing |
| `readline` for JSONL parsing | `ndjson` npm package | readline is built-in, handles backpressure correctly, no extra dependency |
| `@fastify/websocket` | Raw `ws.Server` with manual upgrade | @fastify/websocket integrates with Fastify routing and hooks; cleaner than managing raw upgrade |

**Installation (relay only -- bridge already has ws):**
```bash
cd apps/relay && npm install @fastify/websocket@11.2.0
```

**Version verification:**
- `@fastify/websocket@11.2.0` [VERIFIED: npm registry 2026-04-10]
- `ws@8.20.0` [VERIFIED: npm registry 2026-04-10]
- `fastify@5.8.4` [VERIFIED: npm registry 2026-04-10]
- `zod@4.3.6` [VERIFIED: npm registry 2026-04-10]

## Architecture Patterns

### Recommended Project Structure

```
apps/bridge/src/
  cli/
    pair.ts              # (existing) pairing flow
    daemon.ts            # NEW: long-running bridge daemon entry point
  daemon/
    bridge-daemon.ts     # NEW: orchestrator -- manages relay conn + codex adapter
    relay-connection.ts  # NEW: WebSocket client to relay with reconnect
    codex-adapter.ts     # NEW: spawns codex app-server, manages stdio channel
    session-manager.ts   # NEW: tracks active/attached sessions, one-at-a-time guard
    message-router.ts    # NEW: routes JSON-RPC between relay <-> codex
  lib/
    pairing-client.ts    # (existing)
    qr.ts                # (existing)
    jsonrpc.ts           # NEW: JSON-RPC 2.0 message helpers (create/parse/validate)

apps/relay/src/
  server.ts              # EXTEND: register @fastify/websocket plugin
  routes/
    health.ts            # (existing)
    readyz.ts            # (existing)
    ws-bridge.ts         # NEW: bridge WebSocket upgrade handler with ws-ticket auth
  bridge/
    bridge-registry.ts   # NEW: tracks connected bridges, maps userId -> bridgeConnection
    session-store.ts     # NEW: in-memory session metadata from bridges

packages/protocol/src/
  index.ts               # EXTEND: export new modules
  pairing.ts             # (existing)
  session.ts             # (existing)
  bridge.ts              # NEW: bridge-relay JSON-RPC message schemas
  events.ts              # NEW: normalized Codex event types for relay forwarding
```

### Pattern 1: Codex App-Server Lifecycle (stdio)

**What:** Spawn `codex app-server` as a child process with stdio pipes, perform the mandatory initialize handshake, then use the bidirectional JSONL channel for thread operations and event streaming.

**When to use:** Every time the bridge daemon starts.

**Example:**
```typescript
// Source: OpenAI Codex app-server docs + generated TypeScript schemas
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

class CodexAdapter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }>();

  async start(): Promise<void> {
    this.process = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse JSONL from stdout line by line
    const rl = createInterface({ input: this.process.stdout! });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if ("id" in msg && msg.id !== undefined) {
        // Response to a request
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if ("error" in msg) pending.reject(new Error(msg.error.message));
          else pending.resolve(msg.result);
        }
      } else if ("method" in msg) {
        // Server notification or server request
        this.handleServerMessage(msg);
      }
    });

    // Mandatory handshake
    await this.request("initialize", {
      clientInfo: { name: "codex-mobile-bridge", title: "Codex Mobile Bridge", version: "0.1.0" },
      capabilities: { experimentalApi: false, optOutNotificationMethods: null },
    });
    this.notify("initialized");
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = JSON.stringify({ method, id, params });
    this.process!.stdin!.write(message + "\n");
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  notify(method: string, params?: unknown): void {
    const message = JSON.stringify({ method, ...(params ? { params } : {}) });
    this.process!.stdin!.write(message + "\n");
  }
}
```

### Pattern 2: Bridge-Relay WebSocket with WS-Ticket Auth

**What:** Bridge opens outbound WSS connection to relay, presenting a freshly minted ws-ticket as authentication. On the relay side, `@fastify/websocket` validates the ticket on upgrade.

**When to use:** Bridge daemon startup and reconnection.

**Example (relay-side upgrade handler):**
```typescript
// Source: @fastify/websocket docs + existing ws-ticket.ts
import websocket from "@fastify/websocket";
import { verifyWsTicket, WS_TICKET_NAME } from "@codex-mobile/auth/ws-ticket";

// Register the plugin
await app.register(websocket);

// Bridge WebSocket upgrade route
app.get("/ws/bridge", { websocket: true }, (socket, request) => {
  // Auth already validated in preValidation hook
  const claims = (request as any).wsTicketClaims;

  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    // Route JSON-RPC message from bridge
  });

  socket.on("close", () => {
    // Unregister bridge sessions
  });
});

// preValidation hook for ws-ticket auth
app.addHook("preValidation", async (request, reply) => {
  if (request.url === "/ws/bridge") {
    const ticket = request.headers["sec-websocket-protocol"]
      ?? new URL(request.url, "http://localhost").searchParams.get("ticket");
    if (!ticket) {
      reply.code(401).send({ error: "missing ws-ticket" });
      return;
    }
    const claims = await verifyWsTicket({ ticket, secret: wsTicketSecret });
    // Enforce single-use via jti store
    (request as any).wsTicketClaims = claims;
  }
});
```

**Example (bridge-side outbound connection):**
```typescript
// Source: ws docs + existing ws-ticket.ts
import WebSocket from "ws";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";

class RelayConnection {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;

  async connect(relayUrl: string, secret: Uint8Array, userId: string, deviceSessionId: string): Promise<void> {
    const { ticket } = await mintWsTicket({ userId, deviceSessionId, secret });
    this.ws = new WebSocket(`${relayUrl}/ws/bridge`, {
      headers: { authorization: `Bearer ${ticket}` },
    });

    this.ws.on("open", () => {
      this.reconnectDelay = 1000; // reset on success
    });

    this.ws.on("close", () => {
      this.scheduleReconnect(relayUrl, secret, userId, deviceSessionId);
    });

    this.ws.on("message", (data) => {
      // Parse and route JSON-RPC from relay
    });
  }

  private scheduleReconnect(relayUrl: string, secret: Uint8Array, userId: string, deviceSessionId: string): void {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect(relayUrl, secret, userId, deviceSessionId);
    }, this.reconnectDelay);
  }
}
```

### Pattern 3: JSON-RPC 2.0 Message Layer with Zod

**What:** A thin, hand-rolled JSON-RPC 2.0 message layer using zod schemas for validation.

**When to use:** All bridge-relay communication.

**Example:**
```typescript
// Source: JSON-RPC 2.0 spec (jsonrpc.org/specification) + project zod patterns
import { z } from "zod";

// Base JSON-RPC schemas
const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  id: z.union([z.string(), z.number()]),
  params: z.unknown().optional(),
}).strict();

const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
}).strict();

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
}).strict();

// Bridge-relay method schemas
const SessionListResultSchema = z.object({
  sessions: z.array(z.object({
    sessionId: z.string(),
    threadTitle: z.string().nullable(),
    model: z.string(),
    startedAt: z.string(),
    status: z.enum(["idle", "active", "notLoaded"]),
    turnCount: z.number().int().nonnegative(),
  })),
}).strict();
```

### Pattern 4: WebSocket Heartbeat (ws ping/pong)

**What:** Protocol-level WebSocket ping/pong frames to detect dead connections.

**When to use:** Bridge-relay connection, both sides.

**Example:**
```typescript
// Source: ws npm docs + WebSocket RFC 6455
// Relay side: ping bridges every 30s
const HEARTBEAT_INTERVAL = 30_000;

function setupHeartbeat(ws: WebSocket): NodeJS.Timeout {
  let isAlive = true;
  ws.on("pong", () => { isAlive = true; });

  return setInterval(() => {
    if (!isAlive) {
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, HEARTBEAT_INTERVAL);
}
```

### Anti-Patterns to Avoid

- **Exposing Codex app-server directly to the network:** The bridge MUST be the intermediary. Codex is spawned with stdio transport only. No `--listen ws://` in production. [CITED: docs/adr/0001-phase-1-trust-boundary.md]
- **Using the `jsonrpc` field on the Codex stdio wire:** Codex app-server omits the `"jsonrpc": "2.0"` field on the wire. The bridge-relay protocol SHOULD include it per spec, but the Codex adapter must not expect or inject it for Codex messages. [CITED: developers.openai.com/codex/app-server]
- **Trusting relay input without validation:** Every message from the relay to the bridge must be zod-validated before being forwarded to Codex. The bridge is the security boundary.
- **Blocking the event loop with synchronous JSON parsing:** JSONL from Codex stdout can arrive at high rates during agent execution. Use `readline` + async processing, never `readFileSync` patterns.
- **Forgetting the initialize handshake:** Codex app-server rejects all requests before `initialize`/`initialized` is completed. Bridge must perform this handshake before any `thread/*` or `turn/*` calls. [VERIFIED: codex app-server --help + generated schemas]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket server on relay | Raw `http.createServer` + `ws.Server` | `@fastify/websocket` 11.2.0 | Integrates with Fastify routing, hooks, and encapsulation. Handles upgrade correctly. |
| JWT minting/verification | Custom HMAC signing | `jose` 6.2.2 via `@codex-mobile/auth` | Already implemented in `packages/auth/src/ws-ticket.ts`. Reuse, don't duplicate. |
| JSONL line parsing | Manual buffer split on `\n` | Node.js `readline.createInterface` | Handles partial lines, backpressure, and encoding correctly. Edge cases with buffer boundaries are subtle. |
| Schema validation | Manual if/typeof checks | `zod` 4.3.6 | Project-wide standard. Provides type inference, `.strict()` mode, and composable schemas. |
| Reconnection with backoff | Custom timer logic | Extract a small utility class | Well-defined: 1s initial, 2x growth, 30s cap, fresh ws-ticket on each attempt. ~20 lines. |

**Key insight:** The project already has ws, jose, zod, and auth helpers. Phase 2's job is wiring, not invention. The complexity is in the protocol translation between Codex's internal JSON-RPC and the bridge-relay JSON-RPC, not in transport or validation.

## Common Pitfalls

### Pitfall 1: Codex App-Server jsonrpc Field Omission

**What goes wrong:** The bridge sends `{ "jsonrpc": "2.0", "method": "thread/list", ... }` to Codex and gets an error, or tries to parse Codex responses expecting a `"jsonrpc"` field.
**Why it happens:** Codex app-server documentation states that `"jsonrpc": "2.0"` is "omitted on the wire" for the stdio transport. Messages use JSON-RPC 2.0 structure but without the version field.
**How to avoid:** The Codex adapter must strip `"jsonrpc"` when writing to Codex stdin and must not require it when parsing Codex stdout. The bridge-relay channel should use full JSON-RPC 2.0 (with the field).
**Warning signs:** "Parse error" or "Invalid Request" from Codex on first message. [CITED: developers.openai.com/codex/app-server]

### Pitfall 2: Codex Initialize Handshake is Mandatory

**What goes wrong:** Bridge sends `thread/list` before `initialize`/`initialized` and gets "Not initialized" error.
**Why it happens:** Codex app-server requires a strict startup sequence: send `initialize` request, wait for response, then send `initialized` notification before any other method.
**How to avoid:** Bridge's Codex adapter must gate all operations behind a `ready` promise that resolves only after the handshake completes.
**Warning signs:** "Not initialized" error from Codex on first substantive request. [VERIFIED: codex app-server generate-ts output, InitializeParams.ts]

### Pitfall 3: Stdout Pipe Backpressure

**What goes wrong:** Codex produces high-volume event streams during agent execution (`item/agentMessage/delta` tokens). If the bridge doesn't consume stdout fast enough, the Codex process blocks.
**Why it happens:** stdio pipes have limited OS buffer capacity (typically 64KB on macOS/Linux). If the consumer stalls, the producer hangs.
**How to avoid:** Use `readline.createInterface` which handles Node.js stream backpressure automatically. Process messages asynchronously. Never do synchronous work in the line handler.
**Warning signs:** Codex appears to "freeze" during long agent responses. [CITED: nodejs.org/api/child_process.html]

### Pitfall 4: WebSocket Reconnect Without Fresh Ticket

**What goes wrong:** Bridge tries to reconnect to relay using the same expired ws-ticket.
**Why it happens:** WS tickets have a 60-second TTL and are single-use. A reconnection attempt after initial disconnect will always use a stale ticket.
**How to avoid:** D-03 specifies fresh ws-ticket on each reconnect attempt. The relay connection class must mint a new ticket before every `new WebSocket()`.
**Warning signs:** 401 Unauthorized on WebSocket upgrade after reconnect. [VERIFIED: packages/auth/src/ws-ticket.ts -- WS_TICKET_TTL_SECONDS = 60]

### Pitfall 5: Approval Request Forwarding Deadlock

**What goes wrong:** Codex sends a `ServerRequest` (approval request) that requires a response. The bridge forwards it to the relay as a notification. The relay has no way to send the response back. Codex hangs waiting for the approval decision.
**Why it happens:** `ServerRequest` messages from Codex have an `id` field -- they are requests, not notifications. The bridge must track them and send a response back to Codex when the phone user makes a decision.
**How to avoid:** The message router must distinguish three message types from Codex: (1) responses to bridge requests, (2) server notifications (no id, fire-and-forget), (3) server requests (have id, need response). Type (3) must be forwarded as a JSON-RPC request to the relay, which sends the phone's decision as a response, which the bridge translates back to a Codex-format response.
**Warning signs:** Codex "stalls" during command execution -- it's waiting for an approval that never arrives. [VERIFIED: ServerRequest.ts -- approval methods have id field]

### Pitfall 6: Thread Status Confusion (notLoaded vs idle vs active)

**What goes wrong:** Bridge reports a thread as "available" but `thread/resume` fails because the thread needs to be loaded first.
**Why it happens:** `thread/list` returns threads from disk with `status: { type: "notLoaded" }`. Only threads that have been `thread/resume`d are in memory and can receive `turn/start`.
**How to avoid:** Bridge must call `thread/resume` before `turn/start`. After resume, wait for `thread/status/changed` notification indicating the thread is `idle` before allowing remote user to start turns.
**Warning signs:** "Thread not loaded" error when phone user tries to send a message. [VERIFIED: codex app-server docs, ThreadListParams.ts]

## Code Examples

### Initialize Codex App-Server (Verified Pattern)

```typescript
// Source: codex app-server generate-ts output (InitializeParams.ts, ClientNotification.ts)
// Note: Codex wire format OMITS "jsonrpc": "2.0" field

// Step 1: Send initialize request
const initRequest = JSON.stringify({
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "codex-mobile-bridge",
      title: "Codex Mobile Bridge",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: false,
      optOutNotificationMethods: null,
    },
  },
});
codexProcess.stdin.write(initRequest + "\n");

// Step 2: Wait for response (contains userAgent, codexHome, platformFamily, platformOs)
// Step 3: Send initialized notification
const initializedNotification = JSON.stringify({ method: "initialized" });
codexProcess.stdin.write(initializedNotification + "\n");
```

### List Threads (Verified Pattern)

```typescript
// Source: codex app-server generate-ts (ThreadListParams.ts, ConversationSummary.ts)
const result = await codexAdapter.request("thread/list", {
  sourceKinds: [],           // all interactive sources
  archived: false,           // active threads only
  sortKey: "updated_at",     // most recent first
  limit: 50,
});

// Result shape: { data: ConversationSummary[], nextCursor: string | null }
// ConversationSummary: {
//   conversationId: string,  // thread ID e.g. "thr_..."
//   preview: string,         // conversation summary text
//   modelProvider: string,   // "openai"
//   cwd: string,             // working directory
//   cliVersion: string,
//   source: SessionSource,
//   timestamp: string | null,
//   updatedAt: string | null,
// }
```

### Resume Thread and Read History (Verified Pattern)

```typescript
// Source: codex app-server generate-ts (ThreadResumeParams.ts, ThreadReadParams.ts)

// Step 1: Resume the thread (loads it into memory)
const resumeResult = await codexAdapter.request("thread/resume", {
  threadId: "thr_abc123",
  persistExtendedHistory: true,
  // Optional overrides: model, cwd, approvalPolicy, sandbox, etc.
});

// Step 2: Read full history with turns
const readResult = await codexAdapter.request("thread/read", {
  threadId: "thr_abc123",
  includeTurns: true,
});
// Returns thread object with turns array containing ResponseItem[]
```

### Handle Approval Request from Codex (Verified Pattern)

```typescript
// Source: codex app-server generate-ts (ServerRequest.ts, ExecCommandApprovalParams.ts)

// Codex sends (via stdout):
// { "method": "item/commandExecution/requestApproval", "id": 42, "params": {
//   "threadId": "thr_abc", "turnId": "turn_xyz", "itemId": "item_123",
//   "command": "npm install", "cwd": "/Users/dev/project",
//   "reason": "Running npm install to install dependencies",
//   "availableDecisions": ["approved", "denied", "abort"]
// }}

// Bridge forwards to relay, relay forwards to phone, phone responds.
// Bridge sends response back to Codex:
const approvalResponse = JSON.stringify({
  id: 42, // must match the request id from Codex
  result: { decision: "approved" },
});
codexProcess.stdin.write(approvalResponse + "\n");

// Or for denial:
// result: { decision: "denied" }
// Or for abort:
// result: { decision: "abort" }
```

### Bridge-Relay JSON-RPC Method Naming (Recommended Convention)

```typescript
// Bridge -> Relay (bridge-initiated)
"bridge.register"          // Bridge announces itself after WS connect
"session.list"             // Bridge sends available sessions
"session.registered"       // Bridge registers a specific session
"session.event"            // Bridge forwards a Codex event
"session.history"          // Bridge sends conversation history batch
"session.ended"            // Bridge notifies session terminated

// Relay -> Bridge (relay-initiated, forwarding phone requests)
"session.attach"           // Phone wants to attach to a session
"session.detach"           // Phone detaches from session
"turn.send"                // Phone sends user input for new turn
"turn.interrupt"           // Phone requests turn interruption
"approval.respond"         // Phone responds to an approval request
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `codex exec --json` (one-shot) | `codex app-server` (long-lived process) | Codex CLI stable release | app-server provides full thread lifecycle, streaming events, and approval flows. `exec` is for scripts/CI only. |
| Custom WebSocket in Codex | stdio transport (default) | app-server launch | WebSocket transport (`--listen ws://`) is documented as experimental. stdio is the production transport. |
| Undocumented protocol | `codex app-server generate-ts` | app-server launch | Official TypeScript schema generation means the bridge can track protocol changes by regenerating types. |

**Deprecated/outdated:**
- `codex exec --json` for interactive sessions: Use `codex app-server` with `thread/start` and `turn/start` instead. `exec` lacks thread management, event streaming, and approval handling. [CITED: developers.openai.com/codex/app-server]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bridge should use `readline.createInterface` for JSONL parsing rather than manual buffer splitting | Architecture Patterns | LOW -- readline is standard Node.js; worst case is needing a different JSONL parser |
| A2 | 30-second heartbeat interval is appropriate for bridge-relay connection | Architecture Patterns (Pattern 4) | LOW -- can be tuned; too low wastes bandwidth, too high delays dead connection detection |
| A3 | Bridge daemon should be long-running (not per-command) | Architecture Patterns | LOW -- a per-command model would require re-spawning Codex app-server each time, losing thread state |
| A4 | In-memory session state (no persistence) is sufficient for Phase 2 | User Constraints | LOW -- CONTEXT.md explicitly states this as Claude's discretion with "in-memory for Phase 2" |
| A5 | `thread/list` returns `ConversationSummary` not full thread objects with turn counts | Code Examples | MEDIUM -- the generated schema shows `ConversationSummary` fields; turnCount may need to be derived from `thread/read` with `includeTurns: true` |

## Open Questions

1. **Thread turn count from `thread/list`**
   - What we know: `ConversationSummary` includes `preview`, `modelProvider`, `timestamp`, but does not include an explicit `turnCount` field.
   - What's unclear: Whether the bridge needs to call `thread/read` for each thread to get turn counts for the session list, or whether `preview` is sufficient.
   - Recommendation: Start with `thread/list` metadata only. Add `turnCount` from `thread/read` only if the phone UI actually needs it. The extra round-trip per thread is expensive.

2. **Bridge credential for relay connection**
   - What we know: ADR-0001 states "Phase 2 bridge work must open an outbound WSS connection to the Relay and will need its own bridge-scoped credential defined in a follow-up ADR; it must not inherit `cm_device_session` or `cm_ws_ticket`."
   - What's unclear: Whether to define a new bridge-specific JWT or repurpose the ws-ticket mechanism with a different claim structure.
   - Recommendation: Reuse the ws-ticket mechanism but with a `role: "bridge"` claim in the JWT payload. This avoids a new auth flow while maintaining the single-use, 60-second-TTL, HS256 pattern. The bridge would need the shared secret to mint tickets locally (already has `@codex-mobile/auth`).

3. **Sandbox policy enforcement at the bridge**
   - What we know: D-10 says "bridge reads Codex's existing sandbox/approval config and includes it in session metadata sent to relay. Remote commands that would violate sandbox settings are rejected at the bridge before reaching Codex."
   - What's unclear: The exact validation logic -- should the bridge parse the sandbox policy and reject commands that would be disallowed, or should it rely on Codex's own approval flow to catch violations?
   - Recommendation: For Phase 2, rely on Codex's built-in approval mechanism (forwarding approval requests to the phone) rather than duplicating sandbox parsing logic in the bridge. The bridge should include sandbox metadata in session info so the phone UI can display what's allowed, but enforcement comes from Codex itself. Pre-filtering can be added in Phase 4 as an optimization.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All bridge/relay code | Yes | 25.6.1 | -- |
| npm | Package management | Yes | 11.9.0 | -- |
| `codex` CLI | Bridge spawns `codex app-server` | Yes | 0.118.0-alpha.2 | -- |
| `codex app-server` subcommand | Core Codex integration | Yes | (included in codex CLI) | -- |
| `codex app-server generate-ts` | Schema generation for types | Yes | (included in codex CLI) | -- |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 |
| Config file | None project-wide -- per-workspace `vitest run` via `package.json` scripts |
| Quick run command | `npm run test --workspace apps/bridge && npm run test --workspace apps/relay` |
| Full suite command | `npm test` (runs all workspaces) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Bridge registers sessions with relay via outbound WSS | integration | `vitest run apps/bridge/tests/relay-connection.test.ts -t "registers session"` | No -- Wave 0 |
| SESS-01 | Relay validates ws-ticket on bridge upgrade | unit | `vitest run apps/relay/tests/ws-bridge.test.ts -t "validates ws-ticket"` | No -- Wave 0 |
| SESS-02 | Bridge calls thread/list and normalizes to session list | unit | `vitest run apps/bridge/tests/codex-adapter.test.ts -t "thread/list"` | No -- Wave 0 |
| SESS-02 | Session list flows from bridge through relay | integration | `vitest run apps/bridge/tests/session-flow.test.ts -t "session list"` | No -- Wave 0 |
| SESS-03 | Bridge resumes thread and streams history | unit | `vitest run apps/bridge/tests/codex-adapter.test.ts -t "thread/resume"` | No -- Wave 0 |
| SESS-03 | Event streaming from Codex through bridge to relay | integration | `vitest run apps/bridge/tests/event-relay.test.ts -t "streams events"` | No -- Wave 0 |
| SEC-02 | Approval requests forwarded from Codex to relay | unit | `vitest run apps/bridge/tests/approval-flow.test.ts -t "forwards approval"` | No -- Wave 0 |
| SEC-02 | Approval responses forwarded from relay to Codex | unit | `vitest run apps/bridge/tests/approval-flow.test.ts -t "returns decision"` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test --workspace apps/bridge && npm run test --workspace apps/relay`
- **Per wave merge:** `npm test` (full workspace suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/bridge/tests/codex-adapter.test.ts` -- unit tests for Codex stdio adapter (SESS-02, SESS-03)
- [ ] `apps/bridge/tests/relay-connection.test.ts` -- unit tests for relay WebSocket client (SESS-01)
- [ ] `apps/bridge/tests/session-flow.test.ts` -- integration tests for session listing flow (SESS-02)
- [ ] `apps/bridge/tests/event-relay.test.ts` -- integration tests for event streaming (SESS-03)
- [ ] `apps/bridge/tests/approval-flow.test.ts` -- unit tests for approval forwarding (SEC-02)
- [ ] `apps/relay/tests/ws-bridge.test.ts` -- unit tests for bridge WebSocket upgrade handler (SESS-01)
- [ ] `apps/relay/tests/bridge-registry.test.ts` -- unit tests for bridge connection tracking
- [ ] Test fixtures: mock Codex app-server process (spawns, responds to initialize, returns canned thread data)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | ws-ticket JWT (60s TTL, HS256, single-use jti) from `@codex-mobile/auth` |
| V3 Session Management | Yes | Bridge connection is session-scoped; reconnect requires fresh ticket |
| V4 Access Control | Yes | Bridge enforces one-active-session guard (D-12); relay maps userId to bridge |
| V5 Input Validation | Yes | All JSON-RPC messages validated via zod schemas before processing |
| V6 Cryptography | No | No new crypto beyond existing ws-ticket HS256 |

### Known Threat Patterns for Bridge-Relay Architecture

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay attack on ws-ticket | Spoofing | jti single-use enforcement on relay (existing in ws-ticket.ts) |
| Malicious JSON-RPC method injection from relay | Tampering | Bridge validates all relay messages with zod; only whitelisted methods forwarded to Codex |
| Unauthorized bridge impersonation | Spoofing | ws-ticket binds to userId + deviceSessionId; relay verifies claims |
| Sandbox bypass via crafted turn/start params | Elevation | Bridge does not forward arbitrary `sandboxPolicy` or `approvalPolicy` overrides from relay; uses Codex's configured values |
| Denial of service via high-frequency events | Denial of Service | Bridge rate-limits event forwarding to relay; relay applies per-connection backpressure |
| Information disclosure via error messages | Information Disclosure | Bridge sanitizes Codex error details before forwarding to relay; never expose file paths or internal state |

## Sources

### Primary (HIGH confidence)
- OpenAI Codex App Server official documentation: https://developers.openai.com/codex/app-server -- full protocol spec, transport details, method listing, event types
- OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference -- command line flags for `codex app-server`
- `codex app-server generate-ts` output -- 75+ TypeScript files with exact type definitions for all request/response/notification types [VERIFIED: generated locally from codex-cli 0.118.0-alpha.2]
- Project codebase: `packages/auth/src/ws-ticket.ts`, `packages/protocol/src/session.ts`, `packages/protocol/src/pairing.ts` -- existing patterns and contracts
- `docs/adr/0001-phase-1-trust-boundary.md` -- binding trust boundary rules

### Secondary (MEDIUM confidence)
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification -- formal spec for request/response/notification format
- npm registry: `@fastify/websocket@11.2.0`, `ws@8.20.0` version verification
- GitHub @fastify/websocket README: https://github.com/fastify/fastify-websocket -- plugin registration, routing, TypeScript support

### Tertiary (LOW confidence)
- ws heartbeat patterns: community best practices from blog posts and npm packages. The 30-second interval is a common recommendation but should be validated against real-world bridge-relay latency.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in the project or verified on npm registry
- Architecture: HIGH -- Codex app-server protocol is well-documented with generated TypeScript types; relay patterns follow existing Fastify conventions
- Pitfalls: HIGH -- verified against official docs, generated schemas, and existing codebase; approval request deadlock is the most critical pitfall

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- Codex app-server protocol and Fastify ecosystem are mature)
