# Phase 15: Workspace Scaffold + Bun Build Pipeline - Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 18 new files
**Analogs found:** 10 / 18 (8 are genuinely greenfield — see "No Analog Found")

## Project Context

- CLAUDE.md (global): no emojis anywhere; no auto-running applications.
- Root `package.json` already declares `workspaces: ["apps/*", "packages/*"]` (lines 12-15) — Phase 15's new directories are picked up automatically.
- Root devDeps pin `typescript@5.7.3`, `vitest@2.1.8`, `@types/node@22.10.5` (lines 36-42). New workspace reuses these — do NOT re-pin at workspace level.
- Root `tsconfig.base.json` uses `moduleResolution: "Bundler"` and target `ES2022` (NOT NodeNext). Phase 15 OVERRIDES module + moduleResolution to NodeNext per locked v1.3 architecture; this is a known and intentional divergence from the base.
- LOOP-02 invariant: `packages/voice-protocol`, `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge`, `packages/achilles-skill/skill/prompts/companion.md` must NOT be touched.
- No existing `.github/workflows/*.yml` other than `fly-deploy.yml` (web/relay deploy). No existing CI workflow for the npm CLI side — the new dual-runtime workflow is the first of its kind in this repo.
- No existing `vitest.config.ts` anywhere in the monorepo — vitest currently runs via package.json `"test": "vitest run"` with default config discovery.
- No existing `eslint.config.js` or `.eslintrc*` anywhere — Phase 15 establishes the first lint baseline.
- No existing `scripts/build-*.mjs` for binary cross-compile — the closest precedent is `apps/achilles-cli/scripts/check-source-of-truth.mjs` (a Node-22 ESM script with shebang + `[achilles] ` log prefix + injectable seams).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/achilles-terminal/package.json` | workspace manifest (parent) | n/a (config) | `apps/achilles-cli/package.json` | exact role-match, extended shape (adds `optionalDependencies`) |
| `apps/achilles-terminal/tsconfig.json` | typecheck config | n/a (config) | `apps/achilles-cli/tsconfig.json` | role-match, divergent module/moduleResolution |
| `apps/achilles-terminal/eslint.config.js` | lint config (flat) | n/a (config) | NO ANALOG — first lint config in repo | new shape |
| `apps/achilles-terminal/vitest.config.ts` | test config | n/a (config) | NO ANALOG — repo runs vitest via defaults | new shape |
| `apps/achilles-terminal/src/cli.ts` | CLI entry (argv parse) | request-response | `apps/achilles-cli/src/cli.ts` | role-match, MUCH simpler shape (no commander yet) |
| `apps/achilles-terminal/src/shim/cli.shim.js` | bin shim (resolve-then-exec) | request-response | NO ANALOG — net-new 30-line shape | new shape — write from RESEARCH.md spec |
| `apps/achilles-terminal/scripts/build-binaries.mjs` | build script (cross-compile) | batch | `apps/achilles-cli/scripts/check-source-of-truth.mjs` | partial (Node-22 ESM script with shebang); content differs |
| `apps/achilles-terminal/scripts/build-node-bundle.mjs` | build script (esbuild) | batch | `apps/achilles-cli/scripts/check-source-of-truth.mjs` | partial (same script shape; esbuild API is novel) |
| `apps/achilles-terminal/tests/cli.test.ts` | unit test (CLI smoke) | request-response | `apps/achilles-cli/src/cli.test.ts` | role-match |
| `apps/achilles-terminal/tests/shim.test.ts` | unit test (shim resolve) | request-response | `apps/achilles-cli/src/electron-binary-locator.test.ts` | role-match (binary locator pattern) |
| `apps/cli-darwin-arm64/package.json` | platform-binary manifest | n/a (config) | NO ANALOG — first platform-binary sibling | new shape |
| `apps/cli-darwin-x64/package.json` | platform-binary manifest | n/a (config) | NO ANALOG — same as above | new shape |
| `apps/cli-linux-x64/package.json` | platform-binary manifest | n/a (config) | NO ANALOG | new shape |
| `apps/cli-linux-arm64/package.json` | platform-binary manifest | n/a (config) | NO ANALOG | new shape |
| `apps/cli-win32-x64/package.json` | platform-binary manifest | n/a (config) | NO ANALOG | new shape |
| `apps/cli-*/README.md` (x5) | docs (5-line template) | n/a (docs) | `apps/achilles-cli/README.md` | partial (existing README is long; new is template) |
| `apps/cli-*/.gitignore` (x5) | gitignore | n/a (config) | `apps/achilles-cli/src/.gitignore` | partial |
| `.github/workflows/achilles-terminal-ci.yml` | CI workflow (dual-runtime + cross-OS matrix) | event-driven | `.github/workflows/fly-deploy.yml` | partial (same Actions DSL; very different job shape) — primarily write from RESEARCH.md §Pattern 5 spec |

## Pattern Assignments

### `apps/achilles-terminal/package.json` (workspace manifest)

**Analog:** `apps/achilles-cli/package.json` (lines 1-43)

**Reuse verbatim (copy these field shapes):**
```json
// Lines 2, 7, 9-11, 16-21 of apps/achilles-cli/package.json — copy shape, change version
"name": "achilles",
"type": "module",
"bin": { "achilles": "./dist/cli.js" },
"publishConfig": { "access": "public" },
"engines": { "node": ">=22.0.0" }
```

**Reuse `files` array shape** (line 12-15 of analog):
```json
"files": ["dist", "skill", "README.md"]
```
(Analog has `["dist", "README.md"]`; Phase 15 adds `skill` for Phase 17+ companion.md bundling — listed now to lock the publish shape.)

**Reuse `scripts.build` cleanup pattern** (line 23 of analog):
```json
"build": "rm -rf dist .tsbuildinfo && tsc -p tsconfig.json && node scripts/build-node-bundle.mjs"
```
(Analog: `"rm -rf dist .tsbuildinfo && tsc -p tsconfig.json"`. Phase 15 extends with the esbuild step.)

**Reuse `dependencies` line for commander** — analog line 32: `"commander": "13.1.0"`.

**New shape (no analog) — `optionalDependencies` block:**
Per RESEARCH.md §Pattern 2 — list five `@achilles/cli-<platform>-<arch>` entries pinned at `1.3.0`. The shim resolves these at runtime.

**Divergences from analog (intentional):**
- Analog uses `bundledDependencies: ["@achilles/achilles-skill"]` (line 34-36). Phase 15 does NOT add this — workspace internal deps are wired in Phase 17, not 15 (LOOP-02 + Open Question #3 in RESEARCH.md).
- Analog has `prepack` + `prepublishOnly` (lines 26-27) that run the check-source-of-truth scripts. Phase 15 SKIPS these — publish gating is a Phase 19 concern.

---

### `apps/achilles-terminal/tsconfig.json` (typecheck config)

**Analog:** `apps/achilles-cli/tsconfig.json` (lines 1-19)

**Reuse shape:**
```json
// Lines 1-7, 16-18 of analog — same extends + outDir/rootDir/include/exclude shape
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "./.tsbuildinfo",
    "sourceMap": true,
    ...
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "test/**"]
}
```

**Divergence from analog (LOCKED):**
- Analog (line 10-11) sets `"moduleResolution": "NodeNext", "module": "NodeNext"` — **same as Phase 15 needs** (good — copy verbatim).
- Phase 15 ADDS per RESEARCH.md §Code Examples > Workspace tsconfig.json: `verbatimModuleSyntax: true`, `exactOptionalPropertyTypes: true`, `target: "ES2024"`, `lib: ["ES2024"]`. The base tsconfig sets `target: "ES2022"` (line 3 of `tsconfig.base.json`) — Phase 15 overrides to ES2024.
- Phase 15 sets `declaration: false` (analog has `true`, lines 7-8) — the new workspace ships a CLI, not a library; no `.d.ts` emit needed.
- Phase 15 adds `"tests/**/*.ts"` and `"scripts/**/*.mjs"` to `include` per RESEARCH.md spec.

---

### `apps/achilles-terminal/eslint.config.js` (flat lint config)

**Analog:** NO ANALOG — first ESLint config in the monorepo. Existing `apps/achilles-cli/package.json` line 25 has `"lint": "echo \"(lint placeholder for apps/achilles-cli)\""` (placeholder; no real config exists).

**Write from spec:** RESEARCH.md §Code Examples > Workspace `eslint.config.js` (flat config) is the reference implementation. Copy the entire block as-is. Key requirements:
- Flat config (NOT `.eslintrc.json`) — ESLint 10.x is flat-first per Pitfall 8.
- `tseslint.configs.recommendedTypeChecked` preset with `parserOptions.project: "./tsconfig.json"`.
- `eslint-config-prettier` LAST in the chain.
- Empty `rules` block with comment-slot for the Phase 19 `stdio:"ignore"` `no-restricted-syntax` rule.
- `ignores: ["dist", "node_modules", "**/*.cjs"]`.

---

### `apps/achilles-terminal/vitest.config.ts` (test config)

**Analog:** NO ANALOG — no existing `vitest.config.*` in the monorepo (all existing `vitest run` calls use defaults).

**Write from spec:** RESEARCH.md §Validation Architecture > Test Framework specifies the minimum: `environment: "node"`, `pool: "forks"` (per Pitfall 9 — Bun's vitest with thread pool emits `worker_threads` warnings).

Minimal config (write from spec):
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts"],
  },
});
```

---

### `apps/achilles-terminal/src/cli.ts` (CLI entry)

**Analog:** `apps/achilles-cli/src/cli.ts` (lines 1-50, 103-119, 159-200)

**Reuse the shebang line (analog line 1):**
```typescript
#!/usr/bin/env node
```
(C9 assertion in the analog test surface — file-level invariant.)

**Reuse the package.json version-read pattern (analog lines 36-39, 103-119):**
```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(HERE, "..", "package.json");
const packageVersion: string = JSON.parse(
  readFileSync(packageJsonPath, "utf8"),
).version as string;
```
(The "walk one directory up from HERE" pattern resolves correctly under both vitest-source path AND dist-bundled path. See analog lines 109-115 for the rationale comment — copy that rationale.)

**Divergences from analog (intentional Phase 15 simplification):**
- Analog uses commander with injected `CliDeps` seam (lines 71-101, 159-200). Phase 15 cli.ts does NOT use commander yet — RESEARCH.md §Code Examples > Seed src/cli.ts is a raw `argv.includes("--version")` switch (see lines 615-662 of RESEARCH.md). commander arrives in Phase 16+ when subcommands materialize (per RESEARCH.md Code Examples comment "No commander use yet — for --version only, raw argv is sufficient").
- Analog imports `./commands/launch.js`, `./commands/install-skill.js`, etc. Phase 15 has NO such commands — only `--version`, `--latency-probe` (stub), and a "not implemented" branch for any other command.
- Analog uses `runCli(inputs)` exported function for testability. Phase 15 cli.ts is a single `main()` async function (simpler; sufficient for the seed test surface).

**Critical: use `process.stdout.write(version + "\n", () => process.exit(0))`** per Pitfall 5 (Bun stdout flush-on-exit gotcha). Analog uses `console.log` via commander — RESEARCH.md explicitly upgrades the new shape to the callback form.

---

### `apps/achilles-terminal/src/shim/cli.shim.js` (30-line ESM bin shim)

**Analog:** NO ANALOG — net-new 30-line shape unique to Phase 15.

**Write from spec:** RESEARCH.md §Pattern 3 lines 343-375 is the verbatim reference implementation. Hand-author as plain ESM JS (NOT TS — per RESEARCH.md Open Question #1 recommendation: "hand-author the shim as plain ESM JS… readability and explicit-ness trump consistency with the TS toolchain").

**Key invariants the executor must preserve from the RESEARCH.md spec:**
1. Shebang: `#!/usr/bin/env node` (line 1)
2. Use `import.meta.resolve(pkgName + "/package.json")` (sync return; Node 22+ stable, Bun 1.3+ matches)
3. Wrap in try/catch and fall through cleanly on resolve failure (the package may not be installed)
4. Windows exe suffix check: `const exe = process.platform === "win32" ? "achilles.exe" : "achilles";` (Pitfall 3)
5. `spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" })` — argv pass-through, stdio inherit
6. Fallback: `await import(pathResolve(HERE, "main.js"))` — the esbuild Node bundle
7. Exit code propagation: `process.exit(result.status ?? 0)`

Build step copies `src/shim/cli.shim.js` → `dist/cli.js` verbatim (no transpilation; it's already ESM JS).

---

### `apps/achilles-terminal/scripts/build-binaries.mjs` (cross-compile orchestrator)

**Analog:** `apps/achilles-cli/scripts/check-source-of-truth.mjs` (lines 1-40)

**Reuse the file header shape (analog lines 1-39):**
```javascript
#!/usr/bin/env node
/**
 * <one-line summary>
 *
 * <multi-paragraph rationale + closure-of-pitfall reference>
 *
 * Logging contract (CLAUDE.md global: NO emojis; defence in depth):
 *   - Success: log to stdout with the literal prefix `[achilles] `.
 *   - Failure: log to stderr.
 *
 * No external dependencies. Node 22 stdlib only.
 */
```
(The `[achilles] ` log-prefix convention is established in the analog — Phase 15's build scripts inherit it.)

**Write from spec for body:** RESEARCH.md §Pattern 1 (lines 230-262) — five `bun build --compile --target=...` invocations. Wrap each in a `child_process.spawnSync("bun", [...])` call. After each successful build, `fs.chmodSync(outPath, 0o755)` per Pitfall 4. Iterate over a `targets = [{...}, {...}, ...]` array (greppable, per RESEARCH.md §"Don't Hand-Roll" row "Cross-compile orchestration").

---

### `apps/achilles-terminal/scripts/build-node-bundle.mjs` (esbuild wrapper)

**Analog:** `apps/achilles-cli/scripts/check-source-of-truth.mjs` (lines 1-40) — for file-header + logging-contract pattern only.

**Write body from spec:** RESEARCH.md §Pattern 4 (lines 391-415) is the verbatim reference. Key fields:
```javascript
import * as esbuild from "esbuild";
await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/main.js",
  external: ["@achilles/voice-protocol", "@achilles/voice-stt",
             "@achilles/voice-tts", "@achilles/claude-code-bridge",
             "@achilles/achilles-skill"],
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: "linked",
  legalComments: "linked",
});
```

---

### `apps/achilles-terminal/tests/cli.test.ts` (seed test)

**Analog:** `apps/achilles-cli/src/cli.test.ts` (lines 1-60)

**Reuse the test-file header pattern (analog lines 1-17):**
- File-level comment explaining what the test surface covers (INIT-07 for Phase 15).
- Reference to the C9 shebang assertion as a file-level invariant.

**Reuse the HERE + package.json version read pattern (analog lines 19-28):**
```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(HERE, "..", "package.json"), "utf8"),
).version as string;
```

**Divergences from analog:**
- Analog tests `runCli(inputs)` via injected stream spies (lines 30-60). Phase 15 has no `runCli` export — uses `spawnSync(process.execPath, ["--import", "tsx", CLI_SRC, "--version"])` per RESEARCH.md §Code Examples > Seed tests/cli.test.ts (lines 673-707). Assumption A7 in RESEARCH.md flags that this may need a runtime-detection branch (Bun vs Node).
- Analog has 9 behavior tests (C1-C9). Phase 15 has TWO: "prints non-empty version" and "exits 0 without ELEVENLABS_API_KEY set".

---

### `apps/achilles-terminal/tests/shim.test.ts` (DIST-02 shim behavior)

**Analog:** `apps/achilles-cli/src/electron-binary-locator.test.ts` (binary-resolution test pattern)

**Reuse the pattern:** binary-locator tests use a mock fs / mock directory layout in a temp dir, then assert the locator function (a) returns the binary path when present, (b) throws/falls through when absent. Phase 15's shim test mirrors this: build a mock `node_modules/@achilles/cli-<plat>/` layout in a temp dir, run the shim under it, assert it execs the mock binary; then delete the mock and assert it falls back to `dist/main.js`.

(File not Read in detail — analog file path documented for executor reference. Read it during plan execution.)

---

### `apps/cli-<platform>-<arch>/package.json` (5 platform-binary manifests)

**Analog:** NO ANALOG — first platform-binary sibling packages in this monorepo.

**Write from spec:** RESEARCH.md §Pattern 2 lines 315-326 is the verbatim reference. Shape (per platform, substituting `<plat>` and `<arch>`):
```json
{
  "name": "@achilles/cli-<plat>-<arch>",
  "version": "1.3.0",
  "description": "Bun-compiled achilles binary for <plat> <arch>.",
  "license": "MIT",
  "os": ["<plat>"],
  "cpu": ["<arch>"],
  "files": ["bin/achilles"],
  "publishConfig": { "access": "public" }
}
```

**Critical invariants:**
- NO `bin` field on platform packages (RESEARCH.md §Pattern 2 — only the parent has `bin`).
- `os` values: `"darwin"`, `"linux"`, `"win32"` (Node `process.platform` strings, NOT Bun target strings).
- `cpu` values: `"arm64"`, `"x64"`.
- Windows variant lists `"files": ["bin/achilles.exe"]` (`.exe` suffix).

---

### `apps/cli-*/README.md` (5 shared-template READMEs)

**Analog:** `apps/achilles-cli/README.md` — large file (~4.5KB). Phase 15 does NOT need this size; per RESEARCH.md Open Question #2 recommendation: "ship a 5-line shared template README in each sibling package".

**Write from spec (5-line template):**
```markdown
# @achilles/cli-<plat>-<arch>

This is a platform-binary package consumed by the `achilles` npm CLI.
Do NOT install directly. Install the parent package:

    npm install -g achilles
```

---

### `apps/cli-*/.gitignore`

**Analog:** `apps/achilles-cli/src/.gitignore` (335 bytes — small, role-match)

**Pattern:** Single-line entry ignoring the `bin/` directory (CI-generated artifacts; never committed). Per RESEARCH.md §Runtime State Inventory: "The `apps/cli-<platform>-<arch>/bin/` directories should be `.gitignore`d."

```gitignore
bin/
```

---

### `.github/workflows/achilles-terminal-ci.yml` (dual-runtime CI matrix)

**Analog:** `.github/workflows/fly-deploy.yml` — same GitHub Actions DSL, but a completely different job shape (deploy vs test+compile matrix). The dual-runtime + cross-OS shape is net-new.

**Reuse pattern from analog (the boring stuff):**
- `on: { pull_request: { paths: [...] }, push: { branches: [main] } }` shape (analog lines 75-94)
- `concurrency:` block to cancel in-flight runs (analog lines 96-101)
- `permissions: { contents: read }` minimum-privilege block (analog lines 108-109)
- `actions/checkout@v4` step (analog line 119)

**Write rest from spec:** RESEARCH.md §Pattern 5 lines 425-512 is the verbatim reference workflow. Two jobs:
1. `test` — matrix of `os: [ubuntu-latest, macos-latest, windows-latest] × runtime: [bun, node]` running typecheck + lint + vitest (Bun uses `--pool=forks` per Pitfall 9).
2. `compile-binaries` — matrix of 5 native-OS runners (macos-latest for arm64, macos-13 for x64, ubuntu-latest, ubuntu-22.04-arm, windows-latest), each running `bun build --compile --target=...` for its platform + smoke-testing the output with `--version`.

**Critical Actions versions (per RESEARCH.md §State of the Art):**
- `actions/checkout@v4`
- `actions/setup-node@v4` with `node-version: "22"`
- `oven-sh/setup-bun@v2` with `bun-version: "1.3.14"`

---

## Shared Patterns

### Shebang on every executable

**Source:** `apps/achilles-cli/src/cli.ts` line 1 + `apps/achilles-cli/scripts/check-source-of-truth.mjs` line 1.

**Apply to:**
- `apps/achilles-terminal/src/cli.ts` (line 1)
- `apps/achilles-terminal/src/shim/cli.shim.js` (line 1)
- `apps/achilles-terminal/scripts/build-binaries.mjs` (line 1)
- `apps/achilles-terminal/scripts/build-node-bundle.mjs` (line 1)
- esbuild `banner.js` field for the Node bundle (per RESEARCH.md Pattern 4)

```
#!/usr/bin/env node
```

The analog test surface (`cli.test.ts` C9) asserts the shebang as a file-level invariant — Phase 15 should mirror this assertion in its seed test.

---

### `[achilles] ` stdout log prefix + no-emoji rule

**Source:** `apps/achilles-cli/scripts/check-source-of-truth.mjs` lines 32-38

**Apply to:** all `apps/achilles-terminal/scripts/*.mjs` build scripts.

```
Logging contract (CLAUDE.md global: NO emojis; defence in depth):
  - Success: log to stdout with the literal prefix `[achilles] `.
  - Failure: log to stderr.
```

Aligned with the global CLAUDE.md "never use emojis in terminal logs or readme files" rule.

---

### package.json version-read in src code

**Source:** `apps/achilles-cli/src/cli.ts` lines 103-119

**Apply to:** `apps/achilles-terminal/src/cli.ts` + `apps/achilles-terminal/tests/cli.test.ts`.

```typescript
const HERE = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(HERE, "..", "package.json");
const packageVersion: string = JSON.parse(
  readFileSync(packageJsonPath, "utf8"),
).version as string;
```

The "walk one directory up from HERE" pattern resolves correctly under both vitest-source path (`src/cli.ts → ../package.json`) AND dist-bundled path (`dist/cli.js → ../package.json`). Single source of truth — a future version bump cannot drift the CLI's `--version` output.

---

### Workspace tsconfig "extends base + override locally" pattern

**Source:** `apps/achilles-cli/tsconfig.json` lines 1-2

**Apply to:** `apps/achilles-terminal/tsconfig.json`.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { ... }
}
```

The base file (`/Users/lakshmanturlapati/Documents/Codes/Handoff/tsconfig.base.json`) sets `strict: true`, `noUncheckedIndexedAccess: true`, `target: "ES2022"`, `moduleResolution: "Bundler"`. Phase 15 OVERRIDES `module`/`moduleResolution` to `NodeNext` and `target` to `ES2024` per locked architecture — this is an intentional, documented divergence (RESEARCH.md §Code Examples > Workspace tsconfig.json).

---

### Engines floor `node: ">=22.0.0"`

**Source:** `apps/achilles-cli/package.json` line 19-21

**Apply to:** `apps/achilles-terminal/package.json`.

```json
"engines": { "node": ">=22.0.0" }
```

The floor enforces `import.meta.resolve` synchronous behavior (stable in Node 22+ per Pitfall 2). Platform-binary sibling packages do NOT need an `engines` field — they ship only a binary, no JS execution.

---

### Workspace glob inheritance

**Source:** Root `/Users/lakshmanturlapati/Documents/Codes/Handoff/package.json` lines 12-15

```json
"workspaces": ["apps/*", "packages/*"]
```

**Implication for Phase 15:** All new directories under `apps/` are picked up automatically. NO root-level change required. The planner should NOT modify the root `package.json` — it already covers `apps/achilles-terminal/` and the five `apps/cli-<platform>-<arch>/` packages.

---

## No Analog Found

Files genuinely greenfield — executor writes from RESEARCH.md spec rather than copying an analog:

| File | Role | Data Flow | Reason | Spec Reference |
|------|------|-----------|--------|----------------|
| `apps/achilles-terminal/eslint.config.js` | lint config | n/a | First ESLint config in the monorepo | RESEARCH.md §Code Examples > Workspace `eslint.config.js` (lines 749-783) |
| `apps/achilles-terminal/vitest.config.ts` | test config | n/a | No existing `vitest.config.*` in repo | RESEARCH.md §Validation Architecture > Test Framework |
| `apps/achilles-terminal/src/shim/cli.shim.js` | 30-line bin shim | request-response | Net-new shape; THE critical 30 lines of Phase 15 | RESEARCH.md §Pattern 3 (lines 337-384) |
| `apps/cli-darwin-arm64/package.json` (and 4 siblings) | platform-binary manifest | n/a | First `optionalDependencies`-target package in repo | RESEARCH.md §Pattern 2 (lines 315-326) |
| `apps/cli-*/README.md` | 5-line template README | n/a | Existing README is too long; new shape | RESEARCH.md Open Question #2 |
| `.github/workflows/achilles-terminal-ci.yml` | dual-runtime CI matrix | event-driven | Only existing workflow is fly-deploy (different shape) | RESEARCH.md §Pattern 5 (lines 425-512) |

**Executor note for the planner:** Each "NO ANALOG" entry above carries a verbatim reference block in RESEARCH.md. The plan tasks for these files should be: "implement to spec at RESEARCH.md §<section>; assert post-write that the file matches the spec line-by-line." There is no analog to copy from — the spec is the source of truth.

---

## Files Phase 15 Must NOT Touch (LOOP-02 invariant)

For executor sanity-checking. If any plan task ends up touching these, abort and re-plan:

- `packages/voice-protocol/**` — byte-for-byte locked
- `packages/voice-stt/**` — byte-for-byte locked
- `packages/voice-tts/**` — byte-for-byte locked
- `packages/claude-code-bridge/**` — byte-for-byte locked
- `packages/achilles-skill/skill/prompts/companion.md` — byte-for-byte locked
- `apps/achilles/**` (Electron app) — survives untouched through Phase 18; deletion is Phase 19
- `apps/achilles-cli/**` — survives untouched through Phase 18; deletion is Phase 19
- Root `package.json` — workspace globs already cover Phase 15's new directories; no root change needed

---

## Metadata

**Analog search scope:** `apps/achilles-cli/`, root `package.json`, `tsconfig.base.json`, `.github/workflows/`. Skipped per LOOP-02: `packages/voice-protocol`, `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge`, `packages/achilles-skill`.

**Files Read in full:** 6 (achilles-cli package.json, achilles-cli tsconfig.json, root package.json, tsconfig.base.json, fly-deploy.yml, achilles-cli cli.ts header + cli.test.ts header, check-source-of-truth.mjs header).

**Pattern extraction date:** 2026-06-08

**Confidence:** HIGH on the 10 analog-matched files (existing patterns are mature and well-documented in code comments). MEDIUM on the 8 NO-ANALOG files — executor depends entirely on RESEARCH.md spec accuracy. The shim and CI workflow are load-bearing; verify them empirically in the dual-runtime CI matrix on the first PR (Assumptions A2, A3, A7 in RESEARCH.md).
