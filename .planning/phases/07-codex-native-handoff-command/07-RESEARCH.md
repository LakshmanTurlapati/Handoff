# Phase 07: Codex-Native `/handoff` Command - Research

**Researched:** 2026-04-19
**Domain:** Codex slash-command packaging, thread-scoped handoff binding, and fail-closed local-to-hosted launch metadata
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from ROADMAP.md, REQUIREMENTS.md, CONTEXT.md, and AGENTS.md)

### Locked Decisions
- **D-01:** `/handoff` is the Codex-native entrypoint after install and must bind to the exact invoking thread/session context.
- **D-02:** If there is no valid active-thread context, the command fails closed with actionable guidance. No recent-session fallback or generic picker is allowed.
- **D-03:** The command path must reuse the existing Phase 6 `handoff launch` seam and bridge bootstrap state instead of creating a second local startup path.
- **D-04:** Re-running `/handoff` from the same thread should reuse a still-valid handoff for that thread before minting a new one.
- **D-05:** The command response inside Codex must stay concise and phone-oriented rather than expanding into a diagnostic console.
- **D-06:** The command path must preserve existing approval and sandbox semantics. It cannot widen the product into a shell-like or direct-local-machine surface.
- **D-07:** Product code should stay under top-level `apps/` and `packages/`; new Codex-facing assets should be packaged from there rather than treating `resources/gsd-2/` as the product root.

### the agent's Discretion
- The exact Codex command registration mechanism, as long as it results in a real `/handoff` slash command after install.
- The exact storage split between local bridge state and hosted launch metadata, as long as reuse is scoped to the invoking thread and respects expiry or revocation.
- The exact response formatting for the Codex success block, as long as it stays concise and includes thread-bound handoff status, launch details, and repair guidance on failure.

### Deferred Ideas (OUT OF SCOPE)
- Generic session selection, recent-session fallback, or any shell-like command surface.
- Browser-side launch consumption and deep-link landing behavior after pairing; Phase 8 still owns the hosted continuation UX.
- Broad operator diagnostics or relay internals in the `/handoff` output block.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMD-01 | After install, Codex exposes `/handoff` as the entrypoint for starting remote continuation | Package a real Codex slash-command asset and install/update it from the npm-delivered `handoff` package. |
| CMD-02 | `/handoff` captures the active local Codex session/thread instead of forcing later generic session selection | Add a thread-bound handoff helper and storage/minting path keyed to the invoking thread ID. |
| SAFE-01 | The install and `/handoff` path preserves Codex approval and sandbox semantics and does not expose a general-purpose shell surface | Keep all control routed through the existing bridge, reuse `handoff launch`, fail closed on missing context, and add tests against picker fallbacks and permission widening. |
</phase_requirements>

## Summary

Phase 7 is best implemented as a thin Codex command surface over the Phase 6 local bridge bootstrap, not as a second bridge runtime or a generic shell command. The current repo already has the local building blocks needed for that shape:

1. `apps/bridge/src/cli/launch.ts` already gives Phase 7 a stable `handoff launch` seam that reuses or starts one outbound-only daemon.
2. `apps/bridge/src/lib/local-state.ts` already persists secure local config, credentials, and daemon state under XDG-safe paths with restrictive permissions.
3. `apps/bridge/src/daemon/codex-adapter.ts` already lists threads and reads thread history through `codex app-server` over stdio, which is the only acceptable Codex integration transport per the trust-boundary ADR.
4. `apps/web/app/api/sessions/[sessionId]/connect/route.ts` and `apps/web/lib/live-session/server.ts` already assume the hosted side eventually connects to one concrete `sessionId`, not a later generic picker.
5. No existing Codex-facing slash-command surface exists in this repo, so Phase 7 must add one deliberately.

The clean split is:

- **07-01:** package and install the Codex slash-command asset so `/handoff` exists after install and delegates into the local `handoff` package.
- **07-02:** add the thread-bound handoff helper, structured handoff metadata contract, and reuse-first local/hosted launch record path keyed to the invoking thread.
- **07-03:** lock down failure semantics, approval/sandbox preservation, and regression coverage so `/handoff` cannot silently degrade into a picker or a broader shell surface.

## Reusable Assets

### Local launch and bootstrap seams
- `apps/bridge/src/cli/launch.ts` already returns explicit `daemon_reused` and `daemon_started` outcomes and waits for daemon readiness.
- `apps/bridge/src/cli/daemon.ts` already loads saved bootstrap state, exchanges it for hosted bridge connect tickets, and starts the bridge without local inbound ports.
- `apps/bridge/src/lib/local-state.ts` already owns XDG config/state directories, strict file permissions, and daemon metadata persistence.
- `apps/bridge/src/daemon/daemon-manager.ts` already enforces single-daemon reuse keyed by `bridgeInstanceId`.

### Codex session and thread seams
- `apps/bridge/src/daemon/codex-adapter.ts` already supports `thread/list`, `thread/read`, and `thread/resume` over `codex app-server --listen stdio://`.
- `apps/bridge/src/daemon/session-manager.ts` already enforces single attached session semantics and active-turn tracking, which Phase 7 must not bypass.
- `apps/bridge/src/daemon/codex-event-normalizer.ts` already recognizes approvals, command execution, and turn lifecycle events, which provides a concrete baseline for preserving Codex approval semantics.

### Hosted routing seams
- `apps/web/lib/live-session/server.ts` already enforces durable device-session validation before minting relay tickets.
- `apps/web/app/api/sessions/[sessionId]/connect/route.ts` already models continuation as one concrete `sessionId`, which is exactly what thread-bound `/handoff` should feed.
- `packages/db/src/schema.ts` and `packages/db/src/repositories/bridge-installations.ts` already provide secure hosted identity and token patterns that a handoff-launch record can mirror.

### Codex command packaging signals
- Local Codex examples under `~/.codex/.tmp/plugins/plugins/*/commands/*.md` show markdown command files with frontmatter plus `Preflight`, `Plan`, `Commands`, `Verification`, `Summary`, and `Next Steps` sections.
- Local GSD structure docs describe slash commands as markdown files installed under the Codex home command tree. There is no existing project-local command bundle in this repo today.
- I did not find an authoritative official Codex doc page in this session that fully specifies slash-command install paths, so the safest planning target is a packaged markdown command asset plus an installer that resolves `CODEX_HOME`/`~/.codex` at runtime rather than hardcoding a hidden cache path.

## Gaps to Close

1. **No `/handoff` command asset exists today.**
   There is no packaged Codex slash command, no installer/update path, and no docs that connect the npm-installed `handoff` package to Codex command discovery.

2. **No thread-bound handoff contract exists.**
   The bridge can list and read sessions, but nothing today captures “the invoking thread for this Codex command” and stores a reusable handoff record keyed to that thread.

3. **No dedicated handoff launch metadata exists.**
   Phase 6 bootstrapped bridge installation identity and daemon reuse, but there is no hosted launch record or local cache for thread-specific reuse, expiry, or revocation.

4. **No structured `/handoff` result payload exists.**
   There is no shared schema for the command helper to return concise machine-readable fields such as thread binding, reused/new status, launch URL, QR payload, expiry, or repair guidance.

5. **No safety-specific regression coverage exists for this flow.**
   Current tests cover daemon reuse, pairing bootstrap, and Codex adapter basics, but not the new risks: missing-thread failures, session-picker fallback, cross-thread reuse, or approval/sandbox widening.

## Concrete File Targets

### Plan 07-01: Codex command surface
- `apps/bridge/package.json` — include Codex command assets in the published package and expose any install/update helper entry needed for post-install setup.
- `apps/bridge/src/cli.ts` — register a dedicated internal helper/install command for Codex command setup.
- `apps/bridge/src/lib/codex-command-install.ts` — resolve Codex home, copy/update the packaged command asset, and surface actionable repair guidance.
- `apps/bridge/resources/codex/commands/handoff.md` — packaged slash-command asset that delegates to the local `handoff` helper and follows Codex command markdown conventions.
- `apps/bridge/tests/unit/codex-command-install.test.ts` — installation/update path coverage.

### Plan 07-02: Active-thread capture and handoff metadata
- `apps/bridge/src/cli/codex-handoff.ts` — the internal local helper invoked by `/handoff`.
- `apps/bridge/src/lib/local-state.ts` — add or delegate to thread-scoped handoff metadata persistence under the existing XDG state model.
- `apps/bridge/src/lib/thread-handoff-state.ts` — normalize local thread-handoff cache reads/writes and reuse checks if the logic becomes too large for `local-state.ts`.
- `packages/protocol/src/handoff.ts` and `packages/protocol/src/index.ts` — shared schema for the structured handoff result and hosted/local launch metadata.
- `packages/db/src/schema.ts` and `packages/db/src/repositories/handoffs.ts` — durable hosted handoff records if Phase 7 needs to mint reusable launch descriptors before Phase 8 consumes them.
- `apps/web/app/api/handoffs/route.ts` or equivalent hosted route — mint/reuse/revoke handoff launch metadata from authenticated bridge state.
- `apps/bridge/tests/unit/codex-handoff-command.test.ts` and `apps/web/tests/unit/handoff-route.test.ts` — reuse-first, expiry, and thread-binding coverage.

### Plan 07-03: Safety and regression guardrails
- `apps/bridge/resources/codex/commands/handoff.md` — final command preflight and failure-copy tightening.
- `apps/bridge/src/cli/codex-handoff.ts` — explicit missing-thread, missing-bootstrap, expired-handoff, and revoked-handoff failures.
- `apps/web/lib/live-session/server.ts` or the hosted handoff route — ensure launch minting continues to validate durable user/device ownership.
- `apps/bridge/tests/unit/codex-handoff-safety.test.ts` — assert no session-picker fallback, no cross-thread reuse, no unsafe bypass around `handoff launch`.
- `apps/bridge/tests/unit/codex-adapter.test.ts` or a new focused test — validate the thread metadata contract Phase 7 depends on.

## Risks and Constraints

### Phase-boundary tension
- The Phase 7 context wants the command response to include launch URL, QR output, expiry, and reused/new status, while Phase 8 still owns the hosted launch-consumption flow.
- The safe interpretation is: Phase 7 can mint and display thread-bound launch metadata, but Phase 8 still owns what the browser does with it after the link opens.

### Codex command runtime uncertainty
- Local Codex examples clearly use markdown command files, but the exact install/update path is not surfaced in repo-local product code here.
- Phase 7 should therefore package the command asset and install it via a discoverable Codex home path, not by writing into cache-like plugin directories.

### Security boundary
- The command helper must not talk directly from the browser to the laptop or to raw `codex app-server`.
- Any hosted handoff token or URL must remain short-lived and single-purpose, following the same trust-boundary rules as pairing and ws-tickets.
- The command must never degrade into a generic `thread/list` chooser or a broader “run shell on my machine” command.

### Existing session semantics
- Phase 2 locked one attached remote-controlled session per bridge instance at a time.
- Phase 7 must bind `/handoff` to one exact thread and preserve that single-session model rather than attempting multi-thread launch multiplexing.

## Validation Architecture

### Test infrastructure
- **Framework:** Vitest workspace (`vitest.workspace.ts`) plus targeted bridge/web unit tests.
- **Primary areas:** bridge CLI helpers, local state persistence, Codex adapter behavior, hosted launch-metadata routes.
- **Quick feedback target:** keep the narrow Phase 7 slice under 30 seconds by running only new handoff-focused unit tests after each task.

### Recommended automated coverage
- `apps/bridge/tests/unit/codex-command-install.test.ts` — command asset installation/update and failure guidance.
- `apps/bridge/tests/unit/codex-handoff-command.test.ts` — helper output shape, reuse-first behavior, missing-thread failure, and daemon reuse integration.
- `apps/bridge/tests/unit/codex-handoff-safety.test.ts` — no picker fallback, no cross-thread reuse, no unsafe bypass when bootstrap is missing.
- `apps/web/tests/unit/handoff-route.test.ts` — hosted handoff mint/reuse auth, expiry, revocation, and single-purpose token behavior.
- Extend `apps/bridge/tests/unit/codex-adapter.test.ts` if Phase 7 needs more precise thread metadata or read-path assumptions.

### Manual-only checks
- Run `/handoff` from a real Codex thread after installing the command asset and confirm it surfaces the thread-bound result inside Codex.
- Re-run `/handoff` in the same thread and verify it reuses the existing still-valid handoff rather than minting a second one.
- Attempt `/handoff` outside a valid active thread context and confirm it fails closed with explicit repair guidance instead of listing sessions.

### Suggested commands
- **Quick run:** `npx vitest run apps/bridge/tests/unit/codex-command-install.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts apps/bridge/tests/unit/codex-handoff-safety.test.ts`
- **Full suite:** `npx vitest run apps/bridge/tests/unit/codex-command-install.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts apps/bridge/tests/unit/codex-handoff-safety.test.ts apps/bridge/tests/unit/codex-adapter.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/web/tests/unit/handoff-route.test.ts`

## Planning Recommendations

1. Keep the Codex-facing command as a markdown slash-command asset and keep all real logic in the npm-delivered `handoff` package.
2. Reuse `handoff launch` for daemon availability and put all new logic behind a dedicated internal helper such as `handoff codex-handoff`.
3. Introduce a shared `handoff` protocol/result schema early so the command surface, local helper, and future Phase 8 browser consumption stay aligned.
4. Scope reuse strictly by thread ID and expiry/revocation state. If any part of that identity is missing, fail closed.
5. Add safety regression tests in the same phase as the command surface; do not defer “no picker fallback” or “no widened shell surface” checks to later phases.

---

*Phase: 07-codex-native-handoff-command*
*Research completed: 2026-04-19*
