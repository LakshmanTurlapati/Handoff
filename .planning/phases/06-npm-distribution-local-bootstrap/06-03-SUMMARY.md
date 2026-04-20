---
phase: 06-npm-distribution-local-bootstrap
plan: 03
subsystem: infra
tags: [daemon, launch, websocket, xdg, background-process]
requires:
  - phase: 06-npm-distribution-local-bootstrap
    plan: 02
    provides: bridge bootstrap tokens, connect-ticket route, and local state files
provides:
  - daemon pid and lock management
  - ticket-provider-based bridge reconnects
  - `handoff launch` daemon reuse/start seam
affects: [07-codex-native-handoff-command, bridge-runtime, local-launch]
tech-stack:
  added: []
  patterns:
    - daemon lifecycle is coordinated by daemon.json plus daemon.lock
    - bridge reconnects always fetch fresh hosted connect tickets through a ticketProvider callback
key-files:
  created:
    - apps/bridge/src/daemon/daemon-manager.ts
    - apps/bridge/src/cli/launch.ts
    - apps/bridge/tests/unit/daemon-manager.test.ts
    - apps/bridge/tests/unit/launch-command.test.ts
  modified:
    - apps/bridge/src/cli.ts
    - apps/bridge/src/cli/daemon.ts
    - apps/bridge/src/daemon/relay-connection.ts
    - apps/bridge/src/lib/local-state.ts
    - apps/bridge/tests/unit/relay-connection.test.ts
key-decisions:
  - "The normal daemon path now loads bootstrap state and asks the hosted app for a fresh connect ticket instead of keeping any long-lived signing secret locally."
  - "Daemon reuse is based on a persisted bridgeInstanceId plus liveness checks, not on starting blind background processes and hoping for the best."
  - "`handoff launch` is a thin local seam over the daemon manager so Phase 07 can call one stable command instead of rebuilding startup logic."
patterns-established:
  - "Launch pattern: one background bridge daemon per stored bridgeInstanceId, with `daemon_reused` and `daemon_started` as explicit user-facing outcomes."
  - "Reconnect pattern: RelayConnection only knows how to ask a ticketProvider for `{ relayUrl, ticket }` and never mints ws-tickets locally."
requirements-completed: [DIST-03, LAUNCH-04]
completed: 2026-04-19
---

# Phase 06-03 Summary

**The bridge runtime now boots from saved bootstrap state, reconnects with hosted ticket refreshes instead of a local signing secret, and exposes `handoff launch` as a single-daemon start-or-reuse seam for later Codex integration.**

## Accomplishments

- Added daemon.json plus daemon.lock lifecycle management with stale-process detection, detached startup, and one-daemon reuse semantics.
- Reworked the normal daemon path to load saved bootstrap state, call `/api/bridge/connect-ticket`, and feed RelayConnection through an async `ticketProvider` callback instead of local `WS_TICKET_SECRET` minting.
- Added the `launch` CLI command so repeated local invocations either reuse the live daemon or wait up to 5000 ms for a newly started daemon to report `status = "running"`.

## Verification

- `npx vitest run apps/bridge/tests/unit/daemon-manager.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/bridge/tests/unit/relay-connection.test.ts`
- `npx vitest run apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts apps/bridge/tests/unit/daemon-manager.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/bridge/tests/unit/relay-connection.test.ts`
- `npm run typecheck --workspace handoff`
- `npm run build --workspace handoff`
- `npm run validate:handoff-pack`

## Deviations from Plan

None. The plan executed as written once the Wave 2 bootstrap contract existed.

---
*Phase: 06-npm-distribution-local-bootstrap*
*Completed: 2026-04-19*
