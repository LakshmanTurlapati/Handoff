---
phase: 03-live-remote-ui-control
plan: 03
subsystem: live-client
tags: [nextjs, react, websocket, mobile, vitest, playwright]
dependency_graph:
  requires:
    - phase: 03-live-remote-ui-control
      plan: 01
      provides: reducer-driven mobile session shell, typed activity cards, and sticky composer scaffold
    - phase: 03-live-remote-ui-control
      plan: 02
      provides: browser live-session protocol, relay/browser websocket transport, and auth-gated session connect/command routes
  provides:
    - transport-backed mobile session shell with reconnect, approval, and prompt/steer/interrupt controls
    - browser transport helper with websocket bootstrap, replay cursor reconnect, and HTTP fallback commands
    - jsdom/react-testing-library coverage plus a gated mobile smoke spec for the live session shell
  affects:
    - apps/web/app/session/[sessionId]/session-shell.tsx
    - apps/web/components/session/activity-card.tsx
    - apps/web/components/session/approval-card.tsx
    - apps/web/components/session/composer.tsx
    - apps/web/components/session/jump-to-live.tsx
    - apps/web/components/session/reconnect-banner.tsx
    - apps/web/components/session/turn-card.tsx
    - apps/web/lib/live-session/transport.ts
    - apps/web/package.json
    - apps/web/tests/setup.ts
    - apps/web/tests/unit/session-shell.test.tsx
    - apps/web/tests/live-session-mobile.spec.ts
    - vitest.workspace.ts
tech_stack:
  added: []
  patterns:
    - browser websocket bootstrap through the same-origin connect route plus ws-ticket subprotocol auth
    - reducer-driven optimistic system and error activities around remote prompt/steer/approval/interrupt actions
    - split Vitest workspace with node tests for shared logic and jsdom tests for the mobile session shell
key_files:
  created:
    - apps/web/components/session/approval-card.tsx
    - apps/web/components/session/jump-to-live.tsx
    - apps/web/components/session/reconnect-banner.tsx
    - apps/web/lib/live-session/transport.ts
    - apps/web/tests/setup.ts
    - apps/web/tests/unit/session-shell.test.tsx
    - apps/web/tests/live-session-mobile.spec.ts
  modified:
    - apps/web/app/session/[sessionId]/session-shell.tsx
    - apps/web/components/session/activity-card.tsx
    - apps/web/components/session/composer.tsx
    - apps/web/components/session/turn-card.tsx
    - apps/web/package.json
    - vitest.workspace.ts
decisions:
  - "Keep the mobile session shell reducer-driven and transport-backed instead of introducing a new hook abstraction mid-phase; the live shell owns the user-facing reconnect and pending-state behavior directly."
  - "Use a dedicated browser transport helper that boots from `/api/sessions/[sessionId]/connect`, reconnects with the replay cursor, and falls back to POST command dispatch when the websocket is not ready."
  - "Gate the Playwright mobile smoke spec at file scope with `CODEX_MOBILE_E2E_LIVE` so normal validation skips cleanly without local browser installs or a running dev server."
metrics:
  duration_seconds: 748
  completed: 2026-04-18T07:51:42Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 6
requirements:
  - LIVE-01
  - LIVE-04
  - SESS-04
  - SESS-05
---

# Phase 03 Plan 03: Connected Mobile Shell Summary

Finished the real mobile remote-control surface by wiring the session shell onto the live transport, adding inline reconnect and approval affordances, and covering the shell with jsdom and gated mobile smoke verification.

## Task Results

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Wire the session shell to the live transport and reconnect lifecycle | 094ab08 | Added `connectLiveSession` and `sendSessionCommand`, bootstrapped the shell from the real connect route, replay-aware reconnect handling, inline reconnect banner rendering, and `Jump to live` follow-mode controls |
| 2 | Finish prompt, steer, interrupt, approval, and error affordances for phone use | 094ab08 | Added approval, reconnect, and jump components, routed approval/error actions through the live shell, expanded error cards with retry/context actions, and kept prompt/steer/interrupt pending states visible in-context |
| 3 | Add automated coverage for connected session shell behavior on unit and mobile smoke paths | 214a0b0 | Added the `phase-03-web` jsdom Vitest project, RTL/jest-dom setup, session-shell unit tests, and a gated Playwright phone-viewport smoke spec |

## Decisions Made

1. **Transport-first shell integration:** The shell now talks to the relay through a browser transport helper rather than keeping a local fixture-only adapter. This makes reconnect, replay cursor handling, and command fallback explicit and testable.

2. **In-context failure handling:** Prompt, steer, approval, and interrupt actions append optimistic system/error activities inside the active turn instead of relying on out-of-band toasts. That preserves mobile context and matches the turn-grouped UI contract.

3. **Gated live-browser smoke coverage:** The Playwright spec remains part of the phase contract, but it skips cleanly unless `CODEX_MOBILE_E2E_LIVE=1` is present. That keeps default verification deterministic while documenting the real-device path needed before broad rollout.

## Deviations from Plan

None in scope. The only harness adjustment beyond the original task list was moving the Playwright live-server gate to file scope so the spec skips before browser launch when the live environment is unavailable.

## Issues Encountered

- The new jsdom test project initially failed because `jsdom` was not installed yet; re-running `npm install --no-package-lock` after adding the web dev dependencies resolved that.
- Vitest needed explicit automatic JSX handling for `.tsx` shell tests. The workspace now sets `esbuild.jsx = "automatic"` for the `phase-03-web` project.
- The original `Jump to live` test failed in jsdom because `scrollIntoView` does not move the viewport there. The unit test now simulates the browser scroll that follows a real jump-to-live action.

## Verification

- `npx vitest run --project phase-01-unit --project phase-03-web apps/web/tests/unit/live-session-reducer.test.ts apps/relay/tests/unit/ws-browser.test.ts apps/web/tests/unit/session-connect-route.test.ts apps/web/tests/unit/session-shell.test.tsx`
- `npx playwright test apps/web/tests/live-session-mobile.spec.ts` (skips cleanly unless `CODEX_MOBILE_E2E_LIVE=1`)

## Next Phase Readiness

- Phase 03 now has a real browser-live shell rather than a static timeline. Prompt, steer, approval, interrupt, reconnect, and follow-mode behavior all exist on the phone UI.
- Remaining validation for this phase is hardware-backed: real reconnect interruption, on-screen keyboard composer behavior, and approval clarity on an actual phone.
- Phase 04 can now build on concrete remote-control behavior instead of placeholders, especially for approval audit, revocation, and reconnect safety.

## Self-Check

- All required artifacts for transport wiring, reconnect banner, jump control, approval card, jsdom config, and smoke coverage exist on disk.
- The targeted phase verification slice passed: 14 tests green across relay, web route, reducer, and connected shell coverage.
- The gated Playwright spec no longer fails normal validation when the live E2E environment is absent.

---
*Phase: 03-live-remote-ui-control*
*Completed: 2026-04-18*
