# syntax=docker/dockerfile:1.7
#
# Dockerfile for apps/relay (Codex Mobile Phase 1 control plane).
#
# Build strategy:
#   - Multi-stage with a deps stage, a validation stage, and a runtime
#     stage so the production image carries a fresh workspace install and
#     validated relay sources.
#   - Node 22 Alpine for a small base layer. Production uses `tsx` to
#     execute the relay TypeScript directly because this repo's workspace
#     packages export source files and `.js`-style specifiers that are
#     meant to be resolved by a TS-aware loader.
#   - The repo is an npm workspaces monorepo. The relay depends on
#     `@codex-mobile/{auth,db,protocol}`, so the Docker context MUST be
#     the repo root (configured in `apps/relay/fly.toml`) and we copy
#     every workspace package.json before `npm install` so the install is
#     cacheable.
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

# This repo currently does not check in a root package-lock.json, so a
# clean `npm ci` cannot run inside Fly's remote builder yet. Use
# workspace-aware `npm install` until the lockfile becomes authoritative.
RUN npm install --workspaces --include-workspace-root

# -----------------------------------------------------------------------------
# Stage 2: validate relay sources before producing a runtime image
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

# Typecheck the relay during the image build so broken imports or type
# regressions fail the deploy before Fly boots a machine.
RUN npm run typecheck --workspace @codex-mobile/relay --if-present

# The runtime executes the source entry point through `tsx`, so the
# checked source tree MUST exist in the image.
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
# relay plus shared package sources. `tsx` needs the TypeScript source
# tree at runtime because `@codex-mobile/db` still exports source files.
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

# Entry point: `tsx` matches the repo's TS-first module layout and can
# resolve `.js` import specifiers back to the corresponding source files.
CMD ["./node_modules/.bin/tsx", "apps/relay/src/index.ts"]
