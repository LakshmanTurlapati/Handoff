# Phase 03: Live Remote UI & Control - Research

**Researched:** 2026-04-18
**Domain:** mobile live session UI, browser-relay WebSocket control, structured activity rendering
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Claude's Discretion
- Exact typography, spacing scale, color tokens, and motion treatment as long as activity types remain clearly distinct on a phone.
- The precise iconography and animation behavior for expand/collapse, reconnect, and stop-pending transitions.
- Whether retry/context actions render as inline buttons, a compact action row, or a secondary menu when backend support varies by event type.
- The exact component and hook breakdown between server components, client components, and shared state modules in `apps/web`.

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within the Phase 3 boundary.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-04 | User can start a new turn or steer an in-flight turn from the remote UI | Use one authenticated browser-relay WebSocket for `turn.send` plus a new explicit steer method, with sticky mobile controls and transition-based pending states. |
| SESS-05 | User can interrupt or intentionally end a remote session from the remote UI | Add a dedicated interrupt control and protocol method with pending-stop UI, explicit ack/fail events, and reducer state for intentional stops. |
| LIVE-01 | Remote UI streams Codex agent events, progress, and assistant output in near real time | Drive the page from a reducer over structured live events, not terminal bytes. Use browser WebSocket plus replay/backfill cursor support for reconnect. |
| LIVE-02 | Remote UI distinguishes agent messages, tool activity, command execution, and approval state instead of showing one undifferentiated log | Normalize payloads into card variants keyed by activity type and render them in turn-grouped cards with collapse rules from the UI-SPEC. |
| LIVE-04 | Remote UI is usable on phone-sized screens without requiring a full desktop terminal layout | Keep the route server-rendered by default, isolate interactivity in a thin client shell, and enforce sticky thumb-reach controls plus compressed historical turns. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Deploy public web and relay on Fly.io; the developer machine stays outbound-only.
- Preserve Codex approval and sandbox semantics end to end.
- Keep the product a remote window into local Codex, not a shell, SSH, or tmux tunnel.
- Put new product code under top-level `apps/` and `packages/`, not under `resources/gsd-2/`.
- Model remote activity as structured product events; terminal bytes are supplemental only.
- Validate every relay message and control-plane payload at runtime.
- Design mobile-first; phone usability is a first-order requirement.
- Build reconnect, revocation, and audit behavior into the initial implementation instead of deferring it.

## Summary

Phase 03 should use a server-gated Next.js route that renders a small client-side session shell. The server side should authenticate the paired device session and bootstrap initial session metadata. The client side should own exactly the live parts: WebSocket connection management, timeline reducer state, sticky composer interactions, auto-follow, reconnect banners, and pending-stop feedback. This keeps secrets and auth on the server while minimizing client bundle size for phone browsers.

The main technical risk is not the UI chrome. It is the live event contract. The current shared protocol exposes `session.history`, `session.event`, `turn.send`, and `approval.respond`, but it does not yet define browser-facing event sequencing, replay cursors, steer, or interrupt semantics. Planning should therefore lock the browser-relay envelope before UI implementation starts. Without event IDs or monotonic sequence numbers, reconnect backfill, dedupe, and active-turn grouping will be brittle and will force a rewrite.

Testing also needs explicit Wave 0 attention. The repo has Vitest and Playwright configuration, but `node_modules` is absent, Playwright is not installed locally, Vitest is currently Node-only, and there is no phase-specific component-test project. The plan should add jsdom + React Testing Library for fast client-component and reducer tests, then add a mobile Playwright slice for end-to-end live session behavior.

**Primary recommendation:** Use one browser-relay WebSocket authenticated by a short-lived ws-ticket minted by `apps/web`, render the session with a reducer-driven client shell over structured events, and add replay-safe event metadata before building the turn-grouped mobile timeline.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | `16.2.2` (repo-pinned; latest `16.2.4`) | Server-rendered session page plus same-origin route handlers for auth-gated bootstrap and ticket minting | App Router defaults pages to Server Components and recommends moving only interactive code behind `'use client'` boundaries. |
| `react` | `19.2.4` (repo-pinned; latest `19.2.5`) | Client session shell, reducer state, transitions, and effect events | React 19 gives the hooks needed for reducer-based live state, non-blocking control actions, and stable effect listeners. |
| `zod` | `4.3.6` | Runtime validation for browser-relay control payloads and event envelopes | Already the project standard for trust-boundary payload validation. |
| `@codex-mobile/protocol` | `0.1.0` | Shared session, bridge, and live-control contracts | Keeps browser, relay, and bridge semantics aligned and auditable. |
| `@fastify/websocket` | `11.2.0` | Relay-side browser WebSocket route | Fastify-native WebSocket handling fits the existing relay architecture and is already imported in repo code. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Browser `WebSocket` API | baseline | Direct browser-relay live channel | Use for the near-real-time event stream and bidirectional prompt/steer/interrupt requests. |
| `@testing-library/react` | `16.3.2` | Client component and interaction tests | Use for sticky composer, turn cards, approval cards, and jump-to-live behavior. |
| `@testing-library/dom` | `10.4.1` | DOM-level query helpers | Companion dependency for React Testing Library. |
| `jsdom` | `29.0.2` | Browser-like test environment for Vitest | Required for unit-testing React client components in this phase. |
| `@vitejs/plugin-react` | `6.0.1` | React transform in Vitest config | Needed if Phase 03 adds a jsdom-based Vitest project. |
| `vite-tsconfig-paths` | `6.1.1` | TS path resolution in Vitest | Needed if tests import workspace aliases the same way app code does. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single browser-relay WebSocket | SSE for reads plus POST routes for controls | SSE simplifies reconnect, but Phase 03 needs low-latency prompt/steer/interrupt and would split state across two transports. |
| Reducer-owned live timeline state | React Query cache or Zustand store | Query caches fit request/response data better than ordered streaming event logs. Zustand would be extra global state before the event model is stable. |
| Dedicated browser session route (`/ws/session`) | Reusing the existing bridge route | A separate browser route keeps auth, ownership checks, and browser message semantics isolated from bridge registration semantics. |

**Installation:**
```bash
npm install --workspace apps/relay @fastify/websocket@11.2.0
npm install -D @testing-library/react@16.3.2 @testing-library/dom@10.4.1 jsdom@29.0.2 @vitejs/plugin-react@6.0.1 vite-tsconfig-paths@6.1.1
```

**Version verification:**
- `next` latest registry version: `16.2.4` published `2026-04-15T22:33:47.905Z`. Repo is pinned to `16.2.2`; do not upgrade frameworks inside Phase 03.
- `react` latest registry version: `19.2.5` published `2026-04-08T18:39:24.455Z`. Repo is pinned to `19.2.4`; do not upgrade frameworks inside Phase 03.
- `zod` latest registry version: `4.3.6` published `2026-01-22T19:14:35.382Z`.
- `@fastify/websocket` latest registry version: `11.2.0` published `2025-07-14T11:14:07.378Z`.
- `@testing-library/react` latest registry version: `16.3.2` published `2026-01-19T10:59:08.185Z`.
- `jsdom` latest registry version: `29.0.2` published `2026-04-07T03:38:38.430Z`.

## Architecture Patterns

### Recommended Project Structure

```text
apps/web/
├── app/
│   ├── sessions/[sessionId]/page.tsx                 # server auth gate + bootstrap
│   ├── sessions/[sessionId]/loading.tsx              # mobile loading shell
│   └── api/sessions/[sessionId]/ws-ticket/route.ts   # same-origin ticket mint
├── components/session/
│   ├── session-shell.tsx                             # client root
│   ├── session-timeline.tsx                          # turn-grouped renderer
│   ├── turn-card.tsx                                 # assistant/tool/command/approval cards
│   └── session-controls.tsx                          # sticky composer + steer + interrupt
└── lib/session/
    ├── live-connection.ts                            # WebSocket hook
    ├── timeline-reducer.ts                           # event -> UI state
    ├── activity-normalizer.ts                        # bridge payload -> card model
    └── auto-follow.ts                                # jump-to-live and scroll policy

apps/relay/src/routes/
└── ws-session.ts                                     # browser live channel

packages/protocol/src/
└── bridge.ts                                         # extend with browser event cursor, steer, interrupt
```

### Pattern 1: Server Page + Thin Client Shell

**What:** Keep the session page as a Server Component that authenticates, loads initial session metadata, and passes only serializable bootstrap props into a client session shell.

**When to use:** All new live session routes in `apps/web`.

**Example:**
```tsx
// Source: https://nextjs.org/docs/app/getting-started/server-and-client-components
import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { SessionShell } from "../../../components/session/session-shell";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/sign-in?callbackUrl=/sessions/${sessionId}`);
  }

  return (
    <SessionShell
      sessionId={sessionId}
      initialState={{ connection: "connecting", turns: [] }}
    />
  );
}
```

### Pattern 2: Reducer-Owned Timeline State

**What:** Model the live screen as a reducer over structured events and local UI actions instead of scattered `useState` calls.

**When to use:** Turn grouping, collapse rules, reconnect backfill, jump-to-live visibility, pending-stop state, and approval emphasis.

**Example:**
```ts
// Source: https://react.dev/reference/react/useReducer
type TimelineAction =
  | { type: "event.received"; event: SessionEvent }
  | { type: "event.replayed"; events: SessionEvent[] }
  | { type: "turn.toggle"; turnId: string }
  | { type: "scroll.leftLive" }
  | { type: "scroll.returnedLive" }
  | { type: "interrupt.requested" }
  | { type: "interrupt.acknowledged" }
  | { type: "connection.lost" }
  | { type: "connection.restored"; replayFrom?: number };

function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case "event.received":
      return applyEvent(state, action.event);
    case "event.replayed":
      return action.events.reduce(applyEvent, state);
    case "interrupt.requested":
      return { ...state, pendingInterrupt: true };
    case "interrupt.acknowledged":
      return { ...state, pendingInterrupt: false };
    default:
      return state;
  }
}
```

### Pattern 3: Ticket Mint + WebSocket Hook

**What:** Mint a short-lived ws-ticket through a same-origin route handler, then open the browser WebSocket with the ticket in the protocol slot and keep the listener stable with `useEffectEvent`.

**When to use:** Live session shell mount and reconnect cycles.

**Example:**
```tsx
// Source: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
// Source: https://react.dev/reference/react/useEffectEvent
import { useEffect, useEffectEvent } from "react";

function useLiveSession(sessionId: string, dispatch: (action: TimelineAction) => void) {
  const onMessage = useEffectEvent((event: MessageEvent<string>) => {
    dispatch({
      type: "event.received",
      event: JSON.parse(event.data) as SessionEvent,
    });
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;

    async function connect() {
      const res = await fetch(`/api/sessions/${sessionId}/ws-ticket`, {
        method: "POST",
        cache: "no-store",
      });
      const { ticket, relayUrl } = await res.json();
      if (cancelled) return;

      socket = new WebSocket(relayUrl, ["codex-mobile.live.v1", ticket]);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", () => dispatch({ type: "connection.lost" }));
    }

    void connect();
    return () => {
      cancelled = true;
      socket?.close(1000, "session shell unmounted");
    };
  }, [sessionId, onMessage, dispatch]);
}
```

### Pattern 4: Non-Blocking Control Actions

**What:** Wrap prompt, steer, and interrupt UI transitions in `useTransition` so the text input stays responsive while network state settles.

**When to use:** Sticky composer submit, steer send, and interrupt request.

**Example:**
```tsx
// Source: https://react.dev/reference/react/useTransition
import { useTransition } from "react";

function SessionControls({ send }: { send: (msg: ControlMessage) => Promise<void> }) {
  const [isPending, startTransition] = useTransition();

  function handleInterrupt() {
    startTransition(async () => {
      await send({ type: "session.interrupt" });
    });
  }

  return (
    <button disabled={isPending} onClick={handleInterrupt}>
      {isPending ? "Interrupting..." : "Interrupt"}
    </button>
  );
}
```

### Anti-Patterns to Avoid

- **Whole-route clientification:** Do not mark the entire session page `'use client'`. Keep auth, ticket minting, and bootstrap data on the server.
- **Raw transcript rendering:** Do not treat terminal bytes as the source of truth. The UI contract requires structured activity cards.
- **Browser header auth assumptions:** Do not plan around `Authorization` headers in the browser WebSocket constructor. The constructor surface is `url` plus optional `protocols`, so Phase 03 must use the protocol slot or another browser-supported mechanism.
- **Append-only event arrays without cursors:** Do not attempt reconnect backfill without event IDs or sequence numbers. Duplicate and out-of-order cards will follow.
- **Blocking reconnect overlays:** Do not blank the screen on short disconnects. The locked UI behavior is inline continuity with a subtle banner and backfill separator.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser live-channel auth | Long-lived browser bearer auth in query params or localStorage | Existing ws-ticket model from `packages/auth` and `packages/protocol/session.ts` | The trust-boundary ADR already defines short-lived derived tickets and forbids public bearer storage. |
| Timeline state | Ad hoc `useState` booleans spread across cards | One typed reducer for live session state | Turn grouping, replay, and pending-stop state need deterministic ordered transitions. |
| Reconnect replay | Naive reconnect that just appends new events | Monotonic sequence or event ID cursor with replay flag | Without dedupe keys, backfill will duplicate or mis-order cards after reconnect. |
| DOM interaction tests | Manual DOM queries and bespoke helpers | React Testing Library + jsdom | The standard ecosystem already covers accessible DOM querying and interaction semantics. |
| Mobile E2E harness | Hand-scripted browser smoke steps | Playwright mobile project | Phone-sized viewport behavior, sticky controls, and reconnect flows need automation at the browser level. |

**Key insight:** The phase is not difficult because of React rendering. It is difficult because ordered event streams, reconnect replay, and mobile compression rules create state-machine problems. Build around a typed event reducer and stable contracts, not around optimistic UI fragments.

## Common Pitfalls

### Pitfall 1: Browser WebSocket auth does not match the current relay route
**What goes wrong:** The browser cannot connect even though bridge WebSockets work.
**Why it happens:** The existing relay route accepts bridge auth via `Authorization` header or query param. The browser WebSocket constructor exposes `url` and optional `protocols`, not arbitrary headers.
**How to avoid:** Add a dedicated browser session route that accepts the ws-ticket from `Sec-WebSocket-Protocol` and validates ownership against the ticket claims.
**Warning signs:** Browser connect attempts fail before any message handling, or auth only works in Node test clients.

### Pitfall 2: Reconnect backfill duplicates cards
**What goes wrong:** After a transient disconnect, the active turn shows duplicate assistant chunks or repeated tool cards.
**Why it happens:** `SessionEventParamsSchema` currently has `sessionId`, `eventType`, and `payload` only. That is not enough for idempotent replay.
**How to avoid:** Extend the event envelope with at least `eventId`, `sequence`, `turnId`, and `occurredAt`, and have the reducer discard already-seen events.
**Warning signs:** The `Reconnected` separator appears, but the live turn suddenly grows repeated content or out-of-order states.

### Pitfall 3: The active turn loses dominance on a phone screen
**What goes wrong:** The user has to scroll through old content to understand the live turn.
**Why it happens:** A raw append-only list treats every historical event equally.
**How to avoid:** Keep historical turns compressed, auto-fold completed tool details, and reserve the strongest contrast and open panels for the active turn only.
**Warning signs:** The sticky controls are on-screen, but the active step is not visible without manual expansion or excessive scrolling.

### Pitfall 4: Control actions block typing or feel laggy
**What goes wrong:** Tapping `Steer` or `Interrupt` freezes the composer or causes accidental double-submits.
**Why it happens:** Control network requests are tied directly to normal input state updates.
**How to avoid:** Use `useTransition` for send/steer/interrupt actions and keep the text input state outside transition-managed updates.
**Warning signs:** Keyboard input janks during network operations or buttons stay tappable after the request has already been issued.

### Pitfall 5: Unit tests target the wrong layer
**What goes wrong:** Tests are fragile, slow, or impossible to write for the new UI.
**Why it happens:** The current Vitest workspace is Node-only, and Next.js docs explicitly call out that async Server Components are better covered by E2E tests.
**How to avoid:** Unit-test pure reducers and client components with jsdom, and reserve Playwright for async page integration, reconnect, and mobile layout behavior.
**Warning signs:** Test files start mocking half of Next.js or attempt to fully render async server routes inside Vitest.

## Code Examples

Verified patterns from official sources:

### Server-Rendered Page Bootstrapping a Client Shell
```tsx
// Source: https://nextjs.org/docs/app/getting-started/server-and-client-components
import Link from "next/link";
import SessionShell from "./session-shell";

export default function Page() {
  return (
    <div>
      <Link href="/">Back</Link>
      <SessionShell sessionId="demo" />
    </div>
  );
}
```

### Stable WebSocket Listener with Latest Reducer Access
```tsx
// Source: https://react.dev/reference/react/useEffectEvent
const onSocketMessage = useEffectEvent((raw: string) => {
  dispatch({
    type: "event.received",
    event: JSON.parse(raw) as SessionEvent,
  });
});
```

### Accessible Component Test Shape
```tsx
// Source: https://testing-library.com/docs/react-testing-library/intro/
import { render, screen } from "@testing-library/react";

it("shows Jump to live after the user leaves auto-follow", () => {
  render(<SessionTimeline state={stateLeavingLive} />);
  expect(screen.getByRole("button", { name: "Jump to live" })).toBeVisible();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full-route client bundles for interactive pages | Server Components by default with focused client islands | Next.js App Router docs updated 2026-03-16 | Better phone performance and no accidental secret leakage into the client bundle. |
| Read-only SSE event feeds plus separate POST actions | One authenticated bidirectional browser-relay WebSocket | Product trust-boundary ADR accepted 2026-04-10 | One transport can handle live events and low-latency control actions consistently. |
| Node-only unit tests for backend logic only | Vitest + jsdom + React Testing Library for client units, Playwright for async page flows | Next.js testing guidance updated 2026-03-31 | Faster UI feedback plus realistic mobile validation. |

**Deprecated/outdated:**
- Query-param or localStorage live auth in the browser: replaced by 60-second ws-tickets derived from device sessions.
- Raw token-by-token streaming UI on mobile: replaced by readable chunk streaming per the approved UI-SPEC.
- Reconnect screens that fully block the timeline: replaced by inline reconnect banners and replay separators.

## Open Questions

1. **Does Phase 03 also need to finish the browser attach/bootstrap surface that Phase 02 has not exposed yet?**
   - What we know: `packages/protocol/src/bridge.ts` defines `session.attach`, but `apps/web` has no session route or browser-facing attach handler today.
   - What's unclear: Whether attach/list APIs already exist outside the scanned repo surface or must be added inside this phase.
   - Recommendation: Treat a minimal browser bootstrap/attach endpoint as part of Plan `03-02` unless the planner confirms a hidden Phase 02 artifact already handles it.

2. **What exact event envelope can the UI rely on for grouping and replay?**
   - What we know: Current `SessionEventParamsSchema` is too generic for replay-safe rendering.
   - What's unclear: Whether bridge events already carry `turnId`, per-item IDs, timestamps, or sequence numbers inside `payload`.
   - Recommendation: Lock the normalized event envelope before building timeline components. Do not let renderer work start on a vague payload shape.

3. **Is `apps/web/app/layout.tsx` intentionally absent, or is the web app currently incomplete?**
   - What we know: Repo scan found no `layout.tsx` under `apps/web/app/`.
   - What's unclear: Whether another build path provides it or whether the app has not yet been made buildable end-to-end.
   - Recommendation: Confirm this in Wave 0. If absent, add the smallest possible root layout before layering in session routes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Next.js, relay, bridge, Vitest | yes | `v25.9.0` | none |
| npm workspaces | package install, scripts, test runners | yes | `11.12.1` | none |
| Codex CLI | Real end-to-end session testing with `codex app-server` | yes | `codex-cli 0.119.0-alpha.28` | mocked bridge stream for automated tests |
| Workspace dependencies (`node_modules`) | any build, typecheck, test, or Next dev run | no | - | none |
| Playwright tooling | phone-sized end-to-end automation | no | - | manual smoke testing until dependencies are installed |

**Missing dependencies with no fallback:**
- The workspace has no installed dependencies yet. `npm install` or `npm ci` is required before any build or automated test plan can run.
- `apps/relay/src/routes/ws-bridge.ts` imports `@fastify/websocket`, but `apps/relay/package.json` does not currently declare it. That package needs to be added before relay builds can be trusted.

**Missing dependencies with fallback:**
- Playwright is not installed locally. Phase 03 can still start with reducer/component tests plus manual phone smoke checks, but mobile E2E automation should be restored before phase completion.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `2.1.8` + Playwright `1.58.2` |
| Config file | `vitest.workspace.ts`, `playwright.config.ts` |
| Quick run command | `npm exec vitest run --project phase-03-unit` |
| Full suite command | `npm exec vitest run --project phase-03-unit && npx playwright test --project=phase-03-e2e-mobile` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-04 | Prompt and steer controls send the correct live messages and show pending UI without freezing input | unit + e2e | `npm exec vitest run --project phase-03-unit -- apps/web/tests/unit/session-controls.test.tsx` | no - Wave 0 |
| SESS-05 | Interrupt enters pending-stop state, keeps timeline live, and resolves only on ack/fail event | unit + e2e | `npm exec vitest run --project phase-03-unit -- apps/web/tests/unit/session-interrupt.test.tsx` | no - Wave 0 |
| LIVE-01 | Live session stream appends readable chunks and replays missed events after reconnect | unit + relay unit + e2e | `npm exec vitest run --project phase-03-unit -- apps/web/tests/unit/timeline-reducer.test.ts apps/relay/tests/unit/ws-session.test.ts` | no - Wave 0 |
| LIVE-02 | Assistant, tool, command, approval, system, and error activity render as distinct card treatments | unit + e2e | `npm exec vitest run --project phase-03-unit -- apps/web/tests/unit/activity-renderer.test.tsx` | no - Wave 0 |
| LIVE-04 | Session shell remains usable on phone-sized screens with sticky controls and compressed history | e2e | `npx playwright test apps/web/tests/session-live-mobile.spec.ts --project=phase-03-e2e-mobile` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** `npm exec vitest run --project phase-03-unit`
- **Per wave merge:** `npm exec vitest run --project phase-03-unit && npx playwright test --project=phase-03-e2e-mobile`
- **Phase gate:** Full suite green plus one manual phone-browser reconnect smoke test with a real bridge session

### Wave 0 Gaps

- [ ] `vitest.workspace.ts` needs a new `phase-03-unit` project with `jsdom` instead of the current Node-only setup.
- [ ] Install `@testing-library/react`, `@testing-library/dom`, `jsdom`, `@vitejs/plugin-react`, and `vite-tsconfig-paths`.
- [ ] `playwright.config.ts` needs a phase-specific mobile project or the existing mobile project must be extended intentionally for Phase 03.
- [ ] Add `apps/web/tests/unit/session-controls.test.tsx`.
- [ ] Add `apps/web/tests/unit/timeline-reducer.test.ts`.
- [ ] Add `apps/web/tests/unit/activity-renderer.test.tsx`.
- [ ] Add `apps/relay/tests/unit/ws-session.test.ts`.
- [ ] Add `apps/web/tests/session-live-mobile.spec.ts`.

## Sources

### Primary (HIGH confidence)
- Local repo: `.planning/phases/03-live-remote-ui-control/03-CONTEXT.md` - locked UI and control decisions
- Local repo: `.planning/phases/03-live-remote-ui-control/03-UI-SPEC.md` - approved mobile visual and interaction contract
- Local repo: `.planning/phases/02-bridge-codex-session-adapter/02-RESEARCH.md` - prior bridge/session event research this phase builds on
- Local repo: `packages/protocol/src/bridge.ts` - current bridge/relay contracts and missing browser control methods
- Local repo: `packages/protocol/src/session.ts` - ws-ticket and device-session browser contract
- Local repo: `apps/relay/src/routes/ws-bridge.ts` - current relay WebSocket auth and registry behavior
- Local repo: `apps/bridge/src/daemon/relay-connection.ts` - reconnect/backoff behavior already implemented for the bridge
- Next.js docs: https://nextjs.org/docs/app/getting-started/server-and-client-components - Server vs Client Component boundaries
- Next.js docs: https://nextjs.org/docs/app/guides/testing/vitest - current Next.js guidance for Vitest + React Testing Library
- React docs: https://react.dev/reference/react/useReducer - reducer pattern for ordered UI state
- React docs: https://react.dev/reference/react/useEffectEvent - stable effect-side event listeners with latest values
- React docs: https://react.dev/reference/react/useTransition - non-blocking pending UI for control actions
- MDN: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket - browser WebSocket constructor surface (`url`, `protocols`)

### Secondary (MEDIUM confidence)
- Testing Library docs: https://testing-library.com/docs/react-testing-library/intro/ - accessible, user-centered component testing guidance
- Next.js docs: https://nextjs.org/docs/pages/guides/testing/playwright - production-like Playwright execution guidance
- GitHub README: https://github.com/fastify/fastify-websocket - Fastify WebSocket route patterns

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - framework and testing guidance are current, but the repo is intentionally staying on pinned Next/React patch versions and test dependencies are not installed yet.
- Architecture: MEDIUM - the server/client and browser/relay split is clear, but the final event envelope and browser WebSocket route still need a concrete contract.
- Pitfalls: HIGH - the main failure modes are already visible from the current repo shape, approved UI contract, and official browser/React constraints.

**Research date:** 2026-04-18
**Valid until:** 2026-05-02
