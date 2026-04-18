# Phase 04: Approval, Audit & Device Safety - Research

**Researched:** 2026-04-18
**Domain:** durable device-session trust, revocation fanout, audit persistence, reconnect safety
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Device and Session Management
- **D-01:** Add an authenticated device-management surface in `apps/web` that shows paired devices and active remote-control sessions; revocation controls must be explicit there rather than hidden only inside the live session shell.
- **D-02:** Revoking a device immediately invalidates its durable device session and tears down any active live session owned by that device; revocation fails closed.
- **D-03:** Revocation and forced disconnect states should end in an explicit `revoked` or `ended` user-visible state with actionable copy, not a silent return to a neutral disconnected screen.

### Approval Handling and Audit Trail
- **D-04:** Keep approval handling inline in the live session context using the Phase 3 approval card model; do not introduce a separate approval inbox or modal-first workflow in this phase.
- **D-05:** Persist approval requests, approval decisions, pairing claims, revocations, disconnects, reconnects, and ws-ticket/device-session trust events into the hosted audit trail.
- **D-06:** Audit logging remains append-only and server-authored. User-facing audit visibility can be compact and scoped to device/session safety events rather than a full operator console.

### Reconnect and Resume Policy
- **D-07:** Short transient disconnects continue using the subtle reconnect and event-backfill behavior established in Phase 3; a valid device session may recover without repeating the initial pairing flow.
- **D-08:** Reconnect may resume only while the device session is still valid and ownership still matches. Revoked, expired, or cleanly ended sessions must not auto-resurrect.
- **D-09:** If the local Codex process stops or bridge health indicates the session is no longer viable, the mobile UI transitions to a clean terminal-ended state and removes unsafe control affordances.

### Trust Enforcement
- **D-10:** Remote-principal authorization must stop trusting device cookie claims alone and must confirm the backing `device_sessions` row for expiry, revocation, and ownership before allowing live session access or control.
- **D-11:** Keep the existing Auth.js session plus relay-issued ws-ticket architecture; do not introduce URL-borne bearer tokens, direct local-machine access, or alternate channels that bypass relay trust checks.
- **D-12:** Phase 4 preserves the product boundary as a Codex-session remote window only. No SSH, tmux, PTY tunnel, or general remote shell capability is introduced.

### the agent's Discretion
- Exact information architecture for the device-management page, as long as paired devices and active sessions are both visible and revocation is explicit.
- The precise visual treatment for audit-history items, reconnect banners, and terminal-ended states, as long as the mobile experience stays readable and the safety state is unmistakable.
- Whether compact audit history lives on a dedicated page, a device detail view, or a focused section of the management surface.

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within the Phase 4 boundary.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-03 | User can view and revoke active paired devices and remote-control sessions | Add durable `device_sessions` persistence, authenticated device-management routes/UI, and a revoke flow that propagates to active browser sockets for the revoked device. |
| AUTH-04 | User can reconnect a valid device session after a transient network interruption without repeating the initial pairing flow | Keep the current reconnect/backfill transport, but gate reconnect on durable device-session validity and ownership checks at both web and relay ingress. |
| SESS-06 | Session ends cleanly when the local Codex process stops or the device/session is revoked | Reuse bridge `session.ended` events, add relay/browser teardown helpers, and render terminal ended/revoked UI states that disable controls. |
| LIVE-03 | Remote UI can recover from short network interruptions and resume the live stream without creating a new session | Preserve cursor-based reconnect and timeline backfill, but distinguish transient reconnect from terminal revocation or bridge-loss reasons so the transport stops retrying when it should. |
| SEC-03 | Pairing, approval, revoke, and disconnect events are recorded in an audit trail | Introduce append-only durable audit repositories and shared event-type constants so web and relay log the same trust-boundary events consistently. |
| SEC-05 | Product does not expose a general-purpose remote shell or tunnel independent of Codex | Keep all control paths inside the existing structured prompt/steer/approval/interrupt protocol; no new arbitrary shell commands, PTY channels, or alternate tunnels. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Deployment stays on Fly.io, and the local bridge remains outbound-only.
- Codex approval and sandbox semantics must be preserved end to end.
- Product code lives under top-level `apps/` and `packages/`, not `resources/gsd-2/`.
- Remote activity must remain product-owned structured events rather than terminal scraping.
- Every relay and control-plane payload must be validated at runtime.
- Mobile readability is a requirement, not post-phase polish.
- Revocation, reconnect, and audit behavior should be built in as first implementation, not deferred.

## Summary

Phase 04 has to begin by creating the durable control-plane truth that the earlier phases already assume exists. The schema is present, but the code still has three critical gaps:

1. `apps/web/app/api/pairings/[pairingId]/claim/route.ts` issues a `cm_device_session` cookie but never inserts a `device_sessions` row.
2. `apps/web/lib/live-session/server.ts` trusts structurally valid cookie claims without confirming durable row state.
3. `apps/web/lib/pairing-service.ts` writes audit rows into an in-memory store, so `SEC-03` is not durable today.

Without fixing those gaps first, device management and reconnect safety are mostly cosmetic. A revoked cookie still looks valid after JWT verification, the relay cannot terminate sockets by device session, and audit history disappears with process memory.

The existing Phase 3 work is still the right foundation. The live session protocol already carries `session.reconnected`, `session.ended`, and structured approval activities. The browser shell already has reconnect UI, inline approvals, and a reducer-driven timeline. Phase 04 should extend those primitives instead of inventing a separate safety UI stack.

**Primary recommendation:** Wave 1 should establish durable device-session repositories, claim-time persistence, hardened principal validation, and explicit revoke/teardown plumbing. Wave 2 can then split into two parallel tracks: append-only audit capture/surfacing and reconnect/bridge-health safety behavior.

**UI gate default used for planning:** Continue without a dedicated `04-UI-SPEC.md`. Phase 04 extends the approved Phase 3 mobile shell patterns and the locked `04-CONTEXT.md` decisions are specific enough to plan against directly.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `0.45.2` | Durable device-session and audit repositories | Already present in `packages/db` and aligned with the existing schema. |
| `postgres` | `3.4.9` | Shared Postgres driver for web and relay control-plane writes | Already present in `packages/db`; enough for a thin shared client helper. |
| `next` | `16.2.2` | Authenticated device-management routes, revoke actions, and server-side session validation | Existing app framework with server route handlers already used for pairing and live-session boot. |
| `react` | `19.2.4` | Mobile device-management and terminal-ended UI states | Existing session shell already uses reducer + `useEffectEvent` patterns. |
| `fastify` + `@fastify/websocket` | `5.8.4` + `11.2.0` | Relay-side browser teardown and bridge-health routing | Existing relay foundation; no new transport abstraction needed. |
| `zod` | `4.3.6` | Runtime validation for audit metadata, revoke requests, and session-end reasons | Already the project-wide payload validation pattern. |

### Testing

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `2.1.8` | Node route/unit coverage and shared repository tests | Use for device-session persistence, revoke routes, relay teardown, and audit append behavior. |
| `jsdom` | `26.1.0` | Browser-like environment for phone-shell terminal/reconnect state tests | Use for `session-shell` and device-management React tests. |
| `@testing-library/react` | `16.3.0` | Component-level mobile UI assertions | Use for device-management list, audit feed, and terminal-ended state rendering. |
| `@playwright/test` | `1.58.2` | Mobile smoke coverage for revoke/end-state and reconnect UX | Use for real phone-sized flow checks once the safety UI is wired. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared `packages/db` client + repository helpers | Separate DB wiring inside `apps/web` and `apps/relay` | Duplicates connection/config logic and makes audit/device-session behavior drift across services. |
| Fail-closed revoke with relay fanout | Soft revoke that waits for next reconnect | Simpler to implement, but violates the locked requirement that revocation tears down active live access immediately. |
| Reuse inline approval card model | Separate approval inbox page | Adds flow overhead and contradicts the Phase 3 interaction decision already locked in context. |

## Architecture Patterns

### Recommended Project Structure

```text
packages/db/src/
├── client.ts
├── repositories/device-sessions.ts
├── repositories/audit-events.ts
└── index.ts

packages/protocol/src/
└── audit.ts

apps/web/
├── app/devices/page.tsx
├── app/api/devices/route.ts
├── app/api/devices/[deviceSessionId]/revoke/route.ts
├── lib/live-session/server.ts
└── components/device/
    ├── device-management-list.tsx
    └── audit-feed.tsx

apps/relay/src/
├── browser/browser-registry.ts
├── browser/session-router.ts
└── routes/ws-browser.ts
```

### Pattern 1: Shared Control-Plane Repository Layer

**What:** Add a thin shared Postgres client plus repository helpers in `packages/db` instead of duplicating SQL and connection management in `apps/web` and `apps/relay`.

**When to use:** Any Phase 04 operation that reads or writes `device_sessions` or `audit_events`.

**Recommendation:** Start with concrete repository exports such as `createDeviceSessionRecord`, `findDeviceSessionForPrincipal`, `listDeviceSessionsForUser`, `revokeDeviceSession`, `touchDeviceSession`, `appendAuditEvent`, and `listAuditEventsForUser`.

### Pattern 2: Durable Remote Principal Validation

**What:** Treat the `cm_device_session` JWT as a structural envelope only. Authoritative checks happen by loading the durable row, validating `userId`, `expiresAt`, `revokedAt`, and the hashed cookie token, then updating `lastSeenAt`.

**When to use:** `requireRemotePrincipal()`, connect boot, command ingress, and any device-management action that trusts a paired device.

**Why:** This is the only way to make revocation and expiry meaningful after the JWT has already passed signature verification.

### Pattern 3: Device-Scoped Relay Teardown

**What:** Extend relay browser registries so they can enumerate and close live browser sockets by `deviceSessionId`, not only by `sessionId`.

**When to use:** Device revocation, explicit remote disconnect, and bridge-loss fanout that should affect every browser socket owned by the same paired device.

**Why:** The current `BrowserRegistry` only broadcasts by `sessionId`, which is not enough to immediately revoke one paired device while leaving another device or the bridge connection unaffected.

### Pattern 4: Append-Only Audit Capture at Trust Boundaries

**What:** Centralize event-type constants and append-only audit writes so web and relay emit the same durable records for pairing, ws-ticket mint/reject, approval request/decision, revoke, reconnect, and disconnect flows.

**When to use:** Whenever control-plane state changes because of authentication, authorization, or remote-control safety.

**Why:** Phase 04 needs both durable forensic traceability and a compact user-facing history surface. Shared event types prevent drift between the backend and UI.

## Key Findings and Pitfalls

### Critical Gaps

1. **Device sessions are not actually persisted yet.**
   `apps/web/app/api/pairings/[pairingId]/claim/route.ts` mints the cookie and returns metadata, but there is no repository write into `device_sessions`.

2. **Remote principal validation is still cookie-only.**
   `apps/web/lib/live-session/server.ts` checks `auth()` plus `readDeviceSession()` and stops there; revocation and expiry are advisory comments, not enforced behavior.

3. **Audit persistence is memory-backed.**
   `apps/web/lib/pairing-service.ts` defaults to `InMemoryAuditStore`, so pairing and claim audit rows are not durable.

4. **Relay browser teardown is session-scoped, not device-scoped.**
   `apps/relay/src/browser/browser-registry.ts` can broadcast by `sessionId`, but there is no helper to terminate sockets by `deviceSessionId` when a device is revoked.

5. **Browser reconnect currently retries forever.**
   `apps/web/lib/live-session/transport.ts` always schedules another reconnect after close. It does not distinguish `device_session_revoked` from a transient network interruption.

### Consequences for Planning

- Phase 04 cannot treat device management as a UI-only plan. Persistence and trust enforcement are the first-order work.
- Audit logging should not be deferred to the end of the phase because both revocation and reconnect need to emit durable trust-boundary events as they are built.
- The reconnect plan should build on the existing cursor/backfill contract, not replace it with a second transport or a page reload loop.
- `SEC-05` is best enforced by regression coverage: the command schema remains limited to prompt/steer/approval/interrupt, and no new arbitrary shell/control route is introduced.

## Recommended Wave Split

| Wave | Plans | Why |
|------|-------|-----|
| 1 | `04-01` | Establish durable device-session truth, principal validation, and explicit revoke/teardown primitives that both later plans depend on. |
| 2 | `04-02`, `04-03` | Once persistence and revoke primitives exist, audit capture/surfacing and reconnect/bridge-health safety can proceed in parallel. |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `2.1.8` + Playwright `1.58.2` |
| Config file | `vitest.workspace.ts`, `playwright.config.ts` |
| Quick run command | `vitest run --project phase-01-unit --project phase-03-web` |
| Full suite command | `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web && npx playwright test apps/web/tests/live-session-mobile.spec.ts apps/web/tests/device-safety-mobile.spec.ts` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-03 | Device-management view lists paired devices and revoke changes durable state plus tears down live access | node unit + jsdom | `vitest run --project phase-01-unit apps/web/tests/unit/device-revoke-route.test.ts apps/web/tests/unit/remote-principal.test.ts && vitest run --project phase-03-web apps/web/tests/unit/device-management-page.test.tsx` | no - Wave 0 |
| AUTH-04 | A still-valid device reconnects after a transient drop without re-pairing | relay unit + jsdom | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser-reconnect.test.ts && vitest run --project phase-03-web apps/web/tests/unit/session-shell-safety.test.tsx -t "reconnect"` | no - Wave 0 |
| SESS-06 | Revoked or bridge-ended sessions enter a terminal state and disable remote controls | relay unit + jsdom | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser-reconnect.test.ts && vitest run --project phase-03-web apps/web/tests/unit/session-shell-safety.test.tsx -t "terminal"` | no - Wave 0 |
| LIVE-03 | Short disconnects preserve the timeline and backfill missed events instead of forcing a new session | relay unit + jsdom + e2e | `vitest run --project phase-01-unit apps/relay/tests/unit/ws-browser-reconnect.test.ts && vitest run --project phase-03-web apps/web/tests/unit/session-shell-safety.test.tsx -t "backfill"` | no - Wave 0 |
| SEC-03 | Pairing, approval, revoke, reconnect, and disconnect events append durable audit rows | node unit | `vitest run --project phase-01-unit packages/db/tests/audit-events.test.ts apps/relay/tests/unit/session-router-audit.test.ts apps/web/tests/unit/session-command-audit.test.ts` | no - Wave 0 |
| SEC-05 | Live session control remains limited to prompt, steer, approval, and interrupt only | node unit | `vitest run --project phase-01-unit apps/relay/tests/unit/session-router-safety.test.ts apps/web/tests/unit/session-command-audit.test.ts -t "rejects unknown command"` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run --project phase-01-unit --project phase-03-web`
- **Per wave merge:** `npm run typecheck && vitest run --project phase-01-unit --project phase-03-web`
- **Phase gate:** Full suite green plus one Playwright mobile smoke for revoke/end-state and reconnect continuity

### Wave 0 Gaps

- [ ] `packages/db/src/client.ts` and repository tests for durable device-session and audit writes.
- [ ] `apps/web/tests/unit/device-session-claim-route.test.ts` for claim-time persistence.
- [ ] `apps/web/tests/unit/remote-principal.test.ts` for durable device-session validation.
- [ ] `apps/web/tests/unit/device-revoke-route.test.ts` for revoke route auth, durable mutation, and audit writes.
- [ ] `apps/web/tests/unit/device-management-page.test.tsx` for mobile device-management rendering.
- [ ] `apps/relay/tests/unit/session-router-audit.test.ts` for audit writes triggered by approval/reconnect/disconnect events.
- [ ] `apps/relay/tests/unit/ws-browser-reconnect.test.ts` for revoked/expired reconnect rejection and bridge-ended fanout.
- [ ] `apps/web/tests/unit/session-shell-safety.test.tsx` for terminal-ended/revoked UI behavior.
- [ ] `apps/web/tests/device-safety-mobile.spec.ts` for phone-sized revoke and terminal-state smoke coverage.

## Sources

### Primary (HIGH confidence)
- Local repo: `.planning/phases/04-approval-audit-device-safety/04-CONTEXT.md` - locked product decisions for revocation, audit, reconnect, and trust enforcement
- Local repo: `.planning/ROADMAP.md` - phase goal, success criteria, and required plan breakdown
- Local repo: `.planning/REQUIREMENTS.md` - authoritative requirement IDs for Phase 04
- Local repo: `docs/adr/0001-phase-1-trust-boundary.md` - binding rule that cookies are not source of truth and trust-boundary events must be audited
- Local repo: `packages/db/src/schema.ts` - durable schema for `device_sessions`, `web_sessions`, and `audit_events`
- Local repo: `apps/web/app/api/pairings/[pairingId]/claim/route.ts` - current claim flow and the missing `device_sessions` write
- Local repo: `apps/web/lib/device-session.ts` - cookie issuance and verification helpers
- Local repo: `apps/web/lib/live-session/server.ts` - current remote principal check and relay minting helpers
- Local repo: `apps/web/lib/live-session/transport.ts` - current reconnect behavior and fallback command path
- Local repo: `apps/relay/src/browser/browser-registry.ts` - current session-scoped browser registry
- Local repo: `apps/relay/src/browser/session-router.ts` - current browser attach/command/routing flow
- Local repo: `apps/relay/src/routes/ws-browser.ts` - browser ws-ticket validation path
- Local repo: `apps/bridge/src/daemon/bridge-daemon.ts` and `apps/bridge/src/daemon/relay-connection.ts` - bridge session-ended and reconnect behavior already available upstream

### Secondary (MEDIUM confidence)
- Local repo: `.planning/phases/03-live-remote-ui-control/03-CONTEXT.md` - existing mobile reconnect and inline approval decisions Phase 04 extends
- Local repo: `.planning/phases/03-live-remote-ui-control/03-UI-SPEC.md` - prior mobile shell design contract reused as a visual baseline
- Local repo: `apps/web/tests/unit/session-connect-route.test.ts` and `apps/relay/tests/unit/ws-browser.test.ts` - current route and relay testing patterns for Phase 04 extensions
- Local repo: `README.md` - environment contract and Phase 04 product framing

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all required libraries are already present in the repo and Phase 04 does not need a new framework.
- Architecture: MEDIUM - the durable persistence and trust seams are clear, but the exact relay revoke-fanout shape is not implemented yet.
- Pitfalls: HIGH - the main failure modes are directly visible in the current codebase, not speculative.

**Research date:** 2026-04-18
**Valid until:** 2026-05-02
