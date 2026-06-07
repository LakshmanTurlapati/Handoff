---
phase: 11-floating-ui-shell
plan: 01
subsystem: ui
tags: [electron, react, electron-vite, electron-store, zod, vitest, playwright, ipc, state-machine, hotkey, safeStorage]

# Dependency graph
requires:
  - phase: 09-voice-vendor-wrappers
    provides: "@achilles/voice-protocol — Zod-validated IPC types and SAFE-01 strict-mode boundary precedent"
provides:
  - "apps/achilles workspace package — Electron app shell (private, not published)"
  - "Locked BrowserWindow contract (UI-01) via createAchillesWindow factory"
  - "Pure transition(state, event, mode) reducer + createMockStateController runtime wrapper"
  - "Zod-validated IPC envelope schemas (IPC_PAYLOAD_SCHEMAS + parseEnvelope)"
  - "electron-store wrapper with safeStorage encryption + SAFE-01 plaintext fallback"
  - "Global hotkey registration (UI-06) honouring both toggle and PTT modes"
  - "Deterministic mock amplitude stream (mic + TTS distinct sequences)"
  - "Preload contextBridge surface exposing window.achilles typed API"
  - "MockAchillesBridge test seam exposing window.__mockBridge"
  - "Minimal renderer bootstrap consuming the bridge wrapper"
  - "Workspace plumbing: tsconfig aliases, vitest phase-11-unit project, playwright achilles-renderer project"
affects:
  - 11-02-PLAN.md (composes against the BrowserWindow + state machine + bridge surface)
  - 11-03-PLAN.md (composes against the store + hotkey + permission IPC channels)
  - 12-end-to-end-integration (replaces mock state controller + mock amplitude with real voice loop)

# Tech tracking
tech-stack:
  added:
    - electron@42.3.3
    - electron-vite@3.1.0
    - electron-store@10.1.0
    - react@19.2.4 + react-dom@19.2.4
    - "@vitejs/plugin-react@4.3.4"
    - vite@5.4.11
    - "@types/react@19.0.8 + @types/react-dom@19.0.3"
  patterns:
    - "Dependency-injected factories — createAchillesWindow / createAchillesStore / registerAchillesHotkey accept injection seams so unit tests verify the locked contracts without launching Electron"
    - "Pure reducer + runtime wrapper — transition() is side-effect-free; createMockStateController layers fixture timers + broadcast on top"
    - "Zod .strict() everywhere at the IPC boundary — mirrors packages/voice-protocol SAFE-01 precedent"
    - "Headless Vite preview as the Playwright target — NO Electron launch in CI per CLAUDE.md global"
    - "as const tuples in constants.ts as single membership source — state types + Zod enums derive from the same literal"

key-files:
  created:
    - apps/achilles/package.json
    - apps/achilles/tsconfig.json
    - apps/achilles/tsconfig.node.json
    - apps/achilles/tsconfig.web.json
    - apps/achilles/electron.vite.config.ts
    - apps/achilles/vite.headless.config.ts
    - apps/achilles/playwright.config.ts
    - apps/achilles/.gitignore
    - apps/achilles/src/.gitignore
    - apps/achilles/src/shared/constants.ts (+ constants.test.ts)
    - apps/achilles/src/shared/ipc-schemas.ts (+ ipc-schemas.test.ts)
    - apps/achilles/src/main/state-machine.ts (+ state-machine.test.ts)
    - apps/achilles/src/main/window.ts (+ window.test.ts)
    - apps/achilles/src/main/store.ts (+ store.test.ts)
    - apps/achilles/src/main/hotkey.ts (+ hotkey.test.ts)
    - apps/achilles/src/main/mock-amplitude.ts (+ mock-amplitude.test.ts)
    - apps/achilles/src/main/ipc-bridge.ts
    - apps/achilles/src/main/index.ts
    - apps/achilles/src/preload/index.ts
    - apps/achilles/src/preload/global.ts
    - apps/achilles/src/renderer/index.html
    - apps/achilles/src/renderer/main.tsx
    - apps/achilles/src/renderer/bridge.ts
    - apps/achilles/test/mocks/mock-bridge.ts
    - apps/achilles/test/mocks/index.html
    - apps/achilles/test/e2e/scaffold.spec.ts
  modified:
    - tsconfig.base.json (added 5 @achilles/app aliases)
    - vitest.workspace.ts (added 5 @achilles/app workspaceAlias entries + phase-11-unit project)
    - playwright.config.ts (added achilles-renderer project + webServer)
    - package.json (added test:phase-11:quick + test:phase-11:full scripts)

key-decisions:
  - "Renamed src/preload/global.d.ts → src/preload/global.ts to remove the CR-07 hygiene contradiction (the verification check requires zero .d.ts in src/ while the plan files list named a .d.ts; .ts with declare global preserves the type augmentation)"
  - "Added a dedicated apps/achilles/vite.headless.config.ts (plain vite, not electron-vite) for the Playwright preview target — cleaner than wrestling electron-vite's --mode flag and isolates the headless bundle's entry from the production bundle"
  - "Headless renderer entry is apps/achilles/test/mocks/index.html — pre-injects mock-bridge.ts via a sibling <script> tag so window.__mockBridge populates before main.tsx hydrates"
  - "The mocked AchillesState controller schedules deterministic transitions with locked durations: LISTENING_VAD_DELAY_MS=1200, PROCESSING_DELAY_MS=800, SPEAKING_DELAY_MS=2000, ERROR_AUTO_DISMISS_MS=8000 (UI-SPEC s8)"
  - "IPC channel constants all carry the 'achilles:' prefix (verified by both a constants test AND the plan's grep check) — a renderer-side grep for 'achilles:' reveals every boundary the renderer reaches into"
  - "safeStorage is consulted once at store construction; plaintext fallback logs the SAFE-01 boundary warning exactly once per process (not once per write) and tolerates Linux distros without keyring services"

patterns-established:
  - "Pattern: Dependency-injected Electron seams — every module that touches an Electron API accepts an injection seam (BrowserWindowCtor, storeCtor, globalShortcutRef, webContentsKeySource, safeStorage) so unit tests verify the contract without spinning up the runtime"
  - "Pattern: as const tuples as single membership source — ACHILLES_STATES drives both the AchillesState type alias AND z.enum(ACHILLES_STATES) in the schema, so adding a state is a single edit"
  - "Pattern: getBridge() adapter — the renderer never branches on bridge identity; bridge.ts returns a unified AchillesBridge surface backed by window.__mockBridge in headless tests or window.achilles in production"
  - "Pattern: IPC payload parseEnvelope at both boundaries — preload parses outbound (defence against compromised renderer) AND inbound (defence against bug in main); main parses inbound on every channel"

requirements-completed: [UI-01, UI-06]

# Metrics
duration: ~75min
completed: 2026-06-06
---

# Phase 11 Plan 01: apps/achilles scaffold — window + state machine + hotkey + electron-store + IPC schemas

**Wave-1 substrate for the Achilles floating UI shell — locked BrowserWindow contract (UI-01), pure state-machine reducer, Zod-validated IPC schemas, global hotkey honouring toggle + PTT (UI-06), electron-store with safeStorage fallback, preload contextBridge surface, MockAchillesBridge test seam, and complete workspace plumbing.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-06-06T19:43:00Z
- **Completed:** 2026-06-06T20:58:57Z
- **Tasks:** 2 (both auto-completed)
- **Files created:** 26 source / config / test files in apps/achilles + 4 root-level edits
- **Tests:** 89 unit (Vitest, phase-11-unit project) + 3 e2e (Playwright, achilles-renderer project) = 92 passing

## Accomplishments

- New `apps/achilles` workspace package built around electron-vite, React 19.2, and TypeScript 5.7. Private (not published) — npm CLI surface ships from `apps/achilles-cli` in Phase 13.
- **Locked BrowserWindow contract (UI-01)** asserted by 3 unit tests: 260×260, frame:false, transparent:true, backgroundColor:#00000000, alwaysOnTop:true, focusable:false, type:'panel' on darwin only, skipTaskbar:true, webPreferences { contextIsolation:true, nodeIntegration:false, sandbox:true }. Calls setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) + setAlwaysOnTop(true, 'screen-saver') + app.dock.hide() on darwin (PITFALLS.md #15 mitigations).
- **Pure state-machine reducer** in `state-machine.ts`: transition(current, event, mode) → next. 14 unit tests cover every documented transition (the 10 behaviour rows + 4 defensive cases) plus an exhaustiveness check that throws on unknown event tags.
- **Zod IPC schemas** with `.strict()` on every channel — 31 unit tests cover happy paths, rejected unknown fields (SAFE-01), out-of-range RMS values, non-integer window coordinates, the empty-update refine guard on update-hotkey-config, the unknown-channel + invalid-payload paths of parseEnvelope, and per-channel happy-path coverage for the 12 channels.
- **electron-store wrapper** persists windowPosition + hotkeyMode + hotkeyKey via safeStorage when available; logs `[achilles] safeStorage unavailable; persisting plaintext (SAFE-01 follow-up in Phase 12)` exactly once and falls back to plaintext otherwise. 11 unit tests cover defaults, round-trip, integer guard, encryption-state diagnostic, and the warn-once invariant.
- **Global hotkey substrate (UI-06)** registers toggle mode through `globalShortcut.register` and wires PTT key-up through an injected `WebContentsKeySource` (since Electron's `globalShortcut.register` only fires on key-down, per PITFALLS.md). 4 unit tests cover the toggle / PTT branches + setHotkeyMode persistence + unregister.
- **Deterministic mock amplitude stream** (`mock-amplitude.ts`): listening sequences and speaking sequences are provably distinct; idle/processing/error return constant 0; emit() ticks at 50 ms (UI-SPEC §1 RMS at 20 fps). 9 unit tests.
- **Preload contextBridge surface** in `src/preload/index.ts`: `contextBridge.exposeInMainWorld('achilles', api)` with subscribe/unsubscribe semantics on every Main→Renderer channel and validated send on every Renderer→Main channel. Both directions parse through the schema map (defence in depth).
- **MockAchillesBridge test seam** in `test/mocks/mock-bridge.ts` attaches `window.__mockBridge` with the full documented surface (setState, setPermission, emitPartialTranscript, emitCommittedTranscript, emitMicAmplitude, emitTtsAmplitude, emitError, __test_inject_error, getLastEmittedIPC).
- **Workspace plumbing:** tsconfig.base.json gains 5 @achilles/app path aliases; vitest.workspace.ts gains 5 workspaceAlias entries + phase-11-unit project; playwright.config.ts gains achilles-renderer project + webServer; root package.json gains test:phase-11:quick and test:phase-11:full scripts.

## Task Commits

Per the execution context's commit policy, this plan ships as a single atomic commit with the message:

> `feat(11-01): apps/achilles scaffold — window + state machine + hotkey + electron-store + IPC schemas`

(see the final-commit step below)

## Files Created/Modified

### Package + config (apps/achilles/)

- `package.json` — workspace package manifest (`@achilles/app`, private, electron 42.3.3 + electron-vite 3.1.0 + electron-store 10.1.0 + zod 4.3.6 + react 19.2.4)
- `tsconfig.json` — project references (node + web)
- `tsconfig.node.json` — main + preload + shared (NodeNext)
- `tsconfig.web.json` — renderer (ESNext, react-jsx, Bundler resolution)
- `electron.vite.config.ts` — main / preload / renderer build entries
- `vite.headless.config.ts` — plain vite for the headless renderer bundle Playwright drives
- `playwright.config.ts` — achilles-renderer project, viewport 260×260, webServer chains build + preview
- `.gitignore` — out, node_modules, .tsbuildinfo*, *.tsbuildinfo, dist, playwright-report, .cache, test-results
- `src/.gitignore` — Phase 09 CR-07 defensive guard against compiled output inside src/

### Source (apps/achilles/src/)

- `shared/constants.ts` — WINDOW_WIDTH/HEIGHT, DEFAULT_MARGIN_PX, DRAG_HANDLE_HEIGHT_PX, DEFAULT_HOTKEY_ACCELERATOR, 12 IPC channel constants, ACHILLES_STATES + HOTKEY_MODES + PERMISSION_STATES tuples, derived type aliases, locked timer durations, AMPLITUDE_TICK_MS
- `shared/ipc-schemas.ts` — 12 .strict() Zod schemas + AchillesStateSchema + IPC_PAYLOAD_SCHEMAS map + parseEnvelope helper + serializeForChannel helper
- `main/state-machine.ts` — transition() reducer + createMockStateController runtime wrapper with locked timer durations
- `main/window.ts` — createAchillesWindow factory with dependency-injected BrowserWindowCtor, appRef, platform, workArea, preloadPath
- `main/store.ts` — createAchillesStore with dependency-injected storeCtor + safeStorage + logger
- `main/hotkey.ts` — registerAchillesHotkey + setHotkeyMode + unregisterAchillesHotkey with WebContentsKeySource injection
- `main/mock-amplitude.ts` — createMockAmplitudeStream with LCG seed + next/reset/stop/emit lifecycle
- `main/ipc-bridge.ts` — wireIpcBridge handlers for all 5 Renderer→Main channels, broadcast hook for Main→Renderer
- `main/index.ts` — Electron main entry; bootstrap() lazy-imports electron + electron-store, wires store, window, controller, bridge, hotkey
- `preload/index.ts` — contextBridge.exposeInMainWorld('achilles', api) typed surface
- `preload/global.ts` — ambient declaration of window.achilles + window.__mockBridge
- `renderer/index.html` — minimal entry with `<div id="root" data-testid="floating-shell">`
- `renderer/main.tsx` — stub App component reflecting current AchillesState on the reactive-circle data-state attr
- `renderer/bridge.ts` — getBridge() returns window.__mockBridge in tests OR wraps window.achilles in production

### Tests (apps/achilles/{src,test}/)

- `src/shared/constants.test.ts` — 10 tests (window constants, IPC channels, tuples)
- `src/shared/ipc-schemas.test.ts` — 31 tests (per-schema happy + sad path + parseEnvelope routing + per-channel coverage)
- `src/main/state-machine.test.ts` — 14 tests (10 behaviour + 4 defensive)
- `src/main/window.test.ts` — 10 tests (W1/W2/W3 contract + platform branches + positioning)
- `src/main/store.test.ts` — 11 tests (ST1/ST2/ST3/ST4 + integer guard + warn-once + delete)
- `src/main/hotkey.test.ts` — 4 tests (H1 toggle + H2 PTT key-up + H3 persistence + unregister)
- `src/main/mock-amplitude.test.ts` — 9 tests (MA1/MA2/MA3 + emit lifecycle + reset determinism)
- `test/mocks/mock-bridge.ts` — Playwright headless test seam (attaches window.__mockBridge)
- `test/mocks/index.html` — headless entry that loads mock-bridge.ts before main.tsx
- `test/e2e/scaffold.spec.ts` — 3 Playwright tests (floating-shell renders + mock API surface + setState updates data-state)

### Root edits

- `tsconfig.base.json` — added `@achilles/app` literal + 4 subpath aliases (`/main/*`, `/preload/*`, `/renderer/*`, `/shared/*`)
- `vitest.workspace.ts` — added paired workspaceAlias entries + phase-11-unit project
- `playwright.config.ts` — added achilles-renderer project + dedicated webServer for the headless Vite preview
- `package.json` — added `test:phase-11:quick` and `test:phase-11:full` scripts

## Decisions Made

- **Renamed `src/preload/global.d.ts` → `src/preload/global.ts` (Rule 1 fix).** The plan's `files_modified` list named `global.d.ts` while the `<verification>` block required `find apps/achilles/src -name '*.js' -o -name '*.d.ts' | wc -l` to return 0. The two are contradictory. Resolution: TypeScript allows `declare global { ... }` inside a regular `.ts` module file (provided there is at least one top-level export — `export {}` is the marker). The new `global.ts` preserves the type augmentation and clears the CR-07 hygiene check unambiguously.
- **Added a dedicated `vite.headless.config.ts` (Rule 3 fix).** `electron-vite` does not have a clean "skip the main+preload entries, build only the renderer against an alternate HTML root" mode. The cleanest path was a plain-vite config that lives next to the electron-vite config; the production build still uses `electron.vite.config.ts`. Both configs are independent and small (~50 lines each).
- **The headless renderer entry is `apps/achilles/test/mocks/index.html`.** It pre-injects `mock-bridge.ts` via a sibling `<script type="module">` tag so `window.__mockBridge` populates before `main.tsx` hydrates. This is the cleanest contract: production reads `window.achilles`; tests read `window.__mockBridge`; the renderer's `getBridge()` adapter never branches on which.
- **`process.env` reads in main/index.ts are bounded to `ELECTRON_RENDERER_URL`.** No secret-reading paths in either main or preload. The plan's verification rule `grep -RIn 'process.env' apps/achilles/src/main apps/achilles/src/preload | wc -l` returns 2 (both for the same `ELECTRON_RENDERER_URL` lookup on consecutive lines).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed `src/preload/global.d.ts` → `src/preload/global.ts`**

- **Found during:** Task 1 verification (CR-07 hygiene check).
- **Issue:** The plan's `files_modified` block listed `apps/achilles/src/preload/global.d.ts` while the `<verification>` block required `find apps/achilles/src -name '*.js' -o -name '*.d.ts' | wc -l` to return 0. The two contradict each other — a hand-authored `.d.ts` is source, but the verification check is an absolute "no .d.ts anywhere in src/."
- **Fix:** Renamed to `global.ts` and kept the `declare global { interface Window { ... } }` augmentation. TypeScript accepts ambient declarations inside regular `.ts` modules provided there's a top-level export (preserved via `export {}`). The renderer + tests still get the typed `window.achilles` and `window.__mockBridge` access without `any`.
- **Files modified:** Deleted `apps/achilles/src/preload/global.d.ts`; created `apps/achilles/src/preload/global.ts`.
- **Verification:** `find apps/achilles/src -name '*.js' -o -name '*.d.ts' | wc -l` now returns 0; `npm --workspace @achilles/app run typecheck` still exits 0.
- **Committed in:** included in the final atomic commit.

**2. [Rule 3 - Blocking] Added `vite.headless.config.ts` as a separate plain-vite config**

- **Found during:** Task 1 wiring of the `build:renderer:headless` script.
- **Issue:** The plan asked for `electron-vite build --config electron.vite.config.ts --mode headless`. `electron-vite` is purpose-built for the Electron main+preload+renderer triple and does not honour a `--mode` flag that skips the main / preload entries. The first attempt produced an electron-shaped build that the Playwright preview could not serve.
- **Fix:** Created `apps/achilles/vite.headless.config.ts` (plain vite, ~30 lines). The headless build now runs `vite build --config vite.headless.config.ts` and the preview runs `vite preview --config vite.headless.config.ts`. Root entry is `apps/achilles/test/mocks/index.html`, which pre-injects `mock-bridge.ts`.
- **Files modified:** Created `apps/achilles/vite.headless.config.ts`; updated `apps/achilles/package.json` scripts.
- **Verification:** `npm --workspace @achilles/app run build:renderer:headless` produces a 196 KB JS bundle; `npx playwright test --project=achilles-renderer` passes all 3 scaffold specs.
- **Committed in:** included in the final atomic commit.

---

**Total deviations:** 2 auto-fixed (1 Rule 1 contradiction repair, 1 Rule 3 tool-configuration unblock).
**Impact on plan:** Both fixes preserve the plan's locked contracts. The `.d.ts` → `.ts` rename keeps the typed ambient declaration without violating CR-07. The vite-headless config split keeps the production electron-vite path untouched while giving Playwright a clean target. No scope creep.

## Issues Encountered

- The full-workspace `npx vitest run` (no --project filter) surfaces 7 pre-existing test failures in `apps/bridge` / `apps/web` / `packages/claude-code-bridge`. These are NOT caused by Phase 11 — they exist on the Achilles branch as documented baseline. Running with `--project phase-11-unit` (the new project) reports 89/89 passing; `--project phase-09-unit` reports 145/145 passing; `--project phase-10-unit` reports 157/157 passing. Phase 11 introduced zero regressions.
- The base typecheck (`npx tsc -p tsconfig.base.json --noEmit`) surfaces pre-existing TS errors in apps/web (`--jsx` not set), packages/claude-code-bridge (test-file env typing), and the documented WR-10 `passWithNoTests` Vitest 2.x type gap. The apps/achilles project-level typechecks (`tsc -p apps/achilles/tsconfig.node.json --noEmit` and `tsc -p apps/achilles/tsconfig.web.json --noEmit`) both exit 0.

## User Setup Required

None — Phase 11 plumbs only window/state/IPC substrate. The ElevenLabs API key surface ships in Phase 12; signed installers ship in Phase 13.

## Threat Surface — Phase 11 substrate

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-11-01 (Spoofing renderer→main IPC) | mitigate | Every channel parses through `.strict()` Zod schema; preload validates outbound, ipc-bridge validates inbound. |
| T-11-02 (Tampering — package install) | mitigate | All 4 new top-level dependencies (electron 42.3.3, electron-store 10.1.0, react 19.2.4, electron-vite 3.1.0) are locked at the versions named in 11-01-PLAN.md and verified live on npm. Zero `[ASSUMED]` packages introduced. |
| T-11-03 (Repudiation — mocked transitions) | accept | Mock controller is in-process and test-driven; no audit log needed in Phase 11. |
| T-11-04 (Information Disclosure — safeStorage absent) | mitigate | store.ts logs `[achilles] safeStorage unavailable; persisting plaintext (SAFE-01 follow-up in Phase 12)` exactly once and falls back to plaintext. Phase 11 persists only non-secret values. |
| T-11-05 (DoS — runaway IPC traffic) | mitigate | Mock amplitude ticks at fixed 50 ms (UI-SPEC §1); preload validates payload shape; renderer subscribers return unsubscribe functions. |
| T-11-06 (Elevation — nodeIntegration) | mitigate | `createAchillesWindow` locks `webPreferences { contextIsolation: true, nodeIntegration: false, sandbox: true }`; W1 unit test asserts the exact options. |

No new threat surface introduced beyond the plan's `<threat_model>` block.

## Next Phase Readiness

- **Plan 11-02** can immediately compose against:
  - `createAchillesWindow` (window contract is locked + unit-tested).
  - `transition()` + `createMockStateController` (state machine is pure + the mock runtime fires deterministic transitions).
  - `IPC_PAYLOAD_SCHEMAS` + `parseEnvelope` (Zod schemas at the boundary).
  - `getBridge()` (single typed surface, identical in production + headless).
  - `window.__mockBridge` (test seam for Playwright).
- **Plan 11-03** can immediately compose against:
  - `createAchillesStore` (windowPosition + hotkeyMode + hotkeyKey persistence with safeStorage).
  - `registerAchillesHotkey` + `setHotkeyMode` (UI-06 toggle + PTT substrate).
  - The `update-hotkey-config` and `update-window-position` IPC channels (already wired in ipc-bridge.ts).
  - The `open-system-settings` channel (Plan 11-01 stubs the handler; Plan 11-03 wires the real `shell.openExternal` call).
- No blockers. The Wave-1 contracts ship cleanly; Wave-2 can run 11-02 + 11-03 in parallel without renegotiating any schema or window plumbing.

## Self-Check: PASSED

- [x] `apps/achilles/package.json` exists (FOUND)
- [x] `apps/achilles/tsconfig.{json,node.json,web.json}` exist (FOUND)
- [x] `apps/achilles/electron.vite.config.ts` exists (FOUND)
- [x] `apps/achilles/vite.headless.config.ts` exists (FOUND — Rule 3 deviation)
- [x] `apps/achilles/playwright.config.ts` exists (FOUND)
- [x] `apps/achilles/.gitignore` + `apps/achilles/src/.gitignore` exist (FOUND)
- [x] All 7 main-process source files exist (window/store/hotkey/state-machine/mock-amplitude/ipc-bridge/index)
- [x] All 7 test files exist and 89/89 unit tests pass
- [x] All 4 renderer / preload / mock files exist (preload/index, preload/global, renderer/index.html, renderer/main.tsx, renderer/bridge, test/mocks/{mock-bridge,index}.html, test/e2e/scaffold.spec.ts)
- [x] `find apps/achilles/src -name '*.js' -o -name '*.d.ts'` returns 0 entries (CR-07 hygiene)
- [x] `grep -RIn 'process.env' apps/achilles/src/main apps/achilles/src/preload | wc -l` returns 2 (both for `ELECTRON_RENDERER_URL`)
- [x] `grep -c 'achilles:' apps/achilles/src/shared/constants.ts` returns 15 (>= 12 IPC channels carry the prefix)
- [x] Headless renderer build succeeds (196 KB JS, 0.99 KB HTML)
- [x] All 3 Playwright scaffold specs pass
- [x] No emojis anywhere in source, tests, configs, or logs (CLAUDE.md global)

---
*Phase: 11-floating-ui-shell*
*Completed: 2026-06-06*
