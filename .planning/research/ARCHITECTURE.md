# Architecture Research — v1.3 Terminal-only Achilles

**Domain:** Single-process Bun-runtime terminal voice companion for Claude Code. Ink TUI host orchestrating sox + ffplay child processes, energy-VAD, and three reused voice/bridge packages. Dual distribution as an npm package (`bin: achilles`) plus a Claude Code skill that shells back into the same binary.
**Researched:** 2026-06-08
**Confidence:** HIGH for package reuse map and in-process boundaries (verified against existing files); HIGH for Bun-compile + optionalDependencies pattern (existing 2026 npm-distribution best practice); MEDIUM for cross-runtime test seam (Bun's `vitest` adapter is stable but the existing test suite has not been exercised under Bun yet — call-out only, not a blocker); MEDIUM for build order around Bun cross-compile in CI (operationally well-trodden but new to this monorepo).

This document is the integration view of the v1.3 pivot. It does NOT re-derive choices already justified in `.planning/research/v1.3-terminal-pivot.md`; it shows how the chosen components wire together, where the new app sits in the monorepo, what owns what, and the build order. The roadmapper consumes the build-order section and the boundaries table directly.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│            Terminal Pane (iTerm2 / Terminal.app / ghostty / wezterm)         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                  achilles (single Bun-compiled binary)                  │  │
│  │  ──────────────────────────────────────────────────────────────────    │  │
│  │                                                                         │  │
│  │   ┌──────────────────────┐                                              │  │
│  │   │   cli.ts (entry)     │  argv parse → load settings → spawn session  │  │
│  │   └──────────┬───────────┘                                              │  │
│  │              │                                                          │  │
│  │              ▼                                                          │  │
│  │   ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │   │  session.ts (Orchestrator — owns state machine + half-duplex)   │ │  │
│  │   │  ──────────────────────────────────────────────────────────────  │ │  │
│  │   │  state ∈ {idle, listening, processing, speaking, error}          │ │  │
│  │   │  Direct in-process function calls (NO Electron IPC anymore).     │ │  │
│  │   └─┬─────────┬─────────┬───────────┬───────────┬─────────┬──────────┘ │  │
│  │     │         │         │           │           │         │            │  │
│  │  spawn      events    write+events  spawn     write+events render      │  │
│  │     │         │         │           │           │         │            │  │
│  │     ▼         ▼         ▼           ▼           ▼         ▼            │  │
│  │  ┌─────┐  ┌──────┐  ┌────────┐  ┌──────┐   ┌──────┐  ┌──────┐         │  │
│  │  │ sox │  │ VAD  │  │  STT   │  │claude│   │ TTS  │  │ Ink  │         │  │
│  │  │child│  │energy│  │ client │  │bridge│   │client│  │ UI   │         │  │
│  │  │ rec │  │ +    │  │ wss WS │  │child │   │wss WS│  │React │         │  │
│  │  └──┬──┘  │debnce│  └────┬───┘  └──┬───┘   └───┬──┘  │ 19   │         │  │
│  │     │     └──┬───┘       │         │          │     │ + Ink│         │  │
│  │     │stdout  │ commit   committed  │         chunks │  6   │         │  │
│  │     │ s16le  │ signals  │ trans-   │ ack /    │     └──┬───┘         │  │
│  │     │ 16kHz  │ to STT   │ cript    │ summary  │        │              │  │
│  │     │ mono   │          ▼          ▼          │     stdout TTY        │  │
│  │     │        │      Scribe v2   claude -p     │        │ (raw mode)   │  │
│  │     └────────┘                                ▼        ▼              │  │
│  │                                          ┌──────────────┐             │  │
│  │                                          │   ffplay     │             │  │
│  │                                          │   child      │             │  │
│  │                                          │   stdin pipe │             │  │
│  │                                          └──────┬───────┘             │  │
│  │                                                 │ OS audio out         │  │
│  │   ┌─────────────────────────────────────────────┴─────────────────┐   │  │
│  │   │  Embedded asset: skill/prompts/companion.md  (system prompt)  │   │  │
│  │   │  Bundled into binary via Bun --compile asset embedding.       │   │  │
│  │   └────────────────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                  │ outbound only — TLS 1.3, no inbound ports
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
       ┌─────────────────┐  ┌────────────┐  ┌────────────────┐
       │ ElevenLabs STT  │  │ ElevenLabs │  │ claude (CLI)   │
       │ Scribe v2 WSS   │  │ TTS Flash  │  │ child process  │
       │                 │  │ v2.5 WSS   │  │ stream-json    │
       └─────────────────┘  └────────────┘  └────────────────┘
```

**The single most important architectural change vs. v1.2:** all arrows between orchestrator and audio/UI/clients are now *in-process function calls and EventEmitter subscriptions*. The Electron `ipcMain.handle()` / `contextBridge.exposeInMainWorld()` round trip is gone. Latency drops to nanoseconds and the IPC schema package (`apps/achilles/src/shared/ipc-schemas.ts`) is deleted.

### Component Responsibilities

| Component | Owner Path | Responsibility | Implementation | Process |
|-----------|-----------|----------------|----------------|---------|
| **CLI entry** | `apps/achilles-terminal/src/cli.ts` | Parse argv, locate companion.md asset, load settings, build composition root, hand off to session, install Ctrl-C/SIGTERM cleanup. | Plain TS — no commander; argv switch is tiny. | Main (Bun) |
| **Orchestrator** | `apps/achilles-terminal/src/session.ts` | Owns the state machine, owns the half-duplex gate, owns the failure-override path, composes voice clients + audio handles + Ink view. ~80% port of `apps/achilles/src/main/session.ts`. | TS class plus `EventEmitter` for state→UI broadcasts. | Main (Bun) |
| **State machine** | `apps/achilles-terminal/src/state-machine.ts` | Pure reducer over `AchillesState | Event → AchillesState`. Identical to v1.2; ports verbatim. | Pure function. | Main (Bun) |
| **Mic capture** | `apps/achilles-terminal/src/audio/mic-capture-sox.ts` | Spawn `rec` (or `sox.exe`) with 16kHz mono s16le flags, emit `Int16Array` frames + per-frame RMS scalar, expose start/stop. Used by both STT and VAD; replaces `apps/achilles/src/renderer/audio/mic-capture.ts` + the downsample worklet. | `child_process.spawn` (node-compat shim over `Bun.spawn`). | Main + sox child |
| **Energy VAD** | `apps/achilles-terminal/src/audio/vad-energy.ts` | RMS-threshold + hysteresis (60ms voice-hold, 300ms silence-hold). Emits `"speech_start"` / `"speech_end"` signals. Pluggable behind `VadHandle` for v1.4 silero swap. | Pure JS, < 50 LOC. | Main (Bun) |
| **STT client** | `packages/voice-stt` **(unchanged)** | Scribe v2 Realtime WSS client; `webSocketCtor`-injectable seam at `realtime-client.ts:95-98`. Already emits partial / committed events the orchestrator consumes. | Hand-rolled wire client, no SDK dependency. | Main (Bun) — talks outbound to ElevenLabs |
| **Claude bridge** | `packages/claude-code-bridge` **(unchanged)** | Spawn `claude -p --output-format stream-json …`, parse LDJSON, expose `send(text): AsyncIterable<ClaudeEvent>`, expose `extractAck` / `extractSpokenSummary`. `spawnImpl`-injectable seam at `session.ts:71-78`. | Pure JS LDJSON parser. | Main + claude child |
| **TTS client** | `packages/voice-tts` **(unchanged)** | Flash v2.5 WSS client with `chunk_length_schedule: [80,120,160,220]` and `SequenceBuffer`. `webSocketCtor`-injectable seam at `stream-client.ts:92`. | Hand-rolled wire client. | Main (Bun) — talks outbound to ElevenLabs |
| **TTS playback** | `apps/achilles-terminal/src/audio/playback-ffplay.ts` | Spawn `ffplay -nodisp -autoexit -loglevel quiet -fflags nobuffer -flags low_delay -i pipe:0`, push mp3 chunks to stdin, signal drain on exit. | `child_process.spawn`. | Main + ffplay child |
| **TUI host** | `apps/achilles-terminal/src/ui/VoiceShell.tsx` | Ink 6 + React 19 component. Renders 7×7 blob (block chars) + 40-char braille sparkline + state line. Subscribes to orchestrator events at 20fps via a single `setInterval`. | Ink renderer with `react-reconciler` + Yoga. | Main (Bun) — stdout TTY raw mode |
| **State hook** | `apps/achilles-terminal/src/ui/useAchillesState.ts` | Ink hook that subscribes to the orchestrator's `EventEmitter` and re-emits as React state. Replaces v1.2 preload-IPC subscription. | React 19 `useSyncExternalStore`. | Main (Bun) |
| **Settings + key source** | `apps/achilles-terminal/src/store.ts`, `key-source.ts` | JSON file at `~/.achilles/settings.json` (replaces `electron-store`); reads `ELEVENLABS_API_KEY` from env or settings. v1.4 may add `keytar`. | Native `fs` + `os.homedir()`. | Main (Bun) |
| **Init wizard** | `apps/achilles-terminal/src/init-wizard.ts` | `@clack/prompts` flow: API key, sox/ffmpeg/claude check, 1-second mic test, smoke test. Replaces v1.2 Electron-based windowed wizard. | `@clack/prompts` text/select/confirm/spinner. | Main (Bun) |
| **Skill bridge** | `packages/achilles-skill` **(survives; one-line frontmatter swap)** | `SKILL.md` body in v1.2 instructs Claude Code to run `achilles launch`. v1.3 changes that to `achilles voice`. `companion.md` system prompt unchanged. | Static markdown. | n/a |
| **bin shim** | `apps/achilles-terminal/dist/cli.js` (built artifact) | 30-line JS that resolves the per-platform binary via `optionalDependencies` and execs it; falls back to running the bundled JS under Node if no binary matches. | Plain `node` script. | Brief Node bootstrap → execs Bun binary |
| **Platform packages** | `apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/`, `apps/cli-linux-x64/`, `apps/cli-linux-arm64/`, `apps/cli-win32-x64/` | Each ships one Bun-compiled binary in its tarball. Installed transitively via `optionalDependencies` of `achilles`. | One binary per package. | Bun binary at runtime |

Everything below the dotted line ("Embedded asset…") is read-only at runtime. The Bun `--compile` step embeds `companion.md` as a binary asset; the orchestrator resolves it via `import.meta.url` + `fs.readFileSync` (works under both Bun's compile-time blob and Node's filesystem fallback). The SHA-256 source-of-truth check from v1.2 (`apps/achilles-cli/scripts/check-source-of-truth.mjs`) runs against the same file both code paths see.

### Process model and lifetimes

```
User runs:  achilles voice          OR     /achilles inside Claude Code
            │                                       │
            ▼                                       ▼
   bin shim (Node, ~5ms)                    Skill body executes
   resolves @achilles/cli-<platform>        Bash tool runs `achilles voice`
            │                                       │
            ▼                                       ▼
   Bun binary execve (Bun, ~15ms cold)     Bun binary execve (~15ms cold)
            │                                       │
            └──────────────────┬────────────────────┘
                               ▼
                  Single Bun process — owns:
                  ├─ Ink render loop (stdout TTY raw mode)
                  ├─ Orchestrator + state machine (in-process)
                  ├─ STT WebSocket (Bun native WebSocket)
                  ├─ TTS WebSocket (Bun native WebSocket)
                  └─ Three child processes:
                       │
                       ├─ sox `rec`            (lives as long as session)
                       ├─ claude (--resume)    (lives as long as session)
                       └─ ffplay               (one per spoken segment)
```

**Lifetime rules:**
- Ctrl-C in the terminal → SIGINT → orchestrator runs cleanup: SIGTERM sox, SIGTERM claude (then SIGKILL after 200ms), SIGTERM ffplay, `screen.alternate.disable()`, restore cursor, drain Ink reconciler, exit 0.
- sox child unexpected exit → orchestrator captures exit code; if state ∈ {idle, listening}, respawn (cap 3 attempts in 10s); if exceeded, transition to `error`.
- ffplay child unexpected exit → orchestrator marks `speaking` complete, runs `SPEAKING_DEBOUNCE_MS = 300` debounce, then transitions to `listening`.
- claude child unexpected exit → orchestrator marks `processing` failed, transitions to `error`, surfaces a one-line spoken summary via TTS ("Claude crashed, try again"), returns to `idle`.
- STT/TTS WSS close → automatic reconnect with exponential backoff (250ms, 500ms, 1s, 2s, cap 5s); circuit-breaker (incident-detection.ts ports) trips at 3 failures in 60s.

---

## Recommended Project Structure

```
Handoff/                                # existing monorepo root (npm workspaces)
├── apps/
│   ├── web/                            # (existing, untouched) Handoff Next.js UI
│   ├── relay/                          # (existing, untouched) Handoff Fly relay
│   ├── bridge/                         # (existing, untouched) Handoff local daemon
│   ├── achilles/                       # DELETED in v1.3 (entire Electron app)
│   ├── achilles-cli/                   # DEPRECATED in v1.3 — kept until skill cuts over,
│   │                                   #   then deleted after Phase 19
│   ├── achilles-terminal/              # NEW — the single source app
│   │   ├── package.json                # name: "achilles", "bin": { "achilles": "./dist/cli.js" }
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts            # runs under both Bun and Node — see §Test Seams
│   │   ├── scripts/
│   │   │   ├── build-binaries.mjs      # invokes `bun build --compile --target=…` 5x
│   │   │   ├── check-source-of-truth.mjs   # SHA-256 invariant on companion.md (port from v1.2)
│   │   │   └── check-tarball-no-secrets.mjs (port from v1.2)
│   │   ├── src/
│   │   │   ├── cli.ts                  # entry: argv parse, settings load, session.start()
│   │   │   ├── session.ts              # MIGRATED from apps/achilles/src/main/session.ts
│   │   │   │                           #   (~80% verbatim; IPC ports stripped)
│   │   │   ├── state-machine.ts        # MIGRATED unchanged
│   │   │   ├── normalisation.ts        # MIGRATED unchanged
│   │   │   ├── sandwich-defence.ts     # MIGRATED unchanged
│   │   │   ├── incident-detection.ts   # MIGRATED unchanged
│   │   │   ├── transcript-store.ts     # MIGRATED unchanged
│   │   │   ├── latency-probe.ts        # MIGRATED unchanged
│   │   │   ├── stuck-thinking-watchdog.ts  # MIGRATED unchanged
│   │   │   ├── store.ts                # rewritten: ~/.achilles/settings.json (replaces electron-store)
│   │   │   ├── key-source.ts           # simplified: env var only in v1.3 (no safeStorage)
│   │   │   ├── init-wizard.ts          # rewritten with @clack/prompts (replaces Electron windows)
│   │   │   ├── lock-file.ts            # NEW: ~/.achilles/voice.lock single-instance guard
│   │   │   ├── audio/
│   │   │   │   ├── mic-capture-sox.ts  # NEW: spawn rec, emit Int16Array + RMS
│   │   │   │   ├── playback-ffplay.ts  # NEW: spawn ffplay -nodisp, push to stdin
│   │   │   │   └── vad-energy.ts       # NEW: RMS + hysteresis VAD
│   │   │   ├── ui/
│   │   │   │   ├── VoiceShell.tsx      # NEW: Ink top-level component
│   │   │   │   ├── Blob.tsx            # NEW: 7×7 block-char grid
│   │   │   │   ├── Sparkline.tsx       # NEW: 40-char braille bar
│   │   │   │   ├── StateLine.tsx       # NEW: status + last transcript line
│   │   │   │   └── useAchillesState.ts # NEW: orchestrator → React adapter
│   │   │   ├── mocks/
│   │   │   │   ├── mock-loop-clients.ts  # MIGRATED unchanged
│   │   │   │   └── mock-amplitude.ts     # MIGRATED unchanged
│   │   │   ├── assets/
│   │   │   │   └── companion.md.ts     # generated re-export of the @achilles/achilles-skill prompt
│   │   │   └── commands/
│   │   │       ├── voice.ts            # default subcommand (renamed from launch)
│   │   │       ├── init.ts             # MIGRATED from achilles-cli/src/commands/init.ts (rewritten body)
│   │   │       ├── install-skill.ts    # MIGRATED — now creates symlink rather than copy
│   │   │       ├── transcripts.ts      # MIGRATED unchanged
│   │   │       ├── latency.ts          # MIGRATED unchanged
│   │   │       └── config.ts           # NEW: @clack/prompts settings menu
│   │   └── tests/                      # unit tests run under Bun's vitest;
│   │                                    # MOCK_LOOP=1 integration test ports unchanged
│   ├── cli-darwin-arm64/               # NEW — platform-binary package
│   │   ├── package.json                # name: "@achilles/cli-darwin-arm64", "os":["darwin"], "cpu":["arm64"]
│   │   └── achilles                    # compiled Bun binary (committed-by-CI, not by hand)
│   ├── cli-darwin-x64/                 # NEW — platform-binary package
│   ├── cli-linux-x64/                  # NEW — platform-binary package
│   ├── cli-linux-arm64/                # NEW — platform-binary package
│   └── cli-win32-x64/                  # NEW — platform-binary package
├── packages/
│   ├── protocol/                       # (existing, untouched) Handoff
│   ├── db/                             # (existing, untouched) Handoff
│   ├── auth/                           # (existing, untouched) Handoff
│   ├── voice-protocol/                 # SURVIVES untouched
│   ├── voice-stt/                      # SURVIVES untouched
│   ├── voice-tts/                      # SURVIVES untouched
│   ├── claude-code-bridge/             # SURVIVES untouched
│   └── achilles-skill/                 # SURVIVES — one-line SKILL.md frontmatter swap
│       └── skill/
│           ├── SKILL.md                # body: `achilles launch` → `achilles voice`
│           └── prompts/
│               └── companion.md        # unchanged source of truth
└── package.json                        # workspaces field already covers apps/* and packages/*;
                                        # 5 new platform-binary packages need to be added or the
                                        # workspace glob extended to apps/cli-* (recommended).
```

### Structure Rationale

- **`apps/achilles-terminal/` (new app, not edit-in-place):** A new directory makes the v1.3 cutover atomic and parallel-safe. The old `apps/achilles/` (Electron) and `apps/achilles-cli/` (npm shim) stay on disk through Phase 16 and Phase 17 so the orchestrator port has somewhere to copy from; they delete together at the end of Phase 19 once the skill is rewired. This avoids a "we mid-deleted Electron and now nothing builds" failure mode. Cost: brief workspace duplication (~10MB of source).
- **`apps/cli-<platform>-<arch>/` platform packages:** The 2026 npm best practice for shipping per-platform binaries is "one tiny package per platform, all listed in the parent's `optionalDependencies`, with `os` + `cpu` fields filtering install." This is what esbuild, swc, lightningcss, rollup-plugin-swc, biome, and turbo all do. Putting them as workspace siblings of `achilles-terminal` keeps the publish step uniform (`npm publish` for each, all from the same monorepo) and lets the binary build script live in `apps/achilles-terminal/scripts/`.
- **Why `apps/cli-<platform>` and NOT `packages/cli-<platform>`:** workspace convention here treats `apps/` as "things that get published/distributed end-user" and `packages/` as "libraries other apps consume." The platform packages are distribution artifacts, not libraries — `apps/` is the right home. Also avoids any accidental TypeScript path-alias confusion since `packages/*` get aliased through `tsconfig.base.json` while `apps/*` do not.
- **Existing `apps/achilles-cli/` stays alive until Phase 19:** the `install-skill` command in v1.2 is what the README tells users to run; we can't delete it before the new skill points at `achilles voice`. Order: Phase 15-17 build the new app side-by-side, Phase 18 migrates `init` / `transcripts` / `latency` into `achilles-terminal`, Phase 19 publishes the new package + cuts the SKILL.md over, then `apps/achilles-cli/` and `apps/achilles/` both delete.
- **`packages/achilles-skill/` is the load-bearing source-of-truth pivot:** the skill's `prompts/companion.md` is consumed by both the embedded skill manifest (Claude Code reads it inline) and the runtime (`apps/achilles-terminal/src/session.ts` passes it via `--append-system-prompt-file`). v1.2's `check-source-of-truth.mjs` enforces SHA-256 equality between the in-tarball copy and the in-skill copy — that script ports unchanged. The runtime path under v1.3 is `import.meta.url` → resolve to the `@achilles/achilles-skill` package's `dist/prompts/companion.md`, Bun `--compile` embeds it as an asset, Node fallback reads it via standard `fs`.
- **No `packages/voice-*` rename or restructure:** the four voice packages are completely surface-stable. Renaming them would be churn for zero technical benefit. Their `webSocketCtor` and `spawnImpl` seams are exactly what we need.

---

## Architectural Patterns

### Pattern 1: Single in-process composition root replaces IPC bridge

**What:** v1.2 had `apps/achilles/src/main/ipc-bridge.ts` (530 LOC) routing `electron.ipcMain.handle()` calls to orchestrator methods and broadcasting `webContents.send()` events back to the renderer. v1.3 collapses both sides into one process: the orchestrator exposes a typed `EventEmitter`, the Ink hook subscribes to it directly. No serialization, no contextIsolation, no preload bundle.

**When to use:** Any time the previous architecture used IPC purely because the runtime split it into two processes — not because the boundary was load-bearing for security or crash isolation.

**Trade-offs:**
- Pro: Latency drops from microseconds (Electron IPC) to nanoseconds (function call). The 20fps render budget is no longer threatened by IPC backpressure.
- Pro: One log to read when debugging. `console.log` in orchestrator and `console.log` in UI both appear in the same stream (we redirect them to stderr or to a JSONL log file when stdout is in TTY raw mode).
- Pro: No preload-bundle build step (`apps/achilles/src/preload/` and its electron-vite config go away).
- Con: The orchestrator and UI now share a process — a renderer crash takes the orchestrator with it. Mitigation: the Ink reducer is small and side-effect-free; uncaught exceptions in render get caught by `process.on('uncaughtException')` and routed to a "fatal" branch of the state machine that prints the error and exits cleanly.

**Example:**
```typescript
// apps/achilles-terminal/src/session.ts (sketch)
import { EventEmitter } from "node:events";
import type { AchillesState } from "@achilles/voice-protocol";

interface SessionEvents {
  "state-change": [AchillesState];
  "transcript-partial": [string];
  "transcript-committed": [string];
  "amplitude": [number];   // 20fps; drives the blob
  "rms-sample": [number];  // 20fps; drives the sparkline
  "error": [Error];
}

export class Session extends EventEmitter {
  emitState(s: AchillesState) { this.emit("state-change", s); }
  emitAmplitude(rms: number) { this.emit("amplitude", rms); }
  // …
}

// apps/achilles-terminal/src/ui/useAchillesState.ts
import { useSyncExternalStore } from "react";
import type { Session } from "../session.js";

export function useAchillesState(session: Session) {
  return useSyncExternalStore(
    (cb) => {
      session.on("state-change", cb);
      return () => session.off("state-change", cb);
    },
    () => session.currentState,
  );
}
```

The orchestrator becomes the single producer; the Ink hook becomes the single consumer. No schema validation at the boundary (the orchestrator owns both halves of the type), no JSON serialization.

### Pattern 2: Dependency injection at every wire boundary, preserved verbatim

**What:** Every package that talks to the outside world already exposes a constructor seam. v1.2 used these seams for vitest mocking; v1.3 uses the *same* seams to swap Node's `ws` package for Bun's native `WebSocket` and to swap Node's `child_process.spawn` for `Bun.spawn` (which both runtimes accept via the node-compat shim).

**When to use:** When the same source must build under two runtimes (Bun for production, Node for dev/test) AND have testability under both. The seams are not new — they are the testing seams already shipped in v1.2.

**Trade-offs:**
- Pro: Zero code change to `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge`. They already ship with the right shape.
- Pro: The composition root (`apps/achilles-terminal/src/cli.ts`) is the only place runtime-specific code lives. Everything below it is runtime-agnostic.
- Con: The composition root needs three lines to pick the right impls. Trivial.

**Example:**
```typescript
// apps/achilles-terminal/src/cli.ts (composition root excerpt)
import { spawn } from "node:child_process"; // node-compat shim under Bun
import { createRealtimeClient } from "@achilles/voice-stt";
import { createStreamClient } from "@achilles/voice-tts";
import { createClaudeSession } from "@achilles/claude-code-bridge";

// Bun: globalThis.WebSocket is native, uWebSockets-backed.
// Node: Bun isn't running, so globalThis.WebSocket exists from Node 22+.
const webSocketCtor = globalThis.WebSocket;

const sttClient = createRealtimeClient({ webSocketCtor, apiKey });
const ttsClient = createStreamClient({ webSocketCtor, apiKey, voiceId });
const claudeBridge = createClaudeSession({ spawnImpl: spawn, systemPromptFile: companionMdPath });
```

The packages don't care which runtime is on the other end of `webSocketCtor`. The vitest suite already injects a fake; production injects native; both paths share the same code.

### Pattern 3: Child processes as opaque format adapters

**What:** Bun is unfriendly to native modules and FFI is experimental. Rather than fight this, we treat `sox` and `ffplay` as opaque format adapters: we hand them bytes, they hand us bytes, both directions are vanilla `Readable`/`Writable` streams that work identically under Bun's node-compat shim and under real Node.

**When to use:** When a well-known command-line tool already produces or consumes exactly the format you need, and the alternative is binding to a native library across a runtime that doesn't fully support N-API.

**Trade-offs:**
- Pro: Zero binding code, zero native module compilation, zero per-platform binary in the npm tarball beyond the Bun binary itself.
- Pro: Survives Bun's `--compile` cross-platform-build: the binary calls into the OS PATH at runtime, so the compile target only has to ship the orchestrator, not the audio backend.
- Con: Two external system dependencies (`sox`, `ffmpeg`). Mitigation: `achilles init` runs `which sox && which ffmpeg && which claude` and surfaces per-platform install lines if anything is missing.
- Con: The half-duplex gate has to debounce around child-process drain, not around a synchronous "buffer empty" event. The existing `SPEAKING_DEBOUNCE_MS = 300` constant from `session.ts:112` already encodes this — it ports unchanged.

**Example:**
```typescript
// apps/achilles-terminal/src/audio/mic-capture-sox.ts (sketch)
import { spawn } from "node:child_process";

export function createSoxMic() {
  const proc = spawn(
    process.platform === "win32" ? "sox.exe" : "rec",
    ["-q", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed", "-c", "1", "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  proc.stdout.on("data", (chunk: Buffer) => {
    const frame = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    sttClient.send(frame);   // direct in-process call — no IPC
    const rms = computeRms(frame);
    vad.observe(rms, frameDurationMs(frame.length));
    session.emit("rms-sample", rms);  // UI subscribes here
  });
  return proc;
}
```

The mic capture is a function that orchestrator owns. The Ink UI never imports it. The orchestrator binds the stream both to the STT client and to the VAD; the VAD's `"speech_end"` signal causes the orchestrator to call `sttClient.commit()` (which flushes the buffered transcript on the Scribe side).

### Pattern 4: Single state machine + half-duplex gate, ported verbatim

**What:** The five-state machine (`idle | listening | processing | speaking | error`) from `apps/achilles/src/main/state-machine.ts` and the `SPEAKING_DEBOUNCE_MS = 300` half-duplex gate from `session.ts:112` are the most valuable code in v1.2. They port verbatim. The only thing that changes is where the events come from: instead of preload IPC calls and BrowserWindow events, they come from the energy VAD, the child process exit codes, and the WSS clients.

**When to use:** Always — this is the existing pattern, just re-wired to in-process inputs.

**Trade-offs:**
- Pro: All v1.2 audit checks for SAFE-01..06 and LOOP-01..07 port unchanged. The behavioural contract is preserved.
- Pro: The 300ms tail debounce that prevented sox from re-arming while ffplay was still draining its buffer is the right primitive — it doesn't care whether ffplay is "draining a Web Audio buffer" or "draining ffplay's internal mp3 frame buffer."
- Con: One behavioural change: PTT and toggle hotkey go away. The user no longer presses Cmd-Shift-A — Ctrl-C exits, and the energy VAD decides when to listen. This is the only user-facing change in the state machine's external behaviour. Documented in `.planning/research/v1.3-terminal-pivot.md §10.10`.

### Pattern 5: Bun-compiled binary with JS fallback, dispatched by 30-line shim

**What:** The npm package `achilles` ships a tiny JS file as its `bin` entry. That file checks for a matching `@achilles/cli-<platform>` package on disk and execs the binary it ships; failing that, it imports the bundled JS as a Node script. This gives us the cold-start win of Bun on every platform we built a binary for, with no install failure on platforms (or scenarios) where the binary is missing.

**When to use:** Standard distribution pattern for tools that ship per-platform binaries via npm (esbuild, swc, lightningcss, biome, turbo all do this).

**Trade-offs:**
- Pro: ~9-15ms cold start when the binary is present (Bun); ~50-80ms when falling back (Node + bundled JS). Either is well under the 50ms first-frame budget.
- Pro: Users on unsupported platforms still get a working CLI (slower, larger memory footprint, but functional).
- Pro: `optionalDependencies` with `os` + `cpu` filters means non-matching platforms are silently skipped at install time. No postinstall script needed (postinstall scripts are an attack vector and many corp networks disable them).
- Con: Two-stage cold start on the binary path (Node spawn → Bun exec) adds ~5ms vs. a pure Bun shim. We could ship the shim as a Bun binary too, but then the shim has the same per-platform problem; the whole point is that *the shim is platform-agnostic*. The 5ms is in the noise.

**Example:**
```javascript
// apps/achilles-terminal/dist/cli.js — the 30-line bin shim, runs under Node
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const platform = `${process.platform}-${process.arch}`;
const pkgName = `@achilles/cli-${platform}`;
try {
  const platformPkgPath = resolve(HERE, "..", "..", pkgName);
  const binPath = join(platformPkgPath, "achilles" + (process.platform === "win32" ? ".exe" : ""));
  if (existsSync(binPath)) {
    const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
    process.exit(result.status ?? 0);
  }
} catch {
  // fall through to JS path
}

// Fallback: import the bundled main as a Node script
const jsEntry = resolve(HERE, "main.js");
import(jsEntry);
```

The `main.js` bundle is built by esbuild from the same TS source as the Bun binary, with Node 22+ as the target. It runs more slowly than the Bun binary but is functionally identical.

---

## Data Flow

### End-to-end voice turn (mic-end → first audible byte)

```
T+0ms     User speaks
          │
          ▼
T+0..50ms sox `rec` stdin → 16kHz s16le frames (one chunk every ~64ms typical)
          │
          ▼
          Orchestrator's stdout listener (one in-process function call per frame):
            ├─→ sttClient.send(Int16Array frame)    [direct call — no IPC]
            ├─→ vad.observe(rms, frameDurationMs)
            └─→ session.emit("rms-sample", rms)     [UI subscribes here]
          │
          ▼ VAD emits "speech_start" first frame above threshold (~60ms hold)
          orchestrator.transition({type: "SPEECH_DETECTED"})  →  state = "listening"
          Ink hook receives "state-change" event, re-renders blob with stateColor = "green"
          │
          ▼ user finishes speaking, ~300ms of silence
          VAD emits "speech_end"
          orchestrator.transition({type: "USER_SILENCE"})
          sttClient.commit() forces Scribe to flush buffered transcript
          │
          ▼ ~150ms STT inference tail
          STT WSS emits "committed" event → orchestrator captures text
          orchestrator.transition({type: "STT_COMMITTED", text})  →  state = "processing"
          Ink re-renders with stateColor = "yellow"
          claudeBridge.send(transcript) → AsyncIterable<ClaudeEvent>
          │
          ▼ ~300-500ms Claude TTFB
          First text_delta arrives. extractAck() sees the ACK boundary.
          ttsClient.openStream("acknowledgement")
          ttsClient.appendText(ackText)
          orchestrator.transition({type: "TTS_FIRST_BYTE"})  →  state = "speaking" (ack phase)
          Ink re-renders with stateColor = "blue"
          │
          ▼ ~150-200ms TTS TTFB
          TTS WSS emits "chunk" event with mp3 bytes
          playback.push(bytes) → ffplay child stdin
          │
          ▼ ~50ms ffplay buffer + OS audio path
          First audible byte at speaker
          T_TOTAL = ~600-800ms (P50) — matches v1.2 latency budget
          │
          ▼ ffplay drains stdin EOF, exits
          orchestrator schedules SPEAKING_DEBOUNCE_MS = 300ms tail
          │
          ▼ tail elapses, no overlap risk
          orchestrator.transition({type: "PLAYBACK_DONE"})
          state = "listening" again (always-on VAD); mic gate re-opens; we loop
```

**Latency budget identical to v1.2** — the components on the latency-critical path (Scribe inference, Claude TTFB, Flash inference) are unchanged. The terminal pivot removes ~5-10ms of Electron IPC overhead per stage, which is below measurement noise.

### State machine

The state machine is the same as v1.2 with one renamed event:

```
                  SPEECH_DETECTED                   STT_COMMITTED(text)
        ┌──────────────────────────┐         ┌──────────────────────────┐
        │                          ▼         │                          ▼
   ┌─────────┐               ┌──────────┐    │                    ┌──────────┐
   │  Idle   │               │ Listening│────┴──── USER_CANCEL ──▶│   Idle   │
   └─────────┘               └──────────┘                         └──────────┘
        ▲                          │                                    ▲
        │  PLAYBACK_DONE           │  STT_COMMITTED(text)               │
        │  (after 300ms debounce)  ▼                                    │
   ┌────────────┐            ┌──────────┐    CLAUDE_ACK_TEXT      ┌──────────┐
   │ Speaking   │◀───────────│ Processing│────────────────────────│ Speaking │
   │ completion │            └──────────┘                         │   ack    │
   └────────────┘                 ▲                               └──────────┘
        ▲                         │  CLAUDE_RESULT                       │
        │                         │                                      │
        └─────────────────────────┴──────────────────────────────────────┘
              CLAUDE_RESULT (skip ack if model never emitted it)

   USER_CANCEL = Ctrl-C in any state → cleanup → exit 0
   ERROR = transient or fatal upstream failure → state = "error" → optional spoken summary
```

The only event-name change vs. v1.2: `USER_HOTKEY` → `SPEECH_DETECTED`. v1.2's PTT/toggle entry point is replaced by VAD; the rest of the transitions are identical.

### Composition wiring

```
cli.ts (entry)
  │
  ├── load settings (~/.achilles/settings.json)
  ├── resolve companion.md (embedded asset)
  ├── lock-file.ts → acquire ~/.achilles/voice.lock
  │
  └── new Session({
        webSocketCtor: globalThis.WebSocket,    // Bun native or Node 22 native
        spawnImpl: spawn,                       // node-compat shim under Bun
        sttFactory: createRealtimeClient,
        ttsFactory: createStreamClient,
        claudeBridgeFactory: createClaudeSession,
        micFactory: createSoxMic,
        playbackFactory: createFfplayPlayback,
        vadFactory: createEnergyVad,
        systemPromptFile: companionMdPath,
        apiKey: settings.elevenlabsApiKey ?? process.env.ELEVENLABS_API_KEY,
      })
  │
  └── render(<VoiceShell session={session} />)
        │
        └── Ink takes over stdout TTY raw mode
              │
              └── useAchillesState(session) subscribes to session events,
                  re-renders blob/sparkline/state line at 20fps
```

Every factory has a default and accepts overrides — that's the test seam path. Production code wires the real factories; vitest substitutes mocks.

---

## IPC vs In-Process Module Boundaries

This is the central change vs. v1.2. The table below enumerates every boundary that existed in v1.2 and how it migrates.

| v1.2 Boundary | v1.2 Mechanism | v1.3 Replacement | Notes |
|---------------|----------------|------------------|-------|
| Renderer → Main: `mic-frame` | `ipcRenderer.send` | `sox stdout` → orchestrator `proc.stdout.on("data")` listener | Sox emits Int16Array frames directly; no marshalling. |
| Renderer → Main: `mic-amplitude` | `ipcRenderer.send` | `session.emit("rms-sample", rms)` | Computed inline in `mic-capture-sox.ts` `data` handler. |
| Renderer → Main: `user-hotkey` | `ipcRenderer.send` | DELETED (VAD replaces PTT) | The energy VAD's `"speech_start"` event becomes `SPEECH_DETECTED`. Ctrl-C remains the cancel path. |
| Renderer → Main: `user-cancel` | `ipcRenderer.send` | `process.on("SIGINT", session.cancel)` | Standard signal handling. |
| Renderer → Main: `playback-buffer-empty` | `ipcRenderer.send` | `playback.onDrained(callback)` | ffplay child exits when stdin EOF + buffer drains; we listen for `exit`. |
| Main → Renderer: `state-changed` | `webContents.send` | `session.emit("state-change", state)` | Ink hook subscribes. |
| Main → Renderer: `partial-transcript` | `webContents.send` | `session.emit("transcript-partial", text)` | Ink hook subscribes. |
| Main → Renderer: `tts-chunk` | `webContents.send` | DELETED (no transit needed) | Bytes go directly from `ttsClient.events$` to `ffplay.stdin.write()`, both in the same process. |
| Main → Renderer: `error` | `webContents.send` | `session.emit("error", err)` + ErrorBanner re-render | Same pattern, no IPC. |
| Settings popover ↔ Main | `webContents.send` + `ipcMain.handle` | `@clack/prompts` flow in `apps/achilles-terminal/src/commands/config.ts` | Settings are an in-terminal flow, not a windowed UI. |
| Init wizard ↔ Main | Multiple `webContents.send` + `ipcMain.handle` per step | Linear `@clack/prompts` sequence in `apps/achilles-terminal/src/init-wizard.ts` | Each `await prompt()` returns directly to the orchestrator's caller. |
| Preload bundle | electron-vite preload config | DELETED | No browser context to bridge into. |
| `apps/achilles/src/shared/ipc-schemas.ts` | Zod schemas for IPC channels | DELETED | The orchestrator owns both producer and consumer of every event. |
| Main process ↔ claude child | `child_process.spawn` | `child_process.spawn` (unchanged) | Already used `spawnImpl` seam at `packages/claude-code-bridge/src/session.ts:71-78`. Under Bun, `child_process.spawn` is a shim over `Bun.spawn`. |
| Main process ↔ STT WSS | `ws` package | Bun's native `WebSocket` (Bun runtime) OR Node 22+'s native `WebSocket` (Node fallback) | `webSocketCtor` seam at `packages/voice-stt/src/realtime-client.ts:95-98`. |
| Main process ↔ TTS WSS | `ws` package | Same as STT | `webSocketCtor` seam at `packages/voice-tts/src/stream-client.ts:92`. |

**Total IPC code deleted in v1.3:** approximately 1,300 lines (`apps/achilles/src/main/ipc-bridge.ts` 530 LOC, `apps/achilles/src/preload/**` ~400 LOC, `apps/achilles/src/shared/ipc-schemas.ts` ~200 LOC, plus the renderer-side IPC subscription in `useAchillesState.ts` ~150 LOC). All replaced by direct `EventEmitter` subscription patterns.

---

## Bun-compile Single-Binary Distribution Wiring

### The publish topology

```
                  npm registry
                       │
        ┌──────────────┼──────────────────────────────────┐
        │              │              │                   │
        ▼              ▼              ▼                   ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐
│ "achilles"  │ │ @achilles/   │ │ @achilles/   │ │ ... 3 more  │
│ (main pkg)  │ │ cli-darwin-  │ │ cli-linux-   │ │ platforms   │
│             │ │ arm64        │ │ x64          │ │             │
│ Contents:   │ │              │ │              │ │             │
│  dist/cli.js│ │ Contents:    │ │ Contents:    │ │             │
│   (shim)    │ │  achilles    │ │  achilles    │ │             │
│  dist/main.js│ │  (Bun binary)│ │  (Bun binary)│ │             │
│   (Node     │ │  ~63MB       │ │  ~60MB       │ │             │
│   fallback) │ └──────────────┘ └──────────────┘ └─────────────┘
│  skill/**   │           │              │
│             │           │              │
│ optional-   │◀──────────┴──────────────┘    optionalDependencies
│ Dependencies│           filtered by os/cpu at install time
│             │
│ bin: {      │           │
│  achilles:  │           │
│  dist/cli.js│           │  npm install -g achilles
│ }           │           │  ──────────────────────────────────
└─────────────┘           │  1. npm resolves "achilles" + the
                          │     matching platform package only
                          │     (others skipped via os/cpu).
                          │  2. Binary is at
                          │     node_modules/@achilles/cli-<platform>/achilles
                          │  3. PATH entry "achilles" points at
                          │     node_modules/achilles/dist/cli.js
                          │     (the shim).
                          │  4. User runs `achilles voice`:
                          │     shell → cli.js shim → exec the
                          │     Bun binary via spawnSync.
                          ▼
                  ┌──────────────────┐
                  │ User terminal    │
                  │ runs the binary  │
                  └──────────────────┘
```

### The platform-package package.json shape

```json
// apps/cli-darwin-arm64/package.json
{
  "name": "@achilles/cli-darwin-arm64",
  "version": "1.3.0",
  "description": "Bun-compiled achilles binary for macOS arm64.",
  "license": "MIT",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "files": ["achilles"],
  "publishConfig": {
    "access": "public"
  }
}
```

Crucially: no `bin` field. The platform package's binary is invoked by the parent's shim, not by npm directly. This keeps the `achilles` command name pointing at one place even when the underlying binary changes per platform.

### The main `achilles` package.json shape

```json
// apps/achilles-terminal/package.json
{
  "name": "achilles",
  "version": "1.3.0",
  "type": "module",
  "bin": {
    "achilles": "./dist/cli.js"
  },
  "files": [
    "dist",
    "skill",
    "README.md"
  ],
  "engines": {
    "node": ">=22.0.0"
  },
  "optionalDependencies": {
    "@achilles/cli-darwin-arm64": "1.3.0",
    "@achilles/cli-darwin-x64": "1.3.0",
    "@achilles/cli-linux-x64": "1.3.0",
    "@achilles/cli-linux-arm64": "1.3.0",
    "@achilles/cli-win32-x64": "1.3.0"
  },
  "dependencies": {
    "@achilles/voice-protocol": "1.3.0",
    "@achilles/voice-stt": "1.3.0",
    "@achilles/voice-tts": "1.3.0",
    "@achilles/claude-code-bridge": "1.3.0",
    "@achilles/achilles-skill": "1.3.0",
    "ink": "^6.0.0",
    "react": "^19.0.0",
    "chalk": "^5.4.0",
    "@clack/prompts": "^1.5.0"
  },
  "bundledDependencies": [
    "@achilles/achilles-skill"
  ]
}
```

The `bundledDependencies` ensures the SKILL.md and prompts come along even when the user disables postinstall scripts. The 5 platform packages in `optionalDependencies` are filtered by `os`/`cpu` at install time.

### How Claude Code skill manifest dispatches into the same binary

The skill body in `packages/achilles-skill/skill/SKILL.md` declares `allowed-tools: Bash(achilles voice *)` in its frontmatter. v1.2's body shells out to `achilles launch`; v1.3 changes that one string to `achilles voice`. The Claude Code Bash tool finds `achilles` on PATH (because the user ran `npm install -g achilles`, which resolved the platform package, which placed the binary on disk, which the parent package's shim points at).

When the user invokes `/achilles` inside Claude Code:

1. Claude Code parses SKILL.md.
2. Claude Code invokes the Bash tool with `achilles voice`.
3. Shell finds `achilles` on PATH → `node_modules/achilles/dist/cli.js`.
4. The shim resolves to the platform binary.
5. `execve` swaps in the Bun binary (~15ms cold start).
6. Ink takes over the terminal, renders the first frame, starts the voice loop.
7. User talks; orchestrator runs; ffplay plays back; Ctrl-C exits.
8. Bash tool's wait completes with the exit code; Claude Code displays "skill complete."

The skill body is a one-line shell invocation. No Electron, no detach, no IPC. Same binary as `bunx achilles voice` and `achilles voice` from a fresh shell. Three invocation modes, one source of truth.

### The single source of truth for the system prompt

`packages/achilles-skill/skill/prompts/companion.md` is consumed three ways:

1. **Embedded in the binary as a Bun asset:** the build step (`apps/achilles-terminal/src/assets/companion.md.ts`) re-exports the file. Bun's `--compile` embeds the read-at-import bytes into the binary. Under Node fallback, `fs.readFileSync` reads it from the package's `dist/prompts/`.
2. **Sent to the claude child as `--append-system-prompt-file`:** orchestrator passes the resolved path to `claudeBridge`. Under Bun-compile, the path is `import.meta.url`-resolved to a temp file the binary unpacks on first use; under Node fallback, it's the package-relative path.
3. **Inlined into SKILL.md by the skill build step:** the build copies `prompts/companion.md` into `skill/prompts/companion.md` so the skill can be loaded from `~/.claude/skills/achilles/` standalone without depending on the npm package layout.

The SHA-256 check (`apps/achilles-terminal/scripts/check-source-of-truth.mjs`, ported from v1.2) asserts all three copies are byte-identical at publish time. Drift is impossible to ship.

### Build matrix

The 5-target build runs in CI (recommend per-OS runners on GitHub Actions to avoid Bun's cross-compile Windows-icon-flag limitation):

| Target | Bun command | Runner |
|--------|-------------|--------|
| darwin-arm64 | `bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile=apps/cli-darwin-arm64/achilles` | `macos-latest` (arm64) |
| darwin-x64 | `bun build src/cli.ts --compile --target=bun-darwin-x64 --outfile=apps/cli-darwin-x64/achilles` | `macos-13` (x64) |
| linux-x64 | `bun build src/cli.ts --compile --target=bun-linux-x64 --outfile=apps/cli-linux-x64/achilles` | `ubuntu-latest` |
| linux-arm64 | `bun build src/cli.ts --compile --target=bun-linux-arm64 --outfile=apps/cli-linux-arm64/achilles` | `ubuntu-22.04-arm` |
| win32-x64 | `bun build src/cli.ts --compile --target=bun-windows-x64 --outfile=apps/cli-win32-x64/achilles.exe` | `windows-latest` |

The Node-fallback bundle is built once with esbuild from `apps/achilles-terminal/src/cli.ts`, targeting Node 22+ ESM, produces `apps/achilles-terminal/dist/main.js`. That bundle is shipped inside the top-level `achilles` package, alongside the shim.

---

## Build Order

This is the load-bearing payload for the roadmapper. Linear sequence, ~6 phases, ~3 weeks total. Each phase produces a discrete artifact that can be smoke-tested.

### Sequencing rules

- Voice packages stay stable: nothing in `packages/voice-stt`, `packages/voice-tts`, `packages/voice-protocol`, `packages/claude-code-bridge` changes until the very end (if at all — likely not at all). This lets Phase 15-17 work be fully additive.
- The new `apps/achilles-terminal` workspace stands up in Phase 15 with just the build pipeline. No runtime code yet.
- The old `apps/achilles` (Electron) and `apps/achilles-cli` stay alive through Phase 18. They delete in Phase 19 once the skill is rewired.

### Phase order

**Phase 15 — Workspace scaffold + Bun build pipeline.** Create `apps/achilles-terminal/` workspace. tsconfig publishes ESM. Add the 5 `apps/cli-<platform>` workspace siblings as empty packages. Wire the build matrix in `.github/workflows/release.yml` for `bun build --compile`. Wire `esbuild` for the Node-fallback `dist/main.js`. Wire the 30-line `dist/cli.js` shim. Ship a `achilles --version` invocation that works on all five platforms. Existing voice packages and existing Electron app are untouched. **Unblocks:** all subsequent phases.

**Phase 16 — Ink TUI shell + state machine port + sox mic capture.** Port `state-machine.ts` and `normalisation.ts` (no changes). Build `VoiceShell.tsx`, `Blob.tsx`, `Sparkline.tsx`, `StateLine.tsx`. Build `useAchillesState.ts` hook. Build `mic-capture-sox.ts` and `vad-energy.ts`. Wire orchestrator-as-EventEmitter. No STT/Claude/TTS yet — drive amplitude from `mock-amplitude.ts` plus a real sox loop. Five visual states (idle / listening / processing / speaking / error) all rendered. Ship a `achilles voice --mock` invocation. **Unblocks:** Phase 17 wiring. **Reuses:** `mock-amplitude.ts`, `mock-loop-clients.ts` from v1.2 unchanged.

**Phase 17 — End-to-end voice loop wired.** Port `session.ts` from v1.2 — strip IPC bridge calls, replace with direct function calls. Plug `@achilles/voice-stt` (with `webSocketCtor: globalThis.WebSocket`), `@achilles/claude-code-bridge` (with `spawnImpl: spawn`), `@achilles/voice-tts` (same WebSocket story). Wire `playback-ffplay.ts`. Half-duplex turn-taking via `SPEAKING_DEBOUNCE_MS = 300` constant ported unchanged. Sandwich defence + normalisation + extractAck + extractSpokenSummary all port unchanged. Failure-override path ports unchanged. PROMPT-01 through PROMPT-05 contracts preserved. Ship a real `achilles voice` invocation that goes mic → spoken summary back. MOCK_LOOP=1 integration test from v1.2 ports unchanged. **Unblocks:** Phase 18. **Reuses:** session.ts (~80% verbatim), sandwich-defence.ts, normalisation.ts, latency-probe.ts unchanged.

**Phase 18 — init wizard + config + transcripts management.** Rewrite `init-wizard.ts` using `@clack/prompts`. Steps: API key (env var / paste / settings file), system dependency check (`which sox`, `which ffmpeg`, `which claude`), 1-second mic test, smoke test (1 round-trip utterance against ElevenLabs). Replace `electron-store` with `store.ts` reading `~/.achilles/settings.json`. Port `transcripts purge / list` subcommands unchanged. Port `latency --report` subcommand unchanged. Port SAFE-02 opt-in transcript persistence (via `--save-transcripts` flag). New `achilles config` subcommand opens a @clack/prompts settings menu. **Unblocks:** Phase 19 distribution. **Reuses:** transcripts.ts, latency.ts ports verbatim.

**Phase 19 — Distribution: skill rewire + publish pipeline + Gatekeeper.** One-line edit to `packages/achilles-skill/skill/SKILL.md`: `achilles launch` → `achilles voice`, plus `allowed-tools: Bash(achilles voice *)` frontmatter. New `achilles install-skill` subcommand creates a symlink at `~/.claude/skills/achilles/` pointing at the in-package `skill/` directory. The SHA-256 source-of-truth check from v1.2 ports unchanged — same companion.md hash assertion, just runs against the new package layout. Code signing + notarise pipeline for macOS-arm64 + macOS-x64 binaries (requires Apple Developer ID — surface this as a release-operator question). Windows code sign optional. tarball-no-secrets scan from v1.2 ports. `npm publish` for `achilles` + all 5 `@achilles/cli-<platform>` packages from one CI workflow. **Smoke test:** `npm install -g achilles` from a fresh machine → `achilles voice` → working voice loop. `/achilles` from Claude Code → same loop, same binary. **Deletes:** `apps/achilles-cli/` and `apps/achilles/` at end of phase. **Reuses:** publish-pipeline scripts ported from `apps/achilles-cli/scripts/`.

**Phase 20 — Hardening: circuit breaker, lock file, watchdog, device respawn.** Port `incident-detection.ts` circuit breaker. Port `stuck-thinking-watchdog.ts` (60s no-streaming-output trigger). New `lock-file.ts` single-instance guard at `~/.achilles/voice.lock`. New sox/ffplay respawn-on-exit watchdog (capped at 3 attempts in 10s) — see `device-change-handler.ts` for the rewrite template. New audio-device-change detection: sox exit code 1 → soft respawn. TypedFallback in-terminal via `@clack/prompts.text()` fallback when STT breaker opens (replaces v1.2's renderer-side `TypedFallback.tsx`). Smoke-test against the MOCK_LOOP harness. Run the v1.2 audit checklist for SAFE-01 through SAFE-06 + LOOP-01 through LOOP-07 against the v1.3 implementation. **Reuses:** incident-detection.ts, stuck-thinking-watchdog.ts port verbatim.

### What's unblocked at each phase

| At end of phase | Artifact | What it unblocks |
|------|----------|-------------------|
| 15 | `achilles --version` runs on all 5 platforms | Phase 16 work can target the new workspace |
| 16 | Visual blob + sparkline + state line, driven by real sox + mock amplitude | Phase 17 can wire the real voice clients knowing the UI is fine |
| 17 | Real voice loop, mic → spoken | Phase 18 can build init/config/transcripts on a working substrate |
| 18 | Polished CLI with init wizard, config menu, transcripts/latency commands | Phase 19 has a complete user-facing surface to publish |
| 19 | `npm install -g achilles` → working voice loop, Claude skill works, old apps deleted | Phase 20 can harden against a published baseline |
| 20 | All SAFE-* and LOOP-* contracts verified | v1.3 ships |

Phases 15-17 are not safely parallelizable (16 needs 15's build pipeline, 17 needs 16's TUI shell). Phases 18-20 have some parallelism: Phase 18 can run alongside the latter half of Phase 17 if there's a second engineer.

### What does NOT change

| Surface | Reason it survives untouched |
|---------|------------------------------|
| `packages/voice-protocol` | Pure Zod schemas; runtime-neutral. |
| `packages/voice-stt` source | `webSocketCtor` seam already accepts native or `ws` package. Bun's `globalThis.WebSocket` slots in. |
| `packages/voice-tts` source | Same WSS shape as STT. `SequenceBuffer` gap logic stays untouched. |
| `packages/claude-code-bridge` source | `spawnImpl` seam already accepts node-compat `spawn`. LDJSON parser pure JS. |
| `packages/achilles-skill/skill/prompts/companion.md` | The product contract — should not drift on a runtime pivot. |
| `apps/web`, `apps/relay`, `apps/bridge`, `packages/protocol`, `packages/db`, `packages/auth` | Handoff product; not Achilles. |

---

## Test Seams Under Bun and Node

The voice and bridge packages were written with explicit DI seams for vitest. v1.3 preserves those seams and adds one new constraint: the test suite needs to pass under both runtimes.

### Existing seams (unchanged)

| Package | Seam | File | What it enables |
|---------|------|------|-----------------|
| `voice-stt` | `webSocketCtor` constructor injection | `packages/voice-stt/src/realtime-client.ts:95-98` | Tests pass a fake `WebSocket` class; production passes native. Same source compiles to Bun binary AND Node fallback bundle. |
| `voice-tts` | `webSocketCtor` constructor injection | `packages/voice-tts/src/stream-client.ts:92` | Same as STT. |
| `claude-code-bridge` | `spawnImpl` constructor injection | `packages/claude-code-bridge/src/session.ts:71-78` | Tests pass a fake `spawn` returning a `MockChildProcess` emitting golden LDJSON; production passes `node:child_process.spawn` (which under Bun is the node-compat shim). |
| `apps/achilles/src/main/session.ts` (and its v1.3 port) | Constructor takes all factory functions as parameters | `apps/achilles/src/main/session.ts` (entire file) | The composition root is `cli.ts`; everything else accepts dependencies. |

### How the seams behave under each runtime

| Seam | Bun runtime | Node 22+ fallback runtime | Test runtime |
|------|-------------|---------------------------|--------------|
| `webSocketCtor: WebSocket` | Bun's native uWebSockets-backed implementation | Node 22+ native built-in `WebSocket` (no `ws` import needed) | Vitest's `MockWebSocket` from existing v1.2 test fixtures |
| `spawnImpl: spawn` | `child_process.spawn` shim → `Bun.spawn` via posix_spawn(3), 60% faster | `child_process.spawn` → libuv | Vitest's `mockSpawn` returning fake child with stdout EventEmitter |
| `micFactory: createSoxMic` | spawns real `rec` binary | same | Vitest substitutes `createMockSoxMic` emitting fixture frames |
| `playbackFactory: createFfplayPlayback` | spawns real `ffplay` | same | Vitest substitutes `createMockPlayback` capturing pushed bytes |

The vitest fixtures from v1.2 (`apps/achilles/src/main/mock-loop-clients.ts`, the `MockWebSocket` in voice-stt/voice-tts tests, the LDJSON golden fixtures in claude-code-bridge) all port without modification — they're runtime-agnostic JS.

### Cross-runtime test execution

The build pipeline runs the test suite under both runtimes to confirm no regression:

```bash
# Under Bun (default for the new workspace)
bun test apps/achilles-terminal/src
bun test packages/voice-stt
bun test packages/voice-tts
bun test packages/claude-code-bridge

# Under Node (verifies the fallback bundle path)
npm test --workspace apps/achilles-terminal -- --pool=forks
npm test --workspace @achilles/voice-stt
npm test --workspace @achilles/voice-tts
npm test --workspace @achilles/claude-code-bridge
```

Vitest 2.x works as the test runner under both Bun and Node. Bun also has a native `bun test` runner with a Jest-compatible API; vitest is the safer choice because it keeps the existing test suite running unchanged. (Bun's `bun test` could be a future optimization if test-suite cold start ever matters; it does not matter today because tests run in CI, not in cold-start-critical paths.)

The `vitest.config.ts` in `apps/achilles-terminal/` should set `environment: "node"` (not jsdom, no DOM-touching code) and explicitly disable the threads pool when running under Bun (Bun's worker threads are still partial — see Bun's known issues in `.planning/research/v1.3-terminal-pivot.md §10.7`). The `--pool=forks` flag works fine under both.

### What this means for the roadmap

- Phase 15 must verify that vitest runs against the new workspace under both runtimes. This is a build-pipeline checkbox, not feature work.
- Phase 17 must verify that the MOCK_LOOP integration test (which is the load-bearing end-to-end test in v1.2) ports to the new workspace and passes under both runtimes. If it doesn't, the seam preservation claim breaks and we need to fix the seam.
- Phase 20's hardening sweep should add one new test scenario per existing one: "same test under Bun-compiled binary" (using `bun --compile` then exec'ing the binary against a fixture harness). This catches `--compile`-specific regressions (asset embedding, worker thread bundling, FFI) that don't show up in `bun test src/...`.

---

## Anti-Patterns

### Anti-Pattern 1: Use `node:fs/promises` to load companion.md at runtime instead of `import.meta.url`-resolved + embedded asset

**What people do:** Hard-code a `readFile("./prompts/companion.md")` call relative to `process.cwd()`.
**Why it's wrong:** Under `bun --compile`, `process.cwd()` is whatever directory the user invoked the binary from, not the binary's bundle. The file isn't on disk; it's embedded in the binary's blob. The read fails at runtime. The Node fallback path works because the file *is* on disk relative to the package, but the symptom only shows on the binary path.
**Do this instead:** Use `import.meta.url` (relative to the source file) and a build step that emits a re-export module like `apps/achilles-terminal/src/assets/companion.md.ts`. Bun's `--compile` embeds re-exported assets natively; Node resolves the same path via standard module resolution.

### Anti-Pattern 2: Re-implement IPC inside the orchestrator "for symmetry"

**What people do:** Read the new code and think "the v1.2 IPC made the boundary explicit, let me build a tiny in-process IPC bus to preserve that." Wrap every event in a Zod schema, validate it on every emit.
**Why it's wrong:** The Zod boundary in v1.2 existed because the JSON serialization round-trip needed schema validation. There is no JSON anymore. The orchestrator and the Ink hook both consume the same TS types. Validating values that came out of the same TS code that's consuming them is pure ceremony.
**Do this instead:** Use a plain `EventEmitter` with strongly-typed event signatures (TS generics on the emitter). No runtime validation. The types are the contract.

### Anti-Pattern 3: Open ffplay once at session start and try to reuse it across utterances

**What people do:** Spawn `ffplay -nodisp -i pipe:0` once when the session starts, push bytes to it across multiple spoken segments.
**Why it's wrong:** `ffplay -autoexit` is the flag that makes ffplay drain its buffer and exit when stdin EOF is received. We use that exit as the signal to start the `SPEAKING_DEBOUNCE_MS = 300` tail. Without `-autoexit`, ffplay keeps the buffer open waiting for more bytes, and we can never tell when playback is "done." Without the drain signal, the half-duplex gate stays closed forever.
**Do this instead:** One `ffplay` child per spoken segment. Open on `TTS_FIRST_BYTE`, push chunks, EOF stdin on `TTS_STREAM_COMPLETE`, listen for `exit` event, then debounce, then re-arm mic. The spawn cost (~50ms) is below the latency budget and is fully hidden by the model's TTFB.

### Anti-Pattern 4: Use the workspace path `@achilles/cli-*` as the runtime resolve in the bin shim

**What people do:** Hard-code `node_modules/@achilles/cli-darwin-arm64/achilles` (or similar) in the shim.
**Why it's wrong:** When the user installs globally (`npm install -g achilles`), the layout is `~/.nvm/...lib/node_modules/achilles/dist/cli.js` and the platform package is at `~/.nvm/...lib/node_modules/@achilles/cli-darwin-arm64/achilles`. The relative path from the shim is `../@achilles/cli-darwin-arm64/achilles`, NOT `node_modules/...`. Hard-coded npm paths break under pnpm, under Yarn, under bunx, under workspace symlink layouts, and under monorepos.
**Do this instead:** Use `import.meta.resolve` (Node 22+) or a `try { require.resolve(pkgName) }` pattern (works under both runtimes) to ask the runtime where the platform package's `package.json` is, then join the binary name to that directory. The shim above uses `resolve(HERE, "..", "..", pkgName)` which is the simplest cross-package-manager path.

### Anti-Pattern 5: Drop the v1.2 `--mock` test mode

**What people do:** Read "the orchestrator ports verbatim" and assume the mock client fixtures are not needed any more.
**Why it's wrong:** The mock fixtures (`mock-loop-clients.ts`, `mock-amplitude.ts`) are the load-bearing path for local dev without an ElevenLabs API key. They're also how Phase 16 ships a working visual without yet plugging in the real voice clients. Deleting them stalls Phase 16 and breaks local-dev for anyone without keys.
**Do this instead:** Port both files unchanged. The mock factories drop into the same composition-root pattern.

### Anti-Pattern 6: Make the Ink hook the source of state truth

**What people do:** Refactor `useAchillesState` to be a `useReducer`, then have the orchestrator dispatch actions into it.
**Why it's wrong:** Now there are two state machines (the orchestrator's and the React reducer's), and they can disagree. Worse, the orchestrator's state machine has side-effect-bearing transitions (spawn ffplay, close STT, etc.) — running those from a React reducer breaks the React contract that reducers are pure.
**Do this instead:** Orchestrator is the single source of truth. `useSyncExternalStore` projects orchestrator state into React. The Ink tree is a read-only view. Same single-owner pattern as v1.2; the producer just changed.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **ElevenLabs Scribe v2 Realtime (STT)** | WSS via `packages/voice-stt`. WebSocket constructor injected: native under both Bun and Node 22+. | Already shipped in v1.2 voice-stt. No changes. |
| **ElevenLabs TTS Flash v2.5 stream-input** | WSS via `packages/voice-tts`. Same WebSocket story. Output `mp3_44100`, fed directly into ffplay stdin. | `chunk_length_schedule: [80,120,160,220]` already tuned in v1.2. |
| **Claude Code CLI (`claude`)** | Child process via `packages/claude-code-bridge`. `spawnImpl` seam accepts node-compat `spawn` (which is `Bun.spawn` under Bun). | Skill body in v1.3 invokes the *terminal* binary; the terminal binary spawns claude as its child — exactly as v1.2 did. |
| **Claude Code skill system** | Static `SKILL.md` at `~/.claude/skills/achilles/`. Skill body uses `allowed-tools: Bash(achilles voice *)` to invoke the binary. | One-line frontmatter swap from v1.2. |
| **OS audio (mic + speaker)** | sox `rec` child for capture, ffplay child for playback. Both are PATH-resolved. | New external system dependencies (`sox`, `ffmpeg`); v1.2 bundled both inside Electron. Surface install lines in `achilles init`. |
| **OS keychain (deferred)** | v1.3 reads key from env var or settings file; no keytar. | v1.4 may add `keytar` or `@napi-rs/keyring` if env-var-only UX is insufficient. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestrator ↔ Ink UI | `EventEmitter` subscription via `useSyncExternalStore` hook | No serialization. Types are the contract. |
| Orchestrator ↔ sox child | `child_process.spawn` → `proc.stdout.on("data")` | Direct buffer handoff. Int16Array view over the same memory. |
| Orchestrator ↔ ffplay child | `child_process.spawn` → `proc.stdin.write()` + `proc.on("exit")` | Per-segment lifetime. Exit event drives debounce. |
| Orchestrator ↔ STT WSS | `@achilles/voice-stt.createRealtimeClient` (DI: `webSocketCtor`) | Existing seam, unchanged. |
| Orchestrator ↔ TTS WSS | `@achilles/voice-tts.createStreamClient` (DI: `webSocketCtor`) | Existing seam, unchanged. |
| Orchestrator ↔ claude child | `@achilles/claude-code-bridge.createClaudeSession` (DI: `spawnImpl`) | Existing seam, unchanged. |
| Orchestrator ↔ VAD | direct function call (`vad.observe(rms, dt)`) | No serialization; pure JS path. |
| `achilles` main package ↔ platform package | `optionalDependencies` + runtime path resolution in shim | Standard 2026 npm pattern. |
| `apps/achilles-terminal` ↔ `packages/achilles-skill` | Workspace dependency; `bundledDependencies` ensures the skill files come along even when postinstall is disabled. | The companion.md asset re-export is generated from the package's `dist/prompts/companion.md`. |
| Achilles ↔ Handoff (`apps/web`, `apps/relay`, `apps/bridge`) | **None.** | Two separate verticals. Confirmed in PROJECT.md. |

---

## Sources

- `.planning/research/v1.3-terminal-pivot.md` (this monorepo, authored 2026-06-07) — primary reference for all component choices, comparison tables, and reuse map. The current document is the integration view downstream of those choices. HIGH confidence; this document was the input to the pivot decision.
- `.planning/research/ARCHITECTURE.md` (this monorepo, v1.2 authored 2026-06-06) — prior architecture; references retained for the state-machine and half-duplex patterns ported verbatim. HIGH confidence on the patterns being preserved.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/apps/achilles/src/main/session.ts:112` — verified `SPEAKING_DEBOUNCE_MS = 300` constant. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/voice-stt/src/realtime-client.ts:95-98` — verified `webSocketCtor` DI seam. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/voice-tts/src/stream-client.ts:92` — verified `webSocketCtor` DI seam. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/claude-code-bridge/src/session.ts:71-78` — verified `spawnImpl` DI seam. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/achilles-skill/src/index.ts:107-110` — verified `companion.md` source-of-truth export. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/package.json` lines 12-15 — verified workspace globs `apps/*` and `packages/*` already cover both new app directories and the platform-binary packages. HIGH confidence.
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/apps/achilles-cli/package.json` — verified existing `bin: { achilles: "./dist/cli.js" }` field, which the new package inherits. HIGH confidence.
- Bun single-file executable docs — https://bun.com/docs/bundler/executables — cross-compile via `--target=bun-{darwin,linux,windows}-{x64,arm64}`. MEDIUM confidence; well-trodden 2026 production pattern.
- npm postinstall best practices 2026 (per-platform packages via optionalDependencies + JS shim) — corroborated across esbuild, swc, lightningcss, biome, turbo. HIGH confidence.

---
*Architecture integration view for: v1.3 Terminal-only Achilles*
*Researched: 2026-06-08*
