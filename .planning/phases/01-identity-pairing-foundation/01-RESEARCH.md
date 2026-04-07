# Phase 1 Research: Identity & Pairing Foundation

**Phase:** 1
**Goal:** Establish a secure internet-facing entry point for Codex Mobile with QR-based pairing and 7-day device sessions
**Researched:** 2026-04-06
**Status:** Complete
**Confidence:** High

## Scope

Phase 1 must solve identity, browser session management, QR pairing, terminal confirmation, and Fly.io deployment without exposing the local machine or weakening Codex approval semantics. This phase does not need full remote session attachment yet, but it must create the trust boundary that later bridge and relay work can build on.

## Decision Summary

### 1. Use a layered session model

- Use a short-lived web session cookie for normal browser navigation and API access.
- Use a separate device session record with a strict 7-day absolute lifetime.
- Mint very short-lived WebSocket upgrade tickets from the web session rather than reusing the long-lived session credential directly.

**Recommended names and limits:**
- `cm_web_session`: HttpOnly, Secure, SameSite=Lax, 12-hour rolling session
- `cm_device_session`: HttpOnly, Secure, SameSite=Lax, 7-day absolute expiry
- `cm_ws_ticket`: single-use ticket with 60-second expiry, never stored in localStorage

**Why:** OWASP recommends server-side session expiry, absolute timeouts, renewal, Secure cookies, HttpOnly cookies, SameSite, and avoiding URL-based session identifiers. The browser session and the "paired device" concept are different trust objects and should not share the same token lifecycle.

### 2. Make QR pairing single-use and terminal-confirmed

- The CLI or local bridge starts pairing by calling the hosted API and receives:
  - `pairingId`
  - `pairingUrl`
  - `userCode`
  - `expiresAt`
- The browser opens `pairingUrl`, authenticates if needed, and redeems the pairing.
- After redeem, the server generates a human-readable `verificationPhrase` that is shown in both the browser and the terminal.
- The terminal requires explicit local confirmation before the device session is issued.

**Why:** OWASP's qrljacking guidance explicitly recommends session confirmation and treating QR login as attackable. A local terminal approval step is the simplest strong mitigation for a public remote-control product.

### 3. Keep app-server local and preserve Codex security semantics

- The product must not expose `codex app-server` directly to the internet.
- The bridge should continue to speak to Codex locally over `stdio`.
- App-server approvals remain authoritative; Codex Mobile only surfaces and forwards decisions.

**Why:** OpenAI documents `codex app-server` as JSON-RPC over `stdio` by default, with WebSocket transport marked experimental, and documents approvals as server-initiated requests that the client must respond to. The bridge must preserve, not bypass, that boundary.

### 4. Choose developer-friendly auth for v1, but keep the session model provider-agnostic

- Inference: use GitHub OAuth as the first sign-in provider for v1 because the initial audience is developers and it avoids email deliverability work in Phase 1.
- Keep persistence and session issuance provider-agnostic so additional providers such as generic OIDC or email can be added later without changing pairing, device sessions, or relay auth.

**Why this is an inference:** The source material does not require GitHub OAuth specifically. This is a product decision optimized for the likely first users and the need to keep Phase 1 focused.

### 5. Phase 1 can keep HTTP auth and pairing in the web app while still reserving a separate relay service

- Implement browser auth and pairing HTTP routes in `apps/web` so cookies stay first-party and mobile login is simple.
- Stand up `apps/relay` in Phase 1 with health endpoints, auth/ticket primitives, and deployment wiring so the service exists on Fly.io before bridge work in Phase 2.

**Why:** This satisfies `OPS-01` without forcing cross-subdomain cookie complexity before the actual bridge and live stream transport are needed.

## Recommended Architecture For This Phase

```text
phone browser
  -> apps/web (Next.js)
       -> sign-in
       -> pairing redeem / confirm routes
       -> device session issuance
       -> ws ticket minting

local terminal / bridge
  -> POST pairing start to hosted API
  -> display QR + fallback code
  -> poll or subscribe for verification phrase
  -> require local confirmation

shared packages
  -> packages/protocol
  -> packages/auth
  -> packages/db

deployment
  -> apps/web on Fly.io
  -> apps/relay on Fly.io with health + future bridge entrypoint
  -> shared Postgres on Fly.io
```

## Data Model Recommendations

Create these tables in Phase 1:

- `users`
  - app-level user identity
- `oauth_accounts`
  - provider account linkage
- `web_sessions`
  - short-lived browser sessions
- `device_sessions`
  - 7-day paired device trust records
- `pairing_sessions`
  - pending / redeemed / confirmed / expired one-time pairings
- `audit_events`
  - pairing, login, confirm, revoke, logout, and failed redemption attempts

Recommended `pairing_sessions` fields:
- `id`
- `status`
- `userCode`
- `verificationPhrase`
- `createdAt`
- `expiresAt`
- `redeemedAt`
- `confirmedAt`
- `confirmedByUserId`
- `bridgeInstanceId`
- `deviceLabel`
- `pairingTokenHash`

Recommended `device_sessions` fields:
- `id`
- `userId`
- `deviceLabel`
- `devicePublicId`
- `createdAt`
- `expiresAt`
- `lastSeenAt`
- `revokedAt`
- `issuedFromPairingId`

## Security Rules That Must Shape The Plan

- Pairing tokens must be random, single-use, and short-lived.
- Session expiry must be enforced on the server, not the client.
- Session identifiers must not travel in query parameters, URL fragments, or localStorage for public flows.
- All cookies must be `Secure` and `HttpOnly`; session cookies should use `SameSite=Lax` unless a specific cross-site requirement forces something looser.
- WebSocket and long-lived live-stream connections must authenticate with a short-lived derived credential, not the long-lived device session directly.
- The local machine must never open an inbound public port.

## Brownfield References To Reuse Or Avoid

Useful references from `resources/gsd-2`:
- `resources/gsd-2/src/headless.ts`
  - useful as a model for structured progress and machine-friendly command control
- `resources/gsd-2/src/resources/extensions/remote-questions/remote-command.ts`
  - useful as a model for remote prompt initiation and runtime record handling

References to avoid copying directly for the public product:
- `resources/gsd-2/web/lib/auth.ts`
  - stores bearer tokens in `localStorage` and appends `_token` query params for SSE
- `resources/gsd-2/web/proxy.ts`
  - acceptable for localhost launch auth, not for a public multi-user remote-control surface

## Validation Architecture

Phase 1 should establish the test harness that later phases depend on.

Recommended testing stack:
- Vitest for unit and route-level integration tests
- Playwright for mobile-sized auth and pairing browser flows

Recommended scripts to create in Wave 0:
- `npm run test:phase-01:quick`
  - run Vitest auth, session, protocol, and pairing route tests
- `npm run test:phase-01:full`
  - run the quick suite plus Playwright mobile auth/pair smoke and relay health checks

Minimum validation coverage for this phase:
- session cookie helpers and expiry logic
- pairing token generation, expiry, and single-use enforcement
- verification phrase generation and confirmation transition
- browser auth guard and pairing redeem route behavior
- Fly health endpoints for both public services

## Planning Implications

- Plan 01 should create the workspace, shared packages, schema, trust-boundary docs, and test skeleton.
- Plan 02 should implement GitHub sign-in, pairing routes, terminal QR flow, and device session issuance.
- Plan 03 should deploy `apps/web` and `apps/relay` on Fly.io with health checks, secrets wiring, and baseline docs.

## Sources

- OpenAI Codex App Server: https://developers.openai.com/codex/app-server
- OpenAI Agent Approvals & Security: https://developers.openai.com/codex/agent-approvals-security
- Fly.io Connecting to User Machines: https://fly.io/docs/blueprints/connecting-to-user-machines/
- OWASP QRLJacking: https://owasp.org/www-community/attacks/Qrljacking
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- Local brownfield references:
  - `resources/gsd-2/src/headless.ts`
  - `resources/gsd-2/src/resources/extensions/remote-questions/remote-command.ts`
  - `resources/gsd-2/web/lib/auth.ts`
  - `resources/gsd-2/web/proxy.ts`

---
*Phase directory: 01-identity-pairing-foundation*
*Research completed: 2026-04-06*
