# Requirements: Achilles v1.3 — Terminal-only Voice Companion

**Defined:** 2026-06-08
**Core Value:** A developer can hand off intent to their terminal coding agent through the most natural surface available — phone screen (Handoff) or voice (Achilles) — without leaving their local environment behind.
**Milestone goal:** Rebuild the voice companion as a single Bun-runtime terminal package that runs the full voice loop inside the calling terminal, deleting the Electron .app and renderer entirely while reusing every voice + bridge package untouched.

## v1.3 Requirements

Requirements for the v1.3 release. Each maps to roadmap phases 15-20.

### Distribution (DIST)

- [ ] **DIST-01**: User can install Achilles globally via `npm install -g achilles` or invoke ad-hoc via `bunx achilles voice` without prior install
- [ ] **DIST-02**: Per-platform Bun-compiled binary (`@achilles/cli-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}`) auto-selected via `optionalDependencies`; a pure-JS bin shim falls back to a bundled Node entrypoint when no platform binary matches
- [ ] **DIST-03**: User runs `achilles install-skill [--force]` to register the Claude Code skill via the npm-bundled `SKILL.md` (one-line `achilles launch` → `achilles voice` diff in the skill body)
- [ ] **DIST-04**: User running `/achilles` from Claude Code launches the same binary as the npm CLI path; the embedded `companion.md` is SHA-256-verified at build time against the source of truth
- [ ] **DIST-05**: Cold-start latency from skill body invocation to first TUI render is <50ms on supported platforms with the native binary, and <200ms on the JS fallback path
- [ ] **DIST-06**: macOS users on signed builds bypass Gatekeeper without `xattr -dr com.apple.quarantine` workaround (gated on Apple Developer ID acquisition; unsigned beta fallback documented with explicit xattr instructions if cert is unavailable at ship time)

### Terminal UI (TUI)

- [ ] **TUI-01**: User sees a 7×7 Unicode-block-character (U+2580–U+259F) reactive blob that pulses with mic RMS while speaking and with TTS amplitude while Achilles speaks
- [ ] **TUI-02**: User sees a 40-cell braille sparkline waveform (U+2800–U+28FF, 80-sample rolling RMS history) beneath the blob
- [ ] **TUI-03**: TUI uses five distinct state colors (idle=gray, listening=green, processing=yellow, speaking=blue, error=red) with idle breathing animation (sinusoidal 0.3+0.1·sin envelope) and processing pulse (0.5+0.3·sin envelope)
- [ ] **TUI-04**: TUI shows a single status row beneath the visual surface displaying `[state] <last 60 chars of partial transcript>`, with a visible "REC" tag when `--save-transcripts` is active
- [ ] **TUI-05**: TUI renders at 20fps (50ms tick) without dropping frames at <10% CPU on Windows Terminal v1.18 / iTerm2 / Ghostty / Terminal.app
- [ ] **TUI-06**: TUI renders inline in the calling terminal pane (Bun foreground process); auto-downgrades to plain-text log lines when `process.stdout.isTTY` is false, or when `--plain` is passed explicitly

### Accessibility (ACC)

- [ ] **ACC-01**: TUI honors `NO_COLOR` and `FORCE_COLOR` env vars per no-color.org standard
- [ ] **ACC-02**: TUI detects screen readers via `INK_SCREEN_READER=1` env var or Ink's `useIsScreenReaderEnabled()` hook; in screen-reader mode the blob and sparkline are suppressed entirely and only state-change announcements (`<Text aria-live="polite">`) + committed transcripts are emitted, with explicit wording per state ("Achilles listening." / "Achilles processing your request." / etc.)

### Audio Capture (CAP)

- [ ] **CAP-01**: User's microphone is captured via a `sox` child process (`rec -q -t raw -r 16000 -b 16 -e signed -c 1 -`) producing 16k mono PCM s16le frames forwarded to `voice-stt` via the existing `webSocketCtor` DI seam (no resampling needed for Scribe v2)
- [ ] **CAP-02**: Speech start/end is detected automatically by an energy-threshold VAD (60ms voice-hold + 300ms silence-debounce) with an adaptive EWMA noise floor and a self-trigger guard during TTS playback; the PTT/toggle hotkey from v1.2 is removed entirely
- [ ] **CAP-03**: User can press `m` to mute (toggles VAD off without exiting the session); muted state is visibly indicated in the TUI status row
- [ ] **CAP-04**: VAD thresholds (`voice_threshold`, `silence_threshold`, `voice_hold_ms`, `silence_hold_ms`) are user-configurable via `~/.achilles/settings.json`; `--debug-vad` flag prints per-frame energy for field tuning

### Audio Playback (PLAY)

- [ ] **PLAY-01**: TTS audio plays gaplessly via an `ffplay` child process (`-nodisp -autoexit -loglevel quiet -fflags nobuffer -flags low_delay -i pipe:0`) consuming MP3 chunks streamed via stdin from `voice-tts` over the existing `CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220]` schedule
- [ ] **PLAY-02**: Half-duplex turn-taking preserved: mic gated during TTS playback + 300ms playback-tail debounce (SPEAKING_DEBOUNCE_MS port from v1.2)

### End-to-end Voice Loop (LOOP)

- [ ] **LOOP-01**: Full voice loop wired: `sox` → VAD → `voice-stt` WSS → committed transcript → sandwich-wrap → `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <embedded-companion-md>` subprocess → stream-json parser → ack region + `<spoken-summary>` block extracted → `voice-tts` WSS → `ffplay` stdin pipe
- [ ] **LOOP-02**: Four voice packages (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`) reused untouched via existing `webSocketCtor` / `spawnImpl` DI seams; `packages/achilles-skill/skill/prompts/companion.md` byte-for-byte identical; SHA-256 source-of-truth CI check ported from v1.2
- [ ] **LOOP-03**: Only the ≤12-word opening acknowledgement and the contents of the closing `<spoken-summary>` block (≤40 words) reach TTS playback; tool calls, code, paths, and intermediate explanations stay silent on the terminal
- [ ] **LOOP-04**: Failure-override phrase ("I ran into a problem") authoritatively triggered from claude subprocess exit code + tool_result events; never derived from LLM narration
- [ ] **LOOP-05**: User pressing Ctrl-C cancels: SIGINT routes through existing `claude-code-bridge` cancellation chain (SIGINT → SIGTERM → SIGKILL escalation with 300ms tail) + `voice-tts.close()` + ffplay child kill; gracefulShutdown completes in <1.5s
- [ ] **LOOP-06**: User can resume a prior session via `achilles voice --resume <sid>` (carryover from v1.2 LOOP-07); lock-file semantics respected
- [ ] **LOOP-07**: Claude Code skill body shells out to `achilles voice` as a foreground process (NOT detached like v1.2); `SKILL.md` documents `BASH_MAX_TIMEOUT_MS=86400000` at top; the `claude` child is detached into its own process group via `posix_spawn(detached:true)` so Bash-tool SIGTERM from Claude Code does not propagate (anthropics/claude-code#45717 workaround)

### Init / Onboarding (INIT)

- [ ] **INIT-01**: `achilles init` wizard via `@clack/prompts` walks API key resolution → sox/ffmpeg preflight → ambient calibration → 1-utterance smoke test linearly
- [ ] **INIT-02**: API key resolution hierarchy: `ELEVENLABS_API_KEY` env var → OS keychain via `@napi-rs/keyring` → encrypted `~/.achilles/key.enc` (libsodium secretbox, 0o600 perms); env var always wins on read
- [ ] **INIT-03**: Wizard runs `which sox && which ffmpeg` preflight; on miss prints platform-specific install line (`brew install sox ffmpeg`, `sudo apt install sox ffmpeg`, `choco install sox.portable ffmpeg`); offers to invoke the package manager subprocess if `which brew/apt/choco` succeeds
- [ ] **INIT-04**: Wizard runs 5-second ambient calibration to set initial VAD noise floor + 1-utterance smoke test exercising the full mic → STT → claude → TTS → ffplay path; on success writes `~/.achilles/init.json` marker that `achilles voice` checks to skip the wizard
- [ ] **INIT-05**: `achilles init` is idempotent and re-runnable; shows "keep current" defaults for every prompt; prints a final summary diff before writing
- [ ] **INIT-06**: On sox EPERM/EACCES, error names the parent terminal emulator (resolved via `process.ppid` + `ps -p $PPID -o comm=`) and prints explicit System Settings → Privacy & Security → Microphone path; ships a per-emulator remediation script for VS Code / Cursor / iTerm / Terminal.app / Ghostty
- [ ] **INIT-07**: `achilles --version` works without API key, sox, or ffmpeg (argv parse precedes any pipeline boot)

### Privacy + Security (SAFE)

- [ ] **SAFE-01**: ElevenLabs API key main-process-only (env / keystore / encrypted file); never appears in any log file even with `--debug` flag (7-regex redaction pattern ported from v1.2 tarball scanner); 0o600 perms enforced on encrypted-file fallback
- [ ] **SAFE-02**: Transcripts off by default; `--save-transcripts` opt-in writes JSONL with secret redaction to `~/.achilles/transcripts/`; `achilles transcripts list / purge` subcommands; 30-day retention default (carryover from v1.2)
- [ ] **SAFE-03**: ElevenLabs-only outbound network allowlist enforced at `packages/voice-protocol/src/transport.ts:assertElevenLabsHost` (carryover from v1.2, no change)
- [ ] **SAFE-04**: Single-instance lock at `~/.achilles/voice.lock` with PID liveness check (`kill -0`); refuses to start second instance with "Another achilles voice session is running (pid 12345). Press Ctrl-C in that terminal first."; cleaned up on graceful exit + SIGINT/SIGTERM handlers

### Error Visibility + Resilience (ERR)

- [ ] **ERR-01**: Inline error banner (one-line red row above status row) names error class (network / auth / rate-limit / sox / ffplay / claude) and proposes next action; auto-dismisses after 8s or on next successful event
- [ ] **ERR-02**: STT + TTS WSS connects guarded by circuit breaker (threshold + cooldown + full-jitter backoff, carryover from v1.2 SAFE-05); ElevenLabs 429 produces explicit messaging "ElevenLabs rate limit — retrying in Ns" via existing `classifyHttpError`
- [ ] **ERR-03**: sox + ffplay child-exit watchdog respawns bounded (max 3 attempts in 10s window); on cap-exceeded transitions to error state with "Audio device lost — restart Achilles"
- [ ] **ERR-04**: Typed-input fallback via inline `@clack/prompts.text()` activated when STT circuit opens; typed transcript flows through the same sandwich-wrap single-pipeline entry as voice transcripts
- [ ] **ERR-05**: Stuck-thinking watchdog (carryover from v1.2): if `claude -p` emits no stream-json line for 60s, the TUI surfaces "Claude has been thinking for 60s — Ctrl-C to cancel"
- [ ] **ERR-06**: Suspend/resume + device hot-swap recovery: child-exit-code polling detects sox/ffplay EIO after wake; respawns and resets state machine to idle
- [ ] **ERR-07**: `achilles voice --debug` enables verbose latency-probe + line-trace logging to `~/.achilles/debug-<ts>.log` (key redacted); `achilles latency --report` prints rolling-window P50/P95 speech-end → ack-spoken from `~/.achilles/latency/` JSON files (LOOP-06 port from v1.2)
- [ ] **ERR-08**: Unconditional structured logger writes to `~/.achilles/achilles.log` on every run regardless of flags; closes the v1.2 silent-stdio gap that hid the renderer-wiring defect (key still redacted; rotates at 10MB)

### Ship Gate — Real-Binary Verification (GATE)

- [ ] **GATE-01**: Three real-binary asciicasts (RBS-1 darwin-arm64, RBS-2 linux-x64, RBS-3 win32-x64) captured from fresh OS user accounts running the published binary end-to-end (init wizard → first `achilles voice` → speak → spoken summary → Ctrl-C clean exit) and committed to `.planning/milestones/v1.3-evidence/`; auditor cannot pass v1.3 without all three
- [ ] **GATE-02**: One asciicast captured from inside VS Code's integrated terminal on macOS Sequoia 15.4+ covering the TCC parent-emulator attribution path (microsoft/vscode#307364 worst case)
- [ ] **GATE-03**: Noisy-environment field test at 65 dBA confirming VAD does not false-fire on background noise (music + typing + nearby voices)
- [ ] **GATE-04**: ESLint rule forbidding `stdio: "ignore"` on the launch path (prevents v1.2 detached-stdio regression); Bun 1.3+ + Node 22+ dual-runtime CI matrix runs the full vitest suite green on every commit

## v2 Requirements

Deferred to v1.4 or beyond. Tracked but not in current roadmap.

### Voice Selection

- **VOICE-01**: User can pick from curated ElevenLabs voices via `achilles config` (in-loop voice swap remains out of scope to avoid mid-conversation flicker)

### Advanced VAD

- **VAD-01**: silero-vad via `onnxruntime-node` behind same `VadHandle` interface (defer until Bun #18079 onnxruntime issue resolves OR energy-VAD misses in field justify the upgrade)

### TUI Evolution

- **TUI-08**: OpenTUI migration (Bun-FFI Zig core) — defer until OpenTUI ships 1.0 + 6 months stable

### Cloud Routing

- **CLOUD-01**: Cloud-hosted Claude Code routing (deferred from v1.2 explicit ask; local-only ships in v1.3)

### Resumed Work

- **HOFF-01..04**: v1.1 Handoff install + `/handoff` command + authless hosted launch + automatic local bridge bootstrap (paused since v1.2 pivot)

### Diagnostic Tooling

- **DIAG-01**: `achilles debug doctor` subcommand running all preflight checks + reporting versions
- **DIAG-02**: Persistent latency-report JSON dashboard between sessions

## Out of Scope

Explicit exclusions. Anti-features from FEATURES.md captured here.

| Feature | Reason |
|---------|--------|
| Configurable global hotkey for PTT | Re-introduces macOS Accessibility / Input Monitoring permission wall that v1.3 is explicitly dropping; fights Claude Code's spacebar PTT bindings. Power users tune VAD thresholds in `~/.achilles/settings.json` instead. |
| Full barge-in / mid-TTS interrupt with full-duplex audio | Heavy infra investment (200-400ms turn-taking, <2% false-barge, <60ms TTS flush) for marginal value over Ctrl-C; breaks half-duplex SPEAKING_DEBOUNCE invariant. |
| Wake-word ("Hey Achilles") | False-fires constantly in dev environments (music, video calls, conversation). Always-on VAD already delivers the frictionless feel without engine cost. |
| Reading entire Claude Code transcript aloud | Tool calls, code, paths, JSON don't play as speech. Companion prompt enforces ack + `<spoken-summary>` only. |
| Editable transcript before send | Breaks ambient conversational rhythm. Typed fallback exists for users who want to compose. |
| Settings popover UI / clickable config surface | Terminal doesn't have a stable click input model; `achilles config` subcommand via `@clack/prompts` replaces it. |
| Floating window mode (keep v1.2 Electron HUD as option) | Defeats the entire point of v1.3; doubles the build/test matrix forever. Hard delete; re-evaluate in v1.5 if user data justifies. |
| In-product voice cloning UX | ElevenLabs already has it; users paste cloned voice ID into `~/.achilles/settings.json`. |
| In-loop voice picker (without session restart) | Mid-conversation TTS swap creates flicker + inconsistency. `achilles config` then restart is the cleaner contract. |
| Persistent transcript log on disk by default | Audio + transcripts of dev work are sensitive (proprietary code, secrets). Default-on retention would surprise users. v1.2 SAFE-02 opt-in preserved. |
| File paths / code identifiers in spoken summary | `companion.md:83+` forbids paths, identifiers, code blocks, ANSI in the spoken block. Paths read aloud are unparseable. |
| `--detach` flag backgrounding the voice session | Backgrounding the Ink foreground process loses the visual surface. Use the OS-native terminal pane split instead. |
| Inbound WebSocket / HTTP server for remote control | Mixing Achilles + Handoff surfaces expands the security boundary unnecessarily. Handoff already covers remote-from-phone use case. |
| Custom in-house STT/TTS models | Out of scope per PROJECT.md; would blow timeline and degrade quality vs ElevenLabs. |
| Real-time pitch / pace controls during TTS playback | Code is silent in v1.3; spoken summary is short prose by design. Non-problem. |
| Multi-user voice rooms / shared sessions | Out of scope per PROJECT.md; multi-mic routing, identity, shared TTS are a separate product. |

## Traceability

Filled by the gsd-roadmapper. Each requirement maps to exactly one phase (15-20). Phase ranges intended:

| Category | Likely Phase(s) | Reasoning |
|----------|----------------|-----------|
| DIST | 15 (scaffold + build pipeline) + 19 (publish + skill rewire) | Scaffold establishes binary path; publish actually ships |
| TUI | 16 (TUI shell) | Single phase owns the Ink + blob + sparkline + state machine port |
| ACC | 16 (TUI shell) | Shares render-tree code with TUI |
| CAP | 16 (TUI shell + sox + VAD) | Sox child + VAD live alongside the state machine |
| PLAY | 17 (end-to-end loop) | Ffplay sink lands with the actual TTS wiring |
| LOOP | 17 (end-to-end loop) | Core integration milestone — riskiest phase |
| INIT | 18 (init + config + transcripts) | Onboarding wizard + sox/ffmpeg preflight + key resolution |
| SAFE | 18-20 (init + hardening) | Most are ports; new ones (single-instance lock) bundle with init |
| ERR | 17 (loop wiring) + 20 (hardening) | Circuit breaker + watchdog ports happen during loop wiring; resilience polish in hardening |
| GATE | 20 (ship gate) | Real-binary asciicasts captured last |

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated by roadmapper) | | Pending |

**Coverage:**
- v1.3 requirements: 48 total
- Mapped to phases: 0 (pending roadmapper)
- Unmapped: 48

---
*Requirements defined: 2026-06-08*
*Last updated: 2026-06-08 after initial v1.3 milestone scoping*
