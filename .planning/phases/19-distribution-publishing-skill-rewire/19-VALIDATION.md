---
phase: 19
slug: distribution-publishing-skill-rewire
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 (root pin), `pool: "forks"` for subprocess isolation |
| **Config file** | `apps/achilles-terminal/vitest.config.ts` (Phase 15) |
| **Quick run command** | `npm test --workspace apps/achilles-terminal -- --pool=forks <test-file>` |
| **Full suite command** | `npm test --workspace apps/achilles-terminal -- --pool=forks` |
| **Estimated runtime** | ~12 seconds (full suite, current ~120 tests + 6 new Phase 19 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace apps/achilles-terminal -- --pool=forks <touched-test-file>` (e.g., `tests/ui/banner.test.tsx`)
- **After every plan wave:** Run `npm test --workspace apps/achilles-terminal -- --pool=forks` (full suite)
- **Before `/gsd:verify-work`:** Full suite green + `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` green + `node apps/achilles-terminal/scripts/check-source-of-truth.mjs` green + `node apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` green
- **Max feedback latency:** ~12 seconds (quick run: ~2 seconds; full suite: ~12 seconds)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | D-01 (darwin drop) | — | optionalDependencies removes darwin entries; `apps/cli-darwin-*` deleted | unit (snapshot of resolved package.json) | `npm test --workspace apps/achilles-terminal -- tests/package-json-shape.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | D-03..D-07 (SKILL.md rewrite) | T-V13-skill-API | `allowed-tools` has exactly 8 entries; body describes terminal-only model | unit (frontmatter contract) | `npm test --workspace apps/achilles-terminal -- tests/skill-md-contract.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | DIST-03 (achilles-skill flip) | — | `private: false` + version `1.3.0` in achilles-skill/package.json | unit (snapshot) | `npm test --workspace apps/achilles-terminal -- tests/achilles-skill-publish-config.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | ERR-01 (Banner) | T-V14-error-classifier | Banner renders single line; auto-dismisses 8s; aria-live="assertive"; never logs raw error to disk without redaction | unit + integration | `npm test --workspace apps/achilles-terminal -- tests/ui/banner.test.tsx` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | ERR-01 (error-classifier) | T-V14-error-classifier | classifier maps SessionError → {class, suggestedAction}; covers 6 classes (network, auth, rate-limit, sox, ffplay, claude) | unit | `npm test --workspace apps/achilles-terminal -- tests/error-classifier.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-03 | 02 | 2 | ERR-03 (watchdog wiring) | — | `session.ts` constructs sox-watchdog AND ffplay-watchdog (regression guard against single-arm wiring) | unit (grep + import assertion) | `npm test --workspace apps/achilles-terminal -- tests/session-err03-wiring.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-04 | 02 | 2 | ERR-08 (logger wiring) | T-V7-logging | `runVoice()` unconditionally constructs structured logger before any other side effect (regression guard against v1.2 silent-stdio gap) | unit | `npm test --workspace apps/achilles-terminal -- tests/session-err08-wiring.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-05 | 02 | 2 | GATE-04 (ESLint forbid) | T-V13-stdio-ignore | ESLint rule fires on `spawn(..., { stdio: "ignore" })` in `apps/achilles-terminal/`; not active in other workspaces | unit (ESLint API) | `npm test --workspace apps/achilles-terminal -- tests/eslint-stdio-ignore.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-06 | 02 | 2 | DIST-03 (install-skill subcommand) | T-V13-skill-API | `achilles install-skill [--force]` registers symlink at `~/.claude/skills/achilles/`; INIT-07 invariant preserved (dynamic import gate) | unit + integration | `npm test --workspace apps/achilles-terminal -- tests/install-skill.test.ts tests/cli-install-skill.test.ts` | ❌ W0 (port from v1.2) | ⬜ pending |
| 19-03-01 | 03 | 3 | DIST-03/04 (SHA-256 source-of-truth) | T-V6-tamper-companion | `companion.md` byte-for-byte equal between source (`packages/achilles-skill/skill/prompts/companion.md`) and bundled-in-tarball; runs as `prepublishOnly` hook | script test | `node apps/achilles-terminal/scripts/check-source-of-truth.mjs` AND paired test in `tests/check-source-of-truth.test.ts` | ✅ script exists from Phase 17; ❌ W0 wider arm verification | ⬜ pending |
| 19-03-02 | 03 | 3 | DIST-06 (tarball secret-scan) | T-V8-tarball-secret | Empty result for the 7 regexes (Bearer, JWT, sk-, xi-, xi_, ELEVENLABS_API_KEY, long hex); runs as `prepublishOnly` hook | script test | `node apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` AND paired test | ❌ W0 (port from v1.2 + paired test) | ⬜ pending |
| 19-03-03 | 03 | 3 | DIST-04 (publish workflow) | T-V2-NODE_AUTH_TOKEN | `.github/workflows/achilles-release.yml` builds + publishes 4 packages (3 platform siblings + parent) sequentially; macOS smoke runs `bunx achilles@<v> --version`; --provenance flag set | manual (workflow file shape) | YAML lint + `.github/workflows/achilles-release.yml` exists | ❌ W0 (NEW workflow) | ⬜ pending |
| 19-04-01 | 04 | 4 (post-publish) | D-08/09 (reachability check) | — | Pre-deletion grep shows zero importers of `apps/achilles-cli/**` from outside the directory | script test | `bash scripts/check-deletion-reachability.sh` (NEW) returns 0 | ❌ W0 | ⬜ pending |
| 19-04-02 | 04 | 4 (post-publish) | D-08 (Electron tree delete) | — | `apps/achilles/` and `apps/achilles-cli/src/commands/launch.ts` absent after commit; `npm test` still green | snapshot | `[[ ! -d apps/achilles ]] && [[ ! -f apps/achilles-cli/src/commands/launch.ts ]]` | will be true post-deletion | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/achilles-terminal/tests/ui/banner.test.tsx` — covers ERR-01 (Banner render + auto-dismiss + success-dismiss + aria-live)
- [ ] `apps/achilles-terminal/tests/error-classifier.test.ts` — covers SessionError -> ClassifiedBanner mapping table (6 classes)
- [ ] `apps/achilles-terminal/tests/install-skill.test.ts` — covers DIST-03 install-skill subcommand (port from v1.2 + adapt for v1.3 layout)
- [ ] `apps/achilles-terminal/tests/cli-install-skill.test.ts` — covers the cli.ts dynamic-import gate for install-skill (INIT-07 invariant guard)
- [ ] `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` — port from v1.2 (NEW script with 7 regex patterns)
- [ ] `apps/achilles-terminal/scripts/check-tarball-no-secrets.test.mjs` — paired test for the script
- [ ] `apps/achilles-terminal/tests/session-err08-wiring.test.ts` — asserts runVoice() unconditionally constructs structured logger (regression guard for v1.2 silent-stdio gap)
- [ ] `apps/achilles-terminal/tests/session-err03-wiring.test.ts` — asserts session.ts constructs both sox + ffplay watchdogs (regression guard against single-arm wiring)
- [ ] `apps/achilles-terminal/tests/skill-md-contract.test.ts` — contract test asserting frontmatter `allowed-tools` has exactly 8 entries matching the locked list (D-04)
- [ ] `apps/achilles-terminal/tests/eslint-stdio-ignore.test.ts` — runs ESLint programmatically against a fixture with `{ stdio: "ignore" }` and asserts the rule fires
- [ ] `apps/achilles-terminal/tests/package-json-shape.test.ts` — covers D-01 darwin sibling removal from optionalDependencies snapshot
- [ ] `apps/achilles-terminal/tests/achilles-skill-publish-config.test.ts` — covers DIST-03 achilles-skill `private: false` + version 1.3.0 flip
- [ ] `apps/achilles-terminal/tests/check-source-of-truth.test.ts` — wider-arm test verifying the existing Phase 17 source-of-truth script against the new publish layout
- [ ] `scripts/check-deletion-reachability.sh` — NEW script + paired test for the publish-then-cut reachability gate
- [ ] `.github/workflows/achilles-release.yml` — NEW publish workflow file with matrix build + sequential publish + macOS smoke + --provenance + NODE_AUTH_TOKEN

*Existing infrastructure (Phase 15-18) covers: child-exit-watchdog test surface, structured-logger test surface, mock-loop scaffolding, integration test harness, dual-runtime CI matrix, ESLint config slot.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real publish to npm succeeds with all 4 packages discoverable | DIST-04 | Requires NODE_AUTH_TOKEN secret + GitHub Actions runner + npm registry round-trip; CI runs the publish job once per release tag, operator gates | (release operator) push tag `v1.3.0`; wait for workflow; run `npm view achilles@1.3.0` + `npm view @achilles/cli-linux-x64@1.3.0` + `@achilles/cli-linux-arm64@1.3.0` + `@achilles/cli-win32-x64@1.3.0`; verify all 4 return non-empty `name + version + dist.tarball` |
| macOS JS-fallback resolves under Bun on a fresh macOS account | DIST-06 | Requires fresh macOS user account + clean npm cache; CI macos-smoke job runs `bunx achilles@1.3.0 --version` but full voice-loop verification is Phase 20 GATE-01 RBS-1 | (release operator) on fresh macOS account: `npm install -g achilles@1.3.0`; `which achilles`; `achilles --version`; verify the bin shim resolves and falls through to the JS bundle (no `@achilles/cli-darwin-*` installed); `ls ~/.achilles` shows nothing yet; `achilles init` walks; `achilles voice` reaches first TUI render within <500ms cold-start |
| `/achilles` from inside Claude Code launches the same artifact as the npm CLI path | DIST-04 | Requires user to invoke `/achilles` inside Claude Code with the skill installed; CI cannot drive Claude Code interactively | (release operator) `achilles install-skill --force` then restart Claude Code; type `/achilles`; verify the spawn matches `which achilles` resolution; verify the same VoiceShell TUI renders |
| Tarball secret-scan empty against a real release tarball | DIST-06 / V8 | Requires the real publish artifact (CI builds it; secret-scan runs in prepublishOnly) | CI workflow gates; operator confirms green run before tag push |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (15 Wave 0 items above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 1 + Wave 2 + Wave 3 all have per-task automated commands)
- [ ] Wave 0 covers all MISSING references (15 items mapped to specific verify commands)
- [ ] No watch-mode flags (all commands use `--pool=forks` + one-shot semantics; no `--watch`)
- [ ] Feedback latency < 12s (quick run < 2s; full suite ~ 12s)
- [ ] `nyquist_compliant: true` to be set in frontmatter after planner approves Wave 0 layout

**Approval:** pending
