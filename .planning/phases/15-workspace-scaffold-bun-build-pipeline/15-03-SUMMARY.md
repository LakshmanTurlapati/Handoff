---
phase: 15-workspace-scaffold-bun-build-pipeline
plan: 03
subsystem: infra
tags: [bun, esbuild, bin-shim, optionalDependencies, cross-compile, vitest]

requires:
  - phase: 15-01
    provides: apps/achilles-terminal workspace (package.json, src/cli.ts, tsconfig, vitest.config, eslint baseline)
  - phase: 15-02
    provides: 5 platform-binary sibling packages (apps/cli-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}) with package.json os/cpu filters
provides:
  - "30-line ESM JS bin shim (apps/achilles-terminal/src/shim/cli.shim.js) — install-time + runtime contract between parent achilles package and the 5 platform-binary siblings"
  - "build-binaries.mjs: cross-compile orchestrator wrapping `bun build --compile` 5x with post-build chmod 0o755"
  - "build-node-bundle.mjs: esbuild Node 22 ESM wrapper producing dist/main.js + materializing dist/cli.js from the shim source"
  - "DIST-02 vitest assertion (tests/shim.test.ts): 4 active tests + 1 win32 skip covering resolve, fallback, exit-code, argv pass-through"
affects: [15-04 CI matrix, 17-voice-loop (workspace external deps will be wired here), 19-publish (npm pack drives off these dist artifacts)]

tech-stack:
  added: [esbuild@0.28.0 (already pinned in 15-01)]
  patterns:
    - "ESM bin shim resolving @achilles/cli-<platform>-<arch>/package.json via import.meta.resolve sync (Node 22+/Bun 1.3+)"
    - "esbuild banner shebang OMITTED for dist/main.js (deviation D-15-04) — dynamic-import target, never bin entry"
    - "build-time copy of hand-authored shim from src/shim/cli.shim.js to dist/cli.js (bin entry materialization step)"
    - "Greppable targets[] array enumerating Bun --target strings (bun-darwin-arm64..bun-windows-x64) vs Node process.platform output directory names (cli-darwin-arm64..cli-win32-x64)"

key-files:
  created:
    - apps/achilles-terminal/src/shim/cli.shim.js
    - apps/achilles-terminal/tests/shim.test.ts
    - apps/achilles-terminal/scripts/build-binaries.mjs
    - apps/achilles-terminal/scripts/build-node-bundle.mjs
  modified: []

key-decisions:
  - "Shim hand-authored as plain ESM JS (.js) rather than .ts compiled by tsc — preserves the 30-line readability invariant per RESEARCH.md Open Question #1; the file is short enough to review-by-line and the .js extension means no TS toolchain dependency at the most critical 30 lines"
  - "esbuild banner shebang dropped (D-15-04) — combined with src/cli.ts's own shebang it produced a duplicate-shebang ESM parse error; the bin entry shebang lives on dist/cli.js (the shim), dist/main.js is only imported"
  - "Mock workspace pattern under os.tmpdir() for the shim test (mirrors apps/achilles-cli/src/electron-binary-locator.test.ts analog per PATTERNS.md) — afterEach rmSync teardown, 5 created dirs tracked across tests"

patterns-established:
  - "Build-time shim materialization: hand-authored src/shim/cli.shim.js -> dist/cli.js via copyFileSync + chmod 0o755 in build-node-bundle.mjs, NOT through tsc emit (tsc compiles the typed cli.ts; the shim is plain JS and bypasses tsc entirely)"
  - "Bun --target vs output dir naming: target strings use Bun's nomenclature (bun-windows-x64) while output directories use Node's process.platform values (cli-win32-x64) since the shim's import.meta.resolve interpolates the Node-side name at runtime"
  - "Silent-fallback shim catch block: no stderr logging on resolve failure — the fallback path is intentional behaviour, not an error (defended by tests/shim.test.ts test 2 asserting stderr === '')"

requirements-completed: [DIST-02]

duration: 6min
completed: 2026-06-08
---

# Phase 15 Plan 03: bun shim + build pipeline Summary

**Hand-authored 30-line ESM bin shim resolving @achilles/cli-<platform>-<arch> via import.meta.resolve, plus build-binaries.mjs (bun --compile 5x) and build-node-bundle.mjs (esbuild Node 22 ESM fallback with shim copy step)**

## Performance

- **Duration:** ~6 min (single sitting; both tasks executed sequentially)
- **Started:** 2026-06-08T03:12:00Z (approx)
- **Completed:** 2026-06-08T03:17:23Z
- **Tasks:** 2 of 2
- **Files created:** 4
- **Files modified:** 0

## Accomplishments

- 30-line ESM bin shim (34 source lines incl. 10-line header) live at apps/achilles-terminal/src/shim/cli.shim.js, exercising import.meta.resolve sync return form (Node 22+/Bun 1.3+) with explicit Pitfall 3 .exe-suffix branch
- 5-target greppable cross-compile orchestrator (build-binaries.mjs) wrapping `bun build --compile` with Pitfall 4 chmod 0o755 propagation
- esbuild Node 22 ESM wrapper (build-node-bundle.mjs) producing dist/main.js (5 workspace voice/bridge/skill deps marked external) AND copying the shim to its production dist/cli.js bin location
- DIST-02 assertion (tests/shim.test.ts) — 4 active tests covering resolve-when-present, silent-fallback-when-missing, exit-code propagation, and argv pass-through; 1 win32-only skip on POSIX hosts
- Full workspace test suite is green: 9 passed + 1 skipped (vitest run, pool=forks)
- End-to-end smoke: `node apps/achilles-terminal/dist/cli.js --version` prints `1.3.0` (shim resolves no platform binary on this dev host, falls through to dist/main.js, which prints the version from package.json) — INIT-07 invariant preserved through the dist layer

## Task Commits

1. **Task 1: 30-line ESM bin shim + DIST-02 vitest assertion** — `f420fac1` (feat)
2. **Task 2: build-binaries.mjs + build-node-bundle.mjs** — `8e520d10` (feat)

## Files Created/Modified

- `apps/achilles-terminal/src/shim/cli.shim.js` — 34-line plain-ESM-JS bin shim; import.meta.resolve walks @achilles/cli-${process.platform}-${process.arch}/package.json, spawnSync stdio:inherit on hit, dynamic-import dist/main.js on miss
- `apps/achilles-terminal/tests/shim.test.ts` — vitest spec materializing a mock workspace under os.tmpdir() (dist/cli.js copy + node_modules/@achilles/cli-${platform}-${arch}/bin/achilles mock with chmod 0o755); 5 describe blocks (4 active + 1 win32 skipIf)
- `apps/achilles-terminal/scripts/build-binaries.mjs` — Node 22 stdlib orchestrator iterating a 5-entry targets[] array; each entry has bunTarget (Bun's enum: bun-darwin-arm64..bun-windows-x64) and outRelative (Node's enum: cli-darwin-arm64..cli-win32-x64/achilles.exe); spawnSync `bun build --compile --target=... --outfile=... --minify`, chmod 0o755 on success, stderr+exit on non-zero status
- `apps/achilles-terminal/scripts/build-node-bundle.mjs` — esbuild wrapper: step 1 copy src/shim/cli.shim.js -> dist/cli.js and chmod 0o755; step 2 esbuild.build over src/cli.ts producing dist/main.js (platform:node, target:node22, format:esm, sourcemap:linked, legalComments:linked) with the 5 workspace voice/bridge/skill packages marked external

## Decisions Made

- **Shim hand-authored as .js (not .ts)** — per RESEARCH.md Open Question #1 + PATTERNS.md "No Analog Found" guidance: this is the most critical 30 lines of the whole package, so it gets reviewed by line. A TS source would add a tsc-emit step between the source-of-truth and the dist artifact for no readability gain.
- **esbuild banner shebang omitted** — see D-15-04 below.
- **Mock workspace under os.tmpdir()** — vs in-tree fixtures. Cleaner teardown (single rmSync covers everything), no risk of test artifacts polluting node_modules, mirrors the existing apps/achilles-cli/src/electron-binary-locator.test.ts analog called out in PATTERNS.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] esbuild banner shebang produced duplicate-shebang ESM parse error**

- **Found during:** Task 2 (running `node scripts/build-node-bundle.mjs` to verify dist/main.js works)
- **Issue:** RESEARCH.md Pattern 4 (line 411) prescribes `banner: { js: "#!/usr/bin/env node" }` in the esbuild config. But src/cli.ts already begins with its own shebang line (preserved from Plan 01 Task 1). esbuild bundles the source body verbatim, so the produced dist/main.js had `#!/usr/bin/env node` on lines 1 AND 2 — line 1 from the banner, line 2 from the bundled cli.ts shebang. When the shim's `await import(pathResolve(HERE, "main.js"))` parses dist/main.js as ESM, the second `#!` is not at column 0 of line 1 and the V8 parser rejects it with `SyntaxError: Invalid or unexpected token`.
- **Fix:** Removed the `banner` key from esbuild.build options. The shebang stays on dist/cli.js (the bin entry — the shim itself, copied from src/shim/cli.shim.js which carries the shebang on line 1). dist/main.js is only ever dynamically imported from the shim, so no shebang is needed in the bundle.
- **Files modified:** apps/achilles-terminal/scripts/build-node-bundle.mjs (added an explanatory comment block at the removed banner location)
- **Verification:** After fix, `node apps/achilles-terminal/dist/cli.js --version` prints `1.3.0` and exits 0; `head -3 dist/main.js` shows only one shebang on line 1 (from the bundled src/cli.ts source).
- **Committed in:** `8e520d10` (Task 2 commit)
- **Tracked as:** D-15-04 in the plan-DEVIATIONS register (Wave 1 had D-15-01..D-15-03; this is the first Wave 2 deviation)

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** The fix preserves the spirit of RESEARCH.md Pattern 4 — the bin entry (dist/cli.js, the shim) still has its shebang. Only the dynamically-imported fallback bundle drops the (incorrect) duplicate. Phase 19 (publish) is unaffected: npm's bin-link mechanism reads the parent package.json's `bin` field (which points to dist/cli.js, which has the shebang).

### Observation (not a deviation): LOOP-02 grep pattern in scripts/

The plan's verification line `grep -rE "voice-protocol|voice-stt|voice-tts|claude-code-bridge|companion.md" apps/achilles-terminal/src/ apps/achilles-terminal/scripts/ returns 0 lines` (PLAN.md line 305) is in tension with RESEARCH.md Pattern 4 (line 403-409) which explicitly mandates listing `@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/claude-code-bridge`, `@achilles/achilles-skill` in the esbuild `external` array. These are STRING LITERALS in a configuration array — NOT imports of those modules. Phase 15's src/cli.ts imports none of them (verified: `grep -rE "voice|bridge|companion" apps/achilles-terminal/src/` returns 0 lines). The LOOP-02 invariant ("byte-for-byte preserved upstream packages") is not violated by listing the package NAMES in a build-config external array. The plan's verification grep is overly broad and was followed per RESEARCH.md Pattern 4 (the mandated content). No code change required; flagged here so the next plan or wave reviewer doesn't read the grep result as a violation.

## Issues Encountered

- **No node_modules in the worktree at start.** Both root and apps/achilles-terminal/ lacked node_modules. The worktree shares the main repo's filesystem layout (Bash CWD is the worktree, but `node` and `npm` walk up to the root node_modules). `npm test --workspace apps/achilles-terminal` worked without an install step because the parent repo's install (Wave 1 D-15-02 with `--include=optional --force`) had already populated node_modules at the main repo root — vitest/tsx/esbuild resolved from there. No D-15-02 re-trigger required.

## Threat Flags

None — Task 1 and Task 2 touch only the shim and build-script files. The threat model in PLAN.md (T-15-supply-chain, T-15-silent-launch, T-15-cross-platform-path) is unchanged: the shim's `stdio: "inherit"` (T-15-silent-launch mitigation), the win32 .exe-suffix branch (T-15-cross-platform-path mitigation), and the absence of any postinstall script (T-15-supply-chain mitigation) are all preserved in the implementation as written.

## User Setup Required

None — no external service configuration introduced. The CI side (oven-sh/setup-bun, dual-runtime matrix) arrives in Plan 04.

## Next Phase Readiness

- **Plan 04 ready:** the four files this plan produces are exactly what Plan 04's `.github/workflows/achilles-terminal-ci.yml` will exercise on the matrix runners — `npm test`, `npm run build`, and `npm run build:binaries` all have working implementations now. Plan 04 must use `npm ci --include=optional --force` per Wave 1 D-15-02.
- **Phase 17 ready:** the esbuild `external` array in build-node-bundle.mjs already lists the 5 workspace packages Phase 17 will wire (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`, `achilles-skill`). When Phase 17 adds `import` statements to src/cli.ts, the bundle's external boundary is already in place.
- **Phase 19 ready:** the bin-link contract is locked. The parent's `bin: { achilles: "./dist/cli.js" }` field, dist/cli.js shim (copied from src/shim/cli.shim.js), dist/main.js Node bundle, and the 5 sibling packages with their `os`/`cpu` filters compose the full v1.3 distribution shape. Phase 19's `npm publish` will pack and ship without further structural changes.

## Self-Check: PASSED

- `apps/achilles-terminal/src/shim/cli.shim.js` — FOUND
- `apps/achilles-terminal/tests/shim.test.ts` — FOUND
- `apps/achilles-terminal/scripts/build-binaries.mjs` — FOUND
- `apps/achilles-terminal/scripts/build-node-bundle.mjs` — FOUND
- Commit `f420fac1` (Task 1) — FOUND in git log
- Commit `8e520d10` (Task 2) — FOUND in git log

---
*Phase: 15-workspace-scaffold-bun-build-pipeline*
*Completed: 2026-06-08*
