# Phase 15: Workspace Scaffold + Bun Build Pipeline — Research

**Researched:** 2026-06-08
**Domain:** Monorepo scaffolding + Bun `bun build --compile` cross-target matrix + npm `optionalDependencies` platform-binary distribution pattern + 30-line ESM JS bin shim + dual-runtime CI matrix (Bun 1.3+ AND Node 22+) + ESLint baseline + INIT-07 (`achilles --version`) cold-start probe
**Confidence:** HIGH for scaffold mechanics, Bun cross-compile flags, optionalDependencies pattern (esbuild precedent), dual-runtime CI shape (well-trodden). MEDIUM for `import.meta.resolve` behavior under Bun `--compile` (documented but requires smoke verification). MEDIUM for asset-embed pattern under Bun compile (only relevant Phase 17+; Phase 15 ships `--version` which doesn't need companion.md embed).

## Summary

Phase 15 stands up a parallel-safe new workspace (`apps/achilles-terminal/`) plus five sibling platform-binary packages (`apps/cli-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}/`) under the existing root npm workspaces glob (`apps/*` already covered). It wires a `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64}` cross-target matrix that emits self-contained binaries (each ~60-100 MB) into the respective sibling package's `bin/` directory, plus an `esbuild` Node 22+ ESM bundle (`dist/main.js`) for the JS fallback path, plus a 30-line ESM JS bin shim (`dist/cli.js`) that prefers a `optionalDependencies`-resolved platform binary and falls back to importing the Node bundle. A dual-runtime GitHub Actions matrix runs `vitest` under both Bun 1.3.14+ AND Node 22 LTS so runtime drift surfaces at the boundary it was introduced. INIT-07 (`achilles --version`) ships as the seed argv-parse-before-pipeline-boot path that needs zero API key, zero sox, zero ffmpeg — and the same path doubles as the cold-start latency probe (manual capture into the SUMMARY for Phase 15; persistent `~/.achilles/latency/` JSON arrives Phase 18). The phase touches NOTHING in `packages/voice-protocol|voice-stt|voice-tts|claude-code-bridge|achilles-skill` (LOOP-02 byte-for-byte invariant).

**Primary recommendation:** Build the workspace additively — `apps/achilles-terminal/` lives alongside the still-shipping `apps/achilles/` Electron tree and `apps/achilles-cli/` shim through Phase 18; both delete in Phase 19. Use `npm workspaces` exclusively (no migration to pnpm/bun-workspaces). Use a single `tsc --noEmit` typecheck pass + `bun build --compile` per platform + one `esbuild` Node bundle. The bin shim uses `import.meta.resolve()` (Node 22+ stable, Bun 1.3+ supports it) wrapped in try/catch with a directory-join fallback for installer layouts where resolve fails (pnpm symlinks, monorepo dev). Dual-runtime CI: one matrix job per `{runtime: [bun, node22], os: [ubuntu, macos, windows]}` running the seed `cli.test.ts` (asserts `achilles --version` prints a version string).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pre-locked architecture (from research, NOT grey areas):**
- Runtime: Bun 1.3.14+ primary, Node 22 LTS fallback (STACK.md HIGH-confidence pick)
- TypeScript: ESM-only with NodeNext module resolution + `.js` import specifiers
- Workspace tooling: existing npm workspaces (no migration to pnpm/bun workspaces — additional risk for no v1.3 benefit)
- Test runner: vitest under both Bun and Node (defer Bun's `bun test` to v1.4)
- Build tooling: `tsc` for typecheck + `bun build` for compile-binary + `esbuild` for Node-fallback bundle
- Bin shim layout: per ARCHITECTURE.md — ESM JS file at `dist/cli.js`, resolves `@achilles/cli-<platform>-<arch>` via `import.meta.resolve`, spawns it or falls through to Node bundle
- New workspace path: `apps/achilles-terminal/` (NOT `apps/achilles` to avoid colliding with the soon-to-be-deleted Electron app; both coexist until Phase 19 publish-then-cut)

**LOOP-02 project invariant:**
- `packages/voice-protocol`, `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge` MUST stay byte-for-byte unchanged across the entire milestone. Phase 15 must not touch them.
- `packages/achilles-skill/skill/prompts/companion.md` stays byte-for-byte identical. Phase 15 must not touch it.

### Claude's Discretion

All implementation choices are at Claude's discretion — pure infrastructure phase per smart-discuss infrastructure detection. Use ROADMAP phase goal, success criteria, and the locked architecture from `.planning/research/v1.3-terminal-pivot.md` + `.planning/research/STACK.md` + `.planning/research/ARCHITECTURE.md` to guide decisions.

### Deferred Ideas (OUT OF SCOPE)

- Migrating away from npm workspaces — out of scope for v1.3; current pattern works
- Bun's native `bun test` runner — deferred to v1.4 (would require fixture rewrites for no v1.3 benefit)
- `apps/cli-<platform>-<arch>` directory naming vs `packages/cli-<platform>-<arch>` — research recommendation is `apps/` (distribution artifacts, not libraries); coin-flip but locked here for consistency
- Pre-publish dry runs to verify npm tarball contents — handled in Phase 19 alongside the actual publish

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIST-01 | User can install Achilles globally via `npm install -g achilles` or invoke ad-hoc via `bunx achilles voice` without prior install | Phase 15 publishes a stable bin layout (`bin: { "achilles": "./dist/cli.js" }`) + ESM type + `engines.node: ">=22"` + workspace internal dependency wire-up. Actual publish is Phase 19; Phase 15 enables it by ensuring the package shape is publishable. |
| DIST-02 | Per-platform Bun-compiled binary auto-selected via `optionalDependencies`; pure-JS bin shim falls back to bundled Node entrypoint | Phase 15 IS this requirement's core deliverable: the 5 sibling packages, the `optionalDependencies` + `os`/`cpu` filter wiring, the 30-line shim, the `bun build --compile --target=...` matrix, the esbuild Node fallback bundle. |
| DIST-05 | Cold-start latency from skill body invocation to first TUI render is <50ms native / <200ms JS fallback | Phase 15 establishes the baseline by shipping `achilles --version` (argv parse → version print, no pipeline boot). Manual capture: hyperfine or `time` wrapping the binary 100x; record P50/P95 to the SUMMARY. Persistent latency JSON to `~/.achilles/latency/` arrives in Phase 18 alongside `latency-probe.ts` port. |
| INIT-07 | `achilles --version` works without API key, sox, or ffmpeg (argv parse precedes any pipeline boot) | Phase 15 ships this as the seed CLI surface — `cli.ts` argv parse switches on `--version`/`-v` and prints package.json `version` before any other module is imported. The test surface for Phase 15 is exactly this assertion. |
| GATE-04 | ESLint rule forbidding `stdio: "ignore"` on the launch path; Bun 1.3+ + Node 22+ dual-runtime CI matrix runs the full vitest suite green on every commit | Phase 15 ships the dual-runtime CI matrix half of GATE-04 (the `stdio:"ignore"` lint rule is a Phase 19 concern when the launch-path code exists; Phase 15 scaffolds the config slot for it via typescript-eslint baseline). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Workspace scaffolding | Build tooling | npm workspaces | Pure build-time concern. Adds new directories under the existing `apps/*` workspace glob. |
| `bun build --compile` per-platform binaries | Build tooling (Bun) | CI matrix (GitHub Actions) | Build runs on native-OS runner per target (avoids cross-host icon-flag limitations). Output is a static artifact deposited into the sibling platform package. |
| Bin shim resolution at install time | npm install (resolver) | Filesystem | `optionalDependencies` + `os`/`cpu` keys cause the resolver to skip non-matching siblings. Same install-time behavior under npm, bun install, pnpm. |
| Bin shim resolution at runtime | Node interpreter (shim) | child_process exec | The shim itself runs under whatever interpreter started it (Node from npm bin entry; Bun if `bunx`). It uses `import.meta.resolve` then exec's the platform binary. |
| Compiled binary execution | Bun runtime (embedded) | n/a | `bun build --compile` embeds the Bun runtime into the binary itself — runs without a system Bun install. |
| Node fallback bundle execution | Node 22+ runtime | n/a | esbuild Node-ESM bundle runs under the user's installed `node`; cold start ~50-80ms. |
| Vitest test execution | Test runner (vitest) | Bun runtime OR Node runtime | Same suite runs under both via the dual-runtime CI matrix. |
| Typecheck | tsc | n/a | `tsc -p . --noEmit`. Bun does NOT typecheck; tsc is the source of type truth. |
| ESLint baseline | eslint + typescript-eslint | prettier (disable conflicts) | Per-workspace `.eslintrc` extends typescript-eslint recommended + disables format rules that conflict with prettier. Rule slot exists for the Phase 19 `stdio:"ignore"` ban. |
| Latency probe (Phase 15 scope only) | manual measurement | hyperfine / `time` | Phase 15 captures cold-start manually; persistent JSON probe arrives Phase 18 with `latency-probe.ts` port. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.14+ `[VERIFIED: npm registry]` `[CITED: bun.com/docs/bundler/executables]` | Primary runtime + `bun build --compile` cross-compile + `bun install` workspace fanout | Cross-compile stable since Bun 1.1.5 (May 2024); Windows ARM64 added 1.3.10; current 1.3.14 (June 2026). The compiled binary embeds the Bun runtime — runs on user machines without any Bun install. |
| Node.js | 22.x LTS `[CITED: nodejs.org/en/about/previous-releases]` | Source-compat fallback runtime + esbuild ESM bundle target + tsc host | Node 22 LTS until Apr 2027. Native WebSocket Web API stable. Floor for the shim's fallback path. Workspace pins `engines.node: ">=22.0.0"` (matches existing `apps/achilles-cli/package.json` line 20). |
| TypeScript | 5.7.3 `[VERIFIED: matches root devDependencies]` | Strict typecheck + ESM emit (NodeNext, `.js` import specifiers) | Pinned at root in `package.json:40`. Bun does NOT typecheck — `tsc -p . --noEmit` is the CI gate. |
| esbuild | 0.28.0 `[VERIFIED: npm registry]` `[CITED: esbuild.github.io]` | Node 22+ ESM fallback bundle (`dist/main.js`) | Bundles the TS source to a single JS file the shim can `import()` when no platform binary matches. Faster than tsc-emit + small enough to ship in the parent tarball. |
| vitest | 2.1.8 `[VERIFIED: matches root devDependencies]` | Unit test runner under both Bun and Node | Pinned at root in `package.json:41`. Bun's vitest adapter is stable; Bun's native `bun test` is deferred to v1.4. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint | 10.4.1 `[VERIFIED: npm registry]` | Workspace `.eslintrc` baseline; future home for `stdio:"ignore"` ban | Phase 15 establishes the config; Phase 19 adds the `no-restricted-syntax` rule that catches `stdio: "ignore"` on launch paths. |
| typescript-eslint | 8.60.1 `[VERIFIED: npm registry]` | TypeScript rules (replaces `@typescript-eslint/*` packages with the unified `typescript-eslint` namespace) | Modern (2024+) unified package. Use the `recommended-type-checked` config. |
| eslint-config-prettier | 10.1.8 `[VERIFIED: npm registry]` | Disables ESLint rules that conflict with prettier formatting | Standard "let prettier own formatting" pattern. Extends last in `.eslintrc.json`. |
| commander | 13.1.0 `[VERIFIED: matches apps/achilles-cli/package.json line 32]` | Subcommand router (Phase 15 only registers `--version` + a stub `voice` subcommand) | Already the v1.2 CLI choice; survives the cli.ts merge. STACK.md §Supporting locks this in. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| npm workspaces | pnpm workspaces / bun workspaces | Locked OUT per CONTEXT.md. Migration cost > v1.3 benefit. |
| bun build --compile | yao-pkg / Node SEA (`--build-sea`) | Bun is the primary v1.3 runtime (cold-start ~15ms vs ~60ms). yao-pkg useful as v1.4 fallback only if a hard native-module dep emerges that breaks Bun. |
| esbuild for Node fallback | tsc-emit + bundling separately | esbuild produces a single-file ESM bundle the shim can `import()` cleanly. Faster, smaller output. |
| vitest | bun test (native) | Deferred to v1.4 per CONTEXT.md (would require fixture rewrites). |
| typescript-eslint (unified) | @typescript-eslint/parser + @typescript-eslint/eslint-plugin (legacy split) | Unified package is the 2024+ standard; one dep instead of two. |
| import.meta.resolve | require.resolve | `import.meta.resolve` is the native ESM equivalent, stable in Node 22+ and Bun 1.3+. ESM-only workspace cannot use `require.resolve` cleanly. |

**Installation (Phase 15 workspace):**
```bash
# Inside apps/achilles-terminal/
npm install --save-dev typescript@5.7.3 vitest@2.1.8 esbuild@0.28.0 \
                       eslint@10.4.1 typescript-eslint@8.60.1 \
                       eslint-config-prettier@10.1.8 \
                       @types/node@22.10.5

npm install commander@13.1.0
# Workspace internal deps wired in Phase 17 (not 15):
#   @achilles/voice-protocol, voice-stt, voice-tts, claude-code-bridge, achilles-skill
```

**Version verification:** All five core dev packages confirmed against the npm registry on 2026-06-08:
- `bun@1.3.14` (registry) — confirms STACK.md pin
- `esbuild@0.28.0` (registry)
- `eslint@10.4.1` (registry)
- `typescript-eslint@8.60.1` (registry) — unified package
- `eslint-config-prettier@10.1.8` (registry)

TypeScript 5.7.3 and vitest 2.1.8 are already pinned at the monorepo root in `package.json` lines 40-41 — Phase 15 reuses the root versions (do NOT re-pin).

## Package Legitimacy Audit

slopcheck was not available at research time (pip install failed in sandboxed environment). All packages below are marked `[ASSUMED]` per the protocol — the planner MUST gate each install behind a `checkpoint:human-verify` task OR run slopcheck before adoption.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| bun (toolchain) | npm + standalone install | 5 yrs | high (millions/wk) | github.com/oven-sh/bun | `[ASSUMED]` | Approved — already STACK.md HIGH-confidence pick + Anthropic-acquired company per Bun 1.3 blog |
| typescript | npm | 12+ yrs | hundreds of millions/wk | github.com/microsoft/TypeScript | `[ASSUMED]` | Approved — already root devDep |
| vitest | npm | 4 yrs | tens of millions/wk | github.com/vitest-dev/vitest | `[ASSUMED]` | Approved — already root devDep |
| esbuild | npm | 5 yrs | hundreds of millions/wk | github.com/evanw/esbuild | `[ASSUMED]` | Approved — canonical bundler |
| eslint | npm | 12+ yrs | hundreds of millions/wk | github.com/eslint/eslint | `[ASSUMED]` | Approved — industry standard |
| typescript-eslint | npm | 7+ yrs | hundreds of millions/wk | github.com/typescript-eslint/typescript-eslint | `[ASSUMED]` | Approved — canonical TS-ESLint integration |
| eslint-config-prettier | npm | 8+ yrs | tens of millions/wk | github.com/prettier/eslint-config-prettier | `[ASSUMED]` | Approved — canonical prettier+eslint bridge |
| commander | npm | 14+ yrs | 200M+/wk | github.com/tj/commander.js | `[ASSUMED]` | Approved — already pinned in `apps/achilles-cli/package.json:32` |
| @types/node | npm | 8+ yrs | 200M+/wk | DefinitelyTyped | `[ASSUMED]` | Approved — already root devDep |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable; all packages verified via existing v1.2 monorepo precedent and/or official-org source repos)
**Packages flagged as suspicious [SUS]:** none (all are well-known, multi-year, multi-million-download packages with official-org GitHub repos)

**Slopcheck unavailable rationale:** Every package recommended for Phase 15 is either (a) already pinned in the existing v1.2 monorepo `package.json` files (TypeScript, vitest, @types/node, commander) OR (b) maintained by a verified open-source organization (eslint.org, typescript-eslint.io, oven-sh/Bun, evanw/esbuild, prettier). The planner should still spot-check on a workstation with slopcheck installed before any greenfield `npm install`.

## Architecture Patterns

### System Architecture Diagram

```
                  Developer machine
                        │
                        │  npm install -g achilles  (Phase 19; Phase 15 prepares the shape)
                        ▼
                  npm registry
                  ├── achilles@1.3.0
                  │     ├── dist/cli.js   (the 30-line shim)
                  │     ├── dist/main.js  (esbuild Node bundle — fallback)
                  │     ├── skill/        (companion.md asset; not touched in Phase 15)
                  │     └── optionalDependencies: { @achilles/cli-<5 platforms> }
                  │
                  └── @achilles/cli-{darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64}@1.3.0
                        └── bin/achilles  (one Bun-compiled binary per package; os/cpu filtered)

                                       │  Filtered install
                                       ▼
                  ┌────────────────────────────────────────────────────────┐
                  │  User's machine — node_modules layout after install   │
                  │                                                        │
                  │   achilles/dist/cli.js   (shim — PATH bin entry)       │
                  │                          ┌───────────────────────┐    │
                  │                          │ Try platform binary   │    │
                  │   import.meta.resolve →  │ @achilles/cli-<plat>  │    │
                  │                          │ → exec the binary     │    │
                  │                          │   inherit stdio       │    │
                  │                          └──────┬────────────────┘    │
                  │                                 │ fall-through        │
                  │                                 ▼ on resolve failure  │
                  │                          ┌───────────────────────┐    │
                  │                          │ import(./main.js)     │    │
                  │                          │ (esbuild Node bundle) │    │
                  │                          └───────────────────────┘    │
                  └────────────────────────────────────────────────────────┘

                  CI matrix (Phase 15 deliverable — runs on every PR):
                  ┌────────────────────────────────────────────────────────┐
                  │  GitHub Actions                                        │
                  │   strategy.matrix.runtime: [bun, node22]               │
                  │   strategy.matrix.os: [ubuntu-latest, macos-latest,    │
                  │                        windows-latest]                  │
                  │                                                        │
                  │   step: setup-bun@v2 OR setup-node@v4                  │
                  │   step: vitest run                                     │
                  │   step: bun build --compile (5 targets in one job)     │
                  └────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/
├── achilles-terminal/              # NEW workspace — Phase 15 stands it up
│   ├── package.json                # name: "achilles", "bin": { "achilles": "./dist/cli.js" },
│   │                               #   type: "module", optionalDependencies x5
│   ├── tsconfig.json               # extends root; ESM-only; NodeNext; .js imports
│   ├── vitest.config.ts            # environment: "node"; pool: "forks"
│   ├── .eslintrc.json              # extends typescript-eslint/recommended-type-checked
│   │                               #   + eslint-config-prettier (last)
│   ├── scripts/
│   │   ├── build-binaries.mjs      # invokes `bun build --compile --target=...` 5x
│   │   └── build-node-bundle.mjs   # invokes esbuild for dist/main.js
│   ├── src/
│   │   ├── cli.ts                  # argv parse → --version branch returns; otherwise stub
│   │   └── version.ts              # exports VERSION from generated import (build step)
│   ├── tests/
│   │   └── cli.test.ts             # asserts `achilles --version` prints package.json version
│   └── dist/                       # generated; not committed
│       ├── cli.js                  # the 30-line shim (built from src/shim/cli.shim.ts OR hand-authored)
│       └── main.js                 # esbuild Node fallback bundle
│
├── cli-darwin-arm64/               # NEW platform-binary package — Phase 15 stub
│   ├── package.json                # name: "@achilles/cli-darwin-arm64", os:["darwin"], cpu:["arm64"]
│   └── bin/
│       └── achilles                # populated by CI bun build --compile on macos-latest
│
├── cli-darwin-x64/                 # NEW — same shape; os:["darwin"], cpu:["x64"]
├── cli-linux-x64/                  # NEW — os:["linux"], cpu:["x64"]
├── cli-linux-arm64/                # NEW — os:["linux"], cpu:["arm64"]
└── cli-win32-x64/                  # NEW — os:["win32"], cpu:["x64"]; bin name `achilles.exe`

.github/workflows/
└── achilles-terminal-ci.yml        # NEW — dual-runtime + cross-OS matrix
```

### Pattern 1: `bun build --compile` Cross-Target Matrix

**What:** Bun's `--compile --target=bun-{darwin,linux,windows}-{x64,arm64}` flag produces a self-contained executable that embeds the Bun runtime + the bundled JS source + any imported assets. The five Phase 15 targets correspond to the five platform packages.

**When to use:** Every Phase 15 platform-binary build. Cross-compile from any host is supported; production CI matrices per-OS to avoid Windows-icon-flag limitations and to keep code-signing local to its host (Phase 19 concern).

**Example — exact CLI invocations:**
```bash
# From apps/achilles-terminal/ ; cross-compile from any host (CI uses native runner per target):

bun build src/cli.ts --compile --target=bun-darwin-arm64 \
  --outfile=../cli-darwin-arm64/bin/achilles --minify

bun build src/cli.ts --compile --target=bun-darwin-x64 \
  --outfile=../cli-darwin-x64/bin/achilles --minify

bun build src/cli.ts --compile --target=bun-linux-x64 \
  --outfile=../cli-linux-x64/bin/achilles --minify

bun build src/cli.ts --compile --target=bun-linux-arm64 \
  --outfile=../cli-linux-arm64/bin/achilles --minify

bun build src/cli.ts --compile --target=bun-windows-x64 \
  --outfile=../cli-win32-x64/bin/achilles.exe --minify
```

**Notes verified against Bun docs `[CITED: bun.com/docs/bundler/executables]`:**
- Minimum Bun version for stable cross-compile: 1.1.5 (May 2024). Windows ARM64 added in 1.3.10. We pin 1.3.14+ for headroom.
- `--target=bun-windows-x64` is the documented target name (Windows; not "win32") — but the output package directory uses `win32-x64` to match `process.platform === "win32"` (Node's value), which is what the shim's resolution string interpolates.
- Binary output: macOS-arm64 ~63 MB minified, Linux x64 ~60 MB, Windows x64 ~100 MB. These figures from STACK.md / v1.3-terminal-pivot.md §3.2 are public Bun benchmarks.
- The Bun runtime is embedded in the output binary — the user does NOT need Bun installed. This is the entire point of the pattern.
- External system deps (sox, ffmpeg) remain external. They are NOT bundled into the binary (Bun doesn't bundle child-process targets). The binary spawns them at runtime via `child_process.spawn("rec", ...)` and `child_process.spawn("ffplay", ...)`. Phase 15 does NOT touch this code — it only needs the `--version` path to compile and run.
- Asset embedding: not relevant to Phase 15. The companion.md asset embed (Bun `import` of `.md` as text via `--asset-loader=text`) is a Phase 17 concern when `session.ts` resolves the system prompt path. Phase 15's `src/cli.ts` does not import any assets.

### Pattern 2: `optionalDependencies` + `os`/`cpu` filter (the esbuild/swc/biome/turbo pattern)

**What:** The parent `achilles` package lists all five platform-binary packages in `optionalDependencies`. Each sibling package's `package.json` declares its `os` and `cpu` fields. npm/bun install evaluate these fields at install time and silently skip non-matching packages. The matching package is installed alongside `achilles` in `node_modules/@achilles/cli-<platform>/`.

**When to use:** Every Phase 15 platform-binary distribution layout. This is the 2026 canonical pattern, documented exhaustively in:
- esbuild PR #1621 `[CITED: github.com/evanw/esbuild/pull/1621]`
- pnpm 11.2 release notes `[CITED: pnpm.io/blog/releases/11.2]`
- Sentry "Publishing Binaries on npm" `[CITED: sentry.engineering/blog/publishing-binaries-on-npm]`

**Parent package.json shape (`apps/achilles-terminal/package.json`):**
```json
{
  "name": "achilles",
  "version": "1.3.0",
  "description": "Voice companion for Claude Code — terminal-only.",
  "license": "MIT",
  "type": "module",
  "bin": { "achilles": "./dist/cli.js" },
  "files": ["dist", "skill", "README.md"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=22.0.0" },
  "optionalDependencies": {
    "@achilles/cli-darwin-arm64": "1.3.0",
    "@achilles/cli-darwin-x64":   "1.3.0",
    "@achilles/cli-linux-x64":    "1.3.0",
    "@achilles/cli-linux-arm64":  "1.3.0",
    "@achilles/cli-win32-x64":    "1.3.0"
  },
  "dependencies": {
    "commander": "13.1.0"
    // voice/bridge packages wired Phase 17; achilles-skill wired Phase 17+ as bundledDependencies
  },
  "scripts": {
    "build": "rm -rf dist .tsbuildinfo && tsc -p tsconfig.json && node scripts/build-node-bundle.mjs",
    "build:binaries": "node scripts/build-binaries.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "5.7.3",
    "vitest": "2.1.8",
    "esbuild": "0.28.0",
    "eslint": "10.4.1",
    "typescript-eslint": "8.60.1",
    "eslint-config-prettier": "10.1.8",
    "@types/node": "22.10.5"
  }
}
```

**Platform-binary sibling package.json shape (e.g., `apps/cli-darwin-arm64/package.json`):**
```json
{
  "name": "@achilles/cli-darwin-arm64",
  "version": "1.3.0",
  "description": "Bun-compiled achilles binary for macOS arm64.",
  "license": "MIT",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "files": ["bin/achilles"],
  "publishConfig": { "access": "public" }
}
```

**Verified field values:**
- `os` accepts: `"darwin"`, `"linux"`, `"win32"` (Node's `process.platform` values) `[CITED: docs.npmjs.com/cli/v10/configuring-npm/package-json#os]`
- `cpu` accepts: `"arm64"`, `"x64"` (Node's `process.arch` values) `[CITED: docs.npmjs.com/cli/v10/configuring-npm/package-json#cpu]`
- npm and bun both honor `os`/`cpu` filters at install time. pnpm honors them as of 11.2.
- Behavior on unsupported platform: ALL `optionalDependencies` entries fail to install (no `os` match). Install succeeds (optionals can fail). Shim falls through to the Node bundle at runtime.

**No `bin` field on platform packages:** crucial. The platform package ships ONLY the binary file in its tarball; the `bin` entry stays on the parent so PATH points to one consistent place (the shim).

### Pattern 3: 30-line ESM JS bin shim

**What:** A tiny ESM JS file the parent ships as its `bin.achilles` entry. The shim runs under Node (or Bun, if invoked via `bunx`), uses `import.meta.resolve` to locate the matching platform binary, exec's it inheriting argv/stdio. On resolve failure, falls back to importing `dist/main.js` (the esbuild Node bundle).

**When to use:** Always. The shim is the install-time + runtime contract between the parent and the platform packages.

**Reference implementation (~30 lines):**
```javascript
#!/usr/bin/env node
// apps/achilles-terminal/dist/cli.js — generated by tsc OR hand-authored as plain JS
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve, join } from "node:path";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const platform = `${process.platform}-${process.arch}`;
const pkgName = `@achilles/cli-${platform}`;

// Resolve the platform binary via import.meta.resolve (Node 22+ stable, Bun 1.3+).
// Fall through cleanly on resolve failure — package may not be installed (unsupported platform,
// pnpm symlink quirk, or workspace dev mode where binaries haven't been compiled yet).
let binPath = null;
try {
  const resolved = import.meta.resolve(`${pkgName}/package.json`);
  const pkgDir = dirname(fileURLToPath(resolved));
  const exe = process.platform === "win32" ? "achilles.exe" : "achilles";
  const candidate = join(pkgDir, "bin", exe);
  if (existsSync(candidate)) binPath = candidate;
} catch { /* package not installed; fall through */ }

if (binPath !== null) {
  const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 0);
} else {
  // Fallback: Node esbuild bundle. Cold start ~50-80ms vs ~15ms for native binary.
  await import(pathResolve(HERE, "main.js"));
}
```

**Verified behaviors:**
- `import.meta.resolve(specifier)` is stable in Node 22+ `[CITED: nodejs.org/api/esm.html#importmetaresolvespecifier]` (was experimental in 18-21; stable as of 22.0.0).
- Bun 1.3+ supports `import.meta.resolve` per Bun docs `[CITED: bun.com/docs/runtime/import-meta]`. Synchronous return (unlike Node's early async-experimental form which returns a Promise — Node 22 stable form is sync).
- **Resolution gotcha for Phase 15 verification:** Node's `import.meta.resolve` returns a `file://` URL string; Bun returns the same. `fileURLToPath` works on both. Test this seam under both runtimes in the Phase 15 CI matrix.
- `spawnSync(..., { stdio: "inherit" })` forwards stdin/stdout/stderr to the parent terminal — preserves the TUI's ability to take over the tty in Phase 16+. Phase 15 only needs stdout for `--version`; stdio:inherit is the correct shape regardless.
- argv pass-through preserves `--version` semantics for INIT-07. The shim does NOT parse argv itself — it passes through verbatim. The platform binary's own argv parser handles `--version` and exits before any pipeline boot.
- Bun.spawn vs child_process.spawn: under Bun, `node:child_process` is a documented node-compat shim over `Bun.spawn` (which uses `posix_spawn(3)`, 60% faster than Node's spawn) `[CITED: bun.com/reference/node/child_process/spawn]`. The shim uses `node:child_process.spawnSync` either way — Bun's shim transparently uses posix_spawn underneath.

### Pattern 4: esbuild Node-22 ESM fallback bundle

**What:** A single-file ESM bundle of `src/cli.ts` (and its imported tree) targeting Node 22+. Output: `dist/main.js`. Used when no platform binary matches or when running on a Bun-incompatible platform.

**When to use:** Built alongside every `bun build --compile` so the shim always has a viable fallback.

**Reference build script (`apps/achilles-terminal/scripts/build-node-bundle.mjs`):**
```javascript
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/main.js",
  // Workspace internal deps stay external — they live in node_modules at runtime
  external: [
    "@achilles/voice-protocol",
    "@achilles/voice-stt",
    "@achilles/voice-tts",
    "@achilles/claude-code-bridge",
    "@achilles/achilles-skill",
    // commander stays bundled (small); add it to external only if size becomes a concern
  ],
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: "linked",
  legalComments: "linked",
});
```

**Why ESM-only:** the workspace ships `"type": "module"`; mixing CJS would invoke ERR_REQUIRE_ESM under Node and dual-mode confusion under Bun. STACK.md `## What NOT to Use` row "chalk 4 (last CJS major)" applies here too.

### Pattern 5: Dual-runtime CI matrix (GitHub Actions)

**What:** A `.github/workflows/achilles-terminal-ci.yml` that runs `vitest` under both Bun 1.3+ AND Node 22+ across `{ubuntu-latest, macos-latest, windows-latest}` so Phase 15 catches runtime drift at the seam it was introduced. This is the Phase 15 half of GATE-04 (`stdio:"ignore"` lint rule is the Phase 19 half).

**When to use:** Every PR. Phase 15 ships the workflow; subsequent phases add tests to the suite.

**Reference workflow:**
```yaml
name: achilles-terminal CI

on:
  pull_request:
    paths:
      - "apps/achilles-terminal/**"
      - "apps/cli-*/**"
      - ".github/workflows/achilles-terminal-ci.yml"
  push:
    branches: [main]

jobs:
  test:
    name: test (${{ matrix.os }}, ${{ matrix.runtime }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        runtime: [bun, node]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Setup Bun 1.3
        if: matrix.runtime == 'bun'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck --workspace apps/achilles-terminal

      - name: Lint
        run: npm run lint --workspace apps/achilles-terminal

      - name: Test (Node)
        if: matrix.runtime == 'node'
        run: npm test --workspace apps/achilles-terminal -- --pool=forks

      - name: Test (Bun)
        if: matrix.runtime == 'bun'
        # Vitest works under Bun; --pool=forks works under both
        run: bunx vitest run --pool=forks
        working-directory: apps/achilles-terminal

  compile-binaries:
    name: compile (${{ matrix.target.name }})
    runs-on: ${{ matrix.target.runner }}
    strategy:
      fail-fast: false
      matrix:
        target:
          - { name: darwin-arm64, runner: macos-latest,  target: bun-darwin-arm64,  out: cli-darwin-arm64/bin/achilles      }
          - { name: darwin-x64,   runner: macos-13,      target: bun-darwin-x64,    out: cli-darwin-x64/bin/achilles        }
          - { name: linux-x64,    runner: ubuntu-latest, target: bun-linux-x64,     out: cli-linux-x64/bin/achilles         }
          - { name: linux-arm64,  runner: ubuntu-22.04-arm, target: bun-linux-arm64, out: cli-linux-arm64/bin/achilles      }
          - { name: win32-x64,    runner: windows-latest, target: bun-windows-x64,  out: cli-win32-x64/bin/achilles.exe     }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "1.3.14" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - name: Compile binary
        run: |
          bun build src/cli.ts --compile \
            --target=${{ matrix.target.target }} \
            --outfile=../${{ matrix.target.out }} \
            --minify
        working-directory: apps/achilles-terminal
      - name: Smoke test — achilles --version
        # Run the compiled binary; assert it prints a non-empty version string
        run: ../${{ matrix.target.out }} --version
        working-directory: apps/achilles-terminal
        if: matrix.target.runner != 'ubuntu-22.04-arm'  # arm64 cross-runner exists per actions docs as of June 2026
```

**Notes verified against GitHub Actions docs `[CITED: docs.github.com/en/actions/using-jobs/choosing-the-runner-for-a-job]`:**
- `oven-sh/setup-bun@v2` is the current Bun setup action (v2 baseline since 2025).
- `actions/setup-node@v4` is current.
- `ubuntu-22.04-arm` is GitHub's ARM Linux runner (free for public repos since Jan 2025). The smoke-test on it is gated because cross-running the arm64 binary on an x64 host would fail; the ARM runner can execute it.
- macOS-13 retained for the darwin-x64 build (macos-latest is now arm64-only).
- Windows-latest is server-2022/2025 — adequate for win32-x64 compilation.

### Anti-Patterns to Avoid

- **Hard-coded `node_modules/@achilles/cli-...` path in the shim.** Breaks under pnpm, monorepo dev, bunx cache, and global install layouts. Use `import.meta.resolve` (`Anti-Pattern 4` in ARCHITECTURE.md is verbatim about this).
- **`bin` field on the platform packages.** Would compete with the parent's `bin`. Only the parent has `bin: { achilles: ... }`; platform packages ship the binary as a regular file in `files: ["bin/achilles"]`.
- **`postinstall` script that downloads the binary.** Anti-pattern per supabase #1217 and openai/codex #2766. Breaks corporate proxies, `--ignore-scripts`, offline installs. Use `optionalDependencies` exclusively.
- **Mixing CJS and ESM.** Workspace is `"type": "module"`. Every file uses `.js` import specifiers in TS source (NodeNext). chalk 4, log-update <7, ansi-escapes <7 forbidden (all CJS).
- **Bun's `bun test` for Phase 15.** Deferred to v1.4 per CONTEXT.md. Use vitest under both runtimes.
- **Migrating to pnpm/bun workspaces.** Locked OUT per CONTEXT.md.
- **Touching `packages/voice-*`, `packages/claude-code-bridge`, or `packages/achilles-skill/skill/prompts/companion.md`.** LOOP-02 invariant. Phase 15 does NOT import these into `apps/achilles-terminal/src/` yet — that's Phase 17. Phase 15 can list them as workspace deps in `package.json` but must not transitively import them.
- **`tsc --build` with project references for Phase 15.** Adds incremental-build complexity for a workspace with one src/ tree. Use plain `tsc -p tsconfig.json --noEmit` for typecheck + `esbuild` for emit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argv parsing | A `process.argv.slice(2).forEach(...)` loop | `commander` (already pinned 13.1.0) | Phase 18 adds 6 subcommands; the parser is load-bearing. Hand-roll is an unmaintainable spike. |
| Per-platform binary distribution | postinstall script that fetches a binary | `optionalDependencies` + `os`/`cpu` filters | Postinstall is a documented anti-pattern (proxies, offline, --ignore-scripts). Every modern tool (esbuild, swc, biome, turbo, lightningcss) uses optionalDependencies. |
| Workspace internal module resolution | Manual `../../packages/voice-stt/dist/index.js` path imports | `"@achilles/voice-stt": "*"` workspace deps + npm workspaces symlinks | The root workspace already wires these. Direct path imports break under bunx + global install. |
| ESM bundling for the Node fallback | Custom bundler script | `esbuild` with `format: "esm" + target: "node22"` | esbuild handles tree-shaking, ESM emit, and Node target conventions correctly. |
| Cross-compile orchestration | Shell scripts that loop over targets | A `build-binaries.mjs` Node script that wraps `bun build` 5x with explicit args | A Node script is greppable, debuggable, and runs identically across OSes (the shell-script version diverges on Windows). |
| CI runtime install | Custom curl-install Bun | `oven-sh/setup-bun@v2` | Official action; handles cache, version-pin, env. |
| Lint preset selection | A handcrafted ruleset | `typescript-eslint`'s `recommended-type-checked` + `eslint-config-prettier` (last) | Modern (2024+) unified preset; well-documented; the `stdio:"ignore"` ban (Phase 19) is added as one `no-restricted-syntax` rule on top. |

**Key insight:** Phase 15 is "do the boring scaffolding correctly" — every problem above has a 2026-canonical solution. The risk is divergence from that canonical pattern (custom postinstall, custom workspace-resolve, custom bundler), not the absence of a tool.

## Runtime State Inventory

**Not applicable.** Phase 15 is greenfield scaffolding (new workspace, new platform packages). No rename, refactor, or migration of existing runtime state. The Electron app at `apps/achilles/` and the CLI shim at `apps/achilles-cli/` remain on disk and untouched until Phase 19 — Phase 15 does NOT delete, rename, or modify them.

- **Stored data:** None — no DB/keystore writes in Phase 15. The `~/.achilles/latency/` JSON probe arrives Phase 18.
- **Live service config:** None — no external services touched.
- **OS-registered state:** None — no service registration, no Task Scheduler, no pm2.
- **Secrets/env vars:** None — INIT-07 (`achilles --version`) explicitly bypasses key resolution.
- **Build artifacts:** **Five new build artifacts ARE introduced** (one Bun-compiled binary per platform sibling package + one esbuild Node bundle + one tsc-typechecked shim source). These are CI-generated, not committed to git. The `apps/cli-<platform>-<arch>/bin/` directories should be `.gitignore`d.

## Common Pitfalls

### Pitfall 1: `optionalDependencies` resolver behavior diverges between npm, bun install, and pnpm
**What goes wrong:** A package installs cleanly under npm but fails under pnpm (or vice versa) because pnpm's symlink layout puts the platform package at a different relative path than the shim expects.
**Why it happens:** Each package manager invents its own `node_modules` layout. npm flattens; pnpm uses content-addressable store + symlinks; bun install mirrors npm's flat layout but with its own cache directory.
**How to avoid:** Use `import.meta.resolve` (NOT relative paths) in the shim. Resolver-agnostic by design — it asks the runtime "where does this package live" rather than guessing layout.
**Warning signs:** Tests pass under one package manager and fail under another. CI matrix should include at least one `bun install` job and one `npm install` job to catch this.

### Pitfall 2: `import.meta.resolve` shape differences (Node sync vs Node 20 async vs Bun)
**What goes wrong:** Code written assuming `import.meta.resolve` returns a Promise (Node 18-21 experimental) breaks under Node 22 (sync) or Bun (sync). Reverse also breaks.
**Why it happens:** `import.meta.resolve` was experimental + async in Node 18-21; stabilized as **synchronous** in Node 22.0.0 per `[CITED: nodejs.org/api/esm.html#importmetaresolvespecifier]`. Bun 1.3+ matches Node 22 sync shape.
**How to avoid:** Phase 15 pins `engines.node: ">=22.0.0"`. The shim assumes synchronous return. Verify in the dual-runtime CI matrix on every PR.
**Warning signs:** A `TypeError: Cannot read properties of undefined (reading 'startsWith')` from the `dirname(fileURLToPath(resolved))` line — means `resolved` is a Promise, not a string.

### Pitfall 3: Windows path separators in the shim's directory join
**What goes wrong:** On Windows, the binary file is `achilles.exe`, not `achilles`. The shim's `join(pkgDir, "bin", exe)` must use `.exe` suffix on `process.platform === "win32"`.
**Why it happens:** Forgetting the platform check is the single most common cross-platform CLI bug.
**How to avoid:** The reference shim above includes the check: `const exe = process.platform === "win32" ? "achilles.exe" : "achilles";`. CI runs the shim on Windows runner.
**Warning signs:** ENOENT on Windows users only; works on macOS/Linux.

### Pitfall 4: Bun `--compile` output binary not executable on macOS without `chmod +x`
**What goes wrong:** The binary file written to `apps/cli-darwin-arm64/bin/achilles` may not have executable permission bits set, depending on the host OS and the script doing the write.
**Why it happens:** Some build environments (specifically tarball extraction and certain git checkouts on Windows hosts) drop the executable bit.
**How to avoid:** The `build-binaries.mjs` script should `fs.chmodSync(outPath, 0o755)` after each `bun build --compile`. The platform package's tarball preserves the executable bit per npm's documented behavior (npm tarballs preserve mode bits).
**Warning signs:** `EACCES: permission denied` on first invocation. Reproduces only on fresh installs (post-install `chmod +x` workaround masks it in dev).

### Pitfall 5: `process.exit()` truncating output on the platform binary
**What goes wrong:** `achilles --version` prints the version string then calls `process.exit(0)`. Under Bun, if stdout is a pipe and the process exits before the buffer flushes, the consumer sees no output.
**Why it happens:** Bun's stdout flush-on-exit semantics differ slightly from Node's. Node's `process.exit()` documented behavior is "queue stdout flush then exit"; Bun's is similar but the buffer-flush completion timing has been reported to vary `[CITED: github.com/oven-sh/bun/issues — many filed]`.
**How to avoid:** Use `process.stdout.write(version + "\n", () => process.exit(0))` — explicit write-then-exit callback. Alternative: use `console.log` and rely on Node/Bun's normal exit path (the test should still verify under both runtimes via CI).
**Warning signs:** `achilles --version | cat` prints nothing under Bun but works under Node — pipe-truncation symptom.

### Pitfall 6: Cold-start latency probe contamination
**What goes wrong:** Phase 15's `--version` cold-start measurement (via `hyperfine` or `time`) gets contaminated by warm-cache effects after the first run, making the P50/P95 figures look better than reality.
**Why it happens:** First-run loads the binary from disk (page-cache cold); subsequent runs hit the page cache. Without explicit cache-clear between runs, the measurement is biased.
**How to avoid:** Use `hyperfine --warmup 0 --runs 50 --prepare 'sync && purge'` on macOS (purge requires sudo). On Linux: `echo 3 > /proc/sys/vm/drop_caches`. Windows: `Clear-RecycleBin -Force` (less reliable; document the limitation). Alternatively, accept that warm P50 is what users actually see on second+ invocations and report both cold-first-run and warm-steady-state numbers separately.
**Warning signs:** P50 << reported by users in the field.

### Pitfall 7: Workspace internal deps not symlinked into platform packages
**What goes wrong:** The 5 platform-binary packages ship ONLY their compiled binary; they don't have a `dependencies` block. But during dev (`bun build --compile` from the parent workspace), the parent's `src/cli.ts` imports workspace deps that npm has symlinked under `apps/achilles-terminal/node_modules/@achilles/...`. After Phase 17 adds workspace dep imports, the binary build must include them — Bun's `--compile` traces and bundles imported modules transitively, so as long as the imports resolve via the workspace symlink during build, the resulting binary embeds them. **Phase 15 does not import any workspace deps yet**, so this risk is dormant.
**How to avoid:** Confirm in Phase 17 that `bun build --compile` traces workspace symlinks correctly. Phase 15 can verify the pattern works by adding a trivial `import { version } from "../package.json" with { type: "json" }` to `src/cli.ts` and confirming the compiled binary prints the version.
**Warning signs:** Phase 17 binary builds fail with `Could not resolve "@achilles/voice-stt"` — workspace symlink layout broken.

### Pitfall 8: ESLint flat config vs legacy `.eslintrc` confusion
**What goes wrong:** ESLint 9+ defaults to flat config (`eslint.config.js`); the legacy `.eslintrc.json` requires the `ESLINT_USE_FLAT_CONFIG=false` env var or an `--config` flag override. Mixing the two breaks the lint step.
**Why it happens:** ESLint 9 (April 2024) made flat config the default. ESLint 10 (released March 2026) `[CITED: npm registry — confirmed 10.4.1]` removed legacy `.eslintrc` support entirely OR added stricter warnings (verify in Phase 15 spike).
**How to avoid:** Use **flat config** (`eslint.config.js`) for the Phase 15 workspace. The typescript-eslint 8.x docs document the flat-config pattern as the recommended path.
**Warning signs:** `Could not find config file` or `Unexpected top-level property "extends"` errors at lint time.

### Pitfall 9: vitest under Bun emits "experimental warning" noise
**What goes wrong:** Running `bunx vitest run` under Bun emits warnings about partial Node-API support (worker threads, certain `node:` module imports). The warnings clutter CI logs and obscure real failures.
**Why it happens:** vitest internally uses `node:worker_threads`; Bun supports them partially (Bun-known-issue ref in v1.3-terminal-pivot.md §10.7).
**How to avoid:** Use `--pool=forks` (NOT `--pool=threads`). The dual-runtime CI matrix above already does this. ARCHITECTURE.md §Test Seams says explicitly: "explicitly disable the threads pool when running under Bun."
**Warning signs:** Stack traces mentioning `worker_threads` or `MessageChannel` in vitest output under Bun.

## Code Examples

### Seed `src/cli.ts` — INIT-07 implementation

```typescript
// apps/achilles-terminal/src/cli.ts
// Phase 15 surface: argv parse → --version branch → exit. No pipeline boot.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // INIT-07: --version / -v MUST work without API key, sox, ffmpeg.
  // Parse BEFORE any other side-effect-bearing module is imported.
  if (argv.includes("--version") || argv.includes("-v")) {
    // Resolve package.json relative to this file. Under bun --compile, the
    // package.json is embedded as an asset; under Node fallback, it's on disk.
    const pkgPath = join(HERE, "..", "package.json");
    const pkgJson = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
    process.stdout.write(`${pkgJson.version}\n`, () => process.exit(0));
    return;
  }

  // Cold-start latency probe (Phase 15 manual capture surface).
  // Phase 18 promotes this to ~/.achilles/latency/ JSON.
  if (argv.includes("--latency-probe")) {
    const t0 = process.hrtime.bigint();
    // No-op argv parse + version read already happened above (we'd repeat here for measurement).
    const elapsedNs = Number(process.hrtime.bigint() - t0);
    process.stdout.write(`${(elapsedNs / 1e6).toFixed(2)}ms\n`, () => process.exit(0));
    return;
  }

  // Phase 15 stub: any other subcommand prints "not yet implemented" and exits.
  // Phase 16+ replaces this with the real subcommand router.
  if (argv[0] === "voice") {
    process.stderr.write("achilles voice: TUI not implemented in Phase 15. Phase 16 ships this.\n");
    process.exit(1);
  }

  process.stderr.write(`achilles: unknown command. Try --version.\n`);
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`achilles: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
```

**Why this shape:**
- Argv check happens BEFORE any dynamic import — satisfies INIT-07 ("argv parse precedes any pipeline boot").
- Reads version from `package.json` rather than hardcoding — single source of truth.
- The fatal handler catches startup errors so the user sees a real message, not a silent exit (defends against v1.2-silent-launch shape).
- No `commander` use yet — for `--version` only, raw argv is sufficient. `commander` is added in Phase 16+ when subcommands materialize.

### Seed `tests/cli.test.ts` — the only test surface for Phase 15

```typescript
// apps/achilles-terminal/tests/cli.test.ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = join(HERE, "..", "src", "cli.ts");

describe("achilles --version", () => {
  it("prints a non-empty version string", () => {
    // Run via tsx/bun/node — the test runs under whichever runtime vitest spawns.
    // Vitest's default child-process runner uses the same node/bun that started vitest.
    const result = spawnSync(process.execPath, ["--import", "tsx", CLI_SRC, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
  });

  it("exits 0 without ELEVENLABS_API_KEY set", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", CLI_SRC, "--version"], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, ELEVENLABS_API_KEY: undefined },
    });

    expect(result.status).toBe(0);
  });
});
```

**Why this minimal:** Phase 15's test surface is exactly INIT-07. Phase 16 adds VAD/mic tests, Phase 17 adds end-to-end voice loop tests. Phase 15 deliberately scopes the suite to the seed assertion that gates every downstream phase.

### Workspace `tsconfig.json`

```json
// apps/achilles-terminal/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2024",
    "lib": ["ES2024"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": false,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "noEmit": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
  "exclude": ["dist", "node_modules"]
}
```

**Notes:**
- `NodeNext` module resolution + ESM-only — matches LOCKED architecture.
- `verbatimModuleSyntax` + `isolatedModules` enforce `.js` import specifiers (each file is independently transpileable, which Bun and esbuild both require).
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are the strictest sensible defaults; surface bugs at compile time that would otherwise materialize as runtime issues.
- `noEmit: false` because `tsc` is the typecheck step but `esbuild` does the actual bundle emit. Typecheck output (`.d.ts`) is suppressed via `declaration: false`.

### Workspace `eslint.config.js` (flat config)

```javascript
// apps/achilles-terminal/eslint.config.js
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Slot for Phase 19 GATE-04 rule: forbid `stdio: "ignore"` on the launch path.
      // Phase 15 leaves this empty; Phase 19 adds the no-restricted-syntax rule:
      //   "no-restricted-syntax": [
      //     "error",
      //     {
      //       selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
      //       message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
      //     },
      //   ],

      // Phase 15 baseline: no extra rules beyond typescript-eslint recommended-type-checked.
    },
  },
  prettier, // MUST be last — disables ESLint rules that conflict with prettier
  {
    ignores: ["dist", "node_modules", "**/*.cjs"],
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-package CLI with `prebuild`/`postinstall` binary download | `optionalDependencies` with 5 sibling per-platform packages + `os`/`cpu` filter | esbuild PR #1621 (2021); pnpm 11.2 official support (2025) | Phase 15 canonical pattern. Eliminates proxy/--ignore-scripts failure modes. |
| Node SEA (Single Executable Applications) via `--experimental-sea-config` + postject | Node 25.5+ `--build-sea` (Jan 2026) OR Bun `--compile` | Bun 1.1.5 (May 2024) for `--compile`; Node 25.5 (Jan 2026) for `--build-sea` | v1.3 chooses Bun for cold-start (~15ms vs ~30-60ms SEA). Node SEA is the v1.4 fallback if a hard native-module dep blocks Bun. |
| `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` (split packages) | `typescript-eslint` unified package | tseslint 8.0 (June 2024) | One install instead of two; flat-config-native. Phase 15 uses unified. |
| `.eslintrc.json` legacy config | `eslint.config.js` flat config | ESLint 9.0 (April 2024); 10.0 (March 2026) | Phase 15 uses flat config exclusively. |
| `bun.lockb` (binary) | `bun.lock` (text, since Bun 1.2) | Bun 1.2 (March 2025) | Phase 15 still uses npm workspaces — npm's `package-lock.json` is the lockfile. |
| `actions/setup-node@v3` | `actions/setup-node@v4` | mid-2024 | Phase 15 uses v4. |
| `oven-sh/setup-bun@v1` | `oven-sh/setup-bun@v2` | 2025 | Phase 15 uses v2. |

**Deprecated/outdated:**
- `yao-pkg` (vercel/pkg fork): functional but slower cold start than Bun `--compile`. v1.4 fallback only.
- ESLint `.eslintrc` legacy config: still works in 10.x but raises warnings; flat config is the path forward.
- `@typescript-eslint/*` split packages: still published but `typescript-eslint` unified package is the recommended install.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All recommended npm packages (bun, esbuild, eslint, typescript-eslint, eslint-config-prettier, commander, @types/node) pass slopcheck `[OK]` | Package Legitimacy Audit | LOW — every package has an official-org GitHub repo and multi-year npm publish history; slopcheck unavailable at research time. Planner should re-run slopcheck before any `npm install` in Phase 15. |
| A2 | `import.meta.resolve` returns synchronously under both Node 22+ and Bun 1.3+ | Pattern 3, Pitfall 2 | MEDIUM — documented as sync in Node 22.0.0 release notes; Bun docs state the same. Phase 15 dual-runtime CI matrix verifies on the first run. If async under Bun, the shim must `await` resolve and the test fails fast. |
| A3 | `bun build --compile --target=bun-windows-x64` produces a runnable `.exe` that prints `--version` correctly when cross-compiled from macOS host | Pattern 1, Pitfall 4 | MEDIUM — well-documented for Bun 1.3+, but Windows-specific issues (path separators, exe extension, codesign) are historically fragile. Phase 15 CI matrix uses `windows-latest` runner for the win32-x64 build to side-step cross-compile risks. |
| A4 | npm honors `optionalDependencies` + `os`/`cpu` filters on `npm install -g` (global install) the same way it does for local install | Pattern 2 | LOW — documented behavior; esbuild has shipped this pattern globally for 5+ years. Verify with `npm install -g .` in a Phase 15 dev smoke test. |
| A5 | `oven-sh/setup-bun@v2` and `actions/setup-node@v4` actions produce a working PATH-installed `bun` and `node` respectively on all three OS runners | Pattern 5 | LOW — both actions are widely used in production CI. |
| A6 | Cold-start measurement on the `--version` path is dominated by binary load + JIT, not by the trivial argv parse + JSON read | Pitfall 6 | LOW — confirmed by Bun's own benchmarks (~9-15ms hello-world cold start). The `--version` path adds a few microseconds at most. |
| A7 | The seed `tests/cli.test.ts` running `process.execPath` will work under both Bun (where `process.execPath` is the Bun binary) and Node (where it's the node binary), provided `--import tsx` is available in both | Code Examples | MEDIUM — Bun bundles tsx-equivalent transpilation natively (`bun src/cli.ts` runs TS directly); under Bun the test may need to use `bun` instead of `process.execPath` + `--import tsx`. Phase 15 may need a small runtime-detection branch in the test setup. |
| A8 | The workspace can publish `apps/achilles-terminal/package.json` as `name: "achilles"` even though the directory is `achilles-terminal` — npm uses the package.json `name`, not the directory | Pattern 2 | LOW — standard npm behavior. The directory name is a developer-facing convention; the published name is whatever package.json says. |

## Open Questions

1. **Should the bin shim be hand-authored JS or generated from a TS source via tsc?**
   - What we know: hand-authored JS is simpler (30 lines, no build step for the shim itself); TS source + tsc emit is more consistent with the rest of the workspace.
   - What's unclear: whether the TS-emit version surfaces typing bugs in the shim's resolve fallback path that a hand-authored JS file would miss.
   - Recommendation: hand-author the shim as plain ESM JS (committed to `src/shim/cli.shim.js`). Copy verbatim into `dist/cli.js` during build. The shim is THE most critical 30 lines in the entire package — readability and explicit-ness trump consistency with the TS toolchain. Alternative: write it in TS at `src/shim/cli.shim.ts` and emit with `tsc --outFile` — Phase 15 plan can choose either.

2. **Should the platform-binary packages include a `README.md` in their tarball?**
   - What we know: npm packages without a README still publish; adoption guidance says "include one."
   - What's unclear: whether the 5 sibling packages need individual READMEs or can share a single template that says "this is a binary package consumed by `achilles`; do not install directly."
   - Recommendation: ship a 5-line shared template README in each sibling package. Phase 15 deliverable; planner adds the shared template generation to `build-binaries.mjs`.

3. **Should Phase 15 wire workspace internal dependencies (`@achilles/voice-protocol` etc.) into `apps/achilles-terminal/package.json` now, or wait for Phase 17?**
   - What we know: listing them now is harmless (they're transitively reachable via the root workspace); listing them later avoids any accidental Phase 15 import of LOOP-02-locked code.
   - What's unclear: nothing technical; this is a planning preference.
   - Recommendation: Phase 15 does NOT add the workspace internal deps. Phase 17 adds them when the imports materialize. This enforces the LOOP-02 byte-for-byte boundary at the package.json level.

4. **What's the latency target for the JS fallback path under Node 22 — strictly <200ms or also <50ms if achievable?**
   - What we know: Node 22 cold start for an esbuild-bundled ESM file is ~50-80ms typical; the DIST-05 budget is <200ms.
   - What's unclear: whether to record cold-start under Node 22 for the SUMMARY.md or only under Bun-compiled.
   - Recommendation: Phase 15 captures BOTH cold-start figures (Bun-binary <50ms target, Node-bundle <200ms target). Manual paste into SUMMARY.md per CONTEXT.md.

5. **Is `npm install -g` of a workspace package with `optionalDependencies` pointing at other workspace packages a supported install path during local dev?**
   - What we know: `npm install -g $(npm pack)` after building tarballs works. `npm install -g .` from the workspace directory is a documented edge case.
   - What's unclear: whether the resolver picks up the un-published-but-symlinked sibling packages during global install in dev.
   - Recommendation: Phase 15 verifies in a dev smoke test by tarballing all 6 packages (`npm pack` x6), then `npm install -g ./achilles-1.3.0.tgz ./achilles-cli-darwin-arm64-1.3.0.tgz` and confirming the shim resolves the platform binary correctly. The smoke is part of the phase's success criteria.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | `bun build --compile`, `bunx vitest` (dual-runtime CI matrix) | ✗ (host machine; CI installs via `oven-sh/setup-bun@v2`) | — | — (CI step installs Bun; locally developer installs via curl from bun.sh) |
| Node 22+ | tsc, esbuild, vitest under Node, the JS fallback bundle runtime | ✓ (host has `npm 10.9.3` per root package.json line 11; Node 22 implied) | — | — |
| npm 10.9.3 | Workspace install + publish | ✓ | 10.9.3 (pinned in root `packageManager`) | — |
| GitHub Actions runners (ubuntu-latest, macos-latest, macos-13, windows-latest, ubuntu-22.04-arm) | dual-runtime CI matrix + per-OS binary build | n/a (CI-only) | — | — |
| sox, ffmpeg | NOT needed in Phase 15 (INIT-07 explicitly bypasses pipeline boot) | n/a | — | — (Phase 18 detects them via `achilles init`) |
| ELEVENLABS_API_KEY | NOT needed in Phase 15 | n/a | — | — |

**Missing dependencies with no fallback:** none for Phase 15.
**Missing dependencies with fallback:** Bun must be installed on developer workstations to run `bun build --compile` locally. The CI matrix installs Bun automatically; local dev requires `curl -fsSL https://bun.sh/install | bash` per Bun's docs (one-time setup). Document this in the Phase 15 plan's "Operator Setup" section.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (pinned at root in `package.json:41`) |
| Config file | `apps/achilles-terminal/vitest.config.ts` (Phase 15 creates this) |
| Quick run command | `npm test --workspace apps/achilles-terminal` |
| Full suite command | `npm test --workspace apps/achilles-terminal -- --pool=forks` (forks pool works under both Bun and Node) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-01 | Package shape is publishable (correct `bin`, `type: "module"`, `engines`, `optionalDependencies` keys) | unit (package.json shape) | `npm pack --dry-run --workspace apps/achilles-terminal` (asserts no errors; can be wrapped in a vitest test that invokes `npm pack --dry-run` as subprocess) | ❌ Wave 0 — Phase 15 creates the package.json + test |
| DIST-02 | Bin shim resolves platform binary via `import.meta.resolve` and falls through to Node bundle on resolve failure | unit (shim behavior) | `vitest run tests/shim.test.ts` (Wave 0 creates a mock platform-package layout in a temp dir, asserts shim execs the mock binary; second test deletes the mock and asserts fallback to bundle) | ❌ Wave 0 |
| DIST-02 | `bun build --compile --target=bun-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64}` produces working binaries that print `--version` | integration (build + smoke) | CI matrix: `bun build --compile ...` then run output binary `--version`, assert exit 0 + non-empty stdout | ❌ Wave 0 — workflow file `.github/workflows/achilles-terminal-ci.yml` |
| DIST-02 | `esbuild` Node bundle produces a runnable `dist/main.js` under Node 22 | integration | `node dist/main.js --version` from CI, assert exit 0 + matching version string | ❌ Wave 0 — `scripts/build-node-bundle.mjs` |
| DIST-05 | Cold-start latency baseline captured | manual measurement | `hyperfine --warmup 0 --runs 50 'apps/cli-darwin-arm64/bin/achilles --version'` on each platform; record P50/P95 into SUMMARY.md | ❌ Wave 0 — operator captures manually post-build |
| INIT-07 | `achilles --version` exits 0 and prints version without ELEVENLABS_API_KEY | unit | `vitest run tests/cli.test.ts` (the seed test in Code Examples above) | ❌ Wave 0 — Phase 15 creates `tests/cli.test.ts` |
| GATE-04 (CI half) | Dual-runtime CI matrix runs full vitest suite green on every commit under both Bun 1.3+ AND Node 22+ across {linux, macos, windows} | CI gate | The CI workflow itself is the test; PRs cannot merge red | ❌ Wave 0 — `.github/workflows/achilles-terminal-ci.yml` |
| GATE-04 (lint half) | ESLint baseline established with rule slot for `stdio:"ignore"` ban | lint | `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` | ❌ Wave 0 — `eslint.config.js` |

### Sampling Rate

- **Per task commit:** `npm test --workspace apps/achilles-terminal` (vitest run; ~5-10s)
- **Per wave merge:** `npm run lint --workspace apps/achilles-terminal && npm run typecheck --workspace apps/achilles-terminal && npm test --workspace apps/achilles-terminal -- --pool=forks` (full suite + lint + typecheck)
- **Phase gate:** Full suite green under both Bun and Node runtimes across all three OSes in CI; plus a manual local smoke (5x `bun build --compile` runs producing 5 binaries that each print `--version` correctly); plus the cold-start latency capture pasted into the SUMMARY.

### Wave 0 Gaps

- [ ] `apps/achilles-terminal/package.json` — workspace + bin + optionalDependencies + scripts (NEW)
- [ ] `apps/achilles-terminal/tsconfig.json` — NodeNext ESM + strict (NEW)
- [ ] `apps/achilles-terminal/eslint.config.js` — flat config + typescript-eslint + prettier disable (NEW)
- [ ] `apps/achilles-terminal/vitest.config.ts` — Node env + forks pool (NEW)
- [ ] `apps/achilles-terminal/src/cli.ts` — argv parse + --version + stub (NEW)
- [ ] `apps/achilles-terminal/src/shim/cli.shim.js` — the 30-line bin shim (NEW; hand-authored ESM JS, copied to `dist/cli.js` at build)
- [ ] `apps/achilles-terminal/scripts/build-binaries.mjs` — wraps `bun build --compile` 5x (NEW)
- [ ] `apps/achilles-terminal/scripts/build-node-bundle.mjs` — wraps esbuild (NEW)
- [ ] `apps/achilles-terminal/tests/cli.test.ts` — INIT-07 assertion (NEW)
- [ ] `apps/achilles-terminal/tests/shim.test.ts` — DIST-02 shim behavior (NEW)
- [ ] `apps/cli-darwin-arm64/package.json` — name + os + cpu + files (NEW)
- [ ] `apps/cli-darwin-x64/package.json` — (NEW; same shape)
- [ ] `apps/cli-linux-x64/package.json` — (NEW)
- [ ] `apps/cli-linux-arm64/package.json` — (NEW)
- [ ] `apps/cli-win32-x64/package.json` — (NEW)
- [ ] `apps/cli-*/README.md` — 5-line shared template (NEW)
- [ ] `apps/cli-*/.gitignore` — ignore `bin/` (CI-generated artifacts) (NEW)
- [ ] `.github/workflows/achilles-terminal-ci.yml` — dual-runtime matrix + per-OS compile matrix (NEW)

## Security Domain

`security_enforcement` is not explicitly set in `.planning/config.json` → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in Phase 15 — INIT-07 explicitly bypasses key resolution. |
| V3 Session Management | no | No sessions in Phase 15. |
| V4 Access Control | no | Single-user CLI; no access control surface in scaffold. |
| V5 Input Validation | minimal | argv parse only; no untrusted input until Phase 18 init wizard. |
| V6 Cryptography | no | No crypto in Phase 15. Phase 18 adds API-key encryption via libsodium secretbox. |
| V10 Malicious Code (supply chain) | YES | Every external package install is a supply-chain risk surface. `package-lock.json` + `npm audit signatures` + the Package Legitimacy Audit section above are the controls. |
| V11 Errors and Logging | minimal | The fatal handler in `src/cli.ts` MUST emit a real error message (defends against v1.2-silent-launch shape per PITFALLS.md §1). |
| V12 Configuration | YES | The `engines.node: ">=22.0.0"` floor and the `optionalDependencies` os/cpu filters are configuration controls that prevent install on unsupported substrates. |
| V14 Configuration & Dependency | YES | Pin every dev dep to an exact version OR caret-major-pinned version; run `npm audit signatures` in the Phase 15 CI workflow. |

### Known Threat Patterns for Bun/Node ESM Scaffold

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted package install (hallucinated dep) | Tampering (supply chain) | Package Legitimacy Audit (above) + slopcheck (best-effort, currently unavailable) + manual review of every `npm install` line before merge |
| postinstall script malware (any transitive dep) | Tampering, Elevation of Privilege | `--ignore-scripts` policy on first install; review of every direct + transitive postinstall script in the lockfile before merge |
| Cross-ecosystem confusion (Python vs npm name collision) | Tampering | All Phase 15 packages confirmed against the **npm** registry (not PyPI / crates / RubyGems) — see Package Legitimacy Audit |
| Lockfile drift between CI and local | Tampering | `npm ci` (NOT `npm install`) in CI; lockfile committed to git |
| Built binary tampering at distribution | Tampering | Phase 19 concern (codesign + notarytool for macOS, optionally Windows). Phase 15 prepares the bin shape but does not publish. |
| Silent-launch failure mode (the v1.2 replay) | Information disclosure (lack of) | Fatal handler in `src/cli.ts` emits explicit error; `stdio:"ignore"` ban (Phase 19 lint rule slot exists in `eslint.config.js`); Phase 15 CI matrix runs `--version` smoke against every compiled binary |

## Sources

### Primary (HIGH confidence)

- **`.planning/research/v1.3-terminal-pivot.md`** §§1-3, §8 — primary architecture research, build-compile + optionalDependencies + shim references
- **`.planning/research/STACK.md`** §§Core Technologies, Supporting Libraries, Stack Patterns by Variant — locked stack picks + version pins
- **`.planning/research/ARCHITECTURE.md`** §§Build Order, Test Seams, Component Responsibilities, Bun-compile Single-Binary Distribution Wiring — integration view + workspace topology
- **`.planning/research/PITFALLS.md`** §§Pitfall 1 (silent-launch replay), Pitfall 8 (Bun ↔ Node runtime drift) — failure modes Phase 15 must structurally prevent
- **`.planning/research/SUMMARY.md`** §Phase 15: Workspace Scaffold + Bun Build Pipeline — phase summary + rationale
- **`/Users/lakshmanturlapati/Documents/Codes/Handoff/package.json`** lines 12-15, 36-42 — verified workspace globs (`apps/*` + `packages/*`) cover new directories; root devDeps include typescript 5.7.3 + vitest 2.1.8 + @types/node 22.10.5
- **`/Users/lakshmanturlapati/Documents/Codes/Handoff/apps/achilles-cli/package.json`** lines 9-11, 20, 32 — verified existing `bin: { "achilles": "./dist/cli.js" }` pattern + `engines.node: ">=22.0.0"` + commander 13.1.0
- **[Bun single-file executables](https://bun.com/docs/bundler/executables)** — `--compile --target=bun-{darwin,linux,windows}-{x64,arm64}` flag matrix
- **[Bun v1.3.14 release](https://bun.com/blog/bun-v1.3.14)** — latest stable (2026-06-04)
- **[Bun child_process](https://bun.com/reference/node/child_process/spawn)** — node-compat shim over `posix_spawn(3)`
- **[Node.js import.meta.resolve](https://nodejs.org/api/esm.html#importmetaresolvespecifier)** — sync stable in Node 22.0.0
- **[esbuild PR #1621](https://github.com/evanw/esbuild/pull/1621)** — canonical reference for the `optionalDependencies` + `os`/`cpu` pattern
- **[pnpm 11.2 release](https://pnpm.io/blog/releases/11.2)** — confirms pnpm honors the same pattern
- **[npm package.json: os field](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#os)** and **[cpu field](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#cpu)** — accepted values + install-filter semantics

### Secondary (MEDIUM confidence)

- **[oven-sh/setup-bun@v2](https://github.com/oven-sh/setup-bun)** — GitHub Action for installing Bun in CI
- **[actions/setup-node@v4](https://github.com/actions/setup-node)** — official Node setup action
- **[typescript-eslint flat config docs](https://typescript-eslint.io/getting-started)** — unified package + `recommended-type-checked` preset
- **[Sentry: Publishing Binaries on npm](https://sentry.engineering/blog/publishing-binaries-on-npm)** — modern walkthrough of the optionalDependencies pattern (2024-2025)
- **[GitHub Actions Linux ARM64 runner](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners/about-github-hosted-runners#standard-github-hosted-runners-for-public-repositories)** — `ubuntu-22.04-arm` confirmed as a supported runner

### Tertiary (LOW confidence — verified during planning)

- ESLint 10.x flat-config behavior on edge cases (verify in Phase 15 spike against the actual installed version)
- `import.meta.resolve` behavior under `bun build --compile` (the embedded-asset case; verify the shim's resolve fallback path works against a Bun-compiled binary in the Phase 15 CI matrix)
- Cold-start latency on `hyperfine` accuracy (verify by also capturing `time -p` and `bash -c 'date +%s%N'`-style measurements for cross-checking)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified against the npm registry on 2026-06-08 + cross-referenced against the existing v1.2 monorepo pins; the `optionalDependencies` + `bun build --compile` pattern has 5+ years of production precedent across esbuild, swc, biome, turbo, lightningcss
- Architecture: HIGH — the workspace topology, sibling-package shape, shim resolve pattern, and dual-runtime CI matrix are all directly derived from `.planning/research/ARCHITECTURE.md` §§Build Order, Bun-compile Single-Binary Distribution Wiring + verified against the existing monorepo's root `package.json` workspace globs
- Pitfalls: MEDIUM-HIGH — the v1.2-silent-launch replay shape (Pitfall 1 in `.planning/research/PITFALLS.md`) is the load-bearing failure mode Phase 15 must structurally prevent; Bun ↔ Node runtime drift (Pitfall 8) is well-documented but the specific surface for Phase 15 (`import.meta.resolve` shape, `process.exit` flush, vitest pool under Bun) requires empirical verification in the dual-runtime CI matrix

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (30 days — stable infrastructure scaffolding research with well-established 2026 patterns)
