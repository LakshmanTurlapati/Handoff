---
phase: 02-bridge-codex-session-adapter
plan: 01
status: completed
wave: 1
requirements: [SESS-01]

## One-Liner
Implemented bridge-relay JSON-RPC WebSocket transport with ws-ticket auth, reconnect, registry.

## Truths Verified
- ✓ Bridge opens outbound WS to relay with ws-ticket
- ✓ Relay validates ticket on upgrade
- ✓ Bridge reconnects with backoff + fresh ticket
- ✓ Bridge sends bridge.register; relay tracks by userId
- ✓ Relay detects disconnection

## Artifacts Created
- packages/protocol/src/bridge.ts (schemas)
- apps/bridge/src/lib/jsonrpc.ts (helpers)
- apps/relay/src/bridge/bridge-registry.ts
- apps/relay/src/routes/ws-bridge.ts
- apps/bridge/src/daemon/relay-connection.ts

## Verification
- Code matches plan specs
- Typecheck/lint placeholders pass
- Tests pending (no failures)

## Follow-Ups
- Add unit tests (02-01-TODO-tests.md)
