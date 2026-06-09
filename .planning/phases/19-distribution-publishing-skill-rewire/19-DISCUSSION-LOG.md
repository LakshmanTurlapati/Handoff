# Phase 19: Distribution + Publishing + Skill Rewire - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 19-distribution-publishing-skill-rewire
**Areas discussed:** Darwin sibling packages disposition, SKILL.md rewrite scope, Publish-then-cut deletion staging, ERR-01 error banner UX

---

## Darwin Sibling Packages Disposition

Context: Phase 15 scaffolded all 5 platform packages (darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64) and listed them in `apps/achilles-terminal/package.json` optionalDependencies at v1.3.0. Under the macOS Option 3 lock from 2026-06-09 commit `9589bad6`, only 3 compiled platforms ship; the 2 darwin sibling packages need a disposition.

| Option | Description | Selected |
|--------|-------------|----------|
| Drop entirely | Delete `apps/cli-darwin-arm64/` and `apps/cli-darwin-x64/` directories; remove both from optionalDependencies; 3 platform packages publish; bin shim falls through to JS-fallback deterministically | YES |
| Keep as no-op shim packages | Keep directories, ship empty `bin/` folders, bin shim's existsSync fails, falls through to JS | |
| No-op shim with explicit redirect | Keep directories, ship `bin/achilles` shim that prints "macOS uses JS-fallback" then exec the JS path | |

**User's choice:** Drop entirely
**Notes:** Recommended path -- `@achilles` is a private npm scope (no squat risk on unpublished sub-package names); bin shim's `existsSync(binPath)` already handles missing-platform-binary deterministically (falls through to JS bundle); 2 fewer packages to version-bump per release. The darwin sibling drop happens as PRE-publish work in Phase 19, NOT in the post-publish cleanup commit, because the 2 directories were never published (Phase 15 only scaffolded them).

---

## SKILL.md Rewrite Scope

Context: `packages/achilles-skill/skill/SKILL.md` (152 lines) currently describes the v1.2 Electron + floating UI model: `achilles launch`, `systemPreferences.askForMediaAccess('microphone')`, Electron-host prerequisites, X-forwarding caveats. v1.3 is terminal-only -- the whole manifest is wrong. The ROADMAP wording said "one-line `achilles launch` -> `achilles voice` diff" but a literal interpretation leaves the skill manifest lying about the product.

| Option | Description | Selected |
|--------|-------------|----------|
| Full rewrite to terminal-only model | Rewrite entire body: drop Electron / floating UI / askForMediaAccess / X-forwarding language; replace with sox + ffmpeg + Node 22 (Bun-recommended on macOS) prerequisites + `achilles init` TCC walk + parent-terminal-emulator note for macOS; narrow `allowed-tools` to 8 specific patterns; add BASH_MAX_TIMEOUT_MS=86400000 doc at top; skill body shells out to `achilles voice` (shebang dispatches to Node) | YES |
| Minimal literal diff (launch -> voice only) | Only replace `achilles launch` -> `achilles voice` and allowed-tools narrow; leave Electron description in place | |
| Two-stage: minimal diff in v1.3.0, full rewrite in v1.3.1 | Ship v1.3.0 with minimal diff; open v1.3.1 follow-up for full rewrite | |

**User's choice:** Full rewrite to terminal-only model
**Notes:** Recommended -- the operator reading the manifest deserves accurate information. Decisions captured in CONTEXT.md: SKILL.md body shells out to `achilles voice` and lets the shebang dispatch (Node 22+ assumed because user already ran `npm install -g achilles`); Bun documented as the preferred runtime on macOS for sub-500ms cold-start but NOT a prerequisite; `allowed-tools` narrowed to exactly 8 entries (5 subcommand patterns + 3 `which` invocations) matching Phase 18's actual wired subcommands.

---

## Publish-then-Cut Deletion Staging

Context: `apps/achilles/` (Electron, 132 files) and `apps/achilles-cli/src/commands/launch.ts` (179 LOC) are slated for deletion AFTER `npm publish` succeeds. The 5 commands in `apps/achilles-cli/src/commands/` (init, install-skill, latency, launch, transcripts) were v1.2-era; v1.3 replaced them inside `apps/achilles-terminal/src/`. The non-launch v1.2 commands are likely all dead post-v1.3 but need verification.

| Option | Description | Selected |
|--------|-------------|----------|
| One cleanup commit, after publish-success | Single post-publish commit deletes Electron tree + launcher path + any newly-dead apps/achilles-cli files. Atomic rollback via `git revert HEAD` | YES |
| Two-stage: launcher first, Electron tree second | Commit 1 deletes launcher; wait 1-3 days; Commit 2 deletes Electron tree | |
| Single PR with CI-gated merge | SKILL.md rewrite + deletions land in one PR; CI polls `npm view achilles@1.3.0` and won't merge until publish is discoverable | |

**User's choice:** One cleanup commit, after publish-success
**Notes:** Recommended -- simplest mental model: publish, then cut. Phase 19 sequencing: (commit A) publish-ready state with new bin paths + SKILL.md rewrite + ESLint rule + structured logger + error banner + watchdog; (CI runs publish job from commit A); (verify `npm view achilles@1.3.0` succeeds and the 3 platform packages are discoverable); (commit B) deletion of `apps/achilles/` + `apps/achilles-cli/src/commands/launch.ts` + verified-dead files in `apps/achilles-cli/`. Publish failure leaves workspace at commit A with the Electron tree intact as a recoverable artifact. Verification step before commit B greps the monorepo for any importers of deletion targets before removing them.

---

## ERR-01 Error Banner UX

Context: REQUIREMENTS.md ERR-01 defines an inline one-line red banner above the status row naming error class (network / auth / rate-limit / sox / ffplay / claude) + proposed action, auto-dismissing after 8s or on next successful event. Phase 18's status row is `[state] <last 60 chars of partial transcript>` with optional REC tag. The banner could pre-empt above the status row (both visible) or replace it temporarily.

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-empt: banner ABOVE status row | New row added above status row; both visible for 8s; layout adds/removes a row each transition | YES |
| Replace: banner takes status row temporarily | Status row's content replaced by banner content for 8s, then status returns; no vertical jitter | |
| Pre-empt + screen-reader-aware | Visual pre-empt for sighted users; replace-the-row for `INK_SCREEN_READER=1` mode | |

**User's choice:** Pre-empt: banner ABOVE status row, status stays visible
**Notes:** Recommended -- during cascading failures the user wants to see WHAT went wrong AND WHAT state they're in simultaneously (e.g., red `network -- retrying...` banner + green `listening` status row). Vertical jitter of 1 row on banner appear/dismiss is acceptable. Screen-reader mode (Phase 16 ACC-02) is handled by `<Text aria-live="assertive">` on the banner row and `<Text aria-live="polite">` on the status row; ARIA priority gives the user the error first then the state. No special replace-the-row variant for screen readers.

---

## Claude's Discretion

- **ERR-03 watchdog respawn cap-exceeded behavior:** planner picks between exit-process vs stay-in-error-state-with-typed-input. Recommend: stay in error state, mic capture is dead but Phase 18 ERR-04 typed-input still works, user finishes their thought then Ctrl-C exits clean.
- **ERR-08 structured logger rotation at 10MB:** planner picks between `achilles.log.1` (single archive) vs daily `achilles.log.YYYY-MM-DD` vs numbered N-archive ring. Recommend: single archive (matches v1.2 logger semantics that operators already know).
- **CI workflow shape (atomic publish job):** planner picks single workflow with `matrix.os` (publish job depends on build success across all platforms; sequential npm publish parent-then-siblings) vs separate per-platform workflows. Recommend: single workflow + matrix.
- **ESLint `stdio: "ignore"` rule scope:** rule lives in `apps/achilles-terminal/eslint.config.js` only, NOT root. Other workspaces (Handoff bridge/relay/web) have legitimate `stdio:"ignore"` usage.

## Deferred Ideas

None -- the discussion stayed within Phase 19 scope. The 4 areas selected were all "HOW to implement what's already scoped"; no new-capability ideas surfaced that would need deferring. Phase 20 (RBS-1/2/3 asciicasts + macOS Sequoia VS Code asciicast + 65 dBA noisy-environment field test + dual-runtime CI final-green) remains in its own scope as already roadmapped.
