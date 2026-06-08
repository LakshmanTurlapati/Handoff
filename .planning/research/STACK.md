# Stack Research — v1.3 Terminal-only Achilles

**Domain:** Single-package terminal voice companion for Claude Code. Bun-runtime CLI rendering Ink TUI inside the calling terminal, capturing mic via sox child, playing TTS via ffplay child, gating utterance boundaries via energy-threshold VAD, distributed as one npm package with per-platform Bun-compiled binaries via `optionalDependencies`. Reuses the four shipped voice packages (`@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/claude-code-bridge`) untouched.
**Researched:** 2026-06-08
**Confidence:** HIGH for Bun, Ink 7, sox, ffplay, npm `optionalDependencies` pattern, ElevenLabs wire integration (already validated in v1.2). MEDIUM for cold-start/Gatekeeper end-state behaviour on macOS-arm64 across a fresh install + production Apple Developer ID signing. LOW for v1.4-deferred items (silero ONNX under Bun, naudiodon PortAudio).

This document covers ONLY what is NEW or CHANGED for v1.3. Versions for the four surviving voice packages are intentionally not re-pinned here — see `.planning/research/STACK.md` history (v1.2) and `packages/voice-{protocol,stt,tts}/package.json`, `packages/claude-code-bridge/package.json` for their already-shipped dependency graphs. v1.3 makes no changes to those packages.

---

## Executive Summary

For v1.3 we add exactly one new application workspace (`apps/achilles-tui`), delete the entire `apps/achilles` (Electron) tree, and delete `apps/achilles-cli` (its surface absorbed into the new TUI app's `cli.ts`). The new runtime is **Bun 1.3+** as the primary build target with Node 22 LTS as a guaranteed-runnable fallback (the TypeScript source must execute under both). The TUI is built on **Ink 7.0.5** rendering **React 19.2.7** — note v1.3-terminal-pivot.md called for Ink 6.x but Ink shipped a major in April 2026 with React 19 support, and 7.0.5 is what we should pin. Mic capture and TTS playback are both child processes: **`sox` 14.4.2** (`rec` binary) for 16 kHz mono s16le PCM into stdout, **`ffplay` from ffmpeg 8.1.1** with `-nodisp -autoexit -fflags nobuffer` for gapless MP3 playback from stdin. VAD is a hand-rolled energy-threshold + 300 ms debounce module (<60 lines of JS, zero install cost) — silero-vad via onnxruntime-node is explicitly deferred to v1.4 because of the known JSC-vs-V8 native-module incompatibility under Bun (issue #18079) and because onnxruntime-node is currently a ~15 MB install per-platform.

Distribution: one published npm package `achilles@1.3.0` whose `bin.achilles` points at a 30-line ESM JS shim. The shim resolves a per-platform Bun-compiled binary via the standard esbuild/swc `optionalDependencies` pattern (five sibling packages `@achilles/cli-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}@1.3.0`, each with `os`/`cpu` filters so npm installs only the matching one). Fallback path: if no platform binary resolves, the shim imports the bundled JS entry under whatever Node interpreter found it. End-user install line stays `npm install -g achilles` (or `bunx achilles`); two system binaries (`sox`, `ffmpeg`) become mandatory PATH dependencies, documented in README and validated at `achilles init`.

The four voice packages survive untouched because their dependency-injection seams (verified at exact line numbers in v1.3-terminal-pivot.md §10 and Appendix A) already accept Bun's native `WebSocket` constructor and Bun's `child_process.spawn` shim. The hand-rolled Scribe v2 Realtime + Flash v2.5 wire codecs are runtime-neutral. PROMPT-01..05 (the embedded companion prompt + extractor regexes) port byte-for-byte; SKILL.md changes by exactly one line (`achilles launch` → `achilles voice`) plus its `allowed-tools` allowlist tightening.

---

## Recommended Stack

### Core Technologies (v1.3 additions)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Bun** | `1.3.14+` (latest stable as of 2026-06-04, blog/bun-v1.3.14) | Primary runtime; single-binary cross-compile target; CLI cold-start path | Bun gives ~9–15 ms hello-world cold start vs Node 22's ~50–120 ms (bun.com 2026 benchmarks). `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64}` (stable since 1.1.5, May 2024; Windows ARM64 added in 1.3.10) emits self-contained per-platform binaries with zero runtime install on the user side. Bun ships native `WebSocket` and native `child_process` shim (60% faster than Node via `posix_spawn(3)`), exactly the two surfaces the surviving voice packages already inject through seams. Critically, Bun is itself how Claude Code ships; the skill body invocation pathway is Bun-on-Bun. |
| **Node.js** | `22.x LTS` (Active LTS → Maintenance Oct 2026; EOL Apr 2027) | Source-compat target; fallback runtime when the per-platform Bun binary is missing | The TypeScript source must execute under both Bun and Node 22 so the JS bundle fallback in the bin shim is real, not theoretical. Node 22 ships the WebSocket Web API as stable (no `ws` polyfill needed in code) and has stable test-runner + permission model. Node 24 is current LTS as of 2026 but Node 22's broader installed base makes it the safer fallback floor; we document `engines.node: ">=22.0.0"`. |
| **Ink** | `7.0.5` (April 2026 major; latest patch as of 2026-06-08) | React-renderer for the terminal: pulsing blob, braille sparkline, state line, transcript snippet | Ink 7 is the first version with first-class React 19 support (uses `useEffectEvent`); v1.3-terminal-pivot.md called for Ink 6 but Ink 7 supersedes it with the React 19 baseline our state hook patterns assume. ~900K weekly downloads; used by Claude Code itself, Gatsby, Prisma, Shopify CLI. 30 fps internal cap is well above our 20 fps audio-reactive target. The pulsing blob (7×7 Unicode block grid) and braille sparkline (40 cells × 80 samples) reconcile cheaply because the DOM tree is tiny (≈100 visible cells). OpenTUI is the more aggressive 2026 alternative (Zig core + Bun FFI) but is pre-1.0 and locks us harder to Bun — defer to v1.4 watchlist. |
| **React** | `19.2.7` (released 2026-06-01) | React renderer underneath Ink 7 | Ink 7 requires React 19; 19.2.7 is the current stable patch. We do not use any concurrent-features deliberately (the Ink render loop is `setInterval`-driven at 50 ms); React is here as Ink's peer dep, not as a featureful UI runtime. |
| **sox** | `14.4.2` (system binary — brew/apt/choco; mac and Linux ship `rec` alias) | Microphone capture; emits 16 kHz mono int16 PCM raw to stdout | Hard requirement: Scribe v2 Realtime expects exactly 16 kHz mono s16le. `rec -q -t raw -r 16000 -b 16 -e signed -c 1 -` produces that natively, no resampling in process, no native bindings, no node-gyp. Same install line on all three platforms (brew/apt/choco). The fact that sox is mature and stable since 2015 is a feature here, not a bug — the wire shape we depend on does not change. Zero Bun native-module surface — `Bun.spawn` and Node `child_process.spawn` both produce identical stdout streams. |
| **ffmpeg / ffplay** | `8.1.1` (system binary — brew/apt/choco/winget; 2026-05-04 release; ffplay ships with the ffmpeg package) | TTS playback; gapless MP3 from stdin via `pipe:0` | Voice-tts emits `mp3_44100` chunks (already the v1.2 default per `packages/voice-tts/src/constants.ts:17`). `ffplay -nodisp -autoexit -loglevel quiet -fflags nobuffer -flags low_delay -i pipe:0` handles MP3 frame boundaries internally so the `CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220]` cadence stays gapless. Cross-platform, no native bindings, native-process scheduling latency ~50–100 ms which fits inside the 1.3 s conversational budget. We collapse `which sox` and `which ffmpeg` checks into one preflight in `achilles init`. |

### Supporting Libraries (v1.3 additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@clack/prompts** | `1.5.1` (latest as of 2026-06) | First-run `achilles init` wizard; STT circuit-breaker `TypedFallback` text input; `achilles config` settings menu | Modern minimal-styled prompt library (8K+ dependents per npm). Specifically NOT a display-loop framework — we use it exclusively for blocking text/confirm/select/spinner flows, never inside the Ink render tree. Bun-compat verified by upstream (clack docs explicitly call out Bun). Replaces the deleted Electron-side `apps/achilles/src/main/init-wizard.ts` and the `apps/achilles/src/renderer/components/TypedFallback.tsx`. |
| **chalk** | `5.6.x` (5 series, ESM-only since 5.0.0) | ANSI color helpers used inside Ink `<Text>` style props and in raw-ANSI fallback rendering | Chalk 5 is ESM-only; `apps/achilles-tui` ships `"type": "module"`. Versions 5.0+ require Node 14+; trivial for our floor. Chalk 4 (last CJS major) is forbidden — see "What NOT to Use." Mind the 2024 supply-chain incident: pin to a known-good 5.6.x and use `npm audit signatures` in CI. |
| **log-update** | `7.2.0` (May 2026, ESM-only) | Raw-ANSI fallback render path — used ONLY when Ink fails to detect a TTY (e.g., redirected stdout for debugging or test harness) | Sindre Sorhus library; ~17M weekly downloads on inertia. Provides the "rewrite the last N lines on each tick" primitive Ink would otherwise own. Live-loop fallback only — primary render is Ink. Kept around to defend against the "Ink crash in production" failure mode discovered late in v1.2 (debug session `.planning/debug/achilles-silent-launch.md` — the Electron renderer never wired end-to-end and the lack of a TUI fallback was part of why it shipped silently). |
| **ansi-escapes** | `7.2.0+` (latest as of 2026-02-04) | Cursor positioning + screen-clear escapes for raw-ANSI fallback; cleanup on SIGINT | Sibling library to log-update. Used by ink internally. Direct dep only when raw-ANSI fallback is active. Trivial size. |
| **commander** | `12.x` | Subcommand router for `achilles voice`, `achilles init`, `achilles config`, `achilles install-skill`, `achilles transcripts {list,purge}`, `achilles latency --report` | Already the v1.2 CLI choice; survives the cli.ts merge. Smaller than yargs/oclif; well-typed; subcommand argv parsing is the entire surface. v1.3-terminal-pivot.md §2 floated dropping commander for raw `Bun.argv`/`process.argv`; we keep it because the subcommand count went up to 6 and a hand-rolled parser is a maintenance debt with no perf upside at CLI cold-start scale. |
| **(NONE for VAD)** | — | Energy-threshold VAD; hand-rolled `<60` lines of JS | Pure JS RMS-over-frame + hysteresis state machine (the snippet in v1.3-terminal-pivot.md §7.2 ports directly). Sub-millisecond per frame. Zero install cost. Energy threshold is acceptable for the "developer in a quiet office" primary persona. The `VadHandle` interface is purpose-built so silero swap-in is one file change for v1.4. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Bun toolchain** | `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64} --outfile=achilles` for each per-platform binary; `bun test` for the unit tests that survive migration; `bun install` for workspace fanout | Bun ships its own bundler, runner, test framework, and package manager — replaces electron-vite + vite + electron-builder for the new app. The v1.2 `vitest` unit tests under `apps/achilles/src/main/*.test.ts` survive — `bun test` runs vitest-shape tests directly with no shim. Cross-compile from macOS to Windows/Linux is supported but production CI should still matrix one runner per target OS to handle code-signing per-platform. |
| **tsc (typecheck only)** | `tsc -p . --noEmit` runs alongside `bun build` because Bun does NOT typecheck | TypeScript 5.6.x. Identical config to other apps in the monorepo. Required for CI gates; not on the runtime path. |
| **pnpm workspaces** (existing) | Add `apps/achilles-tui` and the five `packages/cli-<platform>-<arch>` workspace members for the per-platform binary publish step | Existing monorepo pattern. Per-platform packages each have a single binary file in `bin/` plus a `package.json` declaring `os`/`cpu` per the esbuild standard. |
| **Turborepo** (existing) | Pipeline orchestration | Already in use; tasks added: `bun:compile:{darwin,linux,win32}-{x64,arm64}`, `bun:test`, `bun:typecheck`. |
| **GitHub Actions matrix** | Per-OS build runner; macOS-arm64 + macOS-x64 + linux-x64 + linux-arm64 + win32-x64; codesign step on macOS runners; notarisation step gated on `APPLE_DEVELOPER_ID` secret presence | Avoids cross-host signing issues. Each platform package publishes from its native runner. |

---

## Installation

```bash
# Workspace package setup
cd apps/achilles-tui
bun install                           # bun-native install across the monorepo

# Production deps (apps/achilles-tui/package.json)
bun add ink@^7.0.5 react@^19.2.7 @clack/prompts@^1.5.1 chalk@^5.6.0 \
        log-update@^7.2.0 ansi-escapes@^7.2.0 commander@^12

# Workspace internal deps (pinned to monorepo SHAs via workspace protocol)
bun add @achilles/voice-protocol@workspace:* \
        @achilles/voice-stt@workspace:* \
        @achilles/voice-tts@workspace:* \
        @achilles/claude-code-bridge@workspace:* \
        @achilles/achilles-skill@workspace:*

# Dev deps
bun add -d typescript@~5.6.0 @types/node @types/react

# End-user system deps (one of these per OS — surface in achilles init):
brew install sox ffmpeg                    # macOS
sudo apt install sox ffmpeg                # Debian / Ubuntu
choco install sox.portable ffmpeg          # Windows (admin)
# OR
winget install ffmpeg                       # Windows alt

# End-user install (publish-time surfaces)
npm install -g achilles                    # picks per-platform Bun binary via optionalDependencies
bunx achilles voice                        # one-shot via bunx cache
```

The v1.3 CI matrix produces five binary tarballs (one per `os`-`arch` combo) and publishes them to npm as five sibling packages plus the `achilles` parent.

---

## Integration with Surviving Voice Packages

This section documents the exact dependency-injection seams that make all four `@achilles/voice-*` and `@achilles/claude-code-bridge` packages reusable verbatim under the new Bun runtime. All paths and line numbers are absolute and verified.

### `@achilles/voice-stt` — Scribe v2 Realtime WSS client

- **Injection seam:** `webSocketCtor` parameter on `realtime-client.ts` constructor (`/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/voice-stt/src/realtime-client.ts:95-98`).
- **Bun wiring:** `new RealtimeClient({ webSocketCtor: globalThis.WebSocket, ... })`. Bun's native WebSocket implements the standard browser WebSocket constructor signature; no shim, no `ws` import, no polyfill code path.
- **Node fallback wiring:** `import { WebSocket } from "ws"` (already a transitive dep through `apps/relay`) → `webSocketCtor: WebSocket`. Identical structural interface; the existing Vitest test paths drive this exact pattern.
- **Token mint helper:** pure HTTP (`fetch`) — uses the global `fetch` available in both Bun and Node 22+. No change.
- **Wire codec:** hand-rolled `input_audio_chunk` base64 + commit-flag PCM framing. Pure JS; no runtime dependency.
- **Cost to migrate:** zero LOC change in the package. The orchestrator picks `webSocketCtor` based on detected runtime.

### `@achilles/voice-tts` — Flash v2.5 streaming TTS client

- **Injection seam:** `webSocketCtor` parameter on `stream-client.ts` constructor (`/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/voice-tts/src/stream-client.ts:92`).
- **Bun wiring:** identical to STT — `globalThis.WebSocket`.
- **Sequence buffer:** `packages/voice-tts/src/sequence-buffer.ts` — pure JS. The `CHUNK_LENGTH_SCHEDULE` constant (80/120/160/220 ms) survives unchanged.
- **Output format:** stays at `mp3_44100` (the `DEFAULT_OUTPUT_FORMAT` from `packages/voice-tts/src/constants.ts:17`) because that's what ffplay handles best from stdin.
- **Consumer change in v1.3:** the renderer-side `playback-queue.ts` that decoded MP3 via Web Audio `decodeAudioData` is deleted. v1.3 orchestrator wires `for await (ev of ttsClient.events$)` directly into `ffplay.stdin.write(ev.bytes)`. Zero change in the voice-tts package itself.

### `@achilles/claude-code-bridge` — `claude -p` subprocess wrapper

- **Injection seam:** `spawnImpl` parameter on `createClaudeSession` (`/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/claude-code-bridge/src/session.ts:71-78`).
- **Bun wiring:** `import { spawn } from "node:child_process"` works under Bun because `node:child_process` is a documented node-compat shim over `Bun.spawn` (which uses `posix_spawn(3)` and is 60% faster than Node's spawn). `spawnImpl: spawn`. No code change in the package.
- **Node wiring:** same import line. Identical.
- **LDJSON line parser:** `packages/claude-code-bridge/src/line-parser.ts` — pure JS, has fixture-tested partial-chunk handling. Documented LOW-risk verify in v1.3 Phase 17 smoke tests.
- **Cancellation chain:** SIGINT → 1.5 s → SIGTERM → 5 s → SIGKILL. Both runtimes implement signal forwarding to spawned children via the standard `process.kill(pid, signal)` path. macOS process-group SIGINT forwarding is documented to work in Bun 1.3+ for the simple `pipe` stdio case we use (no extra fds).
- **Subprocess args:** `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <path>`. The `--append-system-prompt-file` arg points at the embedded `companion.md` extracted to a temp path on first session start (same pattern as v1.2).

### `@achilles/voice-protocol` — Zod schemas

- Runtime-neutral. No DI surface. Pure type + Zod runtime validation; works on every JS runtime that supports `zod@3.23+`. Ports verbatim.

### `@achilles/achilles-skill` — companion prompt + SKILL.md source of truth

- **Embedded prompt path:** exported from package index (`/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/achilles-skill/src/index.ts:107-110`). Untouched.
- **SKILL.md frontmatter change (the only edit in this package):**
  - Body command: `achilles launch` → `achilles voice` (one-line diff).
  - `allowed-tools` tightened from the broad v1.2 `Bash` to the v1.3 allowlist: `Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)` (per v1.3-terminal-pivot.md §8.3).
- **Source-of-truth check:** the existing CI script `apps/achilles-cli/scripts/check-source-of-truth.mjs` migrates to `apps/achilles-tui/scripts/check-source-of-truth.mjs` and continues asserting SHA-256 equality of `companion.md` between the package and the symlinked-into-skill copy.

### Orchestrator (`apps/achilles/src/main/session.ts`) → `apps/achilles-tui/src/session.ts`

- The half-duplex turn-taking state machine + the embedded `SPEAKING_DEBOUNCE_MS = 300` constant (line 112 of the v1.2 file) survive verbatim. The only code deleted is the IPC envelope wrapper around the renderer-bound callbacks; v1.3 replaces those with direct function calls into the Ink hook's setter.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Bun 1.3 (primary) + Node 22 (fallback)** | Pure Node 22 + esbuild bundle | If onnxruntime-node or another native module proves load-bearing for v1.3 (it doesn't, but if v1.4 silero work surfaces a blocker we may swap.). Node SEA via `--build-sea` (Node 25.5+, Jan 2026) is the right path then. |
| **Bun 1.3 (primary) + Node 22 (fallback)** | yao-pkg (vercel/pkg fork) | If we need to ship a single-file binary that runs without a system Bun install AND need Node-specific native modules. yao-pkg supports Node 22. Adds a forked-archived-dep maintenance burden — avoid unless we hit a Bun-vs-native-module wall. |
| **Ink 7 + React 19** | OpenTUI + `@opentui/react` | If sub-millisecond TUI frame timing becomes load-bearing and Bun lock-in is acceptable. OpenTUI's Zig core + Bun FFI is the more aggressive 2026 entrant but is pre-1.0 and API-in-flux. Watchlist for v1.4. |
| **Ink 7 + React 19** | Raw ANSI (log-update + ansi-escapes + chalk only) | If the Ink + React 19 reconciler dependency footprint (~2.5 MB) ever becomes an issue or if Ink itself crashes in production. We already ship log-update as the in-flight fallback path. Trade: lose the component model, hand-roll the diff. |
| **Ink 7 + React 19** | Blessed / neo-blessed | Never. chjj/blessed inactive since 2017; ~46K weekly downloads on inertia. Forks (`neo-blessed`, `unblessed/core`) put us on the support hook. |
| **sox child process** | naudiodon (PortAudio bindings bundled) | If users report "I don't want to brew install sox" friction louder than expected. naudiodon ships PortAudio in the npm package (~10 MB binary). Marked "not yet production-ready" by maintainer; Bun-compat untested. Defer to v1.4 as an `optionalDependencies` fallback. |
| **sox child process** | `mic` / `node-record-lpcm16` / `node-microphone` npm wrappers | They wrap sox anyway, so they add an npm dep without removing the system dep. Direct spawn is simpler. |
| **sox child process** | Bun FFI to PortAudio C library | `bun:ffi` is flagged experimental; async callbacks unsupported. Too much new surface for v1.3. |
| **ffplay child process** | `speaker` (TooTallNate/node-speaker) PCM writable + decode in process | speaker is a native module (mpg123 bundled, ~15 MB). Last published 2 years ago. Bun-compat unverified. We avoid native modules in the v1.3 audio path on purpose. |
| **ffplay child process** | `mpv` / `node-mpv` | Adds a second system dep (mpv) where ffmpeg's `ffplay` is bundled with the same ffmpeg the user installs for many other reasons. |
| **ffplay child process** | macOS-only `afplay` + Linux-only `aplay` + Windows TBD | Three install paths, three test matrices, three lots of edge cases. ffplay is one. |
| **Energy-threshold + 300 ms debounce VAD (in-process JS)** | silero-vad via onnxruntime-node + `@ericedouard/vad-node-realtime` | Better accuracy in noisy rooms. Deferred to v1.4: (a) onnxruntime-node currently has known Bun load issues on Windows (Bun #18079) and broader JSC-vs-V8 native-module incompatibility, (b) adds ~15 MB install footprint plus a 5 MB Silero ONNX model. Re-evaluate when v1.4 ships if field reports surface false-negatives. |
| **Energy-threshold + 300 ms debounce VAD (in-process JS)** | WebRTC VAD via libfvad-wasm | The middle ground — better-than-energy accuracy, ~100 KB WASM, no native module. Could be the v1.4 choice if Silero ONNX proves too heavyweight. |
| **Energy-threshold + 300 ms debounce VAD (in-process JS)** | `@ricky0123/vad-node` | Explicitly winding down upstream — maintainer is not publishing new versions. Forbidden. |
| **One npm package + per-platform binaries via `optionalDependencies`** | postinstall script that downloads the right binary | Documented anti-pattern: supabase #1217, openai/codex #2766. Breaks behind corporate proxies, breaks offline installs, breaks `npm install --ignore-scripts`. Use the esbuild / swc / @next/swc / @tailwindcss/oxide pattern instead. |
| **One npm package + per-platform binaries via `optionalDependencies`** | Single platform-agnostic JS bundle (no Bun binary) | If code-signing pipeline is not ready for v1.3 ship (release operator does not have an Apple Developer ID this milestone). The bin shim's fallback path already handles this — set the macOS optionalDependencies entries to no-op shims and the JS path runs under Node/Bun whichever is on the user's machine. Trade: ~50–100 ms cold-start regression on macOS until v1.4. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Electron** (any version) | The entire reason v1.3 exists is to delete the Electron shell. Electron renderer code never wired end-to-end in v1.2 production (debug session `achilles-silent-launch.md`). The IPC layer, BrowserWindow management, `safeStorage`, `globalShortcut`, `powerMonitor`, and Web Audio playback queue all evaporate. | Bun-runtime single-process terminal CLI |
| **electron-builder, electron-vite, electron-store, electron-rebuild** | All electron-toolchain. None survive. | Bun toolchain + plain JSON config at `~/.achilles/settings.json` |
| **Web Audio APIs (`AudioContext`, `AudioWorklet`, `decodeAudioData`, `AnalyserNode`, `MediaStream`, `MediaRecorder`)** | All renderer-only browser APIs. There is no renderer in v1.3 — the TUI runs in a terminal process. | sox stdout → typed array view for PCM frames; inline RMS computation for the level meter; ffplay stdin for playback |
| **react-dom** | No DOM. Ink uses `react-reconciler` directly with its own host config (Yoga + ANSI). Adding react-dom would bring a 130 KB+ dep and trigger Babel/JSX-runtime confusion. | Ink 7 (`react-reconciler` under the hood) |
| **chalk 4 (last CJS major)** | CJS-only. `apps/achilles-tui` is ESM-only (`"type": "module"`). Mixing CJS chalk into an ESM tree triggers `ERR_REQUIRE_ESM` chains under Node and dual-mode confusion under Bun. | chalk 5.6+ ESM-only |
| **wavesurfer.js** | File-oriented; live-input case awkward (upstream #578); 100 KB+ for no value here. Also, no canvas in a terminal. | Hand-rolled braille (U+2800–U+28FF) sparkline at ≈40 cells, computed inline |
| **`globalShortcut` / global hotkeys** | Was Electron-only in v1.2 (Cmd+Shift+A PTT). Terminal CLIs do not own a global hotkey context. v1.3 drops PTT entirely — always-listening VAD is the new model. (Mark this as a UX-visible behaviour change in release notes.) | Energy-threshold VAD always-listening + Ctrl-C to exit |
| **`safeStorage` / Electron keychain** | Electron-only. | OS env var `ELEVENLABS_API_KEY` (primary) + optional OS keychain via `@napi-rs/keyring` (if we ship a keychain integration in a later phase). keytar itself is deprecated since March 2026 — do not adopt it. |
| **`@ricky0123/vad-node`** | Discontinued upstream. The Node port is being wound down; no new versions planned. | Energy-threshold (v1.3) → `@ericedouard/vad-node-realtime` or `libfvad-wasm` (v1.4) |
| **`silero-vad` via `onnxruntime-node` (in v1.3)** | Bun #18079: onnxruntime-node load failure under Bun 1.2.5 on Windows. Broader JSC-vs-V8 native-module incompatibility — Node native `.node` files are compiled against V8 internals that Bun cannot use directly. Adds ~15 MB onnxruntime + ~5 MB Silero ONNX model. Not v1.3-shippable. | Energy threshold for v1.3; revisit Bun compat in v1.4 |
| **`@ricky0123/vad-web` / `onnxruntime-web` / Audio Worklet** | All renderer-only browser APIs from v1.2. No worklet in a terminal. | Energy threshold |
| **`naudiodon` / PortAudio bindings for v1.3** | Maintainer flags "not yet production-ready"; Bun-compat unverified; adds a native module the JSC-vs-V8 wall blocks. | sox child process |
| **`node-record-lpcm16` / `node-microphone` / `node-mic` npm wrappers** | All wrap sox; they add an npm dep without removing the system dep. | Direct `child_process.spawn("rec", [...])` — the wire format is identical and we don't pay the wrapper's extra abstraction. |
| **`speaker` (TooTallNate/node-speaker)** | Native module (mpg123 bundled, ~15 MB). Last published ~2 years ago. Bun-compat unverified. Not v1.3-shippable. | ffplay child process |
| **`afplay` / `aplay` / `paplay` (platform-specific)** | Three install paths, three test matrices, three edge cases. afplay is mac-only AND does not accept stdin. aplay/paplay are Linux-only. | ffplay (one binary, three OS install paths) |
| **postinstall scripts that fetch binaries** | Breaks behind corporate proxies, breaks `--ignore-scripts`, breaks offline. Documented anti-pattern. | `optionalDependencies` with `os`/`cpu` filters (esbuild pattern) |
| **yao-pkg / Node SEA in v1.3** | They work; they're just a worse cold start than Bun for our usage (Bun ~15 ms vs SEA ~30–60 ms vs yao-pkg ~60–90 ms). Useful as v1.4 fallback if a hard native-module dep emerges that breaks Bun. | Bun `--compile --target=...` |
| **`keytar`** | Repository archived 2026-03-25; last release 4 years ago; libsecret deprecation warnings on modern Linux. | `@napi-rs/keyring` if/when we add OS-keychain support |
| **OpenTUI in v1.3** | Pre-1.0, API in flux, Zig core via `bun:ffi` (experimental). Even faster than Ink, but production risk too high for v1.3. | Ink 7 (defer OpenTUI re-evaluation to v1.4) |
| **Blessed / blessed-contrib** | Inactive (chjj/blessed last meaningful update 2017); ~46K weekly downloads on inertia. Adopting a fork makes us own the support burden. | Ink 7 |
| **The `mic` npm package** | Wraps sox on macOS and arecord on Linux but adds a layer over the spawn — doesn't reduce the install set, doesn't change wire format. | Direct `child_process.spawn("rec", [...])` |
| **MCP server as the v1.3 voice-injection mechanism** | MCP lets Claude *call* Achilles, not the other way around. v1.3 still drives Claude as an external user via stdin. | `claude -p --input-format stream-json` subprocess via `@achilles/claude-code-bridge` |
| **`@anthropic-ai/claude-agent-sdk` (the v1.2 path)** | v1.2 replaced this with the hand-rolled `claude -p` subprocess wrapper for reasons documented in the v1.2 audit (sandbox env complexity, billing-pool concerns). Do not re-introduce in v1.3. | `@achilles/claude-code-bridge` unchanged |

---

## Stack Patterns by Variant

**If the user runs `npm install -g achilles` on a Bun-supported platform:**
- bin shim resolves `@achilles/cli-<platform>-<arch>` from `optionalDependencies`
- That sibling package contains one Bun-compiled binary (~60–100 MB unminified, smaller after `bun build --minify`)
- Cold start ~15 ms to first Ink frame after first sox/ffplay child spawn
- Update flow: `npm update -g achilles` pulls a new parent version, which pulls new platform sibling

**If the user runs `npm install -g achilles` on an unsupported platform (e.g., a Linux distro Bun has not been tested on, or a non-x64/arm64 arch):**
- All `optionalDependencies` resolve to no-op or are skipped by npm's `os`/`cpu` filter
- bin shim falls through to `import("./main.js")` which is the JS bundle
- Runs under the user's existing `node` (>=22) or `bun` on PATH
- Cold start ~50–80 ms (Node esbuild bundle) or ~15 ms (system Bun)

**If the user runs `bunx achilles voice`:**
- bunx installs the parent + the matching platform binary into its global cache
- Subsequent invocations are cache hits (~5 ms additional vs `npm install -g`)
- bunx is the recommended "I just want to try it" path

**If the Claude Code skill body invokes the CLI:**
- SKILL.md frontmatter `allowed-tools: Bash(achilles voice *)` gates Claude's permission to call `achilles voice`
- Bash tool spawns the binary in the foreground; Bash tool's default 120 s timeout is overridden to 600 000 ms in the skill body for long voice sessions
- Inside the spawned process, the TUI takes over the terminal pane; on Ctrl-C the process exits and Bash returns
- Skill allowed-tools edge case noted in v1.3-terminal-pivot.md §10.6 / claude-code #60515 — first Bash call auto-approves, subsequent calls may prompt; we mitigate by being a one-process-per-skill-invocation model (the user only runs `achilles voice` once per session)

**If the release operator does NOT have an Apple Developer ID for v1.3 ship:**
- macOS-arm64 + macOS-x64 optionalDependencies entries ship as JS-only shim packages
- macOS users fall through to the JS bundle path; sox + ffmpeg installation still required
- README documents `xattr -dr com.apple.quarantine $(which achilles)` workaround for users who insist on the Bun binary
- This is acceptable for v1.3 beta; v1.3 stable should ship signed (see PITFALLS.md macOS Gatekeeper entry)

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `bun@1.3.14` | Node-compat shim covers most `node:*` modules including `child_process`, `fs`, `path`, `util`, `events`, `stream`, `crypto`, `os`. Native `WebSocket` matches WHATWG spec exactly. | Bun does NOT typecheck — `tsc -p . --noEmit` must run in CI separately. |
| `node@22.x LTS` | Stable WebSocket Web API (since Node 22.4); stable test runner; permission model API surface | Floor for the source-compat fallback path. Node 22 enters Maintenance LTS Oct 2026 and EOL Apr 2027 — fine for v1.3 ship window. |
| `ink@7.0.5` | `react@^19.0.0` peer; Node 18+ documented (Bun 1.0+ also runs Ink without changes; OpenTUI and Ink share the same react-reconciler base in practice) | Ink 7 broke ink-spinner compatibility briefly in April 2026; `ink-spinner@5.0.0+` is the matching version. |
| `react@19.2.7` | `react-reconciler` (peer for Ink); the Ink reconciler version matches | Do not install `react-dom` — it's not needed and would inflate the bundle. |
| `@clack/prompts@1.5.1` | Bun ≥ 1.0; Node ≥ 18 | ESM-only. Pairs with `@clack/core@1.x` (peer). |
| `chalk@5.6.x` | ESM-only | Cannot coexist with chalk 4 in the dep tree — pin to 5.6.x exactly across the workspace to defend against dual-pkg-hazard. |
| `log-update@7.2.0` | ESM-only; Node 18+ | Used only when Ink falls back to raw-ANSI mode. |
| `sox@14.4.2` (system) | Stable wire format since 2015; the `rec` alias is present on macOS and Linux | Windows installs as `sox.exe`; use `sox.exe -q -d ...` instead of `rec`. |
| `ffmpeg@8.1.1` (system, includes `ffplay`) | Stable mp3 decode pipeline; `pipe:0` stdin path stable since 4.x | The `ffplay` binary is the same package as `ffmpeg` on every platform — one install line. |
| Surviving voice packages (`@achilles/voice-{protocol,stt,tts}@1.3.0`, `@achilles/claude-code-bridge@1.3.0`, `@achilles/achilles-skill@1.3.0`) | Bun ≥ 1.0 AND Node ≥ 22 (verified via DI seams) | Internal workspace deps; version bump v1.3.0 even though code is byte-for-byte identical for voice-protocol/stt/tts/claude-code-bridge — keeps the monorepo version-cascade clean. achilles-skill changes one SKILL.md line + tightens `allowed-tools`. |

---

## Risk Summary — Surfaced to the Roadmapper

These are the load-bearing assumptions where v1.3 implementation could derail. Each cross-references the deeper treatment in `v1.3-terminal-pivot.md` §10 (Risks and Open Questions).

| Risk | Severity | Mitigation in this stack | Cross-ref |
|------|----------|--------------------------|-----------|
| macOS TCC mic-permission inherited from parent terminal — VS Code integrated terminal may not have the entitlement | HIGH | `achilles init` runs sox-open smoke test; on EPERM, prints OS-specific instruction; README documents the VS Code-integrated-terminal failure mode prominently | §10.1 |
| macOS Gatekeeper quarantine on unsigned Bun-compiled binary | HIGH | If Apple Developer ID available: codesign + notarise in CI matrix. If not: macOS-arm64/x64 platform packages ship JS-shim; users get the slower JS path but skip Gatekeeper | §10.2 |
| Two system binary deps (sox + ffmpeg) is a regression from v1.2's bundled Electron | MEDIUM | `achilles init` runs `which sox && which ffmpeg`; surface install line on miss; optionally invoke `brew install sox ffmpeg` / `apt install` / `choco install` via subprocess | §10.3 |
| Bun child_process SIGINT forwarding to spawned process group on macOS | LOW | Bun 1.3+ documented to handle simple `pipe` stdio (which we use); smoke-test the SIGINT chain in Phase 17 with mock loop clients | §10.8 |
| onnxruntime-node + Bun for v1.4 silero swap | LOW (v1.3); HIGH (v1.4 contingency) | Energy-threshold VAD ships in v1.3; defer silero compat verification to a v1.4 spike before commit. If silero+Bun proves unworkable, fall through to libfvad-wasm or run silero in a Node sidecar process | §10.7 |
| Single-instance enforcement (two `achilles voice` in two terminals) | MEDIUM | `~/.achilles/voice.lock` PID file checked at startup; refuse second instance with clear message | §10.4 |
| Sleep/wake / device hot-swap (sox or ffplay dies on wake) | MEDIUM | Watch child exit codes; respawn cap 3-in-10s; document the failure mode; no powerMonitor equivalent in terminal | §10.5 |
| Claude Code skill Bash tool timeout vs long-running voice session | LOW | Skill body sets Bash timeout to 600 000 ms; voice sessions ≤ 10 minutes are well inside that budget | §10.6 |

---

## Sources

**Bun runtime (HIGH confidence — official docs verified 2026-06-08):**
- [Bun 1.3 release blog](https://bun.com/blog/bun-v1.3) — single-binary cross-compile, Anthropic acquisition referenced
- [Bun v1.3.14 release](https://bun.com/blog/bun-v1.3.14) — latest patch as of 2026-06-04
- [Bun v1.3.10 release](https://bun.com/blog/bun-v1.3.10) — Windows ARM64 cross-compile target
- [Bun single-file executables](https://bun.com/docs/bundler/executables) — `--compile --target=bun-{darwin,linux,windows}-{x64,arm64}`
- [Bun WebSockets](https://bun.com/docs/runtime/http/websockets) — native WebSocket, browser-compat, `ws` polyfill at `src/js/thirdparty/ws.js`
- [Bun spawn / child_process](https://bun.com/reference/node/child_process/spawn) — `posix_spawn(3)` underneath, 60% faster, killSignal/AbortSignal compat
- [Bun.spawn reference](https://bun.com/reference/bun/spawn) — signal forwarding, stdio modes

**Ink TUI (HIGH confidence — verified 2026-06-08):**
- [ink on npm](https://www.npmjs.com/package/ink) — current 7.0.5, React 19 baseline
- [ink GitHub](https://github.com/vadimdemedes/ink) — v7.0 April 2026 with React 19 (`useEffectEvent`), ~900K weekly downloads
- [ink-spinner on npm](https://www.npmjs.com/package/ink-spinner) — 5.0.0 for Ink 7 + React 19 compat
- [PkgPulse: Ink vs Clack vs Enquirer 2026](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026) — head-to-head positioning

**React 19 (HIGH confidence — verified 2026-06-08):**
- [react on npm](https://www.npmjs.com/package/react) — 19.2.7, released 2026-06-01
- [React 19.2 release blog](https://react.dev/blog/2025/10/01/react-19-2) — feature baseline
- [React versions](https://react.dev/versions) — LTS posture

**System binaries (HIGH confidence — official sources verified 2026-06-08):**
- [SoX Homebrew formula](https://formulae.brew.sh/formula/sox) — 14.4.2 with optional flac/lame/vorbis/opus
- [SoX 14.4.2 on SourceForge](https://sourceforge.net/projects/sox/files/sox/14.4.2/) — Win32 binaries
- [SoX Chocolatey package](https://community.chocolatey.org/packages/sox.portable) — sox.portable 14.4.1 on choco (slightly behind upstream)
- [ffmpeg 8.1.1 release](https://www.free-codecs.com/ffmpeg_download.htm) — 2026-05-04
- [ffmpeg endoflife.date](https://endoflife.date/ffmpeg) — release schedule

**Distribution pattern (HIGH confidence — verified 2026-06-08):**
- [esbuild PR #1621 — install via optionalDependencies](https://github.com/evanw/esbuild/pull/1621) — canonical reference for the pattern
- [esbuild platform-specific binaries on DeepWiki](https://deepwiki.com/evanw/esbuild/6.2-platform-specific-binaries)
- [pnpm 11.2 release](https://pnpm.io/blog/releases/11.2) — pnpm support for the optionalDependencies platform-binary pattern
- [Sentry: How to publish binaries on npm](https://sentry.engineering/blog/publishing-binaries-on-npm) — modern walkthrough

**Supporting libraries (HIGH confidence — verified 2026-06-08):**
- [@clack/prompts on npm](https://www.npmjs.com/package/@clack/prompts) — 1.5.1
- [chalk on npm](https://www.npmjs.com/package/chalk) — 5.6.x ESM-only series
- [chalk releases](https://github.com/chalk/chalk/releases) — 5.0+ ESM-only baseline
- [log-update on npm](https://www.npmjs.com/package/log-update) — 7.2.0, May 2026, ESM-only
- [ansi-escapes on npm](https://www.npmjs.com/package/ansi-escapes) — 7.2.0, Feb 2026

**Node.js LTS (HIGH confidence — verified 2026-06-08):**
- [Node.js previous releases](https://nodejs.org/en/about/previous-releases) — release schedule
- [Node.js endoflife.date](https://endoflife.date/nodejs) — 22 LTS until Apr 2027, 24 Active LTS, 26 current
- [PkgPulse: Node 22 vs Node 24 in 2026](https://www.pkgpulse.com/guides/nodejs-22-vs-nodejs-24-2026) — comparison

**Bun native-module compatibility (MEDIUM — verified through known issues):**
- [Bun #18079: onnxruntime-node doesn't work in 1.2.5](https://github.com/oven-sh/bun/issues/18079) — the v1.4 silero risk
- [onnxruntime-node compatibility](https://onnxruntime.ai/docs/reference/compatibility.html) — Node 16+, no formal Bun support
- [Bun vs Node 2026 production runtime — Pickuma](https://pickuma.com/posts/bun-vs-nodejs-2026-production-runtime/) — JSC vs V8 .node-file limitation
- [Bun compatibility 2026 — Alex Cloudstar](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/) — broad surface

**VAD (HIGH confidence on package status):**
- [@ricky0123/vad-node on npm](https://www.npmjs.com/package/@ricky0123/vad-node) — discontinuation note in README
- [vad-node-realtime fork](https://github.com/eric-edouard/vad-node-realtime) — community-active alternative for v1.4
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) — performance baseline

**Keychain (HIGH confidence on deprecation):**
- [keytar on npm](https://www.npmjs.com/package/keytar) — archived 2026-03-25
- [@napi-rs/keyring](https://github.com/Brooooooklyn/keyring-node) — recommended replacement

**v1.3 architectural source of truth (this repo):**
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/v1.3-terminal-pivot.md` — primary architecture research, §§1–12 + Appendix A
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/PROJECT.md` — milestone definition, target features, constraints
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/debug/achilles-silent-launch.md` — v1.2 live-validation root cause

---

*Stack research for: v1.3 Terminal-only Achilles — Bun-runtime CLI rendering Ink 7 + React 19 TUI, sox mic capture, ffplay TTS playback, energy-threshold VAD, single npm package with per-platform Bun-compiled binaries via optionalDependencies. Reuses the four shipped voice packages (`@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/claude-code-bridge`) and `@achilles/achilles-skill` untouched except for a one-line SKILL.md edit.*
*Researched: 2026-06-08*
