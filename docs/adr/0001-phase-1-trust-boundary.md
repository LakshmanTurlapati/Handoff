# ADR 0001: Phase 1 Trust Boundary

**Status:** Accepted
**Phase:** 1 - Identity & Pairing Foundation
**Date:** 2026-04-10
**Related requirements:** AUTH-01, AUTH-02, PAIR-03, PAIR-04, PAIR-05, SEC-01, SEC-06, OPS-01

## Context

Codex Mobile is an internet-facing remote-control layer for a developer's
local Codex session. Before we write pairing routes, device-management
routes, or relay transport, we need an explicit and unambiguous map of
which component is trusted with what, which credentials cross which
boundary, and what each boundary is allowed to assume about the caller on
the other side.

Phase 1 freezes that map. Every later plan in this phase, and in phases 2
through 5, is required to respect the boundaries and credential lifetimes
defined here. Deviations must come back here as a new ADR, not as a silent
change in code.

## Decision

Codex Mobile has five distinct trust zones: the user's **Browser**, the
public **Web App**, the public **Relay**, the **Local Bridge** running on
the developer's machine, and **Codex** itself. Each zone has an explicit
purpose, a strict set of credentials it is allowed to hold, and a strict
set of outbound connections it is allowed to make.

### Browser

- Runs on a phone or laptop browser, outside the developer's LAN.
- Holds exactly two first-party cookies:
  - `cm_web_session`: HttpOnly, Secure, SameSite=Lax, 12-hour rolling
    window. Used only for page navigation and REST calls to the Web App.
  - `cm_device_session`: HttpOnly, Secure, SameSite=Lax, 7-day absolute
    expiry. Issued only after a pairing is confirmed in the local terminal.
- May hold, in memory only, a short-lived `cm_ws_ticket` minted by the
  Web App. This ticket is never persisted to `localStorage`, never
  written to a query string, and never embedded in a URL fragment.
- Must never talk directly to the Local Bridge, the local machine, or
  `codex app-server`. All traffic flows through the public Web App and
  the public Relay.
- Origin, CSRF, and replay protections are enforced server-side for every
  browser-to-server request.

### Web App

- Hosted on Fly.io as `apps/web` (Next.js).
- Owns: GitHub OAuth sign-in, session issuance, pairing lifecycle,
  verification phrase rendering, device-session issuance and rotation,
  and minting of WebSocket upgrade tickets.
- Reads and writes `users`, `oauth_accounts`, `web_sessions`,
  `device_sessions`, `pairing_sessions`, and `audit_events` in Postgres.
- Trusts the Browser only to the extent of a validly signed
  `cm_web_session` or `cm_device_session` cookie. The cookie is not the
  source of truth; the server always confirms the matching row in
  Postgres has not been revoked or expired.
- Must not proxy arbitrary traffic to the Local Bridge. The only thing
  the Web App hands the Browser for live channels is a single-use,
  60-second `cm_ws_ticket` — no raw device credentials ever cross the
  wire to the Browser or to the Relay.

### Relay

- Hosted on Fly.io as `apps/relay` (Fastify + `ws`).
- Owns: bridge registration, browser WebSocket upgrade validation, and
  live-channel fanout between Browser and Local Bridge.
- Accepts an inbound WebSocket from the Browser only after successfully
  verifying the `cm_ws_ticket` JWT against the shared `WS_TICKET_SECRET`,
  enforcing the 60-second expiry, and recording the `jti` for single-use.
- Accepts an outbound-initiated WebSocket from the Local Bridge using a
  separately scoped bridge credential (defined in Phase 2). The Relay
  never receives a browser session cookie or a device session cookie.
- Must never receive, log, or persist any raw pairing token or device
  session token. It operates on already-authenticated identifiers only.

### Local Bridge

- Runs on the developer's machine as `apps/bridge`.
- Opens **outbound** WSS connections to the public Relay. It never
  listens on an inbound port and never exposes any service to the LAN
  or to the internet.
- Owns: terminal QR rendering, terminal confirmation prompt, and the
  local connection to `codex app-server` over `stdio`.
- Communicates with Codex over the local app-server JSON-RPC stdio
  protocol only. Does not start Codex in any networked transport mode.
- Preserves Codex sandbox and approval semantics exactly as Codex itself
  enforces them; it surfaces and forwards decisions but never broadens
  them.

### Codex

- Runs as a child process of the Local Bridge using `codex app-server`
  over `stdio`.
- Has no direct network exposure and no direct connection to the Web
  App, the Relay, or the Browser. **No direct public exposure of codex
  app-server** is permitted in Phase 1.
- All session state Codex Mobile renders in the Browser is first
  normalized into product-owned structured events by the Local Bridge.

## Rules

The following rules are binding for all Phase 1 plans and any subsequent
phase that touches the same boundaries.

1. **No direct public exposure of codex app-server.** Neither the Local
   Bridge nor any hosted service may start or proxy `codex app-server`
   on a publicly reachable transport. Codex is always spawned locally
   with stdio-only transport and approvals preserved.
2. **Browser sessions use cookies, not bearer tokens.** The Browser
   authenticates to the Web App using `cm_web_session` and
   `cm_device_session` HttpOnly Secure SameSite=Lax cookies. Bearer
   tokens are never placed in URL query params, URL fragments, or
   `localStorage` for the public product.
3. **Pairing tokens are single-use and time-boxed.** Every
   `pairing_sessions` row is created with `status = pending`, an absolute
   expiry within minutes, a hashed single-use pairing token, and a
   verification phrase that is rendered identically in the terminal and
   the browser before the device session is issued.
4. **Live channels use short-lived derived tickets.** The Browser never
   authenticates its WebSocket using the device session cookie directly.
   Instead, the Web App mints a single-use `cm_ws_ticket` JWT with a
   strict 60-second expiry, signed with `WS_TICKET_SECRET`. The Relay
   verifies the ticket, enforces the 60-second window, and records the
   `jti` to prevent replay. This 60-second ticket lifetime is the
   maximum window any captured ticket remains valid.
5. **The local machine never accepts inbound connections.** The Local
   Bridge is outbound-only. It opens a WSS connection to the public
   Relay and speaks to Codex on its own machine over stdio. Nothing
   listens on a port.
6. **Every trust boundary is logged.** Pairing start, pairing redeem,
   pairing confirm, pairing expire, pairing cancel, device session
   issue, device session rotate, device session revoke, and ws-ticket
   mint or reject events are appended to `audit_events`.

## Consequences

- Phase 1 Plan 2 can implement GitHub OAuth, pairing routes, terminal QR
  flow, and device session issuance without re-litigating cookie flags
  or ticket lifetimes.
- Phase 1 Plan 3 can deploy the public Web App and Relay on Fly.io
  knowing that neither service ever needs an inbound path to the
  developer machine.
- Phase 2 bridge work must open an outbound WSS connection to the Relay
  and will need its own bridge-scoped credential defined in a follow-up
  ADR; it must not inherit `cm_device_session` or `cm_ws_ticket`.
- Operators must rotate `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`,
  and `WS_TICKET_SECRET` independently; leaking one must not compromise
  the others.

## References

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/01-identity-pairing-foundation/01-RESEARCH.md`
- `.planning/phases/01-identity-pairing-foundation/01-VALIDATION.md`
- `packages/auth/src/device-session.ts`
- `packages/auth/src/ws-ticket.ts`
- OWASP Session Management Cheat Sheet
- OWASP QRLJacking
- OpenAI Codex App Server docs
- OpenAI Codex Agent Approvals & Security docs
