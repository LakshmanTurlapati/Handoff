---
phase: 19-distribution-publishing-skill-rewire
plan: 01
subsystem: distribution
tags: [distribution, skill-manifest, pre-publish, darwin-drop, publish-config]
requires:
  - "Phase 18 INIT-06 macOS TCC documentation (referenced from SKILL.md)"
  - "Phase 15 bin shim optionalDependencies + existsSync fallback"
  - "Phase 15 vitest forks pool config (apps/achilles-terminal/vitest.config.ts)"
provides:
  - "Publish-ready apps/achilles-terminal/package.json shape (3 optional siblings)"
  - "Publish-ready @achilles/achilles-skill package.json shape (1.3.0, public)"
  - "v1.3 terminal-only SKILL.md manifest (8-entry allowed-tools, BASH_MAX_TIMEOUT_MS callout)"
  - "3 contract tests guarding the publish-ready shapes"
affects:
  - "apps/achilles-terminal/package.json (optionalDependencies trim + dep version pin)"
  - "apps/achilles-cli/package.json (Rule 3 auto-fix workspace pin sync)"
  - "packages/achilles-skill/package.json (version + private + publishConfig flip)"
  - "packages/achilles-skill/skill/SKILL.md (wholesale rewrite)"
  - "package-lock.json (regenerated for workspace version bump)"
tech-stack:
  added: []
  patterns:
    - "TDD RED+GREEN per-task commit (S-1)"
    - "Workspace dependency pin sync (D-15-02)"
    - "Single-line comma-separated allowed-tools (RESEARCH §Pitfall 6)"
    - "ASCII-only docs per CLAUDE.md global (PATTERNS.md S-5)"
key-files:
  created:
    - "apps/achilles-terminal/tests/package-json-shape.test.ts"
    - "apps/achilles-terminal/tests/achilles-skill-publish-config.test.ts"
    - "apps/achilles-terminal/tests/skill-md-contract.test.ts"
  modified:
    - "apps/achilles-terminal/package.json"
    - "apps/achilles-cli/package.json"
    - "packages/achilles-skill/package.json"
    - "packages/achilles-skill/skill/SKILL.md"
    - "package-lock.json"
  deleted:
    - "apps/cli-darwin-arm64/ (.gitignore, README.md, package.json)"
    - "apps/cli-darwin-x64/ (.gitignore, README.md, package.json)"
decisions:
  - "D-01 satisfied: darwin sibling directories dropped entirely under the Option 3 lock"
  - "D-02 satisfied: darwin drop landed in Plan 19-01 (PRE-publish), not Plan 19-04 (post-publish cleanup)"
  - "D-03 satisfied: SKILL.md got a full rewrite (49 lines of Electron-era body replaced wholesale)"
  - "D-04 satisfied: allowed-tools narrowed to exactly 8 patterns (single-line comma-separated)"
  - "D-05 satisfied: BASH_MAX_TIMEOUT_MS=86400000 documented in the first body section (within first 30 lines)"
  - "D-06 satisfied: skill body shells out to `achilles voice` -- Bun documented as preferred but not required"
  - "D-07 satisfied: all Electron / floating UI / askForMediaAccess / X-forwarding language dropped"
  - "Rule 3 auto-fix: apps/achilles-cli/package.json @achilles/achilles-skill dep pinned to 1.3.0 to keep workspace install resolving; deletion of that workspace happens in Plan 19-04 commit B"
metrics:
  duration: "~12 minutes (single executor)"
  completed: "2026-06-09T18:44:30Z"
  tasks: 2
  files_changed: 14
  insertions: 395
  deletions: 71
  contract_tests_added: 19
  contract_tests_passing: 19
requirements: [DIST-03]
---

# Phase 19 Plan 01: Pre-publish prep -- darwin drop + achilles-skill publish-config flip + SKILL.md v1.3 rewrite Summary

Implements 2 atomic tasks that lay the publish-ready foundation for v1.3.0:
drops the 2 darwin sibling packages entirely under the macOS Option 3 lock,
flips `@achilles/achilles-skill` from `private:0.1.0` to `public:1.3.0`, and
fully rewrites `packages/achilles-skill/skill/SKILL.md` from the 49-line v1.2
Electron-era manifest to a v1.3 terminal-only manifest with a narrowed 8-entry
`allowed-tools` and a prominent `BASH_MAX_TIMEOUT_MS=86400000` callout.

## Tasks Completed

| Task | Description | RED Commit | GREEN Commit |
|------|-------------|------------|--------------|
| 1 | Darwin sibling drop + achilles-skill publish-config flip + workspace dep pin sync | `75a2ba57` | `136045e9` |
| 2 | Full SKILL.md rewrite to v1.3 terminal-only model + contract test | `b3681f22` | `835193d5` |

All 4 commits passed pre-commit hooks (lint + format gates) and the
post-commit deletion-check verified that Task 1's 6 darwin-related file
deletions are intentional and expected (D-01).

## Final Shape: apps/achilles-terminal/package.json

```json
"dependencies": {
  "@achilles/achilles-skill": "1.3.0",
  "@achilles/claude-code-bridge": "0.1.0",
  "@achilles/voice-protocol": "0.1.0",
  "@achilles/voice-stt": "0.1.0",
  "@achilles/voice-tts": "0.1.0",
  ...
},
"optionalDependencies": {
  "@achilles/cli-linux-arm64": "1.3.0",
  "@achilles/cli-linux-x64": "1.3.0",
  "@achilles/cli-win32-x64": "1.3.0"
}
```

3 optionalDependencies entries (was 5). `@achilles/achilles-skill` bumped from
`0.1.0` to `1.3.0` to match the published workspace package version.

## Final Shape: packages/achilles-skill/package.json

```json
{
  "name": "@achilles/achilles-skill",
  "version": "1.3.0",
  "private": false,
  "publishConfig": {
    "access": "public"
  },
  ...
}
```

Three publish-relevant changes:

1. `version` 0.1.0 -> 1.3.0
2. `private` true -> false (RESEARCH §Pitfall 2 -- npm publish fails with
   EPRIVATE otherwise)
3. New `publishConfig.access: "public"` field (RESEARCH §Anti-Patterns row 5
   -- required for first-time @-scoped publishes)

## SKILL.md Rewrite Diff Stats

| Metric | v1.2 (deleted) | v1.3 (added) |
|--------|-----------------|--------------|
| Total lines | 49 | 59 |
| Frontmatter fields | 3 (name, description, allowed-tools="Bash") | 3 (name, description, allowed-tools=8 entries) |
| Body sections | 6 | 7 |
| Forbidden tokens present | 6 of 6 | 0 of 6 |
| `BASH_MAX_TIMEOUT_MS=86400000` count | 0 | 2 |
| `Bash(...)` allowed-tools count | 1 (broad "Bash") | 8 (narrow patterns) |

The body grew by 10 lines net because the v1.3 Prerequisites section ships
per-platform install lines for `sox` + `ffmpeg`, the macOS parent-terminal TCC
remediation note citing Phase 18 INIT-06, and the new "Long-running session
timeout" callout (D-05). The Electron / floating-UI / askForMediaAccess /
X-forwarding sentences were removed in their entirety.

## Contract Tests

| Test File | Coverage | Assertions | Status |
|-----------|----------|------------|--------|
| `tests/package-json-shape.test.ts` | D-01 / D-02 optionalDependencies + workspace dep pin + filesystem absence | 7 | GREEN |
| `tests/achilles-skill-publish-config.test.ts` | DIST-03 achilles-skill publish shape | 4 | GREEN |
| `tests/skill-md-contract.test.ts` | D-03 / D-04 / D-05 / D-06 / D-07 SKILL.md frontmatter + body assertions | 8 | GREEN |

All 19 contract test assertions pass via:

```
npm test --workspace apps/achilles-terminal -- --pool=forks \
  tests/package-json-shape.test.ts \
  tests/achilles-skill-publish-config.test.ts \
  tests/skill-md-contract.test.ts
```

Each test file follows the established Phase 15-18 vitest pattern: file-read
via `node:fs.readFileSync` + JSON.parse / manual YAML-line parse + assertion
stack. No spawnSync, no child process, no network -- pure structural
assertions against on-disk artifacts.

## Plan Verification Commands (all OK)

- `npm test --workspace apps/achilles-terminal -- --pool=forks tests/package-json-shape.test.ts tests/skill-md-contract.test.ts tests/achilles-skill-publish-config.test.ts` -> 19/19 pass
- `npm ci --include=optional --force` -> exit 0 (workspace resolves after the lockfile regeneration)
- `[[ ! -d apps/cli-darwin-arm64 ]] && [[ ! -d apps/cli-darwin-x64 ]]` -> exit 0
- `jq '.optionalDependencies | keys | length' apps/achilles-terminal/package.json` -> 3
- `jq '.private' packages/achilles-skill/package.json` -> false
- `jq -r '.publishConfig.access' packages/achilles-skill/package.json` -> public
- `jq -r '.dependencies."@achilles/achilles-skill"' apps/achilles-terminal/package.json` -> 1.3.0
- `grep -c '^allowed-tools:' packages/achilles-skill/skill/SKILL.md` -> 1 (single-line shape per RESEARCH §Pitfall 6)
- `head -10 SKILL.md | grep -o 'Bash([^)]*)' | wc -l` -> 8 (D-04 lock)
- `grep -c 'BASH_MAX_TIMEOUT_MS=86400000' SKILL.md` -> 2 (D-05 prominent callout)
- `grep -cE 'Electron|floating UI|systemPreferences|X-forwarding|Achilles\.app|renderer process' SKILL.md` -> 0 (D-07 negative assertions)
- `LC_ALL=C grep -P '[\x80-\xff]' SKILL.md` -> empty (ASCII-only per PATTERNS.md S-5)

## LOOP-02 Invariants (all held)

| Path | Expected | Actual |
|------|----------|--------|
| `packages/voice-protocol/` | unchanged | OK (no diff in plan range) |
| `packages/voice-stt/` | unchanged | OK |
| `packages/voice-tts/` | unchanged | OK |
| `packages/claude-code-bridge/` | unchanged | OK |
| `packages/achilles-skill/skill/prompts/companion.md` | byte-for-byte preserved | OK (hash `7d53d7e6d0644e08a86c6fd8234bd6a4f067ac69` unchanged across all 4 commits) |

The SKILL.md rewrite explicitly avoided `packages/achilles-skill/skill/prompts/companion.md`; the rewrite operated on `packages/achilles-skill/skill/SKILL.md` only (sibling file in the same directory).

## INIT-07 Invariant (held)

`apps/achilles-terminal/src/cli.ts` was untouched in this plan. Top-level
static-import budget remains `{node:fs/promises, node:url, node:path}`. The
install-skill subcommand wiring (and its 6th dynamic-import gate in cli.ts)
is Plan 19-02's scope per the phase plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Workspace dependency pin sync in apps/achilles-cli/package.json**

- **Found during:** Task 1 verification step (the `npm ci --include=optional --force` exit-0 requirement)
- **Issue:** After bumping `packages/achilles-skill/package.json` to version `1.3.0`, the legacy v1.2 Electron CLI workspace at `apps/achilles-cli/package.json:31` still pinned `@achilles/achilles-skill@0.1.0`. The lockfile resolver attempted to fetch `@achilles/achilles-skill@0.1.0` from the npm registry (where it does not exist, because the workspace package was previously private) and failed with E404. This blocked `npm ci --include=optional --force`, which is the plan's verification gate.
- **Fix:** Bumped `apps/achilles-cli/package.json` `@achilles/achilles-skill` dependency pin from `0.1.0` to `1.3.0` to match the new workspace package version. Regenerated `package-lock.json` via `npm install --include=optional --force` to pick up both new workspace pins (apps/achilles-terminal AND apps/achilles-cli). The whole `apps/achilles-cli/` workspace is slated for deletion in Plan 19-04 commit B (publish-then-cut sequencing per D-09); until then, keeping its workspace edge live is the deliberate D-09 ordering choice.
- **Files modified:** `apps/achilles-cli/package.json` (line 31), `package-lock.json` (regenerated)
- **Commit:** `136045e9` (Task 1 GREEN, batched into the same atomic metadata commit)

**2. [Rule 1 - Bug] Negative-language references to forbidden tokens in SKILL.md body**

- **Found during:** Task 2 GREEN initial run of `skill-md-contract.test.ts`
- **Issue:** The first draft of the v1.3 SKILL.md body included two sentences that named v1.2 architecture features in the negative form -- "no Electron host", "no X-forwarding requirement". The contract test (D-07 negative-substring assertion) treats any literal occurrence of `Electron` or `X-forwarding` as a contract violation regardless of surrounding negation. The test correctly failed because operators reading the manifest should not see Electron-era language at all, even when refuted.
- **Fix:** Rewrote both sentences to describe the v1.3 architecture without referencing the v1.2 model: "no separate GUI process and no detached child" (replacing the "no Electron host, no floating window" phrasing); the macOS permission paragraph rephrased to focus on parent-terminal TCC grants and SSH-via-parent-terminal-emulator without invoking the `X-forwarding` token.
- **Files modified:** `packages/achilles-skill/skill/SKILL.md` (2 paragraphs in the "What it does" and "Prerequisites" sections)
- **Commit:** `835193d5` (Task 2 GREEN -- the rewrite landed as a single commit after the rephrasing pass; no extra commit needed because the rewrite never landed in the repo with the forbidden tokens)

### Architectural Changes

None. Both deviations fell under Rules 1 and 3 (auto-fix); no Rule 4 architectural decisions required.

## Threat Flags

None. Threat model dispositions all held: T-19-01 (allowed-tools lock asserted by contract test), T-19-02 (narrow Bash patterns with whitespace-bounded `*`), T-19-03 (Electron-era prerequisites dropped + asserted by contract test), T-19-04 (accepted: @achilles private-scope squat risk N/A), T-19-05 (companion.md byte-for-byte preserved -- LOOP-02 invariant verified via hash compare).

## Known Stubs

None. No hardcoded empty arrays, no placeholder TODOs, no "coming soon" text. The SKILL.md body is the published-ready final content; the package.json metadata changes are the published-ready final shape.

## Authentication Gates

None encountered. All work was filesystem mutation + workspace lockfile regeneration; no external API touch, no auth flow.

## Self-Check: PASSED

Verified all SUMMARY claims against repo state at commit `835193d5`:

- Files claimed to be created exist:
  - `apps/achilles-terminal/tests/package-json-shape.test.ts` -> FOUND
  - `apps/achilles-terminal/tests/achilles-skill-publish-config.test.ts` -> FOUND
  - `apps/achilles-terminal/tests/skill-md-contract.test.ts` -> FOUND
- Files claimed to be deleted are absent:
  - `apps/cli-darwin-arm64/` -> absent
  - `apps/cli-darwin-x64/` -> absent
- Commits claimed all exist on the worktree branch:
  - `75a2ba57` (Task 1 RED) -> FOUND
  - `136045e9` (Task 1 GREEN) -> FOUND
  - `b3681f22` (Task 2 RED) -> FOUND
  - `835193d5` (Task 2 GREEN) -> FOUND
- All 19 contract tests pass.
- LOOP-02 + INIT-07 invariants verified clean.
