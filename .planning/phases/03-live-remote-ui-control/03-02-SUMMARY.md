---
phase: 03-live-remote-ui-control
plan: 02
subsystem: transport
tags: [relay, websocket, protocol, nextjs, vitest]
dependency_graph:
  requires:
    - phase: 03-live-remote-ui-control
      plan: 01
      provides: mobile session shell, reducer contract, and typed activity cards
    - phase: 02-bridge-codex-session-adapter
      plan: 01
      provides: outbound bridge connection and ws-ticket bridge registration
  provides:
    - browser-safe live session protocol contracts
    - relay browser websocket route with replay rejection and reconnect buffer
    - auth-gated session list/connect/command web routes
    - unit coverage for relay auth replay and session connect payload safety
  affects:
    - packages/protocol/src/live-session.ts
    - packages/protocol/src/bridge.ts
    - apps/relay/src/browser/*
    - apps/relay/src/routes/ws-browser.ts
    - apps/web/app/api/sessions/*
    - apps/web/lib/live-session/server.ts
    - apps/relay/tests/unit/ws-browser.test.ts
    - apps/web/tests/unit/session-connect-route.test.ts
tech_stack:
  added: []
  patterns:
    - short-lived ws-ticket reuse for relay internal HTTP and browser websocket bootstrap
    - single-instance in-memory browser registry plus bounded session replay buffer
    - same-origin web route that mints connect payloads without URL credential transport
key_files:
  created:
    - packages/protocol/src/live-session.ts
    - apps/relay/src/browser/browser-registry.ts
    - apps/relay/src/browser/session-buffer.ts
    - apps/relay/src/browser/session-router.ts
    - apps/relay/src/routes/ws-browser.ts
    - apps/web/lib/live-session/server.ts
    - apps/web/app/api/sessions/route.ts
    - apps/web/app/api/sessions/[sessionId]/connect/route.ts
    - apps/web/app/api/sessions/[sessionId]/command/route.ts
    - apps/relay/tests/unit/ws-browser.test.ts
    - apps/web/tests/unit/session-connect-route.test.ts
  modified:
    - packages/protocol/src/bridge.ts
    - packages/protocol/src/index.ts
    - packages/protocol/package.json
    - apps/relay/package.json
    - apps/relay/src/bridge/bridge-registry.ts
    - apps/relay/src/routes/ws-bridge.ts
    - apps/relay/src/server.ts
    - package.json
    - packages/db/package.json
decisions:
  - "Use the same short-lived ws-ticket primitive for browser websocket upgrades and server-to-relay internal HTTP so the web app never forwards long-lived cookies beyond its own boundary."
  - "Keep browser socket ownership and replay state single-instance and in-memory for Phase 3; durable relay ownership routing remains explicit Phase 5 work."
  - "Expose prompt, steer, approval, and interrupt as structured session commands first, then let 03-03 consume them from the actual mobile shell."
metrics:
  duration_seconds: 980
  completed: 2026-04-18T07:38:00Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 11
  files_modified: 9
requirements:
  - LIVE-01
  - SESS-04
  - SESS-05
---

# Phase 03 Plan 02: Live Browser Transport & Control Summary

Added the browser-live protocol, relay-side browser transport, auth-gated session bootstrap routes, and unit coverage for ws-ticket replay and connect payload safety.

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Add typed browser live-session contracts and explicit interrupt semantics | 09c5ce0 | Added `@codex-mobile/protocol/live-session`, explicit cursored live events, typed prompt/steer/approval/interrupt commands, and bridge schema extensions for history/event/interrupt traffic |
| 2 | Add the relay browser WebSocket route, ownership router, and reconnect buffer | 3a0b096 | Added browser socket registry, bounded replay buffer, relay session router, browser websocket route, bridge message fanout, and relay websocket dependency declaration |
| 3 | Add authenticated web routes for session listing, connect boot, and structured commands with unit coverage | a6fb513 | Added auth-gated `/api/sessions` routes, same-origin relay bootstrap helper, relay and web unit tests, and repaired the broken `drizzle-kit` pin so the workspace could install and execute verification |

## Decisions Made

1. **Ticket reuse at the trust boundary:** The web app now mints one-off ws-tickets both for browser websocket bootstrap and for server-to-relay internal HTTP requests. That keeps `cm_device_session` and `cm_web_session` confined to `apps/web` while still giving the relay an auditable short-lived credential.

2. **Single-instance relay state for now:** Browser sockets, replay buffers, and bridge ownership all live in-memory inside the relay process. This is intentionally limited to the current single-instance trust model; Phase 5 still owns durable ownership routing across multiple Fly.io relay instances.

3. **Transport before shell integration:** The session shell remains fixture-backed after 03-02. The transport, routes, and command contracts are ready, but 03-03 still has to wire the browser shell onto `connectLiveSession` and expose reconnect, approval, and interrupt affordances in-context.

## Deviations from Plan

None in scope. The only extra repo change was updating the broken `drizzle-kit` dev-tool pin so dependency installation and Vitest verification could run at all.

## Issues Encountered

- `npm install` was blocked by `drizzle-kit@0.45.2`, which is no longer published. The workspace pin was updated to `0.31.10` in the root and `packages/db` package so the repo could install and the 03-02 validation slice could execute.

## Verification

- `npx vitest run --project phase-01-unit apps/web/tests/unit/live-session-reducer.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/web/tests/unit/session-connect-route.test.ts`

## Next Phase Readiness

- The mobile shell now has a real connect payload contract, structured live event schema, and tested relay/browser auth path to build against.
- `03-03` can focus on wiring the client reducer to live transport, reconnect backfill, approval cards, and mobile interaction polish instead of inventing transport semantics mid-UI pass.

## Self-Check

- Protocol, relay, and web route artifacts listed in the plan exist on disk.
- Task commits for protocol, relay transport, and session bootstrap/tests are present in git history.
- The targeted Phase 3 Vitest slice executed successfully after repairing the stale install pin.

---
*Phase: 03-live-remote-ui-control*
*Completed: 2026-04-18*
