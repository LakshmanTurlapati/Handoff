---
phase: 15
plan: 02
subsystem: distribution
tags: [scaffold, platform-binaries, optional-dependencies, dist-02]
requires:
  - "Root package.json workspaces glob 'apps/*' (already present)"
provides:
  - "5 platform-binary sibling packages with locked publish shape"
  - "DIST-02 sibling-package half (parent optionalDependencies wire-up = Plan 01)"
  - "Install-time os/cpu filter pairs that npm/bun/pnpm 11.2+ honor"
affects:
  - "apps/achilles-terminal/package.json optionalDependencies (Plan 01) — these are the targets it references"
  - "apps/achilles-terminal/src/shim/cli.shim.js (Plan 01 / Plan 03) — import.meta.resolve targets"
  - "Plan 04 CI build-binaries.mjs — populates bin/ in each sibling on its native-OS runner"
tech-stack:
  added:
    - "@achilles/cli-<plat>-<arch> namespace (5 packages)"
  patterns:
    - "esbuild/swc/biome/turbo optionalDependencies + os/cpu filter pattern"
    - "5-line shared README template directing to parent package"
    - "bin/ as CI artifact (gitignored, never committed)"
key-files:
  created:
    - apps/cli-darwin-arm64/package.json
    - apps/cli-darwin-arm64/README.md
    - apps/cli-darwin-arm64/.gitignore
    - apps/cli-darwin-x64/package.json
    - apps/cli-darwin-x64/README.md
    - apps/cli-darwin-x64/.gitignore
    - apps/cli-linux-x64/package.json
    - apps/cli-linux-x64/README.md
    - apps/cli-linux-x64/.gitignore
    - apps/cli-linux-arm64/package.json
    - apps/cli-linux-arm64/README.md
    - apps/cli-linux-arm64/.gitignore
    - apps/cli-win32-x64/package.json
    - apps/cli-win32-x64/README.md
    - apps/cli-win32-x64/.gitignore
  modified: []
decisions:
  - "Sibling packages have NO bin field (parent owns bin only — RESEARCH.md line 335)"
  - "Sibling packages have NO engines field (binary-only — no JS execution surface)"
  - "Sibling packages have NO dependencies / devDependencies (Bun --compile binaries are self-contained)"
  - "Sibling packages have NO scripts of any kind (Tampering-surface minimization — T-15-supply-chain mitigation)"
  - "5-line README template chosen over copying parent README (RESEARCH.md Open Question #2)"
  - "win32-x64 variant files entry uses 'bin/achilles.exe' (.exe suffix — Pitfall 3)"
metrics:
  duration: "~5 min"
  completed: "2026-06-08T08:00:51Z"
  tasks_completed: 1
  files_created: 15
  files_modified: 0
---

# Phase 15 Plan 02: Platform-Binary Sibling Packages Summary

Scaffolded the five `@achilles/cli-<plat>-<arch>` platform-binary sibling packages under `apps/` with locked publish shape (os/cpu filter pair per Node `process.platform`/`process.arch` enum), 5-line shared-template READMEs directing users to the parent `achilles` package, and `bin/` `.gitignore` so the CI-generated binary directories never get committed.

## What Got Built

Fifteen files across five sibling directories (`apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/`, `apps/cli-linux-x64/`, `apps/cli-linux-arm64/`, `apps/cli-win32-x64/`):

| Directory | `name` | `os` | `cpu` | `files` |
| --- | --- | --- | --- | --- |
| `apps/cli-darwin-arm64/` | `@achilles/cli-darwin-arm64` | `["darwin"]` | `["arm64"]` | `["bin/achilles"]` |
| `apps/cli-darwin-x64/` | `@achilles/cli-darwin-x64` | `["darwin"]` | `["x64"]` | `["bin/achilles"]` |
| `apps/cli-linux-x64/` | `@achilles/cli-linux-x64` | `["linux"]` | `["x64"]` | `["bin/achilles"]` |
| `apps/cli-linux-arm64/` | `@achilles/cli-linux-arm64` | `["linux"]` | `["arm64"]` | `["bin/achilles"]` |
| `apps/cli-win32-x64/` | `@achilles/cli-win32-x64` | `["win32"]` | `["x64"]` | `["bin/achilles.exe"]` |

Each sibling has three files:
- **`package.json`** — 8-field block per RESEARCH.md §Pattern 2 (lines 315-326): `name`, `version`, `description`, `license`, `os`, `cpu`, `files`, `publishConfig`. No `bin`. No `engines`. No `dependencies`/`devDependencies`. No `scripts`. Tampering-surface minimization (T-15-supply-chain mitigation).
- **`README.md`** — 5-line shared template (`# @achilles/cli-<plat>-<arch>` + parent-install instruction). No emojis (CLAUDE.md global rule).
- **`.gitignore`** — single line `bin/` (CI-generated, never committed per RESEARCH.md §Runtime State Inventory).

## DIST-02 Contract Locked

The sibling-package half of DIST-02 is now in place. The other half (parent's `optionalDependencies` block listing all five siblings at `1.3.0`) lives in Plan 01 (`apps/achilles-terminal/package.json`). On `npm install -g achilles`, the resolver evaluates each sibling's `os`/`cpu` filter against the developer's machine — installing only the matching sibling and silently skipping the other four. Plan 03's shim then uses `import.meta.resolve("@achilles/cli-<plat>-<arch>/package.json")` to discover and exec the matching binary; on unsupported-platform installs (where all five siblings get skipped), the shim falls through to the Node 22 esbuild bundle.

## Critical Invariants Held

- **No `bin` field on any sibling** (RESEARCH.md line 335) — only the parent owns `bin` so PATH points to one consistent place (the shim).
- **`os` strings are Node `process.platform` enum** — `"darwin"`, `"linux"`, `"win32"`. Not `"macos"` or `"windows"` (which would silently fail the install-time filter — T-15-platform-filter-bypass).
- **`cpu` strings are Node `process.arch` enum** — `"arm64"`, `"x64"`.
- **Windows variant `files` entry uses `"bin/achilles.exe"` with `.exe` suffix** (Pitfall 3 — single most common cross-platform CLI bug).
- **No sibling references `@achilles/voice-*`, `@achilles/claude-code-bridge`, or `companion.md`** (LOOP-02 invariant; verified via `grep -rE` returning 0 lines).
- **No emojis in any of the 15 files** (CLAUDE.md global rule; verified via Python emoji-range scan returning 0 matches).

## Threat Mitigations Closed

| Threat ID | Disposition | How Plan 02 closes it |
| --- | --- | --- |
| T-15-supply-chain | mitigate | Five sibling packages have zero dependencies, zero devDependencies, zero scripts, zero postinstall. Each tarball contains exactly one binary + the package.json + a 5-line README. Minimizes the tampering surface before Phase 19's publish-time tarball secret scan + per-binary `--version` smoke. |
| T-15-platform-filter-bypass | mitigate | The os/cpu enum was verified character-for-character against Node's `process.platform` / `process.arch` strings (automated check in the plan's `<verify>` block: `JSON.stringify(pkg.os) !== JSON.stringify([os])` aborts on mismatch). A wrong value (e.g., `"macos"` instead of `"darwin"`) would silently install the wrong binary on the wrong machine — caught at this stage. |

## Verification Results

```
$ node -e "...validate-all-5-siblings..."
All 5 sibling packages validated.

$ grep -rE "voice-protocol|voice-stt|voice-tts|claude-code-bridge|companion.md" apps/cli-*/
(no output — 0 lines — LOOP-02 boundary holds)

$ python3 emoji-scan (5 dirs × 3 files)
No emojis found in any of the 15 sibling files.
```

Acceptance criteria from the plan:
- [x] 5 directories exist with the correct names
- [x] Each directory has package.json + README.md + .gitignore (15 files total)
- [x] Each package.json has exactly the 8 expected fields and NO bin field
- [x] os field uses Node process.platform enum
- [x] cpu field uses Node process.arch enum
- [x] win32-x64 files entry is `["bin/achilles.exe"]` with .exe suffix
- [x] Each .gitignore is exactly `bin/` (single line)
- [x] Each README.md follows the 5-line shared template + `npm install -g achilles`
- [x] grep for voice-* / bridge / companion returns 0 lines (LOOP-02)
- [x] No emoji characters in any file
- [ ] `npm install` smoke at repo root — DEFERRED to Plan 01 wave completion (parent's `optionalDependencies` doesn't exist yet, so a root `npm install` at this moment would not resolve the new siblings as targets of any reference — this is expected and acceptable; the install smoke is meaningful only once both Plan 01 and Plan 02 have landed, which is the orchestrator's responsibility after the wave merges)

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<verify>` automated check passed on the first run (`All 5 sibling packages validated.`). The acceptance-criteria `npm install` smoke is gated on Plan 01's parent `optionalDependencies` block, which lives in a sibling worktree this wave; it's logically a post-wave gate rather than a per-plan gate.

## Known Stubs

None. The `bin/` directories are intentionally empty (gitignored CI output, populated by Plan 04's `build-binaries.mjs` on native-OS runners). This is documented in each sibling's `.gitignore` and in the plan's own `<objective>`; it is not a stub but a planned-empty artifact directory.

## Self-Check: PASSED

Files verified on disk:
- FOUND: apps/cli-darwin-arm64/package.json, README.md, .gitignore
- FOUND: apps/cli-darwin-x64/package.json, README.md, .gitignore
- FOUND: apps/cli-linux-x64/package.json, README.md, .gitignore
- FOUND: apps/cli-linux-arm64/package.json, README.md, .gitignore
- FOUND: apps/cli-win32-x64/package.json, README.md, .gitignore

Commit verified:
- FOUND: 29a3fffd feat(15-02): scaffold 5 platform-binary sibling packages
