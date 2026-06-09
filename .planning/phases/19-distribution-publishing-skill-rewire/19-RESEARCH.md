# Phase 19: Distribution + Publishing + Skill Rewire — Research

**Researched:** 2026-06-09
**Domain:** npm publish orchestration + Claude Code skill manifest + runtime error UX hardening + cleanup-cut ordering
**Confidence:** HIGH (the entire decision surface is already locked by 19-CONTEXT.md's 11 decisions + the Option 3 lock; this research is mechanics + porting + verification recipes)

## Summary

Phase 19 ships v1.3 by:

1. **Publishing 4 packages** atomically from one GH Actions workflow — parent `achilles@1.3.0` + 3 platform siblings (`@achilles/cli-linux-x64`, `@achilles/cli-linux-arm64`, `@achilles/cli-win32-x64`); macOS gets nothing platform-specific (Option 3 lock — Bun-preferred / Node 22 fallback JS bundle serves darwin).
2. **Rewriting `packages/achilles-skill/skill/SKILL.md`** from the 152-line v1.2 Electron-era manifest to a v1.3 terminal-only manifest with `allowed-tools` narrowed to exactly 8 patterns and `BASH_MAX_TIMEOUT_MS=86400000` documented prominently at the top of the body.
3. **Hardening runtime error visibility** — ERR-01 inline banner above the status row, ERR-03 sox/ffplay watchdog (extends Phase 17's existing `child-exit-watchdog.ts`), ERR-08 unconditional structured logger at `~/.achilles/achilles.log` (Phase 17 already built the writer; Phase 19 unconditionally wires it from `runVoice()` entry).
4. **Cutting the v1.2 carcass** in commit B AFTER commit A's publish succeeds — `apps/achilles/` Electron tree (95 src files / 458 total tree files) + `apps/achilles-cli/src/commands/launch.ts` (179 LOC) + verified-dead remainder of `apps/achilles-cli/`.

**Primary recommendation:** Two commits, two distinct work bodies:
- **Commit A** (Wave 1+2+3 of the plan): publish-ready state — SKILL.md rewrite, ESLint forbid rule, ERR-01 banner, ERR-03 watchdog (extending or wrapping Phase 17's `child-exit-watchdog.ts`), ERR-08 unconditional logger wiring at `runVoice()` entry, darwin sibling directory deletion + `optionalDependencies` trim, `version: 1.3.0` bump across parent + 3 surviving siblings, port `apps/achilles-cli/scripts/check-source-of-truth.mjs` + `check-tarball-no-secrets.mjs` to the v1.3 layout, and the GH Actions release workflow. CI runs publish; operator verifies `npm view achilles@1.3.0` succeeds.
- **Commit B** (Wave 4): atomic deletion of `apps/achilles/` + `apps/achilles-cli/src/commands/launch.ts` + verified-dead remainder of `apps/achilles-cli/` after a grep-driven reachability audit confirms zero importers from the published surface.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| CI publish orchestration | GH Actions release workflow | npm registry | One workflow, matrix.os runners for the 3 compiled targets, ubuntu publisher for the parent. Atomicity story is sequential publish-with-rollback (npm has no transactional multi-publish primitive) |
| Compiled binary build | Per-OS runner (matrix.os) | Bun 1.3.14 | Each runner builds its native target; cross-compile is possible (`bun --target=bun-linux-arm64` from x64 works) but native-on-native is documented in `achilles-terminal-ci.yml` already (linux-arm64 uses `ubuntu-22.04-arm` runner) |
| macOS distribution | JS-fallback bundle (`dist/main.js`) | Bun runtime on user machine | Option 3 lock — no compiled darwin binary; the `#!/usr/bin/env node` shebang on `dist/cli.js` dispatches via Node 22 (Bun documented as preferred but not required) |
| Skill discoverability | `packages/achilles-skill/skill/SKILL.md` (rewritten) | Claude Code's `~/.claude/skills/` directory scan | Phase 18 deferred SKILL.md rewrite to Phase 19; Phase 19 rewrites the body wholesale (D-03) and narrows `allowed-tools` (D-04) |
| Skill install (`achilles install-skill`) | `apps/achilles-terminal/src/install-skill.ts` (NEW — port from v1.2) | `packages/achilles-skill` exports `SKILL_PROMPTS_DIR` | The v1.2 install-skill at `apps/achilles-cli/src/commands/install-skill.ts` + `apps/achilles-cli/src/skill-symlink.ts` are the port targets. **Phase 19 may need to ADD `install-skill` to cli.ts** — currently absent from `apps/achilles-terminal/src/cli.ts` (only `init/config/transcripts/latency/voice` are wired). DIST-03 requires `achilles install-skill [--force]` to exist. |
| Source-of-truth check (SHA-256) | `apps/achilles-terminal/scripts/check-source-of-truth.mjs` (Phase 17 PORTED) | CI gate (loop-02-invariant job, already wired) | Phase 17 already ported the single-arm check (source-vs-embedded-hash). Phase 19 extends it with the second arm (source-vs-tarball-bundled-hash) for the publish gate, or accepts Phase 17's single-arm form as sufficient. **See Q3 below.** |
| Tarball secret scan | NEW `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` (port from v1.2) | `prepublishOnly` hook in `apps/achilles-terminal/package.json` | v1.2 has the canonical implementation at `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` (7 patterns: `sk_`, `xi-api-key`, `xi_api_key=`, `ELEVENLABS_API_KEY=`, `sk-ant-`, `ghp_`, `github_pat_`); port to scan the parent tarball + 3 compiled-binary tarballs + JS bundle |
| Error banner UX (ERR-01) | `apps/achilles-terminal/src/ui/Banner.tsx` (NEW) | `VoiceShell.tsx` (insert above existing children) | Conditional 1-row red text region; subscribes to session's `error` event channel; auto-dismiss timer in React state |
| sox/ffplay watchdog (ERR-03) | Already exists: `apps/achilles-terminal/src/child-exit-watchdog.ts` | `session.ts` constructs one per label | Phase 17 already built the watchdog. Phase 19's ERR-03 is the **wiring** — confirm session.ts constructs both (sox + ffplay) and the onError emits the locked `AUDIO_DEVICE_LOST_MESSAGE` into the session error channel that ERR-01 banner consumes |
| Unconditional structured logger (ERR-08) | `apps/achilles-terminal/src/structured-logger.ts` (Phase 17 BUILT) | `runVoice()` entry constructs one and fans out via `logger.child(scope)` | Phase 17 built the writer (10MB rotation, 7-regex redaction). Phase 19's ERR-08 is the **wiring** — unconditional `createStructuredLogger()` at `runVoice()` entry, fanned out to every audio module |
| ESLint forbid rule (GATE-04 lint half) | `apps/achilles-terminal/eslint.config.js` (slot already prepared) | CI lint step | The slot exists in Phase 15's config with the exact rule text in a comment (lines 27-41); Phase 19 uncomments + activates |
| Publish-then-cut ordering | Two sequential commits | Reviewer asserts commit A SHA published before commit B lands | Single cleanup commit after publish-success (D-08); commit B does NOT race with commit A's CI (D-09) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| GitHub Actions `actions/checkout@v4` | v4 | Repo checkout | Already used in `achilles-terminal-ci.yml`; pin major |
| GitHub Actions `actions/setup-node@v4` | v4 | Node 22 toolchain | Already used; `node-version: "22"` |
| GitHub Actions `oven-sh/setup-bun@v2` | v2 | Bun 1.3.14 toolchain | Already used; matches pin |
| GitHub Actions `JS-DevTools/npm-publish@v3` | v3 | npm publish action with idempotent retries | Standard ecosystem choice as of 2026; alternative is raw `npm publish` with manual `NODE_AUTH_TOKEN` env [CITED: github.com/JS-DevTools/npm-publish] |
| `npm@10.9.3` | 10.9.3 | Package manager | Root `packageManager` field; D-15-02 says `npm ci --include=optional --force` is mandatory for workspace-sibling EBADPLATFORM workaround |
| `esbuild@0.28.0` | 0.28.0 | JS-fallback bundle producer | Phase 15 already wired in `scripts/build-node-bundle.mjs`; same external list (5 workspace packages) |
| `Bun 1.3.14` | 1.3.14 | Compile-binary toolchain | Already pinned in `achilles-terminal-ci.yml`; `bun build --compile --target=bun-{linux,windows}-{x64,arm64}` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `commander@13.1.0` | 13.1.0 | CLI subcommand dispatch | Already in `apps/achilles-terminal/dependencies`; if Phase 19 adds `install-skill` subcommand, it goes through the same dynamic-import gate in `cli.ts` as Phase 18's 4 subcommands (INIT-07 preserved) |
| `@achilles/achilles-skill` | bump to 1.3.0 | Source-of-truth path provider for `companion.md` | Already a workspace dep; `SKILL_PROMPTS_DIR` constant exported per `apps/achilles-cli/src/commands/install-skill.ts:50` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single workflow with `matrix.os` | Separate per-platform workflows | Recommended in 19-CONTEXT.md Claude's Discretion. Single workflow makes the dependency graph explicit (build-all → publish-once) and centralises the npm token secret. Separate workflows would force replicating the publish job's rollback story 3x. **Recommend: single workflow.** |
| `JS-DevTools/npm-publish@v3` GH Action | Raw `npm publish --access public` | The action handles idempotent retries (publishing an already-published version is a soft no-op, not an error). Raw `npm publish` errors with E403 on republish, which is louder but not actionable. Both are acceptable; the action is slightly safer for reruns. |
| `npm deprecate` for rollback | `npm unpublish` | npm policy: `unpublish` is only allowed within 72 hours of publish AND requires no dependents. After 72h or with dependents, `deprecate` is the only option. **Recommend: document `npm deprecate achilles@1.3.0 "v1.3.0 published in error — use 1.3.1"` as the canonical rollback.** [VERIFIED: docs.npmjs.com/policies/unpublish] |
| `lerna publish` / `pnpm publish -r` for atomicity | Manual sequential publish | Both `lerna` and `pnpm` workspace publish offer "publish all changed packages with shared version" orchestration but introduce a dependency we don't currently use. **Recommend: hand-roll a sequential publish script that publishes platform packages FIRST, then the parent.** Mirrors how `esbuild` itself publishes (the canonical platform-packages reference). |

**Installation:** No new runtime dependencies. Phase 19 publishes existing dependencies; the additions are:

```bash
# No `npm install` for this phase. The work is:
#   1. Bump version: 0.1.0 -> 1.3.0 in 4 package.json files (parent + 3 siblings + achilles-skill, currently @achilles/achilles-skill is 0.1.0)
#   2. Flip @achilles/achilles-skill private:true -> private:false (currently private)
#   3. Wire SKILL.md (docs change)
#   4. Add UI Banner component (one file)
#   5. Wire ERR-08 logger unconditionally (one-line change in runVoice())
#   6. Activate ESLint rule (uncomment the prepared slot)
#   7. Add GH Actions release workflow (new file)
#   8. Port v1.2 secret-scan script (new file in apps/achilles-terminal/scripts/)
```

**Version verification:** `@achilles/achilles-skill` is `version: "0.1.0"` and `private: true` as of HEAD — Phase 19 must flip both. `apps/achilles-terminal/package.json` already declares `version: "1.3.0"`. The 3 surviving sibling `apps/cli-<platform>-<arch>/package.json` files all declare `version: "1.3.0"`. The 2 darwin siblings (`apps/cli-darwin-arm64`, `apps/cli-darwin-x64`) also declare `version: "1.3.0"` and need full directory deletion (D-01).

## Package Legitimacy Audit

Phase 19 installs **zero new npm packages**. Every dependency in the publish surface (`commander`, `chalk`, `ink`, `react`, `@clack/prompts`, `@napi-rs/keyring`, `@stablelib/nacl`, `esbuild`, `vitest`, `typescript`, `tsx`, `typescript-eslint`, `eslint`) was vetted and installed in Phases 15-18. No slopcheck gate triggers.

The new workspace publication targets are first-party packages under the `@achilles` private scope — no registry slopcheck applies. The `achilles` parent name is registered to this project (Phase 18 already installed `apps/achilles-cli@0.1.0` as `achilles` on the registry under v1.2; the v1.3 bump is a version increment, not a new name registration).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `achilles` | npm (this project) | published in v1.2 | repo-internal | this monorepo | N/A | First-party — version bump 0.1.0 -> 1.3.0 [VERIFIED: workspace] |
| `@achilles/cli-linux-x64` | npm (new in v1.3) | new | new | this monorepo | N/A | First-party scoped publish [VERIFIED: workspace] |
| `@achilles/cli-linux-arm64` | npm (new in v1.3) | new | new | this monorepo | N/A | First-party scoped publish [VERIFIED: workspace] |
| `@achilles/cli-win32-x64` | npm (new in v1.3) | new | new | this monorepo | N/A | First-party scoped publish [VERIFIED: workspace] |
| `@achilles/achilles-skill` | npm (new public, currently private) | new public | new | this monorepo | N/A | First-party scoped publish; flip `private: false` |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages installed in Phase 19).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
Operator writes commit A
        |
        v
+-------------------------------------------------------------+
|                  CI Build Matrix (GH Actions)                |
|                                                              |
|  +-----------+    +-----------+    +-----------+    +-----+ |
|  | ubuntu-x64|    | ubuntu-arm|    | win-2022  |    |macOS| |
|  | bun build |    | bun build |    | bun build |    | ESM | |
|  | -> bin    |    | -> bin    |    | -> bin.exe|    |bundle| |
|  +-----------+    +-----------+    +-----------+    +-----+ |
|        \              \                /            /       |
|         \              \              /            /        |
|          v              v            v            v         |
|        ARTIFACT       ARTIFACT     ARTIFACT     SMOKE       |
|        cli-linux-x64  cli-linux-   cli-win32-   JS-fallback |
|        /bin/achilles  arm64/bin/   x64/bin/     under Bun   |
|                       achilles     achilles.exe (no publish)|
+-------------------------------------------------------------+
        |              |             |             ^
        v              v             v             |
  +-------------------------------------------+    |
  | publish job (sequential, single ubuntu)   |    |
  |                                            |    |
  | 1. SHA-256 source-of-truth check          |    |
  | 2. Tarball secret-scan x4                 |    |
  | 3. npm publish @achilles/cli-linux-x64    |    |
  | 4. npm publish @achilles/cli-linux-arm64  |    |
  | 5. npm publish @achilles/cli-win32-x64    |    |
  | 6. npm publish @achilles/achilles-skill   |    |
  | 7. npm publish achilles (parent)          |    |
  | 8. Wait + npm view assertions             |----+
  | 9. macOS smoke: bunx achilles@1.3.0 voice |
  +-------------------------------------------+
        |
        v
  Operator confirms success
        |
        v
  Operator writes commit B (deletion of apps/achilles + launch.ts)
        |
        v
  CI runs lint + tests on commit B (must stay green with the cut)
```

**Read this diagram as:** the matrix-build-then-sequential-publish-then-smoke chain happens within ONE workflow on commit A; the deletion lives in a separate commit B that doesn't touch the CI publish path (commit B only modifies tree-state).

### Recommended Project Structure (additions only)

```
apps/achilles-terminal/
├── package.json                            # version 1.3.0 (already set); optionalDependencies trimmed to 3 (drop 2 darwin)
├── eslint.config.js                        # ACTIVATE the no-restricted-syntax rule (slot prepared at lines 27-41)
├── src/
│   ├── ui/
│   │   ├── Banner.tsx                      # NEW — ERR-01 inline banner component
│   │   └── VoiceShell.tsx                  # MODIFY — insert <Banner /> above existing children
│   ├── error-classifier.ts                 # NEW — maps SessionErrorClassification -> {class, suggestedAction}
│   ├── install-skill.ts                    # NEW — port from apps/achilles-cli/src/commands/install-skill.ts + skill-symlink.ts
│   └── cli.ts                              # MODIFY — add install-skill dynamic-import gate (still INIT-07-clean)
├── scripts/
│   └── check-tarball-no-secrets.mjs        # NEW — port from apps/achilles-cli/scripts/
└── .npmrc                                  # NEW (if needed) — registry config for the publish runner

apps/cli-darwin-arm64/                      # DELETE entire directory (D-01)
apps/cli-darwin-x64/                        # DELETE entire directory (D-01)

apps/achilles/                              # DELETE in commit B AFTER publish success (D-08)
apps/achilles-cli/                          # DELETE in commit B; verify reachability first

packages/achilles-skill/
├── package.json                            # MODIFY — version 0.1.0 -> 1.3.0, private: true -> false
└── skill/SKILL.md                          # FULL REWRITE (D-03)

.github/workflows/
└── achilles-release.yml                    # NEW — the publish workflow
```

### Pattern 1: Publish-Then-Cut Two-Commit Sequence

**What:** Two separate commits, two separate purposes, no shared file edits.
**When to use:** Whenever deleting code that a recently-published package depends on the bundle of.
**Example:**

```
commit A (Phase 19 Wave 1+2+3 plan output):
  +apps/achilles-terminal/src/ui/Banner.tsx
  +apps/achilles-terminal/src/error-classifier.ts
  +apps/achilles-terminal/src/install-skill.ts          (port)
  +apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs  (port)
  +.github/workflows/achilles-release.yml               (new publish workflow)
   M apps/achilles-terminal/package.json                (optionalDependencies trim: drop 2 darwin)
   M apps/achilles-terminal/src/ui/VoiceShell.tsx       (add Banner)
   M apps/achilles-terminal/src/session.ts              (unconditional logger fan-out)
   M apps/achilles-terminal/src/cli.ts                  (add install-skill dynamic-import gate)
   M apps/achilles-terminal/eslint.config.js            (activate stdio:"ignore" rule)
   M packages/achilles-skill/package.json               (version bump + private: false)
   M packages/achilles-skill/skill/SKILL.md             (full rewrite)
  -apps/cli-darwin-arm64/                                (directory deleted entirely)
  -apps/cli-darwin-x64/                                  (directory deleted entirely)

[CI runs publish from commit A; npm view achilles@1.3.0 succeeds]
[Operator verifies all 5 published packages exist on registry]

commit B (Phase 19 Wave 4 plan output):
  -apps/achilles/                                        (Electron tree, 458 files)
  -apps/achilles-cli/src/commands/launch.ts              (179 LOC)
  -apps/achilles-cli/src/commands/launch.test.ts
  -apps/achilles-cli/                                    (entire workspace, if reachability check passes)
   M (none — pure deletion commit, no edits)
```

**Why two commits, not one:** A publish failure on commit A leaves the Electron tree in place as a recoverable artifact. A single-commit "delete-and-publish" model would orphan the workspace if `npm publish` failed for any reason (network, registry outage, signature check, secret scan).

### Pattern 2: Sequential Publish Order (Platform Siblings First)

**What:** Publish the 3 `@achilles/cli-<platform>-<arch>` siblings + `@achilles/achilles-skill` BEFORE the parent `achilles`.
**When to use:** Whenever the parent's `optionalDependencies` and `dependencies` reference newly-published versions of workspace packages.
**Example (from `achilles-release.yml` publish job step ordering):**

```yaml
# 1. Build siblings on per-OS runners (matrix.os); each uploads its binary tarball as artifact
# 2. publish job:
- name: Download all build artifacts
- name: Publish @achilles/cli-linux-x64
  run: npm publish apps/cli-linux-x64 --access public
- name: Publish @achilles/cli-linux-arm64
  run: npm publish apps/cli-linux-arm64 --access public
- name: Publish @achilles/cli-win32-x64
  run: npm publish apps/cli-win32-x64 --access public
- name: Publish @achilles/achilles-skill
  run: npm publish packages/achilles-skill --access public
- name: Publish achilles (parent)
  run: npm publish apps/achilles-terminal --access public
- name: Verify parent on registry
  run: |
    sleep 30  # registry CDN cache propagation
    npm view achilles@1.3.0 version
```

**Why this order:** If `achilles@1.3.0` publishes first and references `@achilles/cli-linux-x64@1.3.0` as a missing optional dependency, users who `npm install -g achilles` during the publish window see "ERESOLVE: optional dep not found" warnings (non-fatal but ugly). Publishing siblings first eliminates the race window.

### Pattern 3: ERR-01 Banner Insertion in Ink Layout

**What:** A new conditional 1-row `<Box>` rendered ABOVE the existing TUI children, with auto-dismiss via React state.

```tsx
// apps/achilles-terminal/src/ui/Banner.tsx (NEW)
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const BANNER_AUTO_DISMISS_MS = 8_000;

export interface BannerProps {
  // Set by VoiceShell.tsx when session emits an `error` event.
  // null = no error pending; the component returns null and renders nothing.
  classification: string | null;
  message: string;
  // Bumped each time a new error fires so the auto-dismiss timer resets.
  errorNonce: number;
  // Increments when session emits any successful event (used to dismiss
  // banner early on next successful interaction).
  successNonce: number;
}

export function Banner({
  classification,
  message,
  errorNonce,
  successNonce,
}: BannerProps): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [lastErrNonce, setLastErrNonce] = useState(errorNonce);
  const [lastSuccessNonce, setLastSuccessNonce] = useState(successNonce);

  // Show banner when errorNonce bumps.
  useEffect(() => {
    if (errorNonce !== lastErrNonce && classification !== null) {
      setVisible(true);
      setLastErrNonce(errorNonce);
    }
  }, [errorNonce, lastErrNonce, classification]);

  // Auto-dismiss after 8s.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), BANNER_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [visible, errorNonce]);

  // Dismiss on next successful event.
  useEffect(() => {
    if (successNonce !== lastSuccessNonce) {
      setVisible(false);
      setLastSuccessNonce(successNonce);
    }
  }, [successNonce, lastSuccessNonce]);

  if (!visible || classification === null) return null;
  return (
    <Box aria-label={`error ${classification} ${message}`} aria-role="status">
      <Text color="red">{`[error] ${classification} -- ${message}`}</Text>
    </Box>
  );
}
```

**VoiceShell.tsx modification (D-10 layout):**

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

The error-state subscription (the `errorClass / errorMsg / errorNonce` triple) comes from a NEW `useErrorBanner(session)` hook in `useAchillesState.ts` that listens to `session.on("event", ...)` for `{ type: "error", payload: { classification, message } }` events.

### Pattern 4: ERR-03 Watchdog Wiring (Extension, Not Reimplementation)

**What:** Phase 17 already built `child-exit-watchdog.ts` with the 3-in-10s sliding window. Phase 19's ERR-03 work is **wiring + verification**, not building a new module.

**Verify in Phase 19 plan:**
1. `session.ts` constructs `createChildExitWatchdog({ label: "sox", ... })` after the mic-sox.spawn.
2. `session.ts` constructs `createChildExitWatchdog({ label: "ffplay", ... })` after the ffplay child spawn.
3. `respawnFactory` closes over the same spawn config that produced the original child.
4. `onError` callback emits a `{ type: "error", payload: { classification: "mic_unavailable" | "playback_lost", message: AUDIO_DEVICE_LOST_MESSAGE } }` SessionEvent.
5. Cap-exceeded transitions to the **stay-in-error-state** path (per CONTEXT.md Claude's Discretion recommendation): mic capture is dead, but Phase 18's ERR-04 typed-input fallback still works.

If `session.ts` already wires both watchdogs (Phase 17's intent), Phase 19's ERR-03 is **verification + plan-test contract**. If only the substrate exists (likely — Phase 17 built but did not necessarily wire), Phase 19 adds the wiring.

```ts
// apps/achilles-terminal/src/session.ts excerpt (illustrative)
const soxWatchdog = createChildExitWatchdog({
  label: "sox",
  child: micSox.child,
  respawnFactory: () => createMicSox(deps).child,
  onError: (msg) => {
    session.emit("event", {
      type: "error",
      payload: { classification: "mic_unavailable", message: msg },
      timestamp: Date.now(),
    });
    // D-discretion recommendation: stay in error state, don't exit process.
    // Phase 18 ERR-04 typed-input fallback covers the user's path forward.
  },
  logger: logger.child("sox-watchdog"),
});

const ffplayWatchdog = createChildExitWatchdog({
  label: "ffplay",
  child: ttsPlayback.child,
  respawnFactory: () => createTtsPlayback(deps).child,
  onError: (msg) => {
    session.emit("event", {
      type: "error",
      payload: { classification: "playback_lost", message: msg },
      timestamp: Date.now(),
    });
  },
  logger: logger.child("ffplay-watchdog"),
});
```

### Pattern 5: ERR-08 Unconditional Logger Wiring

**What:** Phase 17 built `createStructuredLogger()` (10MB rotation, 7-regex redaction, NDJSON, 0o600 file mode, 0o700 dir mode). Phase 19's ERR-08 wires it UNCONDITIONALLY at `runVoice()` entry.

```ts
// apps/achilles-terminal/src/session.ts runVoice() entry (illustrative)
export async function runVoice(argv: string[]): Promise<void> {
  // ERR-08: unconditional logger. The --debug flag (Phase 18 ERR-07)
  // additionally writes to ~/.achilles/debug-<ts>.log; this writer is
  // always on regardless of --debug, closing the v1.2 silent-stdio gap.
  const logger = createStructuredLogger();  // default ~/.achilles/achilles.log
  logger.info("run_voice_start", { pid: process.pid, argv });

  // ... rest of runVoice() body, passing logger.child(scope) into each module
}
```

Phase 17's `structured-logger.ts` already exports `DEFAULT_REDACT_PATTERNS` with the 7 regexes (including the xi_ Plan 18-02 7th). Phase 19 needs zero changes to the writer; the wiring is one-line at `runVoice()` entry plus pass-down to every audio module.

### Pattern 6: ESLint `stdio:"ignore"` Forbid Rule Activation

**What:** Uncomment the prepared slot in `apps/achilles-terminal/eslint.config.js` (currently lines 27-41 hold the exact rule in a block comment).

```js
// apps/achilles-terminal/eslint.config.js — uncomment + activate:
rules: {
  "no-restricted-syntax": [
    "error",
    {
      selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
      message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
    },
  ],
},
```

**Scope:** `apps/achilles-terminal/eslint.config.js` only (NOT root). The rule's AST selector matches `{ stdio: "ignore" }` and `{ stdio: ["ignore", ...] }` only when the literal value is `"ignore"`. The selector does NOT match `spawn(cmd, args, { stdio: "inherit" })` (the v1.3 sanctioned shape) or `spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] })`.

**Verify:** Run `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` after activation. Expected outcome: lint stays green because no source under `apps/achilles-terminal/src/` currently uses `stdio: "ignore"`. The legitimate `stdio: "ignore"` usage in `apps/relay/`, `apps/bridge/`, `apps/web/` (Handoff workspace code) is outside this ESLint config's scope.

### Anti-Patterns to Avoid

- **Single-commit publish-and-delete:** Conflates two distinct work bodies. If `npm publish` fails after the deletion commit lands, the recovery path is `git revert HEAD` PLUS re-running publish — twice the cognitive load. **D-08 locks the two-commit shape.**
- **Cut-then-publish ordering:** Delete v1.2 first, then publish v1.3 — exposes the workspace to a publish failure mode with no fallback. The Electron tree is recoverable disk state; once deleted, the recovery is a git revert, which is fine if `git revert` lands cleanly, but coupling deletion to publish increases blast radius. **D-08 explicitly locks publish-then-cut.**
- **Publishing parent before siblings:** Causes a window where `optionalDependencies` references non-existent versions on the registry. Users running `npm install -g achilles@1.3.0` during this window see warnings. **Pattern 2 above locks siblings-first ordering.**
- **Editing companion.md as part of the SKILL.md rewrite:** companion.md is LOOP-02-locked byte-for-byte. SKILL.md and companion.md are separate files in the same directory; the rewrite touches only SKILL.md.
- **Ignoring the achilles-skill `private: true` flag:** `packages/achilles-skill/package.json` is currently `private: true` (it was never published in v1.2 — `apps/achilles-cli/package.json:34` used `bundledDependencies: ["@achilles/achilles-skill"]` to bundle it INTO the parent tarball). For v1.3, the achilles-terminal parent declares it as a regular `dependencies` entry, so `@achilles/achilles-skill@1.3.0` MUST be a real published package on the registry, which requires flipping `private: true` -> `private: false`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-package publish orchestration | Custom orchestrator with rollback | `npm publish` invoked sequentially in a single CI job, with `npm view <pkg>@<version>` smoke between steps | npm has no transactional multi-publish primitive; sequential publish with verification is the standard pattern (esbuild, swc, biome all do this) |
| Compiled-binary cross-target distribution | Custom postinstall scripts | `optionalDependencies` with `os`/`cpu` filters in per-platform sibling packages | Already locked by Phase 15 architecture; v1.3 just consumes it |
| Skill discoverability in Claude Code | Custom skill protocol | Filesystem convention — `~/.claude/skills/<name>/SKILL.md` (symlink or copy from npm-installed package) | Phase 13 v1.2 already ports the install-skill logic; Phase 19 ports the same shape |
| Secret detection in tarball | Custom regex engine | The 7-regex script v1.2 already wrote at `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` | Verified shape; ports unchanged. Patterns: `sk_`, `xi-api-key:`, `xi_api_key=`, `ELEVENLABS_API_KEY=`, `sk-ant-`, `ghp_`, `github_pat_` |
| SHA-256 source-of-truth check | New hashing logic | The script Phase 17 already ported at `apps/achilles-terminal/scripts/check-source-of-truth.mjs` (single-arm) | The v1.3 single-arm form may be sufficient; the second arm (bundled-vs-source) adds value at publish time but is optional |
| Auto-dismiss timer with React state | Manual timer reset on every prop change | `useEffect` + `setTimeout` + cleanup (Pattern 3 above) | React idiom; tested in vitest with `vi.useFakeTimers()` |
| Process tree termination during publish failure | Custom retry orchestrator | Manual operator intervention: `npm deprecate achilles@1.3.0 "..."` after-the-fact | Simpler mental model; deprecate is idempotent |
| GH Actions `NODE_AUTH_TOKEN` rotation | Custom token rotation script | Use GitHub Actions Secrets (encrypted, repo-scoped) | Standard practice; rotate annually outside Phase 19 scope |

**Key insight:** Phase 19's work is **wiring + porting + verification**, not building. Every component already exists in v1.2 (secret-scan, source-of-truth check, install-skill) or Phase 17/18 (structured-logger, child-exit-watchdog, circuit-breaker). The only NEW code is (a) the ERR-01 Banner component (one file, ~40 LOC), (b) the error-classifier mapping table (one file, ~30 LOC), (c) the GH Actions release workflow (one YAML file, ~150 lines), (d) the SKILL.md rewrite (one MD file, ~80 lines).

## Runtime State Inventory

> This phase includes a publish-then-cut deletion (commit B) of `apps/achilles/` + `apps/achilles-cli/`, plus the pre-publish deletion of 2 darwin sibling packages. Reviewing the categories explicitly:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — Phase 19 does NOT modify user state on disk. The `~/.achilles/` directory (containing `init.json`, `voice.lock`, `transcripts/`, `latency/`, `sessions/`, `key.enc`, `.key.salt`, `settings.json`, `achilles.log`, `debug-*.log`) is owned by Phase 18 + 17 and stays untouched. | None |
| Live service config | None — Phase 19 does NOT register with external services. The npm registry is the only external touch, and the publish operation is the registration. No webhooks, no API tokens to rotate (beyond the `NODE_AUTH_TOKEN` already managed by the operator). | None |
| OS-registered state | None — no Task Scheduler, launchd, pm2, systemd usage. The `~/.claude/skills/achilles/` symlink (or copy on Windows) created by `achilles install-skill` is the only OS-level registration, and Phase 19's SKILL.md rewrite updates its content via the npm package upgrade path (re-running `achilles install-skill --force` refreshes the symlink target's content). | None for Phase 19 install paths; document that existing v1.2 installations should run `npm update -g achilles && achilles install-skill --force` to pick up the rewritten SKILL.md |
| Secrets / env vars | None — Phase 19 does NOT introduce new env vars. The only secret in the publish surface is `NODE_AUTH_TOKEN` (an npm publish token) stored in GH Actions Secrets — operator-owned, not code-owned. | Operator confirms `NODE_AUTH_TOKEN` exists in repo secrets before triggering the release workflow |
| Build artifacts / installed packages | `apps/achilles-terminal/dist/` (cli.js + main.js + sourcemaps) — regenerated by `npm run build`. The 3 surviving sibling `apps/cli-<platform>-<arch>/bin/achilles[.exe]` files are CI artifacts uploaded between jobs, not committed to git (gitignore covers them). The 2 darwin siblings' `bin/` directories never existed (Phase 15 didn't build them); deleting the directories has no installed-artifact effect. | After commit A merges + publish succeeds, operator runs `npm update -g achilles` from a fresh shell to verify the new binary is reachable. The v1.2 `apps/achilles-cli/dist/` build artifacts disappear in commit B's deletion (no global install path depends on them post-cut). |

**The canonical question — "After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?":** For Phase 19, the answer is **nothing**. The only deletion target with downstream consumers is the Electron `.app` distribution from v1.2 — and that was already replaced by the v1.3 terminal package as soon as the user runs `npm update -g achilles`. The skill manifest at `~/.claude/skills/achilles/SKILL.md` updates automatically on the next `achilles install-skill --force` (or just naturally because the symlink points at the package dir).

## Common Pitfalls

### Pitfall 1: Publishing the parent before the siblings
**What goes wrong:** A user running `npm install -g achilles@1.3.0` between the parent publish and the siblings publish gets a parent that references missing optional deps. npm prints `ERESOLVE: unable to resolve dependency tree` warnings (non-fatal — optional deps are silently skipped on miss — but the user sees the warning and may abort).
**Why it happens:** Common newbie mistake; the natural alphabetical order ("achilles" before "@achilles/cli-*") puts the parent first.
**How to avoid:** Pattern 2 above — explicit sequential publish in the CI step ordering with siblings FIRST.
**Warning signs:** `npm view achilles@1.3.0` shows the parent published, `npm view @achilles/cli-linux-x64@1.3.0` returns 404.

### Pitfall 2: Publishing with `private: true`
**What goes wrong:** `npm publish` fails with `EPRIVATE` if `package.json` has `"private": true`. The check is hard-coded in the npm client.
**Why it happens:** `packages/achilles-skill/package.json` currently declares `private: true` (was bundled via `bundledDependencies` in v1.2, never published).
**How to avoid:** Flip `private: true` -> `private: false` in `packages/achilles-skill/package.json` as part of commit A. Add `"publishConfig": { "access": "public" }` if not already present (currently absent — v1.2 didn't need it).
**Warning signs:** CI publish step fails with `EPRIVATE` exit code on the achilles-skill step.

### Pitfall 3: `bundledDependencies` carryover from v1.2
**What goes wrong:** v1.2's `apps/achilles-cli/package.json:34` declares `"bundledDependencies": ["@achilles/achilles-skill"]` which means the achilles-skill package is bundled INTO the parent tarball at npm pack time. v1.3's `apps/achilles-terminal/package.json` does NOT declare `bundledDependencies`, so achilles-skill needs to resolve from the registry at install time.
**Why it happens:** If the operator copies the prepublishOnly hook from v1.2 verbatim, the `check-source-of-truth.mjs` script's second arm (which extracts from the bundled tarball at `extract/package/node_modules/@achilles/achilles-skill/skill/prompts/companion.md`) fails because the path doesn't exist (achilles-skill is no longer bundled).
**How to avoid:** Phase 17 already ported the source-of-truth check to a SINGLE-ARM form (source-vs-embedded-hash only) — see `apps/achilles-terminal/scripts/check-source-of-truth.mjs:7-11`. Phase 19 either accepts the single-arm form OR adds a NEW second arm that resolves achilles-skill via npm registry pre-install instead of bundled-tarball extraction.
**Warning signs:** CI source-of-truth check fails with "tarball missing expected file" message.

### Pitfall 4: macOS Gatekeeper on Bun-compiled binary (DISSOLVED BY OPTION 3)
**What goes wrong (historical):** Bun-compiled binaries downloaded from npm carry `com.apple.quarantine` extended attribute → Gatekeeper denies execution.
**Why it happens (historical):** Unsigned binaries require code signing + notarytool to pass Gatekeeper.
**How to avoid:** Phase 19 produces NO compiled darwin binary (Option 3 lock). The JS-fallback bundle runs under `#!/usr/bin/env node` shebang — no Gatekeeper involvement. **This pitfall is dissolved by the Option 3 architecture; no mitigation needed.**

### Pitfall 5: macOS smoke step publishes nothing
**What goes wrong:** A novice CI workflow author might wire the macOS runner to publish `@achilles/cli-darwin-arm64` (the historical Phase 15 plan). Under Option 3, the macOS runner publishes NOTHING platform-specific — it only runs `bunx achilles@1.3.0 voice --help` (or equivalent) as a smoke that the JS-fallback bundle resolves and executes.
**Why it happens:** Plan inertia from the original 5-platform layout.
**How to avoid:** The release workflow's macOS step is explicitly a smoke job, not a publish job. Its only outputs are the smoke-step exit code + console log.
**Warning signs:** A `@achilles/cli-darwin-*` package appears on the registry post-publish (it should not exist).

### Pitfall 6: SKILL.md `allowed-tools` array delimiter mistakes
**What goes wrong:** SKILL.md frontmatter is YAML. The `allowed-tools` field accepts a comma-separated string OR a YAML list — but Claude Code's parser (per https://code.claude.com/docs/en/skills) expects a SPECIFIC shape. v1.2 used the comma-separated string form (`allowed-tools: Bash`). v1.3's 8-pattern narrow uses the same comma-separated form per `.planning/research/v1.3-terminal-pivot.md` line 694.
**Why it happens:** A naive rewrite might convert to a YAML block list (`- Bash(achilles voice *)\n- Bash(achilles init *)...`) which parses but is not what Claude Code expects.
**How to avoid:** Keep the single-line comma-separated form:
```yaml
allowed-tools: Bash(achilles voice *), Bash(achilles init *), Bash(achilles config *), Bash(achilles transcripts *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)
```
**Warning signs:** Skill body invocations fail with "tool not permitted" even though the frontmatter looks correct.

### Pitfall 7: Banner state leak across error events
**What goes wrong:** ERR-01 banner uses React state with `useEffect` + `setTimeout`. If a second error event fires while the first banner is still visible (within the 8s window), the old timer fires first and dismisses the new error's banner prematurely.
**Why it happens:** `useEffect` cleanup runs on dep change; if the dep is just `visible`, the old timer cleanup runs but the new timer doesn't reset properly.
**How to avoid:** Include `errorNonce` as a `useEffect` dependency so each new error event resets the timer cleanly. Pattern 3 above shows the canonical shape.
**Warning signs:** Cascading-failure tests show banner dismissed before 8s when a second error fires.

### Pitfall 8: ESLint `no-restricted-syntax` AST selector wrong shape
**What goes wrong:** The selector `ObjectExpression > Property[key.name='stdio'][value.value='ignore']` only catches `{ stdio: "ignore" }` literals. It does NOT catch `const STDIO_MODE = "ignore"; spawn(cmd, args, { stdio: STDIO_MODE });` (variable indirection) or `spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })` (array form where one element is `"ignore"`).
**Why it happens:** AST-based rules are syntactic, not semantic — they don't follow variable bindings.
**How to avoid:** Accept the false-negative rate for variable indirection (rare in our codebase; the historical bug used a literal). For the array form, extend the selector to also catch `ArrayExpression > Literal[value='ignore']` inside the stdio property OR rely on the second-line review process to catch array-form usage. **Recommend: accept the literal-only selector for v1.3 and document the limitation.**
**Warning signs:** A future regression PR uses `{ stdio: ["ignore", "ignore", "ignore"] }` (array form) and the lint rule misses it.

### Pitfall 9: `npm view` cache lag after publish
**What goes wrong:** Immediately after `npm publish` returns success, `npm view <pkg>@<version>` may return 404 due to registry CDN cache propagation (~30 seconds).
**Why it happens:** npm's CDN is eventually-consistent; the publish response is fast, but the read-side cache hydration is slower.
**How to avoid:** Add `sleep 30` between the final publish step and the verification step. Alternative: poll `npm view` with backoff up to 60s.
**Warning signs:** Verification step fails with "404 Not Found" on a publish that actually succeeded.

### Pitfall 10: Reachability check for commit B too narrow
**What goes wrong:** Commit B deletes `apps/achilles-cli/` based on a reachability grep. If the grep pattern misses an import variant (e.g., `from "../achilles-cli/dist/cli.js"` vs `from "@achilles/achilles-cli"` vs `from "../../achilles-cli"`), deletion breaks the workspace silently until the next CI run.
**Why it happens:** Hand-rolled grep is fragile across path-style variants and ESM dynamic imports.
**How to avoid:** Use multiple grep variants:
```bash
grep -rn "from ['\"]\\.\\./achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .
grep -rn "from ['\"]@achilles/achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .
grep -rn "import.*achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .
grep -rn "require.*achilles-cli" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" .
```
PLUS run `npm run build --workspaces --if-present` to fail loudly on any broken import.
**Warning signs:** Commit B passes git, but the next CI run fails with `Cannot find module '../achilles-cli/dist/...'` somewhere.

## Code Examples

### Example 1: Sequential publish in GH Actions (from `achilles-release.yml`)

```yaml
publish:
  needs: [build-linux-x64, build-linux-arm64, build-win32-x64]
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write  # for npm provenance (optional, recommended)
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }

    - uses: actions/setup-node@v4
      with:
        node-version: "22"
        registry-url: "https://registry.npmjs.org"

    - name: Install workspace deps
      run: npm ci --include=optional --force

    - name: Build JS-fallback bundle (parent + node bundle)
      working-directory: apps/achilles-terminal
      run: npm run build

    - name: Download linux-x64 binary
      uses: actions/download-artifact@v4
      with:
        name: cli-linux-x64-binary
        path: apps/cli-linux-x64/bin/

    - name: Download linux-arm64 binary
      uses: actions/download-artifact@v4
      with:
        name: cli-linux-arm64-binary
        path: apps/cli-linux-arm64/bin/

    - name: Download win32-x64 binary
      uses: actions/download-artifact@v4
      with:
        name: cli-win32-x64-binary
        path: apps/cli-win32-x64/bin/

    - name: SHA-256 source-of-truth check
      run: node apps/achilles-terminal/scripts/check-source-of-truth.mjs

    - name: Tarball secret-scan (parent)
      working-directory: apps/achilles-terminal
      run: node scripts/check-tarball-no-secrets.mjs

    # Sequential publish: SIBLINGS FIRST per Pattern 2
    - name: Publish @achilles/cli-linux-x64
      working-directory: apps/cli-linux-x64
      env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }} }
      run: npm publish --access public --provenance

    - name: Publish @achilles/cli-linux-arm64
      working-directory: apps/cli-linux-arm64
      env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }} }
      run: npm publish --access public --provenance

    - name: Publish @achilles/cli-win32-x64
      working-directory: apps/cli-win32-x64
      env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }} }
      run: npm publish --access public --provenance

    - name: Publish @achilles/achilles-skill
      working-directory: packages/achilles-skill
      env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }} }
      run: npm publish --access public --provenance

    - name: Publish achilles (parent)
      working-directory: apps/achilles-terminal
      env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_PUBLISH_TOKEN }} }
      run: npm publish --access public --provenance

    - name: Wait for CDN propagation
      run: sleep 30

    - name: Verify parent on registry
      run: npm view achilles@1.3.0 version

    - name: Verify siblings on registry
      run: |
        npm view @achilles/cli-linux-x64@1.3.0 version
        npm view @achilles/cli-linux-arm64@1.3.0 version
        npm view @achilles/cli-win32-x64@1.3.0 version
        npm view @achilles/achilles-skill@1.3.0 version

macos-smoke:
  needs: publish
  runs-on: macos-14
  steps:
    - uses: actions/setup-node@v4
      with: { node-version: "22" }

    - uses: oven-sh/setup-bun@v2
      with: { bun-version: "1.3.14" }

    - name: Install published parent globally
      run: npm install -g achilles@1.3.0

    - name: Smoke under Node
      run: achilles --version

    - name: Smoke under Bun (DIST-06)
      run: bunx achilles@1.3.0 --version
```

### Example 2: SKILL.md rewrite (D-03/04/05/06/07 — terminal-only model)

```markdown
---
name: achilles
description: Voice companion for Claude Code. Use this skill when the developer says they want to talk, asks to use voice, runs the /achilles slash command, or otherwise indicates they want a spoken interaction. The skill takes over the current terminal pane and runs an in-terminal voice loop: it captures microphone audio through sox, transcribes via ElevenLabs Scribe v2, hands the transcript to a `claude -p` subprocess that shares the embedded companion prompt, and plays short spoken acknowledgements + summaries back through ElevenLabs Flash v2.5 via ffplay. The achilles CLI must be installed first via `npm install -g achilles` (Bun-preferred on macOS); sox and ffmpeg must be on PATH; an ElevenLabs API key must be configured through `achilles init` or the ELEVENLABS_API_KEY environment variable.
allowed-tools: Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(achilles config *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)
---

# Achilles voice companion for Claude Code

Set `BASH_MAX_TIMEOUT_MS=86400000` (24 hours) in your environment before invoking this skill. The default 600s (10 minute) Bash tool timeout will cut off any voice session longer than 10 minutes, leaving sox/ffplay/claude orphans behind. The 24-hour cap is the maximum the Bash tool accepts; sessions running longer than that should be split.

## What it does

Achilles is a voice front end for a Claude Code session running on the developer's own workstation. It takes over the current terminal pane and renders a small reactive surface — a pulsing block-character blob, a braille waveform, and a state row — inline alongside the conversation log. When the user speaks, sox captures audio, an energy-threshold VAD detects utterance boundaries, ElevenLabs Scribe v2 produces a committed transcript, and that transcript is handed to a local `claude -p` subprocess. claude replies normally in the terminal; two short regions of the reply are routed to ElevenLabs Flash v2.5 and played through ffplay. Everything else stays silent on screen.

The contract for what's spoken vs. what stays silent — the ≤12-word opening acknowledgement, the ≤40-word closing `<spoken-summary>` block, the failure-override phrase, the silent body — lives in `prompts/companion.md` and is injected to claude via `--append-system-prompt-file`. The skill body does not duplicate the contract.

## Prerequisites

- The achilles CLI must be installed on the user's machine: `npm install -g achilles`. On macOS, Bun is preferred for sub-500ms cold start (`bun install -g achilles` or set `PATH` so Bun is ahead of Node). On linux-x64, linux-arm64, and win32-x64, a compiled Bun binary ships in the `@achilles/cli-<platform>-<arch>` optional dependency and is dispatched automatically by the bin shim. On macOS (darwin-arm64, darwin-x64), the JS-fallback bundle runs under Node 22+ via the `#!/usr/bin/env node` shebang; Bun execution is the recommended path but not required.
- `sox` and `ffmpeg` must be on PATH:
  - macOS: `brew install sox ffmpeg`
  - Debian / Ubuntu Linux: `sudo apt install sox ffmpeg`
  - Windows: `choco install sox.portable ffmpeg`
- An ElevenLabs API key must be configured. Run `achilles init` to walk the wizard (API key resolution → sox/ffmpeg/claude preflight → 5-second ambient calibration → 1-utterance smoke test). The wizard stores the key in your OS keychain via `@napi-rs/keyring`, with an encrypted file at `~/.achilles/key.enc` as a fallback. The headless / CI path is the `ELEVENLABS_API_KEY` env var, which always wins on read.
- macOS only: microphone permission is granted to the **parent terminal emulator** (iTerm2 / Terminal.app / Ghostty / WezTerm), not to achilles itself. The first sox spawn triggers the standard macOS Privacy & Security prompt for whichever terminal you launched achilles from. VS Code's integrated terminal historically does NOT propagate this permission correctly (microsoft/vscode#307364); the `achilles init` wizard detects this case and prints "Open Terminal.app once, then return" with a copy-paste line. No floating UI window is involved; there is no `systemPreferences.askForMediaAccess` call, no Electron .app, no X-forwarding requirement.

## How to launch

When the user invokes this skill, use the Bash tool to run `achilles voice`. The command takes over the current terminal pane and renders the reactive surface until the user presses Ctrl-C or says "stop". It is NOT detached — Claude Code's Bash tool waits for the process to exit. This is intentional: the skill body invocation is interactive and the visual surface lives inside the same terminal pane Claude Code is using. With `BASH_MAX_TIMEOUT_MS=86400000` set per the note at the top, the Bash tool will wait up to 24 hours for the user to Ctrl-C.

If `achilles` is missing, run `which achilles` first. If absent, surface the install line: `npm install -g achilles`. If `which sox` or `which ffmpeg` reports missing, surface the per-platform install line from the Prerequisites section above. Do not retry or guess; surface the missing-binary diagnostic verbatim and let the user resolve it before re-invoking.

The launch is foreground. Do not invoke other Bash tool calls on the same Claude Code thread while `achilles voice` is running; they will queue behind it.

## How the spoken interaction works

The model's reply is divided into three regions. The first region is a short opening sentence that confirms what work is about to start; it is read aloud before any tool calls so the user gets immediate audio feedback. The second region is the silent body of the reply — tool calls, code edits, file diffs, intermediate explanations, tool result summaries — which the user reads in the terminal. The third region is a closing `<spoken-summary>` block on its own line followed by a closing tag; that block is read aloud once terminal work finishes.

Only the first sentence and the contents of the `<spoken-summary>` block are routed to ElevenLabs Flash v2.5. Everything else remains silent on screen. The exact contract — the word caps on each spoken region, the marker tag syntax, the list of formatting elements forbidden inside the spoken summary, and the failure-override phrase — lives in `prompts/companion.md`. Achilles passes that file to claude via `--append-system-prompt-file`, so the contract is identical across the npm CLI launch path and this skill launch path.

## When the run fails

When work fails for any reason — a tool exits non-zero, a permission is refused, sox or ffplay dies, the ElevenLabs WSS connection trips the circuit breaker, or the orchestrator hits an unrecoverable error — the closing spoken summary opens with the fixed phrase `I ran into a problem` regardless of what the model narrated. The orchestrator determines failure from the claude run's exit code and tool_result events; the model's narration is not authoritative on the failure path. When the spoken stream opens with `I ran into a problem`, the user knows to scroll the terminal back and read what went wrong before issuing the next request.

In addition, an inline red error banner appears one row above the state row whenever a transient failure occurs (network, auth, rate-limit, sox, ffplay, claude). The banner names the error class and suggests a next action; it auto-dismisses after 8 seconds or on the next successful event, whichever comes first.

## Privacy

Achilles holds the ElevenLabs API key only in the user's OS keychain (or, as a fallback, in an encrypted file at `~/.achilles/key.enc` with 0o600 permissions). The npm tarball never contains a key (CI-enforced via a secret-scan step at publish time), local log files never write the key (a 7-regex redaction filter is applied to every log line), and child subprocess invocations do not pass the key on the command line.

Outbound network traffic from achilles goes only to ElevenLabs endpoints (Scribe v2 STT, Flash v2.5 TTS) and to the local `claude` subprocess. No audio or transcript content leaves the user's machine except to ElevenLabs.

Transcripts are not persisted by default. Use `achilles voice --save-transcripts` to opt in; transcripts are written to `~/.achilles/transcripts/<session-id>.jsonl` with secret redaction and a 30-day retention default. Inspect them with `achilles transcripts list`; delete them with `achilles transcripts purge`.

A structured log file at `~/.achilles/achilles.log` (NDJSON, 10MB rotation, 0o600 permissions, key redaction always on) records every session regardless of flags. This closes a gap from v1.2 where a silent-stdio launcher hid the renderer-wiring defect; the log file always exists so future debugging has something to read.
```

### Example 3: Error classifier mapping

```ts
// apps/achilles-terminal/src/error-classifier.ts (NEW)
import type { SessionErrorClassification } from "./session-events.js";

export interface ClassifiedBanner {
  readonly class: string;
  readonly suggestedAction: string;
}

const TABLE: Record<SessionErrorClassification, ClassifiedBanner> = {
  network: {
    class: "network",
    suggestedAction: "retrying...",
  },
  auth: {
    class: "auth",
    suggestedAction: "check ELEVENLABS_API_KEY",
  },
  rate_limit: {
    class: "rate-limit",
    suggestedAction: "ElevenLabs rate limit — retrying in 30s",
  },
  server: {
    class: "server",
    suggestedAction: "ElevenLabs 5xx — retrying with backoff",
  },
  mic_unavailable: {
    class: "sox",
    suggestedAction: "Audio device lost — restart Achilles",
  },
  playback_lost: {
    class: "ffplay",
    suggestedAction: "Audio output lost — restart Achilles",
  },
  claude_failed: {
    class: "claude",
    suggestedAction: "claude subprocess failed — Ctrl-C and retry",
  },
  unknown: {
    class: "unknown",
    suggestedAction: "see ~/.achilles/achilles.log",
  },
};

export function classifyForBanner(
  classification: SessionErrorClassification,
): ClassifiedBanner {
  return TABLE[classification];
}
```

### Example 4: Activate ESLint `stdio:"ignore"` forbid rule

```js
// apps/achilles-terminal/eslint.config.js — modify lines 26-44:
rules: {
  // GATE-04: forbid `stdio: "ignore"` on the launch path (prevents
  // v1.2 detached-stdio regression). The selector matches only the
  // literal { stdio: "ignore" } shape — variable indirection and
  // array form (e.g. { stdio: ["ignore", "pipe", "pipe"] }) are
  // accepted false-negatives documented in 19-RESEARCH.md Pitfall 8.
  "no-restricted-syntax": [
    "error",
    {
      selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
      message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
    },
  ],
},
```

### Example 5: Logger fan-out at `runVoice()` entry

```ts
// apps/achilles-terminal/src/session.ts — runVoice() entry excerpt
import { createStructuredLogger } from "./structured-logger.js";

export async function runVoice(argv: string[]): Promise<void> {
  // ERR-08: unconditional logger. Writes to ~/.achilles/achilles.log on
  // every run regardless of flags. Closes the v1.2 silent-stdio gap that
  // hid the renderer-wiring defect.
  const logger = createStructuredLogger();
  logger.info("run_voice_start", {
    pid: process.pid,
    argv,
    nodeVersion: process.version,
  });

  // ... pass logger.child(scope) into every audio module:
  const micSox = createMicSox({ ..., logger: logger.child("mic-sox") });
  const ttsPlayback = createTtsPlayback({ ..., logger: logger.child("tts") });
  const sttBridge = createSttBridge({ ..., logger: logger.child("stt") });
  const claudeBridge = createClaudeBridge({ ..., logger: logger.child("claude") });

  // Watchdogs already have a logger field per Phase 17:
  const soxWatchdog = createChildExitWatchdog({
    label: "sox",
    child: micSox.child,
    respawnFactory: () => createMicSox({ ... }).child,
    onError: (msg) => session.emit("event", { type: "error", payload: { classification: "mic_unavailable", message: msg }, timestamp: Date.now() }),
    logger: logger.child("sox-watchdog"),
  });
  // ... ffplay watchdog mirrors the same shape

  // On graceful shutdown, dispose to flush in-flight writes:
  registerShutdownHook(async () => {
    logger.info("run_voice_end", {});
    await logger.flush();
    logger.dispose();
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v1.2 Electron + floating window | v1.3 terminal-only TUI (Ink 7 + React 19) | 2026-06-08 (Phase 15-18 complete) | The product surface fits in the terminal pane; no Electron .app, no X-forwarding, no IPC |
| v1.2 `achilles launch` (detached spawn with `stdio: "ignore"`) | v1.3 `achilles voice` (foreground, stdio inherited) | 2026-06-08 | Closes the v1.2 silent-launch failure mode at the structural level |
| v1.2 5-platform compiled binary plan (linux-x64/arm64, win32-x64, darwin-arm64/x64) | v1.3 3-platform compiled binaries (linux-x64/arm64, win32-x64) + macOS JS-fallback under Bun | 2026-06-09 (Option 3 lock) | No Apple Developer ID required; macOS users get a slightly slower cold start (~500ms vs ~50ms) in exchange for zero codesign friction |
| v1.2 `apps/achilles-cli` bundled `@achilles/achilles-skill` via `bundledDependencies` | v1.3 `@achilles/achilles-skill@1.3.0` published as a public dep on the registry | Phase 19 | The achilles-skill package becomes part of the public publish surface; install becomes registry-driven, not tarball-bundled |
| v1.2 SKILL.md frontmatter `allowed-tools: Bash` (broad) | v1.3 SKILL.md frontmatter narrowed to 8 specific patterns | Phase 19 (D-04) | Tighter permission grant; matches the actual subcommand surface |
| `npm view <pkg>` for immediate post-publish verification | `sleep 30 && npm view <pkg>` for CDN cache propagation | always (best practice) | Avoids spurious 404 failures after successful publish |
| Single-arm SHA-256 source-of-truth check (Phase 17 ported) | Same single-arm shape (no second arm needed under Option 3) | Phase 17 | Bundle-arm dissolved because achilles-skill is now a public dep, not a bundled dep |

**Deprecated/outdated:**
- `apps/achilles/` Electron app: delete in commit B
- `apps/achilles-cli/src/commands/launch.ts`: delete in commit B (179 LOC)
- `apps/achilles-cli/src/skill-symlink.ts`: PORT to `apps/achilles-terminal/src/install-skill.ts` then delete in commit B
- `apps/achilles-cli/src/commands/install-skill.ts`: PORT to `apps/achilles-terminal/src/install-skill.ts` then delete in commit B
- `apps/achilles-cli/scripts/check-source-of-truth.mjs`: superseded by Phase 17's `apps/achilles-terminal/scripts/check-source-of-truth.mjs`; delete in commit B
- `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs`: PORT to `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` (Phase 17 did NOT port this), then delete in commit B
- `apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/`: delete entire directories in commit A (D-02 PRE-publish)
- Apple Developer ID, codesign, notarytool, spctl, `xattr -dr com.apple.quarantine`: all dissolved by Option 3 lock

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `JS-DevTools/npm-publish@v3` is the standard ecosystem choice for idempotent npm publish in 2026 | Standard Stack | Could use raw `npm publish --access public` with `NODE_AUTH_TOKEN` env; both work. Verify operator preference at plan time. [ASSUMED] |
| A2 | npm registry CDN cache propagation completes within 30s | Code Examples | If propagation is slower, the post-publish `npm view` smoke fails spuriously. Mitigation: bump to 60s or poll with backoff. [ASSUMED] |
| A3 | `optionalDependencies` with missing platform package emits a warning, not a fatal error, on `npm install -g` | Architecture Patterns | If npm 11+ changes this to a hard error, the bin shim's `existsSync(binPath)` fallback is moot and macOS install breaks. **Verify with operator before Phase 19 publish** by running `npm install -g achilles@1.3.0` on a macOS host before announcing the release. [ASSUMED — but Phase 15 lockfile validation suggests this behaviour is current] |
| A4 | Phase 17's `child-exit-watchdog.ts` is already wired in `session.ts` for both sox AND ffplay children | Code Examples / Pattern 4 | If only sox is wired and ffplay is missing, Phase 19 must wire ffplay (not just verify). Plan task must read `session.ts` and confirm both `createChildExitWatchdog` calls exist OR add the missing one. [ASSUMED — Phase 17 contract calls for both per 17-CONTEXT.md lines 121-126] |
| A5 | The `@achilles/achilles-skill` package can be flipped from `private: true` to `private: false` and published with no test fixtures referencing the private flag | Pitfalls | Low-risk; the flag is a publish-gate only and has no runtime effect. **Plan task should grep for the literal string `"private": true` across achilles-skill to confirm no other usage.** [ASSUMED] |
| A6 | macOS smoke step (`bunx achilles@1.3.0 --version`) is sufficient to verify DIST-06 in CI; the full voice round-trip is captured at Phase 20 (GATE-01 RBS-1 asciicast) | Code Examples | If DIST-06 requires more than `--version` in CI, the macos-smoke step needs to spawn sox + ffplay (which requires the macos-14 runner to have these tools installed). **Plan task should confirm DIST-06 acceptance criteria with operator.** [ASSUMED — DIST-06 wording in REQUIREMENTS.md line 18 mentions "verified end-to-end... init wizard -> first achilles voice -> speak -> spoken summary -> Ctrl-C clean exit" which is BEYOND CI capacity; that's GATE-01 RBS-1's job at Phase 20] |
| A7 | The `@achilles/cli-<platform>-<arch>` packages do NOT need a build step at publish time — the binary in `bin/achilles[.exe]` is materialized in the matrix-build job and downloaded as an artifact | Code Examples | If `prepublishOnly` runs `bun build --compile` per sibling, it would fail (the sibling's package.json has no build script). The pattern locks the materialize-via-artifact path. [VERIFIED: apps/cli-linux-x64/package.json has no `scripts` field; the binary is pre-built and uploaded as a CI artifact] |
| A8 | The ERR-01 banner's `aria-role="status"` is acceptable Ink 7 syntax | Code Examples | Phase 16's `ScreenReader.tsx` uses `aria-role="timer"` because "status" was not in Ink 7's role enum at the time (D-16-03-02 deviation). **Plan task should check Ink 7 current `aria-role` enum; if "status" is unsupported, use "timer" or fall back to `aria-label` only.** [ASSUMED — Phase 16 found "timer" was the closest live-region role available] |
| A9 | The `BASH_MAX_TIMEOUT_MS=86400000` documentation in SKILL.md body actually gets read by Claude Code's Bash tool | Code Examples | Claude Code's Bash tool reads `BASH_MAX_TIMEOUT_MS` from the shell env at invocation time. The SKILL.md body documents this for the USER (or Claude itself) to set before invoking the skill. The setting is NOT auto-applied by the skill; the documentation is the only mechanism. [VERIFIED: anthropics/claude-code Bash tool reads BASH_MAX_TIMEOUT_MS, see https://docs.claude.com/en/docs/build-with-claude/agent-skills + general Claude Code env var docs] — but A9 specifically claims the BODY documentation is sufficient guidance; if a future Claude Code release makes this configurable per-skill, the body documentation becomes outdated. [ASSUMED — current shape] |
| A10 | The achilles-release.yml workflow can be triggered manually via `workflow_dispatch` AND on a version tag push (e.g., `git tag v1.3.0 && git push --tags`) | Code Examples | Standard GH Actions pattern; both triggers work. Operator preference may vary. **Plan task should decide which trigger model to ship.** [ASSUMED] |

**Risk summary:** Assumptions A3, A4, A6, A8 are the load-bearing ones the planner should verify at plan time. A3 has a CI-time check (the macos-smoke job). A4 has a code-time check (grep session.ts for `createChildExitWatchdog`). A6 is a requirements-interpretation question for the operator. A8 has a runtime check (lint + render in vitest).

## Open Questions

1. **Should Phase 19 wire `install-skill` as a new subcommand in `apps/achilles-terminal/src/cli.ts`?**
   - What we know: DIST-03 requires `achilles install-skill [--force]` to work. `apps/achilles-terminal/src/cli.ts` currently has 5 subcommands (`voice`, `init`, `config`, `transcripts`, `latency`); `install-skill` is absent.
   - What's unclear: Whether the Phase 19 plan should ADD install-skill (likely yes, per DIST-03), or whether the user is expected to use the v1.2 `apps/achilles-cli`'s install-skill until commit B's deletion.
   - Recommendation: ADD `install-skill` to `apps/achilles-terminal/src/cli.ts` in commit A (via dynamic-import gate, INIT-07 preserved). Port the v1.2 install-skill.ts + skill-symlink.ts logic verbatim. Commit B deletes the v1.2 originals.

2. **Should the SHA-256 source-of-truth check add a second arm (source-vs-tarball)?**
   - What we know: v1.2 had a two-arm check (source-vs-tarball-bundled). Phase 17 ported only the single arm (source-vs-embedded-hash). The two-arm form caught a different drift class: "the developer edited companion.md but forgot to rebuild the embedded hash" PLUS "the build process introduced a corruption between source and tarball."
   - What's unclear: Whether the single-arm form is sufficient given that the embedded hash is generated from the source at build time (so the two arms collapse to one).
   - Recommendation: SINGLE-ARM IS SUFFICIENT. Document in the plan that the second arm is intentionally absent.

3. **Should ERR-03 watchdog's cap-exceeded behavior call `process.exit` or stay-in-error-state?**
   - What we know: CONTEXT.md Claude's Discretion section explicitly recommends stay-in-error-state. Phase 18 ERR-04 typed-input fallback still works (typed transcripts flow through the same sandwich-wrap pipeline as voice transcripts; the mic being dead doesn't break typing).
   - What's unclear: Whether the user can RECOVER from cap-exceeded without restarting (probably not — sox is dead, no respawn path). The user gets ONE more typed exchange and then must Ctrl-C and restart.
   - Recommendation: STAY-IN-ERROR-STATE. Emit the locked `AUDIO_DEVICE_LOST_MESSAGE` via the session error channel; banner displays "[error] sox -- Audio device lost — restart Achilles"; typed-input fallback remains active; Ctrl-C does normal graceful shutdown.

4. **Should ERR-08 logger rotation strategy use single archive, daily, or N-ring?**
   - What we know: CONTEXT.md Claude's Discretion recommends single archive (`achilles.log` + `achilles.log.1`). Phase 17's structured-logger ALREADY implements single-archive rotation at 10MB.
   - What's unclear: nothing — Phase 17 wrote the single-archive implementation; Phase 19 just wires the unconditional call.
   - Recommendation: ACCEPT single archive. Phase 19 wiring is one-line (`createStructuredLogger()` at runVoice() entry).

5. **Should the achilles-release.yml workflow be triggered on tag push or on `workflow_dispatch`?**
   - What we know: Both are standard. Tag push is common ("git tag v1.3.0 && git push --tags triggers publish"); `workflow_dispatch` is operator-driven (the operator manually triggers the workflow run via the GH Actions UI).
   - What's unclear: Operator preference. The user owns the release.
   - Recommendation: Support BOTH. Wire `on: workflow_dispatch:` AND `on: push: tags: [v*]:`. The operator picks whichever is more convenient.

6. **Should `apps/achilles-cli/` delete entirely in commit B, or only delete launch.ts + commands/?**
   - What we know: `apps/achilles-cli/src/` has 14 source files including `electron-binary-locator.ts`, `skill-symlink.ts`, `cli.ts`, and the 5 command files. ALL of these are v1.2-specific.
   - What's unclear: Whether the v1.3 monorepo's root scripts (`npm run check:source-of-truth`, `npm run check:tarball:secrets` in root package.json:31-33) reference `apps/achilles-cli/scripts/` and would break after the delete.
   - Recommendation: After commit A ports the scripts to `apps/achilles-terminal/scripts/`, UPDATE root `package.json` to point at the new paths, THEN delete `apps/achilles-cli/` entirely in commit B. Add a reachability check via grep (Pitfall 10 above) to verify zero importers remain.

7. **Should the macOS smoke step run `bunx achilles@1.3.0 voice` (full voice loop) or just `achilles --version`?**
   - What we know: A6 above assumes `--version` is sufficient. Full voice would require sox + ffmpeg + ElevenLabs API key on the macos-14 runner — none of which is currently provisioned in CI.
   - What's unclear: DIST-06's literal acceptance criteria say "init wizard -> first achilles voice -> speak -> spoken summary -> Ctrl-C clean exit." That's manifestly not a CI smoke; it's a human-recorded asciicast (GATE-01 RBS-1, Phase 20 scope).
   - Recommendation: macOS smoke = `bunx achilles@1.3.0 --version` (verifies the JS-fallback bundle dispatches under Bun via the shebang). The full DIST-06 verification is Phase 20 GATE-01 RBS-1 asciicast.

## Environment Availability

> Phase 19 produces a release artifact; its execution depends on tools installed on the CI runner, not on the operator's local machine (except for git + npm at version-bump time). The operator-local requirements are minimal.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | Operator workflow (commit A, commit B) | required | any | none |
| `npm` 10.9.3+ | Operator (running `npm version` to bump) AND CI | required | 10.9.3+ | none |
| `node` 22+ | CI publish job + macOS smoke | required | 22+ | none |
| `bun` 1.3.14 | CI build jobs (matrix.os) | required | 1.3.14 | none — Bun is the canonical compile-binary toolchain |
| GH Actions `NODE_AUTH_TOKEN` secret | CI publish job | operator-provisioned | — | none — required for npm publish auth |
| `esbuild` 0.28.0 | CI publish job (JS-fallback bundle build) | workspace dep | 0.28.0 | none |
| `npm view` registry connectivity | CI verification step | required | — | poll with backoff up to 60s |

**Missing dependencies with no fallback:** None — the operator's local box needs only git + npm. CI's needs are all already provisioned by the existing `achilles-terminal-ci.yml` Bun + Node steps.

**Missing dependencies with fallback:** None — all paths have a single canonical source.

## Validation Architecture

> `.planning/config.json` is unknown at this read; defaulting to nyquist_validation ENABLED (per the "absent = enabled" rule).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (root pin) |
| Config file | `apps/achilles-terminal/vitest.config.ts` (Phase 15) |
| Quick run command | `npm test --workspace apps/achilles-terminal -- --pool=forks <test-file>` |
| Full suite command | `npm test --workspace apps/achilles-terminal -- --pool=forks` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-03 | `achilles install-skill [--force]` registers the skill from npm-bundled SKILL.md; SHA-256 source-of-truth check passes | unit (install-skill action) + CI integration (CI runs `node scripts/check-source-of-truth.mjs`) | `npm test --workspace apps/achilles-terminal -- --pool=forks tests/install-skill.test.ts` AND `node apps/achilles-terminal/scripts/check-source-of-truth.mjs` | ❌ Wave 0 (NEW tests + port from v1.2 apps/achilles-cli/src/commands/install-skill.test.ts) |
| DIST-04 | `/achilles` from Claude Code launches the same binary as `npm install -g achilles && achilles voice`; companion.md SHA-256-verified at build time | CI integration (macos-smoke job) + the `check-source-of-truth.mjs` script | smoke job + script invocation | ✅ scripts already exist; ❌ Wave 0 macos-smoke job needs adding to achilles-release.yml |
| DIST-06 | macOS users install via `npm install -g achilles` or `bunx achilles`; JS-fallback under Bun (Node 22 fallback); no codesign | CI smoke (macos-14 runner runs `bunx achilles@1.3.0 --version` after publish) + Phase 20 GATE-01 RBS-1 asciicast for full verification | `bunx achilles@1.3.0 --version` in macos-smoke job | ❌ Wave 0 (macos-smoke job in release workflow) |
| ERR-01 | Inline error banner names error class + suggests next action; auto-dismiss 8s or on next successful event | unit (Banner component with `vi.useFakeTimers()`) + integration (VoiceShell + session.emit("event", { type: "error", ... })) | `npm test --workspace apps/achilles-terminal -- tests/ui/banner.test.tsx` | ❌ Wave 0 |
| ERR-03 | sox + ffplay child-exit watchdog respawns bounded (3-in-10s); cap-exceeded transitions to error state | unit (Phase 17 already covered — see `apps/achilles-terminal/tests/child-exit-watchdog.test.ts`) + Phase 19 wiring verification | `npm test --workspace apps/achilles-terminal -- tests/child-exit-watchdog.test.ts` AND grep verification of `session.ts` wiring | ✅ Phase 17 covers the watchdog; ❌ Wave 0 session.ts wiring test needs adding |
| ERR-08 | Unconditional structured logger to `~/.achilles/achilles.log` on every run; key redacted; 10MB rotation | unit (Phase 17 covered the writer) + Phase 19 wiring verification: assert `createStructuredLogger` is called from `runVoice()` entry | `npm test --workspace apps/achilles-terminal -- tests/structured-logger.test.ts` AND grep verification of runVoice() | ✅ Phase 17 covers the writer; ❌ Wave 0 runVoice() wiring test needs adding |

### Sampling Rate

- **Per task commit:** `npm test --workspace apps/achilles-terminal -- --pool=forks <touched-test-file>` (e.g., `tests/ui/banner.test.tsx`)
- **Per wave merge:** `npm test --workspace apps/achilles-terminal -- --pool=forks` (full suite; expected ~120 tests + 6 new Phase 19 tests)
- **Phase gate:** Full suite green + `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` green + `node apps/achilles-terminal/scripts/check-source-of-truth.mjs` green + `node apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` green (the latter is NEW in Phase 19) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/achilles-terminal/tests/ui/banner.test.tsx` — covers ERR-01 (Banner render + auto-dismiss + success-dismiss)
- [ ] `apps/achilles-terminal/tests/error-classifier.test.ts` — covers the SessionErrorClassification -> ClassifiedBanner mapping table
- [ ] `apps/achilles-terminal/tests/install-skill.test.ts` — covers DIST-03 install-skill subcommand (port from v1.2 + adapt)
- [ ] `apps/achilles-terminal/tests/cli-install-skill.test.ts` — covers the cli.ts dynamic-import gate for install-skill
- [ ] `apps/achilles-terminal/scripts/check-tarball-no-secrets.mjs` — port from v1.2 (NEW script, with paired .test.mjs)
- [ ] `apps/achilles-terminal/scripts/check-tarball-no-secrets.test.mjs` — paired test
- [ ] `apps/achilles-terminal/tests/session-err08-wiring.test.ts` — asserts runVoice() unconditionally constructs structured logger (regression guard for the v1.2 silent-stdio gap)
- [ ] `apps/achilles-terminal/tests/session-err03-wiring.test.ts` — asserts session.ts constructs both sox + ffplay watchdogs (regression guard)
- [ ] `apps/achilles-terminal/tests/skill-md-contract.test.ts` — contract test asserting frontmatter `allowed-tools` has exactly 8 entries matching the locked list (D-04)
- [ ] `apps/achilles-terminal/tests/eslint-stdio-ignore.test.ts` — runs ESLint programmatically against a fixture with `{ stdio: "ignore" }` and asserts the rule fires
- [ ] `.github/workflows/achilles-release.yml` — NEW publish workflow file with matrix build + sequential publish + macOS smoke

*(no other test infrastructure gaps — Phase 17/18 already cover the test fixtures, mock-loop scaffolding, and integration test harness)*

## Security Domain

> security_enforcement is treated as enabled by default. Phase 19's security surface is small (publish + skill manifest) but load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Documented in 19-CONTEXT.md + this RESEARCH.md; multi-tier publish (parent + 3 siblings + skill package); explicit allow-list of permitted Bash patterns in SKILL.md frontmatter |
| V2 Authentication | yes | `NODE_AUTH_TOKEN` for npm publish auth via GH Actions Secrets; rotated annually outside Phase 19 scope; never logged |
| V3 Session Management | no | Phase 19 introduces no new session surface |
| V4 Access Control | yes | SKILL.md `allowed-tools` narrowed from broad `Bash` to 8 specific patterns (D-04); npm publish access scoped via `--access public` flag + npm token's published-pkgs-only scope |
| V5 Input Validation | yes | SKILL.md frontmatter parsed by Claude Code (no Phase 19 code parses user input); CLI input validation lives in commander schema (Phase 18 wired it) |
| V6 Cryptography | yes | SHA-256 source-of-truth check uses Node stdlib `crypto.createHash("sha256")` (HIGH-trust); structured logger redaction patterns include JWT and Bearer token shapes (Phase 17 already covered) |
| V7 Error Handling + Logging | yes | ERR-08 unconditional structured logger to `~/.achilles/achilles.log` with 7-regex secret redaction + 10MB rotation + 0o600 perms (Phase 17 implementation); ERR-01 banner does NOT log error messages to disk separately (the structured logger captures them) |
| V8 Data Protection | yes | Tarball secret-scan at publish time catches API keys / tokens leaked into the tarball (the 7 patterns from `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs`); pre-publish gate via `prepublishOnly` hook |
| V9 Communication | yes | Outbound network from achilles is ElevenLabs-only (LOOP-02 + Phase 18 SAFE-03 carryover); CI publish workflow goes to npm registry (HTTPS-only); no other network egress |
| V10 Configuration | yes | `package.json` `publishConfig: { access: "public" }` explicit on all 5 packages; `private: false` flip on achilles-skill |
| V11 Business Logic | partial | The publish-then-cut ordering is a business-logic invariant (D-08/09); the reachability check before commit B is a business-logic guard |
| V12 Files & Resources | yes | Tarball secret-scan walks every scannable file (10 extensions: .md, .txt, .js, .mjs, .cjs, .json, .html, .css, .ts, .tsx); SHA-256 source-of-truth check uses absolute paths derived from `path.resolve` (no string concatenation) |
| V13 API | partial | Skill manifest IS an API contract for Claude Code; the rewrite is a breaking change for skill consumers (the old `achilles launch` -> the new `achilles voice` swap) |
| V14 Errors | yes | Banner classification + suggestedAction surface; never log raw error details to disk without redaction; logger fan-out preserves scope through `child(scope)` |

### Known Threat Patterns for {Bun-compiled binary + npm publish + Claude Code skill manifest}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised npm publish token leaks all 5 packages | Spoofing + Tampering | GH Actions Secret with repo-scoped access; rotate annually; --provenance flag enables Sigstore attestation (provenance metadata published with each tarball) |
| Skill body Bash pattern allows unintended commands (e.g., overly broad `Bash(achilles *)` matching `achilles voice; rm -rf /`) | Elevation of Privilege | Pattern 8 — narrow to exact subcommand prefixes: `Bash(achilles voice *)` matches `achilles voice --resume <sid>` but NOT `achilles voice; rm -rf /` because the `*` glob is whitespace-bounded per Claude Code's allowed-tools semantics |
| Tarball-embedded secret (ElevenLabs API key, Anthropic key, GitHub PAT) | Information Disclosure | Tarball secret-scan with 7 patterns; runs as `prepublishOnly` hook on the parent + paired with CI verification |
| companion.md drift between source and embedded copy | Tampering | SHA-256 source-of-truth check (Phase 17 ported) runs as `prepublishOnly` + CI gate |
| Binary execution on user machine without code-sign verification | Spoofing | macOS Option 3 path: no compiled darwin binary (no Gatekeeper surface); linux/win paths: users trust npm registry checksum (npm verifies tarball SHA-512 against the registry record) |
| Skill manifest update mid-conversation (Claude Code skill discovery semantics) | Tampering | Documented in SKILL.md body: "Please restart Claude Code to discover the /achilles skill" — applies after `achilles install-skill --force` |
| Detached spawn with `stdio: "ignore"` hiding launch failures (v1.2 silent-launch shape) | Repudiation + Information Disclosure | ESLint `no-restricted-syntax` rule forbids the pattern on the launch path (GATE-04 lint half); CI fails build if rule violated |
| stdout buffer flush race on Bun exit (Phase 15 Pitfall 5 carryover) | Information Disclosure | Phase 15 already wired `process.stdout.write(..., () => process.exit(0))` callback form in cli.ts; Phase 19 inherits this — does not regress |

## Sources

### Primary (HIGH confidence)

- `apps/achilles-cli/scripts/check-source-of-truth.mjs` (this monorepo, lines 1-287) — v1.2 SHA-256 check canonical implementation
- `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` (this monorepo, lines 1-306) — v1.2 tarball secret-scan canonical implementation with 7 regex patterns
- `apps/achilles-terminal/scripts/check-source-of-truth.mjs` (this monorepo, lines 1-132) — Phase 17 single-arm port
- `apps/achilles-terminal/scripts/build-binaries.mjs` (this monorepo) — Phase 15 cross-compile harness with the 3 surviving + 2 darwin targets
- `apps/achilles-terminal/scripts/build-node-bundle.mjs` (this monorepo) — Phase 15 esbuild JS-fallback producer
- `apps/achilles-terminal/src/structured-logger.ts` (this monorepo, lines 1-415) — Phase 17 unconditional logger writer with `DEFAULT_REDACT_PATTERNS` 7-regex set
- `apps/achilles-terminal/src/child-exit-watchdog.ts` (this monorepo, lines 1-260) — Phase 17 sox/ffplay bounded-respawn watchdog with `AUDIO_DEVICE_LOST_MESSAGE` and 3-in-10s sliding window
- `apps/achilles-terminal/src/cli.ts` (this monorepo, lines 1-215) — Phase 18 cli.ts with 5 subcommand dynamic-import gates (INIT-07 preserved)
- `apps/achilles-terminal/src/ui/VoiceShell.tsx` (this monorepo, lines 1-143) — Phase 16 root component composition
- `apps/achilles-terminal/src/ui/ScreenReader.tsx` (this monorepo, lines 1-62) — Phase 16 aria-role pattern (D-16-03-02 deviation noting Ink 7 supports "timer" not "status")
- `apps/achilles-terminal/eslint.config.js` (this monorepo, lines 1-55) — Phase 15 ESLint config with the prepared GATE-04 slot at lines 27-41
- `apps/achilles-terminal/src/shim/cli.shim.js` (this monorepo) — Phase 15 30-line bin shim with `existsSync` fallback
- `apps/achilles-cli/src/commands/install-skill.ts` (this monorepo, lines 1-221) — v1.2 install-skill action canonical implementation
- `apps/achilles-cli/src/skill-symlink.ts` (this monorepo, exports `installSkillSymlink`, `ExistingDestinationConflictError`, `SymlinkNotPermittedError`) — v1.2 symlink primitive
- `apps/achilles-cli/package.json` (this monorepo, lines 1-43) — v1.2 prepublishOnly hook pattern with the 2-script chain
- `packages/achilles-skill/skill/SKILL.md` (this monorepo, lines 1-49) — v1.2 SKILL.md with broad `allowed-tools: Bash` (rewrite target)
- `packages/achilles-skill/package.json` (this monorepo) — currently `private: true`, version `0.1.0` (Phase 19 flips both)
- `.github/workflows/achilles-terminal-ci.yml` (this monorepo, lines 1-308) — Phase 15 CI matrix with the dual-runtime test + compile-binaries pattern (the release workflow extends this)
- `.planning/phases/19-distribution-publishing-skill-rewire/19-CONTEXT.md` — 11 locked decisions D-01 through D-11
- `.planning/REQUIREMENTS.md` — DIST-03, DIST-04, DIST-06, ERR-01, ERR-03, ERR-08 acceptance criteria
- `.planning/research/v1.3-terminal-pivot.md` §10.2 Option 3 lock + §8.2 bin shim + §11 Phase 19 historical scoping

### Secondary (MEDIUM confidence)

- Claude Code skill docs — https://code.claude.com/docs/en/skills (verified via direct read of v1.2 SKILL.md frontmatter shape)
- npm publish policy — `npm deprecate` vs `npm unpublish` semantics [CITED: docs.npmjs.com/policies/unpublish]
- `optionalDependencies` skip-on-platform-miss behavior — Phase 15 + 16 + 17 all relied on this in the bin shim's `existsSync(binPath)` fallback; verified via the test surface
- esbuild/swc/biome precedent for platform-binary publish pattern — referenced in Phase 15 RESEARCH.md
- GitHub Actions `id-token: write` + `--provenance` flag for Sigstore attestation — standard practice as of 2026
- `BASH_MAX_TIMEOUT_MS` env var honored by Claude Code Bash tool — current behavior; future Claude Code releases may surface per-skill timeout overrides

### Tertiary (LOW confidence)

- `JS-DevTools/npm-publish@v3` adoption rate in 2026 — alternative to raw `npm publish`; both work; operator preference [ASSUMED]
- npm registry CDN cache propagation window — typically 15-45s; we use 30s as a reasonable middle ground [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency was vetted and installed in Phases 15-18; Phase 19 installs zero new runtime deps
- Architecture: HIGH — all 11 decisions in CONTEXT.md are locked; this research documents mechanics, not alternatives
- Pitfalls: HIGH — every pitfall is grounded in a concrete file in this monorepo or a documented npm/Claude Code behavior

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (stable distribution stack; refresh if Bun 1.4 ships or Claude Code skill manifest schema changes)
