---
phase: 15
plan: 04
subsystem: ci-pipeline
tags:
  - github-actions
  - ci
  - dual-runtime
  - bun
  - node-22
  - compile-binaries
  - latency-baseline
  - dist-05
  - gate-04
requirements:
  - GATE-04
  - DIST-05
dependency_graph:
  requires:
    - 15-01-PLAN (apps/achilles-terminal workspace + tests + scripts/build-binaries.mjs)
    - 15-02-PLAN (5 platform-binary sibling packages)
    - 15-03-PLAN (bin shim + dist/main.js JS-fallback bundle)
  provides:
    - "Dual-runtime cross-OS CI workflow at .github/workflows/achilles-terminal-ci.yml"
    - "compile-binaries job with gating --version smoke against all 5 native binaries"
    - "Operator-runnable hyperfine cold-start latency capture procedure at 15-04-LATENCY-CAPTURE.md"
  affects:
    - "Every future PR touching apps/achilles-terminal/**, apps/cli-*/**, .github/workflows/achilles-terminal-ci.yml, package.json, or package-lock.json"
tech_stack:
  added:
    - "GitHub Actions workflow: actions/checkout@v4, actions/setup-node@v4 (node-version 22), oven-sh/setup-bun@v2 (bun-version 1.3.14)"
  patterns:
    - "Dual-runtime CI matrix (Bun + Node) per RESEARCH.md Pattern 5 / STACK.md HIGH-confidence pick"
    - "Native-OS compile-binaries matrix with --version smoke gate per CONTEXT.md item 7 (silent-launch defence)"
    - "permissions: contents: read (minimum privilege) and concurrency cancel-in-progress per PATTERNS.md fly-deploy.yml analog"
    - "npm ci --include=optional --force per D-15-02 (npm 10.9.3 EBADPLATFORM workaround on workspace optionalDependencies)"
key_files:
  created:
    - ".github/workflows/achilles-terminal-ci.yml"
    - ".planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md"
  modified: []
key_decisions:
  - "CI workflow uses 'npm ci --include=optional --force' (NOT plain 'npm ci') so the workspace optionalDependencies (the 5 platform-binary siblings) skip cleanly on hosts whose os/cpu does not match (D-15-02)."
  - "Compile-binaries smoke step uses 'shell: bash' across all 5 runners (Git Bash on Windows) so a single grep -E semver check works portably; avoids forking the script into bash + pwsh variants."
  - "Cold-start latency capture is an operator-managed procedure document (15-04-LATENCY-CAPTURE.md) rather than an auto-runnable script. Per CLAUDE.md global rule (no auto-run applications) and per CONTEXT.md item 8 (persistent ~/.achilles/latency/ JSON arrives Phase 18)."
  - "compile-binaries matrix is 5 entries (not 6); macos-13 covers darwin-x64 because GitHub no longer offers a current-macOS x64 runner."
metrics:
  duration_minutes: 3
  completed_date: 2026-06-08
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  commits: 2
---

# Phase 15 Plan 04: Dual-runtime CI workflow + cold-start latency capture procedure Summary

**One-liner:** Wired the GATE-04 dual-runtime CI matrix (Bun 1.3.14 + Node 22 across ubuntu/macOS/windows) and compile-binaries smoke gate (5 native-OS runners with --version gating) at `.github/workflows/achilles-terminal-ci.yml`, plus documented the DIST-05 operator-runnable hyperfine cold-start latency capture procedure at `15-04-LATENCY-CAPTURE.md`.

## What was built

### Task 1: `.github/workflows/achilles-terminal-ci.yml` (194 lines)

Single GitHub Actions workflow with two jobs:

**Job `test` — dual-runtime cross-OS matrix (6 entries):**

| os             | runtime | Steps                                                                         |
| -------------- | ------- | ----------------------------------------------------------------------------- |
| ubuntu-latest  | bun     | checkout → setup-node@22 → setup-bun@1.3.14 → npm ci → typecheck → lint → `bunx vitest run --pool=forks` |
| ubuntu-latest  | node    | checkout → setup-node@22 → npm ci → typecheck → lint → `npm test -- --pool=forks` |
| macos-latest   | bun     | (same shape as ubuntu/bun)                                                    |
| macos-latest   | node    | (same shape as ubuntu/node)                                                   |
| windows-latest | bun     | (same shape)                                                                  |
| windows-latest | node    | (same shape)                                                                  |

- `fail-fast: false` so a single matrix failure does not cancel the rest.
- `--pool=forks` mandatory under both runtimes per Phase 15 Pitfall 9.
- Install step uses `npm ci --include=optional --force` (D-15-02 workaround) with inline comment documenting rationale.

**Job `compile-binaries` — 5 native-OS runners:**

| target name   | runner            | bunTarget         | outfile                                  |
| ------------- | ----------------- | ----------------- | ---------------------------------------- |
| darwin-arm64  | macos-latest      | bun-darwin-arm64  | `cli-darwin-arm64/bin/achilles`          |
| darwin-x64    | macos-13          | bun-darwin-x64    | `cli-darwin-x64/bin/achilles`            |
| linux-x64     | ubuntu-latest     | bun-linux-x64     | `cli-linux-x64/bin/achilles`             |
| linux-arm64   | ubuntu-22.04-arm  | bun-linux-arm64   | `cli-linux-arm64/bin/achilles`           |
| win32-x64     | windows-latest    | bun-windows-x64   | `cli-win32-x64/bin/achilles.exe`         |

Steps per target: checkout → setup-bun@1.3.14 → setup-node@22 → `npm ci --include=optional --force` → `bun build src/cli.ts --compile --target=... --outfile=... --minify` (working-directory `apps/achilles-terminal`) → smoke `--version` step (shell: bash, set -euo pipefail, file-exists check, capture stdout, `grep -E '^[0-9]+\.[0-9]+\.[0-9]+'`).

The smoke step is the third layer of the v1.2 silent-launch defence (alongside Plan 01's fatal handlers in `src/cli.ts` and Plan 03's `stdio:"inherit"` shim). A binary that exits 0 with empty stdout fails the grep check and breaks the build.

**Top-level workflow shape:**
- `name: achilles-terminal CI`
- `on.pull_request.paths` scoped to `apps/achilles-terminal/**`, `apps/cli-*/**`, `.github/workflows/achilles-terminal-ci.yml`, `package.json`, `package-lock.json`.
- `on.push.branches: [main]` with the same paths filter.
- `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`.
- `permissions: { contents: read }` (minimum privilege per PATTERNS.md fly-deploy.yml analog).

### Task 2: `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` (207 lines)

Operator-runnable procedure document for DIST-05 baseline measurement. Contents:

1. DIST-05 targets table (native < 50ms P50, JS-fallback < 200ms P50).
2. Hyperfine install instructions per OS (brew, cargo + apt + .deb, winget, scoop).
3. Build prereqs (`npm run build` + `npm run build:binaries` on the operator's host).
4. Per-platform capture commands with cold (sudo purge / sudo drop_caches) and warm-steady variants. Windows is warm-only per Pitfall 6 (no reliable user-space page-cache clear).
5. JS-fallback bundle capture command (`node ./apps/achilles-terminal/dist/main.js --version`).
6. Hyperfine `--export-json` snippet with a Node one-liner to compute exact P50/P95 percentiles from the `times` array.
7. Operator capture table template (6 rows: 5 native + 1 JS-fallback) with columns for Platform, Path, P50, P95, Host details, Cache state. Filled rows get pasted into the Phase 15 SUMMARY.md under `## Cold-Start Latency Baseline (DIST-05)`.
8. Resume signal: operator types `approved` (or describes the partial-capture gap) once the table is filled.

Per CLAUDE.md global rule, the document does not auto-run anything. The orchestrator surfaces the checkpoint:human-verify gate and the operator runs the captures manually.

## Tasks Completed

| #   | Task                                                      | Commit     | Files                                                                                              |
| --- | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 1   | Write `.github/workflows/achilles-terminal-ci.yml`        | `e9c97f92` | `.github/workflows/achilles-terminal-ci.yml`                                                       |
| 2   | Write `15-04-LATENCY-CAPTURE.md` procedure doc            | `2d1c57bf` | `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md`               |

## Verification

**Task 1 automated check (from PLAN):**
```
node -e "/* required-token grep */"
# Result: CI workflow validated (23 required tokens present).
```

**Task 1 YAML syntax validation:**
```
python3 -c "import yaml; d = yaml.safe_load(open('.github/workflows/achilles-terminal-ci.yml')); ..."
# Result: YAML valid. Jobs: ['test', 'compile-binaries']
```

**Task 1 sanity checks:**
- `grep -c 'stdio.*ignore' .github/workflows/achilles-terminal-ci.yml` → 0 (no step uses stdio:ignore).
- ASCII-only (no emojis, no non-ASCII glyphs).
- `.github/workflows/fly-deploy.yml` is untouched (verified via `ls .github/workflows/`).

**Task 2 content checks:**
- File exists at the expected path.
- Contains required tokens: `hyperfine --warmup 0 --runs 50`, `brew install hyperfine`, `winget install sharkdp.hyperfine`, `P50`, `P95`, `DIST-05`.
- Operator capture table template present with 6 rows.
- Only non-ASCII characters are U+2014 em-dashes (standard typography); no emojis.

**The empirical proof of GATE-04 dual-runtime half is the next push to the branch:** GitHub Actions triggers the 6-entry test matrix and the 5-entry compile-binaries matrix. The planner cannot pre-validate cloud-runner behavior locally; that is by design.

## Deviations from Plan

None. Plan 04 was executed exactly as written. The CI workflow honors the prior-wave deviations:

- **D-15-01:** Workflow targets `apps/achilles-terminal` (the post-Wave-1 directory name).
- **D-15-02:** Install steps use `npm ci --include=optional --force` with an inline comment explaining the npm 10.9.3 EBADPLATFORM workaround. A future reader cannot strip the flags without breaking every matrix entry.
- **D-15-03:** Captured (D-15-02 surfacing was honored above).
- **D-15-04:** Irrelevant to Plan 04 (esbuild banner shebang concern).

## Threat Model Mitigations Confirmed

| Threat ID                             | Mitigation Status | Evidence                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-15-supply-chain                     | Implemented       | All actions pinned: `actions/checkout@v4`, `actions/setup-node@v4` (node-version "22"), `oven-sh/setup-bun@v2` (bun-version "1.3.14"). `npm ci` (not `npm install`) is used so the committed lockfile is the authoritative install source. |
| T-15-silent-launch                    | Implemented       | Every compile-binaries entry runs `--version` and asserts `grep -E '^[0-9]+\.[0-9]+\.[0-9]+'` against stdout. A silent-launch regression (exit 0 + empty stdout) fails the grep step.                                                  |
| T-15-cross-platform-binary-mismatch   | Implemented       | Matrix pairs native-OS runners with their matching bun target string; the smoke step verifies the binary actually runs on its target architecture by executing it on the matching native runner.                                       |

## LOOP-02 Invariant Confirmed

- Zero references to `packages/voice-*`, `packages/claude-code-bridge`, or `packages/achilles-skill/skill/prompts/companion.md` in the workflow file or the latency procedure.
- Verified: `grep -E 'voice-|claude-code-bridge|companion.md' .github/workflows/achilles-terminal-ci.yml .planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` returns no matches.

## Known Stubs

None. Plan 04 deliverables are config + documentation; no application code with mockable data flow was changed.

## Operator Action Required (Plan 04 checkpoint)

Task 2 is a `checkpoint:human-verify` gate. The procedure document is now in place; the orchestrator surfaces the gate for the operator to:

1. Install hyperfine on whichever native hosts are available.
2. Build the binaries (`npm run build:binaries`) and the JS-fallback (`npm run build`).
3. Run the documented capture commands and fill the table in 15-04-LATENCY-CAPTURE.md.
4. Paste the filled table into the Phase 15 SUMMARY.md under `## Cold-Start Latency Baseline (DIST-05)` once that SUMMARY exists.
5. Type `approved` to the orchestrator to close the gate (or describe partial-capture gap).

The executor does NOT run hyperfine — per CLAUDE.md global rule, applications are not auto-run.

## Self-Check: PASSED

- `.github/workflows/achilles-terminal-ci.yml` exists (FOUND).
- `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` exists (FOUND).
- Commit `e9c97f92` exists in git log (FOUND).
- Commit `2d1c57bf` exists in git log (FOUND).
- `.github/workflows/fly-deploy.yml` unchanged (FOUND, untouched).
