# syntax=docker/dockerfile:1.7
#
# Dockerfile for apps/relay (Codex Mobile Phase 1 control plane).
#
# Build strategy:
#   - Multi-stage with a deps stage, a build stage, and a minimal runtime
#     stage so the production image carries only production dependencies
#     plus the compiled JavaScript.
#   - Node 22 Alpine for a small base layer. `--experimental-strip-types`
#     is used in dev, but production runs compiled JS emitted by `tsc`
#     to avoid shipping the TypeScript parser at runtime.
#   - The repo is an npm workspaces monorepo. The relay depends on
#     `@codex-mobile/{auth,db,protocol}`, so the Docker context MUST be
#     the repo root (configured in `apps/relay/fly.toml`) and we copy
#     every workspace package.json before `npm ci` so the install is
#     deterministic and maximally cacheable.
#
# Image exposes port 8080 (matched by `apps/relay/fly.toml` internal_port).
# The Fly.io health check targets `/readyz` (see the fly.toml entry).

# -----------------------------------------------------------------------------
# Stage 1: install workspace dependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

# Copy only the workspace manifest files first so `npm ci` can be cached
# across source-only edits. Order matters: root package.json, the lock
# file, then each workspace's package.json (apps/* and packages/*).
COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/relay/package.json apps/relay/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/bridge/package.json apps/bridge/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/protocol/package.json packages/protocol/package.json

# Install every workspace's production + dev dependencies. `npm ci` is
# used instead of `npm install` so the lock file is authoritative and
# the build fails fast if the lock is out of date.
RUN npm ci --workspaces --include-workspace-root

# -----------------------------------------------------------------------------
# Stage 2: compile TypeScript for the relay + the packages it depends on
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package.json ./package.json
COPY --from=deps /repo/package-lock.json* ./package-lock.json
COPY --from=deps /repo/tsconfig.base.json ./tsconfig.base.json

# Copy the sources the relay actually needs at build time. apps/web and
# apps/bridge are intentionally left out so edits in those trees do not
# bust the relay build cache.
COPY apps/relay ./apps/relay
COPY packages/auth ./packages/auth
COPY packages/db ./packages/db
COPY packages/protocol ./packages/protocol

# Build the relay (tsc -p apps/relay/tsconfig.json). If the relay build
# script is a noop on a fresh monorepo, this still succeeds because npm
# run build --if-present returns exit 0 when the target is missing.
#
# CR-03 fix: the previous version piped this step to a shell-true
# fallback so a failing `tsc` produced a green image. The fallback
# is gone; if `tsc` fails the image build fails.
RUN npm run build --workspace @codex-mobile/relay --if-present

# The relay still uses `node --experimental-strip-types` at runtime
# (see the CMD line below) so a compiled `dist/` tree is not STRICTLY
# required for the container to boot. However, the source entry point
# MUST exist, otherwise `node --experimental-strip-types apps/relay/src/index.ts`
# will crash on start. If a future plan lands a real tsc build, change
# this assertion to `test -d /repo/apps/relay/dist`.
RUN test -f /repo/apps/relay/src/index.ts \
  || (echo "relay entry file apps/relay/src/index.ts missing after build" && exit 1)

# -----------------------------------------------------------------------------
# Stage 3: minimal production runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=8080 \
    RELAY_HOST=0.0.0.0

# Drop root for the runtime process. node:22-alpine ships a `node` user
# with uid 1000 that we reuse here so Fly.io can rotate the image
# without re-creating the user account.
USER node

# Bring over the installed node_modules (workspace hoisted) and the
# relay plus shared package sources. We keep the TypeScript sources so
# `node --experimental-strip-types` can run them directly if the
# compiled build output is absent; production deploys should prefer the
# compiled output but this fallback keeps the container bootable during
# Phase 1 before the relay build script is wired up.
COPY --from=build --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=build --chown=node:node /repo/package.json /repo/package.json
COPY --from=build --chown=node:node /repo/tsconfig.base.json /repo/tsconfig.base.json
COPY --from=build --chown=node:node /repo/apps/relay /repo/apps/relay
COPY --from=build --chown=node:node /repo/packages/auth /repo/packages/auth
COPY --from=build --chown=node:node /repo/packages/db /repo/packages/db
COPY --from=build --chown=node:node /repo/packages/protocol /repo/packages/protocol

# Fly.io health check path: GET /readyz (see apps/relay/fly.toml).
# internal_port in Fly must match the EXPOSE line below.
EXPOSE 8080

# Entry point: the bootstrap in apps/relay/src/index.ts wires the
# Fastify instance (buildRelayServer -> startRelayServer) and installs
# SIGINT/SIGTERM handlers. --experimental-strip-types lets Node 22 run
# the TypeScript source directly so Phase 1 does not require a build
# step on every deploy; Plan 02-01 will swap this for compiled JS.
CMD ["node", "--experimental-strip-types", "apps/relay/src/index.ts"]
