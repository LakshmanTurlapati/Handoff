# Project Milestones: Codex Mobile

## v1.1 Handoff Install and Launch (Shipped: 2026-05-12)

**Phases completed:** 5 phases, 13 plans, 18 tasks

**Key accomplishments:**

- The bridge workspace is now a real `handoff` install surface with package-local TypeScript configs, dist-based support-package exports, and a tarball smoke path that validates the published CLI entrypoint locally.
- Pairing confirmation now produces a durable bridge-installation identity and one-time bootstrap token, the hosted app exchanges that token for short-lived bridge connect tickets, and the CLI persists the install-safe bootstrap state under XDG-managed local files.
- The bridge runtime now boots from saved bootstrap state, reconnects with hosted ticket refreshes instead of a local signing secret, and exposes `handoff launch` as a single-daemon start-or-reuse seam for later Codex integration.
- Packaged a real Codex `/handoff` command asset plus an idempotent installer so npm-installed Handoff can register the command locally.
- Added a thread-bound hosted handoff contract plus a local `codex-handoff` helper that returns concise JSON for the active Codex thread.
- Hardened the `/handoff` path so authorization, expiry, and thread-context failures stop with explicit repair guidance instead of drifting into a picker or generic error path.
- Verified that the packaged Codex `$handoff` skill installs into `${CODEX_HOME}/skills/handoff/`, that `install-codex-command` is a working deprecated alias, and that stale legacy command/prompt copies are removed during install.
- Verified that `handoff codex-handoff` resolves the active thread and session exclusively from supported env bindings (`CODEX_THREAD_ID`, `CODEX_SESSION_ID`) and fails closed with `missing_active_thread_context` when the thread cannot be resolved.
- Confirmed that the root README, bridge README, hosted root page, hosted launch error page, and CLI help text all reference `$handoff` (skill invocation) and `/skills` discovery rather than the legacy `/handoff` slash command.
- Verified that `$handoff` (via `handoff codex-handoff --format json`) mints a single-use Fly-hosted `/launch/<publicId>` URL and QR text from the active Codex thread context, reusing the existing valid record on repeated same-thread invocations and failing closed when the thread context is absent.
- Verified that `/launch/<publicId>` resolves the single-use token, mints or reuses a durable device session linked to the originating bridge installation, redirects directly to `/session/<sessionId>` on the forwarded public origin, and fails closed with explicit error codes on the authless error page.
- Confirmed that `README.md`, `apps/bridge/README.md`, the hosted launch error page, and `handoff --help` all describe the real npm-install-plus-Codex `$handoff` flow with no live references to the legacy `/handoff` slash command.
- Hosted `/launch/[publicId]` URLs now mint or reuse a durable device session without GitHub OAuth, and the local `handoff` CLI ships as an executable bin.

---

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
