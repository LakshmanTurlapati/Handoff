---
name: achilles
description: Voice companion for Claude Code. Use this skill when the developer says they want to talk, asks to use voice, runs the /achilles slash command, or otherwise indicates they want a spoken interaction. The skill takes over the current terminal pane and runs an in-terminal voice loop -- sox captures microphone audio, ElevenLabs Scribe v2 produces transcripts, a local `claude -p` subprocess shares the embedded companion prompt, and ElevenLabs Flash v2.5 plays short spoken acknowledgements + summaries back through ffplay. The achilles CLI must be installed first via `npm install -g achilles` (Bun-preferred on macOS for sub-500ms cold start); sox and ffmpeg must be on PATH; an ElevenLabs API key must be configured through `achilles init` or the ELEVENLABS_API_KEY environment variable.
allowed-tools: Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(achilles config *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)
---

# Achilles voice companion for Claude Code

## Long-running session timeout

Set `BASH_MAX_TIMEOUT_MS=86400000` (24 hours) in your environment before invoking this skill. The default 600s (10 minute) Bash tool timeout will cut off any voice session longer than 10 minutes, leaving sox / ffplay / claude orphans behind. The 24-hour cap is the maximum the Bash tool accepts; sessions running longer than that should be split into multiple invocations.

## What it does

Achilles is a voice front end for a Claude Code session running on the developer's own workstation. It takes over the current terminal pane and renders a small reactive surface -- a pulsing block-character blob, a braille waveform, and a state row -- inline alongside the conversation log. When the user speaks, sox captures audio, an energy-threshold VAD detects utterance boundaries, ElevenLabs Scribe v2 produces a committed transcript, and that transcript is handed to a local `claude -p` subprocess. claude replies normally in the terminal; two short regions of the reply are routed to ElevenLabs Flash v2.5 and played through ffplay. Everything else stays silent on screen.

The contract for what is spoken vs. what stays silent -- the short opening acknowledgement sentence, the closing `<spoken-summary>` block, the failure-override phrase, the silent body -- lives in `prompts/companion.md` and is injected into claude via `--append-system-prompt-file`. The skill body does not duplicate the contract.

Everything runs inside the calling terminal pane. There is no separate GUI process and no detached child. The skill body shells out to `achilles voice`, the binary takes over the same terminal, and the user presses Ctrl-C (or says "stop") to exit cleanly.

## Prerequisites

- The achilles CLI must be installed on the user's machine: `npm install -g achilles`. On macOS, Bun is preferred for sub-500ms cold start (`bun install -g achilles` or reorder `PATH` so Bun is ahead of Node). On linux-x64, linux-arm64, and win32-x64, a compiled Bun binary ships in the `@achilles/cli-<platform>-<arch>` optional dependency and is dispatched automatically by the bin shim. On macOS (darwin-arm64, darwin-x64), the JS-fallback bundle runs under Node 22+ via the `#!/usr/bin/env node` shebang on `dist/cli.js`; Bun execution is the recommended path but not required.
- `sox` and `ffmpeg` must be on PATH:
  - macOS: `brew install sox ffmpeg`
  - Debian / Ubuntu Linux: `sudo apt install sox ffmpeg`
  - Windows: `choco install sox.portable ffmpeg`
- An ElevenLabs API key must be configured. Run `achilles init` to walk the wizard: API key resolution, then sox / ffmpeg / claude preflight, then a 5-second ambient calibration, then a single-utterance smoke test. The wizard stores the key in your OS keychain via `@napi-rs/keyring`, with an encrypted file at `~/.achilles/key.enc` as a fallback. The headless / CI path is the `ELEVENLABS_API_KEY` environment variable, which always wins on read.
- macOS only -- microphone permission is granted to the **parent terminal emulator** (iTerm2 / Terminal.app / Ghostty / WezTerm), not to achilles itself. The first sox spawn triggers the standard macOS Privacy & Security prompt for whichever terminal you launched achilles from. VS Code's integrated terminal historically does NOT propagate this permission correctly (Phase 18 INIT-06 documents the upstream microsoft/vscode bug); the `achilles init` wizard detects this case and prints a "Open Terminal.app once, then return" remediation line. There is no in-process permission-prompt API call, and remote SSH sessions need to forward microphone access via the parent terminal emulator's own permission grant, not through achilles itself.

## How to launch

When the user invokes this skill, use the Bash tool to run `achilles voice`. The command takes over the current terminal pane and renders the reactive surface until the user presses Ctrl-C or says "stop". It is NOT detached -- Claude Code's Bash tool waits for the process to exit. This is intentional: the skill body invocation is interactive and the visual surface lives inside the same terminal pane Claude Code is using. With `BASH_MAX_TIMEOUT_MS=86400000` set per the note at the top, the Bash tool will wait up to 24 hours for the user to Ctrl-C.

If `achilles` is missing, run `which achilles` first. If absent, surface the install line: `npm install -g achilles`. If `which sox` or `which ffmpeg` reports missing, surface the per-platform install line from the Prerequisites section above. Do not retry or guess; surface the missing-binary diagnostic verbatim and let the user resolve it before re-invoking.

The launch is foreground. Do not invoke other Bash tool calls on the same Claude Code thread while `achilles voice` is running; they will queue behind it.

## How the spoken interaction works

The model's reply is divided into three regions. The first region is a short opening sentence that confirms what work is about to start; it is read aloud before any tool calls so the user gets immediate audio feedback. The second region is the silent body of the reply -- tool calls, code edits, file diffs, intermediate explanations, tool result summaries -- which the user reads in the terminal. The third region is a closing `<spoken-summary>` block on its own line followed by a closing tag; that block is read aloud once terminal work finishes.

Only the first sentence and the contents of the `<spoken-summary>` block are routed to ElevenLabs Flash v2.5. Everything else remains silent on screen. The exact contract -- the word caps on each spoken region, the marker tag syntax, the list of formatting elements forbidden inside the spoken summary, and the failure-override phrase -- lives in `prompts/companion.md`. Achilles passes that file to claude via `--append-system-prompt-file`, so the contract is identical across the npm CLI launch path and this skill launch path.

## When the run fails

When work fails for any reason -- a tool exits non-zero, a permission is refused, sox or ffplay dies, the ElevenLabs WSS connection trips the circuit breaker, or the orchestrator hits an unrecoverable error -- the closing spoken summary opens with the fixed phrase `I ran into a problem` regardless of what the model narrated. The orchestrator determines failure from the claude run's exit code and tool_result events; the model's narration is not authoritative on the failure path. When the spoken stream opens with `I ran into a problem`, the user knows to scroll the terminal back and read what went wrong before issuing the next request.

In addition, an inline red error banner appears one row above the state row whenever a transient failure occurs (network, auth, rate-limit, sox, ffplay, claude). The banner names the error class and suggests a next action; it auto-dismisses after 8 seconds or on the next successful event, whichever comes first.

## Privacy

Achilles holds the ElevenLabs API key only in the user's OS keychain (or, as a fallback, in an encrypted file at `~/.achilles/key.enc` with 0o600 permissions). The npm tarball never contains a key (CI-enforced via a secret-scan step at publish time), local log files never write the key (a 7-regex redaction filter is applied to every log line), and child subprocess invocations do not pass the key on the command line.

Outbound network traffic from achilles goes only to ElevenLabs endpoints (Scribe v2 STT, Flash v2.5 TTS) and to the local `claude` subprocess. No audio or transcript content leaves the user's machine except to ElevenLabs.

Transcripts are not persisted by default. Use `achilles voice --save-transcripts` to opt in; transcripts are written to `~/.achilles/transcripts/<session-id>.jsonl` with secret redaction and a 30-day retention default. Inspect them with `achilles transcripts list`; delete them with `achilles transcripts purge`.

A structured log file at `~/.achilles/achilles.log` (NDJSON, 10MB rotation, 0o600 permissions, key redaction always on) records every session regardless of flags. This closes a gap from v1.2 where a silent-stdio launcher hid a renderer-wiring defect; the log file always exists so future debugging has something to read.
