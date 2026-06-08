# Phase 16: TUI Shell + State Machine + sox Mic Capture + Energy VAD - Research

**Researched:** 2026-06-08
**Domain:** Ink 7 + React 19 terminal UI rendering a 7x7 amplitude blob + 40-cell braille sparkline, atop a verbatim port of the v1.2 state machine, with sox child for 16k mono PCM capture and energy-EWMA VAD as the input gate
**Confidence:** HIGH for stack pins (verified against npm registry + Ink 7 official readme + slopcheck); HIGH for state-machine port feasibility (v1.2 source read end-to-end); MEDIUM for several IMPLEMENTATION CONSTANTS THAT DIVERGE FROM CONTEXT.md (see Assumptions Log — three concrete divergences flagged for planner attention)

## Summary

The Phase 16 milestone research (FEATURES.md / ARCHITECTURE.md / PITFALLS.md / STACK.md / 16-CONTEXT.md) covers ~95% of what the planner needs. This phase-level research closes the remaining 5%: it verifies the v1.3 milestone assumptions against the **actual Ink 7.0.5 README as of 2026-05-29**, the **actual v1.2 state-machine source** sitting at `apps/achilles/src/main/state-machine.ts`, and the **actual Phase 15 outputs** sitting in `apps/achilles-terminal/`. The investigation surfaces **three concrete divergences** between CONTEXT.md and the real Ink 7 API that the planner must reconcile before locking task contracts.

**Primary recommendation:** Honor every locked decision in 16-CONTEXT.md, but treat three specific clauses as Claude's-discretion-with-research-input rather than locked: (1) the `INK_SCREEN_READER === "1"` check must become `=== "true"` to match Ink 7's documented default; (2) `<Text aria-live="polite">` is not a supported Ink 7 ARIA attribute and must be replaced with an `<Static>`-or-state-driven announcer pattern; (3) the `useInput` Ctrl-C handler in CAP-03 (`m` key) must NOT pass `exitOnCtrlC: false` to the root `render()` call, or SIGINT propagation for Phase 17's cancel chain breaks structurally.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

The following decisions are LOCKED by 16-CONTEXT.md `<decisions>` and MUST be honored by the planner verbatim:

**Stack pins:**
- Ink 7.x, React 19.x, chalk 5.x
- vitest 2.1.8 (Phase 15 baseline)
- TypeScript 5.7.3, NodeNext ESM, ES2024 target
- `@types/node` 22.10.5

**Visual surface:**
- Blob: 7x7 grid of Unicode block characters U+2580-U+259F; center-weighted intensity ramp (center = 1.0, ring 1 = 0.75, ring 2 = 0.5, ring 3 = 0.25)
- Sparkline: 40 cells x 2 samples per cell = 80-sample rolling RMS history; braille U+2800-U+28FF
- Render rate: 20fps (50ms `setInterval` driving a `tick` state in `VoiceShell.tsx`)
- Idle breathing curve: amplitude = 0.3 + 0.1*sin(t/600)
- Processing pulse curve: amplitude = 0.5 + 0.3*sin(t/200)
- Listening: amplitude = live mic RMS (clamped 0-1)
- Speaking: amplitude = 0 in Phase 16 (Phase 17 wires real TTS amplitude)

**State machine:**
- Verbatim port of v1.2 with import paths only adjusted
- 6 states: idle, listening, processing, speaking, error, muted
- SPEAKING_DEBOUNCE_MS = 300
- Self-trigger guard at VAD layer, NOT state machine layer

**VAD parameters:**
- Adaptive EWMA noise floor, alpha = 0.05
- VOICE_THRESHOLD = noiseFloor * 3
- Voice-hold: 60ms (3 frames at 20ms hop)
- Silence-hold: 300ms (15 frames at 20ms hop)
- Minimum utterance length: 300ms (15 frames)
- All four thresholds overridable via `~/.achilles/settings.json` (Phase 18 owns settings; Phase 16 reads via stub)
- `--debug-vad` flag streams JSON lines to stderr at 50ms cadence

**Mic capture (sox):**
- macOS/Linux: `rec -q -t raw -r 16000 -b 16 -e signed -c 1 -`
- Windows: `sox.exe -q -d -t raw -r 16000 -b 16 -e signed -c 1 -`
- Frame size: 320 samples (20ms at 16kHz) = 640-byte chunks
- Backpressure: drop frames silently if VAD consumer falls behind

**Accessibility (ACC-01, ACC-02):**
- `NO_COLOR` env var (any value) -> chalk falls back to no-color
- `FORCE_COLOR` env var (any value) -> chalk uses colors even when isTTY is false
- Screen-reader detection via Ink hook + fallback to env var
- Per-state screen-reader wording table locked (see CONTEXT.md)

**Mute control (CAP-03):**
- Key: `m` (lowercase) via `useInput`
- Sox keeps running; VAD off; state -> `muted` substate
- In-memory only (Phase 16 has no settings persistence)

**Plain-text fallback (TUI-06):**
- Trigger when `process.stdout.isTTY === false` OR `--plain` flag
- Format: `[YYYY-MM-DDTHH:MM:SSZ] [state] partial-transcript`

**Performance budget (TUI-05):**
- <10% CPU on Windows Terminal v1.18, iTerm2, Ghostty, Terminal.app during 10-minute animation

**Mock mode (`--mock` flag):**
- Replaces `mic-sox.ts` with synthetic generator at 20ms cadence
- Used by Phase 16 success criterion 1 (visible TUI without sox/mic/network)

**LOOP-02 invariant:**
- `voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`, `companion.md` MUST stay byte-for-byte unchanged

### Claude's Discretion (planner-level)

Per CONTEXT.md `<decisions>` final block:
- Exact `Float32Array` ring-buffer implementation vs plain rotating array
- Whether `Blob.tsx` uses single `<Text>` with newlines or 7 separate `<Box>` rows
- Exact braille-cell encoding helper (closed-form bit math vs lookup table)
- Test fixture format for deterministic VAD replay
- Whether v1.2 state-machine fixtures port cleanly
- Whether to expose `--frames` flag for offline waveform replay

### Deferred Ideas (OUT OF SCOPE)

Per CONTEXT.md `<deferred>`:
- silero-vad swap behind same `VadHandle` interface (v1.4)
- Per-utterance audio file rotation in `~/.achilles/transcripts/` (Phase 18)
- Persistent `~/.achilles/latency/` JSON (Phase 18)
- Real `voice-stt` / `voice-tts` / `claude-code-bridge` wiring (Phase 17)
- Inline error banner above the Ink region (Phase 19, ERR-01)
- VS Code Integrated Terminal worst-case TCC validation (Phase 20)
- Suspend/resume device hot-swap (Phase 19/20, ERR-05/06)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUI-01 | 7x7 Unicode block-char reactive blob pulsing with mic RMS / TTS amplitude | Architectural Responsibility Map row 1; Code Examples §"Block ramp + center-weighted kernel"; Pitfall replay §"Ink reconciliation thrash" + perf budget verification |
| TUI-02 | 40-cell braille sparkline waveform, 80-sample rolling RMS history | Code Examples §"Braille bit encoding (CORRECTED from CONTEXT.md)"; Architectural Responsibility Map row 2 |
| TUI-03 | 5 distinct state colors with idle breathing + processing pulse envelopes | Standard Stack `chalk@^5.6.2` (NO_COLOR-aware natively); Code Examples §"5-state color table as exported const" |
| TUI-04 | Single status row beneath visual surface: `[state] <last 60 chars of transcript>` with REC tag when `--save-transcripts` is active | Architectural Responsibility Map row 3; integration with Phase 18's transcript-store stub |
| TUI-05 | 20fps render with <10% CPU on Windows Terminal v1.18 / iTerm2 / Ghostty / Terminal.app over 10-minute animation | Standard Stack `ink@7.0.5` + Common Pitfalls §"Pitfall 1: Ink reconciliation thrash" with concrete budget gate |
| TUI-06 | Auto-degrade to plain-text log lines when `!process.stdout.isTTY` OR `--plain` flag | Code Examples §"TTY detection precedence under Bun-compile vs Node fallback vs piped output"; Common Pitfalls §"Pitfall 4: Bun stdout flush" |
| ACC-01 | Honor `NO_COLOR` and `FORCE_COLOR` env vars | Standard Stack `chalk@^5.6.2` (handled natively); Code Examples §"NO_COLOR / FORCE_COLOR / INK_SCREEN_READER precedence" |
| ACC-02 | Detect screen readers via `INK_SCREEN_READER` env var or `useIsScreenReaderEnabled()` hook; suppress blob+sparkline, emit state-change announcements + transcripts | Architectural Responsibility Map row 4; **CRITICAL DIVERGENCE flagged in Assumptions Log A1, A2** — Ink 7 docs use `=== "true"` not `=== "1"`, and `aria-live="polite"` is NOT a supported Ink 7 ARIA attribute |
| CAP-01 | Mic captured via `sox` child process producing 16k mono s16le frames | Code Examples §"sox child spawn under Bun child_process node-compat"; Architectural Responsibility Map row 5 |
| CAP-02 | Speech start/end detected by energy-threshold VAD with adaptive EWMA + 60ms voice-hold + 300ms silence-debounce + self-trigger guard during TTS playback | Code Examples §"EWMA bootstrap pattern with warmup"; Common Pitfalls §"Pitfall 5: EWMA cold-start poisoning" |
| CAP-03 | User presses `m` to mute (toggles VAD off without exiting); visibly indicated in status row | Code Examples §"useInput `m` key WITHOUT swallowing Ctrl-C"; **CRITICAL DIVERGENCE A3** — Phase 16 must NOT set `exitOnCtrlC: false`, see Common Pitfalls §"Pitfall 6: Ink Ctrl-C interception" |
| CAP-04 | VAD thresholds (`voice_threshold`, `silence_threshold`, `voice_hold_ms`, `silence_hold_ms`) overridable via `~/.achilles/settings.json`; `--debug-vad` flag prints per-frame energy | Code Examples §"Settings loader stub with default fallback"; Architectural Responsibility Map row 6 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 7x7 blob render (TUI-01) | UI / Ink reconciler | Orchestrator (provides amplitude scalar) | Blob is a pure projection of `amplitude: number` -> 49 chars; orchestrator owns the source of `amplitude`, UI owns the projection. Keeps blob testable in isolation via `ink-testing-library`. |
| 40-cell sparkline (TUI-02) | UI / Ink reconciler | Orchestrator (provides RMS ring buffer) | Same pattern as blob: orchestrator pushes RMS samples into a `Float32Array(80)` ring buffer; UI projects to braille on each tick. |
| State color + status row (TUI-03, TUI-04) | UI / Ink reconciler | Orchestrator (state machine + STT transcript-partial events stub in Phase 16) | UI subscribes to `session.on("state-change")` and `session.on("transcript-partial")` via `useSyncExternalStore`. |
| Screen-reader mode (ACC-02) | UI / Ink renderer | Orchestrator (state transitions only) | Detection at render-tree root; suppression at component level. Orchestrator unchanged — same events, different rendering. |
| sox child mic capture (CAP-01) | Audio I/O (child process) | Orchestrator (consumes Int16Array frames) | sox lives outside the JS process; orchestrator owns the `proc.stdout.on("data", ...)` listener. NOT a UI tier concern. |
| VAD adaptive EWMA (CAP-02, CAP-04) | Pure JS module (no I/O) | Orchestrator (state transitions on speech_start / speech_end) | VAD is a function of `(rms, dt) -> "speech_start" \| "speech_end" \| null`. Pure and testable. Self-trigger guard parameter passed in by orchestrator (`vad.setMuted(true)` during `state === "speaking"`). |
| Mute toggle (CAP-03) | UI / Ink useInput hook | Orchestrator (state machine `muted` substate) | UI captures `m` keypress; calls `session.toggleMute()`; orchestrator dispatches state transition + flips VAD active flag. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `^7.0.5` | React renderer for the terminal | Phase 16's load-bearing dependency. Verified on npm registry 2026-05-29 release. Peer deps: `react>=19.2.0`, `@types/react>=19.2.0`, `react-devtools-core>=6.1.2`. Engines: `node>=22`. [CITED: github.com/vadimdemedes/ink readme] |
| `react` | `^19.2.7` | Ink's peer (consumed via `react-reconciler` under the hood) | Verified on npm registry 2026-06-01 release. Required by Ink 7. Phase 16 does NOT install `react-dom` (Ink uses Yoga + ANSI as its host config). [CITED: npm view ink peerDependencies] |
| `@types/react` | `^19.2.17` | TS types matching React 19 | Latest as of 2026-06-08. Required by Ink 7's type surface. [VERIFIED: npm view @types/react version] |
| `chalk` | `^5.6.2` | ANSI color helpers (NO_COLOR aware natively) | Phase 15 baseline established the ESM-only constraint; chalk 5.6.x is the matching series. Verified on npm registry. Natively respects `NO_COLOR` and `FORCE_COLOR`. [VERIFIED: npm view chalk version] |
| `ink-testing-library` | `^4.0.0` | Test renderer for Ink components | The official testing library named in Ink 7's readme. Version 4.0.0 published 2024-05-22; only peer dep is `@types/react>=18.0.0` which Phase 16's `@types/react@19.x` satisfies. Runs in node env (no jsdom) and is compatible with vitest 2.x `pool: "forks"`. [CITED: ink readme + npm view ink-testing-library peerDependencies] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `commander` | `^13.1.0` (already in Phase 15 package.json) | Subcommand routing — Phase 16 extends with `voice` subcommand, `--mock`, `--debug-vad`, `--plain` flags | EXTEND, do not replace — Phase 15 owns the surface. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ink@7.0.5` | `ink@6.8.0` (last 6.x line, 2026-02-19) | The v1.3-terminal-pivot.md research referenced Ink 6 but STACK.md + PROJECT.md decisions table both supersede with Ink 7. Ink 7 brings React 19 + `useEffectEvent` (re-subscription fix) which is exactly the pattern the 20fps render budget needs. Stay on Ink 7. |
| `ink-testing-library@4.0.0` | hand-rolled Ink stdout capture | The library is unmaintained-ish (last release 2024-05) but works fine with Ink 7 because its API surface is `render() -> { lastFrame, frames, rerender, unmount }` which has been stable since 2.x. No alternative actively maintained as of 2026-06. |
| in-process `setInterval(50ms)` driving render tick | `process.nextTick` + manual frame scheduling | Ink coalesces React state updates; the `setInterval` approach is what the v1.3 pivot research validates and matches Claude Code's own Ink rendering pattern. |

**Installation:**
```bash
# From apps/achilles-terminal/
bun add ink@^7.0.5 react@^19.2.7
bun add -d @types/react@^19.2.17 ink-testing-library@^4.0.0
# chalk + ink-testing-library both ESM-only; package.json is already `"type": "module"`
```

**Version verification (run 2026-06-08):**
```
npm view ink version              -> 7.0.5  (published 2026-05-29)
npm view ink engines              -> { node: '>=22' }
npm view ink peerDependencies     -> react>=19.2.0, @types/react>=19.2.0, react-devtools-core>=6.1.2
npm view react version            -> 19.2.7 (published 2026-06-01)
npm view @types/react version     -> 19.2.17
npm view chalk version            -> 5.6.2
npm view ink-testing-library version  -> 4.0.0  (published 2024-05-22)
```

All pins are CURRENT as of the research date.

## Package Legitimacy Audit

slopcheck 0.6.1 was successfully installed during this research session and the following packages were verified against the npm registry on 2026-06-08:

| Package | Registry | Age | Downloads (proxy) | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------------|-------------|-----------|-------------|
| `ink` | npm | 6+ yrs (7.0.5 in May 2026) | ~900K weekly (per Ink 7 readme citation in STACK.md) | github.com/vadimdemedes/ink | [OK] | Approved |
| `react` | npm | 11+ yrs (19.2.7 in June 2026) | very high | github.com/facebook/react | [OK] | Approved |
| `@types/react` | npm | DefinitelyTyped, many years | very high | github.com/DefinitelyTyped/DefinitelyTyped | [OK] | Approved |
| `ink-testing-library` | npm | ~5 yrs (4.0.0 May 2024) | thousands weekly | github.com/vadimdemedes/ink-testing-library | [OK] | Approved |
| `chalk@5.6.x` (already in workspace lineage) | npm | many years, ESM-only since 5.0.0 | very high | github.com/chalk/chalk | [OK] | Approved |
| `commander@13.x` (Phase 15 baseline) | npm | many years | very high | github.com/tj/commander.js | not re-checked (Phase 15 lock) | Inherited |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

All Phase 16 package recommendations are tagged `[VERIFIED: npm registry + Ink 7 official readme + slopcheck OK]`.

## Architecture Patterns

### System Architecture Diagram

```
                       achilles voice (Phase 16 surface)
                                |
                                v
+--------------------------------------------------------------+
|  cli.ts (Phase 15 base, Phase 16 EXTENDS)                    |
|    INIT-07: argv parse FIRST (--version, -v)                 |
|    Phase 16 adds: voice subcommand, --mock, --debug-vad,     |
|                    --plain                                   |
+--------------------------------------------------------------+
                                |
                                v
+--------------------------------------------------------------+
|  Composition root (apps/achilles-terminal/src/session.ts)    |
|  Owns: state machine, half-duplex gate, EventEmitter         |
|  Phase 16: stubs voice-stt / voice-tts / claude-code-bridge  |
|            seams (DI interface shapes only, no runtime)      |
+--------------------------------------------------------------+
       |                |                  |                |
       v                v                  v                v
+---------------+ +-------------+  +-------------+  +-------------+
| mic-sox.ts    | | vad-energy  |  | state-      |  | useAchilles |
| sox child     | | EWMA noise  |  | machine.ts  |  | State hook  |
| (or mock      | | floor       |  | (verbatim   |  | (useSync-   |
| amplitude     | | + hysteresis|  | port from   |  | External-   |
| if --mock)    | |             |  | v1.2)       |  | Store)      |
+-------+-------+ +------+------+  +------+------+  +------+------+
        |                |                |                |
        | Int16Array     | speech_start / |  state-        |  state-
        | frames @ 20ms  | speech_end     |  change        |  change
        |                | events         |  emits         |  subscribes
        |                v                v                |
        | RMS scalar +---+------+    +----+------+         |
        +------------>|orchestr.|--->| Event-    |---------+
                      |dispatch |    | Emitter   |
                      +---------+    +-----------+
                                            |
                                            v
                              +-----------------------------+
                              | Ink VoiceShell.tsx (root)   |
                              |  - Blob.tsx (7x7 grid)      |
                              |  - Sparkline.tsx (40 cells) |
                              |  - StatusRow.tsx            |
                              |  - screen-reader.tsx        |
                              |    (suppresses Blob/Spark   |
                              |     when SR active)         |
                              +-----------------------------+
                                            |
                                            v
                            stdout TTY (raw mode via Ink)
                            OR plain-text log lines if
                            !isTTY OR --plain
```

The diagram shows data flow, not file listings. The orchestrator is the single producer (EventEmitter); UI is the single consumer (useSyncExternalStore). Phase 17 will plug voice-stt/tts/claude-code-bridge into the same EventEmitter without changing the UI tier.

### Recommended Project Structure (delta from Phase 15)

```
apps/achilles-terminal/
├── src/
│   ├── cli.ts                    # Phase 15 EXTENDED with voice subcommand + flags
│   ├── session.ts                # NEW Phase 16: composition root (stubs Phase 17 voice clients)
│   ├── state/
│   │   └── state-machine.ts      # NEW Phase 16: verbatim port from v1.2
│   ├── audio/
│   │   ├── mic-sox.ts            # NEW Phase 16: sox child spawn + Int16Array frames
│   │   ├── mic-mock.ts           # NEW Phase 16: synthetic generator for --mock
│   │   └── vad-energy.ts         # NEW Phase 16: adaptive EWMA + hysteresis
│   ├── ui/
│   │   ├── VoiceShell.tsx        # NEW Phase 16: Ink root component
│   │   ├── Blob.tsx              # NEW Phase 16: 7x7 grid
│   │   ├── Sparkline.tsx         # NEW Phase 16: 40-cell braille bar
│   │   ├── StatusRow.tsx         # NEW Phase 16: state + transcript line + REC + MUTED tags
│   │   ├── screen-reader.tsx     # NEW Phase 16: SR-only state-change announcer
│   │   ├── colors.ts             # NEW Phase 16: 5-state palette + NO_COLOR/FORCE_COLOR wiring
│   │   ├── useAchillesState.ts   # NEW Phase 16: useSyncExternalStore adapter
│   │   └── plain-text.ts         # NEW Phase 16: !isTTY / --plain fallback renderer
│   ├── store-stub.ts             # NEW Phase 16: loadSettings() stub (Phase 18 implements real)
│   └── braille.ts                # NEW Phase 16: braille encoding helpers
└── tests/
    ├── ui/
    │   ├── blob.test.tsx         # tests Blob via ink-testing-library
    │   ├── sparkline.test.tsx    # tests Sparkline via ink-testing-library
    │   └── status-row.test.tsx   # tests StatusRow
    ├── audio/
    │   ├── mic-sox.test.ts       # tests sox spawn shape via DI spawn impl
    │   └── vad-energy.test.ts    # deterministic RMS-fixture replay
    ├── state/
    │   └── state-machine.test.ts # verbatim port (or fresh fixtures if module-boundary breaks the port)
    ├── braille.test.ts           # tests U+2800-U+28FF encoding helpers
    └── cli.test.ts               # EXTENDED Phase 15 test, adds voice / --mock / --debug-vad / --plain flag coverage
```

The structure mirrors the `src/state/`, `src/audio/`, `src/ui/` separation specified in CONTEXT.md `<domain>`.

### Pattern 1: Single in-process composition root replaces IPC bridge

**What:** Phase 16's `session.ts` is the producer; `useAchillesState` is the consumer. No serialization between them, no Zod runtime validation at the boundary — types are the contract.

**When to use:** Always. This is the structural inversion v1.3 exists to deliver vs v1.2.

**Example:**
```typescript
// Sketch: apps/achilles-terminal/src/session.ts
// Source: ARCHITECTURE.md §"Pattern 1" — pattern matches
import { EventEmitter } from "node:events";
import type { AchillesState } from "./state/state-machine.js"; // ported from v1.2

interface SessionEvents {
  "state-change": [AchillesState];
  "transcript-partial": [string];
  "amplitude": [number];    // 20fps; drives the blob
  "rms-sample": [number];   // 20fps; drives the sparkline ring buffer
}

export class Session extends EventEmitter {
  // implementation owns the state-machine reducer + the EventEmitter fan-out
}
```

### Pattern 2: useInput for keyboard handling without swallowing Ctrl-C

**What:** Phase 16 needs `useInput` to catch the `m` mute toggle (CAP-03). Ink's default `exitOnCtrlC: true` does NOT conflict with this — Ink intercepts Ctrl-C at the render() level, not at the useInput layer.

**When to use:** All keyboard input in the Ink tree.

**Critical detail:** Phase 16 must NOT pass `exitOnCtrlC: false` to the root `render()` call. The default (`true`) is what we want — Ink's built-in Ctrl-C handler unmounts the tree, restores raw mode, and exits cleanly. Phase 17 will overlay a `gracefulShutdown` SIGINT handler ON TOP of Ink's default (see Pitfall 6 below for the chain order).

**Example:**
```typescript
// Source: github.com/vadimdemedes/ink readme — useInput hook
import { useInput } from "ink";

function VoiceShell({ session }: { session: Session }) {
  useInput((input, key) => {
    if (input === "m" && !key.ctrl && !key.meta) {
      session.toggleMute();
    }
    // Ctrl-C is NOT in this callback — Ink's exitOnCtrlC default handles it.
    // Do NOT add: if (key.ctrl && input === "c") ...  (would double-fire)
  });
  // ... rest of render
}
```

### Pattern 3: Child processes as opaque format adapters

**What:** sox is spawned via `child_process.spawn` (node-compat shim under Bun). The data flow is `proc.stdout.on("data", chunk: Buffer) -> Int16Array view over chunk.buffer -> orchestrator emits "amplitude" and "rms-sample" -> VAD.observe(rms, dt) returns speech_start/end signal`.

**When to use:** All audio I/O (Phase 16: sox only; Phase 17 adds ffplay following the same pattern).

**Example (verified to compile under Bun and Node):**
```typescript
// Source: ARCHITECTURE.md §"Pattern 3" + STACK.md §"sox" rec args
import { spawn, type ChildProcess } from "node:child_process";

const cmd = process.platform === "win32" ? "sox.exe" : "rec";
const args = process.platform === "win32"
  ? ["-q", "-d", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", "-"]
  : ["-q",       "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", "-"];

const proc: ChildProcess = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
// CRITICAL: stdio MUST be "pipe" or "inherit" — never "ignore" on the launch path (GATE-04).

proc.stdout!.on("data", (chunk: Buffer) => {
  // Buffer is a subclass of Uint8Array under both Bun and Node — both runtimes
  // treat .buffer as the underlying ArrayBuffer. The Int16Array view is zero-copy.
  const frame = new Int16Array(
    chunk.buffer,
    chunk.byteOffset,
    chunk.byteLength / 2
  );
  // ... feed frame to VAD + emit "rms-sample"
});

proc.on("exit", (code, signal) => {
  // EPERM / EACCES / device-died: see Common Pitfalls §"Pitfall 7: sox device-died silent failure"
  // Phase 16 surfaces; Phase 19's ERR-03 watchdog adds bounded respawn
});
```

### Pattern 4: useSyncExternalStore for orchestrator -> React state projection

**What:** The orchestrator's EventEmitter is the source of truth. React subscribes via `useSyncExternalStore` — same shape as ARCHITECTURE.md §"Pattern 1" describes.

**When to use:** Every UI subscription point.

**Example:**
```typescript
// Source: react.dev — useSyncExternalStore docs; ARCHITECTURE.md §"Pattern 1"
import { useSyncExternalStore } from "react";

function useAchillesState(session: Session): AchillesState {
  return useSyncExternalStore(
    (cb) => {
      session.on("state-change", cb);
      return () => session.off("state-change", cb);
    },
    () => session.currentState,
    () => session.currentState, // server snapshot — unused, just for type completeness
  );
}
```

### Anti-Patterns to Avoid

- **Re-implementing IPC inside the orchestrator "for symmetry":** ARCHITECTURE.md Anti-Pattern 2. Use plain TS-typed EventEmitter, not Zod runtime validation.
- **Making the Ink hook the source of state truth:** ARCHITECTURE.md Anti-Pattern 6. Orchestrator owns state; React projects.
- **Spawning sox with `stdio: "ignore"`:** PITFALLS.md Pitfall 1. The Phase 15 eslint config has a slot for this lint rule (GATE-04) and Phase 19 activates it; Phase 16 must already comply.
- **Passing `exitOnCtrlC: false` to `render()`:** breaks Phase 17's cancel chain. The Ink default (`true`) is correct.
- **Using `<Text aria-live="polite">`:** Ink 7 does NOT support `aria-live`. See Assumptions Log A2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal raw mode setup, ANSI escape coalescing, frame diffing | Custom stdout writer | `ink@^7.0.5` | Ink owns raw mode, cursor reposition, alternate screen buffer, SIGWINCH (terminal resize), and Ctrl-C exit. 900K weekly downloads; production-validated by Claude Code itself. |
| Screen-reader detection | Custom env-var sniffer | `ink`'s `useIsScreenReaderEnabled()` hook + `INK_SCREEN_READER` env var | Hook delegates to Ink's `isScreenReaderEnabled` render option which has the well-defined default `process.env['INK_SCREEN_READER'] === 'true'`. |
| Color helper with NO_COLOR / FORCE_COLOR awareness | Custom `if (process.env.NO_COLOR)` guards | `chalk@^5.6.2` | Chalk natively respects both env vars per no-color.org. Verified: `chalk.green("x") === "x"` when `NO_COLOR=1`. |
| State subscription pattern (EventEmitter -> React) | Custom useState + side-effects in render | React 19's `useSyncExternalStore` | Built-in React 19 primitive; correct concurrent-mode semantics. |
| Braille codepoint encoding | Lookup table over 256 codepoints | Closed-form bit math using the canonical dot-bit table (see Code Examples) | The mapping is fixed by Unicode (dots 1-4 = left + right-top, dots 5-8 = bottom). One inline function; lookup table is overkill. |
| RMS history ring buffer | New array per tick (allocation churn) | Fixed-size `Float32Array(80)` with `writeIndex` cursor | Per CONTEXT.md `<specifics>` row 2 + STACK.md §"Performance Traps". Pre-allocated zero-alloc per tick. |
| sox process restart on device-died | Hand-rolled retry loop | Phase 16 surface only — Phase 19 (ERR-03) owns the watchdog | Cap-3-in-10s watchdog is Phase 19 scope. Phase 16 emits an `error` state + stderr message on sox exit and stops; restart UX is Phase 19. |
| Settings file parser | Custom JSON loader | Phase 16's `store-stub.ts` returns hard-coded defaults; Phase 18 ships the real `~/.achilles/settings.json` loader | CONTEXT.md `<decisions>` row "All four overridable via settings.json" + "Phase 18 owns settings store; Phase 16 reads via stub" |

**Key insight:** Phase 16 is structurally a *composition* phase — every load-bearing primitive (Ink, chalk, EWMA math, ring buffer) is either an off-the-shelf library or a small, well-bounded pure function. The complexity is in wiring, not in invention.

## Runtime State Inventory

This phase is NEW code (greenfield within the achilles-terminal workspace, additive to Phase 15's seed). No rename, no refactor of existing live state, no data migration. The Runtime State Inventory categories evaluate as follows:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 16 produces no persistent data. `~/.achilles/settings.json` is READ via stub returning defaults; not written. | none |
| Live service config | None — Phase 16 spawns sox as a transient child; no service is registered or persisted. | none |
| OS-registered state | None — no launchd, no systemd, no Windows Task Scheduler, no pm2. | none |
| Secrets/env vars | Phase 16 READS three env vars only: `NO_COLOR`, `FORCE_COLOR`, `INK_SCREEN_READER`. Phase 16 does NOT touch `ELEVENLABS_API_KEY` (Phase 18 owns key resolution; Phase 16 has no STT/TTS wiring). | none |
| Build artifacts / installed packages | Phase 16 ADDS three runtime deps (`ink`, `react`, `chalk` upgrade if not present) + one dev dep (`ink-testing-library`) + types (`@types/react`). The Phase 15 `dist/` will need to be rebuilt after Phase 16 lands; that's a normal `bun run build` invocation, not a migration. | run `bun run build` after Phase 16 install |

**Nothing found in category:** stored data, live service config, OS-registered state, and secrets/env vars — verified by reading Phase 15's `apps/achilles-terminal/package.json` (no postinstall script, no `bin` execution path that writes files, no `--save-transcripts` surface in Phase 16 scope per CONTEXT.md `<deferred>`).

## Common Pitfalls

This section is the Phase-16-specific subset of PITFALLS.md, narrowed to the structural failure modes the planner must instrument verification against. It does NOT rehash every pitfall — only those that fire inside Phase 16's surface.

### Pitfall 1: Ink reconciliation thrash collapses CLI responsiveness (PITFALLS.md §5)

**What goes wrong:** 20fps amplitude updates + partial-transcript updates land as separate React state changes; Ink redraws the full tree on each (atxtechbro/test-ink-flickering analysis). On Windows Terminal v1.18 on a 2019 laptop, CPU climbs to 30-60% and Ctrl-C lag becomes visible.

**Why it happens:** Ink's reconciler does a full-tree traversal per state change. The cost depends on tree depth + per-`<Text>` string allocations.

**How to avoid:**
1. Pre-compute the blob's 7-line string OUTSIDE the React tree on each tick (in `session.amplitude` -> blob string computation in plain JS). Pass the pre-built string array as a memoized prop.
2. Pre-compute the sparkline's 40-char string OUTSIDE the React tree on each tick.
3. Use ONE `setState({ tick })` per render cycle, not 7 + 1 + 1.
4. Phase 16 MUST measure CPU during 10-minute animation (TUI-05 success criterion) on at least one slow target. If CPU > 10%, planner must add a `useDeferredValue` on partial-transcript stream before merge.

**Warning signs:**
- `top` shows the `achilles` process > 20% CPU during idle (only breathing animation).
- Blob stutters or jitters in dev but "is fine in the test runner" (the test runner doesn't time-walk a real terminal).
- Ctrl-C takes > 500ms to register.

**Verification gate:** Phase 16 SC includes a 10-minute idle animation CPU measurement on Windows Terminal v1.18.

### Pitfall 2: Bun-vs-Node WebSocket close-code drift (PITFALLS.md §8) — DEFERRED to Phase 17

Phase 16 does NOT open any WSS. Listed here only to confirm: no WebSocket use means no drift exposure in Phase 16. Phase 17 picks this up.

### Pitfall 3: Bun stdout flush-on-exit (PITFALLS.md §5)

**What goes wrong:** `console.log` does NOT flush before `process.exit()` under Bun-compiled binary. Output is lost. Phase 15's `cli.ts` already handles this with the explicit `process.stdout.write(..., () => process.exit(0))` callback form for `--version`. Phase 16 MUST follow the same pattern for any direct stdout write outside the Ink tree (the `--plain` log lines, the `--debug-vad` stderr writes).

**How to avoid:**
- Use `process.stdout.write(line + "\n", () => process.exit(code))` for terminal writes that precede exit.
- For long-running stderr (`--debug-vad`), `process.stderr.write` is fine — no flush issue because we never exit while debug-vad is active.
- Ink itself handles its own flush on `unmount()` — do not bypass.

**Verification gate:** Phase 15 already tests this pattern; Phase 16 inherits via existing test in `tests/cli.test.ts`. Add new test cases for `--plain` log-line emission to assert exit-clean stdout.

### Pitfall 4: Ink reconciliation under non-TTY stdout (TUI-06)

**What goes wrong:** When `process.stdout.isTTY === false` (piped output, CI, redirected to file), Ink renders only the final frame and skips animation. CONTEXT.md mandates "auto-trigger when isTTY === false OR --plain flag present" with a custom plain-text logger. The planner must NOT mount the Ink tree at all in plain mode — mounting an Ink tree to a non-TTY stdout produces garbage interleaved between log lines.

**How to avoid:**
- Check `process.stdout.isTTY` and `--plain` BEFORE calling Ink's `render()`. If either condition triggers fallback, use the `plain-text.ts` log-line emitter instead.
- Per Ink 7 docs: "Ink automatically detects based on CI environment and `stdout.isTTY`. In non-interactive mode... Only the final frame writes on non-interactive exit." This means even if we DO mount Ink in non-TTY, we get only one frame — but that ONE frame still has ANSI escape sequences in it. Avoid mounting.

**TTY detection edge cases under Bun-compile vs Node fallback:**
- Bun-compiled binary in a real terminal: `process.stdout.isTTY === true`. Mount Ink.
- Bun-compiled binary piped to `grep`: `process.stdout.isTTY === undefined` (falsy). Use plain mode.
- `bunx achilles voice` in a real terminal: identical to Bun-compiled binary. Mount Ink.
- `node dist/main.js` via the bin shim fallback: same isTTY semantics; mount Ink in TTY, plain mode otherwise.
- CI environment with `CI=1`: Ink's own detection treats this as non-interactive. The plain-mode pre-check sidesteps Ink's auto-detect entirely and is the correct path.

### Pitfall 5: EWMA bootstrap problem (PITFALLS.md §6 partial — Phase 16 scope)

**What goes wrong:** The very first frame has no history. If `noiseFloor` is initialized to 0, `VOICE_THRESHOLD = 0 * 3 = 0`, and EVERY frame fires `speech_start` until the EWMA catches up (~2 seconds at alpha=0.05). The user opens `achilles voice`, the binary spawns sox, and an immediate spurious `speech_start` triggers a transition to `listening`.

**How to avoid (warmup pattern — required addition to CONTEXT.md spec):**
1. On VAD initialization, set `noiseFloor` to a sane default (recommend: 0.005 — slightly above ADC noise floor of typical USB mics).
2. Skip the first 25 frames (500ms at 20ms hop) — observe RMS only, do NOT classify. During warmup, update `noiseFloor` even when RMS is high (so a startup spike doesn't poison the estimate).
3. After warmup, classify normally with the locked CONTEXT.md parameters (alpha=0.05, VOICE_THRESHOLD = noiseFloor * 3, voice-hold 60ms, silence-hold 300ms).

Phase 18's `INIT-04` adds a 5-second ambient calibration that REPLACES this 500ms warmup. Phase 16's warmup is the minimum that lets `--mock` and `achilles voice` without prior init feel correct on first run.

**Self-trigger guard implementation (Phase 16-specific):**
- VAD module exposes `vad.setMuted(active: boolean)` and `vad.setSelfTriggerGuard(active: boolean)`.
- Orchestrator calls `vad.setMuted(true)` when state machine transitions to `muted` (CAP-03).
- Orchestrator calls `vad.setSelfTriggerGuard(true)` when state machine transitions to `speaking` (Phase 17 wires this; Phase 16 includes the hook).
- When either flag is set, VAD `.observe()` continues to update `noiseFloor` but never emits `speech_start`. This is the "suppress at VAD layer, NOT state machine layer" rule from CONTEXT.md.

**Verification gate:** `tests/audio/vad-energy.test.ts` includes:
- A fixture replay test with synthesized PCM (1 second of silence then 1 second of voice-like RMS) asserting `speech_start` fires after voice-hold completes and only AFTER warmup ends.
- A self-trigger guard test asserting no `speech_start` while `setSelfTriggerGuard(true)`.
- A mute test asserting no `speech_start` while `setMuted(true)`.

### Pitfall 6: Ink's Ctrl-C handler vs Phase 17's gracefulShutdown chain

**What goes wrong:** PITFALLS.md §10 documents the gracefulShutdown chain Phase 17 must build. The hidden trap for Phase 16: Ink installs its OWN `SIGINT` handler when `render()` is called with `exitOnCtrlC: true` (the default). If Phase 16 also installs a `process.on("SIGINT", ...)` handler, the order of execution depends on registration order.

**How to avoid:**
- Phase 16 MUST register `process.on("SIGINT", ...)` BEFORE calling `render()` only if it needs SIGINT awareness for cleanup (e.g., killing the sox child cleanly). The pattern PITFALLS.md §10 recommends is: "Ink installs its own SIGINT handler during mount that calls `unmount()`. Our handler should chain Ink's (call `Ink.unmount()` THEN do our async cleanup THEN exit), not replace it."
- The minimum Phase 16 cleanup: `process.once("SIGINT", () => { soxProc.kill("SIGTERM"); /* Ink unmounts itself */ })`. Use `once`, not `on`.
- Phase 17 will REPLACE Phase 16's minimum handler with the full `gracefulShutdown(reason)` chain. The Phase 16 handler is a placeholder, not a final design.

**Verification gate:** `tests/cli.test.ts` adds a smoke test that spawns `achilles voice --mock` as a child process, sends SIGINT, asserts the child exits with code 0 (or 130 — both acceptable on POSIX) within 1.5 seconds, and asserts no orphaned sox process exists.

### Pitfall 7: sox device-died silent failure (PITFALLS.md §4 — Phase 16 scope subset)

**What goes wrong:** `which sox` passes, sox spawns, but on the second frame the audio device closes (Bluetooth headset disconnect, AirPods drop, PulseAudio crash). sox exits with code 1 or 2 and stderr "no default device" or "device unavailable." Without an exit handler, the orchestrator sits in `idle` forever waiting for frames that never come.

**How to avoid (Phase 16 minimum — Phase 19's ERR-03 owns the full watchdog):**
- Attach `proc.on("exit", (code, signal) => { ... })` and `proc.stderr.on("data", ...)` listeners IMMEDIATELY after spawn.
- On nonzero exit code: emit a state transition to `error` via the orchestrator. Print the captured stderr to `process.stderr` so the user sees the diagnostic.
- Do NOT restart sox in Phase 16 — that's ERR-03 (Phase 19). Phase 16's job is to FAIL VISIBLY, not silently.

**Verification gate:** `tests/audio/mic-sox.test.ts` injects a mock spawn that simulates exit-code-1 with stderr "no default device" and asserts the orchestrator transitions to `error` and writes the stderr to stdout.

## Code Examples

Verified patterns from official sources, adjusted for Phase 16's exact constraints.

### Braille bit encoding (CORRECTED from CONTEXT.md hypothesis)

CONTEXT.md says `dots 1-4 = upper half, 5-8 = lower half`. **This is NOT the standard Unicode braille mapping.** The actual Unicode mapping is:

| Dot | Visual Position | Hex bit added to U+2800 |
|-----|-----------------|--------------------------|
| 1 | top-left | 0x01 |
| 2 | middle-left | 0x02 |
| 3 | bottom-left | 0x04 |
| 4 | top-right | 0x08 |
| 5 | middle-right | 0x10 |
| 6 | bottom-right | 0x20 |
| 7 | very-bottom-left | 0x40 |
| 8 | very-bottom-right | 0x80 |

So a column of 4 vertical pixels on the left side maps to dots **1, 2, 3, 7** (bits 0x01, 0x02, 0x04, 0x40). The right column maps to dots **4, 5, 6, 8** (bits 0x08, 0x10, 0x20, 0x80). [CITED: en.wikipedia.org/wiki/Braille_Patterns]

The CONTEXT.md "upper half / lower half" wording is loose — the v1.3-terminal-pivot.md §4.3 SAMPLE CODE encodes it correctly (using the actual bit map). The planner must use the bit map below, NOT a misread of the CONTEXT.md wording.

```typescript
// apps/achilles-terminal/src/braille.ts
// Source: en.wikipedia.org/wiki/Braille_Patterns + v1.3-terminal-pivot.md §4.3
// Each cell encodes one left-column intensity (0..4) and one right-column intensity (0..4)
// using the 4 vertical pixels of each side.

const BRAILLE_BASE = 0x2800;

/**
 * Encode a braille cell from two intensities (0..4) representing the
 * pixel count from the bottom up of each column.
 *
 * Left column dots (top->bottom): 1, 2, 3, 7  (bits 0x01, 0x02, 0x04, 0x40)
 * Right column dots (top->bottom): 4, 5, 6, 8 (bits 0x08, 0x10, 0x20, 0x80)
 *
 * intensity=0 -> no dots; intensity=4 -> all four dots filled bottom-up
 */
export function brailleCell(left: number, right: number): string {
  const l = Math.min(4, Math.max(0, Math.round(left)));
  const r = Math.min(4, Math.max(0, Math.round(right)));
  let code = 0;
  // Fill from bottom up (dot 7 first, then 3, 2, 1) for left column
  if (l >= 1) code |= 0x40;  // dot 7
  if (l >= 2) code |= 0x04;  // dot 3
  if (l >= 3) code |= 0x02;  // dot 2
  if (l >= 4) code |= 0x01;  // dot 1
  // Same for right column
  if (r >= 1) code |= 0x80;  // dot 8
  if (r >= 2) code |= 0x20;  // dot 6
  if (r >= 3) code |= 0x10;  // dot 5
  if (r >= 4) code |= 0x08;  // dot 4
  return String.fromCharCode(BRAILLE_BASE + code);
}

/**
 * Build a 40-cell braille sparkline from a Float32Array(80) ring buffer.
 *
 * Source ring buffer convention: writeIndex points at the NEXT slot to write.
 * Render walks from (writeIndex + 1) mod 80 to writeIndex mod 80
 * (oldest to newest, left to right).
 *
 * Each pair of samples (left=2i, right=2i+1) becomes one cell.
 */
export function sparklineFromRing(ring: Float32Array, writeIndex: number): string {
  // intensity = clamp(sample * 4, 0, 4); sample is in [0, 1]
  const cells: string[] = [];
  for (let i = 0; i < 40; i++) {
    const leftIdx = (writeIndex + 1 + 2 * i) % 80;
    const rightIdx = (writeIndex + 1 + 2 * i + 1) % 80;
    const l = (ring[leftIdx] ?? 0) * 4;
    const r = (ring[rightIdx] ?? 0) * 4;
    cells.push(brailleCell(l, r));
  }
  return cells.join("");
}
```

### Unicode block ramp for the blob

CONTEXT.md says "Unicode block characters U+2580-U+259F." The actual character set used for an intensity ramp is a 4-step shade ramp:

| Codepoint | Glyph | Name | Intensity |
|-----------|-------|------|-----------|
| U+0020 (space) | ` ` | — | 0.0 |
| U+2591 | `░` | light shade | 0.25 |
| U+2592 | `▒` | medium shade | 0.5 |
| U+2593 | `▓` | dark shade | 0.75 |
| U+2588 | `█` | full block | 1.0 |

[CITED: en.wikipedia.org/wiki/Block_Elements] [CITED: v1.3-terminal-pivot.md §4.3]

The v1.3-terminal-pivot.md §4.3 sample uses this exact ramp. For Phase 16's 7x7 surface, this 5-step ramp is the correct choice — finer ramps (vertical-eighths U+2581-U+2588) would require monospace fonts with consistent height handling, which is not universal on Windows Terminal v1.18.

```typescript
// apps/achilles-terminal/src/ui/Blob.tsx (excerpt)
// Source: v1.3-terminal-pivot.md §4.3
const RAMP = [" ", "░", "▒", "▓", "█"] as const;

function rampChar(intensity: number): string {
  const idx = Math.min(4, Math.max(0, Math.round(intensity * 4)));
  return RAMP[idx]!;
}

/**
 * Build a 7-row blob frame from a single amplitude scalar (0..1).
 * Uses the center-weighted kernel from CONTEXT.md <specifics>:
 *   center cell intensity = amplitude * 1.0
 *   ring 1 (12 cells around center) = amplitude * 0.75
 *   ring 2 = amplitude * 0.5
 *   ring 3 = amplitude * 0.25
 *
 * Pre-computed OUTSIDE React tree per Pitfall 1 perf guidance.
 */
export function blobFrame(amplitude: number): readonly string[] {
  const cx = 3, cy = 3;  // center of 7x7 grid
  const rows: string[] = [];
  for (let y = 0; y < 7; y++) {
    let row = "";
    for (let x = 0; x < 7; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const ring = Math.min(3, Math.floor(dist));
      const ringScale = ring === 0 ? 1.0 : ring === 1 ? 0.75 : ring === 2 ? 0.5 : 0.25;
      row += rampChar(amplitude * ringScale);
    }
    rows.push(row);
  }
  return rows;
}
```

### EWMA noise floor + warmup + self-trigger guard

```typescript
// apps/achilles-terminal/src/audio/vad-energy.ts
// Source: v1.3-terminal-pivot.md §7.2 (energy threshold base) + PITFALLS.md §6 (adaptive EWMA + warmup)
// Phase 16 adds: warmup, self-trigger guard, mute flag

export interface VadConfig {
  alpha: number;              // CONTEXT.md: 0.05
  voiceThresholdRatio: number; // CONTEXT.md: 3 (VOICE_THRESHOLD = noiseFloor * 3)
  voiceHoldMs: number;        // CONTEXT.md: 60
  silenceHoldMs: number;      // CONTEXT.md: 300
  minUtteranceMs: number;     // CONTEXT.md: 300
  warmupFrames: number;       // Phase 16 add: 25 (500ms at 20ms hop)
  initialNoiseFloor: number;  // Phase 16 add: 0.005
}

export type VadEvent = "speech_start" | "speech_end" | null;

export interface VadHandle {
  observe(rms: number, dt: number): VadEvent;
  setMuted(active: boolean): void;
  setSelfTriggerGuard(active: boolean): void;
  reset(): void;
  /** for --debug-vad output */
  snapshot(): { rms: number; noiseFloor: number; threshold: number; state: "silence" | "voice"; warmupRemaining: number };
}

export function createEnergyVad(config: VadConfig): VadHandle {
  let state: "silence" | "voice" = "silence";
  let noiseFloor = config.initialNoiseFloor;
  let consecutiveMs = 0;
  let voicedMs = 0;
  let warmupRemaining = config.warmupFrames;
  let muted = false;
  let selfTriggerGuard = false;
  let lastRms = 0;

  function observe(rms: number, dt: number): VadEvent {
    lastRms = rms;
    // EWMA noise-floor update (always — even during warmup and mute)
    // Skip update when RMS is much larger than current floor (don't poison from speech)
    if (rms < noiseFloor * 1.5 || warmupRemaining > 0) {
      noiseFloor = config.alpha * rms + (1 - config.alpha) * noiseFloor;
    }
    // Hard minimum on noiseFloor so VOICE_THRESHOLD never drops below ADC noise
    if (noiseFloor < 0.001) noiseFloor = 0.001;

    if (warmupRemaining > 0) {
      warmupRemaining -= 1;
      return null;
    }
    if (muted || selfTriggerGuard) {
      // Continue updating noiseFloor (above), but never emit speech_start
      state = "silence";
      consecutiveMs = 0;
      voicedMs = 0;
      return null;
    }

    const threshold = noiseFloor * config.voiceThresholdRatio;

    if (state === "silence") {
      if (rms > threshold) {
        consecutiveMs += dt;
        if (consecutiveMs >= config.voiceHoldMs) {
          state = "voice";
          consecutiveMs = 0;
          voicedMs = 0;
          return "speech_start";
        }
      } else {
        consecutiveMs = 0;
      }
    } else {
      voicedMs += dt;
      if (rms < threshold) {
        consecutiveMs += dt;
        if (consecutiveMs >= config.silenceHoldMs) {
          state = "silence";
          consecutiveMs = 0;
          // Minimum-utterance-length floor: discard utterances shorter than 300ms
          if (voicedMs < config.minUtteranceMs) {
            voicedMs = 0;
            return null;  // suppress the speech_end too
          }
          voicedMs = 0;
          return "speech_end";
        }
      } else {
        consecutiveMs = 0;
      }
    }
    return null;
  }

  return {
    observe,
    setMuted: (active) => { muted = active; },
    setSelfTriggerGuard: (active) => { selfTriggerGuard = active; },
    reset: () => {
      state = "silence";
      noiseFloor = config.initialNoiseFloor;
      consecutiveMs = 0;
      voicedMs = 0;
      warmupRemaining = config.warmupFrames;
    },
    snapshot: () => ({
      rms: lastRms,
      noiseFloor,
      threshold: noiseFloor * config.voiceThresholdRatio,
      state,
      warmupRemaining,
    }),
  };
}
```

### NO_COLOR / FORCE_COLOR / INK_SCREEN_READER precedence

```typescript
// apps/achilles-terminal/src/ui/colors.ts
// Source: no-color.org + Ink 7 readme + STACK.md §"chalk@5.6.x"

/**
 * Precedence rules (CRITICAL — flagged for planner attention):
 *
 *   1. NO_COLOR (any non-empty value): chalk auto-strips colors. Phase 16 does NOTHING extra — chalk handles it.
 *   2. FORCE_COLOR (any non-empty value): chalk forces colors even when !isTTY. Phase 16 does NOTHING extra.
 *   3. INK_SCREEN_READER === "true" (NOTE: Ink 7's docs spec the string "true", NOT "1"):
 *      enables Ink's screen-reader-friendly output mode. The render() option default IS
 *      `process.env['INK_SCREEN_READER'] === 'true'`. CONTEXT.md says === "1" which is WRONG
 *      relative to Ink 7's API. The planner must use === "true" or the env var is silently
 *      ignored. See Assumptions Log A1.
 *
 *   Conflict: NO_COLOR + INK_SCREEN_READER: both can be active simultaneously. Ink's
 *   screen-reader mode still emits text via chalk; if NO_COLOR is set, that text is plain.
 *   This is the right behavior — a blind user piping the output to a log file needs
 *   plain text without ANSI escapes.
 */
import chalk from "chalk";
import type { AchillesState } from "../state/state-machine.js";

// 5-state palette — exported as const so Phase 17/20 import without duplication
export const STATE_COLORS = {
  idle: "gray",
  listening: "green",
  processing: "yellow",
  speaking: "blue",
  error: "red",
  muted: "redBright",  // muted is a substate of idle but visibly distinct
} as const;

export const SCREEN_READER_WORDING = {
  idle: "Achilles ready.",
  listening: "Achilles listening.",
  processing: "Achilles processing your request.",
  speaking: "Achilles speaking.",
  error: "Achilles encountered an error.",
  muted: "Achilles muted.",
} as const;

export function colorize(state: AchillesState | "muted", text: string): string {
  const colorName = STATE_COLORS[state];
  // chalk[colorName] is a function; chalk auto-no-ops on NO_COLOR
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (chalk as any)[colorName](text);
}

/**
 * Resolve screen-reader mode at startup. Used BEFORE Ink mounts.
 * Ink's useIsScreenReaderEnabled() is the in-tree consumer.
 */
export function isScreenReaderActive(): boolean {
  // Match Ink 7's documented default exactly: process.env['INK_SCREEN_READER'] === 'true'
  return process.env["INK_SCREEN_READER"] === "true";
}
```

### TTY detection precedence (Phase 16's `--plain` path)

```typescript
// apps/achilles-terminal/src/cli.ts (sketch of the Phase 16 voice subcommand router)
// Source: CONTEXT.md TUI-06 + PITFALLS.md §3 (Bun stdout flush)
import { render } from "ink";
import { VoiceShell } from "./ui/VoiceShell.js";
import { startPlainMode } from "./ui/plain-text.js";

interface VoiceArgs {
  mock: boolean;
  debugVad: boolean;
  plain: boolean;
}

export async function runVoice(args: VoiceArgs): Promise<void> {
  // Precedence (locked by CONTEXT.md TUI-06):
  //   1. --plain flag wins over isTTY (explicit user opt-out of Ink)
  //   2. !process.stdout.isTTY auto-degrades (piped output, CI, redirected)
  //   3. else: mount Ink
  const usePlain = args.plain || !process.stdout.isTTY;

  // (build session, attach sox or mock, ...)

  if (usePlain) {
    await startPlainMode(session, args);
    return;
  }

  const { unmount, waitUntilExit } = render(
    <VoiceShell session={session} debugVad={args.debugVad} />,
    {
      // exitOnCtrlC is true by default; do NOT pass false. Phase 17's
      // gracefulShutdown chain will wrap Ink's default handler.
      // isScreenReaderEnabled is auto-default to env-var detection — do NOT override.
      // patchConsole: true (default) — Ink redirects console.log to above the tree.
    },
  );
  await waitUntilExit();
}
```

### State machine port (Phase 16 import-path adjustment only)

The v1.2 state machine is at `apps/achilles/src/main/state-machine.ts` and has been read end-to-end (337 LOC). It compiles into Phase 16 unchanged EXCEPT for two adjustments:

**Adjustment 1: import paths.** v1.2 imports types and constants from `../shared/constants.js` (an Electron-app-relative path). Phase 16 moves these into `apps/achilles-terminal/src/state/constants.ts` (a NEW file, but it's just the relevant subset of v1.2's shared constants — `ACHILLES_STATES`, `HOTKEY_MODES`, `PERMISSION_STATES`, plus the four `LISTENING_VAD_DELAY_MS / PROCESSING_DELAY_MS / SPEAKING_DELAY_MS / ERROR_AUTO_DISMISS_MS` timing constants used by `createMockStateController`).

**Adjustment 2: a new `MUTED` state.** v1.2 has 5 states: `idle, listening, processing, speaking, error`. CONTEXT.md says Phase 16's `muted` is "a substate of idle — VAD off, sox still running so unmute is instant." The planner has two design options:
- **Option A (recommended):** Add `muted` to `ACHILLES_STATES` as a 6th state. Add `MUTE_TOGGLE` event. Transitions: `idle <-> muted`, `listening -> muted` (transitions immediately when m pressed in listening), `muted -> listening` (returns to listening if VAD was active before mute). All other states ignore `MUTE_TOGGLE`.
- **Option B:** Keep `muted` as an orchestrator-level flag separate from `AchillesState`. The state machine stays 5 states; the orchestrator carries `isMuted: boolean` and the UI renders `[muted]` instead of `[idle]` when both apply.

Option A is structurally simpler and matches the CONTEXT.md `<domain>` row "state machine transitions to muted substate." Option B keeps the v1.2 reducer untouched.

**The state-machine.ts port is feasible** (verified — file read end-to-end at `apps/achilles/src/main/state-machine.ts`). The reducer is pure, has exhaustive `switch` on event types, and uses dependency-injected timers via `setTimeoutImpl` / `clearTimeoutImpl` (useful for vitest determinism in Phase 16 tests). The `createMockStateController` runtime wrapper around the reducer is what Phase 11's Playwright tests used; Phase 16 should port both `transition` (the pure reducer) AND `createMockStateController` (for the deterministic mock-amplitude test path that CONTEXT.md `<specifics>` row 5 describes).

### Settings loader stub (Phase 18 owns the real implementation)

```typescript
// apps/achilles-terminal/src/store-stub.ts
// Source: CONTEXT.md <decisions> row "Phase 18 owns the settings store; Phase 16 reads via a stub loadSettings() that returns defaults if the file is absent"

import type { VadConfig } from "./audio/vad-energy.js";

export interface AchillesSettings {
  vad: VadConfig;
  // Phase 18 will add: apiKey source pointer, voice ID, etc.
}

const DEFAULTS: AchillesSettings = {
  vad: {
    alpha: 0.05,
    voiceThresholdRatio: 3,
    voiceHoldMs: 60,
    silenceHoldMs: 300,
    minUtteranceMs: 300,
    warmupFrames: 25,
    initialNoiseFloor: 0.005,
  },
};

/**
 * Phase 16 stub: always returns defaults. Phase 18 ships the real
 * loader that reads ~/.achilles/settings.json and overrides defaults
 * with user-set values for the four VAD knobs (voice_threshold,
 * silence_threshold, voice_hold_ms, silence_hold_ms).
 */
export function loadSettings(): AchillesSettings {
  return structuredClone(DEFAULTS);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ink 6 (referenced in v1.3-terminal-pivot.md §4) | Ink 7 (locked in PROJECT.md decisions + STACK.md) | 2026-04-08 (Ink 7.0.0 release) | React 19 + `useEffectEvent` is the load-bearing improvement; v1.3 already pinned to 7. No change for Phase 16. |
| Ink default `INK_SCREEN_READER === "1"` (assumed by CONTEXT.md row "INK_SCREEN_READER === \"1\"") | Ink 7 documented default: `INK_SCREEN_READER === "true"` | Ink 7 release (2026-04-08) | **Phase 16 BREAKING DIVERGENCE** — see Assumptions Log A1 |
| `<Text aria-live="polite">` (assumed by CONTEXT.md screen-reader.tsx row) | Ink 7 does NOT support `aria-live`; the only ARIA props are `aria-label`, `aria-hidden`, `aria-role`, `aria-state` | Ink 7 readme verified 2026-06-08 | **Phase 16 BREAKING DIVERGENCE** — see Assumptions Log A2 |
| v1.2 PTT hotkey + `useInput` SIGINT swallowing pattern | v1.3 always-on VAD; `exitOnCtrlC: true` (default) lets Ink handle Ctrl-C cleanly | v1.3 design | No swallowing pattern needed in Phase 16; the `m` mute key is captured WITHOUT touching Ctrl-C. |
| `console.log` for terminal output before exit | `process.stdout.write(line, () => process.exit(code))` with explicit flush callback | Bun 1.3+ flush-on-exit semantics (Pitfall 5) | Phase 15 already follows this pattern; Phase 16 inherits. |

**Deprecated/outdated (do NOT use):**
- `keytar` (archived 2026-03-25 per STACK.md "What NOT to Use") — Phase 18 issue, not Phase 16.
- `@ricky0123/vad-node` (winding down) — Phase 16's energy VAD is hand-rolled, not from this package.
- chalk 4 (CJS-only) — Phase 16's ESM-only constraint forbids it.
- `<Text aria-live=...>` and `<Text aria-state={...}>` for live regions in Ink 7 — not supported; use state-change-driven re-renders of a `<Text>` node instead.

## Assumptions Log

These claims in 16-CONTEXT.md were locked before this research was done. Each represents a HYPOTHESIS that turned out to need adjustment when verified against Ink 7's actual API. The planner MUST reconcile each before drafting tasks. None is a blocker — all have clean fixes — but each is a behavior the planner cannot guess from CONTEXT.md alone.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Screen-reader detection: prefer Ink's `useIsScreenReaderEnabled()` hook; fall back to checking `process.env.INK_SCREEN_READER === \"1\"`" | CONTEXT.md `<decisions>` Accessibility row | Setting `INK_SCREEN_READER=1` per CONTEXT.md will silently NOT activate screen-reader mode — Ink 7's documented default is `process.env['INK_SCREEN_READER'] === 'true'`. The hook will return `false`. ACC-02's success criterion (screen-reader users get state announcements) silently fails. **Fix:** Phase 16 must use the string `"true"` not `"1"`. Document both in README to set user expectations (some users may try `=1`). Optionally, add a small shim in `colors.ts`'s `isScreenReaderActive()` that accepts both `"1"` and `"true"` for resilience. [VERIFIED: Ink 7 readme via raw.githubusercontent.com — `Default: process.env['INK_SCREEN_READER'] === 'true'`] |
| A2 | "Emit one `<Text aria-live=\"polite\">` per state transition with explicit wording" | CONTEXT.md `<decisions>` Accessibility row + `<domain>` `screen-reader.tsx` row | Ink 7's documented ARIA attributes are `aria-label`, `aria-hidden`, `aria-role`, `aria-state` — NOT `aria-live`. Passing `aria-live="polite"` silently drops the attribute. The screen reader will NOT get a "polite" hint, but the announcement will still emit on re-render (Ink's screen-reader mode converts the entire updated subtree to text on each tick). **Fix:** In screen-reader mode, suppress Blob + Sparkline entirely; render `<Text>{SCREEN_READER_WORDING[state]}</Text>` as a single line that re-renders only when state changes. The "polite" semantics emerge naturally from the fact that we only re-render on state transitions (with the 200ms debounce from CONTEXT.md `<specifics>` row 3) — the screen reader announces each change without being told "polite" explicitly. [VERIFIED: Ink 7 readme via raw.githubusercontent.com — only four aria-* attributes listed] |
| A3 | "Key: `m` (lowercase) — captured via Ink's `useInput((input) => { if (input === \"m\") toggleMute(); })`" | CONTEXT.md `<decisions>` Mute control row | The CONTEXT.md callback signature drops the `key` parameter. If the user presses Ctrl-M or Meta-M, the lowercase `input === "m"` check fires and mutes — which is surprising UX (Ctrl-M is the standard carriage return). Also: the snippet doesn't account for `exitOnCtrlC` interaction — but Ink's default (`exitOnCtrlC: true`) DOES correctly handle Ctrl-C externally, so the snippet IS safe as written for Ctrl-C. **Fix:** Use the full `useInput((input, key) => { if (input === "m" && !key.ctrl && !key.meta) toggleMute(); })`. Do NOT pass `exitOnCtrlC: false` to `render()`. [VERIFIED: Ink 7 readme + PITFALLS.md §10 — `Default: exitOnCtrlC: true`] |

**Other claims that ARE verified or low-risk:**
- The 7x7 grid + 40-cell sparkline + 20fps target — verified against ARCHITECTURE.md §"Pattern 1" perf budget.
- The 5-state color palette + idle breathing + processing pulse curves — verified against v1.3-terminal-pivot.md §4.3 sample code.
- The sox spawn args (`rec -q -t raw -r 16000 -b 16 -e signed -c 1 -`) — verified against STACK.md §"sox" and v1.3-terminal-pivot.md §5.2.
- The VAD constants (alpha=0.05, ratio=3, holds 60/300/300ms) — locked by CONTEXT.md and matches v1.3-terminal-pivot.md §7.2.
- The state machine ports verbatim — verified by reading `apps/achilles/src/main/state-machine.ts` end-to-end. Only adjustment is import paths and the optional `muted` 6th state (Option A vs B above).

## Open Questions

1. **Phase 16 state-machine port design choice (Option A vs B from §"State machine port" above)**
   - What we know: v1.2's 5 states are pure-function reducible; the `muted` substate is logically distinct from `idle`.
   - What's unclear: whether to add a 6th state vs keep `muted` as an orchestrator-level boolean flag.
   - Recommendation: Option A (add `muted` to `ACHILLES_STATES`). Reasons: (1) CONTEXT.md `<domain>` row says "state machine transitions to `muted` substate" — implying the state machine handles it, not the orchestrator. (2) The screen-reader wording table in CONTEXT.md already includes a `muted` entry — implying state-driven announcement. (3) Adding one switch case + one event tag to the reducer is a trivial edit; Option B requires conditional rendering across multiple components.
   - This is a planner-level decision per CONTEXT.md Claude's Discretion ("Whether the v1.2 state-machine fixtures port cleanly — try first").

2. **What happens to v1.2's `LISTENING_VAD_DELAY_MS = 1200` / `PROCESSING_DELAY_MS = 800` / `SPEAKING_DELAY_MS = 2000` / `ERROR_AUTO_DISMISS_MS = 8000` constants in the port?**
   - What we know: These are used ONLY by `createMockStateController` (the deterministic mock used by v1.2's Playwright tests). They drive the fixture state-transition timeline. They are NOT used by `createSessionStateController` (the production controller used by v1.2's `session.ts`).
   - What's unclear: Whether Phase 16's `--mock` mode reuses `createMockStateController` (which depends on these constants) or builds a fresh mock-amplitude generator (CONTEXT.md `<specifics>` row 5 implies the LATTER — a synthetic generator producing a 1.5s speech-like pattern + 1.5s silence loop).
   - Recommendation: Port `createMockStateController` AS-IS for compatibility with the v1.2 state-machine test suite, but ALSO ship the fresh CONTEXT.md `<specifics>` row 5 mock-amplitude generator as `--mock` mode. The two coexist: `createMockStateController` is for state-machine unit tests; the new mock-amplitude generator is for the full `achilles voice --mock` runtime that exercises Ink rendering + VAD + state machine end-to-end.

3. **Should Phase 16 enforce a minimum terminal width before mounting Ink?**
   - What we know: PITFALLS.md UX-pitfall row says "If width <60 cols, render a smaller blob (5x5 instead of 7x7) and a 30-char sparkline."
   - What's unclear: Whether this is Phase 16 scope or deferred. CONTEXT.md does not mention terminal width.
   - Recommendation: Phase 16 ships the 7x7 + 40-cell surface unconditionally. If terminal width < 50 cols, emit a one-line warning to stderr ("achilles voice: terminal width <50 cols; visual surface may wrap") and proceed. Phase 19 (hardening polish) can add the adaptive smaller-surface fallback if user reports surface.

4. **Does `--mock` mode also stub the voice-stt/voice-tts/claude-code-bridge interface seams?**
   - What we know: Phase 16 must not import any of the four voice packages at runtime (LOOP-02 invariant means the type imports for state-machine alignment are OK; runtime imports are not). CONTEXT.md `<domain>` row "Phase 16 uses ONLY the type imports from this package (compile-time only, zero runtime touches)."
   - What's unclear: Whether `session.ts` accepts factory functions for those clients as constructor parameters (so Phase 17 can drop in real factories) AND whether `--mock` passes mock factories or just leaves them undefined.
   - Recommendation: `session.ts`'s constructor accepts optional factory function parameters for `sttFactory`, `ttsFactory`, `claudeBridgeFactory`. In Phase 16, all three are `undefined` by default and `--mock` does not change that. Phase 16's state machine transitions out of `listening` happen ONLY via the mock-amplitude generator's emitted state events. Phase 17 will wire the real factories and remove the mock-state-events path.

## Environment Availability

| Dependency | Required By | Available (on this dev box) | Version | Fallback |
|------------|------------|-----------------------------|---------|----------|
| Node.js | Phase 16 typecheck + vitest under Node runtime | likely (Phase 15 established) | >=22.0.0 per engines | — |
| Bun | Phase 16 vitest under Bun runtime (Phase 15's dual-runtime CI matrix half of GATE-04) | likely | 1.3.x | Phase 15's CI matrix is the canonical source — if Bun is missing locally, dev can rely on CI |
| sox (system binary) | Phase 16's `achilles voice` runtime (CAP-01) NOT REQUIRED by `achilles voice --mock` and NOT REQUIRED by vitest tests | NOT VERIFIED on this dev box | — | `--mock` mode is the primary dev/test path; sox not required for Phase 16 verification |
| ffmpeg / ffplay | DEFERRED — Phase 17 (PLAY-01) | n/a in Phase 16 | — | — |

**Missing dependencies with no fallback:** none (Phase 16 design is `--mock`-first, sox is opt-in for end-to-end mic capture).

**Missing dependencies with fallback:** sox — fallback is `--mock` mode for all dev + test work; sox is only needed for the manual visual smoke test of the real-mic CAP-01 success criterion (which is run by a developer, not in CI).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (Phase 15 baseline; pinned in `apps/achilles-terminal/package.json` devDependencies) |
| Config file | `apps/achilles-terminal/vitest.config.ts` (Phase 15 — uses `pool: "forks"`, `environment: "node"`) |
| Quick run command | `bun run test` (= `vitest run`) |
| Full suite command | `bun run typecheck && bun run lint && bun run test` |
| Test renderer for Ink components | `ink-testing-library@^4.0.0` — render() returns `{ lastFrame(), frames, rerender(), unmount() }`; runs in node env, compatible with vitest 2.1.8 `pool: "forks"` (no jsdom needed) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUI-01 | 7x7 blob renders with correct ramp character per (amplitude, ring) | unit | `vitest run tests/ui/blob.test.tsx` | Wave 0 |
| TUI-02 | 40-cell braille sparkline renders correctly from a known Float32Array(80) input | unit | `vitest run tests/ui/sparkline.test.tsx` | Wave 0 |
| TUI-03 | 5-state colors applied correctly; idle and processing curves produce expected envelope shapes given t=0..1200ms | unit | `vitest run tests/ui/blob.test.tsx -t "envelope"` | Wave 0 |
| TUI-04 | Status row truncates transcript to 60 chars; appends REC tag when transcripts active; appends MUTED tag when state === "muted" | unit | `vitest run tests/ui/status-row.test.tsx` | Wave 0 |
| TUI-05 | CPU < 10% over 10-minute idle animation on Windows Terminal v1.18 | manual-only (visual + system monitor) | run `achilles voice --mock` and watch CPU via Activity Monitor / Task Manager | manual — captured as asciicast in Phase 20 deferred per CONTEXT.md `<deferred>` Phase 20 row |
| TUI-06 | Plain-text fallback triggers when isTTY=false OR --plain; emits `[ISO][state] partial` lines | unit + integration | `vitest run tests/cli.test.ts -t "plain"` + a child-process integration test piping stdout | Wave 0 |
| ACC-01 | `chalk.green("x") === "x"` when `NO_COLOR=1`; chalk produces ANSI when `FORCE_COLOR=1` && `isTTY=false` | unit | `vitest run tests/ui/blob.test.tsx -t "no-color"` | Wave 0 |
| ACC-02 | `isScreenReaderActive()` returns true when `INK_SCREEN_READER=true`; Blob and Sparkline DO NOT render in screen-reader mode; state-change announcement Text DOES render | unit | `vitest run tests/ui/blob.test.tsx -t "screen-reader"` (ink-testing-library's `lastFrame()` asserts absence of block characters) | Wave 0 |
| CAP-01 | sox spawn args match per-platform; stdout 'data' produces Int16Array frames; on exit code != 0, emits error transition | unit (mock spawn impl) | `vitest run tests/audio/mic-sox.test.ts` | Wave 0 |
| CAP-02 | Adaptive EWMA noise floor updates per frame; VOICE_THRESHOLD = floor * 3; voice-hold + silence-hold + minimum-utterance gates fire on fixture replay | unit | `vitest run tests/audio/vad-energy.test.ts` | Wave 0 |
| CAP-03 | `m` keypress in useInput dispatches `MUTE_TOGGLE`; VAD `setMuted(true)` called; state transitions to `muted` | unit | `vitest run tests/ui/voice-shell.test.tsx -t "mute"` | Wave 0 |
| CAP-04 | Settings stub returns defaults; `--debug-vad` flag emits JSON lines to stderr at 50ms cadence | unit + integration | `vitest run tests/audio/vad-energy.test.ts -t "debug-vad"` + child-process integration test capturing stderr | Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run test` (full vitest suite — Phase 16 has ~150 tests max, runs in <10s under `pool: "forks"`)
- **Per wave merge:** `bun run typecheck && bun run lint && bun run test`
- **Phase gate:** Full suite green under both Bun and Node runtimes before `/gsd:verify-work` (Phase 15's CI matrix half of GATE-04 already runs both; Phase 16 just inherits)

### Wave 0 Gaps

- [ ] `tests/ui/blob.test.tsx` — covers TUI-01, TUI-03, ACC-01, ACC-02
- [ ] `tests/ui/sparkline.test.tsx` — covers TUI-02
- [ ] `tests/ui/status-row.test.tsx` — covers TUI-04
- [ ] `tests/ui/voice-shell.test.tsx` — covers CAP-03 (mute key) + Ink root smoke
- [ ] `tests/audio/mic-sox.test.ts` — covers CAP-01 (with mock spawn impl)
- [ ] `tests/audio/vad-energy.test.ts` — covers CAP-02, CAP-04
- [ ] `tests/braille.test.ts` — covers braille encoding helpers (pure function tests)
- [ ] `tests/state/state-machine.test.ts` — covers state-machine port (verbatim test from v1.2 + `muted` substate)
- [ ] `tests/cli.test.ts` (EXTEND Phase 15 file) — covers TUI-06 plain-mode + --debug-vad + --mock flags
- [ ] `ink-testing-library@4.0.0` install: `bun add -d ink-testing-library@^4.0.0` (no existing install, this is new)
- [ ] Vitest config extension: add `tests/**/*.test.tsx` to `include` glob (Phase 15 only includes `.test.ts`)
- [ ] tsconfig and eslint extension: ensure `**/*.tsx` is in include + lint scope (Phase 15 baseline only covers `.ts`)

## Security Domain

Per `.planning/config.json` `workflow.nyquist_validation = true` and absence of `security_enforcement: false`, security is enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 16 does NOT touch ELEVENLABS_API_KEY (Phase 18 owns it); Phase 16 does not authenticate any user |
| V3 Session Management | no | Phase 16 has no network session; voice-stt/tts are stubbed (LOOP-02 invariant) |
| V4 Access Control | no | Phase 16 has no privileged operations |
| V5 Input Validation | yes (limited) | Argv parsing via commander 13.x; the only Phase 16 surface that touches untrusted input is `--debug-vad` (which writes only) and the (Phase 17) STT transcript-partial events. Phase 16 ingests no user input besides keyboard via `useInput` (key codes are byte-bounded, no injection risk) |
| V6 Cryptography | no | Phase 16 ships no crypto; key encryption is Phase 18 |
| V7 Error Handling | yes | sox exit-code handling, EWMA bootstrap, useInput safety — all surface errors to stderr / state machine rather than silently swallowing |
| V8 Data Protection | yes (limited) | Phase 16 reads `INK_SCREEN_READER` env var only; does NOT log env contents; does NOT write to disk (Phase 18 owns ~/.achilles/settings.json) |
| V9 Communication | no | Phase 16 has no network surface |
| V13 API | no | Phase 16 has no API surface |

### Known Threat Patterns for Bun + Ink + child_process Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Argv injection via untrusted source (e.g., embedded in a malicious shell script that runs `achilles voice`) | Tampering | commander 13.x validates argv shape; unknown flags fail the parse loudly. CONTEXT.md TUI-06 plain-mode auto-degrade is the only flag-driven behavior change that bypasses Ink. |
| Sox argv injection (e.g., user-controlled string interpolated into the spawn args) | Tampering | The sox argv is HARD-CODED in `mic-sox.ts` — no user input flows into it. Cannot inject. |
| Sox stdout buffer overflow leading to PCM frame mis-alignment | Tampering | Int16Array view over the Buffer is bounds-checked by V8/JSC. Mis-alignment produces silence (frame size mismatch) but not corruption. |
| Env-var injection (`INK_SCREEN_READER=$(curl evil)`) | Tampering | Phase 16 reads env vars as strings; never `eval`s them. No interpolation. |
| Path traversal via `--mock` fixture file (if Phase 16 supports `--frames` flag) | Tampering | Per CONTEXT.md `<decisions>` Claude's Discretion row "Whether to expose --frames flag for offline waveform replay" — DEFER. If included in Phase 16, the path resolution MUST go through `path.resolve()` and refuse paths outside `cwd`. Recommendation: defer `--frames` to Phase 19. |
| Information disclosure via `--debug-vad` capturing RMS samples of user speech | Information disclosure | `--debug-vad` writes RMS scalars to stderr — these are not transcripts and contain no semantic information (just amplitude over time). Low risk. Document in `--help` and README. |
| DoS via infinite useInput callback loop (e.g., a key event triggering re-mount) | DoS | useInput callbacks should not call `render()` or `unmount()`. Ink's reconciler protects against re-mount loops; Phase 16's mute toggle is a state machine dispatch, not a re-mount. |

## Sources

### Primary (HIGH confidence)
- `apps/achilles/src/main/state-machine.ts` — v1.2 state machine, read end-to-end (337 LOC). The port target.
- `apps/achilles/src/main/session.ts:112` — `SPEAKING_DEBOUNCE_MS = 300` constant. Verified via grep.
- `apps/achilles/src/shared/constants.ts` — `ACHILLES_STATES`, `HOTKEY_MODES`, `PERMISSION_STATES`, `LISTENING_VAD_DELAY_MS`, `PROCESSING_DELAY_MS`, `SPEAKING_DELAY_MS`, `ERROR_AUTO_DISMISS_MS`. Verified via grep.
- `apps/achilles-terminal/package.json`, `apps/achilles-terminal/tsconfig.json`, `apps/achilles-terminal/eslint.config.js`, `apps/achilles-terminal/vitest.config.ts`, `apps/achilles-terminal/src/cli.ts` — Phase 15 lock state read directly.
- `.planning/research/v1.3-terminal-pivot.md` §4 (visible surface), §5 (capture surface), §6 (state machine), §7 (VAD), §10.6 (skill body lifecycle).
- `.planning/research/FEATURES.md` §"TABLE STAKES" (Voice Capture UX + TUI Feedback Density tables).
- `.planning/research/ARCHITECTURE.md` §"Pattern 1" (composition root replaces IPC), §"Pattern 3" (child processes as opaque adapters), §"Test Seams Under Bun and Node", §"Anti-Pattern 2" + §"Anti-Pattern 6".
- `.planning/research/PITFALLS.md` §1 (silent-launch), §3 (macOS TCC — deferred to Phase 18), §5 (Bun stdout flush), §6 (Ink reconciliation), §9 (vitest pool), §10 (SIGINT propagation).
- `.planning/research/STACK.md` (Ink 7 + React 19 + chalk 5 pins), table "What NOT to Use".
- npm registry queries 2026-06-08: `npm view ink version` (7.0.5), `npm view react version` (19.2.7), `npm view @types/react version` (19.2.17), `npm view chalk version` (5.6.2), `npm view ink-testing-library version` (4.0.0).
- Ink 7 official readme via `raw.githubusercontent.com/vadimdemedes/ink/master/readme.md` (verified 2026-06-08).
- en.wikipedia.org/wiki/Braille_Patterns — canonical Unicode dot-to-bit mapping.
- en.wikipedia.org/wiki/Block_Elements — U+2580-U+259F character list.

### Secondary (MEDIUM confidence)
- github.com/oven-sh/bun/issues/28145 — Bun 1.3.10 stdout 8192-byte truncation bug — does NOT affect Phase 16 (the bug is in the reverse direction: Node spawning a Bun binary; Phase 16's Bun binary spawns sox).
- github.com/vadimdemedes/ink/releases/tag/v7.0.0 — Ink 7 changelog (verified `useEffectEvent` baseline + Node 22 requirement).

### Tertiary (LOW confidence)
- WebSearch result on Unicode block density ramps — used only to corroborate the ramp ordering already in v1.3-terminal-pivot.md §4.3. Not load-bearing.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified against npm registry + slopcheck OK + official readme cross-check
- Architecture: HIGH — patterns mirror ARCHITECTURE.md sections that were already HIGH confidence in the milestone research
- Pitfalls: HIGH — Phase 16's subset of PITFALLS.md is the structural-replay-prevention catalog; verification gates are concrete (CPU budget, fixture replay, ps post-Ctrl-C)
- Assumption Log: HIGH — each divergence between CONTEXT.md and Ink 7's actual API was verified by reading the readme directly (not from training data)
- State machine port feasibility: HIGH — the v1.2 source file was read end-to-end and the only adjustments needed are import-path edits and an optional 6th state for `muted`

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 for Ink/React pins (npm patches happen ~monthly; Ink 7.0.x cadence is ~2 weeks per the version table); 2026-12-08 for state-machine port pattern (v1.2 source is frozen — only deletes possible after Phase 19, not edits); indefinite for braille and block-element character mappings (Unicode block frozen).

## Project Constraints (from CLAUDE.md)

Per `/Users/lakshmanturlapati/.claude/CLAUDE.md` (user-global) + `/Users/lakshmanturlapati/Documents/Codes/Handoff/CLAUDE.md` (project):

- **NO emojis in any output:** terminal logs, README, comments, commit messages, code identifiers. The Phase 15 CLI seed already follows this; Phase 16 must inherit.
- **NO auto-running applications:** the planner MUST NOT include any task that runs `achilles voice` as part of verification (use `--mock` mode in vitest tests instead — vitest spawns the process under test control, that is allowed).
- **Browser automation policy (FSB MCP):** not applicable to Phase 16 (no browser surface).

These constraints carry the same weight as locked CONTEXT.md decisions. Any task that contradicts them is a defect.
