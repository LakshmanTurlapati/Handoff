# Phase 3: Live Remote UI & Control - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the phone-sized remote session UI that lets a signed-in paired device attach to one active Codex thread, watch live structured session activity in near real time, send a new prompt or steer an in-flight turn, and intentionally interrupt a running turn.

**Scope anchor:** Mobile session shell, timeline rendering, live playback behavior, and remote-control affordances only. No device-management/revocation flows, no push notifications, no multi-session multiplexing, and no expansion into a general-purpose shell.

</domain>

<decisions>
## Implementation Decisions

### Timeline Structure
- **D-01:** The main live session view uses turn-grouped cards, not a raw chronological feed or sectioned tabs.
- **D-02:** The default collapsed turn view shows assistant text plus the latest live status; detailed tool output stays behind expanders.
- **D-03:** Completed tool details auto-fold while the currently running step stays visible.
- **D-04:** Older turns remain readable during a live turn, but compress to headers plus first lines so the active turn gets most of the screen.

### Control Surface
- **D-05:** Mobile input uses a sticky bottom composer that expands upward for longer text.
- **D-06:** `Steer` stays visible beside the composer rather than hiding in a menu or only appearing conditionally during active output.
- **D-07:** `Interrupt` is a dedicated danger action in the same sticky control row.
- **D-08:** After interrupt is requested, the interrupt control flips into a pending-stop state while the timeline keeps streaming until the session confirms the stop.

### Live Playback Behavior
- **D-09:** Assistant output streams in readable chunks instead of token-by-token or only on completed steps.
- **D-10:** The timeline auto-follows live output until the user manually scrolls away; then a `Jump to live` affordance appears.
- **D-11:** Short disconnects keep the timeline visible and show a subtle reconnect banner instead of replacing the screen with a blocking state.
- **D-12:** After reconnect, missed events are backfilled into the active turn and marked with a subtle `Reconnected` separator.

### Approval and Activity Emphasis
- **D-13:** Approval requests appear as a high-contrast inline card pinned near the live turn instead of a full-screen blocker or tiny status chip.
- **D-14:** Agent text, tool activity, command execution, approvals, and system notices use distinct card treatments within one shared card system.
- **D-15:** Failures expand into an error card with retry/context actions when the backend can provide them.
- **D-16:** Turn headers lead with current session state (`Waiting for approval`, `Running bash`, `Interrupted`) before the specific actor/detail text.

### the agent's Discretion
- Exact typography, spacing scale, color tokens, and motion treatment as long as activity types remain clearly distinct on a phone.
- The precise iconography and animation behavior for expand/collapse, reconnect, and stop-pending transitions.
- Whether retry/context actions render as inline buttons, a compact action row, or a secondary menu when backend support varies by event type.
- The exact component and hook breakdown between server components, client components, and shared state modules in `apps/web`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Requirements
- `.planning/ROADMAP.md` §Phase 3 — phase goal, requirement mapping, and the intended 3-plan breakdown.
- `.planning/PROJECT.md` — product boundary, phone-first UX requirement, and the “remote window into local Codex” constraint.
- `.planning/REQUIREMENTS.md` — authoritative requirements for `SESS-04`, `SESS-05`, `LIVE-01`, `LIVE-02`, and `LIVE-04`.

### Prior Phase Decisions and Trust Boundary
- `.planning/phases/02-bridge-codex-session-adapter/02-CONTEXT.md` — locked bridge/session rules the UI must respect: one active remote-controlled session, attach/history semantics, and sandbox passthrough.
- `.planning/phases/02-bridge-codex-session-adapter/02-RESEARCH.md` — app-server event model, bridge-relay message flow, and transport assumptions Phase 3 consumes.
- `docs/adr/0001-phase-1-trust-boundary.md` — browser/web/relay/bridge trust rules, cookie boundaries, and ws-ticket constraints that the live UI cannot bypass.

### Live Protocol and Integration Points
- `packages/protocol/src/bridge.ts` — current bridge-relay contracts for `session.history`, `session.event`, `turn.send`, and `approval.respond`; Phase 3 planning should extend this contract deliberately for browser live control where needed.
- `packages/protocol/src/session.ts` — device-session and ws-ticket contracts for authenticated browser live channels.
- `apps/bridge/src/daemon/relay-connection.ts` — current bridge reconnect and registration lifecycle that the browser-side live session must align with.
- `apps/relay/src/routes/ws-bridge.ts` — relay-side WebSocket auth, heartbeat, and bridge lifecycle handling.

### Existing Mobile UI and Rendering References
- `apps/web/app/sign-in/page.tsx` — current mobile-first single-column entry screen treatment.
- `apps/web/app/pair/[pairingId]/page.tsx` — server-component auth gate plus phone page shell pattern already used in `apps/web`.
- `apps/web/app/pair/[pairingId]/pairing-claim-flow.tsx` — current client-side mobile interaction style for subtle reconnect messaging, actionable errors, and one-screen state progression.
- `resources/gsd-2/web/app/api/session/events/route.ts` — reference SSE stream route and reconnect lifecycle from the substrate.
- `resources/gsd-2/docs/extending-pi/07-events-the-nervous-system.md` — reference event taxonomy for separating agent, tool, session, and approval activity.
- `resources/gsd-2/docs/extending-pi/14-custom-rendering-controlling-what-the-user-sees.md` — reference renderer patterns for distinct message/tool/state presentation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/app/sign-in/page.tsx` — existing phone-first layout, button sizing, and plain inline-style pattern that can seed the session shell.
- `apps/web/app/pair/[pairingId]/page.tsx` — established server-component auth gate pattern for protected mobile routes.
- `apps/web/app/pair/[pairingId]/pairing-claim-flow.tsx` — reusable client-side patterns for subtle reconnect hints, actionable status copy, and compact mobile state sections.
- `packages/protocol/src/bridge.ts` — shared zod schemas already define the session attach/history/event flow the remote UI needs to render and control.
- `packages/protocol/src/session.ts` — shared ws-ticket/device-session contracts for browser live-channel auth.
- `apps/bridge/src/daemon/relay-connection.ts` and `apps/relay/src/routes/ws-bridge.ts` — existing reconnect, heartbeat, and bridge registration lifecycle that Phase 3 must plug into rather than reinvent.

### Established Patterns
- `apps/web` currently favors simple server components plus lightweight client components with inline styles; there is not yet a shared design system or CSS utility layer in this app.
- Shared runtime payloads are validated with zod in `packages/protocol`, not left as ad hoc JSON.
- Auth gating happens on the server side with Auth.js session checks before a page renders.
- Current mobile UX copy is direct and actionable, with subtle reconnect/error hints instead of modal-heavy flows.
- Phase 2 locked the product to one active remote-controlled session at a time, so Phase 3 does not need multi-session browsing chrome.

### Integration Points
- Phase 3 will need new authenticated session route(s) in `apps/web/app/` for the session shell and any session attachment entry points.
- The live session UI will consume bridge-relay event envelopes from `packages/protocol/src/bridge.ts` and should keep browser-side state aligned with bridge reconnect semantics.
- Prompt and steer actions can build on the existing `turn.send` direction in the protocol; interrupt will require an explicit control path added intentionally through shared protocol contracts.
- Approval-state rendering should stay tied to structured bridge events rather than terminal bytes or log scraping.

</code_context>

<specifics>
## Specific Ideas

- The session should feel like a live remote window into Codex, not a raw terminal transcript and not a general shell surface.
- The active turn deserves the most space on the phone, but recent context must remain glanceable without leaving the page.
- Thumb-reach matters: composer, steer, and interrupt belong at the bottom edge where the user can act quickly with one hand.
- Reconnect cues should preserve continuity and confidence without ripping the user out of the timeline.
- Approval states should be impossible to miss, but should still live in-context with the turn that triggered them.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the Phase 3 boundary.

</deferred>

---

*Phase: 03-live-remote-ui-control*
*Context gathered: 2026-04-17*
