# Project Research Summary

**Project:** v1.3 Terminal-only Achilles — Bun-runtime CLI voice companion for Claude Code
**Domain:** Single-process terminal voice surface that runs the full voice loop inside the calling terminal (Ink TUI + sox + ffplay + energy-VAD), distributed as one npm package with per-platform Bun-compiled binaries plus a Claude Code skill that shells into the same binary
**Researched:** 2026-06-08
**Confidence:** HIGH for stack/architecture/feature reuse (the four surviving voice packages have validated DI seams; Bun + Ink + sox + ffplay are well-trodden 2026 patterns); HIGH for the v1.2 silent-launch replay-prevention catalogue (root-caused in `.planning/debug/achilles-silent-launch.md`); MEDIUM for macOS Gatekeeper end-state (depends on Apple Developer ID acquisition); MEDIUM for adaptive-VAD field tuning in noisy environments (energy threshold is best-effort; silero is the v1.4 upgrade path)

## Executive Summary

v1.3 is a deliberate architectural pivot, not a v1.2.1 patch. The v1.2 binary shipped with every requirement "code-side verified" yet the renderer voice loop was never wired end-to-end (preload IPC channels weren't exposed; renderer never instantiated mic capture or STT). v1.3 deletes the Electron shell entirely (`apps/achilles` + `apps/achilles-cli`), folds both into a single new `apps/achilles-terminal/` workspace, and runs the entire voice loop in one Bun process that renders Ink 7.0.5 + React 19.2.7 directly into the calling terminal. The four shipped voice packages (`@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/claude-code-bridge`) and `@achilles/achilles-skill` all survive byte-for-byte untouched — their `webSocketCtor` and `spawnImpl` DI seams (verified at exact line numbers in `packages/voice-stt/src/realtime-client.ts:95-98`, `packages/voice-tts/src/stream-client.ts:92`, `packages/claude-code-bridge/src/session.ts:71-78`) accept Bun's native `WebSocket` and node-compat `spawn` without modification. The single edit outside the new workspace is one SKILL.md line: `achilles launch` → `achilles voice`.

The recommended technical approach is opinionated across all four research streams: **Bun 1.3.14+** as primary runtime with `bun build --compile --target=...` producing five per-platform binaries shipped via `optionalDependencies` (the canonical 2026 esbuild/swc/biome pattern), **Node 22 LTS** as the JS-bundle fallback path via a 30-line bin shim, **Ink 7.0.5 + React 19.2.7** for the TUI (Ink 6 was referenced in v1.3-terminal-pivot.md but Ink 7 ships React 19 baseline and is what we should pin), **sox `rec`** child process for 16 kHz mono s16le PCM mic capture (zero native bindings, exact Scribe v2 wire format), **ffplay** child process for gapless MP3 TTS playback via stdin pipe (replaces the deleted v1.2 Web Audio queue), **hand-rolled energy-threshold + 60ms-voice-hold + 300ms-silence-hold VAD** in <60 lines of pure JS (replaces v1.2's PTT hotkey — silero-vad is the v1.4 upgrade behind the same `VadHandle` interface), and **@clack/prompts** for the `achilles init` wizard + `TypedFallback` inline text input when the STT circuit breaker trips. The v1.2 SAFE/LOOP/PROMPT contract ports verbatim through the new in-process EventEmitter architecture; the `SPEAKING_DEBOUNCE_MS = 300` half-duplex gate and the companion-prompt SHA-256 source-of-truth check both survive unchanged.

The key risks across all four research streams converge into five non-negotiable structural gates the roadmap must enforce. **(1) Skill body MUST stay foreground.** The v1.2 `apps/achilles-cli/src/commands/launch.ts:155` set `stdio: "ignore"` and detached the Electron app, which is part of why the silent-launch shipped — the launching terminal could not see the children failing. v1.3 SKILL.md must document `BASH_MAX_TIMEOUT_MS=86400000` in `~/.claude/settings.json` at the top of the body (because the Bash tool's default 120s timeout would otherwise kill any session longer than 2 minutes — anthropics/claude-code#5615), the skill body must run `achilles voice` foreground (no `&`, no `nohup`, no `disown`), and a lint rule must fail the build if `stdio.*ignore` reappears on the launch path. **(2) Phase 20 ships three real-binary asciicasts (RBS-1/2/3) as non-optional success criteria** — RBS-1 = fresh `npm install -g achilles@<this-build>` → `achilles init` → `achilles voice` → audible round-trip within 8s on darwin-arm64 + linux-x64 + win32-x64; RBS-2 = same loop invoked from inside Claude Code's skill body with `Bash(achilles voice *)`, asserting Ctrl-C cleanly tears down sox + ffplay + claude + WSS connections (no `ps`-visible orphans); RBS-3 = `--save-transcripts` round-trip + `transcripts list/purge` from the real binary. The auditor cannot mark v1.3 anything other than `tech_debt` without these three asciicasts committed to `.planning/milestones/v1.3-evidence/`. **(3) Apple Developer ID acquisition is the Phase 19 release gate** — without it, macOS binaries ship as a v1.3.0-beta with a README-documented `xattr -dr com.apple.quarantine` workaround and JS-fallback path; with it, the binaries are codesign + notarytool-stapled and Phase 20 SC-1 verifies via `spctl --assess --type execute` from a fresh macOS account. **(4) macOS TCC parent-process attribution is the silent-killer for VS Code + Cursor users** (microsoft/vscode#307364, May 2026) — `achilles init` must walk `ps` upward, detect the parent terminal emulator, and print a per-emulator remediation script; the VS Code-integrated-terminal case fails silently on macOS Sequoia without intervention. **(5) Phase 18 init wizard must run real-device smoke tests** (1-second sox open + 1-second ffplay open + 1-utterance round-trip) — not merely `which sox && which ffmpeg` — and ambient calibration (5 seconds of silence to seed the EWMA noise floor) is the smallest viable VAD onboarding.

## Key Findings

### Recommended Stack

The v1.3 stack is the minimum surface that delivers the terminal-only pivot, preserves every v1.2 SAFE/LOOP/PROMPT contract, and structurally prevents the v1.2 silent-launch failure mode. Distribution is one npm package `achilles@1.3.0` with `bin.achilles` pointing at a 30-line JS shim that prefers the per-platform Bun binary (resolved via `optionalDependencies` filtered by `os`/`cpu`) and falls back to a Node 22+ esbuild bundle when the binary is missing or quarantined. Full versions, install lines, and the rejected-alternatives matrix are in `STACK.md`.

**Core technologies:**

- **Bun 1.3.14+** — Primary runtime; `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64}` produces self-contained per-platform binaries with ~9-15ms cold start (vs Node 22 ~50-120ms). Bun is itself how Claude Code ships; the skill body invocation pathway is Bun-on-Bun. Native `WebSocket` (uWebSockets-backed, matches WHATWG spec) + native `child_process.spawn` shim (60% faster than Node via `posix_spawn(3)`) are exactly the two surfaces the surviving voice packages already inject through seams.
- **Node 22.x LTS** — Source-compat target + JS-bundle fallback runtime. Required because the TypeScript source must execute under both Bun and Node 22 so the bin shim's fallback path is real (not theoretical) and so the dual-runtime CI matrix can catch drift. Node 22 ships the WebSocket Web API as stable (no `ws` polyfill in source code).
- **Ink 7.0.5 + React 19.2.7** — TUI host. Ink 7 is the first release with first-class React 19 support (uses `useEffectEvent`); v1.3-terminal-pivot.md called for Ink 6 but Ink 7 supersedes it and is what we should pin. ~900K weekly downloads, used by Claude Code itself. 30 fps internal cap is well above our 20 fps audio-reactive target. Pulsing blob (7×7 Unicode block grid U+2580–U+259F) + braille sparkline (40 cells × 80 samples, U+2800–U+28FF) + state line reconcile cheaply because the DOM tree is ~100 visible cells.
- **sox 14.4.2** (system binary; `brew install sox` / `sudo apt install sox` / `choco install sox.portable`) — Mic capture via `rec -q -t raw -r 16000 -b 16 -e signed -c 1 -` produces Scribe v2 Realtime's exact required format with no in-process resampling and zero native bindings. Same install line semantics on all three platforms.
- **ffmpeg 8.1.1 / ffplay** (system binary; ffplay ships with the ffmpeg package) — TTS playback via `ffplay -nodisp -autoexit -loglevel quiet -fflags nobuffer -flags low_delay -i pipe:0` for gapless MP3 streaming from stdin. Replaces the deleted v1.2 renderer-side Web Audio `decodeAudioData` queue and removes the "clicky" small-chunk artefacts. Native MP3 frame-boundary handling keeps the `CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220]` cadence gapless.
- **Hand-rolled energy-threshold VAD** — `<60` lines of pure JS implementing RMS-over-frame + hysteresis (60ms voice-hold, 300ms silence-hold). Zero install cost, sub-millisecond per frame. The `VadHandle` interface is purpose-built so silero-vad swap-in is one file change for v1.4. silero is deferred because onnxruntime-node has known Bun load issues (Bun #18079) and adds ~20 MB install footprint.
- **@clack/prompts 1.5.1** — `achilles init` wizard, `achilles config` settings menu, and the inline `TypedFallback` text input when the STT circuit breaker trips. Bun-compat verified upstream. Replaces the deleted v1.2 Electron-based init window and `TypedFallback.tsx`.
- **chalk 5.6.x + log-update 7.2.0 + ansi-escapes 7.2.0 + commander 12.x** — ANSI color helpers (inside Ink `<Text>` style props), raw-ANSI fallback render loop (when Ink fails to detect a TTY), cursor escapes, and the subcommand router for `achilles voice/init/config/install-skill/transcripts/latency`. All ESM-only; the new workspace ships `"type": "module"`.
- **`@achilles/voice-protocol` + `voice-stt` + `voice-tts` + `claude-code-bridge` + `achilles-skill`** — All five workspace packages survive untouched (achilles-skill changes one SKILL.md line). The DI seams (`webSocketCtor`, `spawnImpl`) accept both Bun-native and Node-native implementations without code change.

**Critical version pin notes:**
- v1.3-terminal-pivot.md referenced Ink 6 throughout; SUMMARY locks Ink 7.0.5 as the correct pin (April 2026 major release; React 19 baseline; matches our state-hook patterns).
- Workspace layout locks at `apps/achilles-terminal/` + five sibling `apps/cli-<platform>-<arch>/` platform-binary packages (NOT `packages/cli-*` — `apps/` is the right home because these are distribution artifacts, not libraries).

### Expected Features

The full feature catalogue (table stakes, differentiators, anti-features, dependency graph) is in `FEATURES.md`. The v1.3 product preserves every v1.2 SAFE/LOOP/PROMPT requirement verbatim — only the input/output surface changes. Six structural feature classes drive Phase 15-20 scoping:

**Must have (table stakes for v1.3 to ship):**
- **TUI shell with 5-state colors + reactive pulsing blob + braille sparkline + status row** — visual continuity with v1.2's floating circle + canvas waveform. Without these, the terminal surface feels like a generic CLI.
- **Energy-threshold VAD always-listening with mute toggle (`m` key)** — replaces the v1.2 Cmd+Shift+A PTT hotkey. The mute toggle is a privacy expectation; lacking it is a red flag.
- **sox child for mic capture + ffplay child for TTS playback** — replaces v1.2 `getUserMedia` + Web Audio playback queue. Hard external system deps with per-platform install lines surfaced in `achilles init`.
- **Half-duplex turn-taking via existing `SPEAKING_DEBOUNCE_MS = 300`** — ported verbatim from v1.2 `session.ts:112`. The constant doesn't care whether the playback is Web Audio or ffplay; the primitive holds.
- **`achilles init` wizard with sox/ffmpeg preflight + 1-utterance smoke test + ambient noise calibration** — cold-start friction killer. The 5-second ambient calibration seeds the adaptive VAD threshold (without it, energy-threshold VAD fails for ~50% of users in non-quiet rooms).
- **API key storage hierarchy: `ELEVENLABS_API_KEY` env var → `~/.achilles/settings.json` → (v1.4) OS keychain via `@napi-rs/keyring`** — preserves SAFE-01 under no-Electron runtime; keytar is deprecated (March 2026) so do not adopt it.
- **macOS parent-emulator detection + per-terminal remediation script on EPERM** — Phase 18 catches the VS Code/Cursor TCC silent-failure mode (microsoft/vscode#307364) and prints the exact "open Terminal.app, run `achilles init` once there" instruction.
- **`achilles install-skill` symlink (one-line `launch` → `voice` diff in SKILL.md)** — preserves DIST-02 verbatim. The SHA-256 source-of-truth check from v1.2 ports unchanged.
- **All v1.2 SAFE/LOOP/PROMPT carryovers:** circuit breaker (SAFE-05), sandwich defence (SAFE-04), opt-in `--save-transcripts` + `transcripts list/purge` (SAFE-02), ElevenLabs-only allowlist (SAFE-03), companion-prompt SHA-256 source-of-truth (PROMPT-01..05), stuck-thinking watchdog, latency probe + `--report` subcommand, typed fallback when STT circuit opens.
- **Single-instance `~/.achilles/voice.lock` PID file** — prevents two `achilles voice` sessions from fighting for the mic. Cleaned up on graceful exit + SIGINT/SIGTERM.
- **sox/ffplay child-exit respawn watchdog (3-in-10s cap)** — handles suspend/resume + device hot-swap without process restart. No equivalent of Electron's `powerMonitor`; bounded respawn is the floor.
- **Screen-reader mode via `INK_SCREEN_READER` / `useIsScreenReaderEnabled` + `--plain` non-TTY downgrade + `NO_COLOR`/`FORCE_COLOR` honour** — accessibility floor. The braille sparkline is NOT accessible to NVDA/JAWS/Speakup; the accessible mode suppresses the visual region and emits one announcement per state transition.

**Should have (competitive differentiators):**
- **Cold-start <50ms via Bun `--compile` per-platform binaries** — no competing terminal voice tool ships Bun-compiled binaries today. Below 50ms is "instantaneous" to the user; Node 22 + tsx is ~150ms.
- **Runs inside the same terminal as Claude Code (true ambient surface)** — v1.2 was a separate floating window; v1.3 lives inline. Users never alt-tab; voice prompt and Claude's terminal output stream in the same pane. This is a perception-of-craft win no other voice product delivers.
- **Voice-aware system prompt (PROMPT-02 + PROMPT-03) tuned for spoken playback** — ≤12-word ack + ≤40-word `<spoken-summary>` block with explicit "forbidden inside the block" formatting rules. The most defensible voice-UX differentiator across all reference products (kstonekuan/gemini-voice has no voice-out; Gemini CLI `/talk:start` is a proposal; Claude Code's built-in `/voice` is dictation-only).
- **Gapless TTS via ffplay stdin pipe** — quality improvement, not just a port; removes the v1.2 Web Audio "clicky" artefacts.
- **First-class typed fallback that feels like a real input mode, not a degraded state** — when STT degrades, drop into `@clack/prompts.text()` inline in the same terminal; preserves sandwich defence + voice output.
- **`achilles latency --report`** — P50/P95 across rolling sessions for transparency.

**Defer to v1.4+ (explicit anti-features OR not yet validated as the blocker):**
- silero-vad ONNX upgrade (defer until field reports of energy-VAD missing speech)
- OpenTUI migration (defer until OpenTUI ships 1.0 and 6 months stable)
- Push-to-talk hotkey opt-in (explicit anti-feature in v1.3 — reintroduces macOS Accessibility permission wall + conflicts with Claude Code's spacebar PTT)
- Full barge-in / mid-TTS interrupt (heavy infra for marginal value over 300ms tail debounce)
- Wake-word ("Hey Achilles") — explicit anti-feature (false-fire on every "Hey" in conversation; Anthropic's own `/voice` chose no wake word)
- In-loop voice swap without session restart (flicker risk dominates A/B value; `achilles config` handles cross-session voice change)
- Floating-window mode preservation (hard delete in v1.3 — doubling the Electron + Bun + Node matrix is exactly the cost v1.3 exists to eliminate)
- Persistent transcripts on by default (security/privacy red flag; `--save-transcripts` opt-in stays)
- Custom local STT/TTS models (out of scope per PROJECT.md)
- Multi-user voice rooms (out of scope per PROJECT.md)

### Architecture Approach

The architecture collapses v1.2's two-process Electron model (main + renderer over `ipcMain.handle()` + `webContents.send()` IPC, ~1,300 LOC) into one Bun process where the orchestrator exposes a typed `EventEmitter` and the Ink hook subscribes directly via `useSyncExternalStore`. Detailed component-by-component wiring, in-process boundaries, and the build-order rationale are in `ARCHITECTURE.md`. Process model: one Bun parent owns the Ink render loop (stdout TTY raw mode) + orchestrator + state machine + STT WSS + TTS WSS + three child processes (sox lives session-long, claude lives session-long, ffplay one-per-spoken-segment).

**Major components:**

1. **`apps/achilles-terminal/src/cli.ts`** — CLI entry; argv parse, settings load, companion.md resolve, composition root that hands factories into Session, Ink render(), SIGINT/SIGTERM cleanup install. Runs under Bun (primary) and Node 22 (fallback).
2. **`apps/achilles-terminal/src/session.ts`** — Orchestrator. ~80% verbatim port of `apps/achilles/src/main/session.ts`; the IPC envelope wrappers are stripped and replaced with direct in-process function calls. Owns the state machine + half-duplex gate + failure-override path + the `EventEmitter` that broadcasts state → UI.
3. **`apps/achilles-terminal/src/state-machine.ts` + `normalisation.ts` + `sandwich-defence.ts` + `incident-detection.ts` + `transcript-store.ts` + `latency-probe.ts` + `stuck-thinking-watchdog.ts`** — Port verbatim from v1.2 main process. Pure reducers over `(State | Event) → State`; the v1.2 audit checks for SAFE-01..06 and LOOP-01..07 all port unchanged.
4. **`apps/achilles-terminal/src/audio/mic-capture-sox.ts` + `playback-ffplay.ts` + `vad-energy.ts`** — NEW. Spawn sox `rec` (or `sox.exe` on Windows) with the exact Scribe v2 wire format flags, emit `Int16Array` frames + per-frame RMS scalar. Spawn ffplay one-per-segment with low-latency flags; push voice-tts mp3 bytes to stdin; listen for `exit` to drive the `SPEAKING_DEBOUNCE_MS = 300` half-duplex tail. Energy VAD with 60ms voice-hold + 300ms silence-hold + adaptive noise-floor EWMA.
5. **`apps/achilles-terminal/src/ui/VoiceShell.tsx` + `Blob.tsx` + `Sparkline.tsx` + `StateLine.tsx` + `useAchillesState.ts`** — NEW. Ink 7 + React 19 component tree; one `setInterval(50ms)` driving a tick state for the 20fps audio-reactive blob + 40-cell braille sparkline. `useSyncExternalStore` projects orchestrator state into React. Read-only view.
6. **`apps/achilles-terminal/src/init-wizard.ts` + `commands/{voice,init,config,install-skill,transcripts,latency}.ts`** — NEW + ported subcommands. Init wizard uses `@clack/prompts` linear flow (API key → sox/ffmpeg/claude check → 1-second mic + ffplay open → ambient calibration → 1-utterance smoke test → intro screen). Subcommands route via commander.
7. **`apps/achilles-terminal/src/store.ts` + `key-source.ts` + `lock-file.ts`** — Rewritten: `~/.achilles/settings.json` replaces `electron-store`; env var > settings file > (v1.4) OS keychain; `~/.achilles/voice.lock` PID file single-instance guard.
8. **`@achilles/voice-protocol` + `voice-stt` + `voice-tts` + `claude-code-bridge` + `achilles-skill`** — UNCHANGED (one SKILL.md line edit in achilles-skill). Their DI seams accept Bun's native `WebSocket` and node-compat `spawn` without modification.
9. **`apps/achilles-terminal/dist/cli.js` (the 30-line bin shim)** — Node script that resolves `@achilles/cli-<platform>-<arch>` via `optionalDependencies`, execs the Bun binary if present, falls back to `import("./main.js")` (the esbuild Node 22+ bundle) if quarantined or missing.
10. **Five sibling platform-binary packages: `apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/`, `apps/cli-linux-x64/`, `apps/cli-linux-arm64/`, `apps/cli-win32-x64/`** — Each ships one Bun-compiled binary (~60-100 MB) in its tarball; `os`/`cpu` fields filter install. The canonical esbuild/swc/biome/turbo distribution pattern.

**Data flow (end-to-end voice turn):** User speaks → sox emits 16kHz s16le frames every ~64ms → orchestrator listener calls `sttClient.send(frame)` + `vad.observe(rms, dt)` + `session.emit("rms-sample", rms)` → VAD `speech_start` transitions state to `listening` (Ink re-renders green) → user finishes speaking → 300ms silence → VAD `speech_end` triggers `sttClient.commit()` → Scribe `committed` event → state `processing` (yellow) → `claudeBridge.send(transcript)` → first `text_delta` arrives → `extractAck` detects ack boundary → `ttsClient.openStream` → state `speaking` (blue) → mp3 bytes flow voice-tts events$ → ffplay.stdin.write → first audible byte at ~600-800ms P50. ffplay drains stdin EOF on `stream_complete`, exits, orchestrator schedules 300ms tail, re-arms mic, state returns to `listening`. **Latency budget identical to v1.2** — Scribe/Claude/Flash are unchanged; v1.3 just removes the ~5-10ms Electron IPC overhead per stage.

**The single most important architectural change vs v1.2:** all arrows between orchestrator and audio/UI/clients are now in-process function calls and `EventEmitter` subscriptions. The Electron `ipcMain.handle()` / `contextBridge.exposeInMainWorld()` round trip is gone. ~1,300 LOC of IPC bridge + preload + shared schemas deletes. Latency drops to nanoseconds; reconciliation no longer threatened by IPC backpressure; one log to read when debugging.

### Critical Pitfalls

The full pitfall catalogue (10 critical + technical-debt + integration + performance + security + UX + "Looks Done But Isn't" checklist + recovery strategies + phase mapping) is in `PITFALLS.md`. Every pitfall maps to a concrete Phase 15-20 prevention gate and a verification artifact (asciicast / real-binary smoke / dual-runtime CI / VS Code-integrated-terminal capture). The top 5 are non-negotiable:

1. **"Verified code-side but broken in the shipped binary" (the v1.2 silent-launch replay).** v1.2 had every requirement verified code-side, the audit signed off, and the renderer voice loop was never wired end-to-end. v1.3 has at least 8 new seams that can replay this shape (Bun binary vs JS fallback; sox exit vs handler; ffplay stdin vs voice-tts iterator; VAD vs STT commit; LDJSON line buffer; SIGINT propagation; Ink paint vs amplitude; suspend/resume without `powerMonitor`). **Prevention:** Phase 17 ships an in-process MOCK_LOOP smoke gate that runs on every PR + Phase 20 ships three real-binary asciicasts (RBS-1/2/3) as non-optional success criteria with paired wav captures committed to `.planning/milestones/v1.3-evidence/`. Forbid `stdio: "ignore"` on the launch path via a lint rule. The auditor cannot mark v1.3 anything but `tech_debt` without the asciicasts.

2. **macOS TCC microphone permission attributed to the wrong process.** When `achilles voice` is launched from VS Code's integrated terminal (or Cursor's, or via Claude Code's Bash tool inside Cursor), macOS Sequoia walks up the process tree looking for a "responsible process" with `NSMicrophoneUsageDescription` + a code signature + an existing TCC grant. On macOS Sequoia the kernel may NOT prompt the user at all — child processes invoked from VS Code's terminal "cannot request TCC permissions" (microsoft/vscode#307364, May 2026). Same shape as v1.2 silent-launch from a different cause. **Prevention:** Phase 18 init wizard runs a 1-second sox open, catches EPERM/EACCES, walks `ps` upward to detect parent terminal emulator, and prints a per-emulator remediation script. For VS Code/Cursor: instruct the user to run `achilles init` ONCE from Terminal.app to grant mic at the system level. Phase 19 skill body includes `achilles init --skill-check` pre-flight. Phase 20 SC-1 captures asciicast on macOS-arm64 invoked from inside VS Code's integrated terminal (not only from Terminal.app).

3. **macOS Gatekeeper / quarantine on the Bun-compiled binary blocks first launch.** Bun-compiled binaries downloaded from npm carry a quarantine extended attribute. On macOS Sequoia + tightened quarantine rules, an unsigned binary may refuse to launch with `zsh: killed: achilles` and no UI prompt. **Prevention:** Phase 19 has a release-gate decision at the top: signed or unsigned for this release. If signed, acquire Apple Developer ID BEFORE Phase 19 starts (release-operator owned but milestone-gating). Build: `codesign --entitlements entitlements.plist --deep --options runtime --sign "Developer ID Application: ..." achilles --force --timestamp` + `notarytool submit ... --wait` + `spctl --assess --type execute --verbose` verification from a fresh macOS account. If unsigned (v1.3.0-beta only, not v1.3.0 stable), surface the `xattr -dr com.apple.quarantine` line in README + ship the Node-bundle fallback path so the binary still runs (slower cold start; functional). Do NOT auto-strip quarantine programmatically (Apple anti-malware heuristics).

4. **Skill body process lifecycle conflicts with Claude Code's Bash tool.** Bash tool default timeout is 120s (issue #5615); orphan-on-SIGTERM (#45717) propagates the signal to Claude Code itself when tmux is involved; multi-Bash-call permission re-prompt bug (#60515). **Prevention:** SKILL.md MUST document `BASH_MAX_TIMEOUT_MS=86400000` in `~/.claude/settings.json` at the top of the body. The skill body MUST be foreground-only (no `&`, no `nohup`). Phase 17 implements a `gracefulShutdown(reason)` that tears down in <1s telescoped order: SIGINT to claude bridge → SIGTERM sox → `stdin.end()` + 200ms SIGTERM ffplay → WSS close 1000 → flush latency-probe + transcript-store → Ink unmount → `process.exit(0)`. Registered with `process.once` (not `on`) so second SIGINT escalates rather than re-triggers. Detach `claude` child into its own process group. Phase 19 SKILL.md `allowed-tools` narrows to specific patterns (NOT broad `Bash`) to reduce #60515 blast radius.

5. **Energy-threshold VAD false-starts in noisy rooms / misses speech in quiet rooms.** Static thresholds (`VOICE_THRESHOLD = 0.02`) break in three directions: coffee shop (50-65 dBA above threshold → continuous trigger, bills ElevenLabs for nothing); soft voice (<35 dBA → never trigger, silent shape); bursty noise (keyboard clack >100ms → tight WSS open/close loop). Worse variant: TTS playback through speakers bleeds back into mic + room reverb extends beyond the 300ms half-duplex tail. **Prevention:** Phase 16 ships adaptive thresholds via EWMA noise floor (α=0.05, `VOICE_THRESHOLD = noiseFloor * 3`, ~10dB above floor per Wikipedia VAD). Phase 18 init wizard adds 5-second "ambient calibration" — user stays silent, we measure room noise, persist as initial estimate. Phase 16 adds self-trigger guard: after `tts_playback_complete` + 300ms tail, require 500ms post-speech silence verification before re-arming. Minimum-utterance-length floor (ignore `speech_end` if duration <300ms — kills keyboard-click false commits). `--debug-vad` flag streams RMS + threshold + state to stderr at 50ms cadence. Phase 20 includes a noisy-environment field test asciicast (65 dBA lo-fi playlist next to laptop).

**Beyond the top 5, four additional Critical pitfalls deserve roadmap attention:** (6) sox/ffmpeg detection failure mode is too quiet — `which sox && which ffplay` returns paths but device-open fails (no default device / Bluetooth in HFP / PipeWire mismatched / sox x86 on Apple Silicon throws "Unknown system error -86"); (7) ffplay buffering tradeoff makes TTS feel laggy OR gappy — requires Phase 17 benchmark of `-fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0` against representative TTS chunks + backpressure on stdin write + SIGTERM cancel path; (8) Bun ↔ Node runtime drift — WSS close codes, async iteration micro-batching, `process.exit()` semantics differ subtly; Phase 15 must ship dual-runtime CI matrix; (9) Ink reconciliation thrash at 20fps — Phase 16 must measure CPU <10% during 10-minute animation on Windows Terminal v1.18, throttle partial transcripts to 10fps, never re-mount Ink root.

## Implications for Roadmap

The four research streams converge on a six-phase structure (Phase 15-20, ~3 weeks). Each phase produces a discrete artifact that can be smoke-tested. Voice packages stay surface-stable across all six phases; the new `apps/achilles-terminal/` workspace stands up additively in Phase 15 and the old `apps/achilles` + `apps/achilles-cli` survive through Phase 18 and delete together at end of Phase 19 once the skill is rewired.

### Phase 15: Workspace Scaffold + Bun Build Pipeline

**Rationale:** Atomic cutover requires a parallel-safe new workspace. The old Electron + npm-shim apps need somewhere to copy from through Phase 16-17. Dual-runtime CI matrix (Pitfall 8 prevention) ships here so all subsequent phases catch drift.
**Delivers:** `apps/achilles-terminal/` workspace + 5 sibling `apps/cli-<platform>-<arch>/` empty platform-binary packages; `bun build --compile --target=...` matrix wired in `.github/workflows/release.yml`; esbuild Node 22+ fallback bundle (`dist/main.js`); 30-line `dist/cli.js` shim; dual-runtime CI matrix (every test under both `bun test` AND `vitest`); `achilles --version` invocation works on all five platforms.
**Uses:** Bun 1.3.14+, Node 22 LTS, pnpm workspaces, Turborepo (existing).
**Avoids:** Pitfall 8 (Bun ↔ Node runtime drift baked into the binary by the time we hit distribution); replays of the "we mid-deleted Electron and now nothing builds" failure mode.
**Research flag:** STANDARD — Bun cross-compile + esbuild + optionalDependencies are well-trodden 2026 patterns documented exhaustively in STACK.md + ARCHITECTURE.md.

### Phase 16: Ink TUI Shell + State Machine Port + sox Mic Capture + VAD

**Rationale:** The TUI shell is the load-bearing visible surface; without it Phase 17 can't validate the voice loop against a real visual. The state machine ports verbatim from v1.2 (the most valuable code). sox capture needs to exist before the voice-stt wiring in Phase 17. VAD adaptive thresholds are critical (Pitfall 6) and must ship together with VAD itself.
**Delivers:** `state-machine.ts` + `normalisation.ts` port (zero changes); `VoiceShell.tsx` + `Blob.tsx` + `Sparkline.tsx` + `StateLine.tsx` + `useAchillesState.ts` Ink components; `mic-capture-sox.ts` with sox child + exit-code handler + bounded respawn; `vad-energy.ts` with adaptive EWMA noise floor + minimum-utterance-length floor + post-speech silence verification; `--debug-vad` flag; five visual states (idle/listening/processing/speaking/error) all rendered; `achilles voice --mock` invocation drives amplitude from `mock-amplitude.ts` plus real sox loop.
**Uses:** Ink 7.0.5 + React 19.2.7; sox 14.4.2; pure JS energy VAD; existing v1.2 `mock-amplitude.ts` + `mock-loop-clients.ts` ported verbatim.
**Avoids:** Pitfall 4 (sox/ffmpeg silent device-open failure — exit-code handler + bounded respawn 3-in-10s); Pitfall 5 (Ink reconciliation thrash — perf budget gate, CPU <10% on Windows Terminal v1.18); Pitfall 6 (energy-VAD false-starts/misses — adaptive thresholds + minimum-utterance-length + self-trigger guard).
**Research flag:** NEEDS RESEARCH — adaptive VAD thresholds in the field aren't fully validated; Phase 16 should spike the EWMA tuning against representative recordings before locking. Ink perf budget against Windows Terminal v1.18 also needs measurement.

### Phase 17: End-to-end Voice Loop Wired + Graceful Shutdown

**Rationale:** This is the load-bearing phase that makes the actual product real. The session.ts port (~80% verbatim) consolidates Phase 16's foundation. ffplay benchmark (Pitfall 7) belongs here because the orchestrator owns the playback subprocess. gracefulShutdown (Pitfall 10) belongs here because it touches every component the orchestrator owns.
**Delivers:** `session.ts` ported from v1.2 with IPC bridge calls stripped + replaced with direct `EventEmitter` function calls; `@achilles/voice-stt` wired with `webSocketCtor: globalThis.WebSocket`; `@achilles/claude-code-bridge` wired with `spawnImpl: spawn`; `@achilles/voice-tts` wired same; `playback-ffplay.ts` with benchmarked low-latency flags + backpressure on stdin.write + SIGTERM cancel path with 1s deadline; half-duplex turn-taking via `SPEAKING_DEBOUNCE_MS = 300` port; sandwich defence + normalisation + extractAck + extractSpokenSummary ports unchanged; failure-override path (PROMPT-05) ports unchanged; `gracefulShutdown(reason)` function with `process.once` SIGINT/SIGTERM handlers + telescoped 1.5s teardown budget + `claude` child detached into own process group; `proc.unref()` on every spawn before any `process.exit()`; WebSocket close-code normaliser shim; MOCK_LOOP=1 integration test ports unchanged + becomes the upstream CI smoke gate.
**Uses:** Existing `@achilles/voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge` (all unchanged — DI seams used directly).
**Avoids:** Pitfall 1 (MOCK_LOOP smoke gate catches refactor breakage before Phase 20 verification); Pitfall 7 (ffplay benchmark + backpressure); Pitfall 8 (runtime-independent shim layer); Pitfall 9 (process-group detach for claude; foreground-only model); Pitfall 10 (gracefulShutdown + WSS close 1000 + lock file cleanup).
**Research flag:** NEEDS RESEARCH — ffplay flag benchmark (100 trials of representative chunks) needs spike before lock; SIGTERM-propagation behaviour under Bun-on-tmux verification on 3 OSes; `proc.unref()` Bun-specific edge cases.

### Phase 18: Init Wizard + Config + Transcripts Management

**Rationale:** Cold-start friction is the #1 CLI drop-off cause. The init wizard MUST ship together with sox/ffmpeg preflight + ambient calibration + per-terminal-emulator TCC remediation script. SAFE-02 opt-in transcripts + latency probe ports here because they belong on the wizard's adjacent surface.
**Delivers:** `init-wizard.ts` using `@clack/prompts` linear flow — (1) API key (env var detection → settings file → prompt with paste-friendly input); (2) sox/ffmpeg/claude detection with real 1-second open + stderr parse against known-error table (not merely `which`); (3) macOS parent-emulator detection via `ps` walk + per-emulator remediation script (VS Code/Cursor → "open Terminal.app once" script; iTerm2/Terminal.app/ghostty/Warp → expect prompt); (4) ambient noise calibration (5-second silence → seed EWMA noise floor → persist to `~/.achilles/settings.json`); (5) 1-utterance smoke test (real ElevenLabs round-trip); (6) intro screen on first run, persisted; `store.ts` replacing electron-store; `transcripts list/purge` subcommand ports verbatim; `latency --report` subcommand port; opt-in `--save-transcripts` JSONL with 0o600 perms + secret redaction; `achilles config` subcommand with `@clack/prompts` settings menu.
**Uses:** @clack/prompts 1.5.1; chalk 5.6.x.
**Avoids:** Pitfall 2 (macOS TCC parent-process — per-emulator remediation script); Pitfall 4 (sox/ffmpeg real-device smoke, not just which); Pitfall 6 (ambient calibration is the smallest viable VAD onboarding).
**Research flag:** STANDARD — `@clack/prompts` patterns + secret-redaction patterns + transcript JSONL rotation are all well-documented in FEATURES.md sources.

### Phase 19: Distribution — Skill Rewire + Publish Pipeline + Gatekeeper

**Rationale:** Distribution is the ship gate. SKILL.md edit is one line but lands at end of phase so the skill cuts over atomically with the publish. Apple Developer ID acquisition is the explicit release-operator gate at start of phase (NOT during). Old `apps/achilles-cli` + `apps/achilles` delete at end of phase, AFTER `npm publish` succeeds.
**Delivers:** One-line `packages/achilles-skill/skill/SKILL.md` edit (`achilles launch` → `achilles voice`) + frontmatter `allowed-tools: Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)` (narrow patterns, NOT broad `Bash`) + `BASH_MAX_TIMEOUT_MS=86400000` documentation prominently at top of body; SHA-256 source-of-truth check ports unchanged (runs against new package layout); `achilles install-skill` symlink (absolute, not relative — Windows fallback copies); macOS codesign + notarytool pipeline for darwin-arm64 + darwin-x64 with Apple Developer ID (acquired before Phase 19 starts); Windows unsigned + SmartScreen instructions in README; Linux Bun-compiled ELF + chmod +x; tarball-no-secrets scan ports + `strings dist/achilles | grep -E "sk_[a-f0-9]{48,}"` MUST be empty test; per-OS GitHub Actions runners publish from native hosts (cross-compile from macOS to Windows is supported but production CI matrices per-OS to handle code-signing); npm publish for `achilles` + all 5 `@achilles/cli-<platform>-<arch>` from one CI workflow; `apps/achilles-cli/` and `apps/achilles/` delete at end of phase.
**Uses:** Bun cross-compile + esbuild Node bundle + Apple codesign/notarytool + GitHub Actions matrix.
**Avoids:** Pitfall 3 (Gatekeeper — codesign + notarytool stapled + `spctl --assess` verification from fresh account; v1.3.0-beta fallback with xattr instructions if cert not acquired); Pitfall 9 (`BASH_MAX_TIMEOUT_MS` doc + foreground-only skill body + narrow allowed-tools).
**Research flag:** NEEDS RESEARCH — Apple Developer ID acquisition timeline is an unknown (release-operator owned; v1.2 audit listed this as open); Windows code signing decision (EV cert vs SmartScreen unsigned) needs explicit go/no-go before Phase 19 start; cross-host signing edge cases.

### Phase 20: Hardening + Real-Binary Asciicast Gates (Ship Gate)

**Rationale:** This phase exists to structurally prevent the v1.2 silent-launch replay. The three real-binary asciicasts (RBS-1/2/3) are non-optional success criteria — the audit cannot pass v1.3 without them committed to `.planning/milestones/v1.3-evidence/`. Circuit breaker + lock file + stuck-thinking watchdog port here because they round out v1.2 SAFE/LOOP parity at the very end against a published baseline.
**Delivers:** `incident-detection.ts` circuit-breaker port verbatim; `stuck-thinking-watchdog.ts` port (60s no-streaming-output trigger); `lock-file.ts` single-instance guard with `kill -0` liveness check + auto-cleanup on stale PID; sox/ffplay respawn-on-exit watchdog cap 3-in-10s with clear surface error on cap-exceeded; audio-device-change detection (sox exit code 1 → soft respawn); `TypedFallback` via `@clack/prompts.text()` when STT breaker opens; v1.2 audit checklist for SAFE-01..06 + LOOP-01..07 re-run against v1.3 implementation; ElevenLabs WSS idle timeout (close after >120s in idle, reopen on next speech_start) to prevent billing leak; **RBS-1 asciicast** = fresh `npm install -g achilles@<this-build>` → `achilles init` (incl. ambient calibration) → `achilles voice` → "hello achilles" → audible round-trip within 8s + post-Ctrl-C `ps` clean + WSS close 1000 logged, captured on darwin-arm64 + linux-x64 + win32-x64 with paired wav files; **RBS-2 asciicast** = same fresh install → `achilles install-skill` → restart Claude Code → invoke skill body → Ctrl-C tears down all children cleanly + no #60515 re-prompt; **RBS-3 asciicast** = `--save-transcripts` 3-utterance session → `transcripts list/purge` works; **noisy-environment SC** = asciicast captured with 65 dBA lo-fi playlist next to laptop, asserting VAD doesn't continuously trigger; **VS Code-integrated-terminal SC** = asciicast captured from inside VS Code terminal on macOS-arm64 showing EPERM detection + remediation message path.
**Uses:** Existing v1.2 `incident-detection.ts`, `stuck-thinking-watchdog.ts`, `transcript-store.ts` ports.
**Avoids:** Pitfall 1 (the ship gate that catches "verified code-side but broken in binary" — three asciicasts on fresh OS accounts); Pitfall 2 (VS Code terminal SC); Pitfall 6 (noisy-environment SC); Pitfall 10 (post-Ctrl-C `ps` clean inspection in RBS-1).
**Research flag:** NEEDS RESEARCH — asciinema + audio-capture tooling per platform needs spike (especially Windows wav capture); the noisy-environment SC needs explicit pass criteria (false-positive rate cap during 30s of music).

### Phase Ordering Rationale

- **Phases 15-17 cannot be parallelised** (16 needs 15's build pipeline; 17 needs 16's TUI shell + sox capture). Phases 18-20 have some parallelism: Phase 18 can run alongside latter half of Phase 17 if there's a second engineer.
- **Voice packages stay surface-stable across all six phases.** Nothing in `packages/voice-*` or `claude-code-bridge` changes. This is the entire reason the pivot is feasible in 6 phases — the load-bearing wire-protocol work doesn't redo.
- **Adaptive VAD ships in Phase 16, not Phase 20.** Static thresholds are unshippable per Pitfall 6; the EWMA + minimum-utterance-length + self-trigger guard belong with the VAD itself. Ambient calibration in Phase 18 is the user-facing companion piece.
- **gracefulShutdown ships in Phase 17, not Phase 20.** It touches every component the orchestrator owns; deferring it lets shutdown bugs accumulate across Phase 18-19.
- **Apple Developer ID acquisition is the Phase 19 release gate, not a Phase 19 deliverable.** Without it, Phase 19 starts; with the v1.3.0-beta fallback decision documented up front; with it, Phase 19 starts with codesign in CI from day one.
- **Real-binary asciicasts are the ship gate, not a Phase 20 nice-to-have.** They are the structural prevention for the v1.2 silent-launch failure shape. The auditor cannot mark v1.3 anything but `tech_debt` without them committed.

### Research Flags

Phases likely needing deeper research during planning (run `/gsd:plan-phase --research-phase N`):
- **Phase 16:** Adaptive VAD EWMA tuning against representative recordings; Ink perf budget measurement against Windows Terminal v1.18.
- **Phase 17:** ffplay low-latency flag benchmark (100 trials); SIGTERM-propagation under Bun-on-tmux verification on 3 OSes; `proc.unref()` Bun edge cases.
- **Phase 19:** Apple Developer ID acquisition timeline (release-operator gated); Windows code-signing decision (EV vs SmartScreen unsigned); cross-host signing edge cases.
- **Phase 20:** asciinema + audio-capture tooling per platform; noisy-environment SC pass criteria.

Phases with standard patterns (skip research-phase, plan directly):
- **Phase 15:** Bun cross-compile + esbuild Node bundle + optionalDependencies pattern are exhaustively documented (esbuild, swc, biome, turbo precedents).
- **Phase 18:** `@clack/prompts` linear flows + secret-redaction + transcript JSONL rotation are well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Bun, Ink 7, sox, ffplay, optionalDependencies pattern, ElevenLabs wire integration all officially documented + validated in v1.2 (for the voice packages). MEDIUM only for macOS Gatekeeper end-state (depends on Apple Developer ID acquisition timing) and v1.4-deferred items (silero ONNX under Bun, naudiodon). |
| Features | HIGH | Table stakes carry over from v1.2's 30 verified requirements + are validated against direct precedents (kstonekuan/gemini-voice, Gemini CLI `/talk:start` proposal, Claude Code's built-in `/voice`). MEDIUM only for differentiator scoping in a 12-month-old category. HIGH for anti-features (industry consensus + v1.2-specific decisions already validated). |
| Architecture | HIGH | Package reuse map verified at exact line numbers (`webSocketCtor` seams at `realtime-client.ts:95-98` and `stream-client.ts:92`; `spawnImpl` seam at `session.ts:71-78`; `SPEAKING_DEBOUNCE_MS = 300` at `session.ts:112`; companion.md export at `achilles-skill/src/index.ts:107-110`). Bun-compile + optionalDependencies pattern is mainstream 2026 distribution. MEDIUM on cross-runtime test seam (Bun's vitest adapter is stable but existing test suite hasn't run under Bun yet — call-out, not blocker). |
| Pitfalls | HIGH | v1.2-failure-mode replays grounded in `.planning/debug/achilles-silent-launch.md`; macOS TCC + Gatekeeper + Bun cold-start surface verified against 2026 official + community sources (microsoft/vscode#307364, claude-code#5615, #45717, #60515, bun#7208, npm/cli#4828). MEDIUM only for ffplay buffering choice (low-latency flags well-documented but our specific chunk schedule unverified end-to-end) and Ink reconciliation at 20fps with our specific component count (no published numbers for this exact surface). |

**Overall confidence:** HIGH

### Gaps to Address

- **Apple Developer ID acquisition timeline.** Release-operator owned per v1.2 audit §5.2; status as of v1.3 milestone open is unknown. **Handle:** make this an explicit Phase 19 release-gate question (signed for v1.3.0 stable vs unsigned for v1.3.0-beta with documented xattr workaround). Surface in requirements scoping.
- **Adaptive VAD field tuning in noisy environments.** Energy-threshold + EWMA is the v1.3 best-effort; silero ONNX is the v1.4 upgrade behind the same `VadHandle` interface. **Handle:** Phase 16 ships `--debug-vad` flag for in-the-field tuning; Phase 20 noisy-environment SC validates the pass criteria; v1.4 spike on Bun + onnxruntime-node compat (Bun #18079).
- **ffplay flag benchmark not yet run.** Recommended starting point is `-fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0` but 100-trial benchmark in Phase 17 may surface need to drop `-fflags nobuffer` for resilience against upstream jitter. **Handle:** Phase 17 deliverable, ~1 hour of work; document chosen flags in `playback-ffplay.ts` constants with benchmark provenance.
- **Bun-on-Bun SIGTERM propagation under tmux.** anthropics/claude-code#45717 documents SIGTERM in Bash tool propagating to Claude Code itself when tmux is involved. v1.3 must survive that bug. **Handle:** Phase 17 detaches `claude` child into own process group via `setpgid`; Phase 20 RBS-2 explicitly captures the tmux + skill-body + Ctrl-C path on all three OSes.
- **VS Code-integrated-terminal TCC on macOS Sequoia.** microsoft/vscode#307364 confirms the failure mode but the workaround (run `achilles init` once from Terminal.app) needs in-the-field validation. **Handle:** Phase 18 ships the remediation script; Phase 20 captures asciicast from inside VS Code's terminal on macOS-arm64.
- **Cross-runtime test seam (Bun vs Node 22) — existing v1.2 vitest suite hasn't been exercised under Bun yet.** **Handle:** Phase 15 dual-runtime CI matrix as a build-pipeline checkbox, not feature work. If a test passes under one runtime and fails under another, that's a Phase 15 gate, not a downstream surprise.

## Sources

### Primary (HIGH confidence — verified 2026-06-08)

**Internal architecture source-of-truth:**
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/v1.3-terminal-pivot.md` — implementation-ready architecture; §§1–12 + Appendix A
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/v1.2-reuse-audit.md` — reuse classification map
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/STACK.md` — version pins, install lines, rejected alternatives
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/FEATURES.md` — table stakes, differentiators, anti-features catalogue
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/ARCHITECTURE.md` — in-process boundaries, build order, test seams
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/PITFALLS.md` — phase-mapped replay-prevention catalogue + "Looks Done But Isn't" checklist
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/PROJECT.md` — v1.3 milestone definition, target features, constraints
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/debug/achilles-silent-launch.md` — v1.2 live-validation root cause (the failure shape v1.3 must structurally prevent)
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/milestones/v1.2-MILESTONE-AUDIT.md` — verification debt the v1.3 phase gates close

**Bun runtime (official docs):**
- bun.com/blog/bun-v1.3, bun-v1.3.14, bun-v1.3.10 (Windows ARM64 cross-compile target)
- bun.com/docs/bundler/executables (--compile --target=bun-{darwin,linux,windows}-{x64,arm64})
- bun.com/docs/runtime/http/websockets, bun.com/reference/node/child_process/spawn
- bun.com/docs/guides/runtime/codesign-macos-executable

**Ink + React (official + community 2026):**
- npmjs.com/package/ink (7.0.5), github.com/vadimdemedes/ink (v7.0 April 2026, React 19 useEffectEvent)
- github.com/vadimdemedes/ink/discussions/657 (30fps cap rationale)
- React 19.2.7 react.dev/blog/2025/10/01/react-19-2

**System binaries (HIGH):**
- formulae.brew.sh/formula/sox, sourceforge.net/projects/sox/files/sox/14.4.2/
- ffmpeg 8.1.1 release (2026-05-04); endoflife.date/ffmpeg

**Distribution pattern (HIGH):**
- github.com/evanw/esbuild/pull/1621 (canonical optionalDependencies reference)
- pnpm.io/blog/releases/11.2 (platform-binary pattern support)
- sentry.engineering/blog/publishing-binaries-on-npm

**Supporting libraries (HIGH):**
- npmjs.com/package/@clack/prompts (1.5.1)
- chalk 5.6.x ESM-only series; log-update 7.2.0 (May 2026); ansi-escapes 7.2.0 (Feb 2026)

**Node.js LTS (HIGH):**
- nodejs.org/en/about/previous-releases; endoflife.date/nodejs (Node 22 LTS until Apr 2027)

### Secondary (MEDIUM confidence — community sources cross-referenced)

**Bun native-module compatibility:**
- github.com/oven-sh/bun/issues/18079 (onnxruntime-node + Bun — v1.4 silero risk)
- github.com/oven-sh/bun/issues/7208 (Bun-compiled binary deep-sign — historical, resolved 1.2+)
- pickuma.com/posts/bun-vs-nodejs-2026-production-runtime/ (JSC vs V8 .node-file limitation)

**macOS TCC / Gatekeeper:**
- github.com/microsoft/vscode/issues/307364 (VS Code integrated terminal TCC silent failure — May 2026)
- github.com/pingdotgg/t3code/issues/728 (same shape for camera + mic)
- mjtsai.com/blog/2025/07/07/the-curious-case-of-the-responsible-process/

**Claude Code skill body lifecycle:**
- code.claude.com/docs/en/skills; platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool
- github.com/anthropics/claude-code/issues/45717 (SIGTERM propagation to Claude Code via tmux)
- github.com/anthropics/claude-code/issues/5615 (BASH_DEFAULT_TIMEOUT_MS + BASH_MAX_TIMEOUT_MS)
- github.com/anthropics/claude-code/issues/60515 (multi-Bash-call re-prompt bug)

**VAD literature:**
- arxiv 2312.05815 (adaptive threshold algorithms in noisy environments)
- picovoice.ai/blog/complete-guide-voice-activity-detection-vad/ (production VAD 2026 guide)
- snakers4/silero-vad (the v1.4 upgrade target)

**Terminal voice precedents (direct competitors, <12 months old):**
- kstonekuan/gemini-voice (March 2026 — dictation-only)
- google-gemini/gemini-cli#6929 (/talk:start proposal, validates voice-out direction)
- PATAPIM Terminal IDE (Whisper voice dictation, different category)

### Tertiary (LOW — informational, validated during planning)

- OpenTUI / @opentui/react (Zig core + Bun FFI; v1.4 watchlist; pre-1.0 in mid-2026)
- @napi-rs/keyring (v1.4 keychain integration candidate; keytar deprecated March 2026)
- libfvad-wasm (v1.4 middle-ground VAD option if silero ONNX too heavyweight)

---

*Research completed: 2026-06-08*
*Ready for roadmap: yes — Phase 15-20 structure with explicit prevention gates per phase, three non-optional Phase 20 real-binary asciicast deliverables, Apple Developer ID acquisition surfaced as Phase 19 release gate*
