---
phase: 06-npm-distribution-local-bootstrap
plan: 01
subsystem: infra
tags: [npm, packaging, typescript, cli, handoff]
requires:
  - phase: 05-multi-instance-routing-production-hardening
    provides: bridge, web, relay, and support-package baselines to package
provides:
  - publishable `handoff` npm workspace metadata
  - package-local TypeScript configs for bridge, web, auth, and db
  - dist-based support-package exports
  - local tarball smoke validation for the install surface
affects: [06-02, 06-03, npm-install, docs]
tech-stack:
  added: []
  patterns:
    - publishable workspaces emit dist-first package entrypoints
    - tarball validation runs locally against `npm pack --workspace handoff`
key-files:
  created:
    - apps/bridge/README.md
    - apps/bridge/tsconfig.json
    - apps/web/tsconfig.json
    - packages/auth/tsconfig.json
    - packages/db/tsconfig.json
    - scripts/validate-handoff-pack.mjs
  modified:
    - apps/bridge/package.json
    - apps/bridge/src/cli.ts
    - packages/auth/package.json
    - packages/protocol/package.json
    - package.json
    - README.md
key-decisions:
  - "The bridge package now owns the public `handoff` name directly instead of hiding behind an internal workspace alias."
  - "CLI subcommands are lazy-imported so the packed `dist/cli.js --help` path works without eagerly loading runtime-only dependencies."
  - "Tarball validation runs against a local extracted pack instead of relying on registry publish or global installs."
patterns-established:
  - "Packaging pattern: support packages export dist artifacts, while the CLI package ships only dist plus a package-local README."
  - "Verification pattern: any public install surface change gets a local `npm pack` smoke script."
requirements-completed: [DIST-01, DIST-02]
completed: 2026-04-19
---

# Phase 06-01 Summary

**The bridge workspace is now a real `handoff` install surface with package-local TypeScript configs, dist-based support-package exports, and a tarball smoke path that validates the published CLI entrypoint locally.**

## Accomplishments

- Renamed the bridge workspace to `handoff`, made it publishable, added a package-local README, and corrected the CLI package entrypoint to `dist/cli.js`.
- Added missing `tsconfig.json` files for `apps/bridge`, `apps/web`, `packages/auth`, and `packages/db`, which turned the previously broken workspace scripts into real typecheck/build targets.
- Switched `@codex-mobile/auth` and `@codex-mobile/protocol` to publishable dist exports and added `validate:handoff-pack` to guard the npm tarball contract.

## Verification

- `npm run typecheck --workspace @codex-mobile/web`
- `npm run typecheck --workspace handoff`
- `npm run build --workspace @codex-mobile/protocol`
- `npm run build --workspace @codex-mobile/auth`
- `npm run build --workspace handoff`
- `npm run validate:handoff-pack`

## Deviations from Plan

### Auto-fixed Integration Gaps

1. Added lazy CLI imports and corrected the bridge package `main` entry because the original manifest still pointed at a non-existent `dist/index.js`, which would have made the packed install surface lie about its executable target.
2. Fixed latent bridge/web typecheck failures that surfaced once the new workspace-level `tsconfig.json` files started exercising real code paths instead of failing immediately on missing configs.

---
*Phase: 06-npm-distribution-local-bootstrap*
*Completed: 2026-04-19*
