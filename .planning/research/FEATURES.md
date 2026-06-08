# Feature Research — v1.3 Terminal-only Achilles

**Domain:** Terminal-only voice companion for Claude Code (Bun-runtime CLI + Claude Code skill, single binary, Ink TUI in the calling terminal)
**Researched:** 2026-06-08
**Confidence:** HIGH for table stakes (verified against v1.2 surviving requirements, Claude Code skill docs, Ink screen-reader docs, Gemini CLI voice precedent, SoX error UX). MEDIUM for differentiator scoping (terminal-voice category is < 12 months old; kstonekuan/gemini-voice and PATAPIM are the only direct precedents). HIGH for anti-features (industry consensus on barge-in cost, wake-word fragility plus v1.2-specific decisions already validated).

**Pivot context:** This document supersedes the v1.2 floating-window scope. v1.2 shipped the Electron HUD + PTT hotkey + click-to-talk + drag-persist + voice picker popover; v1.3 deletes all of that and rebuilds the user-facing surface as a single terminal package that renders Ink 6 inside the calling terminal pane. The voice packages (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`) and the orchestrator core (`session.ts`, prompt contract, sandwich defence, latency probe, circuit breaker) survive unchanged. All v1.2 SAFE/LOOP/PROMPT requirements remain in force; only the UI and capture surface change.

## Reference Products Surveyed

| Product | Surface | Relevance to v1.3 |
|---------|---------|-------------------|
| **kstonekuan/gemini-voice** (gemini-cli extension, Mar 2026) | Terminal CLI with live waveform; `/voice` slash command in Gemini CLI | Direct precedent for "voice extension that runs in the terminal pane and renders a waveform." Confirms that subprocess-suppressed extension output is a real problem (their `/voice` cannot show the waveform inside Gemini CLI itself). Validates Achilles' choice to be its own foreground process, not an inline extension. |
| **Gemini CLI `/talk:start` proposal** (issue #6929) | Bidirectional voice in the same CLI session | Confirms the "talk-back" surface is the differentiator developers ask for; Achilles already had this in v1.2 and keeps it in v1.3. |
| **OpenCode** (terminal coding agent, Bubble Tea TUI) | Terminal-native TUI, multi-provider | Reference for TUI craft in the terminal-coding-agent category; ships Bubble Tea (Go), not Ink, but the visual density / status-line norms transfer. No native voice. |
| **PATAPIM Terminal IDE** | 9-terminal grid, Whisper voice dictation | Reference for "voice dictation inside a terminal environment" but a different category (IDE not skill). Their built-in Whisper is the closest local-only precedent. |
| **Claude Code itself** (Bun + Ink runtime) | Claude Code's own UI is Ink + Bun | Confirms Ink works at production scale on Bun; sets the visual idiom users already know. Achilles renders inside the same terminal Claude Code runs in. |
| **OpenCode 1.0 + OpenTUI** (Anomalyco) | TUI replacement category | Watch list for v1.4; pre-1.0 in mid-2026. Validates Ink is still the safe choice today. |
| **Wispr Flow / Aqua Voice** | Dictation tools, PTT-driven | Carryover from v1.2 reference set. v1.3 explicitly diverges from their PTT default — see anti-features. |
| **ChatGPT Advanced Voice Mode** | Always-on continuous voice (mobile baseline) | Validates the "always-listening + VAD" model that v1.3 is adopting. ChatGPT proves users tolerate continuous capture when the UI clearly signals state. |
| **Vapi / Retell** (voice agent platforms) | Production VAD turn-taking, barge-in patterns | Sets the 200-400ms turn-taking gap norm; validates Achilles' 300ms playback-tail debounce. |
| **OpenClaw CLI onboarding** | CLI init wizard pattern (2026) | Validates the `achilles init` shape: env-var first, OS keyring second, encrypted-config-file third. |
| **GitHub `gh` CLI auth pattern** | Reference CLI auth UX | Sets the bar for "find existing creds → fall back to env var → fall back to interactive prompt → write to OS keychain." |

## Feature Landscape

### Table Stakes (Users Expect These)

Features without which the v1.3 release feels broken. Complexity is **net new for v1.3** — features that survive verbatim from v1.2 are marked `S (port)`.

#### Voice Capture UX (changes from v1.2)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **VAD always-listening (energy threshold + 300ms silence debounce)** | The v1.2 PTT hotkey is being removed. Every continuous-voice product (ChatGPT, Pi, Vapi) ships some form of VAD; users opening `achilles voice` and getting silence is the worst-case first impression. The v1.3 design has VAD as the entire input gate, so it is non-negotiable. | M | NEW — no existing package | Energy threshold + 60ms voice-hold + 300ms silence-hold. Pure JS, <50 LOC. Lives in `apps/achilles-tui/src/audio/vad-energy.ts`. v1.4 swap path: silero-vad via onnxruntime-node behind the same `VadHandle` interface. |
| **SoX child process for 16k mono PCM mic capture** | Replaces v1.2 renderer `getUserMedia` + AudioWorklet. Without it there is nothing for STT to consume. SoX produces s16le 16kHz directly — exact format Scribe v2 expects, no resampling. | M | NEW — connects to `voice-stt` via existing seam | Spawn `rec -q -t raw -r 16000 -b 16 -e signed -c 1 -` and forward stdout as Int16 frames. Cross-platform (`rec` on mac/linux, `sox.exe` with `-d` flag on Windows). |
| **Visible audio-level meter while VAD is armed** | Users need to see "the mic is hot and hearing me" without speaking yet — the v1.2 floating window had the breathing circle for this. The terminal equivalent is a thin amplitude indicator under the blob so a quiet user knows their RMS is below threshold before they give up. | S | Reads sox RMS frames | One-line braille meter; reuses the same RMS scalar that drives the blob. |
| **Manual barge-in via Ctrl-C (cancels current TTS + Claude run)** | The v1.2 PTT hotkey doubled as a cancel surface. v1.3 has no global hotkey. Ctrl-C in the terminal pane is the universal cancel signal and users already pattern-match it. | S (port) | Wires to existing `claude-code-bridge` `cancellation.ts` + `voice-tts.close()` | Catch SIGINT in the foreground process; route through existing `onCancel` path in session.ts (already SIGINT→SIGTERM→SIGKILL escalation with 300ms tail). |
| **Mute control (toggle VAD without exiting)** | Users will need to take a phone call, swear at the build, or talk to a coworker without Achilles transcribing. Every voice product has this; lacking it is a privacy red flag. | S | None | Single-key toggle (e.g., `m`) caught by Ink's `useInput`; state machine adds `muted` substate of idle. |
| **OS-level mic permission detection on first `achilles voice`** | macOS TCC attributes mic access to the parent terminal emulator (iTerm, Terminal.app, ghostty, Cursor terminal, VS Code terminal). When sox fails with EPERM/EACCES the user must be told *exactly* which terminal app needs to be granted permission. v1.2 handled this with `systemPreferences.askForMediaAccess` — gone with Electron. | M | NEW | `achilles init` runs a 1-second `rec` test; on EPERM print: "Open System Settings → Privacy & Security → Microphone, and enable the terminal application named `<parent-emulator-name>`." Resolve parent via `process.ppid` + `ps -p $PPID -o comm=`. Windows: standard system prompt. Linux: surface PulseAudio/PipeWire instructions. |

#### TUI Feedback Density (the new user-facing surface)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **Reactive pulsing blob (Unicode block chars, 7x7 grid) driven by mic RMS / TTS amplitude** | The v1.2 floating circle was the single most-recognised feature. Re-rendering it as a 7x7 block-character blob in the terminal is the visual continuity bridge between v1.2 and v1.3. Without it the terminal surface feels like a generic CLI. | M | Reads RMS from sox during listening, TTS amplitude during speaking | Block characters U+2580-U+259F; intensity scales with amplitude; idle = gentle sinusoidal breathing (0.3–0.5); processing = swirling pulse (0.5–0.8). 7x7 chosen because it is large enough to read at a glance, small enough to fit alongside the spawning terminal output. |
| **Braille sparkline waveform (40 cells = 80 samples)** | The v1.2 32-bar canvas waveform is the second-most-recognised feature. Braille (U+2800–U+28FF) gives 8 vertical levels per cell with one character — best information density available in the terminal. | M | Reads rolling 80-sample RMS history (same source as blob) | Each cell encodes upper-and-lower half (2 samples) using dots 1-4 and 5-8. Single-row, no flicker, ~40 chars wide. Already prototyped in v1.3-terminal-pivot.md §4.3. |
| **Five distinct state colors (idle / listening / processing / speaking / error)** | Carryover from v1.2 UI-02 (Playwright-asserted in v1.2 audit). Without color the state surface is illegible. | S (port) | Reads from state machine | Maps `state → chalk color` in one table: idle=gray, listening=green, speaking=blue, processing=yellow, error=red. Color survives screen-reader output as a separate state-name announcement. |
| **State name + last partial transcript on a one-line status row** | v1.2 had a transcript overlay component. v1.3 collapses it into a single status line under the blob+sparkline showing `[state] <last 60 chars of transcript>`. | S | Reads from STT events $ | Truncate aggressively; the terminal scrollback above the Ink region is the authoritative transcript record. |
| **Render loop at 20fps (50ms tick)** | The v1.2 Web Audio loop ran at 50ms; matching the cadence keeps perceived smoothness identical. Ink coalesces React state updates so reconciliation is not the bottleneck at this rate. | S | None | Single `setInterval(50)` in the VoiceShell component driving a `tick` state. The blob and sparkline read the latest amplitude scalar / RMS history on each tick. |
| **Idle breathing animation** | Carryover from v1.2 (UI-03 implicit). A dead-still blob reads as "frozen" — terminal users will Ctrl-C immediately. | S | None | Sinusoidal amplitude envelope (0.3 + 0.1·sin(tick·0.1)) when state is idle. |
| **Processing animation distinct from listening/speaking** | Carryover from v1.2. When Claude Code is working, the user must see "thinking" so they do not speak again into a race condition. v1.2 used a swirl; v1.3 uses a higher-frequency amplitude pulse on the blob (0.5 + 0.3·sin(tick·0.3)). | S | Reads state machine | Same blob component, different envelope. |
| **Visible "REC" tag when `--save-transcripts` is active** | Carryover from v1.2 SAFE-02 (`RecordingIndicator.tsx`). Without an explicit "recording" badge, users will forget the flag is on and worry that audio is being persisted. | S (port) | Reads transcript-store state | Single red "REC" word appended to the status row. |

#### Init / Onboarding UX (the hidden killer for terminal CLIs)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **`achilles init` wizard using `@clack/prompts`** | Cold-start friction is the #1 cause of CLI drop-off. v1.2 had an Electron-based wizard window; v1.3 must replicate the same UX inside the terminal. `@clack/prompts` is the modern minimal-styled prompt library (v1.5.1, May 2026; used by Vite, Astro, Turborepo). | M | None | Five steps: (1) detect existing `ELEVENLABS_API_KEY` env var; (2) detect existing OS-keychain entry; (3) prompt for new key with paste-friendly input; (4) preflight `which sox` + `which ffmpeg`; (5) 1-second sox test + 1-utterance round-trip smoke test. |
| **SoX + ffmpeg preflight + per-platform install instructions** | These are external system dependencies. v1.2 bundled everything in Electron; v1.3 turns one install (`npm install -g achilles`) into three (`npm`, `brew install sox ffmpeg` or `apt install sox ffmpeg` or `choco install sox.portable ffmpeg`). If the wizard does not catch this with a clear message, the first `achilles voice` invocation fails silently. | S | None | `which sox` / `which ffmpeg`; on miss, print platform-specific install line (detect platform via `process.platform`) AND offer to invoke the package manager subprocess if `which brew`/`apt`/`choco` succeeds. Linux apt requires sudo — surface the prompt rather than running unprivileged. |
| **API key storage hierarchy: env var → OS keychain (keytar) → encrypted config file** | The v1.2 SAFE-01 requirement is keystore-only. v1.3 must preserve this. Industry baseline (GitHub `gh`, OpenClaw, AWS CLI v2): always check env var first (CI-friendly), then OS keychain (interactive), then a fall-back encrypted file if keychain is unavailable. | M | None | Use `keytar` (works under Bun via N-API); fallback to a `~/.achilles/settings.json` with the key field omitted and a separate `~/.achilles/key.enc` written with libsodium secretbox. Document a `ELEVENLABS_API_KEY` env-var override that wins regardless. |
| **First-run smoke test (1-utterance round-trip)** | v1.2 DIST-04 baseline. Without confirming that mic + Scribe + claude + Flash + ffplay all work end-to-end before the user issues a real prompt, the first failure feels like a product bug rather than a setup gap. | M | Uses all 4 voice packages | After API key + sox + ffmpeg checks pass, run a 60-second smoke test: prompt user "say something now," capture one utterance, transcribe via Scribe, request a `<spoken-summary>` from a `claude -p` shim that just echoes back, play it through ffplay. Confirm "smoke test passed" → write a `~/.achilles/init.json` marker so subsequent `achilles voice` skips the wizard. |
| **`achilles init` is idempotent and re-runnable** | Users will need to re-run `init` to swap API keys, rotate credentials, or recover from a broken state. v1.2 supported this via the Electron window; v1.3 must too. | S | None | Detect existing settings; offer "Keep current values" defaults for every prompt; print a final summary diff before writing. |
| **`achilles --version` works without a real key or sox** | Standard CLI norm. Users diagnose install issues with `--version`. If `--version` itself requires the full audio pipeline, the CLI is hostile to debugging. | S | None | Argv parse before any pipeline boot. |
| **`achilles install-skill` symlinks the npm-bundled SKILL.md into `~/.claude/skills/achilles/`** | Carryover from v1.2 DIST-02 (already shipping). v1.3 keeps the subcommand verbatim; the only change is the SKILL.md body now shells out to `achilles voice` instead of `achilles launch`. | S (port) | None | One-line diff to `@achilles/achilles-skill/skill/SKILL.md`. |
| **`achilles install-skill --force` overwrites broken symlinks** | Users who upgrade across npm publishes will end up with stale symlinks if they manually edited them. v1.2 already handles this; preserve. | S (port) | None | Detect `EEXIST`, prompt before overwrite, accept `--force`. |

#### Error Visibility (network drops, rate limits, sox crashes)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **Circuit breaker around STT + TTS WebSocket connects (carryover from v1.2 SAFE-05)** | Without a breaker, an ElevenLabs outage produces an infinite reconnect storm and the TUI appears frozen. v1.2 has this fully tested; v1.3 ports it. | S (port) | Uses existing `incident-detection.ts` + `voice-stt`/`voice-tts` open-attempt seams | Threshold + cooldown + full-jitter backoff already exist. Port into the v1.3 orchestrator with no Electron IPC indirection. |
| **Typed-input fallback when STT circuit opens (carryover from v1.2)** | When Scribe is degraded or the user's network is rate-limited, the typed path must work so the session isn't dead. v1.2 used `TypedFallback.tsx`; v1.3 drops into `@clack/prompts.text()` inline in the same terminal. | M | Uses existing `commitText` single-pipeline entry | Drop the Ink visual loop temporarily, accept text from clack, re-enter the loop after submission. Sandwich-defence wrapping is the same single entry point per SAFE-04. |
| **Visible error banner inline in the Ink shell** | Carryover from v1.2 `ErrorBanner.tsx`. A one-line red row above the status line that names the error class (network / auth / rate-limit / sox / ffplay / claude) and proposes the next action. | S (port simplified) | Reads orchestrator error events | One Ink `<Text color="red">` with the last error. Errors disappear after 8 seconds or on next successful event. |
| **ElevenLabs rate-limit detection with explicit messaging** | 429 from Scribe/Flash is a common real-world failure (free-tier limits, monthly cap, concurrent-stream limit). v1.2 classifies HTTP errors via `classifyHttpError`; v1.3 surfaces the classification in the error banner: "ElevenLabs rate limit — retrying in 12s." | S | Reads classifier output | One additional UI string; the classification logic already exists. |
| **sox / ffplay child-exit watchdog with bounded respawn** | When the laptop wakes from sleep, sox may exit with EIO. ffplay similarly. Without bounded respawn the TUI either silently dies or storms-respawns. | M | NEW | Watch child exit codes; if exit code != 0 and state ∈ {idle, listening, speaking}, respawn. Cap at 3 respawns within 10 seconds; on cap-exceeded, transition to error state with banner "Audio device lost — restart Achilles." |
| **Single-instance lock file at `~/.achilles/voice.lock`** | If a user runs `achilles voice` in two terminals, both sox processes fight for the mic and both Ink renders compete for stdout. The mac CoreAudio mixer can sometimes share; PulseAudio cannot. | S | None | PID file with `kill -0` liveness check; refuse to start with clear message: "Another achilles voice session is running (pid 12345). Press Ctrl-C in that terminal first." Cleaned up on graceful exit + SIGINT/SIGTERM handlers. |
| **Stuck-thinking watchdog (carryover from v1.2)** | If `claude -p` hangs with no streaming output for >60s, the user must be told. v1.2 has this; v1.3 ports. | S (port) | Reads from `claude-code-bridge` line parser | Timer reset on every stream-json line; on 60s no-stream, emit "Claude has been thinking for 60s — Ctrl-C to cancel." |
| **Suspend/resume handler (rewrite, not delete)** | v1.2 used Electron's `powerMonitor`. v1.3 has no equivalent direct API. The minimum is: detect sox/ffplay exit on resume, respawn, reset state to idle. Optionally listen for `SIGCONT` on POSIX as a hint. | M | Wires to mic-capture-sox + playback-ffplay | Polled via child exit codes (already required by the respawn watchdog); explicit suspend-event detection is best-effort and may be deferred to v1.4 if scope is tight. |
| **`achilles voice --debug` for verbose error logging** | Carryover from v1.2 LOOP-06. Lets the user see latency-probe output and raw event traces to a side log file. v1.3 maintains this. | S (port) | Reads latency probe + line parser | Toggle `ACHILLES_DEBUG=1`; writes to `~/.achilles/debug-<timestamp>.log`. The Ink shell stays clean. |

#### Accessibility (screen reader vs braille glyphs — the gotcha)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **Detect screen reader via Ink's `INK_SCREEN_READER` / `useIsScreenReaderEnabled`** | Ink 6 ships explicit screen-reader support: setting `INK_SCREEN_READER=1` or passing `isScreenReaderEnabled: true` to `render()` switches to a screen-reader-friendly tree. Without this, NVDA/JAWS/Speakup users get the documented "the framework spams the screen reader with every redraw" failure mode. | M | None | Probe env var + `useIsScreenReaderEnabled()` hook in the root component. If active, suppress the blob and sparkline entirely; render a single state-change line instead. |
| **Screen-reader-only render path: state-change announcements only** | When a screen reader is active, the braille sparkline and block-character blob produce noise (they redraw every 50ms; each redraw is a new chunk of meaningless braille for the reader to announce). The accessible mode emits one announcement per state transition + one per committed transcript. | M | Reads state machine + STT events | Replace the visual region with a `<Text aria-live="polite">{stateAnnouncement}</Text>` that updates only when state changes. Spec the wording: "Achilles listening." / "Achilles processing your request." / "Achilles speaking." / "Achilles idle." / "Achilles ran into a problem." |
| **`--no-tui` / `--plain` flag for piped/non-TTY contexts** | When stdout is not a TTY (CI, log capture, piped invocation) the Ink redraw loop produces garbage. Standard CLI norm to detect `process.stdout.isTTY` and downgrade. | S | None | Auto-downgrade if `!process.stdout.isTTY`; manual override via `--plain`. Emits one log line per state transition. |
| **Honour `NO_COLOR` and `FORCE_COLOR` env vars** | Standard CLI norm (no-color.org); without it, terminals that don't support ANSI render escape sequences as literal characters. Chalk handles this automatically but we must not bypass it. | S | None | Default chalk behaviour; document the env vars in `achilles --help`. |
| **Document the screen-reader caveat in README and `achilles --help`** | Even with the accessible mode, the v1.3 product is a voice product — users who cannot hear cannot use it. The accessibility win is for screen-reader users who *can* hear and want to talk back. Be honest about the boundary. | S | None | One paragraph in the README. |

#### Privacy + Security (mostly carryover from v1.2)

| Feature | Why Expected | Complexity | Dependency on voice packages | Notes |
|---------|--------------|------------|------------------------------|-------|
| **ElevenLabs-only outbound network allowlist (SAFE-03)** | Already enforced at the package level in `voice-protocol/src/transport.ts` (assertElevenLabsHost). Survives unchanged. | S (port) | Already in `voice-protocol` | No change. |
| **Sandwich-defence transcript wrapping (SAFE-04)** | Already enforced in `apps/achilles/src/main/sandwich-defence.ts`. Survives via the migrating orchestrator. | S (port) | Uses orchestrator-side `wrapTranscript` | No change. |
| **Transcripts off by default; opt-in `--save-transcripts` (SAFE-02)** | Already enforced. v1.3 preserves the flag. | S (port) | None | The `RecordingIndicator` collapses into the Ink status row. |
| **`achilles transcripts list` + `achilles transcripts purge`** | Carryover from v1.2 CLI subcommands. v1.3 keeps them. | S (port) | None | One file move from `apps/achilles-cli/src/commands/transcripts.ts` into the consolidated `apps/achilles-tui/src/cli.ts`. |
| **No audio uploaded anywhere except ElevenLabs** | Carryover constraint from PROJECT.md. Already structurally enforced. | S | None | Same allowlist as SAFE-03. |
| **API key never appears in logs, even in `--debug` mode** | Carryover from SAFE-01 (`check-tarball-no-secrets.mjs`). The debug log writer must redact keys. | S (port) | None | Pattern-redact 7 regex patterns from v1.2's tarball scanner; reuse for log writer. |
| **Lockfile permissions 0600 on the keychain fallback file** | If keytar is unavailable and we write the encrypted key file, the FS permissions must restrict to user. | S | None | `fs.chmod(path, 0o600)` after write; reject if existing file has broader perms. |

### Differentiators (Competitive Advantage)

Features that set v1.3 apart from inline `/voice` extensions (Gemini CLI's), generic STT-into-Claude-Code workflows, and v1.2's own Electron HUD. Not required to ship, but each meaningfully widens the gap.

| Feature | Value Proposition | Complexity | Dependency on voice packages | Notes |
|---------|-------------------|------------|------------------------------|-------|
| **Single-binary distribution via Bun `--compile` with cold-start <50ms** | The skill body invocation cold-starts the binary every time. <50ms is the threshold below which users perceive "instantaneous." Node 22 cold start is ~150ms with tsx, ~50-80ms bundled. Bun's ~15ms hello-world is the only path under 50ms. No competing terminal voice tool ships a Bun binary today. | M | None | Bun 1.3+ `--compile --target=bun-<platform>-<arch>`. Per-platform packages via `optionalDependencies`. Pure-JS fallback bin shim for unsupported platforms. |
| **Runs inside the same terminal as Claude Code (true ambient surface)** | v1.2 was a floating window — physically separate from the terminal. v1.3 lives inline. Users never alt-tab; their voice prompt and Claude's terminal output stream in the same pane. This is a perception-of-craft win that no other voice product delivers. | M | All voice packages | Achieved by running as a foreground Ink process; the Bash tool's skill invocation waits for Ctrl-C. |
| **VAD always-listening + Ctrl-C cancel (zero hotkey config)** | v1.2 required users to configure a global hotkey (Cmd+Shift+A or remap) AND grant Accessibility permissions on macOS. v1.3 drops both. The user runs `achilles voice` and starts talking. No permissions beyond mic. No keyboard conflicts with Claude Code's own bindings (Claude Code uses spacebar PTT for its built-in `/voice`). | M | NEW VAD + existing cancellation | Energy-threshold VAD; documented re-tuning via `~/.achilles/settings.json` if a user works in noisy environments. |
| **Gapless TTS playback via ffplay stdin pipe** | `@achilles/voice-tts` emits MP3 chunks per `CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220]`. ffplay handles frame boundaries internally so the user hears continuous speech rather than the "clicky" small-chunk artefacts of Web Audio's `decodeAudioData` queue used in v1.2. This is a quality improvement, not just a port. | M | Uses existing `voice-tts` MP3 output | `ffplay -nodisp -autoexit -loglevel quiet -fflags nobuffer -flags low_delay -i pipe:0`. The orchestrator pipes chunk bytes into stdin. |
| **Skill body shells out to a real interactive TUI (not detached)** | The v1.2 SKILL.md detached the Electron process and returned. v1.3 stays attached: the Bash tool blocks until Ctrl-C. The skill body documents this with a "set bash timeout to 600000" comment. The user gets a continuous experience where the skill invocation IS the voice session, not a background launch. | S | None | One-line change to SKILL.md frontmatter + body. |
| **Dual invocation paths (skill / npm CLI / bunx) all share one binary** | `achilles voice` (after `npm install -g achilles`), `bunx achilles voice`, and the Claude Code skill body all end up running the same Bun-compiled binary. The single source-of-truth contract from v1.2 DIST-03 is preserved end-to-end including the SHA-256 check on the embedded `companion.md`. | M | None | bin shim + per-platform package; SHA-256 source-of-truth CI check from v1.2 ports unchanged. |
| **Resumes session via `--resume <sid>` after cancellation** | Carryover from v1.2 LOOP-07. Lets the user Ctrl-C, think, then `achilles voice --resume <sid>` to continue the conversation with the same Claude Code context. Differentiates from `gemini-voice` which has no resume. | S (port) | Uses `claude-code-bridge` resume path | Already implemented; surface in the CLI flag set. |
| **`achilles latency --report` for transparency** | Carryover from v1.2 LOOP-06. Lets users see P50/P95 of speech-end→ack-spoken across rolling sessions. Builds trust and helps users decide whether to stick with energy VAD or wait for v1.4 silero. | S (port) | Reads latency-probe JSON | The probe writes JSON to `~/.achilles/latency/`; the subcommand prints a summary table. |
| **Voice-aware system prompt (PROMPT-02 + PROMPT-03) tuned for spoken playback** | Carryover from v1.2 PROMPT pillar. Most "voice-on-top-of-an-agent" stacks naively read the entire model output. The companion prompt enforces a ≤12-word ack + ≤40-word `<spoken-summary>` block with explicit "forbidden inside the block" formatting rules. v1.3 ships this unchanged — it is the most defensible voice-UX differentiator across all reference products. | S (port) | Uses `achilles-skill` `companion.md` | No change to the prompt or the contract test. |
| **First-class typed fallback that feels like a real input mode, not a degraded state** | When STT degrades (rate-limited, network drop, user in a noisy room), Achilles drops into a `@clack/prompts.text()` inline input. The user keeps the session, the transcript, the sandwich defence, and the voice output — they just typed this turn. v1.2 had this; v1.3 preserves it. | S (port) | Uses `commitText` single-pipeline entry | Subtle change: in v1.2 the typed input lived in a separate React panel; in v1.3 it temporarily takes over the Ink shell. |
| **Per-platform installer instructions surfaced WHERE THE USER LIVES** | Detect parent terminal emulator and platform; print the exact install commands the user needs in their flavour: `brew install sox ffmpeg`, `sudo apt install sox ffmpeg`, `choco install sox.portable ffmpeg`. No "go to the website and figure it out." | S | None | Resolve via `process.platform` + `process.env.TERM_PROGRAM`. |
| **OpenTUI watch-list documentation** | Document the v1.4 upgrade path to OpenTUI (Bun-FFI Zig core) for sub-ms frame times. This signals craft to power users who follow the TUI ecosystem; no implementation cost today. | S | None | One README footnote. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look like the right move for v1.3 but create problems. Some carry over from the v1.2 anti-feature list because they remain anti-features in v1.3; others are NEW for v1.3 because the surface area changed.

| Feature | Why Requested | Why Problematic in v1.3 | Alternative |
|---------|---------------|--------------------------|-------------|
| **Reinstating a configurable global hotkey for PTT** (NEW anti-feature for v1.3) | Devs muscle-memoried Cmd+Shift+A on v1.2; some will ask for it back so they can "force-trigger" Achilles instead of trusting VAD. | Global hotkeys require OS Accessibility / Input Monitoring permission on macOS, which is exactly the friction v1.3 is trying to drop. Reintroducing the hotkey re-introduces the permission wall AND fights Claude Code's spacebar PTT bindings. The terminal-only surface has a better signal: SoX is hot whenever the foreground process is alive. | Document the VAD threshold tuning in `~/.achilles/settings.json` so power users who don't trust energy VAD in noisy rooms can dial it. v1.4 silero upgrade path. |
| **Full barge-in / mid-TTS interrupt** (carryover from v1.2) | "Natural conversation" feel from ChatGPT Advanced Voice. | Same as v1.2: production bar is 200-400ms turn-taking gap, <2% false-barge-in rate, <60ms TTS flush — heavy engineering investment for marginal value over the existing 300ms playback-tail debounce. Adds a full-duplex audio constraint that breaks the half-duplex SPEAKING_DEBOUNCE_MS=300 invariant. | Ctrl-C to cancel playback + claude run. "Hold to barge in" is plausible as a v1.4 if a clear demand signal lands. |
| **Wake-word ("Hey Achilles")** (carryover from v1.2) | Sounds futuristic; users see it in Alexa/Siri. | Same as v1.2: terminal/dev environments have constant noise (music, podcasts, video calls, typing); wake-word engines (Porcupine etc.) are heavy, licensed, and false-fire on every "Hey" in conversation. Anthropic's own `/voice` explicitly chose no wake word. Always-on VAD already gives the "frictionless feel" they were asking for without the engine cost. | Already covered by the v1.3 VAD always-listening choice. |
| **Reading the entire Claude Code transcript aloud** (carryover from v1.2) | "I want Achilles to keep me posted." | Tool calls, code, paths, JSON — none of it plays well as speech. v1.2's PROMPT-04 + extractor pipeline is the core IP of the voice UX. v1.3 preserves it. | Only the ack and the `<spoken-summary>` block reach TTS. Everything else stays in the terminal scrollback. |
| **Editable transcript before send** (carryover from v1.2) | "Let me fix what Achilles misheard before it goes to Claude Code." | Adds a modal in a surface that is supposed to feel ambient. Devs who want to edit can use the typed fallback. Adding a "wait, let me edit" turn breaks the conversational rhythm. | Show the heard text post-send as confirmation in the status row. If the user wants to redo, Ctrl-C and re-speak (or use typed fallback). |
| **Reinstating a settings popover / config UI** (NEW anti-feature for v1.3) | Users with v1.2 muscle memory expect a clickable settings surface. | A clickable popover requires a stable input model the terminal doesn't have. Tiny in-Ink select boxes are a worse UX than a dedicated config command. | `achilles config` subcommand using `@clack/prompts` select/multiselect. Edits write to `~/.achilles/settings.json`. |
| **Floating window mode (still keep v1.2's Electron HUD as an option)** (NEW anti-feature for v1.3) | Some v1.2 users will miss the visual surface. | Maintaining the Electron path costs the entire reason for v1.3 (one binary, one source, one runtime). Keeping it means doubling the matrix of "does this work on Bun + Electron + Node" forever. | Hard delete in v1.3; document the migration in release notes. Re-evaluate in v1.5 if user data justifies. |
| **In-product voice cloning UX** (carryover from v1.2) | "Use my own voice." | ElevenLabs already has it. Rebuilding in a TUI is a fragile, no-margin clone of someone else's product. | Document how to clone in ElevenLabs and paste the voice ID into `~/.achilles/settings.json`. |
| **Voice picker UI inside the active voice loop** (NEW anti-feature for v1.3, deferred from v1.2 VOICE-01) | Users will want to A/B voices live. | An in-loop voice swap UI is a flicker between two TTS calls and creates inconsistency mid-conversation. Forcing a session restart is the cleaner contract. | `achilles config` subcommand exposes voice ID; new sessions pick it up. v1.4 candidate: `achilles voices list` + interactive picker in the config command. |
| **Persistent transcript log on disk by default** (carryover from v1.2) | "I want to search what I said." | Audio + transcripts of dev work are sensitive (proprietary code, internal names, secrets). Default-on retention will surprise users badly. v1.2 SAFE-02 is opt-in for this exact reason. | No persistent transcripts by default. `--save-transcripts` flag with documented JSONL path; transcripts purge subcommand for cleanup. |
| **Reading file paths / code identifiers aloud in the `<spoken-summary>`** | "It should tell me which file it edited." | `companion.md:83+` explicitly forbids paths, identifiers, code blocks, ANSI in the spoken block. Devs cannot reliably parse a slash-laden path read aloud; the spoken summary is for the ear, the terminal is for the eye. | Tool call diffs stay in the silent terminal region. The spoken summary is prose. |
| **A `--detach` flag that backgrounds the voice session** | "I want to keep working in the same terminal pane while Achilles runs in the background." | Backgrounding the Ink foreground loses the visual surface entirely (no stdout to render into). Adding a separate IPC channel + headless mode is rebuilding the v1.2 architecture inside v1.3. | Open `achilles voice` in a separate terminal pane (the OS-native tmux/iTerm/Terminal panel split is the right tool for this). |
| **An inbound WebSocket / HTTP server so the floating window can be remote-controlled** (carryover from v1.2) | "Control Achilles from the phone." | This is what Handoff exists for. Mixing voice and Handoff surfaces expands the security boundary unnecessarily. v1.3 stays outbound-only. | None in v1.3. Handoff already covers this use case via the v1.1 path (currently paused). |
| **Custom in-house STT/TTS models** (carryover from v1.2) | "Local privacy" or "no vendor lock-in." | Explicitly out of scope per PROJECT.md. Spinning up Whisper-on-device etc. blows the timeline and degrades quality. | ElevenLabs only in v1.3. Local model fallback is a v1.4+ conversation. |
| **Real-time pitch / pace controls during TTS playback** | "Slow down the voice when it's reading code aloud." | Code is in the silent region per PROMPT-04; the spoken summary is short prose by design. Pitch/pace controls add a config surface for a non-problem. | Defer until a user actually complains. v1.4 candidate. |
| **Multi-user voice rooms / shared voice sessions** (carryover from v1.2) | Brainstorm sessions, pair programming. | Explicitly out of scope in PROJECT.md. Multi-mic routing, identity, and TTS-back-to-many are a separate product. | Single user, single mic, single TTS playback. |

## Feature Dependencies

```
[SoX child mic capture] (table stakes, NEW)
    └──required-for──> [Energy VAD always-listening]
    └──required-for──> [Blob amplitude scalar]
    └──required-for──> [Sparkline RMS history]
    └──required-for──> [voice-stt frame forwarding]

[ffplay child playback] (table stakes, NEW)
    └──required-for──> [TTS playback during speaking state]
    └──required-for──> [Half-duplex turn-taking via 300ms tail]
    └──required-for──> [Speaking-state blob driven by playback amplitude]

[Energy VAD] (table stakes, NEW)
    └──required-for──> [Speech-start → STT open]
    └──required-for──> [Speech-end → STT commit hint]
    └──conflicts-with──> [Global hotkey PTT (anti-feature in v1.3)]

[Ink TUI shell] (table stakes, NEW)
    └──required-for──> [Reactive blob + sparkline]
    └──required-for──> [State color rendering]
    └──required-for──> [Status row + transcript line]
    └──required-for──> [Inline typed fallback via @clack/prompts]
    └──required-for──> [Init wizard via @clack/prompts]

[Bun runtime + --compile] (table stakes, NEW)
    └──required-for──> [Single-binary distribution]
    └──required-for──> [Cold-start <50ms]
    └──enables──> [Skill body invocation feeling instantaneous]

[Per-platform optionalDependencies] (table stakes, NEW)
    └──requires──> [Bun --compile cross-target build matrix]
    └──required-for──> [npm install on every supported OS]

[bin shim JS fallback] (table stakes, NEW)
    └──enables──> [Node 22 + bundled-JS path when no platform binary available]
    └──required-for──> [Resilience when Apple Developer ID not provisioned]

[`achilles init` wizard] (table stakes, NEW rewrite)
    └──requires──> [@clack/prompts text/confirm/select primitives]
    └──required-for──> [API key write to keytar OR encrypted file]
    └──required-for──> [sox + ffmpeg preflight]
    └──required-for──> [Smoke test before first achilles voice]

[OS keychain via keytar] (table stakes, NEW)
    └──enables──> [SAFE-01 preservation under non-Electron runtime]
    └──fallback-to──> [Encrypted ~/.achilles/key.enc file]
    └──override-by──> [ELEVENLABS_API_KEY env var]

[Session orchestrator (port from v1.2 session.ts)]
    └──requires──> [Voice packages (STT/TTS/protocol/bridge/skill)]
    └──requires──> [State machine port]
    └──requires──> [Sandwich defence port]
    └──requires──> [Latency probe port]
    └──requires──> [Incident detection port]
    └──requires──> [Stuck-thinking watchdog port]
    └──requires──> [Transcript store port]
    └──required-for──> [Half-duplex turn-taking]
    └──required-for──> [Ack / spoken-summary extraction routing]
    └──required-for──> [Failure override phrase]

[Companion prompt (achilles-skill/skill/prompts/companion.md)]
    └──REQUIRED-by──> [claude-code-bridge --append-system-prompt-file flag]
    └──REQUIRED-by──> [Ack extractor (≤12 words rule)]
    └──REQUIRED-by──> [Spoken-summary extractor (≤40 words rule)]
    └──UNCHANGED-from-v1.2──> [SHA-256 source-of-truth CI check ports unchanged]

[Skill body shells out to `achilles voice`]
    └──requires──> [Bun binary discoverable on PATH]
    └──requires──> [Bash tool's timeout configured to handle long sessions]
    └──one-line-diff-from-v1.2──> [`achilles launch` → `achilles voice`]

[Ctrl-C cancel] (table stakes, NEW interaction)
    └──requires──> [Foreground process attached to TTY]
    └──wires-to──> [claude-code-bridge cancellation SIGINT chain]
    └──wires-to──> [voice-tts.close() + ffplay child kill]

[Single-instance lock file]
    └──conflicts-with──> [Running multiple achilles voice sessions]
    └──prevents──> [Mic contention + stdout interleave]

[Screen-reader mode] (table stakes, NEW for accessibility)
    └──suppresses──> [Reactive blob render]
    └──suppresses──> [Braille sparkline render]
    └──preserves──> [State-change announcements + transcript line]

[Circuit breaker port from v1.2]
    └──required-for──> [STT failure → typed fallback]
    └──required-for──> [TTS failure → visible inline error]
    └──gates──> [ElevenLabs rate-limit messaging surface]

[sox/ffplay respawn watchdog] (table stakes, NEW)
    └──required-for──> [Suspend/resume recovery without process restart]
    └──required-for──> [Device-change handling (sox dies on hot-swap)]
    └──bounded-by──> [3 respawns in 10s; cap → error state]

[Typed input fallback]
    └──reuses──> [commitText single pipeline entry (SAFE-04)]
    └──reuses──> [Sandwich defence wrapping]
    └──displaces──> [Ink shell temporarily during clack.text() prompt]
```

### Dependency Notes

- **SoX + ffmpeg form a hard external-dependency edge.** The init wizard MUST detect both and produce platform-specific install instructions before the first `achilles voice` invocation; otherwise the first failure feels like a product bug. The phase that ships the wizard must also ship the preflight, in one phase, to avoid a partial-rollout window.
- **The companion prompt is the spine of the entire spoken UX.** Carry it forward verbatim with the SHA-256 check intact; it is the single most defensible differentiator versus generic STT-into-Claude-Code workflows and against Gemini CLI voice extensions that have no spoken-summary contract.
- **VAD threshold tuning is the user-facing knob that replaces the PTT hotkey.** Document it from day one in `~/.achilles/settings.json` schema; without it, power users in noisy rooms will reach for hotkey requests immediately and the v1.3 anti-feature wall holds.
- **Screen-reader mode and the visual mode are mutually exclusive.** Detect once at startup; do not try to drive both. The `--plain` flag does similar downgrading for piped/non-TTY contexts and shares 90% of the implementation.
- **The skill body invocation (`achilles voice` from Claude Code's Bash tool) requires the Bash timeout to be raised.** Document this in the SKILL.md body explicitly — without it, sessions get killed at 120s.
- **The keytar fallback chain (env var → keychain → encrypted file) is the table-stakes API key story.** All three layers must ship together; missing the encrypted-file fallback breaks Linux users without a working libsecret/PolicyKit setup.

## MVP Definition

### Launch With (v1.3)

The minimum surface that delivers the terminal-only pivot and preserves every v1.2 SAFE/LOOP/PROMPT requirement.

- [ ] **Bun-runtime CLI with `bun --compile` cross-platform binaries** — distribution constraint; single source of truth
- [ ] **Per-platform `@achilles/cli-<platform>` packages via `optionalDependencies`** — npm install path
- [ ] **JS bin shim fallback for unsupported / unsigned platform** — Apple Developer ID resilience
- [ ] **Ink 6 + React 19 TUI shell with state machine port from v1.2** — visible surface
- [ ] **Reactive 7x7 block-character blob driven by RMS / TTS amplitude** — visual continuity bridge from v1.2
- [ ] **40-cell braille sparkline waveform with rolling 80-sample history** — visual density
- [ ] **Five distinct state colors + idle breathing + processing animation** — table stakes feedback
- [ ] **Status row with state name + truncated last transcript** — minimum transcript visibility
- [ ] **SoX child process for 16k mono PCM mic capture** — replaces v1.2 getUserMedia
- [ ] **Energy-threshold VAD + 60ms voice-hold + 300ms silence-hold** — replaces PTT
- [ ] **ffplay child process for gapless MP3 TTS playback via stdin** — replaces Web Audio queue
- [ ] **Half-duplex turn-taking via existing SPEAKING_DEBOUNCE_MS=300** — preserved from v1.2
- [ ] **Voice packages reused untouched (`voice-protocol`, `voice-stt`, `voice-tts`, `claude-code-bridge`)** — reuse contract
- [ ] **Companion prompt + SHA-256 source-of-truth check ported unchanged** — PROMPT-01..05 preserved
- [ ] **`achilles init` wizard via @clack/prompts: env-key → keytar → encrypted file** — onboarding
- [ ] **SoX + ffmpeg preflight with per-platform install messaging** — cold-start friction killer
- [ ] **1-utterance smoke test in init wizard** — confirms the loop works before real prompts
- [ ] **`achilles install-skill` symlink ported (one-line `launch` → `voice` diff in SKILL.md)** — dual distribution
- [ ] **Ctrl-C cancel routed through existing SIGINT chain + TTS close** — cancellation
- [ ] **Mute toggle (`m` key) without exiting** — privacy expectation
- [ ] **Circuit breaker port from v1.2 (STT + TTS)** — SAFE-05 preservation
- [ ] **Typed fallback via inline @clack/prompts.text() when STT degrades** — preserves single pipeline entry
- [ ] **Visible error banner + ElevenLabs rate-limit classification** — error visibility
- [ ] **Sox/ffplay child-exit respawn watchdog with 3-in-10s cap** — suspend/resume + device hot-swap
- [ ] **Single-instance lock file at `~/.achilles/voice.lock`** — prevents mic contention
- [ ] **Stuck-thinking watchdog port from v1.2** — `claude -p` hang detection
- [ ] **Sandwich-defence transcript wrapping port** — SAFE-04 preservation
- [ ] **Latency probe port + `achilles latency --report` subcommand** — LOOP-06 preservation
- [ ] **Opt-in `--save-transcripts` + `achilles transcripts list / purge`** — SAFE-02 preservation
- [ ] **API key storage hierarchy (env → keytar → encrypted file, 0600 perms)** — SAFE-01 preservation under no-Electron runtime
- [ ] **ElevenLabs-only outbound allowlist ported** — SAFE-03 preservation (already in voice-protocol)
- [ ] **Screen-reader detection via INK_SCREEN_READER + state-change announcements only** — accessibility floor
- [ ] **`--plain` / non-TTY downgrade path** — piped invocation
- [ ] **`NO_COLOR` / `FORCE_COLOR` honoured** — terminal compatibility
- [ ] **macOS parent-emulator detection + targeted permission instructions on EPERM** — TCC failure mode
- [ ] **Skill SKILL.md updated to shell out to `achilles voice` (foreground)** — skill body
- [ ] **README documents brew/apt/choco install lines + Bash timeout note** — discoverability

### Add After Validation (v1.3.x)

Trigger: end-to-end loop works against cloud Claude Code AND a small group of users has tried it.

- [ ] **Voice picker via `achilles config` subcommand** — trigger: first user complaint about default voice
- [ ] **`achilles voice --resume <sid>` integrated with v1.3 lock file semantics** — trigger: first user asks
- [ ] **Configurable VAD threshold via `~/.achilles/settings.json` schema** — trigger: first noisy-room miss
- [ ] **Per-platform sox/ffmpeg portable bundles via optionalDependencies** — trigger: install-friction feedback
- [ ] **Code-signed + notarised macOS binaries via Apple Developer ID** — trigger: Apple Developer ID provisioned
- [ ] **More granular error classification (network vs auth vs rate-limit vs claude vs sox vs ffplay)** — trigger: support load reveals which buckets are common
- [ ] **`achilles debug doctor` subcommand that runs all preflight checks + reports versions** — trigger: support load justifies a single-command diagnostic
- [ ] **Persistent latency-report JSON dashboard between sessions** — trigger: power users ask

### Future Consideration (v1.4+)

Defer until product-market fit signals OR until the v1.3 anti-feature pressure becomes real.

- [ ] **silero-vad via onnxruntime-node behind same `VadHandle` interface** — defer until energy VAD misses cause real complaints
- [ ] **OpenTUI migration (Bun-FFI Zig core)** — defer until OpenTUI ships 1.0 and 6 months stable
- [ ] **In-loop voice swap (without session restart)** — defer; flicker risk dominates A/B value
- [ ] **Push-to-talk hotkey as opt-in** — defer; explicit anti-feature in v1.3 unless data shows real demand
- [ ] **Full barge-in / mid-TTS interrupt with full-duplex audio** — defer; heavy infra for marginal value
- [ ] **Wake-word ("Hey Achilles")** — defer; explicit anti-feature
- [ ] **Local STT/TTS fallback for offline use** — defer; out of scope per PROJECT.md
- [ ] **Multi-user voice rooms / shared sessions** — defer; out of scope per PROJECT.md
- [ ] **Integration with Handoff to drive Achilles from a phone** — defer; explicitly out of scope
- [ ] **PortAudio bindings via naudiodon (zero external sox install)** — defer; Bun-compat unverified, install-friction not yet validated as the blocker

## Feature Prioritization Matrix

Complexity column reflects v1.3-net-new effort. Items marked `S (port)` reuse v1.2 code with minimal changes.

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Bun-runtime CLI + per-platform compile pipeline | HIGH | MEDIUM | P1 |
| optionalDependencies platform-package distribution | HIGH | MEDIUM | P1 |
| JS bin shim fallback | HIGH | LOW | P1 |
| Ink TUI shell + state machine port | HIGH | MEDIUM | P1 |
| Reactive block-character blob | HIGH | MEDIUM | P1 |
| Braille sparkline | HIGH | MEDIUM | P1 |
| Five state colors + breathing + processing | HIGH | LOW | P1 |
| Status row + truncated transcript | HIGH | LOW | P1 |
| SoX child mic capture | HIGH | MEDIUM | P1 |
| Energy VAD always-listening | HIGH | MEDIUM | P1 |
| ffplay child TTS playback | HIGH | MEDIUM | P1 |
| Half-duplex 300ms tail port | HIGH | LOW (port) | P1 |
| Companion prompt + SHA-256 check port | HIGH | LOW (port) | P1 |
| `achilles init` wizard via @clack/prompts | HIGH | MEDIUM | P1 |
| SoX + ffmpeg preflight + platform install instructions | HIGH | LOW | P1 |
| 1-utterance smoke test in wizard | HIGH | MEDIUM | P1 |
| `achilles install-skill` symlink (port) | HIGH | LOW (port) | P1 |
| Ctrl-C cancel routing | HIGH | LOW (port) | P1 |
| Mute toggle | MEDIUM | LOW | P1 |
| STT + TTS circuit breaker port | HIGH | LOW (port) | P1 |
| Typed fallback via inline @clack/prompts.text() | HIGH | MEDIUM | P1 |
| Inline error banner + rate-limit classification | MEDIUM | LOW (port) | P1 |
| Sox/ffplay respawn watchdog | HIGH | MEDIUM | P1 |
| Single-instance lock file | MEDIUM | LOW | P1 |
| Stuck-thinking watchdog port | MEDIUM | LOW (port) | P1 |
| Sandwich defence port | HIGH | LOW (port) | P1 |
| Latency probe + report subcommand port | MEDIUM | LOW (port) | P1 |
| Opt-in `--save-transcripts` port | MEDIUM | LOW (port) | P1 |
| API key storage hierarchy (env → keytar → encrypted file) | HIGH | MEDIUM | P1 |
| ElevenLabs allowlist port | HIGH | LOW (port) | P1 |
| Screen-reader detection + state-change announcements | MEDIUM | MEDIUM | P1 |
| `--plain` / non-TTY downgrade | MEDIUM | LOW | P1 |
| `NO_COLOR` / `FORCE_COLOR` honour | LOW | LOW | P1 |
| macOS parent-emulator detection + permission copy | HIGH | MEDIUM | P1 |
| SKILL.md `launch` → `voice` one-line diff | HIGH | LOW (port) | P1 |
| README brew/apt/choco install lines | HIGH | LOW | P1 |
| Voice picker via `achilles config` | MEDIUM | MEDIUM | P2 |
| `achilles voice --resume <sid>` with lock-file integration | MEDIUM | LOW (port) | P2 |
| Configurable VAD threshold in settings | MEDIUM | LOW | P2 |
| Code-signed + notarised macOS binaries | HIGH | MEDIUM | P2 |
| Granular error classification | LOW | MEDIUM | P2 |
| `achilles debug doctor` subcommand | MEDIUM | MEDIUM | P2 |
| Persistent latency-report JSON dashboard | LOW | LOW | P2 |
| silero-vad upgrade | MEDIUM | HIGH | P3 |
| OpenTUI migration | LOW | HIGH | P3 |
| In-loop voice swap without restart | LOW | MEDIUM | P3 |
| Push-to-talk hotkey opt-in | LOW | HIGH | P3 |
| Full barge-in | LOW | HIGH | P3 |
| Wake-word | LOW | HIGH | P3 |
| Local STT/TTS fallback | LOW | HIGH | P3 |
| Multi-user voice rooms | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.3 launch — without it, the milestone is not "shipped"
- P2: Should have, add when validation feedback or follow-up phase justifies
- P3: Defer or explicitly out of scope per PROJECT.md / anti-feature list

## Competitor Feature Analysis (terminal-voice category)

| Feature | kstonekuan/gemini-voice (Mar 2026) | Gemini CLI `/talk:start` (proposal) | PATAPIM Terminal IDE | Claude Code `/voice` (built-in) | Achilles v1.3 (Planned) |
|---------|-------------------------------------|--------------------------------------|----------------------|--------------------------------|--------------------------|
| **Runtime** | Node + Rust native addon (cpal) | TBD | TBD | Bun (Claude Code itself) | Bun (single binary) |
| **Distribution** | npm (`@kstonekuan/gemini-voice`) | TBD | Self-hosted IDE | Built into Claude Code | npm + per-platform binaries + Claude Code skill |
| **Mic capture** | Rust addon via cpal | Inline in Gemini CLI | Whisper native | Built into Claude Code | SoX child process |
| **Capture model** | Always-listening (no PTT) | Slash command `/talk:start` / `/talk:stop` | Push-to-talk | Spacebar PTT (hold) | VAD always-listening + Ctrl-C cancel |
| **Visual feedback (in terminal)** | Live waveform in standalone tool; NONE when invoked via `/voice` extension because Gemini CLI suppresses extension stdout | TBD | IDE chrome | None — cursor + transcript only | Reactive block-char blob + braille sparkline + 5 state colors |
| **Inline state visibility** | Limited | TBD | Yes (IDE chrome) | Yes (cursor) | Yes (state row, all 5 states) |
| **Spoken response (voice-out)** | No (dictation only) | Yes (proposed) | No | No (dictation only) | Yes — ack + `<spoken-summary>` only |
| **Latency probe / transparency** | No | TBD | No | No | Yes (`achilles latency --report`) |
| **Sandwich defence on transcript** | No | No | No | No | Yes (port from v1.2) |
| **Companion prompt contract** | None | TBD | None | None | ≤12-word ack + ≤40-word `<spoken-summary>` block (SHA-256 source-of-truth) |
| **Typed fallback when STT degrades** | No | TBD | Yes (it's an IDE) | Yes (regular Claude Code input) | Yes (inline @clack/prompts.text()) |
| **Single-vendor allowlist** | Google only | Google only | Local Whisper | Anthropic only | ElevenLabs only |
| **Cancel during playback** | N/A | TBD | TBD | N/A | Ctrl-C → SIGINT chain + TTS close |
| **Screen-reader awareness** | Not documented | TBD | TBD | Not documented | INK_SCREEN_READER detection + state-change-only mode |
| **Install friction** | `npm install` + Rust toolchain | TBD | Self-host IDE | None (built-in) | `npm install -g achilles` + `brew install sox ffmpeg` |
| **Cold start** | ~150ms (Node + Rust addon) | TBD | N/A | N/A (built-in) | ~15ms (Bun-compiled binary, target) |
| **Differentiation for Achilles v1.3** | — | — | — | Achilles speaks back AND lives in the same terminal pane | Voice-out + reactive TUI + spoken-summary contract + Bun cold-start + 100% reuse of v1.2 voice packages is the wedge |

## Sources

### v1.3 internal context (read for this research)
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/PROJECT.md`
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/v1.3-terminal-pivot.md`
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/milestones/v1.2-MILESTONE-AUDIT.md`
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/achilles-skill/skill/SKILL.md`
- `/Users/lakshmanturlapati/Documents/Codes/Handoff/packages/achilles-skill/skill/prompts/companion.md`

### Terminal voice agents (direct precedent — < 12 months old)
- [Voice Mode for Gemini CLI via Gemini Live API — Agent Wars (March 2026)](https://agent-wars.com/news/2026-03-14-voice-mode-for-gemini-cli-via-gemini-live-api)
- [Bidirectional voice / audio mode — google-gemini/gemini-cli#6929](https://github.com/google-gemini/gemini-cli/issues/6929)
- [Browse Extensions — Gemini CLI](https://geminicli.com/extensions/)
- [GitHub - opencode-ai/opencode (terminal coding agent, Bubble Tea TUI)](https://github.com/opencode-ai/opencode)
- [GitHub - bradAGI/awesome-cli-coding-agents (terminal voice / dictation landscape)](https://github.com/bradAGI/awesome-cli-coding-agents)
- [Voice Mode (MCP) — Claude Code integration](https://voice-mode.readthedocs.io/en/stable/integrations/claude-code/)

### Ink + TUI accessibility
- [Ink — vadimdemedes/ink (React for interactive command-line apps, screen reader support docs)](https://github.com/vadimdemedes/ink)
- [Ink — TUI Framework Terminal Compatibility — Terminfo.dev](https://terminfo.dev/framework/ink)
- [TUI Development: Ink + React — combray (Dec 2025)](https://combray.prose.sh/2025-12-01-tui-development)
- [The text mode lie: why modern TUIs are a nightmare for accessibility — The Inclusive Lens](https://xogium.me/the-text-mode-lie-why-modern-tuis-are-a-nightmare-for-accessibility)
- [OSnews mirror — modern TUIs accessibility critique](https://www.osnews.com/story/144892/the-text-mode-lie-why-modern-tuis-are-a-nightmare-for-accessibility/)
- [ink-tui — Skills Marketplace reference](https://lobehub.com/skills/justinlevinedotme-jalco-opencode-ink-tui)

### VAD + voice agent turn-taking (2026 production stack)
- [Voice Activity Detection (VAD): The Complete 2026 Guide to Speech Detection — Picovoice](https://picovoice.ai/blog/complete-guide-voice-activity-detection-vad/)
- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide — Future AGI](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/)
- [Voice Agent Infrastructure Stack 2026: Full Reference — Digital Applied](https://www.digitalapplied.com/blog/voice-agent-infrastructure-stack-2026-reference)
- [Turn-Taking in Voice Agents: Why Rule-Based VAD Is Broken and What Comes Next — Gradium](https://gradium.ai/content/turn-taking-voice-agents-vad)
- [Voice Activity Detection: How VAD Powers AI Agents in 2026 — Parloa](https://www.parloa.com/blog/voice-activity-detection-vad/)
- [Voice Agent Turn Detection: Fix UX Before It Breaks — AssemblyAI](https://www.assemblyai.com/blog/voice-agent-turn-detection)
- [Voice User Interface (VUI) Design Principles: Guide (2026) — Parallel HQ](https://www.parallelhq.com/blog/voice-user-interface-vui-design-principles)
- [Voice User Interfaces in 2026: The Future of Ambient AI Now — Zignuts](https://www.zignuts.com/blog/voice-user-interfaces)

### CLI init wizards + API key storage (OS keyring patterns)
- [Best practices for storing API tokens in CLI tools — cli/cli #12488](https://github.com/cli/cli/discussions/12488)
- [Best practices for CLI authentication: A technical guide — WorkOS](https://workos.com/guide/best-practices-for-cli-authentication-a-technical-guide)
- [Onboarding (CLI) — OpenClaw docs](https://docs.openclaw.ai/start/wizard)
- [CLI Onboarding Reference — OpenClaw docs](https://openclaws.io/docs/start/wizard-cli-reference)

### Claude Code skills (SKILL.md best practices, 2026)
- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill authoring best practices — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [The Complete Guide to Building Skills for Claude (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- [Essential Claude Code Skills and Commands — (think)](https://batsov.com/articles/2026/03/11/essential-claude-code-skills-and-commands/)
- [Claude Code Customization: CLAUDE.md, Slash Commands, Skills, and Subagents — alexop.dev](https://alexop.dev/posts/claude-code-customization-guide-claudemd-skills-subagents/)

### SoX / external system dep messaging
- [sox: not found SoX could not be found — audeering/opensmile-python #32](https://github.com/audeering/opensmile-python/issues/32)
- [Hints on using Sox — University of Washington CSE 373](https://courses.cs.washington.edu/courses/cse373/12sp/homework/1/soxusage.txt)
- [Fixed: ModuleNotFoundError no module named sox — Finxter](https://blog.finxter.com/fixed-modulenotfounderror-no-module-named-sox/)

### Voice agent UX, visualizers, prompt-for-speech (carried from v1.2 research)
- [Vapi — Build Advanced Voice AI Agents](https://vapi.ai/)
- [How to build the lowest latency voice agent in Vapi — AssemblyAI](https://www.assemblyai.com/blog/how-to-build-lowest-latency-voice-agent-vapi)
- [Voice AI Latency: What's Fast, What's Slow — Hamming](https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it)
- [ChatGPT Voice Mode Explained: Features, Tips & Setup in 2026 — justainews](https://justainews.com/companies/openai/chatgpt-voice-mode-explained/)
- [Voice Mode FAQ — OpenAI Help Center](https://help.openai.com/en/articles/8400625-voice-mode-faq)
- [Voice (assistant-ui) — voice UI patterns reference](https://www.assistant-ui.com/docs/ui/voice)

### ElevenLabs (carried from v1.2 research)
- [ElevenLabs API in 2025: The Ultimate Guide for Developers — Webfuse](https://www.webfuse.com/blog/elevenlabs-api-in-2025-the-ultimate-guide-for-developers)
- [ElevenLabs Cheat Sheet (2026) — Webfuse](https://www.webfuse.com/elevenlabs-cheat-sheet)

---
*Feature research for: v1.3 Terminal-only Achilles (Bun runtime, Ink TUI, VAD always-listening, sox + ffplay, single npm + skill distribution)*
*Researched: 2026-06-08*
*Supersedes v1.2 floating-window scope; preserves v1.2 SAFE / LOOP / PROMPT requirements verbatim.*
