# Phase 7: Codex-Native `/handoff` Command - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Make remote continuation start from inside Codex itself by exposing `/handoff` as the user-facing command, binding it to the active local session/thread that invoked it, and routing that command into the existing Handoff bootstrap path instead of a separate bridge flow.

**Scope anchor:** Codex-facing command surface, active-thread capture, command response contract, and failure semantics only. This phase does not yet complete the hosted launch URL consumption flow on the web side, does not add generic session picking, and does not widen the product into a shell-like command surface.

</domain>

<decisions>
## Implementation Decisions

### Command Invocation Contract
- **D-01:** `/handoff` is the Codex-native entrypoint after install. The command must be invoked from an active Codex thread/session context and bind to that exact invoking thread.
- **D-02:** If there is no valid active-thread context, `/handoff` fails closed with actionable guidance instead of falling back to a session picker, recent-session heuristic, or generic selection flow.
- **D-03:** The local command path must reuse the Phase 6 `handoff launch` bootstrap and daemon-start seam rather than introducing a parallel local bridge path.

### Existing-Handoff Reuse Policy
- **D-04:** Re-running `/handoff` from the same active thread should reuse the existing still-valid handoff for that thread instead of always minting a fresh launch.
- **D-05:** Fresh launch creation is reserved for cases where the existing handoff is no longer valid, such as expiry or revocation; the default repeat behavior stays stable and reuse-first.

### Command Response Inside Codex
- **D-06:** A successful `/handoff` call should return a concise handoff block inside Codex containing the hosted URL, terminal QR output, expiry information, and whether the result reused an existing handoff or created a new one.
- **D-07:** The success response should stay phone-oriented and task-focused; Phase 7 should not turn `/handoff` into a diagnostic dashboard with relay internals or broad bridge status output.

### Failure Semantics and Safety
- **D-08:** Missing bootstrap or install state must fail with actionable repair guidance rather than silently starting a first-run setup flow from inside `/handoff`.
- **D-09:** Missing active-thread context must fail with explicit guidance that `/handoff` must be run from an active Codex thread.
- **D-10:** The command path must preserve the existing approval and sandbox semantics of the invoking Codex session exactly; `/handoff` cannot introduce a broader permission surface or bypass bridge-boundary checks.

### the agent's Discretion
- The exact Codex plugin/command registration mechanism, as long as `/handoff` is the user-facing command surface after install.
- The exact formatting of the success block inside Codex, as long as it includes URL, QR, expiry, and reused/new status in a concise phone-first presentation.
- The exact storage shape used to remember a reusable active-thread handoff, as long as reuse remains scoped to the invoking thread and respects expiry/revocation.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Phase Requirements
- `.planning/ROADMAP.md` — authoritative Phase 7 goal, requirements mapping, success criteria, and plan split for the Codex-native `/handoff` command.
- `.planning/PROJECT.md` — milestone goal and product boundary: npm-installed Handoff plus `/handoff` inside Codex leading into hosted remote continuation.
- `.planning/REQUIREMENTS.md` — authoritative requirements for `CMD-01`, `CMD-02`, and `SAFE-01`.
- `.planning/STATE.md` — current milestone state and the Phase 6 completion notes that Phase 7 builds on.

### Locked Prior Decisions
- `.planning/phases/02-bridge-codex-session-adapter/02-CONTEXT.md` — active-session ownership, single attached remote-controlled session semantics, and sandbox passthrough rules that the new command path must preserve.
- `.planning/phases/04-approval-audit-device-safety/04-CONTEXT.md` — fail-closed trust decisions, durable device-session validation, and the prohibition on widening the product into a general-purpose shell.
- `.planning/phases/05-multi-instance-routing-production-hardening/05-CONTEXT.md` — durable ownership and attach safety rules that remain in force when `/handoff` binds to a thread and later routes into the hosted relay path.
- `.planning/phases/06-npm-distribution-local-bootstrap/06-01-SUMMARY.md` — publishable `handoff` CLI and npm-facing command surface added in Phase 6.
- `.planning/phases/06-npm-distribution-local-bootstrap/06-02-SUMMARY.md` — local bootstrap state, bridge installation identity, and hosted connect-ticket flow established in Phase 6.
- `.planning/phases/06-npm-distribution-local-bootstrap/06-03-SUMMARY.md` — `handoff launch` daemon reuse/start seam that Phase 7 must call rather than replacing.

### Trust Boundary and Launch Constraints
- `docs/adr/0001-phase-1-trust-boundary.md` — trust-zone rules and the requirement that browser/web/relay/bridge boundaries stay intact when introducing the Codex-native command.

### Existing Command and Session Integration Seams
- `apps/bridge/src/cli.ts` — current `handoff` CLI entrypoint and command routing.
- `apps/bridge/src/cli/launch.ts` — current `handoff launch` seam for reusing or starting the daemon.
- `apps/bridge/src/lib/local-state.ts` — install-safe persisted bootstrap/config/credential state and daemon state paths.
- `apps/bridge/src/daemon/codex-adapter.ts` — Codex `app-server` integration, thread listing, resume, and read semantics available to a command path.
- `apps/bridge/src/daemon/bridge-daemon.ts` — bridge-side attach/session lifecycle and command forwarding rules.
- `apps/bridge/src/daemon/session-manager.ts` — single attached-session model and attached/active-turn guard rails.
- `apps/web/app/api/bridge/connect-ticket/route.ts` — hosted bridge ticket minting flow that the local launch path already uses.
- `apps/web/app/api/sessions/[sessionId]/connect/route.ts` — existing browser session-connect contract that already expects a concrete `sessionId`.
- `apps/web/lib/live-session/server.ts` — current remote principal, relay ticket minting, and relay URL resolution behavior.

### Codebase Structure Guidance
- `.planning/codebase/STRUCTURE.md` — confirms there is currently no existing Codex plugin surface in this repo, so Phase 7 should add one deliberately instead of assuming a pre-existing command-registration path.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/bridge/src/cli/launch.ts` already provides the right local bootstrap seam for "start or reuse the background bridge daemon" without reintroducing manual env wiring.
- `apps/bridge/src/lib/local-state.ts` already persists bootstrap identity, credentials, and daemon state in XDG-safe paths, which gives Phase 7 a local place to read/write reusable handoff metadata.
- `apps/bridge/src/daemon/codex-adapter.ts` already knows how to list, resume, and read Codex threads through `codex app-server`, which is the key local integration seam for binding `/handoff` to the invoking thread.
- `apps/web/app/api/sessions/[sessionId]/connect/route.ts` and `apps/web/lib/live-session/server.ts` already encode the hosted assumption that continuation targets a concrete `sessionId`, not a later generic picker.
- `apps/web/app/api/bridge/connect-ticket/route.ts` already gives the bridge a hosted re-auth/connect-ticket path that Phase 7 should continue to use indirectly through `handoff launch`.

### Established Patterns
- The repo validates runtime message contracts at boundaries and prefers fail-closed behavior when identity, ownership, or session context is unclear.
- The bridge remains outbound-only and mediates access to local Codex through `codex app-server`; no direct browser-to-local-machine path exists or should be added.
- Existing session flows assume one active remote-controlled session per bridge instance at a time, so the `/handoff` command should target one exact thread rather than opening a broader session chooser.
- The success path in this milestone should reuse published `handoff` packaging and local bootstrap rather than adding a second launcher path.

### Integration Points
- Phase 7 needs a new Codex-facing command/plugin surface because the repo currently has no `.codex-plugin`, plugin manifest, or existing slash-command registration for `/handoff`.
- That new command surface should invoke local Handoff logic by routing into the existing `handoff launch` path and the Phase 6 bootstrap state instead of talking directly to the relay or recreating pairing/bootstrap logic.
- The command implementation will need a handoff metadata seam that maps the invoking Codex thread to a reusable still-valid handoff record so repeat `/handoff` calls on the same thread can reuse rather than remint.
- The response contract back into Codex needs to return concise launch information while preserving the active session's approval and sandbox model.

</code_context>

<specifics>
## Specific Ideas

- The intended user shape remains: `npm install handoff`, then `/handoff` inside Codex.
- `/handoff` should feel like a stable continuation handle for the current thread, not a generic "open remote control" command detached from the invoking conversation.
- The user wants the command output to stay concise and useful on a phone-start workflow: hosted URL, QR, expiry, and reused/new status.
- First-run repair guidance belongs in explicit failure copy, not in an implicit setup fallback that broadens the command behavior in this phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the Phase 7 boundary.

</deferred>

---

*Phase: 07-codex-native-handoff-command*
*Context gathered: 2026-04-19*
