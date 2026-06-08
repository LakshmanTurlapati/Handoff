---
phase: 15-workspace-scaffold-bun-build-pipeline
verified: 2026-06-08T08:31:50Z
status: human_needed
score: 4/5 must-haves verified, 1 needs human
overrides_applied: 0
gaps:
  - truth: "Dual-runtime CI matrix (Bun + Node 22) is green for the seed test suite; ESLint rule scaffolding in place"
    status: failed
    reason: "Both `npm run typecheck --workspace apps/achilles-terminal` and `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` exit non-zero on a fresh checkout. The CI workflow at `.github/workflows/achilles-terminal-ci.yml` invokes these scripts on every matrix entry (lines 102 and 105) BEFORE running vitest, so every matrix entry will fail before tests execute. The SUMMARYs claim GATE-04 lint/typecheck baseline is locked, but neither command was empirically validated end-to-end against the final on-disk state after Plan 03's added files (scripts/*.mjs, src/shim/cli.shim.js, tests/shim.test.ts, vitest.config.ts) and Plan 04's CI step shape."
    artifacts:
      - path: "apps/achilles-terminal/tsconfig.json"
        issue: "Inherits `declarationMap: true` from tsconfig.base.json line 21 but overrides `declaration: false` at line 19. TypeScript 5.7.3 rejects with `error TS5069: Option 'declarationMap' cannot be specified without specifying option 'declaration' or option 'composite'.` on `tsc -p tsconfig.json --noEmit`."
      - path: "apps/achilles-terminal/tsconfig.json"
        issue: "`rootDir: ./src` (line 18) combined with `include: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs']` (line 25) produces `error TS6059: File '<...>/tests/cli.test.ts' is not under 'rootDir' '.../src'` (and same for tests/shim.test.ts). Either drop rootDir or split into separate src/tests tsconfig projects."
      - path: "apps/achilles-terminal/eslint.config.js"
        issue: "Sets `parserOptions.project: './tsconfig.json'` (line 13) but tsconfig.json's `include` list does NOT cover `eslint.config.js`, `vitest.config.ts`, `src/shim/cli.shim.js`, `scripts/build-binaries.mjs`, or `scripts/build-node-bundle.mjs`. ESLint emits 4 separate `Parsing error: The file was not found in any of the provided project(s)` errors when linting those files. Add a `files: ['src/**', 'tests/**']` filter on the type-checked block or include the config/script files in tsconfig."
      - path: "apps/achilles-terminal/src/cli.ts"
        issue: "Line 90: `(err as Error).message` is flagged `@typescript-eslint/no-unnecessary-type-assertion` because the uncaughtException handler argument is already typed `Error`. Drop the assertion."
      - path: "apps/achilles-terminal/tests/cli.test.ts"
        issue: "Line 29: `JSON.parse(...).version as string` triggers `@typescript-eslint/no-unsafe-member-access` because JSON.parse returns `any`. Cast the parse result first, e.g. `(JSON.parse(...) as { version: string }).version`."
    missing:
      - "Fix tsconfig.json: either set `declaration: true` + `declarationMap: true` consistently OR set `declarationMap: false` to override the base."
      - "Fix tsconfig.json: drop `rootDir` OR move tests into a separate tsconfig.test.json that doesn't enforce rootDir."
      - "Fix eslint.config.js: scope the type-checked block to `files: ['src/**/*.ts', 'tests/**/*.ts']`, OR add an untyped block for `*.mjs` + `*.js` config files."
      - "Fix src/cli.ts line 90: remove the unnecessary `as Error` assertion."
      - "Fix tests/cli.test.ts line 29: type the JSON.parse result before reaching `.version`."
      - "After fixes, re-run `npm run typecheck --workspace apps/achilles-terminal` and `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` and confirm both exit 0."
human_verification:
  - test: "DIST-05 cold-start latency baseline capture via hyperfine"
    expected: "Native Bun-compiled binary P50 < 50ms on darwin-arm64/darwin-x64/linux-x64/linux-arm64/win32-x64; Node 22 JS-fallback bundle P50 < 200ms. Filled table pasted into Phase 15 SUMMARY.md under `## Cold-Start Latency Baseline (DIST-05)`."
    why_human: "Per CLAUDE.md global rule (no auto-run applications) and Plan 04 Task 2 design. The procedure document `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` (207 lines) exists with hyperfine install commands per OS, capture commands per platform, and a 6-row template. Empirical figures must be captured by an operator on the matching native hosts; no automation surface exists in Phase 15 (Phase 18 introduces the persistent `~/.achilles/latency/` JSON store)."
---

# Phase 15: Workspace Scaffold + Bun Build Pipeline Verification Report

**Phase Goal:** Stand up the new `apps/achilles-terminal` workspace + 5 platform-binary sibling packages with a working `bun build --compile` cross-target matrix and a dual-runtime CI matrix (Bun + Node 22) so every subsequent phase catches runtime drift at the boundary it was introduced.

**Verified:** 2026-06-08T08:31:50Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `apps/achilles-terminal` workspace exists with `package.json` declaring `bin: { achilles: "./dist/cli.js" }`, `optionalDependencies` listing all 5 platform packages, and ESM `"type": "module"` | VERIFIED | `apps/achilles-terminal/package.json` line 7 `"type": "module"`, line 9-11 `bin: { achilles: "./dist/cli.js" }`, lines 33-39 list all 5 `@achilles/cli-<plat>-<arch>` siblings at `1.3.0`. D-15-01 deviation (`name` field renamed from `achilles` to `achilles-terminal` to dodge EDUPLICATEWORKSPACE) is documented and the success-criterion `bin: { achilles: ... }` is unchanged. |
| 2 | `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64}` produces a self-contained binary on every target; `achilles --version` runs without API key, sox, or ffmpeg present (INIT-07) | VERIFIED | `scripts/build-binaries.mjs` (109 lines) iterates a 5-entry targets[] array invoking `spawnSync("bun", ["build", entry, "--compile", "--target=" + bunTarget, "--outfile=" + outAbsolute, "--minify"])` per target with `chmod 0o755` post-step. The 5 bunTarget strings (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`) match the success-criterion enumeration exactly. INIT-07 verified empirically: `unset ELEVENLABS_API_KEY && node --import tsx apps/achilles-terminal/src/cli.ts --version` → stdout `1.3.0`, exit 0. CI binary actually-runs smoke gate at `.github/workflows/achilles-terminal-ci.yml` lines 172-194 captures the binary path, executes `--version`, asserts `grep -E '^[0-9]+\.[0-9]+\.[0-9]+'` against stdout (silent-launch defence). |
| 3 | 30-line JS bin shim at `dist/cli.js` resolves the per-platform binary via `optionalDependencies` filtered by `os`/`cpu`; falls through to a Node 22 esbuild bundle (`dist/main.js`) when no platform binary matches (DIST-02) | VERIFIED | `src/shim/cli.shim.js` is 34 lines (10-line header + 24 lines of code) using `import.meta.resolve` to find `@achilles/cli-${process.platform}-${process.arch}/package.json`, `spawnSync` with `stdio: "inherit"` on hit, `await import(pathResolve(HERE, "main.js"))` on miss. Win32 `.exe` suffix branch present at line 24. `tests/shim.test.ts` exercises 5 behaviours (resolve+exec, silent-fallback, exit-code propagation, argv pass-through, win32-only skip) under a mocked workspace; `npm test --workspace apps/achilles-terminal -- --pool=forks` reports 9 passed + 1 skipped (the win32 skipIf branch on POSIX). `scripts/build-node-bundle.mjs` copies the shim to `dist/cli.js` (chmod 0o755) and esbuild-bundles `src/cli.ts` to `dist/main.js` with the 5 voice/bridge/skill workspace packages marked external. |
| 4 | Dual-runtime CI matrix (every test under both `bun test` and `vitest` on Node 22) is green for the seed test suite ported from v1.2; ESLint rule scaffolding in place so Phase 17/19 can wire the `stdio:"ignore"` forbid rule (GATE-04 dual-runtime half) | FAILED | The CI workflow exists and is structurally correct (`.github/workflows/achilles-terminal-ci.yml` 195 lines, 6-entry test matrix + 5-entry compile-binaries matrix, `--include=optional --force` per D-15-02), and vitest seed suite passes locally (9/10 pass on darwin-arm64). BUT the workflow runs `npm run typecheck` (line 102) and `npm run lint` (line 105) BEFORE vitest. Both commands exit non-zero on a fresh checkout (5 typecheck errors, 7 lint errors documented in `gaps:` above). Every CI matrix entry will fail at the typecheck step before vitest is invoked. The `compile-binaries` matrix does not run typecheck/lint so its smoke step would proceed independently, but the GATE-04 dual-runtime half (the `test` job) is broken. |
| 5 | Cold-start latency probe demonstrates <50ms first TUI render on supported native-binary platforms and <200ms on the JS fallback path (DIST-05 baseline measurement) | NEEDS HUMAN | Procedure document `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` exists (207 lines) with hyperfine install commands per OS, capture commands per platform, and a 6-row table template. Empirical capture is operator-managed per Plan 04 Task 2 design + CLAUDE.md global rule against auto-running applications. The `--latency-probe` flag is wired in `src/cli.ts` lines 59-66 (currently emits a near-zero `hrtime` delta as a placeholder pending real TUI in Phase 16). Reroutes to `human_verification` rather than `failed` per verification context. |

**Score:** 3/5 truths verified (1 FAILED, 1 NEEDS HUMAN)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/achilles-terminal/package.json` | Parent manifest with bin, optionalDependencies, ESM | VERIFIED | All required fields present; D-15-01 name deviation documented and out-of-scope for SC #1. |
| `apps/achilles-terminal/tsconfig.json` | NodeNext + ES2024 + verbatimModuleSyntax | EXISTS BUT BROKEN | Inherits `declarationMap: true` from base without `declaration: true`; includes `tests/**/*.ts` outside `rootDir: ./src`. Causes typecheck failure. |
| `apps/achilles-terminal/vitest.config.ts` | pool="forks" | VERIFIED | 17 lines; `pool: "forks"` set (Pitfall 9 defence). |
| `apps/achilles-terminal/eslint.config.js` | Type-checked flat config with Phase 19 rule slot | EXISTS BUT BROKEN | parserOptions.project does not match all linted files; produces 4 parser errors on .mjs/.js config + script files. |
| `apps/achilles-terminal/src/cli.ts` | INIT-07 argv-first + Pitfall 1/5 defences | VERIFIED (functionally) | Argv parse before pipeline imports; uncaughtException + unhandledRejection handlers; stdout.write callback form. Has one lint error at line 90 (unnecessary `as Error`). |
| `apps/achilles-terminal/src/shim/cli.shim.js` | 30-line resolve-then-fallback shim | VERIFIED | 34 source lines, plain ESM JS, win32 `.exe` branch, silent fallback. |
| `apps/achilles-terminal/scripts/build-binaries.mjs` | 5-target bun --compile orchestrator | VERIFIED | 109 lines, 5-entry targets[] array, chmod 0o755 per output, stderr-then-exit on non-zero status. |
| `apps/achilles-terminal/scripts/build-node-bundle.mjs` | esbuild Node 22 ESM bundle + shim copy | VERIFIED | 88 lines, copyFileSync shim → dist/cli.js, esbuild bundle → dist/main.js, banner omitted per D-15-04. |
| `apps/achilles-terminal/tests/cli.test.ts` | 5 INIT-07 assertions | VERIFIED (functionally) | 5 tests, all pass under vitest --pool=forks. Has one lint error at line 29 (no-unsafe-member-access on JSON.parse). |
| `apps/achilles-terminal/tests/shim.test.ts` | DIST-02 resolve + fallback assertions | VERIFIED | 5 tests (4 active + 1 win32 skip on POSIX), all pass. |
| `apps/cli-darwin-arm64/package.json` | os=darwin, cpu=arm64, files=bin/achilles | VERIFIED | 8 fields per RESEARCH.md Pattern 2; no bin, no engines, no deps, no scripts (T-15-supply-chain). |
| `apps/cli-darwin-x64/package.json` | os=darwin, cpu=x64 | VERIFIED | Same shape. |
| `apps/cli-linux-x64/package.json` | os=linux, cpu=x64 | VERIFIED | Same shape. |
| `apps/cli-linux-arm64/package.json` | os=linux, cpu=arm64 | VERIFIED | Same shape. |
| `apps/cli-win32-x64/package.json` | os=win32, cpu=x64, files=bin/achilles.exe | VERIFIED | Same shape, `.exe` suffix per Pitfall 3. |
| `.github/workflows/achilles-terminal-ci.yml` | 6-entry test matrix + 5-entry compile-binaries matrix | EXISTS BUT WILL FAIL ON CI | YAML valid (python3 yaml.safe_load OK). Structurally correct. But `npm run typecheck` + `npm run lint` steps will exit 1 on every matrix entry (see gap above). |
| `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` | DIST-05 hyperfine procedure | VERIFIED | 207 lines, install instructions, capture commands, 6-row table template. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `package.json bin.achilles` | `dist/cli.js` | npm bin field | WIRED (path target produced by build) | `scripts/build-node-bundle.mjs` line 39 + line 45 produces `dist/cli.js` via copyFileSync from `src/shim/cli.shim.js`. Path lines up with `package.json` line 10. |
| `package.json optionalDependencies` | 5 sibling packages | npm install os/cpu filter | WIRED | All 5 sibling packages exist at `apps/cli-*/package.json` with matching `os`/`cpu` filters and version `1.3.0` matching the parent's pin. |
| `dist/cli.js` (shim) | `dist/main.js` (fallback) | `await import(pathResolve(HERE, "main.js"))` | WIRED | shim line 33: `await import(pathResolve(HERE, "main.js"))`. tests/shim.test.ts test 2 verifies fallback fires silently on resolve miss. |
| `dist/cli.js` (shim) | `@achilles/cli-<plat>-<arch>/bin/achilles[.exe]` | `import.meta.resolve` + `spawnSync stdio:inherit` | WIRED | shim lines 21-26 resolve and exec; tests/shim.test.ts test 1 verifies exec path. |
| `scripts/build-binaries.mjs` | 5 sibling `bin/` directories | `mkdirSync + bun build --outfile` | WIRED | script lines 80-94 produce binary at `cli-<plat>-<arch>/bin/achilles[.exe]` matching each sibling's `files` declaration. |
| `.github/workflows/achilles-terminal-ci.yml` test job | `npm run typecheck/lint/test` | `--workspace apps/achilles-terminal` | BROKEN | Workflow step shapes are correct but the downstream npm scripts exit non-zero. See gap. |
| `.github/workflows/achilles-terminal-ci.yml` compile-binaries job | `bun build --compile` + binary smoke | matrix entries per native runner | WIRED (structurally correct) | Per matrix entry: setup-bun@v2 → install → bun build → smoke. The smoke step asserts grep -E semver, breaking on silent-launch shape. Cannot empirically validate cloud-runner behavior locally; that is by design. |

### Data-Flow Trace (Level 4)

Not applicable in the traditional sense — Phase 15 produces CLI infrastructure, not a dynamic-data-rendering UI. The closest analog is the `--version` flow: `package.json:version` field → `readFile(pkgPath)` in `src/cli.ts:49` → `JSON.parse` → `process.stdout.write`. Verified end-to-end (`node --import tsx src/cli.ts --version` → `1.3.0`).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| INIT-07: `--version` exits 0 with no API key | `unset ELEVENLABS_API_KEY && node --import tsx apps/achilles-terminal/src/cli.ts --version` | stdout `1.3.0`, exit 0 | PASS |
| Vitest seed suite passes under fork pool | `npm test --workspace apps/achilles-terminal -- --pool=forks` | 9 passed + 1 skipped in 1.14s | PASS |
| TypeScript typecheck passes | `npm run typecheck --workspace apps/achilles-terminal` | 3 errors (TS5069 + 2x TS6059), exit 2 | FAIL |
| ESLint passes | `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` | 7 errors (4 parser, 2 type-checked, 1 unsafe-access), exit 1 | FAIL |
| CI YAML parses | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/achilles-terminal-ci.yml'))"` | exit 0 | PASS |
| LOOP-02 invariant: no voice/bridge imports in src/tests | `grep -rE "from ['\"]@?achilles/(voice-protocol\|voice-stt\|voice-tts\|claude-code-bridge\|achilles-skill)" apps/achilles-terminal/src/ apps/achilles-terminal/tests/` | 0 matches | PASS |
| Emoji invariant | `grep -P "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" -r apps/achilles-terminal/ apps/cli-*/ .github/workflows/achilles-terminal-ci.yml` | 0 matches | PASS |
| Bun build smoke (compile + run) | Not run by verifier — CI matrix invokes on 5 native runners. Script invocation shape confirmed correct via static read. | Static-read only; cloud-validated on push | SKIP (CI-owned) |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared by phase. Phase 15 uses vitest as its primary executable verification and a CI-side bun-smoke as the binary gate. Both surfaces evaluated above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DIST-01 | 15-01 | `npm install -g achilles` works | SATISFIED (structurally) | `package.json` shape per spec; `bin.achilles` → `dist/cli.js`; full install-path validation deferred to Phase 19 publish smoke. |
| DIST-02 | 15-02, 15-03 | Per-platform binary auto-select via optionalDependencies + JS shim fallback | SATISFIED | 5 sibling packages with os/cpu filters; 30-line shim; 5 vitest assertions in tests/shim.test.ts (9/10 pass total). |
| DIST-05 | 15-04 | Cold-start P50 < 50ms native, < 200ms JS-fallback | NEEDS HUMAN | Procedure exists at 15-04-LATENCY-CAPTURE.md; empirical capture deferred to operator. |
| INIT-07 | 15-01 | `--version` works without API key/sox/ffmpeg | SATISFIED | 5 vitest assertions pass; manual reproduction with `unset ELEVENLABS_API_KEY` returns `1.3.0` exit 0. |
| GATE-04 (Phase 15 half) | 15-01 (lint baseline), 15-04 (CI matrix) | ESLint rule scaffolding + Bun/Node dual-runtime CI matrix green | BLOCKED | ESLint config has parser-project mismatch causing 4 errors; cli.ts has 1 unnecessary-assertion error; tests/cli.test.ts has 1 unsafe-access error. tsconfig has declarationMap + rootDir misconfig causing 3 typecheck errors. CI matrix step shape is correct but will fail at typecheck step on every entry. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/achilles-terminal/tsconfig.json` | 9 (declaration), 19 (declarationMap via base) | Conflicting compiler option overrides | BLOCKER | TS5069 error stops typecheck. |
| `apps/achilles-terminal/tsconfig.json` | 18 (rootDir), 25 (include) | rootDir conflicts with include glob | BLOCKER | TS6059 error stops typecheck. |
| `apps/achilles-terminal/eslint.config.js` | 11-15 (languageOptions.parserOptions) | parserOptions.project does not cover all linted files | BLOCKER | 4 parser errors block lint --max-warnings 0. |
| `apps/achilles-terminal/src/cli.ts` | 90 | Unnecessary `as Error` assertion on already-typed parameter | BLOCKER | `@typescript-eslint/no-unnecessary-type-assertion` fails lint. |
| `apps/achilles-terminal/tests/cli.test.ts` | 29 | `JSON.parse(...).version as string` unsafe-member-access | BLOCKER | `@typescript-eslint/no-unsafe-member-access` fails lint. |

No TBD/FIXME/XXX debt markers found. No `stdio: "ignore"` references. No emoji glyphs. LOOP-02 invariant clean (the 4 `voice-*` strings in `scripts/build-node-bundle.mjs` are esbuild `external:` markers, NOT imports — verified by grep of actual import/from statements returning 0 matches in src/ and tests/).

### Human Verification Required

#### 1. DIST-05 Cold-Start Latency Capture

**Test:** Operator runs the hyperfine capture procedure documented at `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-04-LATENCY-CAPTURE.md` on the available native hosts (darwin-arm64 minimum; ideally also darwin-x64, linux-x64, linux-arm64, win32-x64). Hyperfine is installed via the OS-appropriate command (brew/cargo/apt/winget/scoop). The 5 platform binaries are produced via `npm run build:binaries` (which requires bun on PATH). The Node 22 JS-fallback bundle is produced via `npm run build`. Per-platform capture commands run cold (sudo purge / drop_caches) and warm-steady variants. Hyperfine JSON output is parsed for P50/P95 percentiles. The 6-row table template is filled in and pasted into the eventual Phase 15 SUMMARY.md under `## Cold-Start Latency Baseline (DIST-05)`.

**Expected:** Native Bun-compiled binary P50 < 50ms per platform; Node 22 JS-fallback bundle P50 < 200ms. If a capture exceeds its target, the figure is recorded with host details and surfaced as a tech-debt entry rather than a phase failure (per 15-04-LATENCY-CAPTURE.md §1).

**Why human:** Per CLAUDE.md global rule against auto-running applications, and per Plan 04 Task 2 design which makes this a `checkpoint:human-verify` gate. No automation surface exists in Phase 15; the persistent `~/.achilles/latency/` JSON store arrives in Phase 18 alongside the init wizard. The procedure document was written specifically because empirical capture must happen on the operator's matching native hosts.

### Gaps Summary

Phase 15 delivers 4 of 5 success criteria substantively:
- Workspace identity locked (SC #1)
- Bun cross-compile orchestrator + INIT-07 wired (SC #2)
- DIST-02 shim + fallback verified end-to-end (SC #3)
- DIST-05 procedure document landed (SC #5 — needs operator capture)

But success criterion #4 (GATE-04 dual-runtime CI matrix green) **does not hold in the current codebase**. The CI workflow is structurally correct but invokes two npm scripts (`typecheck`, `lint`) that exit non-zero on every entry due to:

1. **tsconfig misconfiguration** (2 categories of error: declarationMap-without-declaration, rootDir-vs-tests-include)
2. **eslint parser-project misconfiguration** (4 config/script files outside the type-checked project)
3. **Code-level lint violations** (one in `src/cli.ts` line 90, one in `tests/cli.test.ts` line 29)

These are all observable on a clean checkout via `npm run typecheck --workspace apps/achilles-terminal` and `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0`. The 9-test vitest suite passes only because the workflow runs typecheck and lint BEFORE vitest — meaning on actual CI runs, vitest will never execute. The GATE-04 "dual-runtime CI matrix green" claim cannot be substantiated without these fixes.

Recommended remediation is a single follow-up plan that:
1. Fixes the 3 tsconfig issues (override declarationMap, drop rootDir or split tsconfig.test.json).
2. Fixes the eslint.config.js parser-project scoping.
3. Removes the unnecessary `as Error` cast in cli.ts:90.
4. Refactors the JSON.parse call site in tests/cli.test.ts:29 to satisfy no-unsafe-member-access.
5. Re-runs `npm run typecheck` + `npm run lint` to confirm both exit 0.

Once the test job is structurally green locally, the CI matrix will exercise the same shape on each push and the GATE-04 dual-runtime half can be claimed.

The remaining outstanding item (DIST-05 hyperfine capture) is orthogonal — it is operator-managed by design and routes through `human_verification`.

---

_Verified: 2026-06-08T08:31:50Z_
_Verifier: Claude (gsd-verifier)_

---

## Re-verification Update (2026-06-08, post-fix)

Orchestrator applied 5 inline fixes from the gaps list above (commit `f52364af`):
- tsconfig.json — set `declarationMap: false` to override base; change `rootDir: ./src` → `rootDir: .`
- eslint.config.js — scope `recommendedTypeChecked` to `src/**+tests/**`; add untyped recommended for `.mjs/.js` config + scripts
- src/cli.ts:90 — drop redundant `as Error` cast
- tests/cli.test.ts:29 — cast `JSON.parse` result before `.version` access

Empirical re-verification:
- `npm run typecheck --workspace apps/achilles-terminal` → exit 0 (clean)
- `npm run lint --workspace apps/achilles-terminal` → exit 0 (clean)
- `npm test --workspace apps/achilles-terminal` → 9 passed + 1 skipped (1.49s)

GATE-04 dual-runtime CI matrix can now run end-to-end on cloud CI.

**Updated status:** `human_needed` — the only outstanding item is DIST-05 hyperfine cold-start latency capture (operator-managed per Plan 04 Task 2 design + CLAUDE.md no-auto-run rule). Procedure document at `15-04-LATENCY-CAPTURE.md` is ready for operator execution.
