# Phase 4: Approval, Audit & Device Safety - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Make repeated remote use safe through explicit device/session revocation, durable audit logging, approval handling that stays readable on a phone, and reconnect behavior that preserves continuity without weakening the trust boundary.

**Scope anchor:** This phase hardens the existing browser-relay-bridge session flow. It covers device management, revocation, approval-state persistence, reconnect/resume policy, and clean session shutdown behavior. It does not add a new pairing flow, multi-session multiplexing, push notifications, or any general-purpose remote shell surface.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<specifics>
## Specific Ideas

- Preserve the Phase 3 direction where approvals stay in-context with the live turn instead of pulling the user into a separate workflow.
- Treat revocation and lost trust as higher priority than convenience: when trust is unclear, fail closed and explain why.
- Keep reconnect UX continuity for short network drops, but make terminal end states feel intentional and final.
- No additional product references were provided during this discussion; standard approaches are acceptable where not locked above.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Requirements
- `.planning/ROADMAP.md` §Phase 4 — phase goal, requirement mapping, success criteria, and the intended 3-plan breakdown.
- `.planning/PROJECT.md` — product boundary, outbound-only bridge constraint, mobile-first requirement, and the rule that remote control must preserve Codex approval and sandbox semantics.
- `.planning/REQUIREMENTS.md` — authoritative requirements for `AUTH-03`, `AUTH-04`, `SESS-06`, `LIVE-03`, `SEC-03`, and `SEC-05`.

### Prior Phase Decisions and Trust Boundary
- `.planning/phases/03-live-remote-ui-control/03-CONTEXT.md` — locked UI decisions for inline approvals, reconnect banners, backfill markers, and mobile session-shell behavior that Phase 4 should extend rather than replace.
- `.planning/phases/02-bridge-codex-session-adapter/02-CONTEXT.md` — bridge/session ownership rules, attach semantics, and Codex-specific control boundaries that still constrain Phase 4.
- `.planning/phases/01.1-browser-device-session-claim-flow-d-07-01-hotfix/01.1-CONTEXT.md` — browser/device-session claim flow and pairing confirmation decisions Phase 4 must preserve while adding revocation and reconnect safety.
- `docs/adr/0001-phase-1-trust-boundary.md` — trust-boundary rules plus explicit audit-event requirements for pairing, device session, ws-ticket, and revoke flows.

### Durable Session and Audit Contracts
- `packages/db/src/schema.ts` — durable schema for `device_sessions`, `web_sessions`, and `audit_events`, including revocation timestamps and ownership fields.
- `packages/protocol/src/session.ts` — shared device-session and ws-ticket contracts used across web, relay, and bridge.
- `packages/auth/src/device-session.ts` — token structure for device sessions and the expectation that durable server-side validation happens separately.
- `apps/web/lib/device-session.ts` — browser cookie/session helpers that Phase 4 must harden with durable revocation and expiry checks.

### Live Session and Relay Integration
- `apps/web/lib/live-session/server.ts` — current remote-principal authorization path that must be upgraded from cookie-only claims to durable session validation.
- `apps/web/lib/live-session/transport.ts` — current reconnect behavior and fallback transport rules that Phase 4 must preserve while adding stronger safety gates.
- `apps/web/app/session/[sessionId]/session-shell.tsx` — existing mobile session shell and current handling for reconnect, attach, end, and error events.
- `apps/web/components/session/approval-card.tsx` — current inline approval presentation that remains the Phase 4 approval surface baseline.
- `apps/relay/src/routes/ws-browser.ts` — relay-side browser WebSocket auth and browser-session routing behavior.
- `apps/web/lib/pairing-service.ts` — existing append-only audit event patterns already used for pairing flows.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/db/src/schema.ts` — already contains the durable tables and columns needed for revocation state and audit persistence, so Phase 4 should extend behavior before introducing new storage primitives.
- `apps/web/lib/device-session.ts` and `packages/auth/src/device-session.ts` — current device-session helpers are reusable, but Phase 4 must add durable row validation around them.
- `apps/web/lib/live-session/transport.ts` — reconnect/backoff behavior already exists and can be tightened rather than rewritten.
- `apps/web/app/session/[sessionId]/session-shell.tsx` and `apps/web/components/session/approval-card.tsx` — existing mobile session shell and inline approval card give Phase 4 a concrete UI baseline.
- `apps/web/lib/pairing-service.ts` — already shows the preferred append-only audit-write pattern for security-relevant actions.
- `packages/protocol/src/session.ts` — shared session protocol can carry any additional safety metadata without inventing an app-local contract.

### Established Patterns
- Auth gating in `apps/web` happens server-side before protected pages or API routes proceed.
- Runtime message and session contracts are validated with shared zod schemas instead of ad hoc JSON.
- Phase 3 already established subtle reconnect UX and inline approval emphasis for the mobile session experience.
- The product boundary remains browser -> relay -> outbound bridge -> local Codex; browser clients never talk directly to the local machine.
- Security-sensitive actions should be recorded durably in the hosted control plane instead of depending on browser-local state.

### Integration Points
- Device/session management likely lands as new authenticated routes and actions in `apps/web` alongside the existing session shell.
- `apps/web/lib/live-session/server.ts` is the main trust-enforcement seam for durable device-session validation before live control.
- Relay/browser session routes in `apps/relay/src/routes/ws-browser.ts` and session-connect/command routes in `apps/web/app/api/sessions/*` are the key control-plane touchpoints for revocation and reconnect behavior.
- Bridge-emitted lifecycle events such as `session.ended` already reach the mobile shell; Phase 4 should define the final safety semantics and UI consequences around those events.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within the Phase 4 boundary.

</deferred>

---

*Phase: 04-approval-audit-device-safety*
*Context gathered: 2026-04-18*
