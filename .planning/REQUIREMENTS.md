# Requirements: Codex Mobile

**Defined:** 2026-04-18
**Core Value:** A developer can safely continue a local Codex session from anywhere, with live progress and approvals, without exposing raw shell access or moving their local environment into the cloud.

## v1.1 Requirements

### Distribution & Install

- [ ] **DIST-01**: Developer can install Handoff from npm without cloning the monorepo
- [ ] **DIST-02**: Installed Handoff provides a usable local `handoff` CLI via global install or `npx`
- [ ] **DIST-03**: Installed Handoff can bootstrap local runtime state without requiring raw `CODEX_MOBILE_USER_ID` or `CODEX_MOBILE_DEVICE_SESSION_ID` env wiring

### Codex Command

- [ ] **CMD-01**: After install, Codex exposes `/handoff` as the entrypoint for starting remote continuation
- [ ] **CMD-02**: `/handoff` captures the active local Codex session/thread instead of forcing the user through a generic session picker later

### Hosted Launch Flow

- [ ] **LAUNCH-01**: `/handoff` generates a single-use Fly-hosted handoff URL and terminal QR code
- [ ] **LAUNCH-02**: Opening the URL in a phone browser routes through the hosted website sign-in and pairing flow
- [ ] **LAUNCH-03**: After pairing, the phone lands directly on the active session that initiated `/handoff`
- [ ] **LAUNCH-04**: Starting a handoff automatically starts or reuses the local bridge without opening any inbound port on the developer machine

### Safety & UX

- [ ] **SAFE-01**: The install and `/handoff` path preserves Codex approval and sandbox semantics and does not expose a general-purpose shell surface
- [ ] **SAFE-02**: Launch URLs and pairing credentials remain short-lived and single-purpose in the new install flow
- [ ] **DX-01**: Public install and usage docs explain npm install, Codex `/handoff`, and the Fly-hosted pairing path for first-time users

## v2 Requirements

### Notifications

- **NOTF-01**: User receives a notification when Codex needs approval while the remote UI is disconnected
- **NOTF-02**: User can opt into reconnect and session-ended notifications

### Collaboration

- **COLLAB-01**: User can share a read-only observer view of a session
- **COLLAB-02**: Team admins can manage multiple bridges and users

### Hardening Follow-Up

- **HARD-01**: Archived v1.0 milestone verification gaps are closed with missing `VERIFICATION.md` artifacts and staged Fly validation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Notifications and approval pings while disconnected | Valuable, but secondary to making install and launch usable first |
| Observer or read-only share links | Different product surface from single-user handoff |
| Full archived v1.0 verification sweep | Keep separate unless it directly blocks npm install or `/handoff` launch |
| Self-hosting beyond the existing Fly-hosted path | This milestone is explicitly about the Fly install-and-launch experience |
| Native mobile apps | Web-first remains sufficient for this stage |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIST-01 | Phase 6 | Pending |
| DIST-02 | Phase 6 | Pending |
| DIST-03 | Phase 6 | Pending |
| CMD-01 | Phase 7 | Pending |
| CMD-02 | Phase 7 | Pending |
| LAUNCH-01 | Phase 8 | Pending |
| LAUNCH-02 | Phase 8 | Pending |
| LAUNCH-03 | Phase 8 | Pending |
| LAUNCH-04 | Phase 6 | Pending |
| SAFE-01 | Phase 7 | Pending |
| SAFE-02 | Phase 8 | Pending |
| DX-01 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 after starting v1.1 milestone*
