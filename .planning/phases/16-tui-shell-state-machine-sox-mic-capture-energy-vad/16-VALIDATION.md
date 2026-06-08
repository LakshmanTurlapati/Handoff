---
phase: 16
slug: tui-shell-state-machine-sox-mic-capture-energy-vad
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 (Phase 15 baseline; root-pinned) |
| **Config file** | `apps/achilles-terminal/vitest.config.ts` (Phase 15 — `pool: "forks"`, `environment: "node"`); Phase 16 extends `include` to cover `tests/**/*.test.tsx` |
| **Quick run command** | `npm test --workspace apps/achilles-terminal` |
| **Full suite command** | `npm run typecheck --workspace apps/achilles-terminal && npm run lint --workspace apps/achilles-terminal && npm test --workspace apps/achilles-terminal -- --pool=forks` |
| **Estimated runtime** | ~5-10 seconds for vitest; +typecheck + lint ~5s; total <20s |
| **Ink test renderer** | `ink-testing-library@^4.0.0` (NEW devDep — installed in Wave 0) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace apps/achilles-terminal`
- **After every plan wave:** Run typecheck + lint + test
- **Before `/gsd:verify-work`:** Full suite green under both Bun and Node runtimes via Phase 15's CI matrix
- **Max feedback latency:** 15 seconds (per-task quick command)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-W0-01 | 01 | 0 | (infra) | — | ink-testing-library + ink + react installed; tsconfig + eslint cover `.tsx`; vitest include extended | install + smoke | `npm test --workspace apps/achilles-terminal` (Phase 15 tests still pass) | W0 | pending |
| 16-01-01 | 01 | 1 | CAP-01 | T-16-spawn-args | sox spawn args correct per platform; stdout 'data' produces Int16Array frames; exit code != 0 triggers error transition | unit (mock spawn) | `vitest run tests/audio/mic-sox.test.ts` | W0 | pending |
| 16-01-02 | 01 | 1 | CAP-02, CAP-04 | T-16-env-injection | EWMA noise floor updates; VOICE_THRESHOLD = floor * 3; voice-hold + silence-hold gates fire correctly against fixture; `--debug-vad` emits JSON lines | unit | `vitest run tests/audio/vad-energy.test.ts` | W0 | pending |
| 16-02-01 | 02 | 1 | (port) | — | v1.2 state machine ports verbatim (only import paths changed); muted substate added (Option A from RESEARCH); deterministic transitions verified | unit | `vitest run tests/state/state-machine.test.ts` | W0 | pending |
| 16-03-01 | 03 | 2 | TUI-01, TUI-03, ACC-01, ACC-02 | — | 7×7 blob renders per (amplitude, ring); 5-state colors applied; idle + processing envelope curves match expected at t=0..1200ms; NO_COLOR honored; INK_SCREEN_READER suppresses Blob | unit | `vitest run tests/ui/blob.test.tsx` | W0 | pending |
| 16-03-02 | 03 | 2 | TUI-02 | — | 40-cell braille sparkline renders from known Float32Array(80); canonical bit mapping (dots 1,2,3,7 left col; 4,5,6,8 right col per RESEARCH correction) | unit | `vitest run tests/ui/sparkline.test.tsx` | W0 | pending |
| 16-03-03 | 03 | 2 | TUI-04, CAP-03 | — | Status row truncates transcript to 60 chars; REC tag when transcripts active; MUTED tag when state=muted; `m` key dispatches MUTE_TOGGLE | unit | `vitest run tests/ui/status-row.test.tsx tests/ui/voice-shell.test.tsx` | W0 | pending |
| 16-04-01 | 04 | 3 | TUI-06 | — | isTTY=false OR --plain triggers plain-text mode; emits `[ISO][state] partial` lines; no ANSI escapes | unit + integration | `vitest run tests/cli.test.ts -t "plain"` | W0 | pending |
| 16-04-02 | 04 | 3 | (mock) | — | `--mock` flag activates synthetic amplitude stream; full TUI renders without sox / network; deterministic snapshot | integration | `vitest run tests/cli.test.ts -t "mock"` | W0 | pending |
| 16-05-01 | 05 | 3 | TUI-05 | — | CPU < 10% over 10-minute idle animation on Windows Terminal v1.18 | manual (visual + system monitor) | run `achilles voice --mock` and observe; capture in Phase 20 asciicast | manual | deferred |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

> Wave 0 = files/installs that MUST exist before any test in the verification map can run. Planner will assign these to specific tasks.

- [ ] `apps/achilles-terminal/package.json` — ADD dependencies: `ink@^7.0.5`, `react@^19.2.7`; ADD devDependencies: `ink-testing-library@^4.0.0`, `@types/react@^19.2.17`
- [ ] `apps/achilles-terminal/vitest.config.ts` — extend `test.include` to include `tests/**/*.test.tsx`
- [ ] `apps/achilles-terminal/tsconfig.json` — extend `include` to cover `**/*.tsx` (or verify `*.ts` glob already covers it via TypeScript JSX semantics)
- [ ] `apps/achilles-terminal/eslint.config.js` — ensure `*.tsx` is in `files: ['src/**/*.ts', 'tests/**/*.ts']` glob (extend to include `.tsx`)
- [ ] `apps/achilles-terminal/src/audio/mic-sox.ts` — sox spawn + frame consumer (NEW)
- [ ] `apps/achilles-terminal/src/audio/vad-energy.ts` — EWMA + threshold + hold gates (NEW)
- [ ] `apps/achilles-terminal/src/audio/braille.ts` — pure encoding helpers (NEW)
- [ ] `apps/achilles-terminal/src/state/state-machine.ts` — verbatim port from `apps/achilles/src/main/state-machine.ts` with `muted` substate (NEW)
- [ ] `apps/achilles-terminal/src/state/constants.ts` — port v1.2 timing constants (LISTENING_VAD_DELAY_MS, PROCESSING_DELAY_MS, SPEAKING_DELAY_MS, SPEAKING_DEBOUNCE_MS=300, ERROR_AUTO_DISMISS_MS) (NEW)
- [ ] `apps/achilles-terminal/src/ui/colors.ts` — 5-state palette, NO_COLOR/FORCE_COLOR + INK_SCREEN_READER detection (NEW)
- [ ] `apps/achilles-terminal/src/ui/Blob.tsx` — 7×7 Unicode block component (NEW)
- [ ] `apps/achilles-terminal/src/ui/Sparkline.tsx` — 40-cell braille component (NEW)
- [ ] `apps/achilles-terminal/src/ui/StatusRow.tsx` — state + transcript + REC + MUTED (NEW)
- [ ] `apps/achilles-terminal/src/ui/ScreenReader.tsx` — `<Text aria-label=...>` announcer with debounce (NEW; per RESEARCH A2 — Ink 7 does NOT support `aria-live`, use `aria-label` + `aria-role`)
- [ ] `apps/achilles-terminal/src/ui/VoiceShell.tsx` — root Ink component (NEW)
- [ ] `apps/achilles-terminal/src/ui/plain-text.ts` — plain-text fallback emitter (NEW)
- [ ] `apps/achilles-terminal/src/ui/mock-amplitude.ts` — synthetic stream for `--mock` (NEW)
- [ ] `apps/achilles-terminal/src/cli.ts` — EXTEND existing file to register `achilles voice` subcommand; add `--mock`, `--debug-vad`, `--plain` flags (KEEP existing `--version`/`-v` argv-first branches; do NOT regress INIT-07)
- [ ] `apps/achilles-terminal/tests/ui/blob.test.tsx` — TUI-01, TUI-03, ACC-01, ACC-02 (NEW)
- [ ] `apps/achilles-terminal/tests/ui/sparkline.test.tsx` — TUI-02 (NEW)
- [ ] `apps/achilles-terminal/tests/ui/status-row.test.tsx` — TUI-04 (NEW)
- [ ] `apps/achilles-terminal/tests/ui/voice-shell.test.tsx` — CAP-03 + Ink root smoke (NEW)
- [ ] `apps/achilles-terminal/tests/audio/mic-sox.test.ts` — CAP-01 (NEW)
- [ ] `apps/achilles-terminal/tests/audio/vad-energy.test.ts` — CAP-02, CAP-04 (NEW)
- [ ] `apps/achilles-terminal/tests/audio/braille.test.ts` — pure braille encoder (NEW)
- [ ] `apps/achilles-terminal/tests/state/state-machine.test.ts` — port from v1.2 if compatible + new `muted` substate tests (NEW)
- [ ] `apps/achilles-terminal/tests/cli.test.ts` — EXTEND with TUI-06 plain-mode + `--mock` + `--debug-vad` flag tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CPU < 10% on Windows Terminal v1.18 / iTerm2 / Ghostty / Terminal.app during 10-minute idle animation | TUI-05 | Cannot meaningfully measure CPU usage of a TUI from inside the test process; performance is a host-OS / terminal-emulator-specific concern; captured as part of Phase 20 real-binary asciicast | Operator: run `achilles voice --mock` for 10 minutes in each target terminal; observe CPU via Activity Monitor / Task Manager; record P50/P95 alongside Phase 15 cold-start latency baseline in SUMMARY.md |
| Real-mic CAP-01 visual smoke (sox actually captures, blob actually pulses with real RMS) | CAP-01 | Requires a real microphone + sox installed + a quiet room; not automatable in CI | Operator: install sox via brew/apt/scoop per `15-04-LATENCY-CAPTURE.md` patterns; run `achilles voice --debug-vad`; speak; observe blob pulse + sparkline animate + `--debug-vad` JSON stream to stderr |
| macOS TCC parent-emulator EPERM remediation hint surfaces correctly | (PITFALLS.md §3) | Requires actually denying mic permission to the parent terminal; tested by Phase 18 init wizard's preflight step in CI; Phase 16 only emits the hint | Operator: deny terminal mic permission in System Settings → Privacy & Security → Microphone; run `achilles voice`; verify stderr contains a hint matching `Open System Settings.*Microphone.*<emulator-name>` |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (16 NEW source files + 8 NEW test files + 4 config edits)
- [ ] No watch-mode flags (CI uses `vitest run`, not `vitest`)
- [ ] Feedback latency < 20s for quick command
- [ ] `nyquist_compliant: true` set in frontmatter after planner sign-off

**Approval:** pending
