# Phase 05: Multi-Instance Routing & Production Hardening - Research

**Researched:** 2026-04-18
**Domain:** durable relay ownership, Fly.io-aware browser routing, stale-owner safety, and production observability
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Durable Ownership Model
- **D-01:** Relay ownership must move from process-local memory to a durable Postgres-backed lease that any relay instance can query before listing sessions, attaching browsers, or forwarding control.
- **D-02:** The authoritative durable record is one active bridge-owner row per connected bridge/device owner, with an optional current `sessionId` pointer instead of separate session-only ownership rows.
- **D-03:** The ownership record must support safe replacement and stale-owner detection and therefore needs `userId`, `deviceSessionId`, `bridgeInstanceId`, `relayInstanceId`, lease/heartbeat timing, and attached-session metadata.

### Browser Routing Contract
- **D-04:** `apps/web` should keep returning one canonical public relay URL, not per-instance relay URLs.
- **D-05:** Wrong-instance routing should happen inside the relay layer: the non-owning relay resolves the current owner and replays/reroutes to the owning Fly relay instance.

### Stale Ownership and Attach Safety
- **D-06:** Missing, stale, conflicting, or unauthorized ownership must fail closed for attach and control operations.
- **D-07:** Safe recovery starts with a fresh bridge ownership refresh or reconnect. The browser should see an explicit unavailable/retry state, not silent takeover by another relay.

### Operator Visibility and Pressure Guards
- **D-08:** Phase 5 only needs a minimal but complete operator surface: relay instance health, active ownership leases, disconnect reasons, and queue/backpressure counters.
- **D-09:** Relay fanout must use bounded queues and degrade replayable or lower-priority live detail first while keeping ownership/control-critical messages and terminal end states reliable.

### the agent's Discretion
- Exact schema/repository layout for durable ownership rows
- Lease heartbeat cadence and stale-owner timeout values
- Exact format of the compact operator-facing surface, provided it exposes lease state, disconnect reasons, and pressure counters

### Deferred Ideas (OUT OF SCOPE)
- Rich operator console/dashboard UX beyond compact APIs, structured logs, and metrics
- Broader multi-session or multi-user collaboration semantics beyond the current single active remote-controlled session per bridge owner
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-04 | Relay validates browser-to-bridge ownership so one user cannot attach to another user's local bridge | Use durable ownership leases keyed by authenticated bridge identity, validate owner on every browser attach/control path, and fail closed when no authoritative lease exists. |
| OPS-02 | Relay supports multiple concurrently connected users and bridges without one in-memory coordinator | Move ownership truth into Postgres and treat in-memory registries as local caches/fanout only. |
| OPS-03 | Relay routes a browser connection to the relay instance that owns the local bridge connection | Keep a canonical public relay URL and use same-app Fly `fly-replay` targeting the owning Machine/instance when a browser lands on the wrong relay. |
| OPS-04 | Operators can observe connection health, disconnect reasons, queue pressure, and relay ownership state | Extend readiness/ops endpoints plus structured logs/counters with lease state, disconnect classifications, replay failures, queue depth, and drop counts. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Product code stays under top-level `apps/` and `packages/`; do not treat `resources/gsd-2/` as the implementation root.
- The browser must remain a remote window into local Codex, not a shell, SSH, or tmux tunnel.
- The local bridge stays outbound-only and continues talking to Codex over local stdio.
- Runtime payloads and control-plane contracts must stay validated at trust boundaries.
- Mobile/browser clients must not need topology knowledge of the developer machine or internal relay layout.

## Summary

Phase 05 should make the relay multi-instance by introducing **durable ownership leases** in Postgres while keeping **live socket fanout local** to the owning relay process. The current codebase is functionally correct only for a single relay process:

1. `apps/relay/src/bridge/bridge-registry.ts` stores bridge ownership only in memory and keys it by `userId`.
2. `apps/relay/src/browser/session-router.ts` can only list sessions or forward commands if the local process already has the bridge socket.
3. `apps/web/app/api/sessions/[sessionId]/connect/route.ts` always returns one generic relay URL and has no owner resolution step.
4. `apps/relay/src/routes/readyz.ts` always returns ready and has no ownership or pressure gating.
5. `apps/relay/src/browser/session-buffer.ts` bounds replay history per session, but there is no explicit per-browser backpressure accounting or queue/drop surface.

The right production shape is:

- **Postgres as source of truth** for active bridge ownership, current attached session pointer, and lease freshness
- **Fly Machine identity** (`FLY_MACHINE_ID`, `FLY_REGION`) recorded in the lease so any relay instance can target the owner accurately
- **Same-app `fly-replay`** when a browser request hits the wrong relay instance, because Fly explicitly supports replay to a specific Machine and warns that the source instance should not negotiate the WebSocket upgrade itself
- **Fail-closed fallback behavior** using `fly-replay-failed` and/or an explicit unavailable response when the owner Machine is gone or stale
- **Ops visibility separate from routing health**: service-level readiness for traffic gating, plus independent operator endpoints/logging for lease state and queue pressure

**Primary recommendation:** Split the phase exactly along the roadmap lines:

- `05-01` creates durable ownership metadata, repositories, and the relay/browser contract around authoritative lease lookup
- `05-02` adds same-app Fly replay to the owning Machine plus scale validation for wrong-instance browser attach and bridge reconnect churn
- `05-03` adds explicit pressure accounting, bounded fanout degradation, and compact operator-facing health/ops surfaces

**UI gate default used for planning:** Continue without a dedicated `05-UI-SPEC.md`. The roadmap marks `UI hint: no`, the context locks no frontend design work, and this phase is infrastructure/ops-first despite the workflow regex seeing the word `UI`.

## Standard Stack

### Core

| Library / Platform | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| `drizzle-orm` | `0.45.2` | Add durable ownership lease schema and repositories in `packages/db` | Already the project's control-plane persistence layer. |
| `postgres` | `3.4.9` | Shared Postgres driver for relay lease reads/writes | Already used by `packages/db/src/client.ts`. |
| `fastify` | `5.8.4` | Relay HTTP routes for owner lookup, replay decisions, readyz/ops endpoints | Existing relay framework; no new server stack needed. |
| `@fastify/websocket` | `11.2.0` | Browser and bridge upgrade routes | Existing relay transport layer. |
| `zod` | `4.3.6` | Validate lease metadata, replay decision payloads, and ops response shapes | Existing trust-boundary pattern across the repo. |
| Fly.io `fly-replay` | current docs as of 2026-04-18 | Route wrong-instance browser requests to the owning Machine | Officially supports routing to a specific Machine and has explicit WebSocket handling guidance. |

### Supporting

| Library / Platform | Version | Purpose | When to Use |
|--------------------|---------|---------|-------------|
| Fly runtime env vars (`FLY_MACHINE_ID`, `FLY_REGION`, `FLY_APP_NAME`) | current docs as of 2026-04-18 | Identify the owning relay Machine and region in durable ownership rows | Use in relay startup/lease writes so replay targets are stable and observable. |
| Existing `sessionBuffer` | local code | Keep replay history bounded per session | Continue using it for history/backfill, but layer explicit per-browser pressure counters and drop logic above it. |
| Existing Fly health checks | current docs as of 2026-04-18 | Gate routing to healthy relay Machines | Keep `/readyz` for routing readiness and add separate operator observability that does not affect routing. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Durable Postgres bridge lease with current session pointer | Session-only ownership rows | Simpler schema, but weaker for session listing, reconnect gating, and owner lookup before attach. |
| Canonical public relay URL + same-app `fly-replay` | Owner-specific relay URL minted by the web app | Faster on the happy path, but brittle when ownership changes between ticket mint and browser connect. |
| Fail-closed owner refresh on stale lease | Automatic ownership takeover by a non-owning relay | Better apparent availability, but higher split-brain and cross-user attach risk. |
| Compact ops endpoints + structured logs/counters | Full operator dashboard in this phase | Richer UX, but broader scope than the locked Phase 05 decisions require. |

## Architecture Patterns

### Recommended Project Structure

```text
packages/db/src/
├── schema.ts
├── repositories/
│   ├── relay-ownership.ts
│   └── relay-ops.ts
└── index.ts

apps/relay/src/
├── ownership/
│   ├── relay-instance.ts
│   ├── ownership-service.ts
│   └── replay-routing.ts
├── browser/
│   ├── browser-registry.ts
│   ├── session-buffer.ts
│   └── session-router.ts
├── bridge/
│   └── bridge-registry.ts
└── routes/
    ├── ws-browser.ts
    ├── ws-bridge.ts
    ├── readyz.ts
    └── ops.ts

apps/web/
└── lib/live-session/server.ts
```

### Pattern 1: Durable Bridge Lease Repository

**What:** Introduce one authoritative ownership row per active bridge owner, written when a bridge registers and refreshed on heartbeat/reconnect.

**When to use:** Every browser attach/control request and every bridge connect/disconnect path.

**Recommended fields:**

```ts
{
  userId: string;
  deviceSessionId: string;
  bridgeInstanceId: string;
  relayMachineId: string;
  relayRegion: string;
  attachedSessionId: string | null;
  leaseVersion: number;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  expiresAt: Date;
  disconnectedAt: Date | null;
}
```

**Why:** This directly satisfies `SEC-04` and `OPS-02` while preserving the Phase 02 single-attach rule.

### Pattern 2: Wrong-Instance Replay Before WebSocket Upgrade

**What:** On `/ws/browser`, validate the ticket and resolve the authoritative owner **before** upgrading locally. If the current Machine is not the owner, return a Fly replay response targeting the owning Machine.

**Why this matters:** Fly's docs explicitly say the source instance returning `fly-replay` should not negotiate the WebSocket upgrade itself; the instance receiving the replay should handle the upgrade.

**Recommended flow:**

1. Browser connects to canonical public relay URL
2. Relay authenticates short-lived ticket
3. Relay loads ownership lease from Postgres
4. If current `FLY_MACHINE_ID` matches lease owner, continue locally
5. If not, respond with replay to the owning Machine using `instance={relayMachineId}` and a short timeout/fallback
6. If replay fails or no candidate exists, return explicit unavailable/retry semantics and log the failure

### Pattern 3: Fail-Closed Stale Lease Recovery

**What:** If the lease is stale, missing, or points to a dead owner, do not auto-adopt ownership from the browser path. Require the bridge to refresh or reconnect first.

**When to use:** Browser attach, session list, prompt/steer/interrupt forwarding, and reconnect.

**Why:** Phase 04 already locked the product into fail-closed ownership semantics. The browser path is the least trustworthy place to trigger lease takeover.

### Pattern 4: Routing Health vs Operator Observability

**What:** Keep `/readyz` focused on whether the Machine should receive new traffic, and expose separate ops state for ownership and pressure.

**Fly guidance:** Service-level checks affect routing; top-level checks are better for internal monitoring and do not affect routing.

**Recommended surface:**
- `/readyz`: traffic admission signal, possibly degraded by local queue pressure or inability to serve owner traffic
- `/ops/relay`: JSON snapshot of active leases owned locally, replay failures, disconnect reasons, queue/drop counters, and stale lease counts
- Structured logs on replay decisions, `fly-replay-failed`, and queue/drop events

### Pattern 5: Per-Browser Pressure Accounting Above Shared Replay Buffer

**What:** The shared `sessionBuffer` can remain the bounded replay/history store, but live fanout should add explicit counters and drop policy per browser socket.

**Recommended priorities:**
1. session attach/ended/error/control acks
2. approval and security/trust events
3. activity summaries / turn state transitions
4. replayable low-priority live detail

**Why:** `sessionBuffer` already caps replay history to 200 events per session, but `browserRegistry.broadcast()` currently sends directly with no pressure telemetry or drop classification.

## Key Findings and Pitfalls

### Critical Gaps

1. **Ownership is still keyed to one process.**  
   `apps/relay/src/bridge/bridge-registry.ts` stores the active bridge in a `Map` keyed by `userId`. Any non-owning relay instance will believe no bridge exists for that user.

2. **Browser listing/forwarding assumes local ownership.**  
   `apps/relay/src/browser/session-router.ts` calls `bridgeRegistry.has()` and `bridgeRegistry.sendTo()` directly. This means wrong-instance browser requests silently degrade to "unavailable" instead of rerouting.

3. **The browser connect contract has no topology awareness.**  
   `apps/web/lib/live-session/server.ts` and `apps/web/app/api/sessions/[sessionId]/connect/route.ts` always return one relay URL and a short-lived ticket. This is fine only if the relay layer owns routing decisions.

4. **Bridge reconnect is already available and should drive lease refresh.**  
   `apps/bridge/src/daemon/relay-connection.ts` reconnects automatically and re-sends `bridge.register` on every successful open. This is the right place to refresh durable ownership instead of inventing a second ownership-claim path.

5. **Readiness is not ownership-aware yet.**  
   `apps/relay/src/routes/readyz.ts` always returns `"ready"`, even though comments already reserve it for ownership-aware and pressure-aware gating.

6. **Replay history is bounded, but live pressure is not surfaced.**  
   `apps/relay/src/browser/session-buffer.ts` caps replay history to 200 events per session, but there is no operator-visible queue depth/drop accounting and no differentiated degradation policy for live fanout.

### Fly-Specific Findings

1. **Fly can replay to a specific Machine.**  
   The official `fly-replay` docs support `instance` and `prefer_instance`, which is exactly what a durable ownership record needs.

2. **Fly adds replay trace headers.**  
   `fly-replay-src` captures the source instance/region/state, and `fly-replay-failed` captures target instance/app/region plus failure reason. These are valuable for audit and operator logs.

3. **The source instance should not upgrade the WebSocket if it intends to replay.**  
   Fly explicitly warns that the instance returning `fly-replay` should not negotiate the WebSocket upgrade itself. This strongly favors resolving ownership before upgrade handling becomes local state.

4. **Cross-region routing does not happen just because a local region is busy.**  
   Fly only shifts cross-region when local Machines are unhealthy or at hard limit. That means owner-aware replay remains necessary even when multiple healthy relay Machines exist.

5. **Service-level checks affect routing; top-level checks do not.**  
   This lines up with keeping `/readyz` for routing and putting broader ownership/pressure introspection on separate endpoints/checks.

### Consequences for Planning

- `05-01` should create the durable ownership schema and repository first, before any Fly replay work.
- `05-02` should wire same-app replay on browser requests before local WebSocket upgrade handling, then validate wrong-instance and stale-owner flows with tests.
- `05-03` should not just "add metrics"; it needs explicit pressure semantics, replay-failure accounting, and operator-readable ownership state.

## Recommended Wave Split

| Wave | Plans | Why |
|------|-------|-----|
| 1 | `05-01` | Durable lease metadata and routing contract are prerequisites for every later plan. |
| 2 | `05-02` | Once ownership is authoritative, Fly-aware replay and scale validation can be implemented safely. |
| 3 | `05-03` | Pressure guards and ops visibility should be layered on top of the new routing model, not guessed ahead of it. |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `2.1.8` + existing relay WebSocket integration tests |
| Config file | `vitest.workspace.ts` |
| Quick run command | `vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts` |
| Full phase suite command | `npm run typecheck && vitest run apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-04 | Browser attach/control rejects wrong-user or stale/missing owner leases and never crosses bridge ownership boundaries | relay unit + ws integration | `vitest run apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/session-router-safety.test.ts` | partial |
| OPS-02 | Multiple relay instances can resolve ownership from durable storage without one shared in-memory coordinator | repository + relay unit | `vitest run packages/db/tests/relay-ownership.test.ts apps/relay/tests/unit/ownership-service.test.ts` | no - Wave 0 |
| OPS-03 | Wrong-instance browser requests replay to the owner Machine or fail with explicit unavailable semantics | relay unit/integration | `vitest run apps/relay/tests/unit/ws-browser-replay.test.ts apps/relay/tests/unit/ownership-service.test.ts` | no - Wave 0 |
| OPS-04 | Operators can inspect lease state, disconnect reasons, replay failures, queue depth, and drop counts | relay route/unit | `vitest run apps/relay/tests/unit/ops-route.test.ts apps/relay/tests/unit/readyz.test.ts` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** targeted Vitest for touched relay/db tests
- **Per plan completion:** full relay/db Phase 05 suite plus `npm run typecheck`
- **Phase gate:** manual multi-instance smoke on Fly or a local ownership-replay harness proving wrong-instance browser attach, owner loss, and bounded pressure behavior

### Wave 0 Gaps

- [ ] `packages/db/tests/relay-ownership.test.ts` for lease create/refresh/replace/expire semantics
- [ ] `apps/relay/tests/unit/ownership-service.test.ts` for owner lookup, stale detection, and fail-closed decisions
- [ ] `apps/relay/tests/unit/ws-browser-replay.test.ts` for wrong-instance replay response generation before WebSocket upgrade
- [ ] `apps/relay/tests/unit/ops-route.test.ts` for lease/pressure/disconnect JSON snapshot behavior
- [ ] `apps/relay/tests/unit/readyz.test.ts` for ownership/pressure-aware readiness behavior
- [ ] `apps/bridge/tests/unit/relay-connection.test.ts` for reconnect-driven lease refresh behavior

## Sources

### Primary (HIGH confidence)
- Local repo: `.planning/phases/05-multi-instance-routing-production-hardening/05-CONTEXT.md` — locked Phase 05 decisions
- Local repo: `.planning/ROADMAP.md` — authoritative phase split and success criteria
- Local repo: `.planning/REQUIREMENTS.md` — authoritative requirement IDs for Phase 05
- Local repo: `docs/adr/0001-phase-1-trust-boundary.md` — binding trust-boundary rules preserved by Phase 05
- Local repo: `packages/db/src/client.ts` and `packages/db/src/schema.ts` — existing persistence layer and current durable tables
- Local repo: `apps/relay/src/bridge/bridge-registry.ts` — current single-process ownership implementation
- Local repo: `apps/relay/src/browser/session-router.ts` — current browser attach/list/control behavior
- Local repo: `apps/relay/src/browser/session-buffer.ts` — current bounded replay history behavior
- Local repo: `apps/relay/src/routes/ws-browser.ts` — browser ingress path
- Local repo: `apps/relay/src/routes/ws-bridge.ts` — bridge registration/disconnect path
- Local repo: `apps/relay/src/routes/readyz.ts` — readiness seam reserved for ownership/pressure gating
- Local repo: `apps/bridge/src/daemon/relay-connection.ts` — reconnect + repeated `bridge.register` behavior
- Local repo: `apps/web/lib/live-session/server.ts` and `apps/web/app/api/sessions/[sessionId]/connect/route.ts` — canonical browser connect contract
- Fly Docs: `https://fly.io/docs/networking/dynamic-request-routing/` — `fly-replay` to specific Machines, replay trace/failure headers, and WebSocket upgrade guidance
- Fly Docs: `https://www.fly.io/docs/machines/runtime-environment/` — `FLY_MACHINE_ID`, `FLY_ALLOC_ID`, `FLY_REGION`, and `FLY_APP_NAME` runtime identity
- Fly Docs: `https://fly.io/docs/reference/health-checks/` — distinction between service-level routing checks and top-level observability checks
- Fly Docs: `https://fly.io/docs/reference/load-balancing/` — hard-limit routing behavior and why cross-region load balancing alone does not solve ownership routing

### Secondary (MEDIUM confidence)
- Local repo: `apps/relay/tests/unit/ws-bridge.test.ts` — confirms current bridge registration assumptions
- Local repo: `apps/relay/tests/unit/ws-browser-reconnect.test.ts` — confirms current reconnect safety behavior
- Local repo: `apps/relay/tests/unit/session-router-safety.test.ts` — confirms shell-like commands remain rejected at the relay boundary
