# Phase 5: Multi-Instance Routing & Production Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `05-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 5 - Multi-Instance Routing & Production Hardening
**Areas discussed:** Ownership Source Of Truth, Browser Routing Contract, Stale / Unauthorized Attach Handling, Operator Visibility And Pressure Guards

---

## Ownership Source Of Truth

| Option | Description | Selected |
|--------|-------------|----------|
| Bridge lease in Postgres | One durable ownership lease per active bridge connection, queryable by any relay instance. | ✓ |
| Session-only ownership rows | Track ownership only when a specific session is attached. | |
| Fly stickiness as the main owner mechanism | Depend mostly on routing/stickiness and keep ownership minimally durable. | |

**User's choice:** Bridge lease in Postgres.
**Notes:** Follow-up decision: the durable row should represent the bridge owner plus an optional current attached session pointer, not session-only ownership and not separate bridge/session ownership tables.

---

## Browser Routing Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical public relay URL + owner-aware replay at the relay | Keep one stable browser relay URL and let the relay route/replay wrong-instance requests to the owning relay instance. | ✓ |
| Web app returns an owner-specific relay URL up front | Resolve ownership before connect and hand the browser an instance-specific URL. | |
| Best-effort sticky routing with no explicit owner replay | Rely on stickiness rather than explicit ownership routing. | |

**User's choice:** Canonical public relay URL with owner-aware replay at the relay.
**Notes:** The browser contract should stay stable; relay topology remains a hosted control-plane concern rather than a client concern.

---

## Stale / Unauthorized Attach Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Fail closed, then attempt bounded recovery | Reject unsafe attach/control immediately and allow only a narrow safe recovery path. | ✓ |
| Auto-reassign ownership to the current relay when the old owner looks dead | Prefer faster recovery even if ownership authority is ambiguous. | |
| Hard fail only | Reject and force all recovery to be manual. | |

**User's choice:** Fail closed, then attempt bounded recovery.
**Notes:** Follow-up decision: recovery should require fresh bridge ownership refresh before the browser can continue. The preferred first behavior is explicit unavailable/retry state, not server-side auto-adoption by another relay.

---

## Operator Visibility And Pressure Guards

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal but complete ops surface | Expose compact operator-facing health, ownership, disconnect, and pressure visibility without building a dashboard product. | ✓ |
| Metrics/logging only | Ship telemetry but no explicit ownership inspection surface. | |
| Rich operator console | Build a more complete operator UI in this phase. | |

**User's choice:** Minimal but complete ops surface.
**Notes:** Follow-up decision: queue/backpressure handling should use bounded queues and degrade non-critical live detail first, while keeping ownership/control-critical messages and terminal end states reliable.

---

## the agent's Discretion

- Exact schema/repository layout for durable ownership records
- Lease heartbeat cadence and stale-owner timeout tuning
- Exact format of the compact operator-facing surface, provided it exposes lease state, disconnect reasons, and pressure counters

## Deferred Ideas

- Rich operator console/dashboard UX beyond compact APIs, metrics, and structured logs
- Any broader multi-session or collaboration model beyond the current single active remote-controlled session semantics
