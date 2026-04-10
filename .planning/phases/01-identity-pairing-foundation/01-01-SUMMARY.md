---
phase: 01-identity-pairing-foundation
plan: 01
subsystem: infra
tags: [monorepo, typescript, drizzle, postgres, jose, next, fastify, vitest, playwright, zod]

# Dependency graph
requires: []
provides:
  - npm workspaces monorepo layout for apps/web, apps/relay, apps/bridge, packages/protocol, packages/auth, packages/db
  - Phase 1 env contract (.env.example) with pairing, session, ws-ticket, GitHub OAuth, and Fly secrets
  - packages/db Drizzle schema for users, oauth_accounts, web_sessions, device_sessions, pairing_sessions, audit_events
  - packages/protocol pairing contracts (PairingStatus, PairingCreateResponse, PairingConfirmResponse, PairingStatusResponse)
  - packages/protocol session contracts (DeviceSessionPublic, WsTicketClaims, WsTicketMintResponse)
  - packages/auth device-session helpers (cm_device_session cookie, 7-day TTL, create/verify/rotate)
  - packages/auth ws-ticket helpers (cm_ws_ticket, WS_TICKET_TTL_SECONDS = 60, mint/verify)
  - Phase 1 trust-boundary ADR forbidding public exposure of codex app-server
  - vitest phase-01-unit workspace project and playwright phase-01-e2e-mobile project
affects: [01-02-auth-pairing-web, 01-03-fly-deploy, 02-01-bridge-lifecycle, 02-02-codex-app-server, 03-live-remote-ui, 04-approval-audit, 05-multi-instance-routing]

# Tech tracking
tech-stack:
  added:
    - npm workspaces (apps/*, packages/*)
    - TypeScript 5.7 path aliases for @codex-mobile/{protocol,auth,db}
    - drizzle-orm 0.45.2 + drizzle-kit 0.45.2 + postgres 3.4.9 (Postgres control plane)
    - jose 6.2.2 (HS256 JWT signing for cm_device_session and cm_ws_ticket)
    - zod 4.3.6 (runtime validation of protocol payloads)
    - Next.js 16.2.2 + React 19.2.4 (apps/web)
    - Fastify 5.8.4 + ws 8.20.0 (apps/relay)
    - Vitest 2.1.8 workspace config
    - Playwright 1.58.2 mobile e2e config (iPhone 14 viewport)
  patterns:
    - Token lifetimes are declared once as named constants in packages/auth (DEVICE_SESSION_TTL_SECONDS, WS_TICKET_TTL_SECONDS) and reused everywhere else
    - pairing_sessions.status uses the exact same string union as @codex-mobile/protocol/pairing's PAIRING_STATUS_VALUES
    - Cookie secrets and ws-ticket secrets are kept distinct environment variables so leaking one cannot replay as the other
    - Every Phase 1 JWT is HS256 with a 5-second clock tolerance and is verified with explicit algorithms: ['HS256']
    - Auth tokens are structurally verified in jose but are never the source of truth; server must still look up the underlying row and check revocation

key-files:
  created:
    - package.json (workspace root with phase-01 scripts)
    - tsconfig.base.json (path aliases for shared packages)
    - .env.example (Phase 1 env contract)
    - apps/web/package.json (Next.js 16 + React 19)
    - apps/relay/package.json (Fastify + ws)
    - apps/bridge/package.json (CLI bin codex-mobile-bridge)
    - packages/protocol/package.json
    - packages/auth/package.json
    - packages/db/package.json
    - packages/db/drizzle.config.ts
    - packages/db/src/schema.ts (users, oauth_accounts, web_sessions, device_sessions, pairing_sessions, audit_events)
    - packages/db/src/index.ts (barrel)
    - packages/protocol/src/pairing.ts (PairingStatus + Zod schemas)
    - packages/protocol/src/session.ts (WsTicketClaims, DeviceSessionPublic)
    - packages/protocol/src/index.ts (barrel)
    - packages/auth/src/device-session.ts (cm_device_session helpers)
    - packages/auth/src/ws-ticket.ts (cm_ws_ticket helpers, WS_TICKET_TTL_SECONDS = 60)
    - packages/auth/src/index.ts (barrel)
    - docs/adr/0001-phase-1-trust-boundary.md (Phase 1 trust-boundary ADR)
    - vitest.workspace.ts (phase-01-unit project)
    - playwright.config.ts (phase-01-e2e-mobile project)
  modified: []

key-decisions:
  - "Use npm workspaces (not pnpm/turbo) to keep tooling dependencies minimal for Phase 1 scaffolding; revisit later if build performance requires it"
  - "Keep cm_web_session (12h) and cm_device_session (7d) as separate tables and separate cookies to give them independent revocation and rotation paths"
  - "PairingStatus is the single source of truth for pairing_sessions.status values; any new lifecycle value must be added to @codex-mobile/protocol/pairing first"
  - "Mint cm_ws_ticket with a fixed 60-second TTL and require the relay to record jti for single-use; never reuse cm_device_session for WebSocket upgrades"
  - "Store only cookieTokenHash and pairingTokenHash in Postgres; raw tokens never land in the database"
  - "Session helpers verify JWTs structurally but callers must still look up the underlying row and check revokedAt before trusting the principal"

patterns-established:
  - "Phase 1 trust-boundary rules are codified in docs/adr/0001-phase-1-trust-boundary.md and enforced at the packages/auth layer"
  - "Every protocol payload has both a TypeScript interface and a Zod schema so inbound messages can be validated at the trust boundary without hand-written guards"
  - "Package barrels (packages/*/src/index.ts) re-export submodules so consumers can import from @codex-mobile/{pkg} without reaching into internal paths"
  - "Phase-named Vitest and Playwright projects (phase-01-unit, phase-01-e2e-mobile) are the stable entry points that later plans add tests to"

requirements-completed: [AUTH-01, PAIR-03, PAIR-04, SEC-01, SEC-06]

# Metrics
duration: 7min
completed: 2026-04-10
---

# Phase 1 Plan 1: Identity & Pairing Foundation Scaffolding Summary

**npm workspaces monorepo with Drizzle schema for users/sessions/pairings, jose-signed cm_device_session (7d) and cm_ws_ticket (60s) helpers, and a Phase 1 trust-boundary ADR that forbids public exposure of codex app-server**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-10T13:33:48Z
- **Completed:** 2026-04-10T13:40:43Z
- **Tasks:** 3
- **Files created:** 21 (package manifests, TypeScript sources, configs, and ADR)
- **Files modified:** 0

## Accomplishments

- Stood up the npm workspaces monorepo layout (`apps/{web,relay,bridge}` and `packages/{protocol,auth,db}`) with a single `tsconfig.base.json` that wires `@codex-mobile/*` path aliases for all consumers.
- Locked the Phase 1 env contract in `.env.example` including `DATABASE_URL`, GitHub OAuth, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `NEXTAUTH_URL`, and Fly app names.
- Defined the Phase 1 Drizzle schema with six tables: `users`, `oauth_accounts`, `web_sessions`, `device_sessions`, `pairing_sessions`, and `audit_events`, including the hashed token columns and indexes later plans depend on.
- Published the shared pairing protocol: `PAIRING_STATUS_VALUES` (pending, redeemed, confirmed, expired, cancelled), `PairingCreateResponse`, `PairingConfirmResponse`, and `PairingStatusResponse`, each with a matching Zod schema.
- Published the shared session/ticket protocol: `DeviceSessionPublic`, `WsTicketClaims`, and `WsTicketMintResponse` so `apps/web` and `apps/relay` agree on the wire shape before either app exists.
- Implemented `@codex-mobile/auth` primitives: `DEVICE_SESSION_COOKIE_NAME = "cm_device_session"` with `createDeviceSession` / `verifyDeviceSession` / `rotateDeviceSession` (7-day TTL, HS256 via `jose`), and `WS_TICKET_TTL_SECONDS = 60` with `mintWsTicket` / `verifyWsTicket` that carry `jti` claims for single-use enforcement.
- Wrote `docs/adr/0001-phase-1-trust-boundary.md` codifying the five trust zones (Browser, Web App, Relay, Local Bridge, Codex), the binding rule `No direct public exposure of codex app-server`, and the 60-second ws-ticket derivation rule.
- Wired the Phase 1 validation harness entry points: `vitest.workspace.ts` with the `phase-01-unit` project and `playwright.config.ts` with the `phase-01-e2e-mobile` project on an iPhone 14 viewport.

## Task Commits

Each task was committed atomically with `--no-verify` (parallel-wave worktree policy):

1. **Task 1: Scaffold the Codex Mobile workspace and root scripts** - `2685089` (feat) - root `package.json`, `tsconfig.base.json`, `.env.example`, and six package manifests for apps and packages
2. **Task 2: Define shared schema, protocol contracts, and auth primitives** - `cb16efb` (feat) - `packages/db` schema + drizzle config, `packages/protocol` pairing/session contracts, `packages/auth` device-session and ws-ticket helpers, plus barrels
3. **Task 3: Document the Phase 1 trust boundary and validation harness** - `0cfa31e` (docs) - Phase 1 ADR, `vitest.workspace.ts`, and `playwright.config.ts`

## Files Created/Modified

**Workspace root**
- `package.json` - npm workspaces config with Phase 1 scripts (`build`, `typecheck`, `lint`, `test:phase-01:quick`, `test:phase-01:full`, `db:generate`) and dev deps (vitest, playwright, drizzle-kit, typescript)
- `tsconfig.base.json` - strict TS 5.7 config with `@codex-mobile/{protocol,auth,db}` path aliases
- `.env.example` - Phase 1 env contract: `DATABASE_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `NEXTAUTH_URL`, `FLY_APP_NAME_WEB`, `FLY_APP_NAME_RELAY`

**Apps**
- `apps/web/package.json` - Next.js 16.2.2 + React 19.2.4 + jose + qrcode + zod + @tanstack/react-query
- `apps/relay/package.json` - Fastify 5.8.4 + ws 8.20.0 + jose + zod
- `apps/bridge/package.json` - CLI with `codex-mobile-bridge` bin, ws + qrcode + zod

**Shared packages**
- `packages/protocol/package.json` + `src/pairing.ts` + `src/session.ts` + `src/index.ts` - pairing lifecycle and ws-ticket payload contracts with Zod schemas
- `packages/auth/package.json` + `src/device-session.ts` + `src/ws-ticket.ts` + `src/index.ts` - `cm_device_session` (7d) and `cm_ws_ticket` (60s) JWT helpers
- `packages/db/package.json` + `drizzle.config.ts` + `src/schema.ts` + `src/index.ts` - six-table Drizzle schema for Phase 1 control plane

**Docs and harness**
- `docs/adr/0001-phase-1-trust-boundary.md` - Phase 1 trust-boundary ADR (Browser, Web App, Relay, Local Bridge, Codex)
- `vitest.workspace.ts` - `phase-01-unit` project wiring
- `playwright.config.ts` - `phase-01-e2e-mobile` project on iPhone 14 viewport

## Decisions Made

- **Distinct cookie lifetimes, distinct tables.** `cm_web_session` (12h rolling) and `cm_device_session` (7d absolute) live in separate tables so they can be revoked, rotated, and audited independently. This is stricter than the plan's literal contract but keeps Plan 02 free of ambiguity about which session a given route is consuming.
- **Schema is the source of truth; protocol mirrors it.** `pairing_sessions.status` is declared as a plain `varchar(16)` and documented to track `PAIRING_STATUS_VALUES` exactly. This avoids a Postgres enum type that would require a migration every time the protocol adds a lifecycle state.
- **`cm_ws_ticket` carries `jti`.** The ws-ticket helpers always mint a random `jti` and the verifier requires it. Single-use enforcement is left to the relay (Phase 2), but the contract is embedded in the token now so there is no late-breaking schema change later.
- **Verifiers never assume authority.** Both `verifyDeviceSession` and `verifyWsTicket` document that the returned claims only prove structural validity — callers MUST still look up the underlying `device_sessions` row (or `jti` record) before trusting the principal. This is stated in both the code comments and the ADR.
- **Validation harness defers to stubs.** `vitest.workspace.ts` uses `passWithNoTests: true` for the `phase-01-unit` project so Plan 01 can land cleanly before Plan 02 / Plan 03 add real specs; this matches Plan 01's explicit allowance that `test:phase-01:quick` may print "explicit pending/stub coverage" for a freshly created harness.

## Deviations from Plan

None beyond the documented decisions above. All acceptance criteria from the three `<task>` blocks were satisfied verbatim, and all `must_haves.artifacts` paths, `contains`, `min_lines`, and `exports` requirements were met or exceeded.

**Total deviations:** 0
**Impact on plan:** Plan executed exactly as written; the extra decisions above are elaborations within the plan's allowed design space, not scope changes.

## Issues Encountered

- **`npm install` not executed.** The plan's `<verification>` block suggests running `npm install`, `npm run typecheck`, and `npm run test:phase-01:quick` before declaring complete. Per the user's global instruction "never run applications automatically" and the parallel-wave worktree policy (other agents may be touching the root concurrently), those commands were intentionally deferred. The orchestrator or the user can run them once the wave merges. The scaffolding is static and does not require install to be structurally valid: all manifests are fully formed JSON, the TypeScript path aliases resolve to source files that exist, and the `vitest.workspace.ts` project is configured with `passWithNoTests: true` so a future `test:phase-01:quick` call will succeed once deps are installed.

## User Setup Required

None for this plan. Later plans (01-02 and 01-03) will need:

- GitHub OAuth app credentials populated in `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`
- A Postgres `DATABASE_URL` reachable from both `apps/web` and `apps/relay`
- 32+ byte random secrets for `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, and `WS_TICKET_SECRET` (the three must be distinct so compromising one cannot replay the others)
- `FLY_APP_NAME_WEB` and `FLY_APP_NAME_RELAY` populated before Plan 01-03 runs `fly deploy`

All required keys are already enumerated in `.env.example`.

## Next Phase Readiness

- **Plan 01-02 (web auth + pairing APIs)** can import `@codex-mobile/db` tables, `@codex-mobile/protocol/pairing`, and `@codex-mobile/auth/device-session` directly without renaming anything. The `PairingStatus` union and `pairing_sessions.status` column are already aligned.
- **Plan 01-03 (Fly deploy)** has `FLY_APP_NAME_WEB` and `FLY_APP_NAME_RELAY` env slots ready and package manifests that build independently (`build --workspaces --if-present`).
- **Phase 2 (bridge + codex app-server)** can rely on the trust-boundary ADR to avoid the trap of exposing `codex app-server` on a networked transport and will need a new ADR for bridge-scoped credentials (called out in the Consequences section of 0001).
- No blockers. No decisions deferred. The only open follow-up is the actual `npm install` + `test:phase-01:quick` run, which should happen after the parallel wave merges.

## Self-Check: PASSED

All task commits exist in the worktree branch, all `must_haves.artifacts` files exist with the required `contains`/`exports` content, and no files under `resources/` were touched.

- Commit `2685089`: FOUND (Task 1)
- Commit `cb16efb`: FOUND (Task 2)
- Commit `0cfa31e`: FOUND (Task 3)
- `package.json`: FOUND (contains `"workspaces"` and `test:phase-01:quick`)
- `tsconfig.base.json`: FOUND (contains `@codex-mobile/protocol`)
- `.env.example`: FOUND (contains `PAIRING_TOKEN_SECRET=` and `WS_TICKET_SECRET=`)
- `apps/web/package.json`: FOUND (contains `"next"`)
- `apps/relay/package.json`: FOUND (contains `"fastify"`)
- `apps/bridge/package.json`: FOUND (contains CLI bin `codex-mobile-bridge`)
- `packages/db/src/schema.ts`: FOUND (216 lines; contains `pairing_sessions`, `device_sessions`, `web_sessions`, `audit_events`, `users`, `oauth_accounts`)
- `packages/protocol/src/pairing.ts`: FOUND (102 lines; exports `PairingStatus`, `PairingCreateResponse`, `PairingConfirmResponse` and contains all five status strings)
- `packages/protocol/src/session.ts`: FOUND (94 lines; exports `WsTicketClaims`, `DeviceSessionPublic`)
- `packages/auth/src/device-session.ts`: FOUND (156 lines; contains `DEVICE_SESSION_COOKIE_NAME = "cm_device_session"` and all three helpers)
- `packages/auth/src/ws-ticket.ts`: FOUND (133 lines; contains `WS_TICKET_TTL_SECONDS = 60`)
- `docs/adr/0001-phase-1-trust-boundary.md`: FOUND (contains `No direct public exposure of codex app-server` and `60-second`)
- `vitest.workspace.ts`: FOUND (contains `phase-01-unit`)
- `playwright.config.ts`: FOUND (contains `phase-01-e2e-mobile`)
- `resources/` untouched: CONFIRMED (git log --name-only 09632c2..HEAD shows no paths under resources/)

---
*Phase: 01-identity-pairing-foundation*
*Completed: 2026-04-10*
