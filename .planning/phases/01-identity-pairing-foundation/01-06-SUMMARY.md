---
phase: 01-identity-pairing-foundation
plan: 06
subsystem: deploy-safety
tags: [fly-io, github-actions, dockerfile, readme, security, gap-closure]
gap_closure: true
closes:
  - CR-02  # GitHub Actions script injection via secret interpolation
  - CR-03  # Dockerfile `|| true` masking build failures
  - WR-04  # Missing workflow permissions block
requirements: [OPS-01, SEC-01]
dependency-graph:
  requires:
    - 01-03  # Adds fly-deploy.yml + Dockerfiles + README Fly.io section that this plan hardens
  provides:
    - "Hardened Fly deploy workflow: env-indirected secrets, minimum-privilege GITHUB_TOKEN"
    - "Docker image builds that fail loudly when next/tsc breaks"
    - "Operator-visible warning about Phase 1 single-machine pairing store constraint"
  affects:
    - ".github/workflows/fly-deploy.yml"
    - "apps/web/Dockerfile"
    - "apps/relay/Dockerfile"
    - "README.md"
tech-stack:
  added: []
  patterns:
    - "GitHub Actions: secrets cross into run: scripts only through step-level env: blocks"
    - "GitHub Actions: top-level permissions block defaults to read-only"
    - "Docker: post-build existence assertions catch silent --if-present skips"
key-files:
  created: []
  modified:
    - path: ".github/workflows/fly-deploy.yml"
      purpose: "Move every ${{ secrets.X }} expression out of run: shell commands into env: blocks; add top-level permissions: contents: read"
    - path: "apps/web/Dockerfile"
      purpose: "Drop shell-true fallback on npm run build; assert .next/ exists at end of build stage"
    - path: "apps/relay/Dockerfile"
      purpose: "Drop shell-true fallback on npm run build; assert apps/relay/src/index.ts exists at end of build stage"
    - path: "README.md"
      purpose: "Add IMPORTANT callout about Phase 1 single-machine pairing store constraint before Prerequisites section"
decisions:
  - "Use step-level env: block indirection (not job-level env:) so only the secrets-push steps see the secrets. Keeps blast radius minimal."
  - "Relay assertion uses test -f apps/relay/src/index.ts, not test -d apps/relay/dist, because Phase 1 runtime is node --experimental-strip-types on TS sources. A comment in the Dockerfile documents the intended swap to dist/ once a tsc build lands."
  - "README constraint is documentation-only. The code-level guard (crash-on-boot in production or the Drizzle-backed store) is explicitly deferred — this plan only closes the operator-awareness gap."
  - "Plan 01-04 runs in parallel and edits apps/web/**. No overlap with this plan's scope (workflow/Dockerfile/README only)."
metrics:
  tasks-completed: 3
  tasks-total: 3
  files-modified: 4
  lines-added: 84
  lines-removed: 14
  commits: 3
  duration-minutes: 7
  completed-date: 2026-04-10
---

# Phase 1 Plan 06: Deploy-Safety Gap Closure Summary

One-liner: Closed three deploy-safety gaps from the phase code review — GitHub Actions secret injection via env-block indirection, loud Dockerfile build failures with post-build existence assertions, and an operator-facing README callout pinning apps/web to a single Fly machine while the pairing store is still in-memory.

## What Changed

### 1. Fly deploy workflow hardened (CR-02, WR-04)

`.github/workflows/fly-deploy.yml` previously interpolated every repository secret directly into the `run:` shell command string on both the "Push web app secrets to Fly" and "Push relay secrets to Fly" steps. The GitHub Actions expression engine substitutes `${{ secrets.X }}` into the YAML-rendered shell script BEFORE the shell parses it, which is a textbook script injection vector: a secret containing a double quote, `$`, backtick, newline, or `;` turns into an injection payload.

The fix is a two-part change on each of the two secrets-push steps:

- A step-level `env:` block now maps every secret the step needs into a runner environment variable (`FLY_API_TOKEN`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SESSION_COOKIE_SECRET`, `PAIRING_TOKEN_SECRET`, `WS_TICKET_SECRET`, `DATABASE_URL` for the web step; the relay step maps the subset it actually uses).
- The `run:` script now references those values as ordinary shell variables (`$AUTH_GITHUB_ID`, `$DATABASE_URL`, etc.) so the expression engine only ever writes to the runner env, never into the rendered shell script.

Additionally, a top-level `permissions: contents: read` block was added between `concurrency:` and `jobs:` so the workflow's `GITHUB_TOKEN` inherits minimum privilege instead of the repo default. The workflow only needs to check out the repo and call `flyctl` via an externally-scoped `FLY_API_TOKEN`; it does not write to the repo, push images, or post comments. This closes WR-04 from 01-REVIEW.md.

Verification (grep-based):

```
85:permissions:
88:jobs:
```
`permissions:` is on line 85, immediately before `jobs:` on line 88. Grep for `${{ secrets.X }}` on a line that also contains a shell token (`flyctl`, `echo`, `export `, `set`) returns zero matches — every `${{ secrets.X }}` expression in the file is inside a step-level `env:` block.

The "Deploy apps/web" and "Deploy apps/relay" steps were intentionally left untouched: they already used an `env:` block for `FLY_API_TOKEN` and their `run:` scripts only contain static `flyctl deploy` command lines with no secret interpolation.

### 2. Dockerfile build failures unmasked (CR-03)

Both `apps/web/Dockerfile` and `apps/relay/Dockerfile` previously wrapped the `npm run build --workspace @codex-mobile/{web,relay} --if-present` step in a shell-true fallback, so a failing `next build` or `tsc` still produced a runtime image. For `apps/web` in particular this was severe: the runtime stage runs `npm start --workspace @codex-mobile/web` (i.e. `next start`) against a `.next/` directory that would not exist if the build had silently failed — the container would pass `docker build`, pass Fly deploy, pass the `/api/healthz` check, and then crash on the first real request.

The fix on each Dockerfile is:

- Drop the shell-true fallback on the `npm run build` line. `--if-present` still returns 0 when the script is genuinely absent but preserves the real exit code when the script runs and fails, which is the only correct behavior for a production build step.
- Add a post-build existence assertion that fails the image with an explicit error message if the runtime-critical artifact is missing.

For the web image the assertion is `test -d /repo/apps/web/.next`. This is the exact directory `next start` will read from at container boot. For the relay image the assertion is `test -f /repo/apps/relay/src/index.ts`, because the Phase 1 relay runtime still uses `node --experimental-strip-types apps/relay/src/index.ts` (no compiled `dist/` yet), so the source entry point is the runtime-critical file. A comment in the relay Dockerfile documents the intended future swap to `test -d /repo/apps/relay/dist` once a tsc build lands (IN-06 / Plan 02-01).

Neither Dockerfile's deps stage, COPY instructions, USER directive, EXPOSE line, or CMD line was modified. `apps/web/Dockerfile` still ends with `CMD ["npm", "start", "--workspace", "@codex-mobile/web"]` and `EXPOSE 3000`. `apps/relay/Dockerfile` still ends with `CMD ["node", "--experimental-strip-types", "apps/relay/src/index.ts"]` and `EXPOSE 8080`. The deps stage in each file still opens with `FROM node:22-alpine AS deps`.

### 3. README single-machine pairing constraint (WR-08 documentation half)

`apps/web/lib/pairing-service.ts` ships with an `InMemoryPairingStore` for the `pairing_sessions` state machine. A pairing created on machine A is not visible to machine B because the store is a process-local `Map`. `apps/web/fly.toml` currently sets `auto_start_machines = true` and `min_machines_running = 0`, which means Fly is free to scale to zero and then cold-start a fresh machine under load — at which point a freshly-created pairing would vanish on the very next `redeem` request routed to a different machine.

A full code-level fix (either crash-on-boot in production when `NODE_ENV === "production"` and the in-memory store is selected, or landing the Drizzle-backed adapter that Plan 01-03 promised) is explicitly deferred to a later phase. This plan closes only the operator-awareness gap: without the README warning, an operator reading the Fly.io Deployment section has no way to know that the scale-to-zero behavior of `apps/web/fly.toml` is actively unsafe for Phase 1.

The new section `### IMPORTANT: Single-machine pairing store constraint (Phase 1)` was inserted between the existing "Both services are built with multi-stage `node:22-alpine` Dockerfiles..." paragraph and the `### Prerequisites` subsection inside the `## Fly.io Deployment` section. It includes:

- What the constraint is (in-memory pairing store, file path, process-local Map).
- Required Fly configuration to honor it (`min_machines_running = 1` under `[http_service]` in `apps/web/fly.toml`; relay already correct at `min_machines_running = 1` + `auto_start_machines = false`).
- The exact symptom an operator will see if they violate it (`pairing_not_found` on redeem, "pairing disappeared" errors).
- A cross-reference to the per-machine in-memory rate limiter at `apps/web/lib/rate-limit.ts`, which has the same constraint and the same Redis-backed follow-up.

The "Just Handoff" product marketing sections (The Problem, The Solution, Features, How It Works, Tech Stack, Status & Roadmap — lines 1-121 in the current README) are preserved byte-for-byte; the change is a pure 14-line insertion at line 261.

## Tasks Completed

| # | Task                                              | Commit  | Files                                  |
| - | ------------------------------------------------- | ------- | -------------------------------------- |
| 1 | CR-02 + WR-04: env-block secrets + permissions    | 8d50f04 | .github/workflows/fly-deploy.yml       |
| 2 | CR-03: drop shell-true, add build-time assertions | 8466262 | apps/web/Dockerfile, apps/relay/Dockerfile |
| 3 | README callout on single-machine pairing store    | db42df0 | README.md                              |

## Verification Checklist

- [x] `.github/workflows/fly-deploy.yml` contains a top-level `permissions: contents: read` block at line 85 (before `jobs:` at line 88).
- [x] Both "Push web app secrets to Fly" and "Push relay secrets to Fly" steps have step-level `env:` blocks mapping every secret they need into runner env vars.
- [x] No line in `fly-deploy.yml` contains both `${{ secrets.X }}` AND a shell token (`flyctl`, `echo`, `export `, `set`). Every `${{ secrets.X }}` occurrence is inside an `env:` block.
- [x] "Deploy apps/web" and "Deploy apps/relay" steps are unchanged (each still has `FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}` in its own env block, plus a static `flyctl deploy` command).
- [x] `apps/web/Dockerfile` contains zero occurrences of the literal string `|| true`.
- [x] `apps/relay/Dockerfile` contains zero occurrences of the literal string `|| true`.
- [x] `apps/web/Dockerfile` contains `RUN test -d /repo/apps/web/.next` immediately after the build RUN.
- [x] `apps/relay/Dockerfile` contains `RUN test -f /repo/apps/relay/src/index.ts` immediately after the build RUN.
- [x] `apps/web/Dockerfile` still ends with `CMD ["npm", "start", "--workspace", "@codex-mobile/web"]` and `EXPOSE 3000`.
- [x] `apps/relay/Dockerfile` still ends with `CMD ["node", "--experimental-strip-types", "apps/relay/src/index.ts"]` and `EXPOSE 8080`.
- [x] Both Dockerfiles still open their deps stage with `FROM node:22-alpine AS deps`.
- [x] `README.md` contains the exact heading `### IMPORTANT: Single-machine pairing store constraint (Phase 1)`.
- [x] `README.md` contains the strings `in-memory pairing store`, `min_machines_running = 1`, and `pairing_not_found`.
- [x] `README.md` line 1-259 and line 275+ are byte-for-byte unchanged from the base commit (verified with `git diff --stat`: +14 / -0).
- [x] No file under `resources/` was modified.
- [x] No application code under `apps/web/lib/`, `apps/web/app/`, `apps/bridge/src/`, or `apps/relay/src/` was touched.
- [x] No `npm install`, `next build`, `docker build`, or `fly deploy` was run. All verification is grep-based or diff-based, per the user's "never run applications automatically" rule.

## Deviations from Plan

Minor deviation from the plan's exact text in Task 2:

The plan's example comment text for both Dockerfiles contained the literal string `|| true` (describing what the fix removed). Leaving that verbatim would have made the plan's own verification command (`! grep -n "|| true" apps/web/Dockerfile`) incorrectly fire on the comment. I rewrote both comments to describe the removed construct as "a shell-true fallback" instead of embedding the literal string, so the grep-for-zero-occurrences assertion passes cleanly. The behavioral change is unchanged; only the comment wording was adjusted. Tracked here for transparency — no user permission required because this is a trivial documentation tweak to honor the plan's own verification rule (Rule 3: unblock the task).

No other deviations. Every other instruction in 01-06-PLAN.md was followed verbatim.

## Deferred Issues

All items already listed in the plan's `<deferred>` block remain deferred:

- WR-07 production image still ships devDependencies.
- IN-06 relay still runs `node --experimental-strip-types` (Plan 02-01 swap to compiled JS).
- IN-03 raw `uptimeSeconds` in healthz responses.
- WR-08 code-level production gate for `InMemoryPairingStore` (this plan only documents the constraint; the code-level crash-on-boot or the Drizzle adapter itself is deferred to a later phase).

Additional items noted during execution but intentionally not fixed (out of scope for this plan):

- CR-01 middleware blocks `/api/pairings` for bridge CLI — being closed by Plan 01-04 in parallel.
- WR-01, WR-02, WR-03, WR-05, WR-06, WR-09, WR-10, WR-11, IN-01 through IN-09 — tracked in 01-REVIEW.md and 01-VERIFICATION.md; most are in other gap-closure plans.

## Auth Gates Encountered

None. All work was grep/diff-based file editing.

## Self-Check: PASSED

File existence:
- FOUND: .planning/phases/01-identity-pairing-foundation/01-06-SUMMARY.md
- FOUND: .github/workflows/fly-deploy.yml (modified, verified via grep)
- FOUND: apps/web/Dockerfile (modified, verified via grep)
- FOUND: apps/relay/Dockerfile (modified, verified via grep)
- FOUND: README.md (modified, verified via git diff)

Commit existence:
- FOUND: 8d50f04 fix(01-06): harden fly-deploy workflow (CR-02, WR-04)
- FOUND: 8466262 fix(01-06): fail Docker builds loudly on broken next/tsc (CR-03)
- FOUND: db42df0 docs(01-06): document single-machine pairing store constraint
