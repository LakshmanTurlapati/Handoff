# Phase 06: npm Distribution & Local Bootstrap - Research

**Researched:** 2026-04-19
**Domain:** npm-distributed CLI packaging, secure local bootstrap state, and reusable outbound-only bridge startup
**Confidence:** HIGH

<user_constraints>
## User Constraints (from ROADMAP.md, REQUIREMENTS.md, and AGENTS.md)

### Locked Decisions
- **D-01:** A developer must be able to install Handoff from npm without cloning the monorepo.
- **D-02:** The installed package must expose a usable local `handoff` CLI through global install or `npx`.
- **D-03:** Starting the local bridge must no longer require operators to manually provide `CODEX_MOBILE_USER_ID` or `CODEX_MOBILE_DEVICE_SESSION_ID`.
- **D-04:** Starting handoff must automatically start or reuse the outbound-only local bridge instead of relying on manual daemon wiring.
- **D-05:** The local machine must remain outbound-only. No inbound listener or direct public exposure of `codex app-server` is allowed.
- **D-06:** Hosted trust boundaries remain authoritative. The local package must not embed or persist `WS_TICKET_SECRET` or any equivalent server signing secret.
- **D-07:** Approval and sandbox semantics must stay intact end to end; the packaging and bootstrap work cannot widen what the remote client can do.

### the agent's Discretion
- Whether the public npm artifact is a renamed `apps/bridge` workspace or a new wrapper workspace, as long as the installed package name is `handoff`.
- Exact local state directory layout and file naming, provided filesystem permissions are restrictive and the stored credential is single-purpose.
- Whether the daemon reuse contract is implemented with a PID file, lock file, or both.
- The exact bridge bootstrap API route layout on the hosted side, provided the local package exchanges an opaque bootstrap token for short-lived bridge connect tickets.

### Deferred Ideas (OUT OF SCOPE)
- Codex-native `/handoff` slash command integration (Phase 07)
- Active-session launch URLs, QR generation for launch, and deep-linking into the invoking session (Phase 08)
- Milestone-wide cleanup of archived v1.0 verification debt unless it blocks Phase 06 implementation
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIST-01 | Install Handoff from npm without cloning or building the monorepo manually | Convert the bridge into a real public npm artifact, add package-local build configs, and stop relying on source-only workspace exports. |
| DIST-02 | The installed package provides a usable `handoff` CLI through global install or `npx` | Rename the public bin to `handoff`, keep CLI commands self-contained, and add tarball install smoke validation. |
| DIST-03 | Local runtime bootstrap no longer depends on raw `CODEX_MOBILE_USER_ID` or `CODEX_MOBILE_DEVICE_SESSION_ID` env values | Introduce a bridge bootstrap token plus secure local state so the daemon can derive short-lived connect tickets at runtime. |
| LAUNCH-04 | Starting handoff automatically starts or reuses the local bridge without inbound ports | Add a daemon manager that reads stored bootstrap state, reuses a running bridge when present, and keeps outbound-only relay connectivity. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Product code remains under top-level `apps/` and `packages/`; `resources/gsd-2/` can inform the design but is not the product root.
- The bridge remains outbound-only and continues to talk locally to `codex app-server` over stdio.
- Browser and bridge credentials must stay short-lived and single-purpose when they cross trust boundaries.
- Runtime payloads and bootstrap messages must stay validated at the boundary with `zod` or equivalent schema validation.
- The product remains a remote window into a local Codex session, not a general-purpose shell or SSH tunnel.

## Summary

Phase 06 has to convert the current repo-local bridge into a real installable CLI and replace its env-driven startup contract with a secure local bootstrap flow. The current codebase is not ready for that shape:

1. `apps/bridge/package.json` is still private and exposes the bin as `codex-mobile-bridge`, not `handoff`.
2. `apps/bridge/src/cli.ts` requires raw `CODEX_MOBILE_RELAY_URL`, `CODEX_MOBILE_WS_TICKET_SECRET`, `CODEX_MOBILE_USER_ID`, and `CODEX_MOBILE_DEVICE_SESSION_ID` for the normal daemon path.
3. `apps/bridge`, `packages/auth`, `packages/db`, and `apps/web` all reference package-local TypeScript configs that do not exist today, so workspace build or typecheck commands fail immediately outside the current happy path.
4. `packages/auth` unnecessarily depends on `@codex-mobile/db`, even though the bridge only needs local JWT helpers and protocol types.
5. The hosted pairing flow issues a browser `cm_device_session` cookie from `POST /api/pairings/[pairingId]/claim`, but the local bridge receives no durable bootstrap credential it can store and reuse later.
6. There is no local state directory, no stored bootstrap profile, and no daemon reuse contract.

The right Phase 06 shape is:

- make the publish target a real npm package named `handoff`, with a `handoff` bin and buildable dist output
- make the bridge's shared runtime dependencies (`@codex-mobile/auth` and `@codex-mobile/protocol`) publishable dist-based packages instead of source-only workspace aliases
- mint a dedicated bridge bootstrap token from the hosted pairing flow and store it locally with restrictive filesystem permissions
- exchange that stored bootstrap token for short-lived bridge connect tickets so the local machine never holds `WS_TICKET_SECRET`
- add a daemon manager that reads saved bootstrap state, starts the bridge if needed, and reuses an existing outbound-only bridge when one is already running

**Primary recommendation:** keep Phase 06 split exactly along the roadmap lines:

- `06-01` restores the package/build baseline and produces a real npm-facing `handoff` CLI surface
- `06-02` creates bridge installation storage, a hosted bridge-ticket mint path, and secure local bootstrap state
- `06-03` removes the normal env-driven daemon path and replaces it with daemon reuse plus launch orchestration over the stored bootstrap state

## Standard Stack

### Core

| Library / Platform | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| `typescript` | `5.7.3` | Build publishable CLI and shared package dist outputs | Already the repo compiler and the least disruptive way to make current workspaces buildable. |
| `ws` | `8.20.0` | Outbound bridge WebSocket client | Already the bridge transport and remains the correct relay transport for the installable CLI. |
| `jose` | `6.2.2` | Hosted bridge connect-ticket minting and relay verification | Already used for browser ws-tickets; Phase 06 should reuse that primitive instead of inventing a second secret format. |
| `zod` | `4.3.6` | Local state, bootstrap response, and connect-ticket route validation | Already the project's runtime boundary contract library. |
| Node.js built-ins (`fs`, `os`, `path`, `child_process`) | Node 22 runtime | Secure local state storage and daemon supervision | Sufficient for filesystem permissions, XDG path resolution, and detached daemon process management without new native dependencies. |
| `npm pack` / `npx` | npm `10.9.3` | Tarball smoke validation and install surface verification | Directly exercises the user-facing distribution contract the phase is supposed to deliver. |

### Supporting

| Library / Platform | Version | Purpose | When to Use |
|--------------------|---------|---------|-------------|
| `qrcode` | `1.5.4` | Existing pairing QR output in the published CLI | Keep the pairing UX unchanged while the install surface changes underneath it. |
| `@codex-mobile/protocol` | `0.1.0` | Shared pairing/bootstrap response contracts | Publish and consume dist-based protocol types rather than repo-local path aliases. |
| `@codex-mobile/auth` | `0.1.0` | Shared ws-ticket mint/verify helpers | Publish it as a slim JWT helper package with no db dependency so the CLI can depend on it cleanly. |
| Reference pattern: `resources/gsd-2/packages/pi-coding-agent/src/core/auth-storage.ts` | local reference | File-permission and local-auth storage pattern | Use only as design input for restrictive local credential storage. |
| Reference pattern: `resources/gsd-2/scripts/install-pi-global.js` | local reference | Installed resource bootstrap pattern | Useful precedent for global-install resource layout and postinstall-safe copying behavior. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Public `handoff` package plus public auth/protocol support packages | One fully bundled single-file CLI artifact | Bundling reduces publish surface, but publishing the existing shared packages keeps the current code organization clearer and avoids phase-wide refactors of shared imports. |
| Dedicated bridge bootstrap token persisted locally | Persist raw `WS_TICKET_SECRET` locally and keep current daemon env contract | Simpler to wire, but it violates the hosted-secret boundary and is not an install-safe security model. |
| XDG-backed config/state files with `0700` / `0600` permissions | Reuse browser cookies or localStorage-style browser state for bridge auth | Browser device sessions and local daemon bootstrap are different trust objects; reusing browser cookies would couple unrelated security domains. |
| PID + lock file daemon reuse | Always start a fresh foreground daemon from the slash command path | Simpler process model, but it fails `LAUNCH-04` and would make every handoff invocation pay a cold-start tax. |

## Architecture Patterns

### Recommended Project Structure

```text
apps/bridge/
├── package.json                # public npm package manifest: name = "handoff"
├── tsconfig.json               # package-local TypeScript config for dist output
└── src/
    ├── cli.ts
    ├── cli/
    │   ├── pair.ts
    │   ├── daemon.ts
    │   └── launch.ts
    ├── daemon/
    │   ├── bridge-daemon.ts
    │   ├── daemon-manager.ts
    │   └── relay-connection.ts
    └── lib/
        ├── pairing-client.ts
        ├── bootstrap-client.ts
        └── local-state.ts

apps/web/app/api/
└── bridge/
    └── connect-ticket/route.ts

packages/db/src/
└── repositories/
    └── bridge-installations.ts
```

### Pattern 1: Publishable CLI Surface With Dist-Based Shared Packages

**What:** Make `handoff` a real npm install target with a public bin, package-local TypeScript config, and shared dependencies that resolve from `dist/` instead of repo source files.

**When to use:** Before any bootstrap or daemon work. The install contract is a prerequisite for the rest of the milestone.

**Why:** Today the install path is structurally broken:

- `apps/bridge/package.json` is private and still names the bin `codex-mobile-bridge`
- `apps/bridge` has no `tsconfig.json`, so `npm run build --workspace @codex-mobile/bridge` fails with `TS5058`
- `packages/auth` has no `tsconfig.json` and exports `src/*.ts` files directly
- `packages/auth` currently depends on `@codex-mobile/db`, which drags a private Postgres package into the bridge dependency graph

**Recommendation:** Make `apps/bridge` the public `handoff` package, publish `@codex-mobile/auth` and `@codex-mobile/protocol` as dist-based support packages, and add a tarball smoke test that extracts the generated package and runs the built CLI help path.

### Pattern 2: Dedicated Bridge Installation Record

**What:** Persist a bridge-specific installation or bootstrap record on the hosted side, separate from browser `device_sessions`.

**Why:** The current pairing flow proves local operator presence, but the durable browser device session is minted later on `/claim` for the phone browser. That cookie is not the same trust object as "this local bridge installation may reconnect and fetch a short-lived bridge ticket".

**Recommended fields:**

```ts
{
  id: string;                  // bridgeInstallationId
  userId: string;
  pairingId: string;
  bridgeInstanceId: string;
  deviceLabel: string | null;
  installTokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}
```

**Recommendation:** Mint the raw bootstrap token exactly once when the pairing confirm path succeeds. Persist only its SHA-256 hash on the hosted side, and store the raw token locally in a `0600` credential file.

### Pattern 3: Hosted Bridge Connect-Ticket Exchange

**What:** The daemon uses the stored bootstrap token to call a hosted route such as `POST /api/bridge/connect-ticket`, and that route mints a normal short-lived ws-ticket for `/ws/bridge`.

**Why:** This preserves the existing relay-side auth pattern while removing the local need for `WS_TICKET_SECRET`, `CODEX_MOBILE_USER_ID`, and `CODEX_MOBILE_DEVICE_SESSION_ID`.

**Recommended flow:**

1. `handoff pair` calls `POST /api/pairings`
2. The phone redeems and the operator confirms the verification phrase
3. `POST /api/pairings/[pairingId]/confirm` creates a bridge installation row and returns `bridgeInstallationId` plus a raw `bridgeBootstrapToken`
4. The CLI stores that token locally with restrictive permissions
5. `handoff daemon` or `handoff launch` calls `POST /api/bridge/connect-ticket` with the bootstrap token and `bridgeInstallationId`
6. The hosted route returns `{ relayUrl, ticket, expiresAt, bridgeInstallationId }`
7. The daemon opens `/ws/bridge` with that short-lived ticket and repeats the exchange on reconnect

### Pattern 4: XDG-Backed Local State and Credential Split

**What:** Separate config, credential, and daemon-process metadata into explicit local files.

**Recommended locations:**

- config dir: `${XDG_CONFIG_HOME}/handoff` fallback `~/.config/handoff`
- state dir: `${XDG_STATE_HOME}/handoff` fallback `~/.local/state/handoff`

**Recommended files:**

```json
// config.json
{
  "baseUrl": "https://app.example.fly.dev",
  "relayUrl": "wss://relay.example.fly.dev",
  "bridgeInstallationId": "uuid",
  "bridgeInstanceId": "uuid",
  "deviceLabel": "Lakshman's MacBook"
}
```

```json
// credentials.json
{
  "bridgeBootstrapToken": "opaque-base64url-token"
}
```

```json
// daemon.json
{
  "pid": 12345,
  "status": "running",
  "startedAt": "2026-04-19T12:00:00.000Z"
}
```

**Why:** The token that proves bridge-installation identity is a different secret from ordinary config or transient daemon metadata. Splitting them keeps the boundary clear and makes rotation or revocation simpler.

### Pattern 5: Daemon Reuse Through Local Process State

**What:** Add a daemon manager that checks for a live local bridge and only starts a new one when none exists.

**Why:** Phase 07 needs a Codex-side command that can call into a local handoff entrypoint without asking the user to think about process management. That entrypoint needs a stable "ensure bridge available" primitive first.

**Recommended status contract:**

- `starting`
- `running`
- `stale`
- `stopped`

**Recommended CLI behavior:**

- `handoff pair` persists bootstrap state locally
- `handoff daemon` becomes the internal foreground process path
- `handoff launch` checks for a running daemon and returns `daemon_reused` or `daemon_started`

## Key Findings and Pitfalls

### Critical Gaps

1. **The publish target is not actually publishable today.**  
   `apps/bridge/package.json` is private, its bin name is `codex-mobile-bridge`, and `apps/bridge/tsconfig.json` does not exist. A direct `npm run build --workspace @codex-mobile/bridge` currently fails with `TS5058: The specified path does not exist: 'tsconfig.json'.`

2. **The shared package build baseline is incomplete.**  
   `packages/auth`, `packages/db`, and `apps/web` also lack package-local `tsconfig.json` files even though their scripts assume one exists. That means Phase 06 cannot rely on current workspace build/typecheck scripts as a publish gate.

3. **The bridge depends on hosted signing secrets.**  
   `apps/bridge/src/cli.ts` still requires `CODEX_MOBILE_WS_TICKET_SECRET` and passes it into `RelayConnection`, which mints the ws-ticket locally. That is not an install-safe boundary.

4. **The bridge still expects raw hosted identity values.**  
   The normal daemon path requires `CODEX_MOBILE_USER_ID` and `CODEX_MOBILE_DEVICE_SESSION_ID`. The user explicitly wants that gone.

5. **The pairing flow stops short of local bootstrap.**  
   `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` and `apps/web/lib/pairing-service.ts` confirm the local phrase, but the local bridge does not receive a reusable bootstrap credential. The browser device session is minted later via `/claim`, and that trust object belongs to the phone browser, not the local bridge daemon.

6. **The auth package is wider than the bridge needs.**  
   `packages/auth/package.json` currently depends on `@codex-mobile/db`, even though the bridge runtime only uses JWT helpers from `device-session.ts` and `ws-ticket.ts`. Leaving that in place would make the npm package graph heavier and harder to publish cleanly.

7. **There is no daemon reuse contract.**  
   The bridge can start in the foreground, but there is no PID, lock, or status tracking for "already running". Phase 07's slash command needs that seam.

### Consequences for Planning

- `06-01` must restore the package-local build and publish baseline before any bootstrap work is attempted.
- `06-02` should introduce a bridge-specific bootstrap token and local state before removing the env-driven daemon contract.
- `06-03` should replace the normal env-driven daemon startup path with local-state-driven ticket exchange and daemon reuse.

## Recommended Wave Split

| Wave | Plans | Why |
|------|-------|-----|
| 1 | `06-01` | The npm install surface and workspace build baseline have to exist before bootstrap or daemon orchestration work can be validated. |
| 2 | `06-02` | Secure local bootstrap state and hosted bridge-ticket minting are prerequisites for removing the daemon env contract. |
| 3 | `06-03` | Daemon reuse and launch orchestration should layer on top of the new bootstrap state rather than racing it. |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `2.1.8` workspace plus tarball smoke validation |
| Config file | `vitest.workspace.ts` |
| Quick run command | `vitest run apps/bridge/tests/unit/relay-connection.test.ts apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts` |
| Full phase suite command | `npm run typecheck && vitest run apps/bridge/tests/unit/relay-connection.test.ts apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts apps/bridge/tests/unit/daemon-manager.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts && npm run validate:handoff-pack` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-01 | `handoff` is buildable and packable outside the monorepo happy path | package build + tarball smoke | `npm run validate:handoff-pack` | no - Wave 0 |
| DIST-02 | Installed package exposes a real `handoff` bin for `npm install` and `npx` use | tarball smoke | `npm run validate:handoff-pack` | no - Wave 0 |
| DIST-03 | Local daemon startup reads stored bootstrap state instead of raw env values | bridge unit + web route unit | `vitest run apps/bridge/tests/unit/local-state.test.ts apps/bridge/tests/unit/bootstrap-client.test.ts apps/web/tests/unit/bridge-connect-ticket-route.test.ts` | no - Wave 0 |
| LAUNCH-04 | Local handoff start reuses or starts one outbound-only bridge daemon automatically | bridge unit | `vitest run apps/bridge/tests/unit/daemon-manager.test.ts apps/bridge/tests/unit/launch-command.test.ts apps/bridge/tests/unit/relay-connection.test.ts` | partial |

### Sampling Rate

- **Per task commit:** targeted Vitest for touched bridge/web install or daemon files
- **Per plan completion:** `npm run typecheck` plus the task-relevant Vitest slice
- **Phase gate:** tarball smoke must pass and local daemon reuse must be manually exercised once on a clean shell session

### Wave 0 Gaps

- [ ] `apps/bridge/tests/unit/local-state.test.ts` for XDG path resolution, file permissions, and persisted bootstrap state
- [ ] `apps/bridge/tests/unit/bootstrap-client.test.ts` for bridge connect-ticket exchange and error handling
- [ ] `apps/bridge/tests/unit/daemon-manager.test.ts` for PID/lock reuse and stale-process detection
- [ ] `apps/bridge/tests/unit/launch-command.test.ts` for `daemon_reused` vs `daemon_started`
- [ ] `apps/web/tests/unit/bridge-connect-ticket-route.test.ts` for hosted bootstrap token validation and ws-ticket minting
- [ ] `scripts/validate-handoff-pack.mjs` for tarball extraction plus CLI help smoke

## Sources

### Primary (HIGH confidence)
- Local repo: `.planning/ROADMAP.md` — authoritative Phase 06 split and success criteria
- Local repo: `.planning/REQUIREMENTS.md` — requirement IDs for Phase 06
- Local repo: `.planning/STATE.md` — milestone context and current blockers
- Local repo: `AGENTS.md` — project constraints and workflow rules
- Local repo: `apps/bridge/package.json` — current private bridge package metadata
- Local repo: `apps/bridge/src/cli.ts` — current env-driven CLI contract
- Local repo: `apps/bridge/src/cli/pair.ts` — current pairing entrypoint and confirm flow
- Local repo: `apps/bridge/src/lib/pairing-client.ts` — current hosted pairing API client
- Local repo: `apps/bridge/src/daemon/relay-connection.ts` — current locally minted ws-ticket flow
- Local repo: `apps/web/lib/pairing-service.ts` — hosted pairing state machine
- Local repo: `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` — bridge-side confirm response shape
- Local repo: `apps/web/app/api/pairings/[pairingId]/claim/route.ts` — browser device-session issuance
- Local repo: `apps/web/lib/live-session/server.ts` — hosted ws-ticket minting path for browser clients
- Local repo: `packages/auth/package.json` and `packages/auth/src/*.ts` — current auth helper dependency surface
- Local repo: `packages/protocol/package.json` and `packages/protocol/src/*.ts` — current protocol export model
- Local repo: `vitest.workspace.ts` — current unit-test infrastructure

### Secondary (MEDIUM confidence)
- Local repo: `resources/gsd-2/packages/pi-coding-agent/src/core/auth-storage.ts` — useful local credential storage and file-permission pattern
- Local repo: `resources/gsd-2/scripts/install-pi-global.js` — useful installed-resource bootstrap pattern
- Local repo: `README.md` — public product framing and current local-dev/operator expectations
