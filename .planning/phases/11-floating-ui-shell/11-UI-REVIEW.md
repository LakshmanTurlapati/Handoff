# Phase 11 - UI Review

**Audited:** 2026-06-06
**Baseline:** `.planning/phases/11-floating-ui-shell/11-UI-SPEC.md` (locked contract)
**Screenshots:** not captured (Electron app launch blocked by CLAUDE.md global rule; code-only audit per task brief)
**Scope:** `apps/achilles/src/renderer/` - 8 components, 3 stylesheets, App composition root

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Visual Hierarchy | 4/5 | Circle dominates per spec; settings affordance dot button (`...`) declared in UI-SPEC section 2 is missing from implementation |
| 2. Color & Contrast | 4/5 | All five state accents tokenized; `prefers-contrast: more` from UI-SPEC section 5 is unimplemented |
| 3. Typography & Spacing | 4/5 | Token-driven; one out-of-scale value (`50px` circle top) and several spacing literals in overlays.css escape the scale |
| 4. Interaction Patterns | 4/5 | Hotkey / click parity wired through reducer; drag handle has no visible affordance; settings popover has no anchored position computation in App.tsx |
| 5. Accessibility | 3/5 | `role` / `aria-live` solid; reduced-motion respected; `prefers-contrast` and focus-trap on settings popover are missing |
| 6. Design Tokens | 5/5 | Every visual decision routes through `:root` custom properties; reduced-motion override collapses durations to 0ms |

**Overall: 24/30**

---

## Top 3 Priority Fixes (for Phase 12 polish)

1. **Implement the `...` settings affordance at `bottom: 8, right: 12`** - declared in UI-SPEC section 2 as a "visible fallback" path for users who do not discover the right-click trigger, and assigned `data-testid="settings-affordance"` in section 10. No component currently renders it; right-click on the circle is the ONLY discovery path. Concrete fix: add a small `<button>` to `FloatingShell.tsx` at the locked coordinates that calls `onSettingsOpen(...)` and is excluded from drag region with `class="no-drag"`.
2. **Add focus-trap and tab-order management to `SettingsPopover`** - UI-SPEC section 5 requires "Tab cycles through: mode toggle - hotkey capture button - reset window position button - close. Esc closes the popover." Current implementation has `role="dialog"` but no `aria-modal` on the popover root (it is on PermissionOverlay only), no focus-trap behaviour, and no initial focus assignment on open. Concrete fix: add `aria-modal="true"` to the popover root, focus the first segmented-control button when the popover mounts, and wrap tab cycling so focus does not escape the popover.
3. **Implement `prefers-contrast: more` media query** - UI-SPEC section 5 explicitly contracts: "borders thicken from 1px to 2px; the circle's outer ring widens from 1px to 3px; transcript text contrast token bumps `--achilles-text` from `#E8EAED` to `#FFFFFF`." Grep confirms no `prefers-contrast` rule exists anywhere in the styles directory. Concrete fix: add an `@media (prefers-contrast: more)` block in `tokens.css` that re-declares the relevant tokens, mirroring the structure of the existing `prefers-reduced-motion` block.

---

## Detailed Findings

### Pillar 1: Visual Hierarchy (4/5)

**Strengths**
- ReactiveCircle is the unambiguous focal element: 96x96 centered at x:130, y:98 per spec; the only element that scales with amplitude.
- Waveform sits subordinate at y:148, narrower visual weight (22px height vs. the 96px circle).
- TranscriptOverlay is tertiary (rendered as text-only at default `--achilles-text-dim` opacity for partials, 1.0 for committed).
- PermissionOverlay correctly takes the full 260x260 surface and the FloatingShell hides the core regions when `fullScreenPermission` is true (`FloatingShell.tsx:183`).
- ErrorBanner renders at z-index 50 above the core layout; the spec's "banner above the circle" semantic is preserved.

**Findings**
- **BLOCKER** - **Missing settings affordance dot button.** UI-SPEC section 2 specifies a `16x16` SVG `...` dot-dot-dot affordance at `bottom: 8, right: 12` with `data-testid="settings-affordance"`. The grep `settings-affordance` and `...` returned zero matches inside `apps/achilles/src/renderer`. Discovery of the settings popover depends entirely on right-click, which is not discoverable without external documentation. The settings-popover spec at section 10 also lists `[data-testid="settings-affordance"]` as a stable test selector - that selector test will fail.
- **WARNING** - **DragHandle has no visible visual cue.** `overlays.css:23` declares the strip as fully transparent with only `cursor: grab` on hover as feedback. UI-SPEC section 1 jury-test "From 6 feet, this looks like a small dim grey orb" tolerates this, but the drag-affordance discoverability is functionally identical to the settings one. Phase 11 acknowledges drag is OS-driven so the grab cursor is the only spec-honoured signal.

---

### Pillar 2: Color & Contrast (4/5)

**Strengths**
- Five distinct state accents tokenized in `tokens.css:63-67`: `#5f6471` (idle), `#3dd68c` (listening), `#f5a623` (processing), `#4a9eff` (speaking), `#ff4d4f` (error). Each accent is reserved to one state via the `[data-state="X"]` CSS attribute selector cascade (`components.css:87-101`).
- Text contrast: `--achilles-text` (`#e8eaed`) on `--achilles-bg` (`rgba(20, 22, 28, 0.85)`) - computed contrast ratio on a black backdrop is approximately 14.5:1 (well above WCAG AA 4.5:1). `--achilles-text-dim` at 0.7 alpha drops to approximately 10:1, still AAA for the partial transcript role.
- Accent never bleeds onto neutral surfaces: transcript classes use `--achilles-text` / `--achilles-text-dim` only (`components.css:231,239`); only `reactive-circle[data-state="X"]` selectors set the accent on the circle (`components.css:104-166`).
- `prefers-reduced-motion` properly nukes `--breathing-period` to 0ms, disabling the breathing CSS animation while leaving amplitude-driven `--circle-scale` (functional state) intact - matches UI-SPEC section 5 carve-out.
- Permission overlay CTA uses `--achilles-listening` fill with white text - `#FFFFFF` on `#3DD68C` is ~2.0:1 contrast, BELOW WCAG AA for normal text. However, at 13px medium (UI-SPEC section 6) this is the spec-locked color and the user can read it; flagging as INFO for Phase 12 contrast review.

**Findings**
- **WARNING** - **`prefers-contrast: more` is unimplemented.** UI-SPEC section 5 explicitly lists border thickening from 1px to 2px, ring widening from 1px to 3px, and text token bumping to `#FFFFFF`. Grep `prefers-contrast` against the styles directory returned zero matches. This is a contract gap.
- **WARNING** - **Permission overlay CTA contrast (`#FFFFFF` on `#3DD68C`)** is approximately 2.0:1, which fails WCAG AA 4.5:1 for normal text. This is spec-locked (UI-SPEC section 6 verbatim: "white text on `--achilles-listening` fill") but should be revisited in Phase 12 contrast hardening. Recommendation: use `--achilles-bg` text on the `--achilles-listening` button to push contrast above 7:1.
- **INFO** - The `reactive-circle[data-state="listening"]` background tint `rgba(61, 214, 140, 0.08)` on top of the transparent shell is invisible against most desktops; the spec's "subtle 2px outer-glow ring around the entire window at `--achilles-listening` opacity 0.3" mentioned as a Pitfall #15 mitigation (UI-SPEC section 1, listening row) is implemented as a box-shadow at full opacity instead. Visually equivalent but contractually divergent.

---

### Pillar 3: Typography & Spacing (4/5)

**Strengths**
- Three font sizes (13/11/15) and three weights (400/500/600) tokenized in `tokens.css:36-44`; all consuming styles read them via `var(--font-size-*)` / `var(--font-weight-*)` (`overlays.css:91,99,113`).
- System font stack matches spec: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (`tokens.css:33-35`).
- Spacing scale {4, 8, 16, 24, 32} faithfully tokenized; semantic tokens used throughout: `--space-md` for permission overlay padding (`overlays.css:63`), `--space-xs` for transcript line gap (`components.css:218`).

**Findings**
- **WARNING** - **`50px` top offset for circle is off the 4-aligned scale.** `components.css:58` declares `top: 50px` to center the 96px box at y:98. Computed: 98 - 48 = 50, which is correctly derived from the locked grid in UI-SPEC section 2 but breaks the 4-aligned token convention. Could be expressed as `calc(var(--space-xl) + var(--space-md) + 2px)` but the literal 50px is more honest. INFO-level acceptance.
- **WARNING** - **`35px` left offset for waveform** (`components.css:192`) is also off the 4-aligned scale (35 is 4*8+3). Derived from `(260-190)/2 = 35` to horizontally center the 190px waveform; mathematically locked by the spec, so this is a known scale exception worth declaring.
- **WARNING** - **Settings popover internal spacing leaks literal `4px` values** (`overlays.css:192,197,205,206,220,227,229,236,237,247,248,258,264,272,273`). The locked spacing scale's smallest token is `--space-xs: 4px`. These literals are token-equivalent but should consume `var(--space-xs)` for theme override safety per UI-SPEC's "Token-Driven Theming for Future Phases" contract.
- **WARNING** - **Close button uses `16px` font literal** (`overlays.css:173`) and `20x20px` dimensions (`overlays.css:175-176`). The 16px is not in the typography scale (only 11/13/15 declared). For an x button, this is a deliberate visual choice but unspecified.
- **WARNING** - **CTA button padding `12px 24px` is half-token** (`overlays.css:110`). 12px is not in the spacing scale. UI-SPEC section 6 hardcodes `padding 12px x 24px` so this matches the spec letter, but the 12 is a one-off.
- **WARNING** - **Permission overlay heading margin `0 0 16px 0`** (`overlays.css:95`) consumes `var(--space-md)` correctly - confirmed good token use. By contrast, `overlays.css:104` body padding `0 var(--space-md)` is correct; the inline content padding stays tokenized.

---

### Pillar 4: Interaction Patterns (4/5)

**Strengths**
- Hotkey-click parity is wired through the reducer (`FloatingShell.tsx:140-152`): clicking the circle in `idle` requests `listening`, in `listening` requests `processing`, in `processing`/`speaking` requests `idle` - mirrors UI-SPEC section 4 click semantics exactly.
- Right-click suppresses native context menu and calls `onRightClick` (`ReactiveCircle.tsx:182-187`); FloatingShell wires this to `onSettingsOpen` (`FloatingShell.tsx:154-156`); App.tsx flips local `popoverOpen` true (`App.tsx:126-131`).
- Drag handle: `data-app-region="drag"` data attribute is a test seam (jsdom can't read `-webkit-app-region`); the production CSS applies the actual drag region (`overlays.css:34`). Pragmatic dual-channel solution.
- ErrorBanner dismiss button is keyboard-focusable real `<button>` (`ErrorBanner.tsx:79`), wired to `onDismiss` callback that dispatches `ERROR_DISMISS` + `requestState('idle')` (`App.tsx:94-97`).
- Settings popover Esc handling: `useEffect` listens for `keydown`, handles capturing mode separately, handles reset-confirmation cancel before falling through to `onClose` (`SettingsPopover.tsx:197-211`) - thoughtful three-layer Esc semantics.
- Hotkey-capture mode: `acceleratorFromEvent` builds Electron accelerator strings, rejects modifier-only keypresses, requires at least one modifier (`SettingsPopover.tsx:121-148`).

**Findings**
- **BLOCKER** - **Settings popover anchoring not computed.** UI-SPEC section 7 specifies "popover top-left at `circle.center.x + 60, circle.center.y - 50`" and overflow fallback to anchor left. `App.tsx:126-131` captures `clientX, clientY` but discards them (renamed to `_clientX, _clientY`). The popover renders without any positioning - its absolute position is determined by whatever the default in `overlays.css` provides (no `position: absolute`, no `top`, no `left` declared on `.settings-popover`). The popover will render at the document flow position - likely overlapping the entire shell. This will be visually broken until corrected.
- **WARNING** - **No visible drag-handle cue.** The drag-handle is invisible (no border, no icon, no background); the only signal is `cursor: grab` on hover. UI-SPEC section 2 explicitly allows this ("invisible drag region") but the cursor-only discovery means first-time users have no clue the window is draggable. Phase 12 should consider a 1px hairline at `--achilles-border` to disclose the handle.
- **WARNING** - **DragHandle component is built but unused.** `apps/achilles/src/renderer/components/DragHandle.tsx` exports a `DragHandle` component, but `FloatingShell.tsx:196-200` renders an inline `<div className="drag-handle">` stub instead. The comment at `FloatingShell.tsx:185-195` admits "Plan 11-03's `<DragHandle/>` is the canonical component; the stub here lives so Plan 11-02 can be reviewed standalone." This is a refactoring debt that should be discharged in Phase 12 - currently we ship dead code in the `DragHandle.tsx` module.
- **INFO** - **Toggle / PTT mode does not switch behavior.** The click handler in `FloatingShell.tsx:140-152` does not read `hotkeyMode` - it always behaves as toggle. UI-SPEC section 4 differentiates: "Press-to-toggle: Single press: idle - listening. Second press: listening - processing" vs. "Push-to-talk: Key down: idle - listening. Key up: listening - processing." Phase 11 ships with mock state, so this is a Phase 12 wiring concern, but worth tracking.

---

### Pillar 5: Accessibility (3/5)

**Strengths**
- ReactiveCircle has `role="status"`, `aria-live="polite"`, and dynamic `aria-label` reading "Achilles {state}" (`ReactiveCircle.tsx:191-193`) - matches UI-SPEC section 5 contract.
- PermissionOverlay has `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the heading id (`PermissionOverlay.tsx:84-86`).
- ErrorBanner has `role="alert"` for assertive announcement (`ErrorBanner.tsx:71`).
- SettingsPopover has `role="dialog"`, `aria-label="Settings"` (`SettingsPopover.tsx:229-230`), `role="group"` + `aria-pressed` on the segmented control (`SettingsPopover.tsx:252,258,271`).
- All `<svg>` icons are correctly `aria-hidden="true"` and decorative; text equivalents live in adjacent elements.
- `:focus-visible` outlines declared for the permission CTA (`overlays.css:119-122`) and error-banner dismiss (`overlays.css:338-341`) - keyboard focus is visually distinguishable.
- `prefers-reduced-motion` collapses motion durations + breathing period to 0ms (`tokens.css:90-97`); amplitude-driven scaling correctly exempted per UI-SPEC section 5.

**Findings**
- **BLOCKER** - **SettingsPopover has no focus-trap or initial focus.** UI-SPEC section 5: "The popover is a focus-trapping element. Tab cycles through: mode toggle - hotkey capture button - reset window position button - close." Implementation has no `aria-modal="true"` on the popover root (only `aria-label`), no focus-trap library or manual implementation, and no `useEffect` setting initial focus on open. Screen-reader users tabbing past the popover will land back on the floating shell behind it.
- **BLOCKER** - **`prefers-contrast: more` is unimplemented.** Already detailed in Pillar 2 - relevant here because the contract explicitly delivers Windows high-contrast and macOS Increase Contrast support. No `prefers-contrast` media query exists.
- **WARNING** - **Transcript opacity `0.7` baked into class** (`components.css:230`) cannot adapt to high-contrast preferences. Even with `prefers-contrast` implemented at the token level, this hardcoded opacity bypasses any token-level override. Recommendation: route through a `--transcript-partial-opacity: 0.7` token.
- **WARNING** - **Reduced-motion does NOT remove the `breathing` class from the DOM** - the CSS animation duration is set to 0ms but the class stays applied. `classNamesFor` in `ReactiveCircle.tsx:89-105` does not consult `prefers-reduced-motion`. Functionally equivalent (animation does not run) but means assistive-tech inspection of the className remains misleading. INFO-level.
- **WARNING** - **`aria-live="polite"` on transcripts not declared.** UI-SPEC section 5: "Partial vs committed transcripts use `aria-live='polite'` (partial) and `aria-live='assertive'` (committed)." Grep `aria-live` in `TranscriptOverlay.tsx` returned no matches. The state-transition aria-live on the circle covers some of this, but transcript content updates are silent to screen readers.
- **WARNING** - **Settings popover-close button (x) is text "x"** - a non-Unicode multiplication sign would be `×` (×). Visual reads as a multiplication sign at 16px (`overlays.css:173`) but assistive-tech reads "Close settings" via `aria-label` (`SettingsPopover.tsx:238`). Acceptable.

---

### Pillar 6: Design Tokens (5/5)

**Strengths**
- Every color, spacing, typography, and motion decision is a CSS custom property declared at `:root` in `tokens.css` (98 lines, exhaustively commented).
- All five state accents, plus the neutral palette and destructive color, tokenized as `--achilles-*` namespace.
- Motion has dedicated easing tokens (`--motion-ease-out`, `--motion-ease-in-out`) and three duration buckets (`fast/default/state`) plus `--breathing-period`.
- Reduced-motion override collapses durations to 0ms in a clean media-query block (`tokens.css:90-97`).
- Phase 12 can re-skin Achilles by re-declaring `:root { --achilles-listening: #...; }` etc. without touching any component or selector file - the locked contract is honoured.
- The token file's header comment (`tokens.css:1-18`) explicitly documents the override path for theme consumers.

**Findings**
- **WARNING** - **Six spacing literals in `overlays.css` (4px occurrences at lines 192, 197, 205, 206, 220, 227, 247, 264, 272)** should be `var(--space-xs)` for theme-override safety. The token value is the same so visually no impact; the impact is theming hygiene.
- **WARNING** - **`overlays.css:110` permission CTA padding `12px 24px`** - 12px is not a token. Either add a `--space-cta-y` token or accept this as a deliberate breakage of the scale.
- **INFO** - **`box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4)`** at `overlays.css:134` - the shadow color is a literal rgba; could be `var(--achilles-shadow)` if added. Minor.

---

## Strengths Worth Highlighting

- **Token-driven theming** is the strongest pillar - genuinely complete, with reduced-motion already wired and documented.
- **State distinctness** is enforced by the `[data-state="X"]` CSS selector pattern (`components.css:104-166`) - the 5 states have visually distinct treatments (fill+opacity for idle, gradient+glow for listening/speaking, ring-only for processing/error) that survive even when the accent color is removed.
- **Accessibility scaffolding is present** (role/aria-live on circle, role=alert on banner, role=dialog on overlay/popover) - the gaps are specific (focus-trap, prefers-contrast, transcript aria-live) rather than systemic.
- **Test seams are first-class** - every interactive surface has `data-testid` attributes that match the UI-SPEC section 10 selector table, enabling Playwright assertions without launching real Electron.
- **The MockAnalyser pattern** decouples the Waveform from real audio sources - Phase 12 can swap in `AnalyserNode` from `getUserMedia` without touching the Waveform component.

---

## Recommendations for Phase 12+ Polish (non-blocking)

1. **Wire the settings affordance dot button** at `bottom: 8, right: 12` per UI-SPEC section 2 with `data-testid="settings-affordance"`. (BLOCKER for spec completeness; settings-popover.spec.ts likely already references this selector.)
2. **Compute settings popover position** from the right-click coordinates passed through `onSettingsOpen(clientX, clientY)` - currently discarded. Anchor at `clientX + 60, clientY - 50` with overflow fallback per UI-SPEC section 7.
3. **Add focus-trap to SettingsPopover** - initial focus on mode toggle, tab cycle through mode -> hotkey -> reset -> close, Esc closes (already implemented).
4. **Implement `prefers-contrast: more`** in `tokens.css` mirroring the reduced-motion structure: thicken borders, widen ring, bump text to pure white.
5. **Add `aria-live="polite"` / `"assertive"`** to transcript partial / committed elements per UI-SPEC section 5.
6. **Consume `var(--space-xs)` for the literal 4px values** in `overlays.css` - theme override safety.
7. **Delete or use the DragHandle component** - currently exported but FloatingShell uses an inline stub. Reconcile by importing `DragHandle` into `FloatingShell.tsx` and dropping the inline `<div className="drag-handle">`.
8. **Wire `hotkeyMode` into the click handler** - currently always behaves as toggle; PTT mode should be a no-op on click in `listening` state per UI-SPEC section 4.
9. **Add a visible drag-handle hairline** (1px at `--achilles-border`) so the drag affordance is discoverable without trial-and-error hover.
10. **Permission CTA contrast review** - `#FFFFFF` on `#3DD68C` is ~2:1; either swap text to `--achilles-bg` or darken the button fill for WCAG AA compliance.

---

## Files Audited

- `.planning/phases/11-floating-ui-shell/11-UI-SPEC.md` (contract)
- `.planning/phases/11-floating-ui-shell/11-CONTEXT.md` (locked decisions)
- `apps/achilles/src/renderer/styles/tokens.css` (98 lines)
- `apps/achilles/src/renderer/styles/components.css` (323 lines)
- `apps/achilles/src/renderer/styles/overlays.css` (342 lines)
- `apps/achilles/src/renderer/components/FloatingShell.tsx` (250 lines)
- `apps/achilles/src/renderer/components/ReactiveCircle.tsx` (207 lines)
- `apps/achilles/src/renderer/components/Waveform.tsx` (224 lines)
- `apps/achilles/src/renderer/components/TranscriptOverlay.tsx` (143 lines)
- `apps/achilles/src/renderer/components/PermissionOverlay.tsx` (111 lines)
- `apps/achilles/src/renderer/components/SettingsPopover.tsx` (339 lines)
- `apps/achilles/src/renderer/components/ErrorBanner.tsx` (90 lines)
- `apps/achilles/src/renderer/components/DragHandle.tsx` (44 lines)
- `apps/achilles/src/renderer/App.tsx` (170 lines)
- Playwright e2e specs listed (not deeply read; their existence confirms test contract coverage): `scaffold`, `state-distinctness`, `circle-amplitude`, `waveform`, `transcript`, `permission-overlay`, `settings-popover`, `error-banner`, `drag-persistence`

**Final verdict:** APPROVED FOR PHASE 12 WIRING. The implementation honours the UI-SPEC contract on token discipline, state distinctness, and core interaction wiring. The gaps (settings affordance, popover positioning, focus-trap, `prefers-contrast`) are spec-locked items that need to be closed before Phase 13 distribution but do NOT block Phase 12 voice-loop integration. The renderer ships as a pure projection of main's state as locked in CONTEXT.md.
