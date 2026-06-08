---
phase: 15
slug: workspace-scaffold-bun-build-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 (pinned at root `package.json:41`) |
| **Config file** | `apps/achilles-terminal/vitest.config.ts` (Wave 0 creates this) |
| **Quick run command** | `npm test --workspace apps/achilles-terminal` |
| **Full suite command** | `npm test --workspace apps/achilles-terminal -- --pool=forks` |
| **Estimated runtime** | ~5-10 seconds (seed suite only; CI matrix is the heavy gate) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace apps/achilles-terminal` (vitest quick, ~5-10s)
- **After every plan wave:** Run `npm run lint --workspace apps/achilles-terminal && npm run typecheck --workspace apps/achilles-terminal && npm test --workspace apps/achilles-terminal -- --pool=forks`
- **Before `/gsd:verify-work`:** Full suite green under both Bun and Node runtimes across {linux, macos, windows} in CI; 5x `bun build --compile` produces 5 binaries that each print `--version`; cold-start latency captured into SUMMARY.md
- **Max feedback latency:** 15 seconds (per-task quick command)

---

## Per-Task Verification Map

> Wave 0 creates the scaffolding; subsequent waves implement against it. Task IDs are placeholders the planner will refine — each row maps a phase requirement to its automated proof.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-W0 | 01 | 0 | DIST-01 | T-15-supply-chain | Package shape publishable; lockfile committed | unit (package.json shape) | `npm pack --dry-run --workspace apps/achilles-terminal` | ❌ W0 | ⬜ pending |
| 15-01-01 | 01 | 1 | DIST-02 | — | Bin shim resolves platform binary; falls through to Node bundle on resolve failure | unit (shim behavior) | `vitest run tests/shim.test.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | DIST-02 | — | `bun build --compile` produces working binaries on 5 targets | integration (build + smoke) | CI: `bun build --compile --target=bun-{platform}` + run `--version` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 1 | DIST-02 | — | esbuild Node bundle produces runnable `dist/main.js` under Node 22 | integration | `node dist/main.js --version` (CI step) | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 2 | DIST-05 | — | Cold-start latency baseline captured (<50ms native / <200ms JS) | manual measurement | `hyperfine --warmup 0 --runs 50 'apps/cli-darwin-arm64/bin/achilles --version'` | ❌ W0 | ⬜ pending |
| 15-04-01 | 04 | 1 | INIT-07 | T-15-silent-launch | `achilles --version` exits 0 without ELEVENLABS_API_KEY | unit | `vitest run tests/cli.test.ts` | ❌ W0 | ⬜ pending |
| 15-05-01 | 05 | 1 | GATE-04 (CI half) | — | Dual-runtime CI matrix green on Bun 1.3+ + Node 22+ across linux/macos/windows | CI gate | The CI workflow itself is the gate; PRs cannot merge red | ❌ W0 | ⬜ pending |
| 15-05-02 | 05 | 1 | GATE-04 (lint half) | T-15-silent-launch | ESLint baseline established; slot for `stdio:"ignore"` ban prepared | lint | `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Wave 0 = files that MUST exist before any test in the verification map can run. Planner will assign these to specific tasks.

- [ ] `apps/achilles-terminal/package.json` — workspace + `bin: { achilles: "./dist/cli.js" }` + `optionalDependencies` for 5 platform siblings + `engines.node: ">=22.0.0"` + ESM `"type": "module"`
- [ ] `apps/achilles-terminal/tsconfig.json` — NodeNext ESM + strict
- [ ] `apps/achilles-terminal/eslint.config.js` — flat config + typescript-eslint + prettier disable; documented slot for Phase 19's `stdio:"ignore"` `no-restricted-syntax` rule
- [ ] `apps/achilles-terminal/vitest.config.ts` — Node env + `pool: "forks"` (forks pool works under both Bun and Node)
- [ ] `apps/achilles-terminal/src/cli.ts` — argv-parse-before-import-side-effects + `--version` + explicit fatal handler (defends against v1.2 silent-launch shape per PITFALLS.md §1)
- [ ] `apps/achilles-terminal/src/shim/cli.shim.js` — 30-line hand-authored ESM JS bin shim; `import.meta.resolve('@achilles/cli-${platform}-${arch}')` → `spawnSync(..., { stdio: "inherit" })`; resolve-failure → dynamic-import `dist/main.js`
- [ ] `apps/achilles-terminal/scripts/build-binaries.mjs` — wraps `bun build --compile` 5x (one per target)
- [ ] `apps/achilles-terminal/scripts/build-node-bundle.mjs` — wraps esbuild to produce `dist/main.js`
- [ ] `apps/achilles-terminal/tests/cli.test.ts` — INIT-07 assertion (exit 0, non-empty version, no `ELEVENLABS_API_KEY` required)
- [ ] `apps/achilles-terminal/tests/shim.test.ts` — DIST-02 shim behavior (mock platform pkg in temp dir → assert shim execs mock; delete mock → assert fallback to Node bundle)
- [ ] `apps/cli-darwin-arm64/package.json` — `name`, `os: ["darwin"]`, `cpu: ["arm64"]`, `files: ["bin/"]`, NO `bin` field
- [ ] `apps/cli-darwin-x64/package.json` — same shape, `os: ["darwin"]`, `cpu: ["x64"]`
- [ ] `apps/cli-linux-x64/package.json` — same shape, `os: ["linux"]`, `cpu: ["x64"]`
- [ ] `apps/cli-linux-arm64/package.json` — same shape, `os: ["linux"]`, `cpu: ["arm64"]`
- [ ] `apps/cli-win32-x64/package.json` — same shape, `os: ["win32"]`, `cpu: ["x64"]`
- [ ] `apps/cli-*/README.md` — 5-line shared template
- [ ] `apps/cli-*/.gitignore` — ignore `bin/` (CI-generated artifacts)
- [ ] `.github/workflows/achilles-terminal-ci.yml` — dual-runtime matrix `{ubuntu-latest, macos-latest, windows-latest} × {bun, node}` + per-OS-native compile matrix (including `ubuntu-22.04-arm` for linux-arm64) running `--version` smoke against each produced binary

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cold-start latency baseline pasted into SUMMARY.md | DIST-05 | Phase 15 captures the baseline manually; persistent `~/.achilles/latency/` JSON arrives Phase 18 | Run `hyperfine --warmup 0 --runs 50 './bin/achilles --version'` on each of the 5 produced binaries; record P50/P95; paste into Phase 15 SUMMARY.md |
| Local-dev `npm install -g` smoke against tarballed packages | DIST-01 | Validates the end-to-end packaging shape before Phase 19 publish; CI publishes ephemerally but the human-loop confirmation lives in the operator's terminal | `npm pack` x6 (parent + 5 siblings); `npm install -g ./achilles-*.tgz`; `which achilles`; `achilles --version` exits 0 |
| Bun installation on developer workstation | (operator setup) | One-time per workstation; documented but not test-gated | `curl -fsSL https://bun.sh/install \| bash` per Bun docs; verify `bun --version >= 1.3.14` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (18 files enumerated above)
- [ ] No watch-mode flags (CI uses `vitest run`, not `vitest`)
- [ ] Feedback latency < 15s for quick command
- [ ] `nyquist_compliant: true` set in frontmatter after planner sign-off

**Approval:** pending
