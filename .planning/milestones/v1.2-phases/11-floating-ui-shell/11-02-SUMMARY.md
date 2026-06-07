---
phase: 11-floating-ui-shell
plan: 02
subsystem: ui
tags: [react, electron, canvas2d, css-tokens, vitest, playwright, jsdom, headless-vite, ui-02, ui-03, ui-04, loop-02]

# Dependency graph
requires:
  - phase: 11-floating-ui-shell
    plan: 01
    provides: "BrowserWindow contract, AchillesState reducer, IPC schemas, MockAchillesBridge test seam, headless Vite preview, getBridge() renderer adapter"
provides:
  - "Renderer state container — AchillesStateProvider + useAchillesState hook backed by a pure reducer with 7 documented actions and the [0,1] amplitude clamp (T-11-08 mitigation)"
  - "ReactiveCircle component — 96px SVG circle with per-state CSS classes (breathing/spinning/amplitude-driven/shake), inline --circle-scale custom property = 0.9 + amplitude*0.5, and the document.visibilityState pause for CPU save"
  - "Waveform component — 32-bar Canvas2D visualizer subscribed to an AnalyserLike source, 20fps rAF poll, state-driven fill colors, and the null-source static-baseline branch"
  - "TranscriptOverlay component — LOOP-02 partial/committed renderer with 0.7/1.0 opacity classes, 15s idle auto-fade, max 3 visible lines, and the speaking-hide-after-1s rule"
  - "FloatingShell composition root — wires the circle + waveform + transcript + drag-handle stub against useAchillesState; exposes three overlay slots (permissionOverlay, errorBanner, settingsPopover) for Plan 11-03"
  - "MockAnalyser — AnalyserNode-shape testability seam (frequencyBinCount + getByteFrequencyData) replaceable by a real Web Audio AnalyserNode in Phase 12"
  - "Design tokens — tokens.css declares the 5 state accents + neutral palette + motion durations + breathing period at :root with prefers-reduced-motion override"
  - "Component styles — components.css owns the layout grid keyframes (breathing, spin, shake, transcript-fade) and per-data-state accent variable cascade"
  - "Renderer main.tsx — composition entry wiring AchillesStateProvider + App (Plan 11-03 owns App.tsx; Plan 11-02 ships the entry that imports it)"
  - "Headless debug seam — window.__achilles_debug exposing the live analyser instance, gated by import.meta.env.MODE === 'headless' so production builds tree-shake it"
  - "4 Playwright e2e specs proving UI-02 / UI-03 / UI-04 / LOOP-02 against the headless Vite preview without launching real Electron"
  - "Deterministic amplitude fixtures (LISTENING_FIXTURE + SPEAKING_FIXTURE, 100 samples each) seed-42-derived for e2e fixture comparisons"
affects:
  - 11-03-PLAN.md (App.tsx composes against FloatingShell + overlay slots; PermissionOverlay/ErrorBanner/SettingsPopover render through the slot props)
  - 12-end-to-end-integration (replaces MockAnalyser with real AnalyserNode wired off getUserMedia + TTS playback; reducer + components unchanged)

# Tech tracking
tech-stack:
  added:
    - "@testing-library/react 16.3.0 (already installed; first use in apps/achilles)"
    - "@testing-library/jest-dom 6.9.1 (already installed; transitive)"
  patterns:
    - "Per-file `// @vitest-environment jsdom` docblock — component tests opt into jsdom while shared/main tests stay in node (the phase-11-unit project default)"
    - "CSS custom property cascade per data-state — `[data-testid='reactive-circle'][data-state='listening']` sets --circle-color-current to var(--achilles-listening); the component reads the variable via getComputedStyle"
    - "Inline --circle-scale on the React element — amplitude-driven scaling lives on the style attribute so getComputedStyle returns the value to Playwright assertions"
    - "Canvas 2D stub in renderer test setup — jsdom 26 does NOT ship a Canvas2D context (returns null); a minimal `getContext('2d')` patch records fillStyle / fillRect calls for structural assertions"
    - "Build-time `define: { 'import.meta.env.MODE': '\"headless\"' }` in vite.headless.config.ts so the renderer's debug-surface conditional resolves to true during the e2e bundle build only"

key-files:
  created:
    - apps/achilles/src/renderer/components/FloatingShell.tsx (+ FloatingShell.test.tsx)
    - apps/achilles/src/renderer/components/ReactiveCircle.tsx (+ ReactiveCircle.test.tsx)
    - apps/achilles/src/renderer/components/Waveform.tsx (+ Waveform.test.tsx)
    - apps/achilles/src/renderer/components/TranscriptOverlay.tsx (+ TranscriptOverlay.test.tsx)
    - apps/achilles/src/renderer/components/MockAnalyser.ts (+ MockAnalyser.test.ts)
    - apps/achilles/src/renderer/styles/tokens.css
    - apps/achilles/src/renderer/styles/components.css
    - apps/achilles/src/renderer/state/useAchillesState.ts (+ useAchillesState.test.ts)
    - apps/achilles/test/e2e/state-distinctness.spec.ts
    - apps/achilles/test/e2e/circle-amplitude.spec.ts
    - apps/achilles/test/e2e/waveform.spec.ts
    - apps/achilles/test/e2e/transcript.spec.ts
    - apps/achilles/test/fixtures/amplitude-fixtures.ts
  modified:
    - apps/achilles/src/renderer/main.tsx (replaced Plan 11-01 stub with the real composition root)
    - apps/achilles/test/mocks/index.html (removed duplicate data-testid="floating-shell" from the root wrapper)
    - apps/achilles/vite.headless.config.ts (added build-time MODE define for the debug-surface tree-shake)
    - vitest.workspace.ts (added esbuild jsx: automatic to phase-11-unit so .test.tsx files render without explicit React imports)

key-decisions:
  - "Per-file jsdom environment via `// @vitest-environment jsdom` docblock — the phase-11-unit project keeps its node default; component tests opt in per file. Cleaner than splitting the project into two workspace entries and matches how vitest's per-file environment override is documented to work in 2.1."
  - "Canvas 2D shim in test setup, not the canvas npm package — the canvas package is a native module with heavy build-time deps (cairo, pixman). A 30-line getContext('2d') stub that records fillStyle / fillRect satisfies the WF1-WF4 contracts without ballooning the dev dependency footprint."
  - "Headless debug surface keyed on `import.meta.env.MODE === 'headless' || 'development' || 'test'` — Vite's tree-shaker resolves the constant at build time. The production electron-vite path sets MODE='production' (the if is statically false), the headless vite.headless.config.ts defines MODE='headless' so the assignment activates."
  - "MockAnalyser inlines the LCG-driven amplitude generator instead of importing createMockAmplitudeStream from src/main — renderer / main process separation lock. The seed convention (42) and Numerical Recipes constants are duplicated so the two streams pair up for fixture comparison without crossing the process boundary."
  - "FloatingShell renders a stub drag handle with `data-app-region='drag'` instead of inline style — jsdom does NOT serialize the proprietary -webkit-app-region CSS property in the style attribute (writes the property but the style attribute string stays empty). The data attribute matches Plan 11-03's DragHandle test convention so FloatingShell and DragHandle can be swapped without breaking tests."
  - "Per-state accent flows via a CSS custom property cascade — each `[data-state='X']` selector sets `--circle-color-current` to `var(--achilles-X)`. The state-distinctness e2e reads `getComputedStyle(circle).getPropertyValue('--circle-color-current')` and asserts pairwise distinctness across the 5 states."
  - "useAchillesState reducer clamps mic/tts RMS into [0,1] (Rule 2 — defence in depth against T-11-08). The ReactiveCircle clamp is a second-line defence in case a future caller bypasses the reducer."

patterns-established:
  - "Pattern: data-state attribute drives both DOM contract and CSS class cascade — selectors `[data-state='X']` and component class lists are computed from the same `state` prop, so e2e assertions (`toHaveAttribute`) and unit assertions (`className.match`) probe the same state machine projection"
  - "Pattern: CSS custom properties are the test seam — colors and motion go through `var(--achilles-*)` so e2e specs can assert on `getComputedStyle().getPropertyValue('--*')` without depending on color hex values directly"
  - "Pattern: inline --circle-scale custom property — React sets the value on `element.style` directly; the CSS `.amplitude-driven { transform: scale(var(--circle-scale, 1)) }` rule consumes it. Both unit (style attribute) and e2e (getComputedStyle) can read the value"

requirements-completed: [UI-02, UI-03, UI-04, LOOP-02]

# Metrics
duration: ~60min
completed: 2026-06-06
---

# Phase 11 Plan 02: Reactive Circle + Waveform + Transcript + 5-State Visual Treatments Summary

**The four renderer components that make Phase 11 visually verifiable — FloatingShell (composition root), ReactiveCircle (96px SVG with per-state CSS treatments + amplitude scaling), Waveform (32-bar Canvas2D visualizer driven by an AnalyserNode-shaped source), and TranscriptOverlay (LOOP-02 partial/committed renderer with 15s auto-fade) — wired against the renderer state container useAchillesState and verified by 4 Playwright headless specs proving UI-02 / UI-03 / UI-04 / LOOP-02.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-06-06T20:58:57Z
- **Completed:** 2026-06-06T21:51:53Z
- **Tasks:** 2 (both auto-completed)
- **Files created:** 14 source / test / fixture files in apps/achilles + 3 root-level edits
- **Tests:** 76 new unit tests (Vitest, phase-11-unit project) + 8 new e2e tests (Playwright, achilles-renderer project) = 84 new passing tests on top of the 89/89 + 3/3 from Plan 11-01

## Accomplishments

- **useAchillesState renderer state container** — pure reducer with 8 action types (`STATE_CHANGED`, `TRANSCRIPT_PARTIAL`, `TRANSCRIPT_COMMITTED`, `MIC_AMPLITUDE`, `TTS_AMPLITUDE`, `PERMISSION_CHANGED`, `ERROR`, `ERROR_DISMISS`), an `AchillesStateProvider` that wires subscriptions through `getBridge()`, and `useAchillesState()` hook. 17 unit tests cover the 7 documented behaviors (US1-US7) plus defensive PERMISSION_CHANGED + unknown-action-tag paths.
- **MockAnalyser** — AnalyserNode-shape stub with `frequencyBinCount + getByteFrequencyData`, an internal 50ms tick driven by a seeded LCG, state-specific patterns (listening/speaking track an amplitude source, processing emits a deterministic shimmer, idle/error emit a flat baseline at value 2), and a `stop()` method. 10 unit tests cover MA1-MA4.
- **ReactiveCircle** — 96px SVG with `data-testid="reactive-circle"` + `data-state` attribute. Class list computed from `state` + a `useDocumentVisible` hook (idle gets `breathing` only when visible). Listening/speaking apply `amplitude-driven` and set inline `--circle-scale = 0.9 + amplitude * 0.5`. Processing applies `spinning` (270deg rotating ring via `::before` pseudo-element). Error applies `shake` for 600ms via a self-clearing timer. 20 unit tests cover RC1-RC5 including the visibility-pause and right-click event-forwarding paths.
- **Waveform** — 32-bar Canvas2D visualizer at 190×22 px (UI-SPEC §2). Reads from an AnalyserLike (`MockAnalyser` or future `AnalyserNode`) at 20fps via `requestAnimationFrame` gated by a 50ms tick. State-driven fill color reads `--achilles-{state}` token (with fallback hex values for jsdom). Null analyser → static baseline, no rAF loop (T-11-09 mitigation). 9 unit tests cover WF1-WF4 with a minimal Canvas 2D context shim because jsdom 26 does not ship Canvas2D.
- **TranscriptOverlay** — LOOP-02 contract. Slices `committed` to the last `maxVisibleLines` (default 3). Partial elements render at opacity 0.7 (`transcript-partial` class), committed at opacity 1.0. Idle 15s auto-fade via a 1s ticker that adds `fading` class when `now - committedAt > fadeAfterMs`. Speaking-hide via a 1s setTimeout that adds `speaking-hide` to the container. Empty partial → no element (avoids the 0.7 orphan box). 8 unit tests cover TO1-TO6 including the new-commit timer reset and the speaking-state cleanup.
- **FloatingShell** — composition root that pulls state from `useAchillesState`, instantiates the MockAnalyser via `useMemo` keyed on state, and renders the per-state amplitude into the ReactiveCircle and Waveform. Slot wiring for `permissionOverlay` / `errorBanner` / `settingsPopover` lets Plan 11-03 plug its overlays in without touching FloatingShell again. FS3 (error hides transcript) + FS4 (permissionOverlay + denied/restricted hides core) visibility rules verified by 12 unit tests.
- **Design tokens (`tokens.css`)** — `:root` declares the 5 state accents (`#5F6471`, `#3DD68C`, `#F5A623`, `#4A9EFF`, `#FF4D4F`), neutral palette, motion durations (`--motion-duration-fast: 150ms`, `--motion-duration-default: 250ms`, `--motion-duration-state: 350ms`, `--breathing-period: 2000ms`), and the `@media (prefers-reduced-motion: reduce)` override that collapses all motion to 0ms.
- **Component styles (`components.css`)** — owns the layout grid (`.floating-shell`, `.reactive-circle`, `.waveform`, `.transcript-overlay`), the `@keyframes` (`breathing`, `spin`, `shake`, `transcript-fade`), the per-data-state cascade that sets `--circle-color-current` to the matching token, and the LOOP-02 fading class wiring.
- **Renderer `main.tsx`** — replaces the Plan 11-01 stub with `<StrictMode><AchillesStateProvider><App /></AchillesStateProvider></StrictMode>` and imports `tokens.css`, `components.css`, `overlays.css` (Plan 11-03 ships overlays.css; we import all three so production build is complete).
- **4 Playwright e2e specs** — `state-distinctness.spec.ts` (UI-02 strict distinctness over the 5 accents), `circle-amplitude.spec.ts` (UI-03 — `--circle-scale === 0.9 + v * 0.5` within 0.001 over LISTENING_FIXTURE[0..4] + SPEAKING_FIXTURE[0..4]), `waveform.spec.ts` (UI-04 — canvas 190×22 + `window.__achilles_debug.analyser.frequencyBinCount === 32`), `transcript.spec.ts` (LOOP-02 — partial opacity 0.7, committed 1.0, fading class after 15s of idle using `page.clock.fastForward`). All 8 e2e assertions pass against the headless Vite bundle.
- **Deterministic fixtures** — `LISTENING_FIXTURE` + `SPEAKING_FIXTURE` (100 samples each at seed 42) generated by running the Plan 11-01 `createMockAmplitudeStream` so the e2e specs can pre-compute expected scale values without re-running the LCG inside the page context.

## Task Commits

Per the execution context's commit policy, this plan ships as a single atomic commit with the message:

> `feat(11-02): reactive circle + waveform + transcript + 5-state visual treatments`

(no Co-Authored-By trailer, per the plan's commit policy)

## Files Created/Modified

### Renderer source (apps/achilles/src/renderer/)

- `components/FloatingShell.tsx` + `components/FloatingShell.test.tsx` (12 unit tests)
- `components/ReactiveCircle.tsx` + `components/ReactiveCircle.test.tsx` (20 unit tests)
- `components/Waveform.tsx` + `components/Waveform.test.tsx` (9 unit tests)
- `components/TranscriptOverlay.tsx` + `components/TranscriptOverlay.test.tsx` (8 unit tests)
- `components/MockAnalyser.ts` + `components/MockAnalyser.test.ts` (10 unit tests)
- `state/useAchillesState.ts` + `state/useAchillesState.test.ts` (17 unit tests)
- `styles/tokens.css` (CSS custom properties — single source of truth for color/motion)
- `styles/components.css` (layout grid, keyframes, per-data-state cascade)
- `main.tsx` (modified — replaced Plan 11-01 stub with the real composition root)

### Test seams (apps/achilles/test/)

- `e2e/state-distinctness.spec.ts` (UI-02, 1 test, 5 states)
- `e2e/circle-amplitude.spec.ts` (UI-03, 2 tests)
- `e2e/waveform.spec.ts` (UI-04, 2 tests)
- `e2e/transcript.spec.ts` (LOOP-02, 3 tests)
- `fixtures/amplitude-fixtures.ts` (LISTENING_FIXTURE + SPEAKING_FIXTURE, 100 samples each)
- `mocks/index.html` (modified — removed duplicate data-testid from root wrapper)

### Workspace / build edits

- `vitest.workspace.ts` (added `esbuild: { jsx: 'automatic', jsxImportSource: 'react' }` to `phase-11-unit` so component tests render without explicit React imports)
- `apps/achilles/vite.headless.config.ts` (added `define: { 'import.meta.env.MODE': '"headless"' }` so the renderer's debug-surface tree-shake resolves to true during the e2e bundle build only)

## Decisions Made

- **Per-file jsdom environment via `// @vitest-environment jsdom` docblock (no project split).** The phase-11-unit project's default environment stays as `node` so the existing main/shared tests do not pay a jsdom startup cost. Component tests opt in per file via the documented docblock. Cleaner than splitting `phase-11-unit` into `phase-11-unit-node` + `phase-11-unit-jsdom`.
- **JSX automatic on the phase-11-unit project (Rule 3 fix).** React 19's tsconfig already ships `jsx: react-jsx` in `tsconfig.web.json`, but the Vitest project did not inherit the esbuild config. Without `esbuild: { jsx: 'automatic', jsxImportSource: 'react' }`, the component tests threw `ReferenceError: React is not defined` on the first JSX expression. The added 4-line config block matches `phase-03-web` exactly.
- **Canvas 2D shim in test setup, not the `canvas` npm package (Rule 3 fix).** The plan said "jsdom 26 ships a basic Canvas 2D shim" — that turned out to be false (jsdom 26 returns null with a not-implemented warning unless the heavyweight `canvas` package is installed). A 30-line `getContext('2d')` stub that records `fillStyle` / `fillRect` calls satisfies WF1-WF4 without adding the `canvas` package's native binary dependencies.
- **Drag handle uses `data-app-region="drag"` instead of inline `WebkitAppRegion` style.** jsdom does not serialize the proprietary `-webkit-app-region` CSS property in the style attribute (the DOM property is settable but the cssText string stays empty). The data attribute matches Plan 11-03's `DragHandle` convention so the FloatingShell stub and the real component are interchangeable.
- **Removed duplicate `data-testid="floating-shell"` from `test/mocks/index.html` root wrapper (Rule 3 fix).** Plan 11-01 set the testid on `<div id="root">` so the stub renderer would expose it. Plan 11-02's `FloatingShell` component now owns that testid (UI-SPEC §10 locks the selector). Leaving the testid on both yielded duplicate Playwright locator hits and a strict-mode failure on the Plan 11-01 scaffold spec.
- **TO3 / TO4 timer threshold is 16000ms in tests, not 15001ms.** The TranscriptOverlay's idle ticker fires every 1000ms; after `advanceTimersByTime(15001)`, the last firing reads `Date.now() = T0 + 15000`, which makes `now - committedAt === 15000`. The `isFading` check is strict `>`, so 15000 is not enough to trip the fade. Advancing 16000ms ensures the last firing reads `T0 + 16000 > T0 + 15000` and the assertion passes deterministically.
- **MockAnalyser inlines the LCG generator (does NOT import from `src/main/`).** The renderer process must not reach into `src/main/`. The 8-line `makeLcg` function is duplicated here with the same Numerical Recipes constants Plan 11-01 used, so seeds match for fixture comparison without crossing the process boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added JSX automatic config to `phase-11-unit`**

- **Found during:** Task 1 — first component test that used JSX threw `ReferenceError: React is not defined`.
- **Issue:** The plan's `<verify>` block assumed component tests would render JSX via Vitest's default esbuild config. But the `phase-11-unit` project in `vitest.workspace.ts` did not declare `esbuild: { jsx: 'automatic', jsxImportSource: 'react' }`, so JSX expressions transpiled to `React.createElement(...)` references that were never imported. Without explicit `import React from "react"` in every test file, the tests failed.
- **Fix:** Added the 4-line `esbuild` block to the `phase-11-unit` workspace project in `vitest.workspace.ts`. Matches the `phase-03-web` project's config verbatim.
- **Files modified:** `vitest.workspace.ts`.
- **Verification:** All 76 Plan 11-02 component tests pass (the 169-test count grew to 212 with the additional 11-03 wave tests).

**2. [Rule 3 - Blocking] Added Canvas 2D shim in Waveform / FloatingShell test setup**

- **Found during:** Task 1 — Waveform.test.tsx ran but every `getContext('2d')` returned null with the jsdom not-implemented warning.
- **Issue:** The plan said "jsdom 26 ships a basic Canvas2D shim". Empirically, jsdom 26.1.0 does NOT include a Canvas 2D implementation — `HTMLCanvasElement.prototype.getContext('2d')` returns null and triggers a not-implemented warning unless the `canvas` npm package is installed (which adds a heavy native dependency on Cairo + pixman).
- **Fix:** Added a `beforeEach` hook in `Waveform.test.tsx` and `FloatingShell.test.tsx` that patches `HTMLCanvasElement.prototype.getContext('2d')` to return a minimal stub recording `fillStyle` / `fillRect` calls. Restored in `afterEach`. The stub satisfies WF1-WF4 structural assertions without adding a native dependency.
- **Files modified:** `apps/achilles/src/renderer/components/Waveform.test.tsx`, `apps/achilles/src/renderer/components/FloatingShell.test.tsx`.
- **Verification:** WF1-WF4 all pass; FloatingShell does not throw on the embedded Waveform's first paint.

**3. [Rule 3 - Blocking] Added `define: { 'import.meta.env.MODE': '"headless"' }` to `vite.headless.config.ts`**

- **Found during:** Task 2 — `waveform.spec.ts` failed because `window.__achilles_debug` was `undefined` in the headless bundle.
- **Issue:** The plan said "wrap the debug-surface assignment behind `import.meta.env.MODE === 'headless'` so Vite tree-shakes the branch in production". Vite's default behaviour is to set `MODE='production'` for ALL builds; the headless bundle was no exception. The conditional was statically false in both the headless AND production builds, so the debug surface never appeared.
- **Fix:** Added `define: { 'import.meta.env.MODE': JSON.stringify('headless') }` to `vite.headless.config.ts`. The headless bundle now sees `MODE='headless'` at build time; the conditional resolves true; the debug surface is attached. The production electron-vite path is untouched (default MODE='production' → conditional false → no debug surface).
- **Files modified:** `apps/achilles/vite.headless.config.ts`.
- **Verification:** `window.__achilles_debug.analyser.frequencyBinCount === 32` holds in the headless preview; the production renderer build does NOT include the active branch (dead code is present in the unminified output but the runtime conditional never fires).

**4. [Rule 3 - Blocking] Removed duplicate `data-testid="floating-shell"` from `test/mocks/index.html`**

- **Found during:** Task 2 — Plan 11-01's scaffold spec failed because the Playwright locator `[data-testid="floating-shell"]` matched two elements (the root wrapper + the FloatingShell component).
- **Issue:** Plan 11-01 set the testid on `<div id="root" data-testid="floating-shell">` so the stub renderer would expose it. My FloatingShell component now owns the testid (UI-SPEC §10 locks the selector). Two elements with the same testid yields a strict-mode locator failure.
- **Fix:** Removed `data-testid="floating-shell"` from the root wrapper in `test/mocks/index.html`. Left an explanatory HTML comment. The React-rendered FloatingShell is the single source of the testid.
- **Files modified:** `apps/achilles/test/mocks/index.html`.
- **Verification:** Plan 11-01 scaffold spec (3 tests) passes; Plan 11-02 e2e specs (8 tests) pass; no duplicate-locator failures.

---

**Total deviations:** 4 auto-fixed (all Rule 3 — blocking-issue unblocks for the test/build pipeline).
**Impact on plan:** Each deviation preserves the documented contract. The vitest JSX config matches the existing `phase-03-web` precedent. The Canvas 2D shim is contained to the test setup. The headless MODE define applies only to the headless build target. The testid de-duplication aligns with UI-SPEC §10 (which names the React component as the testid owner). No scope creep, no new packages, no API changes.

## Issues Encountered

- **None of my Plan 11-02 deliverables blocked.** Plan 11-03 (the parallel wave-2 sibling) has shipped its own files (`App.tsx`, `PermissionOverlay`, `ErrorBanner`, `SettingsPopover`, `DragHandle`, `permission.ts`, `drag-persist.ts`, `settings-popover-window.ts`, etc.) in the same git workspace. My commit will explicitly NOT stage 11-03's files; they will be committed separately under the 11-03 plan.
- **The full e2e suite (including 11-03's specs) passes — 26/26 specs.** Plan 11-01 scaffold (3 specs) + Plan 11-02 (8 specs) + Plan 11-03 (15 specs).
- **The full vitest phase-11-unit project passes — 212/212 tests.** Plan 11-01 (89 tests) + Plan 11-02 (76 tests) + Plan 11-03 (47 tests).
- Phase-09 phase-09-unit (145/145) and phase-10-unit (157/157) regressions verified — both still 100% pass.

## User Setup Required

None — Phase 11 Plan 02 ships only renderer-side visuals + test seams. No package installs, no API keys, no system permissions, no manual configuration.

## Threat Surface — Phase 11 Plan 02 mitigations

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-11-07 (Information Disclosure — transcripts) | mitigate | TranscriptOverlay renders `entry.text` via React's text-node escaping (no `dangerouslySetInnerHTML`); the IPC schema (`TranscriptPartialPayloadSchema`, `TranscriptCommittedPayloadSchema`) is `.strict()` and `text: z.string().min(1)`, so HTML payloads cannot reach the renderer through the documented channels. |
| T-11-08 (Spoofing — amplitude streams) | mitigate | `useAchillesState` reducer clamps mic/TTS amplitude into `[0, 1]` regardless of source. ReactiveCircle has a second-line clamp in its inline `--circle-scale` calculation. Both defences cap the scaled circle at 1.4× the natural size — no possible amplitude can drive the visual beyond that. |
| T-11-09 (DoS — rAF on Waveform) | mitigate | The rAF loop is gated by a 50ms tick (20fps) AND only started when `analyser !== null && state !== 'idle' && state !== 'error'`. The component synchronously skips the loop setup for the idle/error/null branches, so the CPU cost is ~0 outside the amplitude states. |
| T-11-10 (Tampering — MockAnalyser exposed via __achilles_debug) | mitigate | The debug surface is behind `import.meta.env.MODE === 'headless' \|\| 'development' \|\| 'test'`. The production electron-vite build sets MODE='production' so the conditional is statically false; the headless vite.headless.config.ts defines MODE='headless' so the assignment activates only there. The string literal "achilles_debug" appears in the unminified production bundle (dead code path) but the assignment never executes — confirmed by reading the resolved if-condition in the built JS. |
| T-11-11 (Information Disclosure — transcript auto-fade timing) | accept | The 15s auto-fade is a UX nudge, not a security control. Per the plan's threat model, Phase 14 owns the formal "no transcript persistence" guarantee. |

No new threat surface introduced beyond the plan's `<threat_model>` block.

## Next Phase Readiness

- **Plan 11-03** can immediately compose against:
  - `FloatingShell` accepts three slot props (`permissionOverlay`, `errorBanner`, `settingsPopover`) and an `onSettingsOpen` callback — Plan 11-03 already wires its overlays through them via `App.tsx`.
  - `useAchillesState` is the shared state container — Plan 11-03's `App.tsx` reads `state`, `permissionState`, `error` from it and dispatches `ERROR_DISMISS` for the banner close path.
  - `tokens.css` exposes every state accent + neutral palette as CSS custom properties; Plan 11-03's `overlays.css` can layer on top without redeclaring colors.
- **Plan 12** (End-to-End Integration) can replace the `MockAnalyser` with a real `AnalyserNode` wired off `getUserMedia` (mic) or the TTS playback graph without touching `Waveform` or `FloatingShell` (both consume the `AnalyserLike` shape).
- **No blockers.** Wave 2 of Phase 11 (both 11-02 and 11-03) lands cleanly on disjoint component sets; the next handoff is to Phase 12.

## Self-Check: PASSED

- [x] `apps/achilles/src/renderer/components/FloatingShell.tsx` exists (FOUND)
- [x] `apps/achilles/src/renderer/components/ReactiveCircle.tsx` exists (FOUND)
- [x] `apps/achilles/src/renderer/components/Waveform.tsx` exists (FOUND)
- [x] `apps/achilles/src/renderer/components/TranscriptOverlay.tsx` exists (FOUND)
- [x] `apps/achilles/src/renderer/components/MockAnalyser.ts` exists (FOUND)
- [x] `apps/achilles/src/renderer/styles/tokens.css` exists (FOUND, declares all 5 state accents + reduced-motion override)
- [x] `apps/achilles/src/renderer/styles/components.css` exists (FOUND, declares breathing/spin/shake/transcript-fade keyframes)
- [x] `apps/achilles/src/renderer/state/useAchillesState.ts` exists (FOUND, exposes reducer + Provider + hook)
- [x] `apps/achilles/test/fixtures/amplitude-fixtures.ts` exists (FOUND, 100-sample fixtures derived from seed 42)
- [x] All 4 e2e spec files exist (state-distinctness, circle-amplitude, waveform, transcript)
- [x] `npm run typecheck --workspace apps/achilles` exits 0
- [x] `npx vitest run --project phase-11-unit` passes 212/212 (Plan 11-02 76 tests + sibling 136 tests)
- [x] `npx playwright test --project=achilles-renderer` passes 26/26 (Plan 11-02 8 specs + sibling 18 specs)
- [x] `npm --workspace @achilles/app run build:renderer:headless` produces a 213 KB JS bundle (down from 196 KB at Plan 11-01 because of the component code; gzip ~67 KB)
- [x] `npm --workspace @achilles/app run build:renderer` produces a clean electron-vite production build
- [x] `find apps/achilles/src -name '*.js' -o -name '*.d.ts' -o -name '*.jsx'` returns 0 entries (CR-07 hygiene)
- [x] `grep -RIn 'import.*from.*src/main' apps/achilles/src/renderer` returns 0 entries (renderer/main process separation lock)
- [x] `grep -RIn 'framer-motion' apps/achilles` returns 0 entries (UI-SPEC §design-system: vanilla CSS-only motion)
- [x] No emojis anywhere in source, tests, configs, comments, or logs (CLAUDE.md global)
- [x] Phase-09 phase-09-unit project unchanged at 145/145
- [x] Phase-10 phase-10-unit project unchanged at 157/157

---
*Phase: 11-floating-ui-shell*
*Completed: 2026-06-06*
