<!-- GSD:project-start source:PROJECT.md -->
## Project

**Codex Mobile**

Codex Mobile is a secure remote-control layer for local Codex sessions, optimized for phone-sized browsers. A developer runs a local bridge beside Codex, pairs a device by scanning a QR code rendered in the terminal, and continues the same local session through a Fly.io-hosted web UI and relay without opening inbound ports on the laptop.

The product is intentionally not a cloud-hosted coding agent. It is a remote window into a developer's existing local Codex environment, with security, session control, and mobile usability treated as first-order product requirements.

**Core Value:** A developer can safely continue a local Codex session from anywhere, with live progress and approvals, without exposing raw shell access or moving their local environment into the cloud.

### Constraints

- **Deployment**: Public web app and relay service must run on Fly.io; the local developer machine uses outbound connectivity only
- **Security**: Device sessions expire after 7 days; pairing and connection credentials must be short-lived and single-purpose
- **Integration**: Codex approval and sandbox semantics must be preserved; the remote UI must not bypass them
- **UX**: The primary interaction surface is a phone browser; live progress and approvals must remain readable on small screens
- **Scope**: v1 should be open-source and contributor-friendly; avoid hidden control-plane assumptions
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

- TypeScript monorepo with `apps/web`, `apps/relay`, `apps/bridge`, and shared `packages/*`
- `apps/web`: Next.js 16 + React 19 mobile-first web app and authenticated session UI
- `apps/relay`: Fastify + `ws` control plane deployed on Fly.io for auth APIs, relay routing, and live browser/bridge channels
- `apps/bridge`: local daemon that talks outbound to the relay and talks locally to `codex app-server` over stdio
- Shared packages: `protocol`, `auth`, `db`, `ui`, and `observability`
- Persistence: Postgres + Drizzle for users, devices, pairings, audit logs, and relay ownership metadata
- Validation and auth primitives: `zod`, `jose`, short-lived WebSocket tickets, HttpOnly sessions, and single-use pairing tokens

### Avoid

- Do not expose `codex app-server` directly to the internet
- Do not use PTY scraping as the primary protocol when structured Codex events are available
- Do not put bearer tokens in URL params, fragments, or localStorage for public sessions
- Do not expand the product into a general-purpose shell, SSH, or tmux tunnel
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:PROJECT.md -->
## Conventions

- Treat `resources/gsd-2/` as reference material and substrate, not as the product root for new Codex Mobile features
- Place new product code under top-level `apps/` and `packages/` unless a phase explicitly calls for modifying the reference tree
- Model remote activity as product-owned structured events; terminal bytes are supplemental rendering, not the source of truth
- Preserve Codex approval and sandbox semantics end to end; remote control must not silently widen permissions
- Keep the local bridge outbound-only; never add an internet-facing inbound port on the developer machine
- Validate every relay message and control-plane payload at runtime
- Design UI changes mobile-first; phone usability is a product requirement, not a later polish pass
- Build pairing, revocation, reconnect, and audit behavior into the first implementation of a feature rather than bolting it on afterward
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:research/ARCHITECTURE.md -->
## Architecture

- Primary flow: authenticated phone browser -> Fly.io web/relay -> outbound-connected local bridge -> local `codex app-server` -> Codex session
- The hosted layer owns auth, pairing, audit, routing, and device/session metadata
- The local bridge owns the Codex process boundary, session lifecycle adaptation, and live event normalization
- Browser clients never connect directly to the local machine or to raw Codex protocols

### Planned Structure

- `apps/web`: sign-in, device management, session list, live timeline, approvals, and revoke UX
- `apps/relay`: pairing API, ownership lookup, WebSocket fanout, backpressure, and Fly-aware routing
- `apps/bridge`: local daemon, QR flow, terminal confirmation, relay connection, and Codex adapter
- `packages/protocol`: shared event schema and control messages used by web, relay, and bridge

### Scaling Rules

- Assume multiple relay instances from the start; route browser traffic to the relay instance that owns the bridge connection
- Keep durable control-plane state in Postgres and keep live buffers local to the owning relay worker
- Prefer stdio app-server integration first; treat experimental direct WebSocket support as optional fallback work
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile`; do not edit manually.
<!-- GSD:profile-end -->
