---
phase: 15
recorded: 2026-06-08
recorded_by: orchestrator (post-Wave-1)
---

# Phase 15 — Deviations from PLAN.md

## D-15-01: apps/achilles-terminal package.json `name` field

**Plan said:** `name: "achilles"` (Plan 15-01 line 142, RESEARCH.md §Pattern 2).
**Reality:** Renamed to `name: "achilles-terminal"` after Wave 1 merge.

**Why deviated:** `apps/achilles-cli/package.json` (v1.2, still on disk and in `apps/*` workspace glob) also declares `name: "achilles"`. npm 10.9.3 refuses every install operation at the repo root with `EDUPLICATEWORKSPACE`. The plan explicitly forbids modifying root `package.json` and out-of-scope-marks any change to apps/achilles-cli (Phase 19 publish-then-cut owns retirement).

**Resolution:** Rename `apps/achilles-terminal` to `achilles-terminal` for the duration of v1.3 dev. **Phase 19 MUST rename this back to `achilles` immediately after `apps/achilles-cli` is deleted** (publish-then-cut sequence). The `bin: { achilles: "./dist/cli.js" }` field stays unchanged — bin name is what users type, not the npm package name.

**Verified:** `npm install --include=optional --force` completes; `npm test --workspace apps/achilles-terminal` passes all 5 INIT-07 assertions; `node_modules/achilles-terminal/` symlink exists.

---

## D-15-02: npm install requires --include=optional --force

**Plan said:** Plain `npm install` / `npm ci` at root works (Plan 15-01 line 169, Plan 15-04 CI matrix uses `npm ci`).

**Reality:** npm 10.9.3 strictly enforces `os` + `cpu` constraints on workspace packages (not only on registry-fetched optionalDependencies). On a darwin-arm64 host, plain `npm install` fails with `EBADPLATFORM` for `@achilles/cli-darwin-x64` (and similarly for linux-*, win32-* siblings) even though they are listed under `optionalDependencies`. The error occurs because npm treats workspace packages as primary deps regardless of where they appear.

**Workaround:** Use `npm install --include=optional --force` (or `npm ci --include=optional --force`). Verified working on darwin-arm64.

**Plan 04 impact:** The CI workflow `.github/workflows/achilles-terminal-ci.yml` (Plan 15-04) MUST use `npm ci --include=optional --force` instead of `npm ci`. Otherwise every matrix entry will fail at install time.

**Long-term resolution (Phase 19 concern):** Once siblings are published to the npm registry and pulled via real `optionalDependencies` (not workspace symlinks), the standard npm behavior applies — `--include=optional` is automatic for `npm install` (default) and explicit for `npm ci`. The `--force` may still be needed if any sibling fails to install; npm should skip them silently.

---

## D-15-03 (TODO for Plan 04 author)

When Plan 15-04 is executed, the CI workflow YAML must use `npm ci --include=optional --force` per D-15-02. Surface this to the executor in the prompt.
