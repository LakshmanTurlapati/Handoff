# Project Milestones: Codex Mobile

## v1.0 Codex Mobile MVP (Shipped: 2026-04-18)

**Delivered:** A secure remote-control layer for local Codex sessions with QR pairing, an outbound-only local bridge, a phone-first live control UI, device/audit safety flows, and Fly-ready relay ownership and replay routing.

**Phases completed:** 1-5 with inserted `01.1` hotfix (21 plans total)

**Key accomplishments:**
- Shipped secure QR pairing, terminal confirmation, and durable 7-day device sessions across the web app and local bridge.
- Integrated the outbound-only bridge with `codex app-server` over stdio so remote users can attach to and continue real local Codex sessions.
- Delivered a mobile-first live control surface with structured activity rendering, prompt/steer/interrupt controls, reconnect UX, approvals, and explicit terminal end states.
- Added durable device revoke, append-only audit capture, and trust-boundary-safe reconnect handling across the hosted layer.
- Added durable relay ownership, Fly wrong-instance replay, readiness/ops visibility, and browser backpressure controls for multi-instance routing.

**Stats:**
- 205 files changed
- 33,545 inserted lines across the implementation range
- 6 phases, 21 plans, 43 recorded tasks
- 9 days from first implementation commit to final plan closeout

**Git range:** `feat(01-01)` → `feat(05-03)`

### Known Gaps

- Pairing and hosted trust validation debt: `AUTH-01`, `AUTH-02`, `PAIR-01`, `PAIR-02`, `PAIR-03`, `PAIR-04`, `PAIR-05`, `SEC-01`, `SEC-06`, `OPS-01`
- Bridge/session milestone verification debt: `SESS-01`, `SESS-02`, `SESS-03`, `SEC-02`
- Live-control and safety verification debt: `AUTH-03`, `AUTH-04`, `SESS-04`, `SESS-05`, `SESS-06`, `LIVE-01`, `LIVE-02`, `LIVE-03`, `LIVE-04`, `SEC-03`, `SEC-05`
- Multi-instance staging validation debt: `SEC-04`, `OPS-02`, `OPS-03`, `OPS-04`

**What's next:** Convert the archived v1.0 audit and paused UAT into explicit follow-up work with `$gsd-plan-milestone-gaps`, or define the next scoped milestone with `$gsd-new-milestone`.

---
