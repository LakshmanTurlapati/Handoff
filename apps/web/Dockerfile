# syntax=docker/dockerfile:1.7
#
# Dockerfile for apps/web (Codex Mobile Phase 1 public web UI).
#
# Build strategy:
#   - Multi-stage Node 22 Alpine so the runtime image only carries what
#     `next start` actually needs at request time.
#   - The repo is an npm workspaces monorepo. apps/web depends on
#     `@codex-mobile/{auth,db,protocol}`, so the Docker build context
#     MUST be the repo root (configured in `apps/web/fly.toml`) and the
#     Dockerfile copies every workspace package.json before `npm ci`
#     to keep the dependency install layer cacheable.
#   - `next build` is run inside the image so the production image can
#     boot with `next start` without shelling out to a build step at
#     deploy time.
#
# The image exposes port 3000 (matched by `apps/web/fly.toml`
# internal_port). Fly.io's health check targets `/api/healthz` (see the
# fly.toml entry), which is the liveness endpoint added in plan 01-03
# task 1 and explicitly allowlisted by `apps/web/auth.config.ts` so the
# probe never round-trips through GitHub OAuth.

# -----------------------------------------------------------------------------
# Stage 1: install workspace dependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

# Copy workspace manifests first for cache reuse across source-only
# edits. Order: root package.json, lock file, then each workspace
# package.json.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/relay/package.json apps/relay/package.json
COPY apps/bridge/package.json apps/bridge/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/protocol/package.json packages/protocol/package.json

# This repo currently does not check in a root package-lock.json, so a
# clean `npm ci` cannot run inside Fly's remote builder yet. Use
# workspace-aware `npm install` until the lockfile becomes authoritative.
RUN npm install --workspaces --include-workspace-root

# -----------------------------------------------------------------------------
# Stage 2: build shared packages, then the Next.js app
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package.json ./package.json
COPY --from=deps /repo/package-lock.json* ./package-lock.json
COPY --from=deps /repo/tsconfig.base.json ./tsconfig.base.json

# Copy sources the web build needs. apps/relay and apps/bridge are
# intentionally omitted so edits there do not bust the web build cache.
COPY apps/web ./apps/web
COPY packages/auth ./packages/auth
COPY packages/db ./packages/db
COPY packages/protocol ./packages/protocol

# Build the shared packages first so the app can resolve workspace
# imports through their emitted `dist/` entrypoints during `next build`.
RUN npm run build --workspace @codex-mobile/protocol --if-present \
  && npm run build --workspace @codex-mobile/auth --if-present \
  && npm run build --workspace @codex-mobile/db --if-present

# Next.js production build. `--if-present` guards against the build
# script being intentionally absent during Phase 1 scaffolding; in
# normal operation this runs `next build` and produces `.next/`.
#
# CR-03 fix: the previous version swallowed a failing `next build` by
# piping it to a shell-true fallback. --if-present still returns 0
# when the script is genuinely absent, but now preserves the real
# exit code when the script runs and fails. A broken `next build`
# now fails the image build loudly instead of shipping a runtime-
# broken container.
RUN npm run build --workspace @codex-mobile/web --if-present

# Fail the build if `.next/` was not produced. This is the exact
# directory `npm start --workspace @codex-mobile/web` (i.e. `next start`)
# will read from at container boot. A container without `.next/` would
# crash on the first request in production — we prefer a loud build
# failure over a green deploy that serves 500s.
RUN test -d /repo/apps/web/.next \
  || (echo "next build did not produce /repo/apps/web/.next" && exit 1)

# -----------------------------------------------------------------------------
# Stage 3: minimal production runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# Drop root for the runtime process. node:22-alpine ships a `node` user
# with uid 1000 that we reuse so Fly can rotate the image without
# re-creating the account.
USER node

# Bring over the hoisted node_modules and the web app sources. The
# `.next` directory produced by the build stage is copied inside the
# apps/web tree so `next start` can find it without any extra config.
COPY --from=build --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=build --chown=node:node /repo/package.json /repo/package.json
COPY --from=build --chown=node:node /repo/tsconfig.base.json /repo/tsconfig.base.json
COPY --from=build --chown=node:node /repo/apps/web /repo/apps/web
COPY --from=build --chown=node:node /repo/packages/auth /repo/packages/auth
COPY --from=build --chown=node:node /repo/packages/db /repo/packages/db
COPY --from=build --chown=node:node /repo/packages/protocol /repo/packages/protocol

# Fly.io health check path: GET /api/healthz (see apps/web/fly.toml).
# internal_port in Fly must match the EXPOSE line below.
EXPOSE 3000

# Entry point: `next start` boots the production Next.js server against
# the pre-built `.next/` directory. Using `npm start --workspace` keeps
# the command identical to local development so operators can reproduce
# the container start without reading the Dockerfile.
CMD ["npm", "start", "--workspace", "@codex-mobile/web"]
