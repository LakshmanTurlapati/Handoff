# Phase 5: Multi-Instance Routing & Production Hardening - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the hosted relay architecture operationally credible beyond a single instance by persisting bridge ownership, routing browser traffic to the owning relay on Fly.io, rejecting unsafe cross-instance attach attempts, and exposing enough operational state to diagnose pressure and disconnect failures.

**Scope anchor:** This phase hardens the hosted web/relay control plane for multi-instance deployment. It covers durable ownership leases, owner-aware routing/replay, stale-owner failure and recovery rules, and compact operator-facing health/pressure visibility. It does not add cloud-hosted Codex execution, multi-user collaboration, a general-purpose remote shell, or a rich operator dashboard product.

</domain>

<decisions>
## Implementation Decisions

### Durable Ownership Model
- **D-01:** Relay ownership becomes a durable Postgres-backed lease instead of remaining process-local memory. Phase 5 must introduce an authoritative ownership record that any relay instance can query before listing sessions, attaching browsers, or forwarding control.
- **D-02:** The durable ownership model is one active bridge-owner row per connected bridge/device owner, with an optional current `sessionId` pointer rather than separate session-only ownership rows. This preserves the existing single active remote-controlled session rule from Phase 2.
- **D-03:** The ownership row must be rich enough to support safe replacement and stale-owner detection. At minimum it should capture `userId`, `deviceSessionId`, `bridgeInstanceId`, `relayInstanceId`, lease/heartbeat timing, and the currently attached session metadata needed to decide whether a browser is allowed to continue.

### Browser Routing Contract
- **D-04:** The browser-facing connect contract stays stable: `apps/web` continues to return one canonical public relay URL rather than per-instance relay URLs.
- **D-05:** Owner-aware routing happens inside the relay layer. If a browser lands on a non-owning relay instance, that relay is responsible for resolving ownership and replaying/rerouting the request to the owning Fly relay instance.

### Stale Ownership and Attach Safety
- **D-06:** Missing, stale, conflicting, or unauthorized ownership must fail closed for attach and control operations. Phase 5 must not silently reassign ownership or allow cross-instance takeover when authority is unclear.
- **D-07:** Recovery after stale ownership starts with bridge refresh, not opportunistic browser-side takeover. The browser should receive an explicit unavailable/retry state, and safe continuation resumes only after the bridge re-registers or refreshes its ownership lease.

### Operator Visibility and Pressure Guards
- **D-08:** Phase 5 guarantees a minimal but complete operator surface: structured visibility into relay instance health, active ownership leases, disconnect reasons, and queue/backpressure counters. This is an operator-facing API/logging/metrics shape, not a full dashboard product.
- **D-09:** Relay fanout must use bounded queues with controlled degradation. Ownership/control-critical messages and terminal end states stay reliable first; replayable or lower-priority live detail may be compacted or dropped under pressure, and that degradation must be observable.

### the agent's Discretion
- The exact table names, repository boundaries, and lease heartbeat cadence, as long as the ownership source of truth is durable, replace-safe, and queryable by any relay instance.
- The exact Fly.io replay mechanism and relay-instance identity plumbing, as long as the browser contract stays canonical and wrong-instance requests reach the owner instance safely.
- The concrete shape of the operator-facing surface, whether it is delivered as JSON health/ops endpoints, metrics exporters, structured logs, or a combination, as long as lease state, disconnect reasons, and pressure counters are inspectable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Phase Requirements
- `.planning/ROADMAP.md` §Phase 5 — the authoritative goal, success criteria, and plan split for ownership metadata, Fly-aware routing, and production hardening.
- `.planning/PROJECT.md` — the product boundary, outbound-only bridge rule, and explicit decision to scale on Fly.io using relay ownership rather than a single sticky node.
- `.planning/REQUIREMENTS.md` — requirements `SEC-04`, `OPS-02`, `OPS-03`, and `OPS-04`, which Phase 5 must satisfy without broadening the trust boundary.

### Locked Prior Decisions
- `.planning/phases/02-bridge-codex-session-adapter/02-CONTEXT.md` — preserves the bridge/session ownership model, including `D-12` that only one remote-controlled session may be attached per bridge instance at a time.
- `.planning/phases/03-live-remote-ui-control/03-02-SUMMARY.md` — explicitly records that browser sockets, replay buffers, and bridge ownership stayed single-instance and in-memory in Phase 3, leaving durable ownership routing to Phase 5.
- `.planning/phases/04-approval-audit-device-safety/04-CONTEXT.md` — carries forward fail-closed reconnect and ownership rules, durable device-session validation, and the prohibition on widening the product into shell-like remote access.

### Trust Boundary and Phase 5 Research
- `docs/adr/0001-phase-1-trust-boundary.md` — trust-zone rules, short-lived ticket constraints, and the requirement that later phases preserve the browser -> relay -> outbound bridge -> local Codex boundary.
- `.planning/research/PITFALLS.md` — Phase 5-specific warnings about keeping ownership in memory, assuming any Fly instance can serve any browser connection, and leaving event queues unbounded.
- `.planning/research/SUMMARY.md` — project-level research that names relay ownership routing, Fly-aware request routing, observability, and backpressure handling as the Phase 5 deliverable set.
- `.planning/research/ARCHITECTURE.md` — recommended live flow where the relay resolves the bridge owner before attaching a browser and routes control through the owning worker.

### Current Implementation Seams
- `apps/relay/src/bridge/bridge-registry.ts` — current single-process ownership registry keyed only in memory by `userId`; Phase 5 must replace or subordinate this to durable ownership.
- `apps/relay/src/browser/session-router.ts` — current browser attach/list/forward behavior and the existing bounded session buffer, which must become ownership-aware across instances.
- `apps/relay/src/routes/ws-bridge.ts` — bridge registration and disconnect flow where durable ownership leases and lease refresh/replacement semantics will need to land.
- `apps/relay/src/routes/ws-browser.ts` — browser WebSocket auth and attach path that currently assumes local ownership and will need wrong-instance replay plus stale-owner rejection behavior.
- `apps/relay/src/routes/readyz.ts` — existing readiness seam explicitly reserved for ownership-aware and queue-pressure-aware gating.
- `apps/relay/fly.toml` — Fly deployment and readiness/liveness wiring that Phase 5 must extend rather than replace.
- `apps/web/lib/live-session/server.ts` — current relay URL resolution and ticket-minting path that currently assumes one relay entrypoint.
- `apps/web/app/api/sessions/[sessionId]/connect/route.ts` — browser connect contract that should remain canonical while Phase 5 moves ownership routing into the relay layer.
- `apps/bridge/src/daemon/relay-connection.ts` — bridge connection/reconnect loop and `bridge.register` notification path that must participate in durable lease refresh behavior.
- `packages/db/src/schema.ts` — current durable control-plane tables; Phase 5 will need new ownership metadata rather than more process-local state.
- `packages/auth/src/ws-ticket.ts` — short-lived single-use browser/bridge ticket rules that still constrain the multi-instance routing design.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/relay/src/browser/session-router.ts` already contains the browser attach/list/forward orchestration and a bounded replay buffer. Phase 5 should extend this path with durable ownership lookup instead of inventing a second browser session router.
- `apps/relay/src/routes/ws-browser.ts` and `apps/relay/src/routes/ws-bridge.ts` already own the authenticated ingress points for browser and bridge traffic. They are the natural seams for ownership lookup, wrong-instance replay, and lease registration/refresh.
- `apps/relay/src/routes/readyz.ts` and `apps/relay/fly.toml` already separate readiness from liveness, which gives Phase 5 a prepared place to surface ownership/pressure-aware readiness without changing Fly health-check URLs.
- `apps/web/lib/live-session/server.ts` and `apps/web/app/api/sessions/[sessionId]/connect/route.ts` already mint short-lived relay tickets and return the browser connect payload; Phase 5 should preserve that contract while shifting topology awareness to the relay layer.
- `apps/bridge/src/daemon/relay-connection.ts` already performs reconnect with `bridge.register` on each successful open. That existing loop can refresh durable ownership instead of requiring a new bridge transport.

### Established Patterns
- Runtime contracts across web, relay, and bridge are validated with shared zod schemas rather than ad hoc JSON.
- Security-sensitive authorization in `apps/web` and `apps/relay` already prefers durable row validation and fail-closed outcomes when user/device ownership is unclear.
- Relay readiness and liveness are intentionally split, with comments in code and Fly config that already reserve readiness for ownership and queue-pressure gating.
- The browser connect payload is currently a stable canonical relay URL plus short-lived ticket. Changing that browser contract would ripple through web, tests, and transport handling.
- The relay already uses bounded in-memory replay for session history, which means Phase 5 should extend pressure handling by prioritizing critical event classes instead of inventing an unlimited durable event stream.

### Integration Points
- Add durable ownership storage and repositories under `packages/db`, then thread those reads/writes into relay attach/list/forward paths.
- Wire lease creation, refresh, replacement, and disconnect cleanup through `apps/relay/src/routes/ws-bridge.ts` and the bridge reconnect lifecycle in `apps/bridge/src/daemon/relay-connection.ts`.
- Add wrong-instance ownership resolution and replay logic in `apps/relay/src/routes/ws-browser.ts`, with `apps/relay/src/browser/session-router.ts` consuming authoritative ownership data before forwarding commands.
- Extend `apps/relay/src/routes/readyz.ts` and adjacent ops surfaces with ownership-state and backpressure counters so operators can see whether a relay should take new traffic.
- Preserve the canonical browser connect contract in `apps/web/lib/live-session/server.ts` and `apps/web/app/api/sessions/[sessionId]/connect/route.ts` while ensuring the relay layer resolves owner topology safely.

</code_context>

<specifics>
## Specific Ideas

- Hide relay topology from the browser. The phone client should keep talking to one stable public relay entrypoint, with owner-instance routing treated as hosted control-plane behavior.
- Treat stale or conflicting ownership as a trust problem first and an availability problem second. Safe recovery starts only after the bridge refreshes ownership.
- Keep the operator deliverable compact. The goal is enough ownership/health/pressure visibility to debug production incidents, not a polished operator dashboard in this phase.
- Preserve the existing single active remote-controlled session per bridge while making ownership durable and cross-instance queryable.

</specifics>

<deferred>
## Deferred Ideas

- Rich operator console or dashboard UX beyond compact APIs, structured logs, and metrics.
- Any broader multi-session or multi-user collaboration model beyond the current single active remote-controlled session semantics per bridge owner.

</deferred>

---

*Phase: 05-multi-instance-routing-production-hardening*
*Context gathered: 2026-04-18*
