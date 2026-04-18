---
phase: 05-multi-instance-routing-production-hardening
verified: 2026-04-18T21:30:54Z
status: human_needed
score: 4/4 phase truths verified
automated:
  relay_typecheck: passed
  regression_suite: passed
manual_checks_pending: 3
---

# Phase 5 Verification Report

**Phase Goal:** Make the relay architecture operationally credible beyond a single Fly.io instance.
**Verified:** 2026-04-18
**Status:** human_needed

## Result

Phase 5 is structurally complete and the automated regression surface is green. The relay now has durable bridge ownership, wrong-instance replay, explicit replay-failure handling, bounded browser backpressure behavior, a compact operator snapshot, and readiness logic that degrades only when local routing ability is genuinely compromised.

The phase remains `human_needed` rather than `passed` because the remaining checks require real multi-instance Fly deployment behavior that cannot be established from local unit tests alone.

## Automated Evidence

- `npm run typecheck --workspace @codex-mobile/relay`
- `npx vitest run packages/db/tests/relay-ownership.test.ts apps/relay/tests/unit/ownership-service.test.ts apps/relay/tests/unit/ws-bridge.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/relay/tests/unit/ws-browser-replay.test.ts apps/relay/tests/unit/ws-browser-reconnect.test.ts apps/relay/tests/unit/session-router-safety.test.ts apps/relay/tests/unit/session-router-audit.test.ts apps/relay/tests/unit/ops-route.test.ts apps/relay/tests/unit/readyz.test.ts apps/bridge/tests/unit/relay-connection.test.ts`
- `rg -n 'MAX_PENDING_BROWSER_MESSAGES|backpressure|recentReplayFailures|status.:\\s*\"degraded\"|\\[checks\\.relay_ops\\]' apps/relay/src/browser/browser-registry.ts apps/relay/src/routes/ops.ts apps/relay/src/routes/readyz.ts apps/relay/fly.toml`
- `apps/relay/src/routes/health.ts` remained untouched; `/healthz` stayed separate from the new readiness and ops behavior.

## Phase Truths

| Truth | Result | Evidence |
|-------|--------|----------|
| Relay can support multiple users and bridges without relying on a single in-memory coordinator | VERIFIED | Durable ownership leases in `packages/db/src/repositories/relay-ownership.ts`, local ownership classification in `apps/relay/src/ownership/ownership-service.ts`, and bridge-registration persistence in `apps/relay/src/routes/ws-bridge.ts`. |
| Browser connections can be routed to the relay instance that owns the bridge connection | VERIFIED | Wrong-instance browser HTTP and websocket requests replay through `apps/relay/src/routes/ws-browser.ts` and `apps/relay/src/ownership/replay-routing.ts`, with replay-failure fallback locked by `apps/relay/tests/unit/ws-browser-replay.test.ts` and `apps/relay/tests/unit/ws-browser.test.ts`. |
| Unauthorized cross-user or cross-bridge attachment attempts are rejected and observable | VERIFIED | Owner resolution and local-bridge enforcement happen before browser attach/command handling, and replay-failure plus disconnect reasons are now surfaced through `/ops/relay`. |
| Operators can inspect connection health, ownership state, queue pressure, and disconnect reasons | VERIFIED | `apps/relay/src/routes/ops.ts` exposes local bridge/browser/lease counters, `apps/relay/src/browser/browser-registry.ts` tracks backpressure/drop state, and `apps/relay/src/routes/readyz.ts` gates readiness on the same counters. |

## Requirement Coverage

| Requirement | Result | Evidence |
|-------------|--------|----------|
| SEC-04 | SATISFIED | Browser-to-bridge ownership is enforced via durable lease lookup, local-owner checks, and explicit fail-closed replay/unavailable branches. |
| OPS-02 | SATISFIED | Relay ownership survives beyond one in-memory coordinator through the `relay_bridge_leases` table and repository/service layer. |
| OPS-03 | SATISFIED | Wrong-instance browser requests replay to the owning Fly machine with explicit owner metadata and replay-state correlation. |
| OPS-04 | SATISFIED | Operators can inspect readiness, lease counts, replay failures, disconnect reasons, queue pressure, and best-effort drop counts through `/ops/relay`. |

## Manual Checks Still Required

| Behavior | Why manual | What to verify |
|----------|------------|----------------|
| Browser traffic replay on a real non-owning Fly Machine | Requires real Fly routing and at least two live relay Machines | A browser hitting the wrong Machine is replayed to the owner and still reaches the correct bridge/session. |
| Owner Machine loss during a live remote session | Requires killing the owning relay Machine or severing the owner bridge while attached | The browser sees explicit unavailable/disconnect behavior and no silent cross-instance takeover occurs. |
| Ops visibility during induced pressure in staging | Requires slow-browser and replay-failure conditions against a deployed stack | `/ops/relay` and logs show replay failures, disconnect reasons, queue pressure, and best-effort drop counts under degradation. |

## Conclusion

Phase 5 build work is complete and the automated verification bar is green. The only remaining work for this phase is manual Fly/staging validation via `$gsd-verify-work`, followed by milestone closeout.
