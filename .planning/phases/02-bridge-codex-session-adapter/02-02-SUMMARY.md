---
phase: 02-bridge-codex-session-adapter
plan: 02
status: completed
wave: 2
requirements: [SESS-02, SESS-03, SEC-02]
---

## One-Liner
Added the local `codex app-server` stdio adapter plus a bridge-side event normalizer so Phase 2 can load real Codex threads, replay history, and preserve approval-aware live activity.

## Truths Verified
- ✓ Bridge spawns `codex app-server` over stdio and completes the required `initialize` -> `initialized` handshake
- ✓ Bridge can issue `thread/list`, `thread/resume`, and `thread/read` requests without assuming bridge-relay JSON-RPC fields on the Codex wire
- ✓ Codex assistant, command, approval, and ended events normalize into existing `live-session` payloads
- ✓ The adapter tracks pending responses safely for numeric and string request ids

## Artifacts Created
- apps/bridge/src/daemon/codex-adapter.ts
- apps/bridge/src/daemon/codex-event-normalizer.ts
- apps/bridge/tests/unit/codex-adapter.test.ts
- apps/bridge/tests/unit/codex-event-normalizer.test.ts

## Verification
- `npx vitest run --project phase-01-unit apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/codex-event-normalizer.test.ts`

## Follow-Ups
- Wire the adapter into the actual bridge daemon, session manager, and relay routing in `02-03`
- Keep broader phase verification deferred until the end of the build, per current operator instruction
