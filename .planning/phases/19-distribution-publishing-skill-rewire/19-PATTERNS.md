# Phase 19: Distribution + Publishing + Skill Rewire - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 14 (8 NEW, 6 MODIFIED) + 8 DELETED (commit B)
**Analogs found:** 14 / 14 (all NEW/MODIFIED files have at least one in-tree analog; deleted files do not need analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/achilles-terminal/src/ui/Banner.tsx` (NEW) | component (Ink + React) | event-driven (subscribes to Session error events; auto-dismiss timer) | `apps/achilles-terminal/src/ui/ScreenReader.tsx` (debounced React-state + Box aria-role pattern) + `apps/achilles-terminal/src/ui/VoiceShell.tsx` (composition root + useEffect cleanup pattern) | exact (role + flow) |
| `apps/achilles-terminal/src/error-classifier.ts` (NEW) | utility (mapping table) | transform (SessionErrorClassification -> ClassifiedBanner) | `apps/achilles-terminal/src/circuit-breaker.ts` (ClassifiedErrorKind discriminated-union precedent) + `apps/achilles-terminal/src/session-events.ts` (SessionErrorClassification source-of-truth) | role-match (no existing classifier table; closest is the breaker's classifier shape) |
| `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` (NEW; port) | script (CI release gate) | batch (file-walk + regex scan) | `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` (v1.2 canonical, 306 lines, 7 regexes) | exact (verbatim port; only REPO_ROOT working-directory differs) |
| `apps/achilles-terminal/scripts/check-tarball-no-secrets.test.mjs` (NEW; port) | test (paired script test) | batch (node:test runner + synthetic scanner seam) | `apps/achilles-cli/scripts/check-tarball-no-secrets.test.mjs` (v1.2 canonical, TNS1-TNS6 cases) | exact (verbatim port) |
| `apps/achilles-terminal/scripts/check-deletion-reachability.sh` (NEW; no analog) | script (commit-B reachability audit) | batch (grep + find) | No direct analog; built from first principles per RESEARCH §Pitfall 10's 4-variant grep recipe | no analog (RESEARCH §Pitfall 10 provides the recipe) |
| `.github/workflows/achilles-release.yml` (NEW) | config (GitHub Actions workflow) | event-driven (workflow_dispatch + tag push triggers) | `.github/workflows/achilles-terminal-ci.yml` (308 lines, matrix.os + Bun/Node setup + compile-binaries job already proven on the 3 surviving targets) | exact (extends ci.yml shape with a publish job that needs[]=build-{linux-x64,linux-arm64,win32-x64}) |
| `apps/achilles-terminal/src/install-skill.ts` (NEW; port) | utility (subcommand action) | request-response (CLI invocation -> filesystem mutation -> exit) | `apps/achilles-cli/src/commands/install-skill.ts` (v1.2 canonical, 221 lines) + `apps/achilles-cli/src/skill-symlink.ts` (v1.2 canonical, 324 lines, the primitive) | exact (verbatim port + skill-symlink.ts also ports) |
| `apps/achilles-terminal/src/skill-symlink.ts` (NEW; port) | utility (primitive over node:fs) | request-response (idempotent fs ops + Windows-EPERM fallback) | `apps/achilles-cli/src/skill-symlink.ts` (v1.2 canonical) | exact (verbatim port) |
| `apps/achilles-terminal/package.json` (MOD) | config (manifest) | n/a | `apps/achilles-terminal/package.json` (HEAD shape; only `optionalDependencies` block changes) | self (in-place edit) |
| `apps/achilles-terminal/src/cli.ts` (MOD) | controller (CLI entrypoint dispatcher) | request-response (argv[0]==='install-skill' branch) | Existing 5 dynamic-import gates at lines 92-189 (latency, init, config, transcripts, voice) | exact (add 6th gate following the established INIT-07-preserving shape) |
| `apps/achilles-terminal/src/session.ts` (MOD) | service (composition root) | event-driven (wire Banner via VoiceShell; verify dual-watchdog wiring; verify unconditional logger) | `apps/achilles-terminal/src/session.ts` (HEAD shape; the `runVoice()` body already constructs `createStructuredLogger` indirectly via `Session` constructor at line 352) | self (verify-then-extend, do not refactor) |
| `apps/achilles-terminal/src/ui/VoiceShell.tsx` (MOD) | component (Ink composition root) | event-driven (insert conditional `<Banner />` ABOVE existing children) | `apps/achilles-terminal/src/ui/VoiceShell.tsx` (HEAD shape, lines 130-142 — the `<Box flexDirection="column">` body) | self (insert one JSX child + one hook call) |
| `apps/achilles-terminal/eslint.config.js` (MOD) | config (ESLint flat config) | n/a | `apps/achilles-terminal/eslint.config.js` (HEAD, lines 27-41 already hold the rule verbatim in a comment block) | self (uncomment the prepared slot) |
| `packages/achilles-skill/skill/SKILL.md` (MOD; full rewrite) | docs (Claude Code skill manifest) | n/a | `packages/achilles-skill/skill/SKILL.md` (HEAD, 49 lines, v1.2 Electron-era) for the YAML frontmatter shape + RESEARCH §Code Example 2 (the v1.3 target body) | self (replace body; preserve frontmatter shape) |
| `packages/achilles-skill/package.json` (MOD) | config (manifest) | n/a | `packages/achilles-terminal/package.json` (HEAD shape, lines 17-19 — the `publishConfig.access: public` block that achilles-skill needs to add) | role-match (achilles-terminal is the public-publish template) |
| Root `package.json` scripts (MOD) | config (workspace scripts) | n/a | Root `package.json` HEAD lines 31-33 (the existing `check:source-of-truth` + `check:tarball:secrets` aliases pointing at `apps/achilles-cli/scripts/`) | self (path-rewrite only) |

**DELETED in commit B (no analog required; deletion targets):**

| Path | Reason |
|------|--------|
| `apps/achilles/` (entire Electron tree) | LOOP-02-superseded by terminal TUI |
| `apps/achilles-cli/src/commands/launch.ts` + `launch.test.ts` | Replaced by `achilles voice` foreground path |
| `apps/achilles-cli/` (entire workspace, post-reachability-check) | All v1.2 surfaces ported (install-skill / skill-symlink / check-tarball-no-secrets) or superseded (check-source-of-truth -> Phase 17 single-arm) |
| `apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/` | Dropped pre-publish per D-01/D-02; macOS uses JS-fallback under Bun (Option 3 lock) |

## Pattern Assignments

### `apps/achilles-terminal/src/ui/Banner.tsx` (NEW, component, event-driven)

**Analogs:** `apps/achilles-terminal/src/ui/ScreenReader.tsx` (debounced state + `<Box aria-role>`) and `apps/achilles-terminal/src/ui/VoiceShell.tsx` (useEffect cleanup pattern + JSX layout).

**Imports pattern** — copy from `ScreenReader.tsx` lines 31-34:

```tsx
import { useEffect, useState, type JSX } from "react";
import { Box, Text } from "ink";
import type { AchillesState } from "../state/constants.js";
```

For Banner specifically, the imports become (adapt the type-only import to the error union):

```tsx
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { SessionErrorClassification } from "../session-events.js";
import type { ClassifiedBanner } from "../error-classifier.js";
```

**Auto-dismiss / useEffect cleanup pattern** — copy the SHAPE from `ScreenReader.tsx` lines 44-55:

```tsx
useEffect(() => {
  if (state === displayedState) {
    return; // no transition — nothing to schedule
  }
  const handle = setTimeout(() => {
    setDisplayedState(state);
  }, ANNOUNCEMENT_DEBOUNCE_MS);
  return () => {
    clearTimeout(handle);
  };
}, [state, displayedState]);
```

Adapt for Banner (8 second auto-dismiss + nonce-driven reset; RESEARCH §Pattern 3 + §Pitfall 7):

```tsx
const BANNER_AUTO_DISMISS_MS = 8_000;

// Show banner when errorNonce bumps:
useEffect(() => {
  if (errorNonce !== lastErrNonce && classification !== null) {
    setVisible(true);
    setLastErrNonce(errorNonce);
  }
}, [errorNonce, lastErrNonce, classification]);

// Auto-dismiss after 8s (errorNonce in deps so a new error resets the timer cleanly):
useEffect(() => {
  if (!visible) return;
  const t = setTimeout(() => setVisible(false), BANNER_AUTO_DISMISS_MS);
  return () => clearTimeout(t);
}, [visible, errorNonce]);

// Dismiss on next successful event:
useEffect(() => {
  if (successNonce !== lastSuccessNonce) {
    setVisible(false);
    setLastSuccessNonce(successNonce);
  }
}, [successNonce, lastSuccessNonce]);
```

**Render / `<Box aria-role>` pattern** — copy from `ScreenReader.tsx` lines 56-61:

```tsx
return (
  <Box aria-label={text} aria-role="timer">
    <Text>{text}</Text>
  </Box>
);
```

Adapt for Banner (red `Text` + early-return null when not visible; RESEARCH §Assumption A8 documents that Ink 7 uses `"timer"` as the closest live-region role available — `"status"` is not in Ink 7's role enum per ScreenReader.tsx lines 14-24):

```tsx
if (!visible || classification === null) return null;
return (
  <Box aria-label={`error ${classification.class} ${classification.suggestedAction}`} aria-role="timer">
    <Text color="red">{`[error] ${classification.class} -- ${classification.suggestedAction}`}</Text>
  </Box>
);
```

**File header / docstring pattern** — copy the SHAPE from `ScreenReader.tsx` lines 1-29 (phase/plan/task header, behavior summary, Ink-7-deviation note, LOOP-02 invariant note, `// No emojis (CLAUDE.md global)` line). The Phase 19 header replaces "Plan 03 Task 3" with "Phase 19 Plan XX Task YY" and adds the §Pitfall 7 reference for the `errorNonce`-in-deps guard.

---

### `apps/achilles-terminal/src/error-classifier.ts` (NEW, utility, transform)

**Analog:** `apps/achilles-terminal/src/circuit-breaker.ts` (the existing `ClassifiedErrorKind` discriminated-union pattern at lines 83-88) + `apps/achilles-terminal/src/session-events.ts` (the `SessionErrorClassification` union at lines 44-52 — the SOURCE-OF-TRUTH the classifier maps FROM).

**SessionErrorClassification source** — verbatim from `session-events.ts` lines 44-52:

```ts
export type SessionErrorClassification =
  | "network"
  | "auth"
  | "rate_limit"
  | "server"
  | "unknown"
  | "mic_unavailable"
  | "playback_lost"
  | "claude_failed";
```

**Mapping table pattern** — adapt the discriminated-union mapping shape from `circuit-breaker.ts` lines 83-88 (which discriminates on `ClassifiedErrorKind`). For error-classifier.ts the mapping is a `Record<SessionErrorClassification, ClassifiedBanner>` (RESEARCH §Code Example 3):

```ts
import type { SessionErrorClassification } from "./session-events.js";

export interface ClassifiedBanner {
  readonly class: string;
  readonly suggestedAction: string;
}

const TABLE: Record<SessionErrorClassification, ClassifiedBanner> = {
  network:        { class: "network",    suggestedAction: "retrying..." },
  auth:           { class: "auth",       suggestedAction: "check ELEVENLABS_API_KEY" },
  rate_limit:     { class: "rate-limit", suggestedAction: "ElevenLabs rate limit -- retrying in 30s" },
  server:         { class: "server",     suggestedAction: "ElevenLabs 5xx -- retrying with backoff" },
  mic_unavailable:{ class: "sox",        suggestedAction: "Audio device lost -- restart Achilles" },
  playback_lost:  { class: "ffplay",     suggestedAction: "Audio output lost -- restart Achilles" },
  claude_failed:  { class: "claude",     suggestedAction: "claude subprocess failed -- Ctrl-C and retry" },
  unknown:        { class: "unknown",    suggestedAction: "see ~/.achilles/achilles.log" },
};

export function classifyForBanner(
  classification: SessionErrorClassification,
): ClassifiedBanner {
  return TABLE[classification];
}
```

**Docstring pattern** — copy the SHAPE from `circuit-breaker.ts` lines 1-53 (phase/plan/task header, what-it-is, what-it-isn't, threat model, No-emojis line). The Phase 19 docstring names ERR-01 + cites `session-events.ts` as the source-of-truth union.

---

### `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` (NEW; port)

**Analog:** `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` (v1.2 canonical, 306 lines).

**Imports** — copy verbatim from v1.2 lines 42-49:

```js
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join, relative, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
```

**7-regex KEY_PATTERNS set** — copy verbatim from v1.2 lines 58-95 (the `Object.freeze` block with 7 named patterns: elevenlabs-sk_, elevenlabs-xi-api-key, elevenlabs-xi_api_key-assignment, elevenlabs-env-assignment, anthropic-sk-ant, github-pat, github-fine-grained-pat). All 7 regexes ship unchanged.

**SCANNABLE_EXTENSIONS** — copy verbatim from v1.2 lines 97-108 (10 extensions: `.md, .txt, .js, .mjs, .cjs, .json, .html, .css, .ts, .tsx`).

**walkFiles + truncateMatch helpers** — copy verbatim from v1.2 lines 110-147.

**defaultScannerSeam — only path change** — copy the SHAPE from v1.2 lines 152-203 but change the `cliDir` line:

```js
// v1.2 (apps/achilles-cli source):
const cliDir = resolve(REPO_ROOT, "apps/achilles-cli");

// v1.3 (Phase 19 port):
const cliDir = resolve(REPO_ROOT, "apps/achilles-terminal");
```

Everything else (`npm pack --pack-destination` + `tar -xzf` + `mkdirSync(recursive: true)` per CR-04 cross-platform fix) ships unchanged.

**runTarballSecretScan async function** — copy verbatim from v1.2 lines 213-269 (the listFiles + filter + per-pattern exec loop + leak-count tally + processExitImpl call).

**Invocation guard** — copy verbatim from v1.2 lines 272-305 (the `invokedAsScript` IIFE + the try/catch wrapper around runTarballSecretScan).

**stdio caveat** — v1.2's `defaultScannerSeam` at line 164 uses `stdio: ["ignore", "pipe", "pipe"]` and at line 189 uses `stdio: "ignore"`. Per the ESLint rule scope (apps/achilles-terminal/eslint.config.js only), the `scripts/` directory is included in eslint.config.js's untyped-recommended block (lines 47-50) but the `no-restricted-syntax` rule is in the typed-checked block (lines 13-44) — so the new selector does NOT match `scripts/*.mjs` files. Confirm in the Phase 19 plan that the prepared rule shape (lines 27-41 selector) only fires for src/**/*.ts files.

---

### `apps/achilles-terminal/scripts/check-tarball-no-secrets.test.mjs` (NEW; port)

**Analog:** `apps/achilles-cli/scripts/check-tarball-no-secrets.test.mjs` (v1.2 canonical).

**Imports + buildBuffer + buildScannerSeam** — copy verbatim from v1.2 lines 21-59 (the `node:test` + `node:assert` import + the in-memory file-map scanner seam).

**TNS1-TNS6 test cases** — copy verbatim. The v1.2 SOURCE-OF-TRUTH check (TNS6) reads `packages/achilles-skill/skill/SKILL.md` + `companion.md` via `REPO_ROOT` and asserts the rewritten SKILL.md (Phase 19 D-03 output) STILL passes the 7-regex scan. This test is load-bearing for Phase 19 because the rewrite must not introduce a new key-shaped string (the rewrite is prose only; no code).

**Path change** — same as the script: change `REPO_ROOT = resolve(HERE, "..", "..", "..")` is identical (relative depth matches: `apps/achilles-cli/scripts/X.mjs` <-> `apps/achilles-terminal/scripts/X.mjs`).

---

### `apps/achilles-terminal/scripts/check-deletion-reachability.sh` (NEW; no analog)

**Analog:** None in-tree. Built from RESEARCH §Pitfall 10's 4-variant grep recipe.

**Skeleton** — RESEARCH §Pitfall 10 verbatim:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Phase 19 commit B reachability audit. Run BEFORE deleting apps/achilles-cli/
# to verify zero importers remain from the published surface.

cd "$(git rev-parse --show-toplevel)"

EXIT=0
echo "[reachability] Checking for relative imports..."
if grep -rn "from ['\"]\\.\\./achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .; then
  echo "[reachability] FAIL: relative import of achilles-cli found" >&2
  EXIT=1
fi

echo "[reachability] Checking for scoped imports..."
if grep -rn "from ['\"]@achilles/achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .; then
  echo "[reachability] FAIL: scoped @achilles/achilles-cli import found" >&2
  EXIT=1
fi

echo "[reachability] Checking for dynamic imports..."
if grep -rn "import.*achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .; then
  echo "[reachability] FAIL: dynamic import of achilles-cli found" >&2
  EXIT=1
fi

echo "[reachability] Checking for require()..."
if grep -rn "require.*achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .; then
  echo "[reachability] FAIL: CommonJS require of achilles-cli found" >&2
  EXIT=1
fi

echo "[reachability] Checking root scripts for achilles-cli paths..."
if grep -n "apps/achilles-cli" package.json; then
  echo "[reachability] FAIL: root package.json still references apps/achilles-cli" >&2
  EXIT=1
fi

# Belt-and-braces: run a full workspace typecheck after deletion would land.
# (The planner should invoke this AFTER the simulated delete, not here — this
# script is a static-grep gate.)

if [ "$EXIT" -eq 0 ]; then
  echo "[reachability] OK: no live importers of apps/achilles-cli remain"
fi
exit "$EXIT"
```

**Used in Phase 19 plan:** Run this script as the LAST step before committing commit B. RESEARCH §Pitfall 10 also recommends `npm run build --workspaces --if-present` as a follow-on dynamic check. Wire both into the commit-B precondition.

---

### `.github/workflows/achilles-release.yml` (NEW)

**Analog:** `.github/workflows/achilles-terminal-ci.yml` (308 lines).

**Workflow header / triggers** — adapt from ci.yml lines 38-62 (the existing `name`, `on.pull_request.paths`, `on.push.branches`, `concurrency` blocks). The release workflow drops `pull_request` and uses `workflow_dispatch` + `push.tags: [v*]` per RESEARCH §Open Question 5:

```yaml
name: achilles-release

on:
  workflow_dispatch: {}
  push:
    tags:
      - "v*"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false  # release runs MUST complete; no cancellation
```

**Permissions** — copy from ci.yml lines 67-68 and extend with `id-token: write` for npm provenance (RESEARCH §Code Example 1):

```yaml
permissions:
  contents: read
  id-token: write   # for npm provenance (--provenance flag)
```

**Build-matrix jobs** — copy verbatim from ci.yml lines 233-307 (the `compile-binaries` job) BUT trim the `target.name` matrix from 5 entries to 3: keep `linux-x64`, `linux-arm64`, `win32-x64`; DROP `darwin-arm64`, `darwin-x64`. Reference: D-01 / D-02 in CONTEXT.md.

**Standard setup steps (copy verbatim from ci.yml lines 80-99):**

```yaml
- name: Check out repository
  uses: actions/checkout@v4

- name: Set up Node.js 22
  uses: actions/setup-node@v4
  with:
    node-version: "22"
    cache: "npm"

- name: Set up Bun 1.3.14
  uses: oven-sh/setup-bun@v2
  with:
    bun-version: "1.3.14"

- name: Install workspace dependencies
  # D-15-02: --include=optional --force is mandatory for cross-platform npm 10.9.3.
  run: npm ci --include=optional --force
```

**Build-artifact upload** — copy SHAPE from ci.yml lines 279-307 (the `Compile binary` + `Smoke test - achilles --version` block) but ADD an `actions/upload-artifact@v4` step so the publish job downloads the binary. Pattern:

```yaml
- name: Compile binary
  working-directory: apps/achilles-terminal
  run: |
    mkdir -p ../$(dirname '${{ matrix.target.out }}')
    bun build src/cli.ts --compile --target=${{ matrix.target.bunTarget }} --outfile=../${{ matrix.target.out }} --minify

- name: Upload binary artifact
  uses: actions/upload-artifact@v4
  with:
    name: cli-${{ matrix.target.name }}-binary
    path: apps/${{ matrix.target.out }}
```

**Publish job** — copy verbatim from RESEARCH §Code Example 1 lines 538-642 (the full publish + macos-smoke sequence with siblings-first ordering per Pattern 2). The publish job:
1. `needs: [build-linux-x64, build-linux-arm64, build-win32-x64]`
2. Downloads all 3 binary artifacts
3. Runs `node apps/achilles-terminal/scripts/check-source-of-truth.mjs` (Phase 17 single-arm)
4. Runs `node apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` (NEW Phase 19 port)
5. Publishes 4 sub-packages then parent in this order (Pattern 2 in RESEARCH):
   - `@achilles/cli-linux-x64`
   - `@achilles/cli-linux-arm64`
   - `@achilles/cli-win32-x64`
   - `@achilles/achilles-skill`
   - `achilles` (parent, LAST)
6. `sleep 30 && npm view achilles@1.3.0 version` for CDN propagation (RESEARCH §Pitfall 9)
7. macOS smoke job (`macos-14` runner): `bunx achilles@1.3.0 --version` + `achilles --version` under Node (DIST-06 verification)

---

### `apps/achilles-terminal/src/install-skill.ts` (NEW; port)

**Analog:** `apps/achilles-cli/src/commands/install-skill.ts` (v1.2 canonical, 221 lines).

**Imports** — copy verbatim from v1.2 lines 39-60:

```ts
import { homedir as nodeHomedir } from "node:os";
import { join, resolve } from "node:path";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { SKILL_PROMPTS_DIR } from "@achilles/achilles-skill";

import {
  ExistingDestinationConflictError,
  installSkillSymlink,
  SymlinkNotPermittedError,
} from "./skill-symlink.js";        // <-- v1.2 path was "../skill-symlink.js"; v1.3 puts skill-symlink.ts in the SAME directory as install-skill.ts
import type {
  InstallSkillSymlinkFs,
  InstallSkillSymlinkLogger,
} from "./skill-symlink.js";
```

The only port-time adjustment is the `from "./skill-symlink.js"` (v1.3 flat layout) vs `from "../skill-symlink.js"` (v1.2 commands/-subdirectory layout).

**InstallSkillCommandOptions interface** — copy verbatim from v1.2 lines 82-92 (the `force + stdout + processExitImpl` triple + 5 optional seams).

**productionFs constant** — copy verbatim from v1.2 lines 99-125 (the 6-method `node:fs` seam binding).

**defaultSkillSourceProvider helper** — copy verbatim from v1.2 lines 134-136 (`resolve(SKILL_PROMPTS_DIR, "..")` to walk up to the skill root).

**buildStdoutLogger helper** — copy verbatim from v1.2 lines 144-149.

**installSkillCommand action handler** — copy verbatim from v1.2 lines 158-219 (the destructure + installSkillSymlink call + try/catch with three branches: ExistingDestinationConflictError, SymlinkNotPermittedError, generic Error).

**Header docstring** — replace v1.2 references to `apps/achilles-cli/src/cli.ts` (line 17) with `apps/achilles-terminal/src/cli.ts`. Replace v1.2 plan reference `Plan 13-02` with `Phase 19 Plan XX`.

---

### `apps/achilles-terminal/src/skill-symlink.ts` (NEW; port)

**Analog:** `apps/achilles-cli/src/skill-symlink.ts` (v1.2 canonical, 324 lines).

**FULL VERBATIM PORT** — every line copies unchanged. The module is pure (no relative imports beyond `node:path`):

```ts
import { dirname, resolve } from "node:path";
```

The 9 exported surfaces all port unchanged:

| Export | Lines (v1.2) | Notes |
|--------|--------------|-------|
| `InstallSkillSymlinkFs` interface | 62-87 | 6-method node:fs subset |
| `InstallSkillSymlinkLogger` interface | 103-106 | info + warn |
| `InstallSkillSymlinkOptions` interface | 113-120 | 6-field option bag |
| `InstallSkillSymlinkResult` type | 133-136 | discriminated union (symlink/copy/already-installed) |
| `ExistingDestinationConflictError` class | 146-155 | named error |
| `SymlinkNotPermittedError` class | 165-171 | named error (macOS/Linux) |
| `getErrorCode` helper | 179-183 | string-shape `code` extraction |
| `WINDOWS_FALLBACK_CODES` constant | 185 | `Set(["EPERM", "EACCES", "EISDIR"])` |
| `installSkillSymlink` function | 194-323 | the primitive — handles mkdir + probe + idempotent-already-installed + force-overwrite + symlink + Windows EPERM fallback + TOCTOU race retry on EEXIST |

No path changes (no external import paths). The header docstring replaces `Plan 13-02` with `Phase 19 Plan XX` + replaces references to `apps/achilles-cli/src/commands/install-skill.ts` with `apps/achilles-terminal/src/install-skill.ts`.

---

### `apps/achilles-terminal/package.json` (MOD)

**Analog:** self (in-place edit).

**Exact changes** — current state HEAD lines 46-52:

```json
"optionalDependencies": {
  "@achilles/cli-darwin-arm64": "1.3.0",
  "@achilles/cli-darwin-x64": "1.3.0",
  "@achilles/cli-linux-arm64": "1.3.0",
  "@achilles/cli-linux-x64": "1.3.0",
  "@achilles/cli-win32-x64": "1.3.0"
}
```

Target state (D-01 drops the 2 darwin entries):

```json
"optionalDependencies": {
  "@achilles/cli-linux-arm64": "1.3.0",
  "@achilles/cli-linux-x64": "1.3.0",
  "@achilles/cli-win32-x64": "1.3.0"
}
```

**No other field changes.** `name: "achilles-terminal"` stays. `version: "1.3.0"` already set (no bump needed). `bin: { achilles: ./dist/cli.js }` stays. `publishConfig.access: public` already set. `engines.node: ">=22.0.0"` already set.

**prepublishOnly hook** — does NOT exist in HEAD scripts block (lines 23-31). Phase 19 adds it. Pattern from v1.2 `apps/achilles-cli/package.json` line 27:

```json
"prepublishOnly": "node scripts/check-source-of-truth.mjs && node scripts/check-tarball-no-secrets.mjs"
```

The first script already exists (Phase 17). The second is the Phase 19 NEW port.

---

### `apps/achilles-terminal/src/cli.ts` (MOD)

**Analog:** the existing 5 dynamic-import gates in the same file.

**Pattern** — copy SHAPE from lines 134-140 (the simplest gate, `config`):

```ts
if (argv[0] === "config") {
  const { runConfigMenu } = await import("./config-menu.js");
  await runConfigMenu();
  process.exit(0);
  return;
}
```

**Insertion site** — place the new `install-skill` gate AFTER the `transcripts` gate (line 164) and BEFORE the `voice` gate (line 176). Forward arg parsing for `--force` happens INSIDE install-skill.ts (the v1.2 `installSkillCommand` already accepts the `force: boolean` option per install-skill.ts line 83).

**New gate** (INIT-07-preserving — dynamic import only):

```ts
// Phase 19 Plan XX (DIST-03): `install-skill` subcommand dynamic-import gate.
// Symlinks (or on Windows, copies) the skill bundle into ~/.claude/skills/achilles/.
// INIT-07: install-skill.ts and its @achilles/achilles-skill import load only
// here; cli.ts's static-import budget stays at { node:fs/promises, node:url, node:path }.
if (argv[0] === "install-skill") {
  const force = argv.includes("--force");
  const { installSkillCommand } = await import("./install-skill.js");
  installSkillCommand({
    force,
    stdout: process.stdout,
    stderr: process.stderr,
    processExitImpl: (code) => process.exit(code),
  });
  return;
}
```

**INIT-07 invariant test** — the existing `tests/cli.test.ts T8` + `tests/integration/init-07-invariant.test.ts` (cited in cli.ts header lines 19) asserts the top-level static-import budget. The new gate is INSIDE main() with dynamic import, so the test continues to pass unchanged. Phase 19 plan should add a NEW assertion to those tests verifying the `install-skill` branch dispatches correctly.

---

### `apps/achilles-terminal/src/session.ts` (MOD)

**Analog:** self (HEAD state already has the substrate; Phase 19 is verify-then-extend).

**ERR-08 unconditional logger** — already wired. HEAD line 352 constructs `this.logger = opts.logger ?? createStructuredLogger({})` UNCONDITIONALLY in the `Session` constructor. RESEARCH §Pattern 5 + §Open Question 4 both confirm "Phase 19 wiring is one-line at runVoice() entry" — but inspecting session.ts shows it's already in the constructor (which is invoked by `createSession()` which is invoked by `runVoice()` at line 1187). Phase 19 plan tasks:
1. Add `logger.info("run_voice_start", { pid, argv, nodeVersion })` at the top of the `voice` action handler (around line 1100, before the `apiKey` resolve).
2. Add `logger.info("run_voice_end", {})` + `await logger.flush()` + `logger.dispose()` in the graceful-shutdown chain.
3. Write `tests/session-err08-wiring.test.ts` asserting `createStructuredLogger` is called at runVoice entry.

**ERR-03 dual-watchdog wiring** — VERIFY-then-extend. Current HEAD session.ts:
- HEAD line 936-962 has `handleSoxExit` (Phase 16 stub — the passive listener).
- HEAD wireAudioBridges (lines 449-542) does NOT construct any `createChildExitWatchdog` calls. The watchdog substrate exists at `apps/achilles-terminal/src/child-exit-watchdog.ts` (Phase 17) but it is NOT yet wired.

Phase 19 plan must ADD (not verify) the dual-watchdog wiring per RESEARCH §Pattern 4 + §Assumption A4 (load-bearing — see RESEARCH §Code Example excerpts):

```ts
// Insert in wireAudioBridges() after both micSox + ttsPlayback handles
// exist; pass both to createChildExitWatchdog with respawnFactory closures.

const soxWatchdog = createChildExitWatchdog({
  label: "sox",
  child: this.micSox.child,
  respawnFactory: () => {
    // Re-call createMicSox with the same opts captured in the closure.
    const micOpts = /* same shape as in start() */ ;
    this.micSox = createMicSox(micOpts);
    return this.micSox.child;
  },
  onError: (msg) => {
    this.emit("event", {
      type: "error",
      payload: { classification: "mic_unavailable", message: msg },
      timestamp: Date.now(),
    });
    // D-discretion (CONTEXT.md): stay-in-error-state; typed-input fallback covers user's path forward.
  },
  logger: this.logger.child("sox-watchdog"),
});

const ffplayWatchdog = createChildExitWatchdog({
  label: "ffplay",
  child: this.ttsPlayback.child,
  respawnFactory: () => createTtsPlayback(ttsDeps).child,
  onError: (msg) => {
    this.emit("event", {
      type: "error",
      payload: { classification: "playback_lost", message: msg },
      timestamp: Date.now(),
    });
  },
  logger: this.logger.child("ffplay-watchdog"),
});
```

Phase 19 plan must also EXTEND `this.stop()` (HEAD lines 594-630) to dispose both watchdogs.

**Banner wiring (D-10 layout)** — the change to session.ts itself is minimal. The Banner data flows through a new `useErrorBanner(session)` hook in `useAchillesState.ts` (NOT session.ts). Session.ts is the EMITTER; useAchillesState.ts is the SUBSCRIBER. Phase 19's session.ts touches are:
1. Confirm `this.emit("event", { type: "error", payload, timestamp })` already fires from the existing error handlers (HEAD lines 766-770, 805-814, 890-907 — all already present).
2. Wire the new watchdogs' onError to the same emit pattern (above).

---

### `apps/achilles-terminal/src/ui/VoiceShell.tsx` (MOD)

**Analog:** self (HEAD state at lines 130-142).

**Current JSX (lines 130-142):**

```tsx
return (
  <Box flexDirection="column">
    {sr ? (
      <ScreenReader state={state} />
    ) : (
      <>
        <Blob amplitude={amp} />
        <Sparkline ring={ring} writeIndex={writeIndex} />
      </>
    )}
    <StatusRow state={state} transcript="" transcriptsActive={false} />
  </Box>
);
```

**Target JSX (D-10 layout — Banner ABOVE the screen-reader/sighted branch):**

```tsx
return (
  <Box flexDirection="column">
    <Banner
      classification={errorClass}
      message={errorMsg}
      errorNonce={errorNonce}
      successNonce={successNonce}
    />
    {sr ? (
      <ScreenReader state={state} />
    ) : (
      <>
        <Blob amplitude={amp} />
        <Sparkline ring={ring} writeIndex={writeIndex} />
      </>
    )}
    <StatusRow state={state} transcript="" transcriptsActive={false} />
  </Box>
);
```

**New hook + import additions**:

```tsx
import { Banner } from "./Banner.js";
// ...
const { errorClass, errorMsg, errorNonce, successNonce } = useErrorBanner(session);
```

**`useErrorBanner` hook** — NEW; add to `useAchillesState.ts` next to the existing `useAchillesState` / `useAmplitude` / `useRingBuffer` hooks (current file lines unknown; mirror their shape). Subscribes to `session.on("event", ...)` for `type === "error"` and bumps `errorNonce` + caches the latest `{classification, message}`. Subscribes to `state-change` (any non-error transition) and bumps `successNonce`.

**No emojis** in any of the new strings (CLAUDE.md global, also called out in every existing UI file's header docstring per lines 28, 47, 22 in ScreenReader/VoiceShell/StatusRow respectively).

---

### `apps/achilles-terminal/eslint.config.js` (MOD)

**Analog:** self (the prepared slot at lines 27-41 already holds the rule verbatim in a block comment).

**Current state (lines 26-43):**

```js
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
  //
  // Rationale: the v1.2 CLI used `stdio: "ignore"` when spawning the Electron
  // child (apps/achilles-cli/src/commands/launch.ts:155) which is what hid the
  // renderer-loop-never-wired silent-launch failure from the user. v1.3 runs
  // foreground with `stdio: "inherit"`; the lint rule above structurally
  // prevents a future regression to the v1.2 shape.
  //
  // Phase 15 baseline: no extra rules beyond typescript-eslint recommended-type-checked.
},
```

**Target state (uncomment the rule):**

```js
rules: {
  // GATE-04: forbid `stdio: "ignore"` on the launch path (prevents v1.2 detached-stdio regression).
  // The selector matches only the literal `{ stdio: "ignore" }` shape — variable indirection
  // and array form (`{ stdio: ["ignore", "pipe", "pipe"] }`) are accepted false-negatives per
  // RESEARCH §Pitfall 8.
  "no-restricted-syntax": [
    "error",
    {
      selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
      message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
    },
  ],
},
```

**Verification**: After activation, `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` must stay GREEN. No source under `apps/achilles-terminal/src/` currently uses `stdio: "ignore"` (verified via `grep -n "stdio" apps/achilles-terminal/src/*.ts apps/achilles-terminal/src/**/*.ts` — only `apps/achilles-cli/src/commands/launch.ts:155` matches the forbidden shape, and that file is in a different workspace).

**Test fixture for GATE-04**: Phase 19 plan adds `tests/eslint-stdio-ignore.test.ts` per RESEARCH §Wave 0 Gaps — runs ESLint programmatically against a `{ stdio: "ignore" }` fixture and asserts the rule fires.

---

### `packages/achilles-skill/skill/SKILL.md` (MOD; full rewrite per D-03)

**Analog:** the file's own HEAD shape (for frontmatter conventions) + RESEARCH §Code Example 2 (the v1.3 target body).

**Frontmatter shape** — preserve the YAML triple-dash + 3-field structure from HEAD lines 1-5. Change the `description` body (drop Electron language) and narrow `allowed-tools` per D-04:

```yaml
---
name: achilles
description: <RESEARCH §Code Example 2 lines 649 — terminal-only model description>
allowed-tools: Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(achilles config *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)
---
```

**CRITICAL — Pitfall 6 (RESEARCH)** — keep `allowed-tools` as a SINGLE-LINE COMMA-SEPARATED STRING (not a YAML list). Verify the value matches v1.2's single-line shape (HEAD line 4: `allowed-tools: Bash`).

**Body structure** — replace HEAD body lines 7-49 (43 lines of Electron-era content) with the 7-section v1.3 body per RESEARCH §Code Example 2 lines 653-702:

| Section | Source | What it says |
|---------|--------|--------------|
| `# Achilles voice companion for Claude Code` | RESEARCH §Code Example 2 line 653 | H1 title (same as v1.2 line 7) |
| `BASH_MAX_TIMEOUT_MS=86400000` callout | line 655 | D-05 — at TOP of body |
| `## What it does` | lines 657-662 | Terminal TUI + sox + Scribe v2 + Flash v2.5 + `<spoken-summary>` contract |
| `## Prerequisites` | lines 663-671 | Drop Electron + X-forwarding; add sox + ffmpeg + Node 22 (Bun preferred) + macOS parent-terminal TCC note |
| `## How to launch` | lines 673-679 | `achilles voice` foreground (NOT detached) |
| `## How the spoken interaction works` | lines 681-685 | Same `<spoken-summary>` content as v1.2 (the contract is unchanged) |
| `## When the run fails` | lines 687-691 | Add the ERR-01 inline red banner mention |
| `## Privacy` | lines 693-701 | Add the ~/.achilles/achilles.log mention (ERR-08) + Phase 18 transcript retention (`achilles transcripts purge` from D-04's narrowed allowed-tools list) |

**Contract test** — Phase 19 plan adds `tests/skill-md-contract.test.ts` (RESEARCH §Wave 0 Gaps) asserting:
1. The frontmatter `allowed-tools` field is a single-line comma-separated string.
2. The 8 allowed-tools entries match EXACTLY the D-04 list (no add, no remove, no reorder).
3. The body contains the literal string `BASH_MAX_TIMEOUT_MS=86400000`.
4. The body does NOT contain any of: `Electron`, `floating UI`, `systemPreferences.askForMediaAccess`, `X-forwarding`, `Achilles.app`, `renderer process`.

---

### `packages/achilles-skill/package.json` (MOD)

**Analog:** `apps/achilles-terminal/package.json` (the publishConfig.access + version + private:false pattern).

**Current state (HEAD lines 1-30):**

```json
{
  "name": "@achilles/achilles-skill",
  "version": "0.1.0",
  "private": true,
  ...
}
```

**Target state (D + RESEARCH §Pitfall 2):**

```json
{
  "name": "@achilles/achilles-skill",
  "version": "1.3.0",
  "private": false,
  "publishConfig": { "access": "public" },
  ...
}
```

**Three changes:**
1. `version`: `0.1.0` -> `1.3.0` (RESEARCH §Standard Stack table "Installation" note)
2. `private`: `true` -> `false` (RESEARCH §Pitfall 2 — `npm publish` errors with EPRIVATE without this flip)
3. ADD `publishConfig: { access: "public" }` (RESEARCH §Anti-Patterns line 431 — required because `@achilles/...` is a scoped package; without this `npm publish` errors with E402 "Payment Required" or 403)

**No other field changes.** The `files: ["dist", "skill"]` array stays. The `main: "dist/index.js"` + `exports` stay. The `dependencies: {}` empty object stays. The `scripts` block stays.

**Downstream sync** — `apps/achilles-terminal/package.json` line 33 references `"@achilles/achilles-skill": "0.1.0"` — this version pin must bump to `1.3.0` as part of the same commit so the workspace install resolves to the new version.

---

### Root `package.json` (MOD; scripts paths)

**Analog:** self (HEAD lines 31-33).

**Current state:**

```json
"check:source-of-truth": "node apps/achilles-cli/scripts/check-source-of-truth.mjs",
"check:tarball:secrets": "node apps/achilles-cli/scripts/check-tarball-no-secrets.mjs",
"check:dist": "npm run check:source-of-truth && npm run check:tarball:secrets",
```

**Target state (RESEARCH §Open Question 6):**

```json
"check:source-of-truth": "node apps/achilles-terminal/scripts/check-source-of-truth.mjs",
"check:tarball:secrets": "node apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs",
"check:dist": "npm run check:source-of-truth && npm run check:tarball:secrets",
```

**Why this change happens in commit A (not commit B):** Once the ported scripts exist in `apps/achilles-terminal/scripts/`, the root scripts MUST switch to point at them BEFORE commit B deletes `apps/achilles-cli/scripts/`. If commit A leaves the root scripts pointing at the soon-to-be-deleted path, the merge between A and B has a window where running `npm run check:dist` fails. Commit A is the SAFE place for this path-rewrite.

---

## Shared Patterns

### Pattern S-1: TDD RED+GREEN commit shape (Phase 15-18 carryover)

**Source:** `apps/achilles-terminal/tests/` — every Phase 15-18 task lands as a RED commit (failing test) + a GREEN commit (passing implementation). Inspect `tests/session.test.ts`, `tests/ui/voice-shell.test.tsx`, `tests/typed-input.test.ts` for the shape.

**Apply to:** Phase 19 plan tasks. RESEARCH §Wave 0 Gaps lists 11 new test files Phase 19 must add. Each gets:
- RED commit: failing test written, implementation absent or stubbed
- GREEN commit: implementation lands, test passes
- The SKILL.md rewrite is the ONE exception per CONTEXT.md `<code_context>` Established Patterns row 1: docs-only change with a contract test (no RED/GREEN cycle).

### Pattern S-2: Dynamic-import gate (INIT-07 invariant)

**Source:** `apps/achilles-terminal/src/cli.ts` lines 92-189 — every subcommand branch uses `await import("./xxx.js")` inside `main()` so the top-level static-import budget stays at `{node:fs/promises, node:url, node:path}`.

**Apply to:** The NEW `install-skill` gate (Pattern Assignments section above). NEVER add a static `import` at the top of cli.ts for the new install-skill.ts module.

**INIT-07 regression test:** `tests/integration/init-07-invariant.test.ts` (named in cli.ts header line 19) parses cli.ts's top-level import statements and asserts the count + names. Phase 19 plan must NOT touch this test except to extend it with a positive assertion that `install-skill` dispatches via dynamic import (not by changing the budget).

### Pattern S-3: Structured logger fan-out via `child(scope)`

**Source:** `apps/achilles-terminal/src/structured-logger.ts` lines 144 + 364-367 — the logger's `child(scope)` method returns a new logger that prefixes every line with the composed scope (e.g., `parent.child` from `logger.child("child")` on a parent with `scope: "parent"`).

**Apply to:** Phase 19's dual-watchdog wiring in session.ts. Each watchdog receives `logger: this.logger.child("sox-watchdog")` or `logger: this.logger.child("ffplay-watchdog")` — never the parent logger directly. Pattern already established by Phase 17 in session.ts lines 471-479 (the `logger: this.logger` field passed to `createTtsPlayback`) and lines 506-507 (the `logger: this.logger` field passed to `createSttBridge`); Phase 19 extends this fan-out with the two new watchdog scopes.

### Pattern S-4: SessionEvent emit shape (Phase 17 substrate)

**Source:** `apps/achilles-terminal/src/session-events.ts` lines 208-223 — the 15-variant discriminated union.

**Apply to:** Phase 19's ERR-01 banner data flow + ERR-03 watchdog onError. Every error path emits:

```ts
this.emit("event", {
  type: "error",
  payload: { classification: <SessionErrorClassification>, message: <string> },
  timestamp: Date.now(),
});
```

Existing call sites in session.ts: lines 766-770, 805-814, 890-907. New call sites (Phase 19): the two `onError` callbacks in the watchdog wiring.

### Pattern S-5: No emojis in any file (CLAUDE.md global)

**Source:** Every existing file's header docstring (e.g., `VoiceShell.tsx:47`, `ScreenReader.tsx:28`, `StatusRow.tsx:22`, `child-exit-watchdog.ts:42`, `cli.ts:43`, `check-tarball-no-secrets.mjs:33`).

**Apply to:** Every NEW Phase 19 file. The em-dash `U+2014` (used in `AUDIO_DEVICE_LOST_MESSAGE` at `child-exit-watchdog.ts:60`) is explicitly NOT an emoji and is allowed. The SKILL.md rewrite uses ASCII `--` (double hyphen) instead, per the existing v1.2 SKILL.md body style.

### Pattern S-6: Phase 15+ JSX layout in `<Box flexDirection="column">`

**Source:** `apps/achilles-terminal/src/ui/VoiceShell.tsx` lines 130-142 — the root `<Box flexDirection="column">` with children stacking vertically.

**Apply to:** Phase 19's Banner insertion in VoiceShell.tsx. Banner becomes the FIRST child of the existing Box (D-10 lock — banner pre-empts ABOVE the existing children). The screen-reader branch + StatusRow stay in their existing positions.

### Pattern S-7: TS strict + readonly fields on interfaces

**Source:** `apps/achilles-terminal/src/child-exit-watchdog.ts` lines 90-140 — every option-bag interface uses `readonly` on every field (e.g., `readonly label: "sox" | "ffplay"`, `readonly child: TChild`, etc.).

**Apply to:** Phase 19's Banner `BannerProps`, error-classifier's `ClassifiedBanner` interface, install-skill's options bag.

### Pattern S-8: `chalk` color via the `colors.ts` helper, not raw `chalk` imports in components

**Source:** `apps/achilles-terminal/src/ui/StatusRow.tsx` line 27 imports `colorize` from `./colors.js`. Phase 16 PRECEDENT — components never import `chalk` directly; they go through `colors.ts` which auto-no-ops on `NO_COLOR`.

**Apply to:** Banner.tsx. The Ink `<Text color="red">` API call is the React-side equivalent (Ink handles `NO_COLOR` natively per Phase 16 ACC-01). RESEARCH §Code Example 3 line 307 already shows the `<Text color="red">` form — adopt it; do NOT add a new `colorize("error", ...)` call.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/achilles-terminal/scripts/check-deletion-reachability.sh` | script | batch (grep + find) | No bash script exists in this monorepo for reachability auditing. Built from RESEARCH §Pitfall 10's 4-variant grep recipe (4 grep invocations + 1 root-package.json grep + exit code aggregation). |

## Metadata

**Analog search scope:**
- `apps/achilles-terminal/src/` (39 files; primary substrate for ports + NEW UI components)
- `apps/achilles-terminal/scripts/` (4 files; existing CI gate scripts)
- `apps/achilles-terminal/tests/` (test patterns referenced; not exhaustively listed)
- `apps/achilles-cli/src/` (15 files; v1.2 port sources)
- `apps/achilles-cli/scripts/` (5 files; v1.2 CI gate scripts)
- `packages/achilles-skill/` (3 src + 1 skill dir; current SKILL.md HEAD shape)
- `.github/workflows/` (2 files; ci.yml is the analog for release.yml)
- Root `package.json` + every workspace `package.json` cited (versions + publishConfig + dependencies)

**Files scanned (depth-first, deduplicated):** 18 distinct files read in full plus 7 partial reads (grep + targeted line ranges) — no redundant re-reads.

**Strong matches:** 13 of 14 NEW/MODIFIED files have an exact-or-role-match analog in-tree. The lone exception (`check-deletion-reachability.sh`) has a complete recipe in RESEARCH §Pitfall 10.

**Pattern extraction date:** 2026-06-09
**Phase:** 19-distribution-publishing-skill-rewire
