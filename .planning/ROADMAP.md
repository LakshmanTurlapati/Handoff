# Roadmap: Codex Mobile

## Overview

Codex Mobile will start by establishing trust boundaries and secure device pairing, then build the local Codex bridge and remote session protocol, then ship the phone-first live control surface, then harden approvals and device safety, and finally add the relay ownership and operational features required for multi-instance Fly.io scale.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Identity & Pairing Foundation** - secure sign-in, QR pairing, session issuance, and Fly deployment baseline
- [x] **Phase 2: Bridge & Codex Session Adapter** - local bridge lifecycle, Codex app-server integration, and remote attach-to-session behavior
- [x] **Phase 3: Live Remote UI & Control** - phone-first live session timeline with prompt, steer, interrupt, and structured activity rendering
- [x] **Phase 4: Approval, Audit & Device Safety** - revocation, reconnect, approval surfaces, and safety rails around repeated use
- [ ] **Phase 5: Multi-Instance Routing & Production Hardening** - relay ownership routing, observability, and scale-focused hardening on Fly.io

## Phase Details

### Phase 1: Identity & Pairing Foundation
**Goal**: Establish a secure internet-facing entry point for Codex Mobile with QR-based pairing and 7-day device sessions
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, PAIR-01, PAIR-02, PAIR-03, PAIR-04, PAIR-05, SEC-01, SEC-06, OPS-01
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. User can sign into the web app and begin pairing from a phone browser
  2. Local terminal can display a short-lived QR code and fallback code for pairing
  3. Terminal and browser both show a verification phrase before a 7-day device session is granted
  4. Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine
**Plans**: 7 plans (3 original + 4 gap closure)

Plans:
- [x] 01-01: Define trust boundaries, shared protocol contracts, and auth/session model
- [x] 01-02: Implement web auth, pairing APIs, terminal QR flow, and confirmation UX
- [x] 01-03: Deploy baseline web/control services to Fly.io with TLS, secrets, and health checks
- [x] 01-04 (gap): Fix middleware CR-01 + add missing GET /api/pairings/[pairingId] handler
- [x] 01-05 (gap): Pairing token bearer verification, Origin/CSRF, rate limit, waitForRedeem error propagation, 32-byte cookie secret
- [x] 01-06 (gap): Harden fly-deploy.yml (CR-02), Dockerfiles (CR-03), README single-machine callout
- [x] 01-07 (gap): Remove auth() from /confirm (CR-GAP-01), rate-limit eviction (WR-GAP-01), generic 500 fallthroughs (WR-GAP-02), PairingStatusResponseSchema userCode (WR-GAP-03)

### Phase 01.1: Browser device session claim flow (D-07-01 hotfix) (INSERTED)

**Goal**: Close the D-07-01 gap discovered during Phase 1 verification iteration 2 -- the phone browser currently never receives the `cm_device_session` cookie because `/confirm` is called by the bridge CLI, not the browser, so the `Set-Cookie` header returns to the wrong process.
**Depends on**: Phase 1
**Requirements**: AUTH-02, PAIR-04, SEC-01
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. After the bridge CLI calls `POST /api/pairings/[id]/confirm`, the phone browser's `/pair/[id]` page detects the `confirmed` state and successfully obtains a `cm_device_session` cookie without a second sign-in round-trip.
  2. `redeemPairing` persists the redeeming user's identity onto the pairing row so the browser claim path can mint a session for the correct user (Option A lock is explicitly lifted for this phase -- the justification that protected it in Phase 1 no longer holds).
  3. The existing Playwright `auth-pairing.spec.ts` continues to pass, updated to cover the new claim flow.
  4. The end-to-end happy path is verified on a real Fly deploy: bridge creates pairing -> phone pairs -> verification phrase matches -> bridge confirms -> phone receives cookie -> phone shows paired state.
**Plans**: 2 plans

Plans:
- [x] 01.1-01-PLAN.md -- Backend: redeemedByUserId on PairingRow + schema, confirmPairing cleanup (drop issueDeviceSession, remove sentinel, update return type), new /claim route handler, protocol schema update
- [x] 01.1-02-PLAN.md -- Frontend: refactor pair page (server + client component split), client-side polling at 2s, auto-claim on confirmed detection, error states, Playwright test update

### Phase 2: Bridge & Codex Session Adapter
**Goal**: Build the local bridge that connects outbound to the relay and maps Codex app-server semantics into the product protocol
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03, SEC-02
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Local bridge can connect outbound to the relay and register its local availability
  2. User can see active or recent local Codex sessions and attach to one remotely
  3. Remote attachment preserves existing conversation context rather than starting an unrelated automation job
  4. Remote control respects Codex sandbox and approval settings instead of silently broadening them
**Plans**: 3 plans

Plans:
- [x] 02-01: Build local bridge daemon lifecycle and relay registration
- [x] 02-02: Integrate local `codex app-server` and normalize core thread/turn/session events
- [x] 02-03: Implement session listing, attach/resume behavior, and local failure handling

### Phase 3: Live Remote UI & Control
**Goal**: Deliver the core remote-control experience on a phone-sized web UI
**Depends on**: Phase 2
**Requirements**: SESS-04, SESS-05, LIVE-01, LIVE-02, LIVE-04
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. User can watch live Codex progress and assistant output remotely in near real time
  2. User can send a new prompt or steer an in-flight turn from the mobile UI
  3. User can interrupt a live remote session intentionally from the mobile UI
  4. The UI clearly separates agent text, tool activity, command execution, and approval states on a phone screen
**Plans**: 3 plans

Plans:
- [x] 03-01: Build the mobile session shell, timeline, and structured activity renderer
- [x] 03-02: Implement live stream transport plus prompt, steer, and interrupt controls
- [x] 03-03: Polish small-screen interaction patterns and Codex-specific control affordances

### Phase 4: Approval, Audit & Device Safety
**Goal**: Make repeated remote use safe through revocation, reconnect, audit, and clear approval handling
**Depends on**: Phase 3
**Requirements**: AUTH-03, AUTH-04, SESS-06, LIVE-03, SEC-03, SEC-05
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. User can revoke devices and remote sessions from the web app
  2. Remote sessions disconnect cleanly when the local Codex process stops or trust is revoked
  3. The mobile UI can recover from short disconnects without forcing the full pairing flow again
  4. Pairing, approval, revoke, and disconnect actions are recorded in an audit trail
**Plans**: 3 plans

Plans:
- [x] 04-01: Implement device management, revocation, and session teardown
- [x] 04-02: Build approval-state handling and audit event persistence
- [x] 04-03: Add reconnect, resume, and bridge-health safety behavior

### Phase 5: Multi-Instance Routing & Production Hardening
**Goal**: Make the relay architecture operationally credible beyond a single instance
**Depends on**: Phase 4
**Requirements**: SEC-04, OPS-02, OPS-03, OPS-04
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Relay can support multiple users and bridges without relying on one in-memory coordinator
  2. Browser connections can be routed to the relay instance that owns the bridge connection
  3. Unauthorized cross-user or cross-bridge attachment attempts are rejected and observable
  4. Operators can inspect connection health, ownership state, queue pressure, and disconnect reasons
**Plans**: 3 plans

Plans:
- [x] 05-01: Implement relay ownership metadata and routing contract
- [ ] 05-02: Add Fly.io-aware routing and scale validation for browser/bridge connections
- [ ] 05-03: Add metrics, queue/backpressure guards, and production hardening checks

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 01.1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Identity & Pairing Foundation | 7/7 | Complete | - |
| 01.1 Browser device session claim flow | 2/2 | Complete    | 2026-04-12 |
| 2. Bridge & Codex Session Adapter | 3/3 | Complete | 2026-04-18 |
| 3. Live Remote UI & Control | 3/3 | Complete | 2026-04-18 |
| 4. Approval, Audit & Device Safety | 3/3 | Complete | 2026-04-18 |
| 5. Multi-Instance Routing & Production Hardening | 1/3 | In Progress | - |
