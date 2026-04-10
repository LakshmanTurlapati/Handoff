---
phase: 01-identity-pairing-foundation
plan: 03
subsystem: infra
tags: [fly.io, docker, node22, nextjs, fastify, github-actions, healthcheck, tls, deploy, secrets]

# Dependency graph
requires:
  - 01-01 workspace scaffolding (apps/web, apps/relay, packages/{auth,db,protocol}) and the Phase 1 env contract in .env.example
  - 01-02 Auth.js wiring (apps/web/auth.config.ts PUBLIC_PATHS), pairing routes, apps/relay/src/server.ts, and apps/relay/src/routes/health.ts
provides:
  - apps/web GET /api/healthz liveness route (force-dynamic, dependency-free, JSON {status, service, timestamp, uptimeSeconds})
  - apps/relay/src/routes/readyz.ts as its own file with handleReadyz + registerReadyzRoute, re-exported from health.ts for backward compatibility
  - apps/relay/src/index.ts bootstrap entry point that calls startRelayServer and installs SIGINT/SIGTERM handlers
  - apps/web/Dockerfile (multi-stage node:22-alpine, EXPOSE 3000, non-root node user, npm workspace aware, next build + next start)
  - apps/relay/Dockerfile (multi-stage node:22-alpine, EXPOSE 8080, non-root node user, npm workspace aware, --experimental-strip-types entry)
  - apps/web/fly.toml (internal_port 3000, force_https, HTTP health check GET /api/healthz, rolling deploy)
  - apps/relay/fly.toml (internal_port 8080, force_https, HTTP service check GET /readyz, separate /healthz machine liveness, min_machines_running=1)
  - .github/workflows/fly-deploy.yml (flyctl-actions/setup-flyctl, staged secrets set, remote-only deploys for web and relay, all required GitHub Actions secrets documented inline)
  - README.md operator sections: Local Development, Authentication Setup, Pairing Flow, Fly.io Deployment
  - .env.example annotated with "Used by" markers and secret generation commands so operators know which Fly app consumes which key
  - apps/web/auth.config.ts PUBLIC_PATHS extended with /api/healthz so Fly probes never redirect to GitHub OAuth
affects: [02-01-bridge-lifecycle, 02-02-codex-app-server, 05-02-fly-multi-instance-routing]

# Tech tracking
tech-stack:
  added:
    - Fly.io deployment manifests (fly.toml v2 schema) for apps/web and apps/relay
    - Docker multi-stage builds on node:22-alpine for both services with non-root runtime and workspace-aware npm ci
    - GitHub Actions fly-deploy workflow using superfly/flyctl-actions/setup-flyctl@master
    - Next.js runtime hints on the healthz route (runtime = "nodejs", dynamic = "force-dynamic", revalidate = 0)
    - --experimental-strip-types as the relay production entry strategy (matches the relay dev script and avoids a mandatory build step in Phase 1)
  patterns:
    - "Health and readiness endpoints live in their own files so Plan 02-01 / Plan 05-02 can evolve readiness logic without touching liveness wiring or changing the Fly health check URL"
    - "Docker builds always use the repo root as context so the npm workspaces layout (packages/* plus apps/*) is visible to COPY instructions"
    - "Fly secrets are pushed via flyctl secrets set --stage before flyctl deploy so a single rolling release picks up the new values and the image layer never bakes secrets"
    - "Every env var in .env.example is annotated with Used by: markers so operators know which Fly app (web, relay, or both) consumes it"
    - "Auth middleware public-path allowlist is the single source of truth for which routes bypass OAuth; Fly probes MUST be added here before they can succeed"
    - "Phase 1 runtime uses Node 22 --experimental-strip-types so the Dockerfile does not require a compiled dist/ tree to boot; Plan 02-01 will swap to compiled JS once the relay grows real build steps"

key-files:
  created:
    - apps/web/app/api/healthz/route.ts
    - apps/relay/src/routes/readyz.ts
    - apps/relay/src/index.ts
    - apps/web/Dockerfile
    - apps/relay/Dockerfile
    - apps/web/fly.toml
    - apps/relay/fly.toml
    - .github/workflows/fly-deploy.yml
  modified:
    - apps/relay/src/routes/health.ts (delegated /readyz registration to ./readyz.ts and re-exported handleReadyz/registerReadyzRoute for backward compatibility)
    - apps/web/auth.config.ts (added /api/healthz to PUBLIC_PATHS so Fly health probes are not gated by GitHub OAuth)
    - README.md (inserted Local Development, Authentication Setup, Pairing Flow, and Fly.io Deployment sections between Status & Roadmap and Contributing; existing Just Handoff branding preserved verbatim)
    - .env.example (added Used by: annotations and secret generation commands without changing any existing keys)

key-decisions:
  - "Ship /readyz as its own file (apps/relay/src/routes/readyz.ts) but keep registerHealthRoutes in health.ts as the single wiring entry point consumed by server.ts so Plan 01-02's server bootstrap needs zero changes and future readiness evolution does not ripple into liveness"
  - "Use --experimental-strip-types in the relay Dockerfile CMD rather than a compiled dist/ tree because Phase 1 does not yet have a build step for the relay and the dev script already uses the same pattern; Plan 02-01 will swap to compiled JS when the relay grows real build output"
  - "Put the Docker build context at the repo root (not apps/{web,relay}) because both services depend on workspace packages (@codex-mobile/auth, @codex-mobile/db, @codex-mobile/protocol) that live under packages/*; each Dockerfile selects the sub-trees it actually needs so edits in unrelated apps do not bust the build cache"
  - "Extend apps/web/auth.config.ts PUBLIC_PATHS with /api/healthz as a correctness requirement (Rule 2) rather than an optional improvement; without this, Fly.io's health probe would get a 307 redirect to /sign-in and mark the web app unhealthy on every deploy, breaking OPS-01"
  - "Use two separate probe targets on the relay (HTTP service check on /readyz, [[services.http_checks]] machine liveness on /healthz) so Fly distinguishes 'ready for new traffic' from 'process alive', letting Plan 02-01 make readiness ownership-aware without ever changing the liveness URL"
  - "Secrets are pushed via flyctl secrets set --stage in the deploy workflow and then picked up by flyctl deploy so exactly one rolling release carries both the new image and the new secret values — this avoids a double-release race where a fresh image boots with stale secrets"
  - "GitHub Actions workflow runs deploy-relay with needs: deploy-web so the pairing API (web) is guaranteed to be live before the relay starts advertising readiness to future bridges"
  - "Add apps/relay/src/index.ts as a minimal bootstrap that calls startRelayServer plus SIGINT/SIGTERM handlers instead of folding the entry logic into server.ts; keeps server.ts pure (no side effects on import) so Vitest can continue to import it for handler tests without opening a socket"

patterns-established:
  - "Readiness-vs-liveness split: each service has a liveness probe (process alive, never blocks on I/O) and a separate readiness probe (allowed to accept new traffic). Readiness is the path Plan 02-01 will gate on ownership state."
  - "Fly deploy manifest owns the health check URL; the application code owns the handler shape. Changing the URL requires a fly.toml edit plus a deploy; changing the payload is a source-only change. This contract keeps the control plane from surprising the deploy pipeline."
  - "GitHub Actions secrets documentation lives at the top of .github/workflows/fly-deploy.yml as a header comment block so operators have a single file to read when populating the repo secrets page for the first time"
  - "README operator sections are always inserted BEFORE Contributing/License so the first-touch product narrative (Problem, Solution, Features, How It Works, Tech Stack, Status & Roadmap) stays above the operator runbook"

requirements-completed: [OPS-01]

# Metrics
duration: 9min
completed: 2026-04-10
---

# Phase 1 Plan 3: Fly.io Deploy Baseline Summary

**Two multi-stage node:22-alpine Dockerfiles, per-service fly.toml manifests with healthz/readyz probes, a staged-secrets GitHub Actions deploy workflow, and a README operator runbook covering local dev, auth, pairing, and Fly.io deployment — all wired so Plan 02-01 can start routing bridge traffic without touching the deploy pipeline**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-10T14:03:07Z
- **Completed:** 2026-04-10T14:12:10Z
- **Tasks:** 3
- **Files created:** 8 (healthz route, readyz module, relay bootstrap, two Dockerfiles, two fly.toml, deploy workflow)
- **Files modified:** 4 (health.ts, auth.config.ts, README.md, .env.example)

## Accomplishments

- **Split liveness and readiness into their own files.** `apps/relay/src/routes/readyz.ts` holds `handleReadyz` and `registerReadyzRoute`; `apps/relay/src/routes/health.ts` keeps `handleHealthz` and `registerHealthRoutes` (which now delegates `/readyz` to the new module) and re-exports the readyz API for backward compatibility so Wave 2 consumers are unaffected. The Next.js web app gets its own `apps/web/app/api/healthz/route.ts` with a force-dynamic, dependency-free JSON payload.
- **Added the missing relay bootstrap.** `apps/relay/src/index.ts` is the CMD target for the relay Dockerfile and the `start` script in `apps/relay/package.json`. It calls `startRelayServer` and installs SIGINT/SIGTERM shutdown handlers that call `app.close()` so Fly's rolling releases drain in-flight requests cleanly. Keeping the bootstrap thin means `server.ts` stays import-safe for Vitest.
- **Allowlisted `/api/healthz` in the auth config.** `apps/web/auth.config.ts` `PUBLIC_PATHS` now includes `/api/healthz`. Without this, Fly's health probe would get a 307 to `/sign-in` and the web app would never go live on a new release. This is a Rule 2 deviation (missing critical functionality) documented below.
- **Multi-stage Docker builds on `node:22-alpine`.** Both `apps/web/Dockerfile` and `apps/relay/Dockerfile` follow the same shape: a `deps` stage that copies every workspace manifest and runs `npm ci --workspaces --include-workspace-root`, a `build` stage that compiles the service and the packages it depends on, and a `runtime` stage that drops to the non-root `node` user and exposes the service port. `apps/web` exposes 3000 and runs `next start`; `apps/relay` exposes 8080 and runs `apps/relay/src/index.ts` via `--experimental-strip-types`.
- **Per-service `fly.toml` manifests with explicit probes.** `apps/web/fly.toml` targets `internal_port = 3000` and health-checks `GET /api/healthz` with `force_https = true` and a rolling deploy strategy. `apps/relay/fly.toml` targets `internal_port = 8080`, uses the HTTP service check on `/readyz` for readiness, and adds a separate `[[services.http_checks]]` liveness probe on `/healthz` so Fly distinguishes "process alive" from "ready for traffic". The relay runs `min_machines_running = 1` so it stays up for Plan 02-01 bridge connections.
- **Fly deploy workflow with staged secrets.** `.github/workflows/fly-deploy.yml` installs `flyctl`, stages every required secret (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `DATABASE_URL`) via `flyctl secrets set --stage`, then runs `flyctl deploy --remote-only` for both services. `deploy-relay` has `needs: deploy-web` so the pairing API is live before the relay starts advertising readiness. Every required GitHub Actions secret is documented in a header comment block at the top of the file so operators have one place to read.
- **README operator runbook.** Four new sections — `## Local Development`, `## Authentication Setup`, `## Pairing Flow`, `## Fly.io Deployment` — were inserted between the existing `## Status & Roadmap` and `## Contributing` sections without touching the user's "Just Handoff" branding. The sections cover prerequisites (Node 22, npm 10, Postgres, GitHub OAuth), per-workspace dev commands, local health endpoint curls, the end-to-end pairing handshake with the load-bearing "outbound connectivity only" security statement, manual and CI Fly deploy commands, required GitHub Actions secrets, and post-deploy verification curls.
- **Annotated `.env.example`.** Every key now carries a `Used by:` marker pointing at the service(s) that read it, a generation command where applicable (`openssl rand -base64 48`), a GitHub OAuth callback URL reminder, and documentation of which Fly health check path the `FLY_APP_NAME_*` keys unlock. No existing key was removed or renamed.

## Task Commits

Each task was committed atomically with `--no-verify` (parallel-wave worktree policy):

1. **Task 1: Add web and relay health endpoints plus container entrypoints** — `6e028ab` (feat) — `apps/web/app/api/healthz/route.ts`, `apps/relay/src/routes/readyz.ts`, `apps/relay/src/routes/health.ts` (refactor), `apps/relay/src/index.ts`, `apps/web/Dockerfile`, `apps/relay/Dockerfile`, `apps/web/auth.config.ts` (Rule 2 PUBLIC_PATHS extension)
2. **Task 2: Add Fly manifests and deploy workflow** — `491b378` (feat) — `apps/web/fly.toml`, `apps/relay/fly.toml`, `.github/workflows/fly-deploy.yml`
3. **Task 3: Document operator setup for local dev and Fly deployment** — `7f7a87d` (docs) — `README.md` (four new sections inserted before Contributing), `.env.example` (annotations added)

## Files Created/Modified

**apps/web — health endpoint**
- `apps/web/app/api/healthz/route.ts` (new) — `GET /api/healthz` exporting `WebHealthzPayload`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `revalidate = 0`, and a `cache-control: no-store` response header. Returns `{ status: "ok", service: "codex-mobile-web", timestamp, uptimeSeconds }`.
- `apps/web/auth.config.ts` (modified) — `PUBLIC_PATHS` extended from `["/sign-in", "/api/auth"]` to `["/sign-in", "/api/auth", "/api/healthz"]` with an inline comment explaining why Fly probes need to bypass OAuth.

**apps/relay — readiness split and bootstrap**
- `apps/relay/src/routes/readyz.ts` (new) — `ReadyzPayload` interface, `handleReadyz` pure function, and `registerReadyzRoute` Fastify wiring helper. Returns `{ status: "ready", service: "codex-mobile-relay", timestamp, version }`.
- `apps/relay/src/routes/health.ts` (modified) — now imports `registerReadyzRoute` from `./readyz` and re-exports `handleReadyz`, `registerReadyzRoute`, and `ReadyzPayload` for backward compatibility. `registerHealthRoutes` still owns `/healthz` inline and delegates `/readyz` to the new module. `server.ts` needs zero changes.
- `apps/relay/src/index.ts` (new) — minimal bootstrap that calls `startRelayServer({ logger: true })` and registers `process.once("SIGINT"|"SIGTERM", shutdown)` handlers that await `app.close()` before exiting. Exits 1 on bootstrap failure so Fly's deploy rolls back.

**Dockerfiles**
- `apps/web/Dockerfile` (new) — 3-stage multi-stage build on `node:22-alpine`. Stage 1 copies every workspace `package.json` and runs `npm ci --workspaces --include-workspace-root`. Stage 2 runs `next build` on `@codex-mobile/web` with `NEXT_TELEMETRY_DISABLED=1`. Stage 3 drops to the `node` user, sets `PORT=3000`, `HOSTNAME=0.0.0.0`, `NODE_ENV=production`, exposes 3000, and runs `npm start --workspace @codex-mobile/web`.
- `apps/relay/Dockerfile` (new) — same 3-stage shape on `node:22-alpine`. Stage 3 sets `PORT=8080`, `RELAY_HOST=0.0.0.0`, `NODE_ENV=production`, exposes 8080, and runs `node --experimental-strip-types apps/relay/src/index.ts`.

**Fly manifests**
- `apps/web/fly.toml` (new) — `app = "codex-mobile-web"` placeholder, `primary_region = "iad"`, `[build] dockerfile = "apps/web/Dockerfile"`, `[env]` with `NODE_ENV`, `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED`, `[http_service] internal_port = 3000 force_https = true auto_stop_machines = "stop"`, `[[http_service.checks]] path = "/api/healthz"`, `[[http_service.concurrency]] type = "requests" soft_limit = 200 hard_limit = 250`, `[[vm]] cpu_kind = "shared" cpus = 1 memory = "512mb"`, `[deploy] strategy = "rolling"`.
- `apps/relay/fly.toml` (new) — `app = "codex-mobile-relay"` placeholder, `[build] dockerfile = "apps/relay/Dockerfile"`, `[env]` with `NODE_ENV`, `PORT`, `RELAY_HOST`, `[http_service] internal_port = 8080 force_https = true auto_stop_machines = "off" min_machines_running = 1`, `[[http_service.checks]] path = "/readyz"`, a separate `[[services]]` block with `[[services.ports]] port = 443 handlers = ["tls", "http"] force_https = true` and `[[services.http_checks]] path = "/healthz"` for machine-level liveness, `[[http_service.concurrency]] type = "connections"`, `[[vm]] cpu_kind = "shared" cpus = 1 memory = "512mb"`, `[deploy] strategy = "rolling"`.

**GitHub Actions workflow**
- `.github/workflows/fly-deploy.yml` (new) — `name: fly-deploy`, triggers on `push: main` for `apps/web/**`, `apps/relay/**`, `packages/**`, or the workflow file itself, plus `workflow_dispatch` with a `service` choice input (`all`, `web`, `relay`). Concurrency group `fly-deploy-${{ github.ref }}` with `cancel-in-progress: true`. `deploy-web` job: checkout, `superfly/flyctl-actions/setup-flyctl@master`, `flyctl secrets set --stage --config apps/web/fly.toml` for `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `DATABASE_URL`, then `flyctl deploy --config apps/web/fly.toml --dockerfile apps/web/Dockerfile --remote-only --wait-timeout 300`. `deploy-relay` job: `needs: deploy-web`, same pattern with relay-appropriate secrets (no `AUTH_GITHUB_*`) and the relay fly.toml/Dockerfile. Every required GitHub Actions secret is documented in a header comment block at the top of the file.

**README and env docs**
- `README.md` (modified) — Four new sections inserted between `## Status & Roadmap` and `## Contributing`:
  - `## Local Development` — prerequisites (Node 22, npm 10, Postgres, GitHub OAuth), install/test commands, per-workspace `npm run dev` commands, local health endpoint descriptions, and a full env var table
  - `## Authentication Setup` — GitHub OAuth app creation walkthrough with the exact callback URL pattern `${NEXTAUTH_URL}/api/auth/callback/github` and Drizzle migration notes
  - `## Pairing Flow` — step-by-step narrative from `runPairCommand` through QR render, phone redeem, verification phrase, terminal confirm, and device session issuance; includes the load-bearing "outbound connectivity only" and "not a tunnel for general shell access" statements
  - `## Fly.io Deployment` — fly.toml table (app slug, config file, internal port, health check path), prerequisites, `fly secrets set` commands, `fly deploy --remote-only` commands, CI deploy reference to `.github/workflows/fly-deploy.yml`, list of required GitHub Actions secrets, security posture recap, and post-deploy verification curls
- `.env.example` (modified) — every key annotated with `Used by:` markers pointing at `apps/web`, `apps/relay`, both, or `deploys`; secret keys gained `openssl rand -base64 48` generation hints; GitHub OAuth keys gained the callback URL reminder; `FLY_APP_NAME_*` keys gained documentation of which Fly health check path each app uses. No existing key was removed or renamed.

## Decisions Made

- **`/readyz` lives in its own file but `registerHealthRoutes` stays the single wiring entry point.** `apps/relay/src/routes/readyz.ts` owns `handleReadyz` and `registerReadyzRoute`. `apps/relay/src/routes/health.ts` imports `registerReadyzRoute` and delegates during `registerHealthRoutes`. This means `apps/relay/src/server.ts` from Plan 01-02 needs zero changes, and Plan 02-01 can add ownership-aware readiness logic in `readyz.ts` without ever touching liveness wiring.
- **Relay runtime uses `--experimental-strip-types` rather than compiled JS.** The relay dev script already uses this pattern and Phase 1 does not have a `tsc` build step for `apps/relay`. Shipping a production image that boots TypeScript sources directly keeps the deploy green today without forcing Plan 01-03 to invent a build pipeline. Plan 02-01 will swap this for compiled `dist/` output when the relay grows real build-time concerns.
- **Docker build context is the repo root, not the per-service directory.** Both services depend on workspace packages under `packages/*` (`@codex-mobile/auth`, `@codex-mobile/db`, `@codex-mobile/protocol`). Setting the build context at the repo root lets each Dockerfile `COPY packages/auth`, `COPY packages/db`, etc. explicitly, which keeps the build cache tight (only copying the sub-trees each service actually uses) and avoids hoisting `node_modules` surprises.
- **Relay uses two different probe targets, web uses one.** The relay has `[[http_service.checks]] path = "/readyz"` for service readiness AND a separate `[[services.http_checks]] path = "/healthz"` for machine-level liveness. The web app only has `[[http_service.checks]] path = "/api/healthz"`. The asymmetry is deliberate: the relay needs the liveness/readiness split to support Plan 02-01's ownership gating; the web app will never need readiness gating because it has no bridge-ownership state.
- **Secrets are pushed via `flyctl secrets set --stage` before `flyctl deploy`.** Staging the values means the rolling release picks them up on the first restart. Without `--stage`, `flyctl secrets set` would trigger an immediate restart and the follow-up deploy would then trigger a SECOND rolling release — doubling downtime and creating a window where a freshly restarted machine boots with old image + new secrets.
- **`deploy-relay` has `needs: deploy-web` in the workflow.** The pairing API (web) is the target the bridge calls during `runPairCommand`. Making relay wait for web guarantees that once the relay advertises readiness, the pairing endpoint is already live. This is a nice-to-have today (the two services are independent in Phase 1) but becomes load-bearing in Plan 02-01 when the relay starts asserting bridge ownership against the web app's pairing records.
- **`apps/relay/src/index.ts` is new infrastructure added as part of Task 1, not a scope change.** The relay `package.json` already referenced `src/index.ts` in both the `dev` (`node --watch --experimental-strip-types src/index.ts`) and `start` (`node dist/index.js`) scripts, but the file didn't exist — Plan 01-02 shipped `server.ts` without a bootstrap. Adding it now is a Rule 3 blocking fix: without a real entry file, the Dockerfile CMD would not have a target to execute, making task 1's "explicit container entrypoints" `done` criterion unsatisfiable.
- **README sections are inserted BEFORE Contributing, not at the top of the file.** The user's existing "Just Handoff" narrative (Heads up, Problem, Solution, Features, How It Works, Tech Stack, Status & Roadmap) is the first thing a new reader sees and is load-bearing product marketing. Operator setup is correctly below that — anyone deploying the project will scroll past the intro anyway, and preserving the narrative above the runbook respects the user's intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Allowlisted `/api/healthz` in `apps/web/auth.config.ts` `PUBLIC_PATHS`**

- **Found during:** Task 1
- **Issue:** Plan 01-02 shipped `apps/web/middleware.ts` with an auth matcher that catches every path except Next.js internals, and `apps/web/auth.config.ts` `PUBLIC_PATHS = ["/sign-in", "/api/auth"]`. Adding `GET /api/healthz` without also adding it to the public-paths allowlist would cause Fly.io's health probe to receive a 307 redirect to `/sign-in`, which is a 3xx response and would be treated as a failed health check. The Fly release would never go live. This would silently break `OPS-01` on the first deploy.
- **Fix:** Extended `PUBLIC_PATHS` to `["/sign-in", "/api/auth", "/api/healthz"]` with an inline comment explaining why the health probe must bypass OAuth. The handler itself is dependency-free and reveals nothing sensitive (status, service name, timestamp, uptime seconds) so the allowlist is safe.
- **Files modified:** `apps/web/auth.config.ts`
- **Verification:** `grep /api/healthz apps/web/auth.config.ts` shows the new entry in `PUBLIC_PATHS`; the Next.js middleware will short-circuit on `pathname.startsWith("/api/healthz")` before reaching the auth gate.
- **Committed in:** `6e028ab` (Task 1)

**2. [Rule 3 — Blocking] Added `apps/relay/src/index.ts` bootstrap entry point**

- **Found during:** Task 1
- **Issue:** The relay `package.json` from Plan 01-01 referenced `src/index.ts` as both the dev target (`node --watch --experimental-strip-types src/index.ts`) and the compiled start target (`node dist/index.js`), but Plan 01-02 only created `src/server.ts` (which exports `buildRelayServer` and `startRelayServer` but does not call them). Task 1 requires an "explicit startup command" in the Dockerfile CMD. Without a real entry file, the CMD would have no target to execute, making the task's `done` criterion ("Both services expose health endpoints and have explicit container entrypoints for Fly") unsatisfiable.
- **Fix:** Created `apps/relay/src/index.ts` as a minimal bootstrap that calls `startRelayServer({ logger: true })` and installs `SIGINT`/`SIGTERM` handlers that call `app.close()` before exiting. Exits 1 on bootstrap failure so Fly's deploy rolls back cleanly. The bootstrap is deliberately thin so `server.ts` stays pure (no side effects on import) and Vitest can continue to import it for handler tests without opening a socket.
- **Files modified:** `apps/relay/src/index.ts` (new)
- **Verification:** File exists, `main()` calls `startRelayServer`, signal handlers installed with `process.once`, bootstrap failure path calls `process.exit(1)`. The Dockerfile `CMD ["node", "--experimental-strip-types", "apps/relay/src/index.ts"]` now has a real target.
- **Committed in:** `6e028ab` (Task 1)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing critical, 1 Rule 3 blocking)
**Impact on plan:** Both auto-fixes are essential for the plan's acceptance criteria to actually work in production. Rule 2 prevents a silent deploy failure where Fly probes never return 200; Rule 3 makes the Dockerfile CMD executable. Neither fix expanded scope — both are correctness requirements for the plan's stated `done` criteria.

## Auth Gates Encountered

None in this plan execution. All external credentials (`FLY_API_TOKEN`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `DATABASE_URL`, and the three random signing secrets) are deployment-time concerns that the operator will push to GitHub Actions secrets and Fly before running the `fly-deploy` workflow for the first time. The plan explicitly defers actual `fly deploy` execution to the operator per the `never run applications automatically` global rule.

## Issues Encountered

- **No `fly deploy`, `npm ci`, `next build`, or `docker build` was executed.** Per the user's global instruction `never run applications automatically` and the explicit constraint in the plan prompt (`No deploy/build commands executed — write config only`), every command in Task 1, Task 2, and Task 3 that would spawn an external process was intentionally deferred. Validation of the plan's artifacts is entirely static: every `must_haves.artifacts` `contains` pattern is verified with `grep`, every file exists on disk, and every acceptance criterion from the `<task>` blocks is satisfied without executing a single build. The operator will run `fly deploy` from the repo once the wave merges, following the runbook added to `README.md`.
- **Worktree base sync required a manual re-checkout.** The worktree started with `HEAD = 18496b4` (a Wave-1-only branch with the README/.gitignore addition) instead of the expected `bc57c2b` (Wave 2 merge). A `git reset --soft $EXPECTED_BASE` followed by `git checkout HEAD -- .` correctly synced the working tree with Wave 2 files (auth.ts, pairing routes, relay server.ts, etc.). The README.md at Wave 2 already contained the "Handoff" branding from an earlier merge path, so no content was lost. This is noted as a setup-time issue, not a correctness problem — the final HEAD is on `bc57c2b` as expected and all Wave 2 files are present.
- **Pre-existing scope boundary: no `tsconfig.json` in `apps/web`, `apps/relay`, or `apps/bridge`, no `next.config.{js,ts,mjs}` in `apps/web`.** These are pre-existing gaps from Wave 1/2 scaffolding, not introduced by this plan. They are intentionally NOT fixed here under the SCOPE BOUNDARY rule ("Only auto-fix issues DIRECTLY caused by the current task's changes"). Next.js 16 auto-detects the app directory without a config file so `next build` will still work; per-workspace `tsconfig.json` is a typecheck concern, not a deploy concern, because the Dockerfiles run Node directly without `tsc`. These are logged as follow-up items for a future plan (a phase-level cleanup plan or Plan 02-01).

## User Setup Required

The plan's `user_setup` block lists Fly.io credentials and dashboard steps. Operators need to:

1. Create a personal access token from Fly.io dashboard -> **Personal Access Tokens**, store as GitHub Actions secret `FLY_API_TOKEN`.
2. Create two Fly apps: one for `apps/web` (slug into `FLY_APP_NAME_WEB` and the `app = "..."` line in `apps/web/fly.toml`) and one for `apps/relay` (slug into `FLY_APP_NAME_RELAY` and the matching line in `apps/relay/fly.toml`).
3. Create a Fly Postgres instance with `fly postgres create` and attach it to both apps with `fly postgres attach --app <slug>`. The attach command injects `DATABASE_URL` as a Fly secret on each app.
4. Populate the seven GitHub Actions secrets listed in the workflow header: `FLY_API_TOKEN`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `DATABASE_URL`.
5. Run `fly auth login` locally if deploying manually, or push to `main` to trigger `.github/workflows/fly-deploy.yml` for the first deploy.

All of this is documented in the new `## Fly.io Deployment` section of `README.md` and in the header comment block of `.github/workflows/fly-deploy.yml`.

## Next Phase Readiness

- **Plan 02-01 (bridge lifecycle)** can extend `apps/relay/src/routes/readyz.ts` with ownership-aware readiness logic without ever changing the Fly health check URL. The `handleReadyz` function is already a pure async that can be made dependency-injected. `apps/relay/src/index.ts` is ready to host additional signal handlers or startup tasks (Postgres readiness probe, relay registry bootstrap) without touching `server.ts`.
- **Plan 02-02 (codex app-server)** has a stable deploy pipeline to push bridge-facing relay updates against. The `deploy-relay` job already waits on `deploy-web` so control-plane changes to the pairing API will always land first.
- **Plan 05-02 (multi-instance routing)** can swap the relay Dockerfile CMD from `--experimental-strip-types` to compiled `dist/index.js` once `apps/relay` grows a real `tsc -p apps/relay/tsconfig.json` build step. The `deps` stage in the relay Dockerfile is already workspace-aware and will pick up any new dependencies without a rewrite.
- **Known follow-ups:**
  - Add per-workspace `tsconfig.json` files and a `next.config.{js,ts}` for `apps/web` (pre-existing gap from Wave 1/2, not caused by this plan).
  - Swap the relay Dockerfile CMD to compiled JS once Plan 02-01 lands a real build step.
  - Add an E2E smoke spec that curls `/api/healthz` and `/readyz` against a deployed Fly instance (deferred to Plan 01-03 operator manual verification per the `<verification>` block).
  - Replace the `InMemoryPairingStore` / `InMemoryAuditStore` defaults in `apps/web/lib/pairing-service.ts` with Drizzle-backed implementations. This stub was introduced in Plan 01-02 and is documented as a known stub in `01-02-SUMMARY.md`; it is NOT introduced by this plan, but it IS a prerequisite for the web app's production deploy to actually persist pairings across a Fly restart. Plan 02-01 or a dedicated follow-up should address it.

## Known Stubs

No new stubs introduced by this plan. All artifacts added in Plan 01-03 are real code or real config — no hardcoded empty values, no placeholder text, no "coming soon" copy.

The `InMemoryPairingStore` / `InMemoryAuditStore` defaults in `apps/web/lib/pairing-service.ts` are a known stub from Plan 01-02 (documented in `01-02-SUMMARY.md` under "Known Stubs") and are still present. This plan does NOT resolve that stub because the plan's scope is deploy baseline, not persistence wiring. The stub will become a deploy-time concern (pairings lost on every Fly restart) as soon as the first user tries to pair a device against a production instance, so Plan 02-01 or a dedicated follow-up must swap these for Drizzle-backed implementations before the first public launch.

## Self-Check: PASSED

All three task commits exist in the worktree branch, all `must_haves.artifacts` files exist with the required `contains` patterns, all `must_haves.key_links` patterns are present in the expected files, and no files under `resources/` were touched.

- Commit `6e028ab`: FOUND (Task 1 — web/relay health endpoints + Dockerfiles)
- Commit `491b378`: FOUND (Task 2 — Fly manifests + deploy workflow)
- Commit `7f7a87d`: FOUND (Task 3 — README operator sections + .env.example annotations)
- `apps/web/app/api/healthz/route.ts`: FOUND (contains `status`, `service`, `WebHealthzPayload`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`)
- `apps/relay/src/routes/readyz.ts`: FOUND (contains `status`, `handleReadyz`, `registerReadyzRoute`, `ReadyzPayload`)
- `apps/relay/src/routes/health.ts`: FOUND (contains `handleHealthz`, `registerHealthRoutes`, delegates `/readyz` to `./readyz`, re-exports `handleReadyz` for backward compat)
- `apps/relay/src/index.ts`: FOUND (contains `startRelayServer`, `SIGINT`, `SIGTERM`, `process.exit(1)`)
- `apps/web/Dockerfile`: FOUND (contains `FROM node:22-alpine`, `EXPOSE 3000`, `npm ci --workspaces`, `next build`, `CMD ["npm", "start"`)
- `apps/relay/Dockerfile`: FOUND (contains `FROM node:22-alpine`, `EXPOSE 8080`, `npm ci --workspaces`, `CMD ["node", "--experimental-strip-types"`)
- `apps/web/fly.toml`: FOUND (contains `internal_port = 3000`, `path = "/api/healthz"`, `force_https = true`, `strategy = "rolling"`)
- `apps/relay/fly.toml`: FOUND (contains `internal_port = 8080`, `path = "/readyz"`, `path = "/healthz"`, `min_machines_running = 1`, `force_https = true`)
- `.github/workflows/fly-deploy.yml`: FOUND (contains `flyctl`, `PAIRING_TOKEN_SECRET`, `DATABASE_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `WS_TICKET_SECRET`, `FLY_API_TOKEN`, `flyctl secrets set --stage`, `flyctl deploy --remote-only`, `needs: deploy-web`)
- `README.md`: FOUND (contains `## Local Development`, `## Authentication Setup`, `## Pairing Flow`, `## Fly.io Deployment`, `/api/healthz`, `/readyz`, `outbound connectivity only`; existing `Just Handoff`, `The Problem`, `The Solution`, `Features`, `How It Works`, `Tech Stack`, `Status & Roadmap`, `About` sections preserved)
- `.env.example`: FOUND (all nine keys intact: `DATABASE_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `NEXTAUTH_URL`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `FLY_APP_NAME_WEB`, `FLY_APP_NAME_RELAY`; annotations added without removals)
- `apps/web/auth.config.ts`: FOUND (contains `/api/healthz` in `PUBLIC_PATHS`)
- `resources/` untouched: CONFIRMED (`git log --name-only bc57c2b..HEAD | grep ^resources/` is empty)

---
*Phase: 01-identity-pairing-foundation*
*Completed: 2026-04-10*
