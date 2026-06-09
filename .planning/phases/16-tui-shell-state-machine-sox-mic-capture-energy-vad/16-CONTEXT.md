# Phase 16: TUI Shell + State Machine + sox Mic Capture + Energy VAD - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Auto-generated (synthesized from .planning/research/FEATURES.md + ARCHITECTURE.md + PITFALLS.md + STACK.md + v1.3-terminal-pivot.md — locked decisions already cover every grey area smart-discuss would surface; remaining choices are implementation details deferred to the planner.)

<domain>
## Phase Boundary

Build the load-bearing visible surface of v1.3 — Ink 7 + React 19 components rendering a 7×7 reactive blob + 40-cell braille sparkline + 5-state-color status row inside the calling terminal, atop a verbatim port of the v1.2 state machine. Spawn `sox` (`rec` on POSIX, `sox.exe` on win32) for 16k mono PCM and wire an energy-threshold VAD with adaptive EWMA so the input gate is shippable without a push-to-talk hotkey. All four voice packages (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`) and `packages/achilles-skill/skill/prompts/companion.md` stay byte-for-byte unchanged (LOOP-02 invariant — any phase needing to touch them is a roadmap red flag).

Inside scope:
- `apps/achilles-terminal/src/ui/` — `VoiceShell.tsx` (root component), `Blob.tsx` (7×7 Unicode block grid), `Sparkline.tsx` (40-cell braille rolling waveform), `StatusRow.tsx` (state + transcript line + REC tag + MUTED indicator)
- `apps/achilles-terminal/src/ui/colors.ts` — 5-state palette (idle gray, listening green, processing yellow, speaking blue, error red); NO_COLOR + FORCE_COLOR + INK_SCREEN_READER + plain-text fallback wiring
- `apps/achilles-terminal/src/ui/screen-reader.tsx` — `<Text aria-live="polite">` announcer with per-state wording
- `apps/achilles-terminal/src/state/state-machine.ts` — verbatim port of v1.2 state machine (idle/listening/processing/speaking/error/muted) with the SPEAKING_DEBOUNCE_MS = 300 constant + half-duplex enforcement
- `apps/achilles-terminal/src/audio/mic-sox.ts` — `child_process.spawn("rec", [...])` / `spawn("sox.exe", [...])` producing Int16Array frames at 16kHz
- `apps/achilles-terminal/src/audio/vad-energy.ts` — adaptive EWMA noise floor (α=0.05), VOICE_THRESHOLD = noiseFloor * 3, 60ms voice-hold, 300ms silence-hold, ≥300ms minimum-utterance-length floor, self-trigger guard during TTS playback
- `apps/achilles-terminal/src/cli.ts` — extend with `achilles voice` subcommand registration (commander already wired in Phase 15); add `--mock`, `--debug-vad`, `--plain` flags; argv parse still precedes any pipeline-boot module load (INIT-07 invariant — extends from Phase 15)
- Mock-amplitude stream for `--mock` mode that lets `achilles voice --mock` render the full TUI without needing sox / mic / network
- Tests: `tests/ui/blob.test.tsx`, `tests/ui/sparkline.test.tsx`, `tests/ui/status-row.test.tsx`, `tests/audio/vad-energy.test.ts` (deterministic RMS-fixture replay), `tests/state/state-machine.test.ts` (port v1.2 fixtures verbatim if compatible), and `tests/cli.test.ts` extensions for the new flags
- The 5-state color mapping table + screen-reader wording table are committed to source as exported constants so downstream phases (Phase 17 wires it, Phase 20 audits it) can import without duplicating strings

Outside scope (defer to later v1.3 phases):
- `voice-stt`/`voice-tts`/`claude-code-bridge` integration (Phase 17 — the end-to-end loop)
- session.ts port (Phase 17)
- ffplay TTS sink (Phase 17)
- Ctrl-C cancel chain through claude-code-bridge (Phase 17 — only TUI-side SIGINT handler in Phase 16)
- Init wizard / API key resolution / ambient calibration (Phase 18)
- Single-instance lock (Phase 18)
- npm publish (Phase 19); macOS codesign / Apple Developer ID OUT OF SCOPE per the v1.3 Option 3 lock — macOS ships via JS-fallback bundle under Bun runtime
- Real-binary asciicasts (Phase 20)

</domain>

<decisions>
## Implementation Decisions

### Pre-locked architecture (from milestone research — DO NOT relitigate)

**Stack pins (STACK.md HIGH-confidence):**
- Ink 7.x (current stable; supports React 19, `useIsScreenReaderEnabled`, `useInput` hooks)
- React 19.x (matches Ink 7's peer dep)
- chalk 5.x (already in v1.2 monorepo; ESM, NO_COLOR-aware natively)
- vitest 2.1.8 (root-pinned; Phase 15 established the workspace config)
- TypeScript 5.7.3, NodeNext ESM, target ES2024 (Phase 15 lock)
- `@types/node` 22.10.5 for `child_process.spawn` types

**Visual surface (FEATURES.md §Visual Reference + v1.3-terminal-pivot.md §4):**
- Blob: 7×7 grid of Unicode block characters U+2580-U+259F; intensity ramp computed from amplitude (0.0-1.0) → block-char index lookup table
- Sparkline: 40 cells × 2 samples per cell = 80-sample rolling RMS history; braille U+2800-U+28FF mapping (dots 1-4 = upper half, 5-8 = lower half)
- Render rate: 20fps (50ms `setInterval` driving a `tick` state in `VoiceShell.tsx`); Ink coalesces React updates so reconciliation is not the bottleneck
- Idle breathing curve: amplitude = 0.3 + 0.1·sin(t/600) — period 1.2s, range [0.2, 0.4]
- Processing pulse curve: amplitude = 0.5 + 0.3·sin(t/200) — period 0.4s, range [0.2, 0.8]
- Listening: amplitude = live mic RMS (clamped 0-1)
- Speaking: amplitude = live TTS amplitude scalar (provided by voice-tts events$ in Phase 17 — Phase 16 stub returns 0)

**State machine (verbatim port from v1.2):**
- 6 states: `idle`, `listening`, `processing`, `speaking`, `error`, `muted` (substate of idle — VAD off, sox still running so unmute is instant)
- Transitions match v1.2's existing `state-machine.ts` — port the file as-is, only modifying import paths to reference Phase 16's audio/UI modules
- SPEAKING_DEBOUNCE_MS = 300 (half-duplex enforcement constant — prevents listening transition until 300ms after TTS playback ends)
- Self-trigger guard: VAD must not fire `speech_start` while state machine is in `speaking` (suppress at VAD layer, NOT state machine layer — keeps state machine pure)

**VAD parameters (CAP-02 + CAP-04 from roadmap):**
- Adaptive EWMA noise floor: `noiseFloor = α * frameRMS + (1 - α) * noiseFloor`, α = 0.05
- VOICE_THRESHOLD = noiseFloor * 3 (3× ratio empirically validated in v1.2-terminal-pivot.md research)
- Voice-hold: 60ms (3 frames at 20ms hop)
- Silence-hold: 300ms (15 frames at 20ms hop)
- Minimum utterance length: 300ms (15 frames)
- All four (`voice_threshold`, `silence_threshold`, `voice_hold_ms`, `silence_hold_ms`) overridable via `~/.achilles/settings.json` — Phase 18 owns the settings store; Phase 16 reads via a stub `loadSettings()` that returns defaults if the file is absent
- `--debug-vad` flag streams `{t, energy, noiseFloor, threshold, state}` JSON lines to stderr at 50ms cadence

**Mic capture (CAP-01):**
- macOS/Linux command: `rec -q -t raw -r 16000 -b 16 -e signed -c 1 -` (stdout = raw s16le PCM)
- Windows command: `sox.exe -q -d -t raw -r 16000 -b 16 -e signed -c 1 -` (uses `-d` default device flag)
- Frame size: 320 samples (20ms at 16kHz) — read from sox stdout in 640-byte chunks (320 × 2 bytes per Int16)
- Backpressure: if VAD consumer falls behind, drop frames silently (do NOT buffer indefinitely; mic latency >50ms is user-visible)
- Detect parent terminal emulator on macOS EPERM at sox-spawn time and emit a per-emulator remediation hint to stderr — `process.ppid` → `ps -p $PPID -o comm=` lookup (see PITFALLS.md §3). This is a *hint emission*; actual permission resolution is the operator's job (Phase 18 init wizard tests it earlier)

**Accessibility (ACC-01, ACC-02):**
- `NO_COLOR` env var (any value) → chalk falls back to no-color naturally; verify by asserting `chalk.green("x") === "x"` when `NO_COLOR=1`
- `FORCE_COLOR` env var (any value) → chalk uses colors even when `process.stdout.isTTY === false`
- Screen-reader detection: prefer Ink's `useIsScreenReaderEnabled()` hook; fall back to checking `process.env.INK_SCREEN_READER === "1"`
- Screen-reader output: suppress `<Blob>` and `<Sparkline>` (don't render them at all — not just hide); emit one `<Text aria-live="polite">` per state transition with explicit wording from a per-state lookup table
- Per-state screen-reader wording table (lock these strings now):
  - idle: "Achilles ready."
  - listening: "Achilles listening."
  - processing: "Achilles processing your request."
  - speaking: "Achilles speaking."
  - error: "Achilles encountered an error."
  - muted: "Achilles muted."

**Mute control (CAP-03):**
- Key: `m` (lowercase) — captured via Ink's `useInput((input) => { if (input === "m") toggleMute(); })`
- Behavior: toggles VAD on/off; sox keeps running (so unmute is instant); state machine transitions to `muted` substate; status row shows literal text "MUTED" in a bright-red bracketed tag
- Survives session: setting persists in-memory only (Phase 16 has no settings persistence — Phase 18 wires that)

**Plain-text fallback (TUI-06):**
- Auto-trigger when `process.stdout.isTTY === false` OR `--plain` flag present
- Render mode: plain log lines of state transitions + partial transcripts, no ANSI escapes, no Ink components
- Format: `[YYYY-MM-DDTHH:MM:SSZ] [state] partial-transcript`

**Performance budget (TUI-05):**
- <10% CPU on Windows Terminal v1.18, iTerm2, Ghostty, Terminal.app during 10-minute animation
- Strategy: avoid per-tick string allocations; pre-compute the block-character intensity lookup as a const; the 80-sample sparkline reuses a Float32Array ring buffer

**Mock-amplitude stream (`--mock` flag):**
- For `achilles voice --mock`: replace `mic-sox.ts` with a synthetic generator that emits frames at the same 20ms cadence producing a sin-wave + noise amplitude pattern, so the full TUI surface can be exercised without sox / mic / network
- This is the test surface for TUI-01..04 (success criterion 1 in the roadmap — `achilles voice --mock` renders everything visible)

### Claude's Discretion (planner-level)

- Exact `Float32Array` ring-buffer implementation detail (vs. plain rotating array) — measure both
- Whether `Blob.tsx` uses a single `<Text>` with newlines or 7 separate `<Box>` rows (Ink's reconciler may prefer one or the other)
- Exact braille-cell encoding helper (closed-form bit math vs. lookup table)
- Test fixture format for the deterministic VAD replay test (JSON stream vs. raw PCM file checked into the repo)
- Whether the v1.2 state-machine fixtures port cleanly — try first; if any fail under the new module boundaries, replace with fresh deterministic tests
- Whether to expose `--frames` flag for offline waveform replay in `--mock` mode (useful for debugging but not strictly required by roadmap)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone research (locked architecture and design choices)
- `.planning/research/FEATURES.md` — Visual surface, VAD design, color palette, screen-reader behavior, mute control (TABLE STAKES section is load-bearing)
- `.planning/research/ARCHITECTURE.md` — System overview, in-process boundaries, ownership of mic-sox + vad-energy + ui/ surfaces, Phase 16 build order
- `.planning/research/PITFALLS.md` — §1 silent-launch replay (the structural failure Phase 16 must prevent), §3 macOS TCC, §5 Bun stdout flush (relevant to mic-sox stdin drain), §6 Ink reconciliation at 20fps
- `.planning/research/STACK.md` — Ink 7 + React 19 + chalk 5 pins, vitest 2.1.8 baseline
- `.planning/research/v1.3-terminal-pivot.md` — §4 the new visible surface, §5 the new capture surface, §6 the new state machine

### Phase 15 outputs (must respect or extend)
- `apps/achilles-terminal/package.json` — Phase 15 established `name: "achilles-terminal"`, ESM, bin shape, vitest scripts; Phase 16 must NOT change name or root scripts
- `apps/achilles-terminal/src/cli.ts` — Phase 15 established argv-first parse + fatal handlers; Phase 16 EXTENDS by adding `achilles voice` subcommand (do not move existing `--version` / `-v` branches)
- `apps/achilles-terminal/eslint.config.js` — Phase 15 lint baseline; Phase 16 honors it (no relaxation of `recommendedTypeChecked` on `src/**` + `tests/**`)
- `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-DEVIATIONS.md` — D-15-01 (package name renamed), D-15-02 (npm install needs `--include=optional --force`); Phase 16 CI workflow does not exist (Phase 15 owns it) but Phase 16 adds tests to the existing matrix

### LOOP-02 invariant sources
- `packages/voice-protocol/`, `packages/voice-stt/`, `packages/voice-tts/`, `packages/claude-code-bridge/` — surface APIs Phase 16 must NOT import yet (Phase 17 wires them). Phase 16 stubs the seams via DI interface shapes.
- `packages/achilles-skill/skill/prompts/companion.md` — byte-for-byte preserved

### Project-level rules (from .planning/PROJECT.md + ~/.claude/CLAUDE.md)
- No emojis in any file (terminal output, source code, README, comments, commit messages) — strict
- No auto-running applications — tests in vitest/CI are OK; do NOT launch `achilles voice` from any task to "verify visually"
- Browser automation via FSB MCP — not applicable here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/voice-protocol/` — defines the `RuntimeEvent` shapes Phase 17 will wire; Phase 16 uses ONLY the type imports from this package (compile-time only, zero runtime touches) to ensure the state machine's transition signatures align with what session.ts will dispatch in Phase 17
- v1.2 `apps/achilles/src/renderer/state-machine.ts` (if it exists — confirm before porting) — verbatim port candidate; the legacy file lives under the soon-to-be-deleted v1.2 Electron app, so the port creates `apps/achilles-terminal/src/state/state-machine.ts` and the legacy file stays untouched until Phase 19 deletes the whole v1.2 surface
- v1.2 `apps/achilles-cli/src/commands/launch.ts` — anti-pattern reference (`stdio: "ignore"` on the launch path, what PITFALLS.md §1 silent-launch is about); Phase 16 must NOT replicate this shape

### Established Patterns
- ESM with `.js` import specifiers (NodeNext)
- vitest under `--pool=forks` (Pitfall 9 — threads pool incomplete under Bun)
- `setInterval`-driven render ticks (rather than `requestAnimationFrame`) — Ink runs in Node/Bun, no rAF available
- Configuration via `~/.achilles/settings.json` — JSON-only, no YAML, no TOML; Phase 16 reads with a stub loader that returns defaults if absent

### Integration Points
- `apps/achilles-terminal/src/cli.ts` — Phase 16 registers `achilles voice` subcommand here using the commander instance already imported in Phase 15
- `apps/achilles-terminal/package.json` — Phase 16 ADDS `ink`, `react` (and `@types/react`) to dependencies; DOES NOT modify the existing 5 sibling `optionalDependencies` entries; ADDS no new workspace devDeps beyond what's needed for testing (`ink-testing-library`)
- `apps/achilles-terminal/vitest.config.ts` — already configured with `pool: "forks"`; Phase 16 may need to extend `test.environment` if Ink testing requires `jsdom` (likely NOT — Ink's testing library is its own renderer, runs in node env)
- `apps/achilles-terminal/eslint.config.js` — already extends `recommendedTypeChecked` for `src/**` + `tests/**`; Phase 16's new `.tsx` files fall under this scope (the type-checked block must include `*.tsx` — verify; Phase 15 baseline used `src/**/*.ts` literally, may need to broaden)

</code_context>

<specifics>
## Specific Ideas

- The blob's 7×7 intensity ramp uses a CENTER-WEIGHTED kernel: center cell intensity = amplitude × 1.0, ring 1 (12 cells) = amplitude × 0.75, ring 2 (12 cells) = amplitude × 0.5, ring 3 (12 cells) = amplitude × 0.25. This avoids the "all 49 cells switch at once" flicker that a flat-amplitude render would produce.
- The sparkline ring buffer is a single `Float32Array(80)` with a `writeIndex` cursor that wraps; render walks the array from `writeIndex+1` to `writeIndex` (oldest to newest left-to-right), pairing samples 0+1, 2+3, ..., 78+79 into 40 braille cells.
- The screen-reader announcer is debounced at 200ms — rapid state transitions (idle → listening → idle within 100ms because of a noise spike) emit only the latest state, not every intermediate.
- The `--debug-vad` JSON-line format is exactly `{"t":1717840000000,"energy":0.012,"noiseFloor":0.003,"threshold":0.009,"state":"listening"}` — one per 50ms tick. Designed to be `tail -f`-able and `jq`-greppable.
- The mock-amplitude stream emits a 1.5s "speech-like" amplitude pattern (rising envelope 0-0.7-0-0.5-0.3-0-0 over 30 frames) followed by 1.5s silence (random noise at 0.02 amplitude), repeating. The pattern is deterministic (seeded PRNG) so vitest snapshots are stable.
- The v1.2 mock amplitude stream (in `apps/achilles/src/main/index.ts:328` — the silent-launch failure mode) is NOT a reusable reference; it's the negative example. Phase 16's `--mock` produces actually-visible behavior because the orchestrator state machine + render loop are wired correctly.

</specifics>

<deferred>
## Deferred Ideas

- silero-vad swap behind the same `VadHandle` interface — v1.4
- Per-utterance audio file rotation in `~/.achilles/transcripts/` — Phase 18 (transcripts feature)
- Persistent `~/.achilles/latency/` JSON for cold-start P50/P95 — Phase 18 (DIST-05 is a Phase 15 manual capture for the v1.3 baseline)
- Real `voice-stt` / `voice-tts` / `claude-code-bridge` wiring — Phase 17 (end-to-end voice loop)
- Inline error banner above the Ink region for caught exceptions — Phase 19 (hardening polish, ERR-01)
- VS Code Integrated Terminal worst-case TCC validation — Phase 20 (real-binary asciicast under macOS Sequoia 15.4+)
- Suspend/resume device hot-swap handling — Phase 19/20 (ERR-05/06, validated against published binary)

</deferred>
