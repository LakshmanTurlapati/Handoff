# Stack Research — v1.2 Achilles

**Domain:** Voice companion skill for Claude Code — Electron-based floating UI + ElevenLabs STT/TTS + Claude Agent SDK glue, distributed as both a Claude Code skill and a global npm CLI from one monorepo package.
**Researched:** 2026-06-06
**Confidence:** HIGH for ElevenLabs and Claude Code skill/SDK surfaces (verified against current official docs and Context7). MEDIUM for some packaging tradeoffs (dual-distribution patterns documented but no single canonical reference).

---

## Executive Summary

For v1.2 Achilles we add exactly one new app (`apps/achilles`) plus two small shared packages (`packages/voice-protocol`, `packages/voice-skill`). The runtime is **Electron 42.x** for the always-on-top frameless transparent floating window with `focusable: false`. The Claude Code integration uses **`@anthropic-ai/claude-agent-sdk` 0.3.x** running inside Achilles' Electron main process, with a streaming input async-iterable so the transcript is injected as if typed. ElevenLabs work is split: **`@elevenlabs/client` 0.x** in the renderer for browser-side `getUserMedia` → Scribe v2 Realtime STT WebSocket, and **`@elevenlabs/elevenlabs-js` 2.51.x** in the main process for Flash v2.5 streaming TTS. VAD is **`@ricky0123/vad-web` 0.0.30** (Silero via ONNX Web). The waveform is hand-rolled Canvas 2D off the renderer's `AnalyserNode` (no library — wavesurfer is offline-file-oriented and overkill). Dual distribution is one npm package whose `bin` field launches an Electron entry, with the published tarball *also* shaped as a SKILL.md-rooted skill directory; an install script symlinks it into `~/.claude/skills/achilles/`.

The Claude Code skill body is intentionally tiny — it shells out to `achilles launch` (the same npm CLI), so Achilles itself, not Claude, owns the window, mic, and ElevenLabs connections.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Electron** | `42.3.3` (latest stable, Jun 3 2026) | Floating desktop window with mic capture, audio playback, and waveform canvas | Tauri's WebView has documented mic-permission edge cases on macOS (`tauri-apps/wry#1195`, `tauri-apps/tauri#10898`, #11951, #5042), and Tauri ships a *different* WebView per OS so audio worklet + AnalyserNode behavior would need triple-platform QA. Electron ships its own Chromium, so `getUserMedia`, `AudioWorklet`, `MediaRecorder`, and `BrowserWindow({ transparent, frame: false, alwaysOnTop, focusable: false })` all behave identically across macOS/Windows/Linux. The 80–200 MB bundle cost is acceptable because the v1.2 install target is "developer who already runs Claude Code". |
| **@anthropic-ai/claude-agent-sdk** | `0.3.165` (current) | Programmatic Claude Code session control from Achilles' main process | Official Anthropic-published SDK; `query({ prompt, options })` returns an `AsyncGenerator<SDKMessage>` and accepts an `AsyncIterable<SDKUserMessage>` as the prompt — exactly the shape we need to inject the live transcript and stream Claude's response back for TTS. Requires Node 18+ (Electron 42 ships Node 24, well above). |
| **@elevenlabs/elevenlabs-js** | `2.51.0` (Jun 2 2026) | ElevenLabs REST + TTS streaming from Electron main process | Official ElevenLabs Node SDK. Used for `textToSpeech.stream(voiceId, { modelId: "eleven_flash_v2_5", text })` (returns a stream of MP3/PCM chunks) and for minting Scribe single-use tokens server-side. Node 15+ supported; Electron 42's Node 24 is fine. |
| **@elevenlabs/client** | latest (browser SDK) | Renderer-side `Scribe.connect()` to the realtime STT WebSocket | The official ElevenLabs *browser* SDK (`Scribe.connect({ token, modelId: "scribe_v2_realtime", microphone: { ... } })`) handles `getUserMedia`, PCM_16000 chunking, base64 framing, and emits `PARTIAL_TRANSCRIPT` / `COMMITTED_TRANSCRIPT` events. Doing this in the renderer means we don't have to ship a native PortAudio binding (`naudiodon`) or shell out to `sox` (`node-record-lpcm16` / `node-microphone` both require SoX in PATH on macOS, which is hostile for an `npm install -g` install footprint). |
| **TypeScript** | `5.6.x` | All source | Already the monorepo standard. |
| **electron-builder** | `25.x` | Package signed `.dmg` / `.exe` / `.AppImage` after `npm install -g` | We need a usable installer when the user runs the global CLI; `electron-builder` is the maintained successor to `@electron/packager` for signed builds. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@ricky0123/vad-web** | `0.0.30` | Silero VAD (ONNX in Audio Worklet) in the renderer | Emits `onSpeechStart` / `onSpeechEnd`. Drives end-of-utterance detection so we can commit the STT segment and trigger the Claude Code turn. The Node port (`@ricky0123/vad-node`) is *discontinued* per upstream — keep VAD in the renderer (matches our Electron choice). |
| **onnxruntime-web** | `1.20.x` | Backs `@ricky0123/vad-web` | Peer dep; needs `vad.worklet.bundle.min.js` and the ONNX model copied into the renderer bundle. Document this in the Phase plan. |
| **ws** | `8.18.x` | Optional fallback if we ever need a main-process STT WebSocket (e.g., for headless `--no-window` mode) | Reuse the same `ws` already in `apps/relay`'s package.json. Not required for the v1.2 happy path because `@elevenlabs/client` handles the WS in the renderer. |
| **electron-store** | `10.x` | Persist ElevenLabs API key, chosen voice ID, push-to-talk vs continuous toggle | Encrypted at rest via Electron's safeStorage on macOS Keychain / Windows DPAPI. Avoids reinventing config. |
| **zod** | `3.23.x` | Runtime validation of the IPC envelope between renderer and main, plus the Achilles ↔ Claude Code message protocol | Already the monorepo standard per `packages/protocol`. |
| **commander** | `12.x` | CLI surface for `achilles`, `achilles launch`, `achilles install-skill`, `achilles login` | Smaller dep footprint than yargs/oclif; well-typed. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **electron-vite** | Build pipeline for main + preload + renderer | Faster than `electron-forge` for our case; produces TypeScript-typed output and supports hot-reload of the renderer during dev. |
| **electron-builder** (dev) | `npm run dist` to produce signed installers | Used at release time only; not at `npm install -g` time. |
| **pnpm workspaces** (existing) | Add `apps/achilles` and `packages/voice-*` as workspace members | Matches existing Handoff layout. |
| **Turborepo** (existing) | Pipeline orchestration | Already in use per `claude-code-monorepo` patterns in our tree. |

---

## Installation

```bash
# Inside apps/achilles
npm install electron@42 @anthropic-ai/claude-agent-sdk @elevenlabs/elevenlabs-js @elevenlabs/client \
            @ricky0123/vad-web onnxruntime-web electron-store commander zod ws

# Dev dependencies for apps/achilles
npm install -D electron-vite electron-builder typescript @types/node
```

End-user install (two surfaces, one tarball):

```bash
# Surface A — global npm CLI (the primary install path)
npm install -g achilles
achilles launch                 # opens floating UI, ready to talk to Claude Code

# Surface B — Claude Code skill (one-time symlink, done by surface A's post-install)
achilles install-skill          # symlinks the tarball's SKILL.md tree into ~/.claude/skills/achilles/
# In Claude Code:
/achilles                       # shell-outs to `achilles launch`
```

---

## How Each Piece Plugs Together

### 1. Claude Code skill packaging

**Verified facts (Context7 + official docs):**

- A skill is a directory containing `SKILL.md` with YAML frontmatter (`name` ≤ 64 chars lowercase + hyphens; `description` ≤ 1024 chars). Optional fields: `disable-model-invocation`, `allowed-tools`. Source: `code.claude.com/docs/en/skills`. HIGH.
- Personal install path: `~/.claude/skills/<skill-name>/`. Project install path: `.claude/skills/<skill-name>/`. Windows: `C:\Users\<user>\.claude\skills\`. HIGH.
- Skills can ship a `scripts/` subdirectory; Claude runs scripts via the Bash tool. The script's *output* enters context, the source does not. Path interpolation via `${CLAUDE_SKILL_DIR}` resolves correctly regardless of install scope. HIGH.
- "Claude Code: Full network access. Skills have the same network access as any other program on the user's computer." HIGH.
- A skill folder can also include `.claude-plugin/plugin.json` to load as a plugin (bundling agents, hooks, MCP servers). HIGH.
- *Constraint:* "Global package installation discouraged: Skills should only install packages locally in order to avoid interfering with the user's computer." HIGH. This rules out a skill that runs `npm install -g electron`, which is why Achilles' Electron runtime is *not* installed by the skill — the skill just shells out to a binary the user installed via the npm CLI surface.
- *Constraint:* The skill body is plain markdown — there is no programmatic UI surface from within a skill. Any window, any mic, any audio I/O must happen in a child process the skill spawns.

**Implication for Achilles:** the skill is intentionally tiny. `SKILL.md` says "to start the voice companion, run the `achilles launch` command." Claude reads that, runs Bash to invoke `achilles launch`, and Achilles' own Electron process owns the floating UI and ElevenLabs connections. The skill is a launcher; it is not the runtime.

### 2. Claude Code interaction model — how the transcript reaches Claude Code

There are **four documented entrypoints**; Achilles uses #2 as primary and exposes #1 as a fallback.

| # | Entrypoint | Source | Use for Achilles? |
|---|------------|--------|-------------------|
| 1 | `claude -p "<prompt>" --output-format stream-json --include-partial-messages` (with optional `--input-format stream-json` for bidirectional NDJSON over stdin) | `code.claude.com/docs/en/headless` | **Fallback**, used when Achilles is launched outside a Claude Code session and needs to drive a one-shot prompt. Stdin is capped at 10 MB (v2.1.128+). |
| 2 | `@anthropic-ai/claude-agent-sdk` v0.3.165 `query({ prompt: AsyncIterable<SDKUserMessage>, options })` returning `AsyncGenerator<SDKMessage>` | Context7 `/nothflare/claude-agent-sdk-docs` and `code.claude.com/docs/en/agent-sdk/typescript` | **Primary.** Achilles' main process is a Node program; it `import { query } from "@anthropic-ai/claude-agent-sdk"` and feeds each committed STT segment as a user message. Streamed assistant text is buffered into sentence chunks and piped to ElevenLabs TTS. |
| 3 | Claude Code Hooks (`UserPromptSubmit`, `SessionStart`, etc., configured in `~/.claude/settings.json` with `type: "command"` shell hooks) | `code.claude.com/docs/en/hooks` | **Out of scope for v1.2.** Hooks let us *augment* prompts when a user is already typing into Claude Code; they don't let Achilles *originate* prompts. The product flow is voice → Claude, not Claude-user-prompt → voice. |
| 4 | Custom MCP server registered via `claude mcp add --transport stdio achilles -- node ./mcp-server.js`, then `allowedTools: ["mcp__achilles__*"]` | `code.claude.com/docs/en/agent-sdk/mcp` | **Out of scope for v1.2** — MCP lets Claude *call* Achilles, not the other way around. Could be a future "ask Claude to speak this" tool, but not the primary loop. |

**Primary loop (verified against `@anthropic-ai/claude-agent-sdk` typings):**

```typescript
// apps/achilles/src/main/claude-bridge.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

async function* userTurns(transcriptStream: AsyncIterable<string>) {
  for await (const transcript of transcriptStream) {
    yield {
      type: "user" as const,
      session_id: "",  // empty -> SDK starts/continues a session
      message: { role: "user", content: [{ type: "text", text: transcript }] },
      parent_tool_use_id: null,
    };
  }
}

for await (const msg of query({
  prompt: userTurns(committedTranscripts),
  options: {
    appendSystemPrompt: ACHILLES_VOICE_PROMPT,  // "acknowledge first, then act, then summarize"
    model: "claude-sonnet-4-5-20250929",
    allowedTools: ["Read", "Edit", "Bash", "Grep"],
  },
})) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "text") ttsQueue.push(block.text);
    }
  }
}
```

### 3. ElevenLabs STT — Scribe v2 Realtime

**Verified facts (official docs):**

- Model ID: `scribe_v2_realtime`. **150 ms** end-to-end latency, 93.5% accuracy across 30 languages, built-in VAD. Source: `elevenlabs.io/blog/how-scribe-v2-realtime-works`, `realtime-speech-to-text-api`. HIGH.
- WebSocket endpoint: `wss://api.elevenlabs.io/v1/speech-to-text/realtime` (also regional: `api.us.`, `api.eu.residency.`, `api.in.residency.`). HIGH.
- Encodings: `pcm_8000`, `pcm_16000` (default), `pcm_22050`, `pcm_24000`, `pcm_44100`, `pcm_48000`, `ulaw_8000`. HIGH.
- Client → server messages: `input_audio_chunk` (base64 audio + commit flag + sample rate). Server → client: `session_started`, `partial_transcript`, `committed_transcript`, `committed_transcript_with_timestamps`, plus error types. HIGH.
- Authentication: `xi-api-key` header *or* a single-use token via `tokens.singleUse.create("realtime_scribe")` (expires after 15 minutes). The token approach is mandatory for client-side STT because we don't want the API key in the renderer. HIGH.
- Browser SDK: `@elevenlabs/client` exposes `Scribe.connect({ token, modelId: "scribe_v2_realtime", microphone: { echoCancellation: true, noiseSuppression: true } })`. The SDK handles `getUserMedia`, PCM chunking, and base64 framing. HIGH.

**Pricing reality check:** STT on the *API* is bundled into the plan minute pools — Pro ($99/mo) gets ~25 hours STT; overage is ~$3–4.50/hour. Voice-Agent compose pricing (STT + TTS + LLM bundled) starts at $0.08/min Standard, $0.10/min Turbo, $0.12/min Premium. *We do not use the Agents bundle* because we own the LLM (it's Claude Code), so Achilles bills against the STT minute pool only.

### 4. ElevenLabs TTS — Flash v2.5

**Verified facts (official docs):**

- Model ID: `eleven_flash_v2_5`. **~75 ms** first-byte latency on short inputs, 50% lower price/character than Multilingual v2, 32 languages. Recommended for conversational use. Source: `elevenlabs.io/docs/overview/models`, `blog/meet-flash`. HIGH.
- Streaming surfaces: HTTP chunked streaming (Server-Sent Events), WebSocket bidirectional, and a *multi-context* WebSocket. SDK method: `elevenlabs.textToSpeech.stream(voiceId, { modelId: "eleven_flash_v2_5", text })` returns a stream of audio chunks. HIGH.
- Audio output formats: MP3 (multiple bitrates), PCM (multiple sample rates). For Electron renderer playback over `AudioContext`/`AudioWorklet`, MP3 44.1 kHz 128 kbps is the simplest path (browser decodes natively). HIGH.
- `eleven_turbo_v2_5` is now *deprecated* in favor of Flash v2.5 ("functionally equivalent except Flash latency is lower on average"). HIGH. — *Do not* pick Turbo even though many older tutorials still recommend it.
- Multi-context WebSocket allows interrupting an in-flight utterance with a new one — useful when Claude streams a sentence-by-sentence response and we want to start speaking the first sentence before Claude finishes the rest. Plan for this in Phase 2; ship single-context WS first.

**End-to-end conversational latency target (verified-additive):**

| Stage | Source | Latency |
|-------|--------|---------|
| STT first partial transcript | Scribe v2 Realtime spec | ~150 ms |
| End-of-utterance VAD trigger | `@ricky0123/vad-web` default | ~250 ms silence threshold |
| Claude SDK time-to-first-token | Anthropic streaming, Claude Sonnet 4.5 | ~700–900 ms |
| TTS first audio chunk | Flash v2.5 WebSocket | ~75 ms |
| **Speech-end → first audible word** | sum (parallelizing TTS over Claude streaming) | **~1.0–1.3 s** |

This matches the "conversational" target from the constraints in `PROJECT.md`.

### 5. Floating desktop UI — Electron 42.3.3 with `BrowserWindow` panel pattern

**Decision matrix — Electron vs Tauri vs Web-only PWA:**

| Criterion | Electron 42 | Tauri 2 | Web-only PWA |
|-----------|-------------|---------|--------------|
| Bundle size | 80–200 MB | 2–10 MB | 0 MB (browser) |
| Memory | ~120–400 MB | ~50–170 MB | browser-managed |
| `getUserMedia` reliability across macOS/Win/Linux | **Identical Chromium everywhere** | Documented permission edge cases on macOS (wry#1195, tauri#10898, #11951, #5042) | Browser-dependent; requires user to keep tab open |
| `AudioWorklet` for VAD + `AnalyserNode` for waveform | Native | WebView-dependent (WKWebView, WebView2, WebKitGTK behave differently) | Native |
| Always-on-top, frameless, transparent, non-focus-stealing | `BrowserWindow({ frame: false, transparent: true, alwaysOnTop: true, focusable: false })` — one config | Possible but per-platform plumbing | Not possible without OS chrome |
| Ship as both skill launcher *and* npm CLI | npm package with `bin` entry that spawns Electron — works | npm package with `bin` entry that runs a Rust binary — works but cross-compile pain | Cannot be a skill launcher (no local UI process) |
| Distance from existing TS monorepo | Pure TS+Node — fits `apps/web`/`apps/relay`/`apps/bridge` pattern | Rust + TS — new toolchain, new CI, new audit surface | Pure TS — fits, but doesn't meet "floating window" req |

**Verdict: Electron 42.3.3.** The reactive-waveform + mic + transparent always-on-top floating widget *is* what Electron is best at; bundle size is paid once per developer who has already installed Claude Code; cross-platform audio behavior is identical because Chromium is bundled. The Tauri savings (~190 MB) are not worth the macOS mic-permission risk on a voice product. Web-only is eliminated by the floating-window requirement.

**Window config (verified against `electronjs.org/docs/latest/api/browser-window`):**

```typescript
new BrowserWindow({
  width: 220, height: 220,
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  focusable: false,        // does not steal active-window focus
  type: "panel",           // macOS: floats above fullscreen apps
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

Use `win.setAlwaysOnTop(true, "screen-saver")` on macOS so the window stays above fullscreen Claude-in-iTerm sessions.

### 6. Microphone capture + VAD + waveform — all in the renderer

**Mic capture:**

- Renderer: `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 } })`. This is the only path that does *not* require shelling out to SoX (`node-record-lpcm16`, `node-microphone`, `node-mic` all require SoX in PATH) or shipping a native PortAudio binding (`naudiodon` — requires node-gyp at install time, fragile on Windows). Keeping audio in the renderer is the deciding factor for the Electron choice over Node-process capture.
- macOS: Electron requires the `NSMicrophoneUsageDescription` Info.plist key, set via `electron-builder` config. First launch surfaces the standard macOS mic permission dialog.

**VAD:**

- **`@ricky0123/vad-web` 0.0.30** in the renderer. Wraps Silero VAD over `onnxruntime-web` inside an Audio Worklet. Events: `onSpeechStart`, `onSpeechEnd`, `onFrameProcessed(probabilities)`. Drives "commit the segment to Scribe and start the Claude turn" on `onSpeechEnd`.
- The Node port `@ricky0123/vad-node` is **discontinued upstream** — do not use it. (This was a key disambiguation; older blog posts still recommend it.)
- Don't reinvent VAD with `webrtcvad` — the Picovoice/Silero comparison consistently shows Silero higher accuracy at the same CPU cost.

**Push-to-talk vs continuous:**

- Default: continuous + VAD-driven commit. Push-to-talk binding (`option+space` global shortcut via `globalShortcut.register('Option+Space', ...)`) is a Phase 2 option.

**Waveform visualization:**

- **Roll our own** off `AudioContext` + `AnalyserNode.getByteTimeDomainData()` drawn on a `<canvas>` in `requestAnimationFrame`. Reactive circle scales with `AnalyserNode.getByteFrequencyData()` RMS. ~30 lines of code.
- Do **not** use `wavesurfer.js` — it's optimized for displaying *recorded* audio files with seek/cursor, not live mic AnalyserNode output. Issue #578 on the wavesurfer repo explicitly flags that streaming-input is awkward. Adds 100 kB+ for no value here.

### 7. Dual distribution — one source, two surfaces

**The pattern** (verified against `openskills`, `skills-npm`, `vercel-labs/skills`, and the Anthropic skills repo):

The npm package is the source of truth. The published tarball contains:

```
achilles/
├── package.json              # "bin": { "achilles": "./dist/cli.js" }
├── dist/
│   ├── cli.js                # commander entry — handles `launch`, `install-skill`, `login`
│   ├── main/                 # Electron main + preload (built by electron-vite)
│   └── renderer/             # Electron renderer bundle
├── SKILL.md                  # The skill manifest (sees this as root when symlinked)
├── scripts/
│   └── launch.sh             # `#!/usr/bin/env bash` -> exec "$ACHILLES_BIN" launch
├── .claude-plugin/
│   └── plugin.json           # Optional — registers as a plugin if user prefers /plugin install
├── electron/                 # Prebuilt Electron binaries fetched at install time
└── README.md
```

**Two install flows:**

1. **`npm install -g achilles`** — npm sets up the `achilles` symlink in the global bin dir pointing at `dist/cli.js`. First run does the Electron post-install (electron's own `npm install` script fetches platform binaries). `achilles launch` opens the floating window. `achilles install-skill` symlinks the *same* tarball directory into `~/.claude/skills/achilles/` so the SKILL.md is discovered by Claude Code. *No code duplication, no second download.*

2. **`/plugin install achilles`** in Claude Code (alt path) — Claude Code installs the package via its plugin marketplace flow, treats `.claude-plugin/plugin.json` as the entrypoint, and the user still gets a SKILL.md-rooted skill. `SKILL.md` then says "run `${CLAUDE_SKILL_DIR}/scripts/launch.sh`", which exec's the bundled Electron binary directly (no global npm install needed for this flow).

The two surfaces are unified by *one* npm package, with the skill metadata (`SKILL.md`, `.claude-plugin/`, `scripts/`) shipped alongside the npm-CLI build output (`dist/`, `electron/`). The CLI's `install-skill` subcommand is the only piece that materially differs between flows.

**`SKILL.md` body (under 5k tokens):**

```yaml
---
name: achilles
description: Voice companion for Claude Code. Opens a floating reactive UI, captures microphone, transcribes via ElevenLabs, pipes transcript into the active Claude Code session, and speaks acknowledgement + completion back. Invoke when the user says they want to talk to Claude, asks to use voice, or says /achilles.
allowed-tools: Bash
---

# Achilles

To start the voice companion, run `bash ${CLAUDE_SKILL_DIR}/scripts/launch.sh` and report back the URL printed on stdout.

The launcher is non-blocking — it spawns the Achilles window process and exits. Once running, Achilles drives Claude Code itself via the Agent SDK; no further action is needed from this skill.
```

### Integration points with the existing Handoff monorepo

**Suggested layout (does not touch Handoff code):**

```
apps/
├── web/             # (Handoff, unchanged)
├── relay/           # (Handoff, unchanged)
├── bridge/          # (Handoff, unchanged)
└── achilles/        # NEW — Electron app + npm CLI
    ├── src/
    │   ├── cli/index.ts            # commander entrypoint -> bin
    │   ├── main/index.ts           # Electron main: BrowserWindow + Claude SDK + TTS
    │   ├── preload/index.ts        # contextBridge for renderer <-> main IPC
    │   └── renderer/               # React or Solid renderer w/ Canvas waveform
    ├── skill/
    │   ├── SKILL.md
    │   ├── scripts/launch.sh
    │   └── .claude-plugin/plugin.json
    ├── electron.vite.config.ts
    ├── electron-builder.yml
    └── package.json                # "name": "achilles", "bin": { "achilles": "./dist/cli/index.js" }

packages/
├── protocol/        # (Handoff, unchanged)
├── db/              # (Handoff, unchanged)
├── voice-protocol/  # NEW — zod schemas for renderer<->main IPC and STT/TTS events
└── voice-skill/     # NEW — shared types for SKILL.md frontmatter + plugin manifest (Phase 2)
```

Achilles **does not depend on** `apps/relay`, `apps/bridge`, or `apps/web`. It does not require the Handoff `userId`/`deviceSessionId` plumbing. It is a standalone vertical that happens to live in the same monorepo to share the TS toolchain.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Electron 42 | Tauri 2 | If bundle size dropped from a hard requirement to a strict <10 MB cap (e.g., for IoT-style distribution). Not v1.2. |
| Electron 42 | Native macOS overlay via Skia / SwiftUI sidecar | Only if Apple-platform-only and bundle <2 MB are simultaneously required. Forecloses Win/Linux. |
| `@anthropic-ai/claude-agent-sdk` | `claude -p --input-format stream-json` subprocess | If Achilles ever needs to run *outside* a developer machine that has the SDK installed but somehow has `claude` on PATH. Edge case. |
| `@elevenlabs/client` in renderer | `@elevenlabs/elevenlabs-js` `speechToText.realtime` in main + `naudiodon`/`sox` | Only if for some reason the renderer can't access `getUserMedia` (sandboxed, headless test). Adds native bindings or SoX dep — avoid. |
| Flash v2.5 TTS | Multilingual v2 | If "rich emotional voice acting" is more important than latency — *not* for a voice agent. |
| `@ricky0123/vad-web` (Silero) | WebRTC VAD | If accuracy of the Silero model is somehow too high (false-positives on speech-like noise). Picovoice Cobra is also an option but is paid. |
| Hand-rolled Canvas waveform | `wavesurfer.js` | Only if we also need to show *recorded* audio with seek/cursor (we don't). |
| One npm package, two surfaces | Two separate packages (`achilles-cli` + `@anthropic/achilles-skill`) | Forbidden by `PROJECT.md` constraint "Single source of truth must ship as both — duplicate codebases are not acceptable." |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`eleven_turbo_v2_5`** | Officially deprecated; Flash v2.5 is the functional successor with lower latency | `eleven_flash_v2_5` |
| **`scribe_v1`** (per Anthropic cookbook example) | Older Scribe; we want streaming + 150 ms target latency | `scribe_v2_realtime` |
| **`@ricky0123/vad-node`** | Discontinued upstream | `@ricky0123/vad-web` in the renderer |
| **`node-record-lpcm16`, `node-microphone`, `node-mic`** | Require SoX in user `$PATH`; hostile to `npm install -g` install footprint | Renderer-side `getUserMedia` |
| **`naudiodon`** | Native PortAudio bindings via node-gyp; brittle on Windows; install adds C++ toolchain requirement | Renderer-side `getUserMedia` |
| **`wavesurfer.js`** | File-oriented; live-input case is awkward (upstream issue #578) and adds ~100 kB | Hand-rolled `AnalyserNode` + Canvas2D |
| **Tauri 2 for v1.2** | Documented `getUserMedia` permission issues on macOS in the WKWebView path (`wry#1195`, `tauri#10898`, `#11951`); cross-WebView audio behavior differs by OS | Electron 42 (one Chromium) |
| **Building a custom STT/TTS stack** | Out of scope per `PROJECT.md` ("ElevenLabs is the chosen vendor; rolling our own audio models is not a v1.2 goal") | ElevenLabs Scribe + Flash |
| **Native iOS/Android apps for Achilles** | Out of scope per `PROJECT.md` | Cloud-hosted Claude Code + desktop floating window is the v1.2 surface |
| **Hooks (`UserPromptSubmit`/`SessionStart`) as the primary transcript injection path** | Hooks *augment* user prompts inside an active Claude session; they don't *originate* prompts | Agent SDK `query()` with streaming `AsyncIterable` input |
| **MCP server as the primary loop** | MCP lets Claude *call* Achilles; we need Achilles to *drive* Claude | Agent SDK `query()`. (MCP can come later as a "speak this" tool.) |
| **`claude -p` shell subprocess as primary loop** | Stdin 10 MB cap; spawn-per-turn cost; harder to stream cleanly | Agent SDK in-process. Keep `claude -p` as a documented fallback for users who don't have the SDK env set up. |
| **Globally installing `electron-packager`/`electron-builder`** | Anti-pattern per `@electron/packager` docs | Dev-dep + `npm run dist` |

---

## Stack Patterns by Variant

**If the user installs via `npm install -g achilles`:**
- Primary surface is the global `achilles` binary
- `achilles install-skill` is a one-time symlink step
- ElevenLabs API key stored via `electron-store` + `safeStorage`
- Updates flow through `npm update -g achilles`

**If the user installs via `/plugin install achilles` inside Claude Code:**
- Primary surface is the SKILL.md launcher
- The skill's `scripts/launch.sh` invokes the bundled Electron binary in the skill directory (no global `achilles` needed)
- Updates flow through Claude Code's plugin marketplace
- API key entry is prompted on first launch by Achilles' own UI

**If the user is on cloud-hosted Claude Code (the v1.2 primary install target):**
- `achilles install-skill` is the recommended flow per `PROJECT.md`
- Cloud Claude Code triggers `bash ${CLAUDE_SKILL_DIR}/scripts/launch.sh`, which on a cloud machine has no display
- *Therefore*: Achilles needs a `--client` mode where the cloud-side `achilles` registers a relay session and the user's local Achilles window connects to it
- **This is a known v1.2 phase that needs follow-up research** — see PITFALLS.md "Cloud-Claude-Code-has-no-display" entry

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `electron@42.3.3` | `node@24.15.0` (bundled), `chromium@148` (bundled) | Use Electron's bundled Node for renderer and main process; do not mix system Node versions |
| `@anthropic-ai/claude-agent-sdk@0.3.165` | `node@18+` | Electron 42's Node 24 satisfies this comfortably |
| `@elevenlabs/elevenlabs-js@2.51.0` | `node@15+`, Deno 1.25+, Bun 1.0+, Cloudflare Workers | No conflict |
| `@elevenlabs/client` (latest) | Modern browsers / Chromium-based webviews | Requires `AudioWorklet` + WebSocket; both present in Electron 42 |
| `@ricky0123/vad-web@0.0.30` | `onnxruntime-web@1.20+`, browsers with `AudioWorklet` | Audio Worklet support is required; Electron 42's Chromium 148 is fine |
| `@anthropic-ai/claude-agent-sdk` ↔ Claude Code session | Starting June 15 2026, Agent SDK usage on subscription plans draws from a **separate** monthly Agent SDK credit pool, distinct from interactive Claude Code limits | Document in `PITFALLS.md` — billing implication for end users |
| `electron-builder@25` | `electron@42` | Compatible; codesigning for macOS requires Apple Developer cert at release time |

---

## Sources

**Context7 (HIGH confidence):**
- `/nothflare/claude-agent-sdk-docs` — `query()` function signature, streaming `AsyncIterable<SDKUserMessage>` input pattern, TypeScript SDK examples

**Anthropic official docs (HIGH confidence):**
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — SKILL.md format, install paths, `${CLAUDE_SKILL_DIR}`, network access policy
- [Agent skills overview (Claude Platform)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — frontmatter constraints, progressive disclosure, runtime environment by surface
- [Run Claude Code programmatically (headless)](https://code.claude.com/docs/en/headless) — `claude -p`, `--input-format stream-json`, 10 MB stdin cap, `system/init` event, Agent SDK credit pool note
- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) — `query()`, `startup()`, options, async iterable prompts
- [Hooks reference](https://code.claude.com/docs/en/hooks) — 12 lifecycle events, `UserPromptSubmit`/`SessionStart` JSON I/O
- [Connect to external tools with MCP](https://code.claude.com/docs/en/agent-sdk/mcp) — `claude mcp add --transport stdio`, `allowedTools: mcp__*` pattern
- [Low-latency voice assistant cookbook (Claude + ElevenLabs)](https://platform.claude.com/cookbook/third-party-elevenlabs-low-latency-stt-claude-tts) — end-to-end latency numbers, streaming pattern

**ElevenLabs official docs (HIGH confidence):**
- [Realtime STT API reference](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) — WebSocket URL, audio encodings, message types, token auth
- [Client-side streaming guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming) — `@elevenlabs/client` `Scribe.connect()` API, single-use token TTL
- [Scribe v2 Realtime overview](https://elevenlabs.io/realtime-speech-to-text) — 150 ms latency, 93.5% accuracy, 30 languages, built-in VAD
- [Models overview](https://elevenlabs.io/docs/overview/models) — Flash v2.5 (`eleven_flash_v2_5`, ~75 ms), Turbo v2.5 deprecated, Scribe v2 Realtime IDs
- [Meet Flash](https://elevenlabs.io/blog/meet-flash) — Flash positioning, latency, pricing
- [Streaming TTS guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming) — `textToSpeech.stream()`, audio chunk delivery
- [Multi-Context WebSocket](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-multi-stream-input) — utterance interruption for streaming responses
- [Latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization) — Flash + streaming guidance
- [Pricing](https://elevenlabs.io/pricing) and [Pricing 2026 breakdown (Cekura)](https://www.cekura.ai/blogs/elevenlabs-pricing) — STT/TTS per-minute, Agents bundle ($0.08–$0.12/min)

**npm registry / GitHub (HIGH confidence on versions):**
- [`@anthropic-ai/claude-agent-sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — current 0.3.165, Node 18+
- [`@elevenlabs/elevenlabs-js` GitHub](https://github.com/elevenlabs/elevenlabs-js) — current 2.51.0 (Jun 2 2026), Node 15+
- [`@ricky0123/vad-web` on npm](https://www.npmjs.com/package/@ricky0123/vad-web) — 0.0.30, ONNX Web + Audio Worklet
- [`ricky0123/vad` GitHub](https://github.com/ricky0123/vad) — Node port discontinuation note

**Electron docs (HIGH confidence):**
- [Electron Releases](https://releases.electronjs.org/) — 42.3.3 latest stable (Jun 3 2026), Chromium 148, Node 24.15.0
- [BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window) — `transparent`, `alwaysOnTop`, `frame: false`, `focusable: false`, `type: "panel"`, `setAlwaysOnTop("screen-saver")`
- [Electron installation tutorial](https://www.electronjs.org/docs/latest/tutorial/installation) — dev-dep preference, not global install

**Tauri docs (MEDIUM — used to disqualify Tauri):**
- [tauri-apps/wry#1195](https://github.com/tauri-apps/wry/issues/1195) — `getUserMedia()` permission prompt issues on macOS
- [tauri-apps/tauri#10898](https://github.com/tauri-apps/tauri/issues/10898) — "How do I use the microphone"
- [tauri-apps/tauri#11951](https://github.com/tauri-apps/tauri/issues/11951) — macOS mic/cam permission not prompted
- [Tauri vs Electron benchmarks (PkgPulse 2026)](https://www.pkgpulse.com/blog/best-desktop-app-frameworks-2026) — bundle/memory comparison

**Distribution / dual-target (MEDIUM — pattern composed from multiple references):**
- [openskills on npm](https://www.npmjs.com/package/openskills) — single-installer multi-agent skill loader pattern
- [Anthropic skills GitHub](https://github.com/anthropics/skills) — reference implementations for `SKILL.md` + `scripts/` layout
- [Cross-Agent Skills as the new npm (Termdock)](https://www.termdock.com/en/blog/cross-agent-skills-new-npm) — "single source + multi-target installer" pattern

---

*Stack research for: Achilles v1.2 voice companion skill for Claude Code (Electron + Anthropic Agent SDK + ElevenLabs Scribe v2 Realtime STT + Flash v2.5 TTS, dual-distributed as Claude Code skill and global npm CLI from one monorepo package).*
*Researched: 2026-06-06*
