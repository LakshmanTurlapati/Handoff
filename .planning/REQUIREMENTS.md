# Requirements: Codex Mobile

**Defined:** 2026-04-06
**Core Value:** A developer can safely continue a local Codex session from anywhere, with live progress and approvals, without exposing raw shell access or moving their local environment into the cloud.

## v1 Requirements

### Authentication & Devices

- [ ] **AUTH-01**: User can sign in to the Codex Mobile web app with a secure first-party session
- [ ] **AUTH-02**: User can keep a paired device authorized for up to 7 days without re-pairing
- [ ] **AUTH-03**: User can view and revoke active paired devices and remote-control sessions
- [ ] **AUTH-04**: User can reconnect a valid device session after a transient network interruption without repeating the initial pairing flow

### Pairing

- [ ] **PAIR-01**: Local CLI bridge can create a new pairing session from the developer machine
- [ ] **PAIR-02**: Terminal displays a QR code and fallback code that open the correct pairing flow on a phone browser
- [ ] **PAIR-03**: Pairing token is single-use and expires automatically within minutes if not completed
- [ ] **PAIR-04**: Terminal and web client both show a verification phrase or equivalent proof before remote control is enabled
- [ ] **PAIR-05**: Pairing never requires opening an inbound port on the developer machine

### Remote Sessions

- [ ] **SESS-01**: Local bridge can register a Codex session with the hosted relay using outbound secure connectivity only
- [ ] **SESS-02**: User can see active and recent Codex sessions available for remote control
- [ ] **SESS-03**: User can attach to an existing Codex session and continue the same conversation history remotely
- [ ] **SESS-04**: User can start a new turn or steer an in-flight turn from the remote UI
- [ ] **SESS-05**: User can interrupt or intentionally end a remote session from the remote UI
- [ ] **SESS-06**: Session ends cleanly when the local Codex process stops or the device/session is revoked

### Live Activity

- [ ] **LIVE-01**: Remote UI streams Codex agent events, progress, and assistant output in near real time
- [ ] **LIVE-02**: Remote UI distinguishes agent messages, tool activity, command execution, and approval state instead of showing one undifferentiated log
- [ ] **LIVE-03**: Remote UI can recover from short network interruptions and resume the live stream without creating a new session
- [ ] **LIVE-04**: Remote UI is usable on phone-sized screens without requiring a full desktop terminal layout

### Security & Policy

- [ ] **SEC-01**: Web and WebSocket sessions use short-lived connection credentials derived from a stronger authenticated device session
- [ ] **SEC-02**: Remote control preserves Codex sandbox and approval semantics instead of bypassing them
- [ ] **SEC-03**: Pairing, approval, revoke, and disconnect events are recorded in an audit trail
- [ ] **SEC-04**: Relay validates browser-to-bridge ownership so one user cannot attach to another user's local bridge
- [ ] **SEC-05**: Product does not expose a general-purpose remote shell or tunnel independent of Codex
- [ ] **SEC-06**: Origin, CSRF, and replay protections are enforced for browser sessions and pairing flows

### Deployment & Operations

- [ ] **OPS-01**: Public web app and relay service deploy on Fly.io with TLS and health checks
- [ ] **OPS-02**: Relay can support multiple concurrently connected users and bridges without relying on a single in-memory coordinator
- [ ] **OPS-03**: Relay can route a browser connection to the relay instance that owns the local bridge connection
- [ ] **OPS-04**: Operators can observe connection health, disconnect reasons, queue pressure, and relay ownership state

## v2 Requirements

### Notifications

- **NOTF-01**: User receives a notification when Codex needs approval while the remote UI is disconnected
- **NOTF-02**: User can opt into reconnect and session-ended notifications

### Collaboration

- **COLLAB-01**: User can share a read-only observer view of a session
- **COLLAB-02**: Team admins can manage multiple bridges and users

### Native Mobile

- **MOBILE-01**: Native iOS/Android shells can use the same relay protocol and auth model as the web app

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fully hosted Codex workspaces | Not core to local-session continuation; changes the product category |
| Generic shell or tmux tunneling | Expands the security surface far beyond the Codex-specific problem |
| Native mobile apps | Web-first is faster to validate and easier to ship securely |
| Team/shared-edit collaboration | Single-user remote continuation should be validated first |
| Direct public exposure of `codex app-server` | Unsafe boundary for a multi-user internet-facing product |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 4 | Pending |
| AUTH-04 | Phase 4 | Pending |
| PAIR-01 | Phase 1 | Pending |
| PAIR-02 | Phase 1 | Pending |
| PAIR-03 | Phase 1 | Pending |
| PAIR-04 | Phase 1 | Pending |
| PAIR-05 | Phase 1 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 2 | Pending |
| SESS-04 | Phase 3 | Pending |
| SESS-05 | Phase 3 | Pending |
| SESS-06 | Phase 4 | Pending |
| LIVE-01 | Phase 3 | Pending |
| LIVE-02 | Phase 3 | Pending |
| LIVE-03 | Phase 4 | Pending |
| LIVE-04 | Phase 3 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 2 | Pending |
| SEC-03 | Phase 4 | Pending |
| SEC-04 | Phase 5 | Pending |
| SEC-05 | Phase 4 | Pending |
| SEC-06 | Phase 1 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 5 | Pending |
| OPS-03 | Phase 5 | Pending |
| OPS-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-04-06*
*Last updated: 2026-04-06 after initialization*
