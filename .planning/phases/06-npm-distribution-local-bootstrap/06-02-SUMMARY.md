---
phase: 06-npm-distribution-local-bootstrap
plan: 02
subsystem: auth
tags: [pairing, bootstrap, postgres, xdg, ws-ticket]
requires:
  - phase: 06-npm-distribution-local-bootstrap
    plan: 01
    provides: publishable `handoff` package and working workspace build baseline
provides:
  - durable bridge-installation storage and repository helpers
  - pairing-confirm bootstrap token issuance
  - hosted `/api/bridge/connect-ticket` exchange route
  - XDG-backed local config, credentials, and daemon metadata files
affects: [06-03, 07-codex-native-handoff-command, bridge-startup]
tech-stack:
  added: []
  patterns:
    - pairing confirmation now returns a one-time bridge bootstrap credential
    - local bridge state is split between config.json, credentials.json, and daemon.json with restrictive file modes
key-files:
  created:
    - packages/db/src/repositories/bridge-installations.ts
    - apps/web/app/api/bridge/connect-ticket/route.ts
    - apps/bridge/src/lib/local-state.ts
    - apps/bridge/tests/unit/local-state.test.ts
    - apps/bridge/tests/unit/bootstrap-client.test.ts
    - apps/web/tests/unit/bridge-connect-ticket-route.test.ts
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/index.ts
    - packages/protocol/src/pairing.ts
    - apps/web/lib/pairing-service.ts
    - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
    - apps/bridge/src/lib/pairing-client.ts
    - apps/bridge/src/cli/pair.ts
key-decisions:
  - "The CLI immediately exchanges the one-time bootstrap token for a hosted connect-ticket so it can persist the real relay URL in local config instead of guessing deployment topology."
  - "Bridge bootstrap data is stored as split config and credentials files, keeping the opaque bootstrap token separate from operator-readable runtime metadata."
  - "Pairing state now syncs into Postgres when DATABASE_URL is present so bridge-installation rows can safely reference durable pairing ids."
patterns-established:
  - "Bootstrap pattern: pairing confirmation mints a one-time bridge bootstrap token, while connect tickets remain hosted, short-lived, and re-minted on demand."
  - "State pattern: XDG config and state directories are created with 0o700, and JSON files are written at 0o600."
requirements-completed: [DIST-03]
completed: 2026-04-19
---

# Phase 06-02 Summary

**Pairing confirmation now produces a durable bridge-installation identity and one-time bootstrap token, the hosted app exchanges that token for short-lived bridge connect tickets, and the CLI persists the install-safe bootstrap state under XDG-managed local files.**

## Accomplishments

- Added the `bridge_installations` control-plane model plus repository helpers for create, lookup, last-used touch, and revocation.
- Extended the pairing confirmation contract to return `bridgeInstallationId` and `bridgeBootstrapToken`, then added `POST /api/bridge/connect-ticket` to mint hosted bridge ws-tickets from that bootstrap identity.
- Added XDG-backed local bootstrap persistence and updated `handoff pair` to save `baseUrl`, `relayUrl`, `bridgeInstallationId`, `bridgeInstanceId`, and the opaque bootstrap token after successful confirmation.

## Verification

- `npx vitest run apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts`
- `npm run build --workspace @codex-mobile/protocol`
- `npm run build --workspace @codex-mobile/db`
- `npm run typecheck --workspace @codex-mobile/web`
- `npm run typecheck --workspace handoff`

## Deviations from Plan

### Auto-fixed Integration Gaps

1. Added minimal Postgres sync for pairing rows inside the hosted pairing service because the new `bridge_installations.pairing_id` foreign key needed a durable pairing row at runtime, not just the existing in-memory pairing store.
2. Relaxed the `relay_bridge_leases.device_session_id` foreign key because bridge ws-tickets now carry bridge-installation ids through the existing ticket subject field, and the old device-session-only constraint would have rejected valid bridge leases.

---
*Phase: 06-npm-distribution-local-bootstrap*
*Completed: 2026-04-19*
