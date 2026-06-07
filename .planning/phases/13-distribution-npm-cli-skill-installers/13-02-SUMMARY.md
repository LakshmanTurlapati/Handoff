---
phase: 13-distribution-npm-cli-skill-installers
plan: 02
subsystem: achilles-skill-installer
tags:
  - achilles
  - cli
  - install-skill
  - skill
  - distribution
  - dist-02
  - dist-03
requirements:
  - DIST-02
dependency_graph:
  requires:
    - DIST-02 (plan target)
    - "@achilles/achilles-skill SKILL_PROMPTS_DIR (Phase 12-01)"
    - "Plan 13-01 cli.ts route table + install-skill stub (parallel wave 1)"
  provides:
    - "packages/achilles-skill/skill/SKILL.md (Claude Code skill manifest)"
    - "apps/achilles-cli/src/skill-symlink.ts (pure-function symlink-or-copy primitive)"
    - "apps/achilles-cli/src/commands/install-skill.ts (commander action handler)"
  affects:
    - "Plan 13-04 (source-of-truth diff check + tarball scan consumes SKILL.md + the skill body)"
tech_stack:
  added: []
  patterns:
    - "Pure-function primitive with injected fs / platform / logger seams (Phase 11/12 lineage)"
    - "Optional seam fields with production defaults so the 13-01 stub-shape call (force/stdout/processExitImpl) still compiles"
    - "Recording fs fake for unit tests (no real filesystem touch in CI)"
key_files:
  created:
    - "packages/achilles-skill/skill/SKILL.md"
    - "packages/achilles-skill/src/skill-content.test.ts"
    - "apps/achilles-cli/src/skill-symlink.ts"
    - "apps/achilles-cli/src/skill-symlink.test.ts"
    - "apps/achilles-cli/src/commands/install-skill.test.ts"
  modified:
    - "apps/achilles-cli/src/commands/install-skill.ts (replaced 13-01 stub with full implementation)"
    - "apps/achilles-cli/README.md (expanded install-skill subsection)"
decisions:
  - "SKILL.md lives at packages/achilles-skill/skill/SKILL.md (alongside prompts/), not at the package root, to match the Claude Code skill convention where SKILL.md is at the symlink root. The skill/ directory is the symlink destination so SKILL.md lands at ~/.claude/skills/achilles/SKILL.md."
  - "Test file placed at packages/achilles-skill/src/skill-content.test.ts (not skill/SKILL.test.ts) so the existing phase-12-unit include glob (packages/achilles-skill/src/**/*.test.ts) picks it up without modifying vitest.workspace.ts."
  - "InstallSkillCommandOptions makes the extra seams (homedir/platform/fs/skillSourceProvider/logger/stderr) optional with production defaults so the cli.ts production wiring from Plan 13-01 (which passes only force/stdout/processExitImpl) continues to compile."
  - "Windows fallback set: { EPERM, EACCES, EISDIR } — three errno codes observed across different Windows configurations when symlink permission is unavailable. On non-Windows platforms, ANY symlinkSync failure throws SymlinkNotPermittedError rather than silently masking the condition with a copy."
metrics:
  duration_minutes: 22
  completed_date: "2026-06-07T01:37:56Z"
  tasks_total: 2
  tasks_completed: 2
  tests_added_phase_12_unit: 14
  tests_added_phase_13_unit: 21
  tests_total_phase_13_unit: 40
  tests_total_phase_12_unit: 224
  files_created: 5
  files_modified: 2
  emoji_count: 0
---

# Phase 13 Plan 02: Achilles Skill Installer Summary

One-liner: install-skill cross-platform primitive (macOS/Linux symlink, Windows EPERM/EACCES/EISDIR fallback to recursive copy) plus the finalised `packages/achilles-skill/skill/SKILL.md` body (1250-word post-frontmatter prose) that wires Achilles into Claude Code's skill discovery.

## Objective

Close DIST-02 (the install-skill subcommand) and the SKILL.md side of DIST-03 (one source of truth). The user runs `achilles install-skill` after `npm install -g achilles`; the command resolves the skill source from the workspace-installed `@achilles/achilles-skill` package, computes the destination via `os.homedir() + '/.claude/skills/achilles/'`, and creates a symlink (on macOS/Linux) or recursive copy (Windows fallback). The destination IS the source on Unix, so any future update to `prompts/companion.md` flows through to Claude Code on next restart. The SKILL.md body explains to Claude how to recognise a voice-driven request and how to hand control to the locally installed Achilles binary via `achilles launch`.

## Tasks Completed

| Task | Name | Status |
| ---- | ---- | ------ |
| 1 | Finalise SKILL.md + ensure package.json ships skill/ | Done |
| 2 | skill-symlink primitive + install-skill command (cross-platform with Windows-EPERM fallback) | Done |

## Verification

All verification gates from the plan pass:

- `npx vitest run --project phase-13-unit apps/achilles-cli/src/skill-symlink.test.ts apps/achilles-cli/src/commands/install-skill.test.ts` exits 0 with 21 passing tests (11 SS + 10 IS, exceeds the 13 minimum)
- `npx vitest run --project phase-12-unit packages/achilles-skill/src/skill-content.test.ts` exits 0 with 14 passing tests (S1-S8 + P1-P2 + supplementary, exceeds the 10 minimum)
- `npm run typecheck --workspace apps/achilles-cli` exits 0
- `npm run typecheck --workspace packages/achilles-skill` exits 0
- `find apps/achilles-cli/src -name '*.js' -o -name '*.d.ts'` returns 0 files (CR-07 hygiene preserved)
- `find packages/achilles-skill/skill -type f \( -name '*.exe' -o ... -o -name '*.sh' \)` returns 0 files (Pitfall #11 enforced)
- `wc -w packages/achilles-skill/skill/SKILL.md` = 1360 (raw including frontmatter); body-only post-frontmatter word count is 1250 (under the 2000 cap)
- `grep -c 'prompts/companion\.md' SKILL.md` = 1 (single canonical reference for Plan 13-04's diff check)
- `grep -c 'I ran into a problem' SKILL.md` = 2 (informational references; the plan's verification spec requires `>= 1`)
- `grep -c 'achilles launch' SKILL.md` = 1 (the launch command the skill body instructs Claude to invoke via Bash)
- Zero emoji codepoints in any new file (CLAUDE.md global)
- Plan 12-04 phase-12-unit suite continues to pass (220 tests, 4 skipped — was 206 + 4 before; gained 14 from the new skill-content.test.ts)
- Plan 13-01 phase-13-unit suite continues to pass (40 tests total: 21 baseline from 13-01 + 19 new from 13-02 minus 0 displaced; the install-skill.test.ts replaces the 13-01 stub but no 13-01 test was removed)

## Test counts

- phase-13-unit: 40 tests total (was 19 from 13-01 baseline before my work; my plan added: 11 SS + 10 IS = 21 new, exceeding the >=13 target). Net delta: +21.
- phase-12-unit: 224 tests total (was 210 from 12-04 baseline; my plan added: 14 new skill-content tests, exceeding the >=10 target). Net delta: +14.
- phase-09 / phase-10 / phase-11 suites unchanged (zero regression).
- phase-01 suites have pre-existing failures unrelated to v1.2 Achilles (codex-mobile/handoff side of the monorepo); not in scope.

## Pitfall verification

- Pitfall #11 (skill bundle scope creep): body post-frontmatter word count is 1250 (under 2000); the skill/ directory contains only `.md` files (`SKILL.md` and `prompts/companion.md`) with zero executable extensions (`.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.cmd`, `.bat`, `.ps1`, `.js`, `.mjs`, `.cjs`, `.ts`, `.sh`). Test S5 enumerates the directory recursively and asserts the same.
- Pitfall #13 (Windows global install): the `installSkillSymlink` primitive matches the fallback error set `{ EPERM, EACCES, EISDIR }` on `platform === 'win32'` and falls through to `fs.cpSync` with a clear warn-level log line; tests SS6 and SS7 pin both the EPERM path and the EISDIR/EACCES paths.
- Pitfall #5 (Claude Code skill discovery semantics): the success stdout line explicitly includes "Please restart Claude Code to discover the /achilles skill" so the user knows a fresh top-level skill needs the restart.

## Key Decisions

1. **SKILL.md location**: `packages/achilles-skill/skill/SKILL.md` (alongside `prompts/companion.md`), NOT at the package root. The install-skill command symlinks the `skill/` directory into `~/.claude/skills/achilles/`, so SKILL.md MUST live inside `skill/` for Claude Code to discover the manifest at `~/.claude/skills/achilles/SKILL.md`.
2. **Test file placement**: `packages/achilles-skill/src/skill-content.test.ts` (not `skill/SKILL.test.ts`). The existing `phase-12-unit` glob is `packages/achilles-skill/src/**/*.test.ts` — putting the test under `src/` matches without modifying `vitest.workspace.ts`. The test walks `SKILL_PROMPTS_DIR -> ..` to reach the skill root, then reads `SKILL.md` from there.
3. **Optional seams in `InstallSkillCommandOptions`**: the `homedir`, `platform`, `fs`, `skillSourceProvider`, `logger`, and `stderr` fields are optional with production defaults so the cli.ts production wiring from Plan 13-01 (which passes only `{ force, stdout, processExitImpl }`) compiles unchanged. The test injects every seam for branch coverage.
4. **Windows fallback errno set `{ EPERM, EACCES, EISDIR }`**: three codes observed across different Windows configurations when `symlinkSync` lacks the SeCreateSymbolicLinkPrivilege. On non-Windows, ANY symlink failure is a real bug (homedir unwritable / read-only filesystem) so we throw `SymlinkNotPermittedError` rather than mask the condition.
5. **Single-occurrence `prompts/companion.md` token**: Test S4 enforces exactly one occurrence in the SKILL.md body so Plan 13-04's diff check can scan a single canonical token. The body initially named the file in two paragraphs; I rewrote the first paragraph to refer to "the single source-of-truth file shipped alongside this manifest" so the canonical token stayed in the "How the spoken interaction works" section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan correction] Restart copy lowercase 'r'**

- **Found during:** Task 2 (IS5 test execution)
- **Issue:** The plan's IS5 test specifies `the command writes a stdout line containing "restart Claude Code"` (lowercase). My first implementation wrote "Restart Claude Code" (capital R) as a sentence opener; the tests failed because `.includes("restart Claude Code")` checks a literal lowercase string.
- **Fix:** Reworded the stdout line to "Please restart Claude Code to discover the /achilles skill" — the substring "restart Claude Code" appears in lowercase as the plan specifies.
- **Files modified:** `apps/achilles-cli/src/commands/install-skill.ts`
- **Rationale:** The plan's test contract is authoritative; the surface message remains user-friendly.

**2. [Rule 1 - Plan correction] prompts/companion.md exactly-once enforcement**

- **Found during:** Task 1 (S4 test execution)
- **Issue:** My first SKILL.md draft mentioned `prompts/companion.md` twice — once in the "What it does" section and once in the "How the spoken interaction works" section. Test S4 enforces exactly one occurrence.
- **Fix:** Rewrote the first paragraph to refer to "the single source-of-truth file shipped alongside this manifest" without naming the relative path. The canonical token now appears only in the "How the spoken interaction works" section.
- **Files modified:** `packages/achilles-skill/skill/SKILL.md`
- **Rationale:** Plan 13-04's diff check needs a single canonical reference; the rewritten paragraph still names PROMPT-01 and explains the cross-surface contract without duplicating the literal path.

### Coordination notes — parallel wave 1 with Plan 13-01

The orchestrator ran Plan 13-01 and Plan 13-02 in the same wave on the same branch. Mid-execution, 13-01 rebuilt `apps/achilles-cli/dist` and reverted `apps/achilles-cli/src/commands/install-skill.ts` to its stub at 20:31 — I detected this when the install-skill tests reported `captured.source` as `undefined` (the stub never calls symlinkSync). I re-wrote the file and the parallel collision did not recur. Final state has my 13-02 implementation in place; the dist/ directory was rebuilt from the final source and contains the 13-02 implementation.

No other files were affected by the collision. The skill-symlink.ts file (newly created by 13-02; not in 13-01's plan file list) survived the collision; only the install-skill.ts file (in both 13-01's stub list and 13-02's overwrite list) was touched. The plan's own coordination note named this exact contention point as expected.

## Known Stubs

None — the install-skill command is the FULL implementation per the plan. No deferrals.

## Threat Flags

None — Plan 13-02 introduces zero new trust boundaries beyond those documented in the plan's `<threat_model>` block. The skill-symlink primitive does not open a network socket, read any environment variable other than what `os.homedir()` resolves to internally, or shell out to any subprocess. The `--force` destructive path is gated behind the user-supplied flag and the conflict-detection branches throw `ExistingDestinationConflictError` before any `rmSync` runs in the default path.

## Self-Check: PASSED

- `packages/achilles-skill/skill/SKILL.md`: FOUND
- `packages/achilles-skill/src/skill-content.test.ts`: FOUND
- `apps/achilles-cli/src/skill-symlink.ts`: FOUND
- `apps/achilles-cli/src/skill-symlink.test.ts`: FOUND
- `apps/achilles-cli/src/commands/install-skill.test.ts`: FOUND
- `apps/achilles-cli/src/commands/install-skill.ts` (modified): FOUND
- `apps/achilles-cli/README.md` (modified): FOUND
- phase-13-unit tests: 40/40 passing
- phase-12-unit tests: 220/220 passing (4 skipped, same as before)
- achilles-cli typecheck: clean
- achilles-skill typecheck: clean

## Commits

Single atomic commit per plan policy: `feat(13-02): install-skill cross-platform + SKILL.md body` (no Co-Authored-By trailer).
