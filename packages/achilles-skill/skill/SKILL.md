---
name: achilles
description: Voice companion for Claude Code. Use this skill when the developer says they want to talk, asks to use voice, runs the /achilles slash command, or otherwise indicates they want a spoken interaction. The skill launches the locally installed Achilles Electron app via the achilles launch command. Achilles captures microphone audio, transcribes it through ElevenLabs STT, hands the transcript to Claude Code, and reads short spoken summaries back through ElevenLabs TTS. The launch is non-blocking. The achilles CLI must be installed first via npm install -g achilles, and an ElevenLabs API key must be configured through achilles init or the ELEVENLABS_API_KEY environment variable.
allowed-tools: Bash
---

# Achilles voice companion for Claude Code

Achilles is a voice front end for a Claude Code session running on the developer's own workstation. The floating UI lives on the user's machine, ElevenLabs handles speech-to-text and text-to-speech, and Claude Code does the actual coding work. This skill teaches Claude how to recognise a voice-driven request and how to hand control to the locally installed Achilles binary so the spoken loop can run.

## What it does

Achilles wraps a normal Claude Code session in a small floating window. The window shows a single reactive blob that pulses with the user's voice, the microphone state, and the model's state. When the user speaks, the renderer captures microphone audio, downsamples it, streams it through ElevenLabs realtime STT, and ships the committed transcript to a local claude subprocess. The subprocess loads the same embedded prompt that drives every Achilles session through the --append-system-prompt-file flag, so the spoken contract is identical across the npm CLI launch path and this skill launch path. PROMPT-01 in REQUIREMENTS.md fixes the single source-of-truth file shipped alongside this manifest.

Claude responds normally in the terminal. Two short regions of the reply are routed to the user's speakers; everything else stays silent on screen. The first region is a short acknowledgement sentence that Claude emits before any tool calls so the user hears confirmation that work has started. The second region is a closing summary that Claude emits at the very end. The lengths are bounded so the spoken stream is short enough to follow by ear without losing the precise detail of the textual log. PROMPT-02 caps the acknowledgement; PROMPT-03 caps the closing summary; PROMPT-04 keeps everything outside those two regions silent.

Half-duplex turn-taking gates the microphone while text-to-speech is playing so the agent does not transcribe its own voice back. The orchestrator in the local Achilles app owns the audio gate and the failure-detection path; the skill body merely teaches Claude how to launch it.

## Prerequisites

- The achilles CLI must already be installed on the user's machine: `npm install -g achilles`. The skill does NOT install the CLI; it expects the CLI to be on the user's PATH because the skill body shells out to it directly. If the command is missing, the user must run the npm install line first.
- An ElevenLabs API key must be configured. The recommended path is `achilles init`, which walks the user through a guided wizard that stores the key in the OS keystore (macOS Keychain, Windows DPAPI, libsecret on Linux). The fallback for headless setups is the `ELEVENLABS_API_KEY` environment variable, which the main process reads at startup per SAFE-01 in apps/achilles/src/main/key-source.ts.
- Microphone permission must be granted to the Achilles Electron host. The `achilles init` wizard handles the prompt on macOS by calling `systemPreferences.askForMediaAccess('microphone')` per UI-07. On Windows the wizard surfaces the standard system prompt; on Linux the user grants per-application permission through PulseAudio or PipeWire.
- A working terminal that can launch GUI applications. Achilles is an Electron desktop app, so the local environment must allow a window to open. Headless servers, cloud-hosted Claude Code instances, and SSH sessions without X forwarding will not be able to bring up the window.

## How to launch

When the user invokes this skill, use the Bash tool to run `achilles launch`. The command resolves the bundled Electron binary on the host operating system and spawns it as a detached child process. The CLI exits immediately after the spawn so the terminal that triggered the launch is left interactive; the Electron window stays running in its own process tree.

Do not pass extra flags unless the user asked for them. The default launch picks up the configured API key from the OS keystore, opens the floating UI in the screen corner the user last positioned it in, and waits for the push-to-talk hotkey or the equivalent in-window control. If the launch fails because the binary is missing, the CLI prints a clear error pointing the user back to the `npm install -g achilles` step; surface that error verbatim to the user rather than retrying or guessing.

The launch is non-blocking. Continue handling other tool calls in the same session after the launch returns; the Achilles window runs as a sibling process, not a child of the Claude Code subprocess.

## How the spoken interaction works

The model's reply is divided into three regions. The first region is a short opening sentence that confirms what work is about to start; it is read aloud before any tool calls so the user gets immediate audio feedback. The second region is the silent body of the reply — tool calls, code edits, file diffs, intermediate explanations, tool result summaries — which the user reads in the terminal. The third region is a closing `<spoken-summary>` block on its own line followed by a closing tag; that block is read aloud once terminal work finishes.

Only the first sentence and the contents of the `<spoken-summary>` block are routed to text-to-speech. Everything else remains silent on screen. The exact contract — the word caps on each spoken region, the marker tag syntax, the list of formatting elements forbidden inside the spoken summary, and the failure-override phrase — lives in `prompts/companion.md`. Achilles passes that file to Claude via `--append-system-prompt-file` so the contract is identical across the CLI launch path and the skill launch path; the SKILL.md body here does not duplicate the contract.

## When the run fails

When work fails for any reason — a tool exits non-zero, a permission is refused, or the orchestrator hits an unrecoverable error — the closing spoken summary opens with the fixed phrase `I ran into a problem` regardless of what the model narrated. The orchestrator determines failure from the Claude run's exit code and tool result events; the model's narration is not authoritative on the failure path. The contract itself lives in the embedded prompt and the orchestrator's failure-detection logic, not in this skill body. When the spoken stream opens with `I ran into a problem`, the user knows to scroll the terminal back and read what went wrong before issuing the next request.

## Privacy

Achilles holds the ElevenLabs API key only in the user's main-process OS keystore. The renderer never sees the key, the npm tarball never contains the key, IPC traffic never carries the key, and local logs never write the key. Outbound network traffic from Achilles goes only to ElevenLabs endpoints and to the local claude subprocess; no audio or transcript content leaves the user's machine except to ElevenLabs.

Transcripts are not persisted by default. Phase 14 owns the opt-in `--save-transcripts` flag and the corresponding `achilles transcripts purge` cleanup command; set that flag explicitly if a transcript history is required for compliance or your own review.
