# Phase 11: Floating UI Shell - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (auto-optimized) — UI phase with frontend indicators; ui-phase will produce a paired UI-SPEC.md

<domain>
## Phase Boundary

Delivers `apps/achilles` — an Electron desktop application that hosts:

- A frameless, transparent, always-on-top "panel" window on macOS (~220–300 px square) that survives Spaces and full-screen apps without stealing focus
- Five visible states with distinct visual treatments: `idle`, `listening`, `processing`, `speaking`, `error`
- A central reactive circle that pulses with live mic amplitude during `listening` and with TTS amplitude during `speaking`; idle state shows a slow breathing animation
- A live waveform (Canvas2D + `AnalyserNode`) next to the circle; audio source switches between mic (during listening) and TTS playback (during speaking)
- Drag-to-reposition with encrypted persistence of window position via Electron `safeStorage` / `electron-store`
- Configurable global hotkey supporting BOTH press-to-toggle AND push-to-talk modes (switchable via setting)
- macOS microphone permission requested by the Electron host (not the launching terminal) via `systemPreferences.askForMediaAccess('microphone')`, with explicit remediation copy and a deep link to System Settings -> Privacy -> Microphone when denied
- A mocked state machine driving all five visuals so the shell is verifiable without the voice loop or the Claude bridge — full end-to-end wiring happens in Phase 12
- Live partial/committed transcripts surface in the floating UI as confirmation (display only, not editable; re-utter to correct)

Out of scope for Phase 11 (delegated to later phases):
- Real ElevenLabs STT/TTS wiring (Phase 12 — composes with `@achilles/voice-stt` and `@achilles/voice-tts` from Phase 09)
- Claude Code subprocess wiring (Phase 12 — composes with `@achilles/claude-code-bridge` from Phase 10)
- The companion system prompt body (Phase 12)
- Half-duplex turn-taking gate (Phase 12)
- Code-signing identity, notarisation, and installer artefacts (Phase 13)
- Latency probe / suspend-resume / device-change recovery (Phase 14)
- npm CLI bin / skill install command (Phase 13)

</domain>

<decisions>
## Implementation Decisions

### Locked by REQUIREMENTS.md (do not reopen)
- Floating UI surface: small floating window (~220–300 px), frameless transparent always-on-top, drag-to-reposition with persistence (UI-01, UI-05)
- Five visible states (UI-02), reactive circle (UI-03), live waveform via `AnalyserNode` (UI-04)
- Both press-to-toggle AND push-to-talk modes (UI-06, configurable via setting)
- macOS mic permission via Electron host with remediation deep-link (UI-07)
- Transcripts shown live as display-only confirmation (LOOP-02)

### Stack (locked from research SUMMARY.md)
- Electron 42.3.3 — frameless transparent always-on-top, `BrowserWindow({ frame: false, transparent: true, alwaysOnTop: true, focusable: false, type: 'panel', skipTaskbar: true })`, `app.dock.hide()`, `Tray`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`
- React 18.3 + TypeScript for the renderer
- Vite + `electron-vite` for dev/build
- Canvas2D + `AnalyserNode` for waveform (hand-rolled, ~30 lines; wavesurfer.js is file-oriented and wrong for live amplitude)
- `@ricky0123/vad-web` 0.0.30 in an AudioWorklet for end-of-utterance detection (renderer-only)
- `electron-store` for window-position persistence; encrypted via `safeStorage` for the API key surface (Phase 12 owns the API key UX; Phase 11 just plumbs `electron-store`)
- `zod` for any runtime IPC validation (consumes `@achilles/voice-protocol` types from Phase 09)

### App layout (`apps/achilles`)
- `apps/achilles/package.json` — Electron app, NOT a library; not published; private
- `apps/achilles/electron.vite.config.ts` — main/preload/renderer build entrypoints
- `apps/achilles/src/main/` — main process: window creation, hotkey, mic permission, store, mock state-machine
- `apps/achilles/src/preload/` — preload bridge exposing typed renderer API via `contextBridge`
- `apps/achilles/src/renderer/` — React app: circle, waveform, transcript view, state visuals
- `apps/achilles/src/shared/` — shared types between main and renderer (consume `@achilles/voice-protocol` for IPC contract)
- `apps/achilles/test/` — Vitest unit tests for pure helpers; Playwright for renderer interaction tests (headless Chromium) — `npm test` MUST work without launching the real Electron app

### Window contract (locked)
- Size: 260 × 260 px (square, drag handle at top 30 px implicit)
- Position: persisted in `electron-store` under key `windowPosition`; default top-right with 24 px margin
- Always-on-top with `setAlwaysOnTop(true, 'floating')` (above normal windows; below full-screen overlays)
- `focusable: false` so the window does not steal focus from terminal/IDE
- `type: 'panel'` on macOS (survives Spaces + full-screen)
- `skipTaskbar: true` everywhere; `app.dock.hide()` on macOS
- Transparency: `transparent: true`, `backgroundColor: '#00000000'`
- HTML body: `pointer-events: auto` only on the visible circle + drag handle; rest is `pointer-events: none` so clicks pass through to apps behind

### State machine (mocked in Phase 11)
- `AchillesState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'`
- State transitions driven by:
  - Hotkey press (idle -> listening or listening -> idle depending on mode)
  - Mock timer (listening -> processing after fixture mic stops; processing -> speaking after fixture delay; speaking -> idle after fixture playback)
  - Explicit error injection via `__test_inject_error` IPC (test seam)
- State is owned by main; renderer is a pure projection
- Phase 12 will replace the mock timer with real voice-loop transitions

### Reactive circle
- Centre of the window
- Idle: slow breathing scale `0.95 ↔ 1.05` over 2 seconds, low-opacity ring
- Listening: scale tracks mic RMS amplitude (`0.9 + rms * 0.5`), neon-green glow
- Processing: indeterminate rotating ring (no amplitude), amber tint
- Speaking: scale tracks TTS RMS amplitude, blue glow
- Error: solid red ring + subtle shake (no amplitude)
- Implementation: SVG `circle` with framer-motion (or CSS variables driven by requestAnimationFrame) — pick the cleaner option; both are acceptable
- Phase 11 ships a mocked amplitude stream so the visual is testable without real mic input

### Waveform
- Adjacent to the circle (renders below or to one side; designer's call)
- Bars driven by `AnalyserNode.getByteFrequencyData` — 32 bars, ~20 fps
- Audio source switches: `MediaStreamAudioSourceNode` (mic) during listening; `AudioBufferSourceNode` (TTS) during speaking; silent during idle/processing/error
- Phase 11 mock: stub an AnalyserNode-shaped object that emits a deterministic pattern when the state machine transitions to listening or speaking

### Transcript surface (LOOP-02)
- Below the circle/waveform OR within a collapsible drawer (designer's call — small window, real estate matters)
- Partial transcripts in 70% opacity; committed transcripts in 100%
- Display only — no edit affordance; no copy button in v1.2 (UI is for confirmation, not interaction)
- Auto-fade older transcripts after 15 seconds in idle

### Hotkey (UI-06)
- Default global hotkey: `Cmd+Shift+A` (macOS), `Ctrl+Shift+A` (Windows/Linux) — avoid collision with common terminal/IDE shortcuts
- Configurable via in-app settings (Phase 11 ships a minimal settings popover; full settings UI is acceptable as deferred)
- Press-to-toggle (default): single press transitions idle -> listening; second press transitions listening -> processing (commits utterance)
- Push-to-talk (opt-in): held key keeps listening; release transitions listening -> processing
- Mode switch persisted in `electron-store` under `hotkeyMode`
- Hotkey registration via Electron `globalShortcut`; cleanup on app quit

### macOS mic permission flow (UI-07)
- On window creation, check `systemPreferences.getMediaAccessStatus('microphone')`
- If `not-determined`: defer until first hotkey press; on first press, call `systemPreferences.askForMediaAccess('microphone')`
- If `denied` or `restricted`: render a remediation overlay with explicit copy:
  > "Achilles needs microphone access. Open System Settings -> Privacy & Security -> Microphone and enable Achilles."
- A button labelled "Open System Settings" launches `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
- For Windows/Linux: Phase 11 documents the equivalent path but only the macOS flow is verified

### Persistence (electron-store schema)
- `windowPosition: { x: number, y: number }`
- `hotkeyMode: 'toggle' | 'pushToTalk'`
- `hotkeyKey: string` (Electron accelerator string)
- All other settings (API key, voice ID) deferred to Phase 12 / Phase 13

### IPC contract (consume `@achilles/voice-protocol`)
- Main -> Renderer: `state-changed`, `transcript-partial`, `transcript-committed`, `mic-amplitude` (mocked in Phase 11), `tts-amplitude` (mocked), `permission-state`, `error`
- Renderer -> Main: `request-state`, `register-hotkey`, `open-system-settings`, `update-window-position`, `update-hotkey-config`
- All IPC payloads validated by Zod schemas in `apps/achilles/src/shared/ipc-schemas.ts`
- Preload bridge exposes a typed API via `contextBridge.exposeInMainWorld('achilles', { ... })`

### Testing strategy
- Vitest 2.1.8 for unit tests (pure helpers, state machine reducers, IPC schema validation)
- Playwright for renderer interaction tests — launches headless Chromium against built renderer bundle; asserts the five visible states render with distinct treatments, drag persists position via store mock, hotkey toggle transitions state
- NO real Electron app launch in CI (per user's global rule "never run applications automatically"); Playwright drives the built renderer in isolation
- Test fixtures: mocked amplitude streams (deterministic patterns), mocked state machine transitions

### Build pipeline
- TypeScript strict, no `any`, NodeNext for main + preload, ESNext for renderer
- `electron-vite` for dev/build; production build outputs to `apps/achilles/out/`
- `tsconfig.json` excludes `**/*.test.ts` and `test/**` (Phase 09 CR-06 lesson)
- `src/.gitignore` defensive guard pattern (Phase 09 CR-07 lesson)
- NO code signing in Phase 11 (Phase 13/14 owns notarisation)

### Logging
- `console.log` with `[achilles]` prefix in main; renderer uses `console.debug` with `[achilles-renderer]`
- Never log: mic frames, raw audio buffers, transcripts (could contain sensitive content), API keys (not handled in this phase but defend in depth)

### Claude's Discretion (genuinely flexible)
- CSS styling library choice for the renderer — vanilla CSS modules, Tailwind, or styled-components; pick the lightest that delivers the visual treatment. Recommendation: vanilla CSS modules to keep the bundle tiny
- React state management — useReducer + Context is sufficient; no Redux needed
- Animation library — framer-motion if needed for the breathing/scale animations; otherwise plain CSS transitions
- File-naming inside `apps/achilles/src/` — match repo conventions (kebab-case files, camelCase functions)
- Exact visual styling of the circle + waveform — gradients, glow, color palette. The five states must be visually distinct (jury test) but exact colors are open. Lean monochrome with one accent per state.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/voice-protocol` (shipped Phase 09) — consume IPC envelope types and `assertElevenLabsHost` if needed (not needed in Phase 11 since no live calls)
- `packages/claude-code-bridge` (shipped Phase 10) — Phase 11 does NOT consume directly; Phase 12 wires them together
- `packages/voice-stt`, `packages/voice-tts` (shipped Phase 09) — Phase 11 does NOT consume directly; Phase 12 wires
- `tsconfig.base.json` — already has `@achilles/*` aliases for the wrapper packages; Phase 11 will use them where useful (IPC types from voice-protocol)
- `vitest.workspace.ts` — already has phase-09 and phase-10 projects; Phase 11 adds `phase-11-unit` for vitest and a Playwright project for `apps/achilles`
- `apps/web` (existing Handoff) — Next.js mobile UI; do NOT touch. Phase 11 lives in a NEW directory `apps/achilles`
- `apps/relay`, `apps/bridge` (existing Handoff) — do NOT touch

### Established Patterns
- All Phase 09 / 10 conventions: kebab-case files, camelCase functions, named exports only, NodeNext `.js` import specifiers, Zod for runtime validation, tsconfig excludes test files, src/.gitignore defensive guards

### Integration Points (downstream phases)
- Phase 12 (End-to-End Integration) is the primary consumer. It will:
  - Replace the mocked amplitude stream with `AnalyserNode` driven by real `getUserMedia`
  - Replace the mocked state-machine timer with real STT/Claude/TTS-driven transitions
  - Wire the renderer's audio capture path to `@achilles/voice-stt` STT
  - Wire main's TTS chunk reception path to `@achilles/voice-tts`
  - Bind the embedded companion system prompt to `@achilles/claude-code-bridge`
- Phase 13 (Distribution) packages this app via `electron-builder` for signed installers
- Phase 14 (Hardening) adds latency probe, suspend-resume handling, USB/Bluetooth device-change recovery

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants a "small UI with dynamic circle but also has a wave thing as I speak" — the circle and waveform are co-equal, not a circle with a waveform inside. Two distinct elements.
- The window must NOT take focus when transitioning to `speaking` state — the user is still typing in their terminal while Achilles speaks back. `focusable: false` is the locked path.
- Visual differentiation between the five states must be immediately obvious. A user glancing at the floating window from the corner of their eye should know which state Achilles is in within ~200 ms.
- The hotkey collision survey from research recommended `Cmd+Shift+A` (macOS). Confirm this does not collide with any common app shortcut before locking; if it does, fall back to `Cmd+Option+A`.

</specifics>

<deferred>
## Deferred Ideas

- Voice picker UI (deferred to v1.3 — see VOICE-01)
- Full settings panel with API key entry (Phase 12 / Phase 13 owns the API-key flow)
- Multi-monitor positioning logic beyond "remember last position" (deferred)
- Linux wayland-specific handling (deferred — X11 only in v1.2)
- Windows-specific tray UX (deferred — basic tray + hotkey only in v1.2)

</deferred>
