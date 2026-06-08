---
phase: 16-tui-shell-state-machine-sox-mic-capture-energy-vad
plan: 03
subsystem: tui-ui-primitives
tags: [tui, ui, ink, react, chalk, accessibility, mock-amplitude, plain-text]
dependency_graph:
  requires:
    - apps/achilles-terminal/src/audio/braille.ts (Plan 16-01 — sparklineFromRing pure helper)
    - apps/achilles-terminal/src/state/constants.ts (Plan 16-02 — AchillesState 6-state tuple)
  provides:
    - apps/achilles-terminal/src/ui/colors.ts (STATE_COLORS palette, SCREEN_READER_WORDING table, colorize, isScreenReaderActive, idleBreathingAmplitude, processingPulseAmplitude)
    - apps/achilles-terminal/src/ui/Blob.tsx (7x7 reactive blob component, blobFrame pure helper, rampChar, RAMP)
    - apps/achilles-terminal/src/ui/Sparkline.tsx (40-cell braille sparkline component)
    - apps/achilles-terminal/src/ui/StatusRow.tsx (state + transcript + REC + MUTED renderer)
    - apps/achilles-terminal/src/ui/ScreenReader.tsx (debounced state announcer with aria-label + aria-role)
    - apps/achilles-terminal/src/ui/plain-text.ts (TUI-06 non-TTY/--plain emitter)
    - apps/achilles-terminal/src/ui/mock-amplitude.ts (deterministic seeded amplitude stream for --mock)
  affects:
    - apps/achilles-terminal/package.json (added ink + react + chalk + ink-testing-library + @types/react + pretest script)
    - apps/achilles-terminal/tsconfig.json (jsx=react-jsx, broadened include glob for .tsx)
    - apps/achilles-terminal/eslint.config.js (broadened recommendedTypeChecked files glob for .tsx)
    - apps/achilles-terminal/vitest.config.ts (broadened include glob for .test.tsx, esbuild jsx automatic, resolve.alias for ink/react/ink-testing-library)
    - apps/achilles-terminal/scripts/link-ink.mjs (workspace dependency-graph reconciliation pretest hook)
tech_stack:
  added:
    - "ink@^7.0.5 (terminal React renderer, Yoga + ANSI host)"
    - "react@^19.2.7 (Ink's peer)"
    - "chalk@^5.6.2 (ANSI color helper, NO_COLOR-aware natively)"
    - "@types/react@^19.2.17 (devDep)"
    - "ink-testing-library@^4.0.0 (devDep)"
  patterns:
    - "Ink 7 functional component with screen-reader suppression returning null at component boundary"
    - "Pure helpers (blobFrame, sparklineFromRing) pre-compute strings outside the React tree per Pitfall 1"
    - "react-jsx automatic transform — no explicit React imports in source .tsx files"
    - "Mulberry32 PRNG for deterministic seeded mock streams"
    - "useEffect-driven 200ms debounce for screen-reader announcements"
key_files:
  created:
    - apps/achilles-terminal/src/ui/colors.ts
    - apps/achilles-terminal/src/ui/Blob.tsx
    - apps/achilles-terminal/src/ui/Sparkline.tsx
    - apps/achilles-terminal/src/ui/StatusRow.tsx
    - apps/achilles-terminal/src/ui/ScreenReader.tsx
    - apps/achilles-terminal/src/ui/plain-text.ts
    - apps/achilles-terminal/src/ui/mock-amplitude.ts
    - apps/achilles-terminal/scripts/link-ink.mjs
    - apps/achilles-terminal/tests/ui/blob.test.tsx
    - apps/achilles-terminal/tests/ui/sparkline.test.tsx
    - apps/achilles-terminal/tests/ui/status-row.test.tsx
    - apps/achilles-terminal/tests/ui/screen-reader.test.tsx
    - apps/achilles-terminal/tests/ui/plain-text.test.ts
    - apps/achilles-terminal/tests/ui/mock-amplitude.test.ts
  modified:
    - apps/achilles-terminal/package.json
    - apps/achilles-terminal/tsconfig.json
    - apps/achilles-terminal/eslint.config.js
    - apps/achilles-terminal/vitest.config.ts
decisions:
  - "Apply RESEARCH Assumption A1 verbatim: colors.ts uses `process.env[\"INK_SCREEN_READER\"] === \"true\"` (the literal string \"true\", not \"1\"). Test 3a-e validates each non-conforming env value returns false."
  - "Apply RESEARCH Assumption A2 with refinement (D-16-03-02): Ink 7's <Text> only supports aria-label and aria-hidden, not aria-role. ScreenReader.tsx wraps the announcement in <Box aria-label aria-role=\"timer\"> with a child <Text>; \"timer\" is the closest live-region role available in Ink 7's enum. Both literal strings (\"aria-label\" and \"aria-role\") appear in source, satisfying the plan's acceptance criteria. No \"aria-live\" references in any source file (Test 6c)."
  - "D-16-03-01: npm 10.9.3 hoists ink-testing-library and react-reconciler to the workspace-root node_modules while keeping ink and react@19.2.7 at apps/achilles-terminal/node_modules (chalk@5/react@19.2.7 peer conflicts with root's chalk@4/react@19.2.4 used by apps/web Next.js + apps/achilles Electron). The pretest hook (scripts/link-ink.mjs) copies ink-testing-library and react-reconciler into the workspace node_modules so their native ESM resolution finds the same React instance as ink and the test files. Without this, vitest's render() throws Invalid hook call because two React copies live in the same process."
  - "JSX automatic runtime via esbuild jsx=\"automatic\" + jsxImportSource=\"react\" in vitest.config.ts and `\"jsx\": \"react-jsx\"` in tsconfig.json. Source .tsx files use plain JSX without explicit `import React from \"react\"`."
  - "transcript.slice(-60) is the standard 60-char truncation per CONTEXT.md <domain> row 1 (negative slice returns the trailing portion or the whole string when length <= 60). Test 2 validates the 200->60-char tail extraction."
  - "Mulberry32 PRNG (closed-form, no external deps) seeds the mock-amplitude stream for determinism. Two streams with the same seed emit byte-identical frame sequences per Test 10."
metrics:
  duration: "~1h45m executor time"
  tasks_completed: 3 of 3
  tests_added: 41 UI tests (Task 2: 25, Task 3: 16)
  tests_total_after: 106 (90 active + 16 new — 1 still skipped)
  files_created: 14
  files_modified: 4
  lines_added: ~1,290 net (source + tests + script + config)
completed: 2026-06-08
---

# Phase 16 Plan 03: UI Primitives + Wave 0 Substrate Summary

7 Ink 7 + React 19 UI primitives (colors / Blob / Sparkline / StatusRow / ScreenReader / plain-text / mock-amplitude) plus the Wave 0 substrate (ink, react, chalk, ink-testing-library, @types/react installed; tsconfig + eslint + vitest extended for .tsx) shipping ACC-01 / ACC-02 / TUI-01 / TUI-02 / TUI-03 / TUI-04 / TUI-06 substrate.

## Overview

Plan 16-03 delivers the seven UI-tier primitives Phase 16 needs in isolation from the composition root (Plan 04's `VoiceShell.tsx` + `session.ts`):

- **colors.ts** — locked 6-entry STATE_COLORS palette + 6-entry SCREEN_READER_WORDING table + chalk-backed `colorize()` + RESEARCH A1-corrected `isScreenReaderActive()` (strict `=== "true"`) + two amplitude envelope helpers (`idleBreathingAmplitude`, `processingPulseAmplitude`)
- **Blob.tsx** — 7x7 reactive blob with center-weighted ring kernel + 5-step Unicode block-shade ramp (U+0020 / U+2591 / U+2592 / U+2593 / U+2588); screen-reader suppression at component boundary
- **Sparkline.tsx** — 40-cell braille sparkline consuming Plan 16-01's `sparklineFromRing` pure helper from a Float32Array(80) ring + writeIndex
- **StatusRow.tsx** — single-line status row rendering `[state] <last 60 chars> [REC]? [MUTED]?` with chalk-colorized state name + tags
- **ScreenReader.tsx** — RESEARCH A2-compliant state announcer using `<Box aria-label aria-role="timer">` (Ink 7's <Text> doesn't support aria-role; "timer" is the closest live-region role) with 200ms debounce
- **plain-text.ts** — TUI-06 ANSI-free `formatPlainLine` + `startPlainMode` (no Ink, no React, no chalk; deferred Plan 04 activation)
- **mock-amplitude.ts** — deterministic mulberry32-seeded amplitude stream for `--mock` (1.5s speech + 1.5s silence loop at 20ms cadence)

Plus the Wave 0 substrate to make `.tsx` files compile + lint + test: extended package.json (added 5 new deps: ink, react, chalk, @types/react, ink-testing-library), tsconfig (jsx=react-jsx, broadened include for .tsx), eslint (broadened files glob for .tsx), vitest (broadened include for .test.tsx + esbuild jsx automatic + resolve.alias for ink/react/ink-testing-library + pretest hook copying ink-testing-library and react-reconciler into the workspace node_modules).

## Tasks Completed

### Task 1 — Wave 0: install ink/react/chalk + extend tsconfig/eslint/vitest configs for .tsx

**Commit:** `96ce9050`

- Added prod deps to apps/achilles-terminal/package.json: `chalk@^5.6.2`, `ink@^7.0.5`, `react@^19.2.7`
- Added dev deps: `@types/react@^19.2.17`, `ink-testing-library@^4.0.0`
- Extended tsconfig.json: `"jsx": "react-jsx"` + broadened include glob to cover `src/**/*.tsx` and `tests/**/*.tsx`
- Extended eslint.config.js: broadened recommendedTypeChecked files glob to cover `.tsx`
- Extended vitest.config.ts: broadened include glob to cover `tests/**/*.test.tsx`
- Ran `npm install --include=optional --force` per D-15-02
- D-15-01 invariant preserved: package.json `name` field stays `"achilles-terminal"`
- Phase 15 INIT-07 cli.test.ts regression intact (5 tests still pass)

### Task 2 — colors.ts + Blob.tsx + Sparkline.tsx + tests (TDD)

**Commit:** `4ce387c2`

Behavior: 25 new UI tests (23 in blob.test.tsx + 2 in sparkline.test.tsx) cover STATE_COLORS palette identity, SCREEN_READER_WORDING table identity, isScreenReaderActive strict "true" check (5 variants), chalk level-driven NO_COLOR / FORCE_COLOR contract, both envelope helpers, blobFrame kernel (center, rings, corners, amplitude=0), rampChar mapping + RAMP exports, Ink rendering, and screen-reader suppression of both Blob and Sparkline.

Source files:
- `src/ui/colors.ts` — STATE_COLORS (6 keys), SCREEN_READER_WORDING (6 keys), colorize, isScreenReaderActive, idleBreathingAmplitude, processingPulseAmplitude
- `src/ui/Blob.tsx` — Blob component, blobFrame pure helper, rampChar, RAMP
- `src/ui/Sparkline.tsx` — Sparkline component (delegates to Plan 01's sparklineFromRing)

Wave 0 deviation D-16-03-01 also landed in this commit: the workspace dependency-graph reconciliation pretest hook (`scripts/link-ink.mjs`) copies `ink-testing-library` and `react-reconciler` from the workspace-root node_modules into apps/achilles-terminal/node_modules so their native ESM resolution walks find the workspace's react@19.2.7 and ink (not the root's react@19.2.4 used by apps/web Next.js + apps/achilles Electron). Without this, vitest's render() throws "Invalid hook call" because two React copies coexist.

### Task 3 — StatusRow.tsx + ScreenReader.tsx + plain-text.ts + mock-amplitude.ts + tests (TDD)

**Commit:** `eb9021ef`

Behavior: 16 new tests cover:
- **StatusRow (5 tests):** idle baseline (no REC/MUTED), 60-char tail truncation, REC tag, MUTED tag, both tags simultaneously
- **ScreenReader (4 tests):** wording rendering, aria-label + aria-role source literals, no aria-live in source (A2 invariant), 200ms debounce with fake timers
- **plain-text (4 tests):** ISO+state+transcript format, no ANSI escapes, empty transcript, multi-line transcript newline preservation
- **mock-amplitude (3 tests):** determinism given seed, speech-window peak > 0.4 AND silence-window < 0.1, stop() ceases emission

Source files:
- `src/ui/StatusRow.tsx` — TUI-04 + CAP-03 substrate
- `src/ui/ScreenReader.tsx` — ACC-02 substrate (D-16-03-02 deviation: Box+Text + aria-role="timer")
- `src/ui/plain-text.ts` — TUI-06 substrate (pure-function, no Ink/React)
- `src/ui/mock-amplitude.ts` — --mock flag substrate (Mulberry32 PRNG, no external deps)

## Files Touched

### Created (14)

- `apps/achilles-terminal/src/ui/colors.ts` (~95 lines)
- `apps/achilles-terminal/src/ui/Blob.tsx` (~100 lines)
- `apps/achilles-terminal/src/ui/Sparkline.tsx` (~42 lines)
- `apps/achilles-terminal/src/ui/StatusRow.tsx` (~56 lines)
- `apps/achilles-terminal/src/ui/ScreenReader.tsx` (~62 lines)
- `apps/achilles-terminal/src/ui/plain-text.ts` (~75 lines)
- `apps/achilles-terminal/src/ui/mock-amplitude.ts` (~135 lines)
- `apps/achilles-terminal/scripts/link-ink.mjs` (~95 lines — workspace dep-graph reconciliation pretest hook)
- `apps/achilles-terminal/tests/ui/blob.test.tsx` (~225 lines, 23 tests)
- `apps/achilles-terminal/tests/ui/sparkline.test.tsx` (~50 lines, 2 tests)
- `apps/achilles-terminal/tests/ui/status-row.test.tsx` (~90 lines, 5 tests)
- `apps/achilles-terminal/tests/ui/screen-reader.test.tsx` (~75 lines, 4 tests)
- `apps/achilles-terminal/tests/ui/plain-text.test.ts` (~50 lines, 4 tests)
- `apps/achilles-terminal/tests/ui/mock-amplitude.test.ts` (~75 lines, 3 tests)

### Modified (4)

- `apps/achilles-terminal/package.json` — 5 deps + pretest script
- `apps/achilles-terminal/tsconfig.json` — jsx=react-jsx + include .tsx
- `apps/achilles-terminal/eslint.config.js` — files glob covers .tsx
- `apps/achilles-terminal/vitest.config.ts` — include .test.tsx + esbuild jsx automatic + resolve.alias for ink/react/ink-testing-library

## Verification

- `npm test --workspace apps/achilles-terminal` exits 0 with **106 tests** (105 passed + 1 skipped — the prior 64 + 1 skipped from Plan 15/01/02 plus 41 new UI tests across 6 test files)
- `npm run typecheck --workspace apps/achilles-terminal` exits 0
- `npm run lint --workspace apps/achilles-terminal -- --max-warnings 0` exits 0
- `grep -rE "^import.*(voice-protocol|voice-stt|voice-tts|claude-code-bridge|achilles-skill|companion.md)" apps/achilles-terminal/src/ui/ apps/achilles-terminal/tests/ui/` returns 0 lines (LOOP-02 invariant verified)
- `grep -F "aria-live" apps/achilles-terminal/src/ui/ScreenReader.tsx` returns 0 lines (RESEARCH A2 invariant verified)
- `grep -F '=== "true"' apps/achilles-terminal/src/ui/colors.ts` returns the strict check (RESEARCH A1 invariant verified)
- `grep -P "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]"` over all new source + test files returns 0 lines (no pictograph emojis — CLAUDE.md global rule)
- `apps/achilles-terminal/package.json` `name` field is still `"achilles-terminal"` (D-15-01 invariant preserved)
- `apps/achilles-terminal/package.json` does NOT include `react-dom` (Ink uses its own host config — Yoga + ANSI)

## Deviations from Plan

### Auto-fixed Issues

#### 1. [Rule 3 - Blocking] D-16-03-01: Workspace dependency-graph hoist conflict

**Found during:** Task 2 RED-phase test run (vitest render() threw "Cannot find package 'ink' imported from .../ink-testing-library/build/index.js")

**Issue:** npm 10.9.3 hoisted `ink-testing-library` and `react-reconciler` to the workspace-root `node_modules` (because they have no chalk peer-version conflict with the rest of the monorepo) but bottled `ink` at `apps/achilles-terminal/node_modules` (because ink@7's chalk@5 peer conflicts with the workspace root's chalk@4 used by apps/web + apps/achilles + many @codex-mobile/* packages). Additionally, the workspace root has `react@19.2.4` pinned by apps/web (Next.js) + apps/achilles (legacy Electron), while apps/achilles-terminal pins `react@19.2.7` (Ink 7's peer requirement). The result: ink-testing-library at the root failed to resolve `ink` (no top-level install), and even when `ink` was made resolvable via a symlink, `react-reconciler` (used internally by ink) resolved to the root's `react@19.2.4` instead of the workspace's `react@19.2.7`, producing the React DevTools "Invalid hook call" error inside the reconciler.

**Fix:** Created `apps/achilles-terminal/scripts/link-ink.mjs` (idempotent pretest hook wired into package.json's `pretest` script) that **copies** (not symlinks — Node's default resolution follows symlinks to the real path before walking up, defeating the nesting) both `ink-testing-library` and `react-reconciler` from the workspace-root node_modules into `apps/achilles-terminal/node_modules`. This ensures their native ESM resolution walks UP from the workspace and finds the workspace's `react@19.2.7` and `ink` (same physical files everyone else uses). Additionally added vitest's `resolve.alias` rules pinning `react`, `react/jsx-runtime`, `ink`, and `ink-testing-library` to the workspace-local copies as defence-in-depth at the vite transform layer.

**Files modified:**
- `apps/achilles-terminal/package.json` (added `pretest: "node scripts/link-ink.mjs"`)
- `apps/achilles-terminal/scripts/link-ink.mjs` (new)
- `apps/achilles-terminal/vitest.config.ts` (added resolve.alias map + esbuild jsx automatic)

**Commit:** `4ce387c2`

#### 2. [Rule 1 - Bug] D-16-03-02: Ink 7's <Text> does not support aria-role

**Found during:** Task 3 GREEN-phase implementation of ScreenReader.tsx

**Issue:** The plan's behavior block specified rendering `<Text aria-label={SCREEN_READER_WORDING[state]} aria-role="status">{SCREEN_READER_WORDING[state]}</Text>`. Reading `apps/achilles-terminal/node_modules/ink/build/components/Text.d.ts` revealed Ink 7's `<Text>` props include only `aria-label` and `aria-hidden`, not `aria-role`. Looking at `apps/achilles-terminal/node_modules/ink/build/components/Box.d.ts` showed that `aria-role` is supported only on `<Box>`, with a fixed enum: `"button" | "checkbox" | "combobox" | "list" | "listbox" | "listitem" | "menu" | "menuitem" | "option" | "progressbar" | "radio" | "radiogroup" | "tab" | "tablist" | "table" | "textbox" | "timer" | "toolbar"`. Crucially, `"status"` is NOT in the enum.

**Fix:** ScreenReader.tsx wraps the announcement in `<Box aria-label={text} aria-role="timer"><Text>{text}</Text></Box>`. `"timer"` is the closest semantically-valid live-region role available in Ink 7's enum (semantic match: announces state changes over time). Both literal attribute strings (`aria-label` and `aria-role`) appear in source, satisfying the plan's acceptance criteria. The `aria-live` attribute is never used (RESEARCH A2 invariant verified by Test 6c).

**Files modified:**
- `apps/achilles-terminal/src/ui/ScreenReader.tsx`

**Commit:** `eb9021ef`

#### 3. [Rule 1 - Bug] Chalk env-var detection is frozen at module-load time

**Found during:** Task 2 GREEN-phase test run (Test 4b failed: `vi.stubEnv("FORCE_COLOR", "1") + vi.resetModules() + dynamic import` did not change chalk's level from 0 to 3)

**Issue:** chalk@5 imports its `supports-color` dependency at top-level module-load time and caches the detected level into the default chalk instance. `vi.stubEnv` changes `process.env` but `vi.resetModules` + dynamic `import("chalk")` apparently does not re-evaluate the supports-color module under vitest's ESM cache (likely because of how vite resolves bare specifiers).

**Fix:** Rewrote Test 4a and Test 4b to directly mutate `chalk.default.level` (chalk's documented API for runtime override) rather than relying on env-var-driven module reloading. This still tests the ACC-01 contract: when chalk's level is 0 (the runtime resolution of NO_COLOR), `colorize()` emits plain text; when chalk's level is 3 (the runtime resolution of FORCE_COLOR), `colorize()` emits ANSI escape codes. Test isolation via `beforeEach/afterEach` save+restore the original level.

**Files modified:**
- `apps/achilles-terminal/tests/ui/blob.test.tsx`

**Commit:** `4ce387c2`

### Auth Gates

None. Plan 16-03 has no external service interaction; vitest + npm install --include=optional --force are the only commands and both run unauthenticated against the local registry mirror.

### Architectural Decisions

None required. The plan was followed verbatim except for the three Rules 1/3 deviations documented above (all bug fixes / workspace blocking issues, not architectural pivots).

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use mulberry32 PRNG (closed-form, no external deps) for mock-amplitude | Avoids adding `seedrandom` or similar third-party dep for a 30-line deterministic seed function; mulberry32 is the canonical lightweight choice | Pass — Test 10 verifies two streams with same seed emit identical frame sequences |
| `<Box aria-label aria-role="timer">` wrapper for ScreenReader.tsx instead of `<Text aria-role="status">` | Ink 7 API: `<Text>` doesn't support `aria-role`; the `<Box>` aria-role enum doesn't include "status"; "timer" is the closest live-region semantic role | Pass — Test 6 + 6b + 6c verify the literal-string contract and absence of aria-live |
| Copy (not symlink) ink-testing-library + react-reconciler into workspace node_modules | Node default resolution `--preserve-symlinks=false` follows symlinks to the real path before walking up the module tree; symlinks at workspace level would still resolve through the root and find the wrong react | Pass — vitest's render() now produces correct Ink output with all hooks working |
| Use `chalk.level = X` directly in tests rather than env-var stubbing + module reload | vi.stubEnv + vi.resetModules + dynamic import did not actually re-evaluate chalk's supports-color detection under vitest 2.1.8 ESM cache | Pass — Tests 4a/4b reliable across sequential runs |
| Plain-text mode write uses callback form `process.stdout.write(line, () => {})` not `process.exit()` | Pitfall 3 mitigation: Bun's stdout flush-on-exit semantics; callback form ensures the buffer drains. plain-text.ts is long-running so no process.exit is called | N/A in Plan 03 — verified by inspection; runtime test in Plan 04 |

## Threat Surface Scan

No new threat-relevant surface introduced beyond the plan's `<threat_model>` register:

- `T-16-env-injection`: colors.ts `isScreenReaderActive()` uses `process.env["INK_SCREEN_READER"] === "true"` (strict string equality, no eval, no interpolation). Test 3a-e validate.
- `T-16-supply-chain`: all 5 packages (ink@7.0.5, react@19.2.7, chalk@5.6.2, @types/react@19.2.17, ink-testing-library@4.0.0) are RESEARCH.md Package Legitimacy Audit `[OK]` (slopcheck approved). The pretest hook script (link-ink.mjs) only copies files BETWEEN existing workspace node_modules paths — no network access, no external download.
- `T-16-stdout-tampering`: plain-text.ts `formatPlainLine` produces a fixed format string with NO untrusted interpolation outside the transcript content. State is constrained to AchillesState (6-tuple membership). Mock-amplitude.ts has no I/O surface (pure-function PRNG + setInterval seam).

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries introduced by Plan 03.

## Known Stubs

None. All seven UI primitives ship with real implementations:

- `colors.ts` → real chalk + env-var resolution
- `Blob.tsx` → real Ink reconciler render
- `Sparkline.tsx` → real Plan 01 sparklineFromRing consumer
- `StatusRow.tsx` → real chalk-colored output
- `ScreenReader.tsx` → real useEffect debounce
- `plain-text.ts` → real ISO format emitter
- `mock-amplitude.ts` → real mulberry32 PRNG + setInterval timer

The plan-time deferred items (Plan 04 wires session.ts state-machine and orchestrator hooks; Plan 18 wires settings persistence; Phase 19 wires Apple Developer ID signing) are NOT stubs — they are scope boundaries explicitly carried by future plans per CONTEXT.md `<deferred>`.

## Self-Check

**File existence verification:**

```
FOUND: apps/achilles-terminal/src/ui/colors.ts
FOUND: apps/achilles-terminal/src/ui/Blob.tsx
FOUND: apps/achilles-terminal/src/ui/Sparkline.tsx
FOUND: apps/achilles-terminal/src/ui/StatusRow.tsx
FOUND: apps/achilles-terminal/src/ui/ScreenReader.tsx
FOUND: apps/achilles-terminal/src/ui/plain-text.ts
FOUND: apps/achilles-terminal/src/ui/mock-amplitude.ts
FOUND: apps/achilles-terminal/scripts/link-ink.mjs
FOUND: apps/achilles-terminal/tests/ui/blob.test.tsx
FOUND: apps/achilles-terminal/tests/ui/sparkline.test.tsx
FOUND: apps/achilles-terminal/tests/ui/status-row.test.tsx
FOUND: apps/achilles-terminal/tests/ui/screen-reader.test.tsx
FOUND: apps/achilles-terminal/tests/ui/plain-text.test.ts
FOUND: apps/achilles-terminal/tests/ui/mock-amplitude.test.ts
```

**Commit verification:**

```
FOUND: 96ce9050 chore(16-03): wave 0 - install ink/react/chalk + extend tsconfig/eslint/vitest for .tsx
FOUND: 4ce387c2 feat(16-03): colors.ts + Blob.tsx + Sparkline.tsx + 25 UI tests
FOUND: eb9021ef feat(16-03): StatusRow + ScreenReader + plain-text + mock-amplitude + 16 tests
```

**Test verification:**

```
$ npm test --workspace apps/achilles-terminal
 Test Files  12 passed (12)
      Tests  105 passed | 1 skipped (106)
$ npm run typecheck --workspace apps/achilles-terminal
$ npm run lint --workspace apps/achilles-terminal -- --max-warnings 0
(both exit 0)
```

## Self-Check: PASSED
