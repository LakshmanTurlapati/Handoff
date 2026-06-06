# Architecture Research — Achilles v1.2

**Domain:** Voice companion for terminal coding agents (Claude Code) — local desktop process with cloud STT/TTS, dual-distribution (Claude Code skill + npm CLI)
**Researched:** 2026-06-06
**Confidence:** HIGH for STT/TTS protocols, Claude Code integration entry points, and skill packaging. MEDIUM for end-to-end latency targets (depends on user network). MEDIUM for cloud-hosted Claude Code shape (the v1.2 install surface is named in PROJECT.md but the cloud product API is not yet documented publicly — local CLI integration is the proven path and is what this document specifies; cloud parity is called out as an open question for Phase 1 spike).

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                          DEVELOPER MACHINE                             │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │            Achilles Renderer  (Electron BrowserWindow)           │  │
│  │  ─────────────────────────────────────────────────────────────   │  │
│  │   ● Floating, frameless, always-on-top, transparent              │  │
│  │   ● Reactive circle + waveform (Canvas / WebGL)                  │  │
│  │   ● AudioWorklet: 48kHz mic → 16kHz PCM Int16 frames             │  │
│  │   ● State: Idle | Listening | Thinking | Speaking                │  │
│  │   ● MediaSource / AudioContext playback of TTS stream            │  │
│  └─────────────────────────┬───────────────────────────────────────┘  │
│                            │ IPC (preload bridge, contextIsolation)    │
│  ┌─────────────────────────┴───────────────────────────────────────┐  │
│  │              Achilles Main  (Electron main process, Node)        │  │
│  │  ─────────────────────────────────────────────────────────────   │  │
│  │   ● Window lifecycle + tray icon + global hotkey                 │  │
│  │   ● @achilles/voice-stt → wss STT socket (ElevenLabs Scribe v2)  │  │
│  │   ● @achilles/voice-tts → wss TTS socket (ElevenLabs Flash v2.5) │  │
│  │   ● @achilles/claude-code-bridge → spawn(claude -p …) child      │  │
│  │   ● State machine owner (single source of truth)                 │  │
│  │   ● Secure keystore (keytar) for ELEVENLABS_API_KEY              │  │
│  └────────────────┬──────────────────┬───────────────────────────────┘  │
│                   │ stdin/stdout      │ optional: settings.json         │
│                   │ (stream-json)     │ hooks: Stop, UserPromptSubmit   │
│  ┌────────────────┴──────────────────┴───────────────────────────────┐ │
│  │                 claude (Claude Code CLI child process)              │ │
│  │  ─────────────────────────────────────────────────────────────   │ │
│  │   claude -p --output-format stream-json --verbose                 │ │
│  │          --include-partial-messages --resume <sid>                │ │
│  │   Plus skill-scoped hooks that fire only while /achilles active   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ outbound WSS (TLS 1.3, no inbound)
        ┌───────────────────────┼────────────────────────┐
        ▼                                                ▼
┌──────────────────────┐                  ┌──────────────────────────┐
│  ElevenLabs STT      │                  │  ElevenLabs TTS          │
│  Scribe v2 Realtime  │                  │  Flash v2.5 (stream-input)│
│  wss://api…/v1/      │                  │  wss://api…/v1/text-to-   │
│  speech-to-text/     │                  │  speech/{voice}/stream-   │
│  realtime            │                  │  input?model_id=flash_v2_5│
│  ~150ms inference    │                  │  ~75ms inference TTFB     │
└──────────────────────┘                  └──────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Renderer (`apps/achilles/src/renderer`)** | UI only. Owns mic capture (AudioWorklet), draws circle + waveform, plays TTS audio, reflects state from main. Has no API keys, no direct network access. | React + Canvas2D for the circle, AudioWorklet for PCM conversion, `MediaSource` API for chunked TTS playback. |
| **Main (`apps/achilles/src/main`)** | Process lifetime, window config, global hotkey, IPC owner, keystore reader, **owns both ElevenLabs sockets**, **spawns claude child**, **owns the state machine**. | Electron main + Node 22. Vanilla `ws` for sockets, `child_process.spawn` for claude. |
| **`packages/voice-stt`** | Thin client for ElevenLabs Scribe v2 Realtime. Accepts `Int16Array` frames in, emits `partial` / `committed` events out. Handles reconnect + backoff. | `ws` client, typed events, no UI. |
| **`packages/voice-tts`** | Thin client for ElevenLabs TTS stream-input. Accepts text chunks in, emits MP3 or PCM byte chunks out as a Node `Readable`. Manages `chunk_length_schedule`. | `ws` client, typed events. |
| **`packages/voice-protocol`** | Shared TypeScript types for: renderer↔main IPC messages, voice events (`partial`, `committed`, `tts_chunk`), state machine enum, `ElevenLabsConfig`. | Pure types + Zod schemas (mirror existing `packages/protocol` style). |
| **`packages/claude-code-bridge`** | Wraps `child_process.spawn('claude', ['-p', '--output-format', 'stream-json', …])`. Parses stream-json NDJSON, normalizes into typed events (`assistant_text_delta`, `tool_use`, `result`, `api_retry`). Owns session-id resume. Exposes `sendPrompt(text): AsyncIterable<ClaudeEvent>`. | Node `child_process` + line-delimited JSON parser. |
| **`packages/achilles-skill`** | Source-of-truth `SKILL.md` body + supporting files. Build script copies it into the npm tarball's `skill/` directory and into `~/.claude/skills/achilles/` during `postinstall`. Hosts the embedded system prompt as a `prompts/companion.md` file referenced from both the skill body and `--append-system-prompt-file`. | Static markdown, no code. |
| **`apps/achilles-cli`** | The `bin` entry. A ~50-line bootstrap that locates the bundled Electron binary inside the npm package and execs it. Also runs the `install-skill` postinstall step. | Node script, `bin` field in `package.json`. |

### Process model and lifetimes

```
User runs:  achilles                  OR     /achilles inside Claude Code
            │                                       │
            ▼                                       ▼
   apps/achilles-cli (Node script)        Skill body executes
            │                                       │
            │  (resolves bundled Electron           │  (runs `${CLAUDE_SKILL_DIR}/
            │   and execs the app)                  │   bin/launch.sh` via !` `)
            ▼                                       ▼
   Electron Main process (lives until user dismisses window)
            │ spawn
            ▼
   Renderer process (BrowserWindow)
            │ spawn (deferred until first utterance)
            ▼
   claude child  (one process per Achilles session, --resume reused across utterances)
            ▲
            │ outbound WSS (lazy, opened on first Listening transition)
   ElevenLabs STT + TTS sockets  (long-lived; reconnect on close)
```

**Lifetime rules:**
- Renderer crash → Main respawns it, state preserved (Main owns state).
- Main crash → child claude orphans get SIGTERM'd by CLI wrapper's `process.on('exit')` handler.
- claude child exit → Main marks state Idle, surfaces a non-blocking error toast, allows user to retry.
- STT/TTS socket close → automatic reconnect with exponential backoff (250ms, 500ms, 1s, 2s, cap 5s), state stays in current phase if reconnect succeeds within 1s, else falls back to Idle with a spoken error.

## Recommended Project Structure

```
Handoff/                                # existing monorepo root (npm workspaces)
├── apps/
│   ├── web/                            # (existing) Handoff Next.js mobile UI
│   ├── relay/                          # (existing) Handoff Fly relay
│   ├── bridge/                         # (existing) Handoff local daemon
│   ├── achilles/                       # NEW — Electron app (UI + main process)
│   │   ├── package.json                # name: @codex-mobile/achilles, "main": "dist/main/index.js"
│   │   ├── electron-builder.yml        # cross-platform bundling
│   │   ├── src/
│   │   │   ├── main/                   # Node side
│   │   │   │   ├── index.ts            # app.whenReady, window creation, tray
│   │   │   │   ├── ipc.ts              # contextBridge handlers
│   │   │   │   ├── state-machine.ts    # XState or hand-rolled FSM
│   │   │   │   ├── session.ts          # orchestrates STT → bridge → TTS
│   │   │   │   ├── hotkey.ts           # globalShortcut registration
│   │   │   │   └── keystore.ts         # keytar wrapper
│   │   │   ├── preload/
│   │   │   │   └── index.ts            # contextBridge.exposeInMainWorld('achilles', …)
│   │   │   └── renderer/               # Browser side
│   │   │       ├── index.html
│   │   │       ├── main.tsx            # React root
│   │   │       ├── components/
│   │   │       │   ├── ReactiveCircle.tsx
│   │   │       │   └── Waveform.tsx
│   │   │       ├── audio/
│   │   │       │   ├── pcm-worklet.ts  # AudioWorkletProcessor: 48k→16k Int16
│   │   │       │   └── playback.ts     # MediaSource chained appendBuffer
│   │   │       └── state/
│   │   │           └── achilles-store.ts
│   │   └── tests/
│   └── achilles-cli/                   # NEW — npm bin entry
│       ├── package.json                # name: achilles, "bin": { "achilles": "./dist/cli.js" }
│       ├── src/
│       │   ├── cli.ts                  # locates bundled Electron, execs it
│       │   ├── install-skill.ts        # postinstall: copies skill body to ~/.claude/skills/achilles/
│       │   └── uninstall-skill.ts
│       └── scripts/
│           └── bundle-electron.mjs     # build step: stages apps/achilles dist into ./bundle/
├── packages/
│   ├── protocol/                       # (existing) Handoff protocol
│   ├── db/                             # (existing)
│   ├── auth/                           # (existing)
│   ├── voice-stt/                      # NEW
│   │   ├── package.json                # name: @codex-mobile/voice-stt
│   │   └── src/
│   │       ├── index.ts                # createSttClient(config) → typed EventEmitter
│   │       ├── socket.ts               # ws + reconnect + heartbeat
│   │       └── types.ts                # PartialTranscript, CommittedTranscript, SttError
│   ├── voice-tts/                      # NEW
│   │   ├── package.json                # name: @codex-mobile/voice-tts
│   │   └── src/
│   │       ├── index.ts                # createTtsStream(text$) → Readable<Uint8Array>
│   │       ├── socket.ts
│   │       └── types.ts
│   ├── voice-protocol/                 # NEW
│   │   ├── package.json                # name: @codex-mobile/voice-protocol
│   │   └── src/
│   │       ├── ipc.ts                  # renderer↔main messages (Zod)
│   │       ├── state.ts                # AchillesState enum + transitions
│   │       └── events.ts               # shared event shapes
│   ├── claude-code-bridge/             # NEW
│   │   ├── package.json                # name: @codex-mobile/claude-code-bridge
│   │   └── src/
│   │       ├── index.ts                # createClaudeSession() → { send, events$, close }
│   │       ├── spawn.ts                # child_process.spawn wrapper
│   │       ├── stream-json.ts          # NDJSON parser, typed event union
│   │       └── types.ts                # ClaudeEvent, ClaudeAssistantTextDelta, …
│   └── achilles-skill/                 # NEW — source of truth for the skill body
│       ├── package.json                # name: @codex-mobile/achilles-skill, "files": ["skill/**"]
│       └── skill/
│           ├── SKILL.md                # frontmatter + body
│           ├── prompts/
│           │   └── companion.md        # embedded system prompt (ack + completion contract)
│           └── bin/
│               └── launch.sh           # one-liner: exec achilles
└── scripts/
    └── publish-achilles.mjs            # builds, stages, validates, publishes the npm CLI tarball
```

### Structure Rationale

- **`apps/achilles` (single app, not split into `achilles-ui` + `achilles-main`):** Electron's main and renderer are two halves of the same process tree shipped as one artifact. Splitting them into separate apps fragments the build, complicates `electron-builder` (which expects one `main` entry), and forces cross-app TypeScript references for IPC types that already live in `packages/voice-protocol`. The existing Handoff convention is one app per deployable unit (`web`, `relay`, `bridge`) — Achilles fits the same shape.
- **`apps/achilles-cli` separate from `apps/achilles`:** The CLI is the npm-installable surface. It is published independently to npm so users can `npm install -g achilles` without dragging in the Electron source tree. The CLI's job is to locate and exec the bundled binary, plus run the skill postinstall step. Keeping it separate also lets the existing `apps/bridge` precedent (which is npm-published) stay the model for "this app ships to npm."
- **`packages/voice-stt` and `voice-tts` separate:** Each is an independent vendor wrapper. If we ever swap STT vendors (Deepgram, AssemblyAI) we change one package. They're also independently testable with recorded fixtures — STT against a saved WAV, TTS against a saved text transcript.
- **`packages/claude-code-bridge` distinct from voice packages:** It has no audio concerns and no ElevenLabs coupling. Its only contract is "give me text in, get a stream of typed Claude events out." This makes it reusable: a future "Achilles for Codex" can swap this package without touching voice-stt/voice-tts.
- **`packages/achilles-skill` as a package, not files inline in `apps/achilles-cli`:** The skill body is the single source of truth referenced by both the CLI's install step (which copies it to `~/.claude/skills/achilles/`) and the npm tarball (which includes it for users who want to copy it manually). Putting it in a package gives us versioned imports, allows the build step to do markdown linting, and lets the skill body be tested against the Claude Code skill schema as a separate CI job.
- **The embedded system prompt lives in a `.md` file (`prompts/companion.md`), not inline:** It needs to be human-editable, version-controlled, reviewable in PRs, and large enough to spell out the spoken-acknowledgement and spoken-completion contracts. Inline string constants in TypeScript are unreviewable and easy to break with quoting bugs. The same file is referenced from `SKILL.md` (for skill-mode invocation) and passed to `claude --append-system-prompt-file` (for npm-mode invocation), so the contract is identical across both install paths.
- **Workspace integration:** All new packages adopt the existing `@codex-mobile/*` scope and the npm workspaces convention already in `package.json`. No pnpm migration required. The existing `tsconfig.base.json` extends to the new packages with no changes.

## Architectural Patterns

### Pattern 1: Single state machine, single owner (Electron main)

**What:** All four user-facing states (`Idle`, `Listening`, `Thinking`, `Speaking`) live in `apps/achilles/src/main/state-machine.ts`. The renderer is a pure projection — it receives `STATE_CHANGED` IPC events and re-renders. The renderer never decides state; it only emits intents (`USER_PRESSED_HOTKEY`, `MIC_FRAME`, `PLAYBACK_BUFFER_EMPTY`).

**When to use:** Always, for any process pair with shared lifecycle.

**Trade-offs:**
- Pro: One log to read when debugging "why did Achilles freeze in Thinking?"
- Pro: Race-free transitions (renderer can't disagree with main about state).
- Con: Renderer must round-trip through IPC for every change — but Electron IPC is microseconds, well below voice latency budgets.

**Example:**
```typescript
// packages/voice-protocol/src/state.ts
export type AchillesState =
  | { kind: 'idle' }
  | { kind: 'listening'; sttSessionId: string }
  | { kind: 'thinking'; claudeSessionId: string; transcript: string }
  | { kind: 'speaking'; phase: 'acknowledgement' | 'completion'; ttsStreamId: string };

// apps/achilles/src/main/state-machine.ts
type Event =
  | { type: 'USER_HOTKEY' }
  | { type: 'STT_COMMITTED'; text: string }
  | { type: 'CLAUDE_ACK_TEXT'; text: string }
  | { type: 'CLAUDE_RESULT'; text: string }
  | { type: 'TTS_PLAYBACK_DONE'; phase: 'acknowledgement' | 'completion' };

function transition(s: AchillesState, e: Event): AchillesState { /* … */ }
```

### Pattern 2: Hybrid Claude Code integration — child process for I/O, skill for invocation, hooks for status

**What:** Three Claude Code surfaces working together.

1. **Child process (primary path):** Main spawns `claude -p --output-format stream-json --verbose --include-partial-messages --append-system-prompt-file <companion.md> --resume <sid>`. The `stream-json` output gives us NDJSON with `text_delta` events that we can pipe sentence-by-sentence into the TTS socket as Claude produces them.
2. **Skill (invocation path):** A `SKILL.md` registered at `~/.claude/skills/achilles/` lets users type `/achilles` inside an existing Claude Code session to launch the floating window. The skill body uses `` !`${CLAUDE_SKILL_DIR}/bin/launch.sh` `` to exec the Achilles binary as preprocessing. This is the "I'm already in Claude Code, give me voice" path.
3. **Skill-scoped hooks (status path):** Inside the `SKILL.md` frontmatter, we declare `Stop` and `UserPromptSubmit` hooks. The `Stop` hook reads `transcript_path`, extracts the latest assistant message, and POSTs it to a localhost endpoint that Achilles main exposes (loopback only, ephemeral port written to a runfile). This is the "user invoked Achilles from inside Claude Code; we still need to know when Claude finishes" path.

**When to use:** This hybrid is the recommended path for v1.2. The child-process path is the primary spine; the skill is the on-ramp; the hooks are the synchronization mechanism for the skill-mode install.

**Trade-offs vs. each option in isolation:**

| Option | What it gives | What it costs | Verdict |
|--------|---------------|---------------|---------|
| **A. Child process only** | Full control over stdin/stdout, streaming partial text, easy `--resume`. Works whether Achilles is launched by skill or by npm bin. | Requires Achilles to own the claude session, so user can't already be in Claude Code. | **Primary spine** — every other option layers on top. |
| **B. Achilles is a skill that runs inside Claude Code** | Zero process management, user's existing Claude session is the canonical one. | Skills are markdown instructions, not a long-lived audio service. A skill body can't open a microphone, can't hold a WebSocket, can't draw a UI. The `!`shell`` dynamic context can only run preprocessing — it returns a string, not a long-running process. So skill-as-only-path is structurally infeasible. | **Rejected as the only path.** Used as an *on-ramp* (launch the binary) — see below. |
| **C. MCP server** | Bidirectional, structured, persistent. Claude Code can call `start_listening` as a tool. | MCP is for Claude-initiated calls (model → tool). The Achilles flow is the opposite: user speaks → transcript → Claude. Wedging that into MCP means "MCP tool that pretends to be a prompt source," which fights the protocol. Also: in cloud-hosted Claude Code, the MCP server would need to be reachable from the cloud, breaking the outbound-only constraint. | **Rejected.** Wrong directionality. |
| **D. Hooks only** | Cheap to implement, no child process. | Hooks fire on events Claude already emits; they can't *send* a new prompt as if the user typed it. `UserPromptSubmit` can *modify* a submitted prompt but can't synthesize one out of thin air. So hooks alone can't drive the "voice → terminal" half of the loop. | **Rejected as primary.** Used as a *status sync* mechanism for the skill-mode install path. |

**Concrete invocation by install mode:**

| Install mode | How Achilles starts | How Claude Code runs | How status flows back |
|--------------|---------------------|----------------------|------------------------|
| npm CLI (`achilles`) | User runs `achilles` in any terminal. Electron app opens floating window. | Main spawns its own `claude -p --output-format stream-json …` child as soon as the first transcript is committed. | Direct: NDJSON on the child's stdout drives the state machine. |
| Claude Code skill (`/achilles`) | User runs `/achilles` inside a Claude Code session. The skill's `` !`launch.sh` `` preprocessing execs the Achilles binary. The user's current Claude Code session is left undisturbed. | Achilles still spawns its own `claude` child for the voice loop. The user's host session and the Achilles voice session are two separate Claude sessions; this is acceptable for v1.2 because the spoken acknowledgement contract is identical, and the user is the same. The skill body explicitly tells the user this. | Direct, same as npm mode. The skill-scoped `Stop` hook is configured but is a no-op in v1.2 (kept as a forward-looking hook for v1.3 host-session integration). |

**Why two separate claude sessions in skill mode is acceptable for v1.2:** PROJECT.md explicitly names cloud-hosted Claude Code as the primary install target. Sharing a session with an already-running local Claude Code process requires intercepting that process's stdin, which is OS-specific, fragile, and out of scope. The simpler "Achilles owns its own session" model works identically across npm and skill install modes and is what we ship.

### Pattern 3: Backpressure-aware streaming pipeline

**What:** Each stage of the voice pipeline is a stream with backpressure. The renderer's AudioWorklet emits 20ms PCM frames at 16kHz (640 samples × 2 bytes = 1.28KB per frame, 50 frames/sec). The STT socket consumes those at WebSocket native pace. Claude's stdout emits NDJSON `text_delta` events at ~30-80 chars/sec for a typical model. The TTS socket consumes text in chunks gated by `chunk_length_schedule`. The playback stage's `MediaSource` consumes audio bytes at the playback rate of the user's speaker.

**When to use:** Always for real-time audio. If any stage is allowed to buffer unboundedly, you get either dropped audio or out-of-sync state (Achilles UI says "Speaking" while the speech ended 3 seconds ago).

**Trade-offs:**
- Pro: Bounded memory, deterministic latency.
- Pro: Failures localize — if STT drops, we see it instantly; we don't accumulate frames.
- Con: More plumbing code than "buffer everything." Mitigated by Node's built-in `Readable`/`Writable` semantics in `packages/voice-stt` and `voice-tts`.

**Example:**
```typescript
// apps/achilles/src/main/session.ts (sketch)
const stt = createSttClient({ apiKey, model: 'scribe_v2_realtime' });
const claude = createClaudeSession({ systemPromptFile: companionMdPath });
const tts = createTtsClient({ apiKey, voiceId, model: 'eleven_flash_v2_5' });

// stage 1: mic frames → STT
ipc.on('mic-frame', (pcm: Int16Array) => stt.write(pcm));

// stage 2: committed transcript → Claude
stt.on('committed', async ({ text }) => {
  state.transition({ type: 'STT_COMMITTED', text });
  const events = claude.send(text);          // AsyncIterable<ClaudeEvent>
  let acknowledgementOpen = false;

  // stage 3: Claude text deltas → TTS
  for await (const e of events) {
    if (e.type === 'assistant_text_delta') {
      // first delta after a CompanionContract::ACK marker opens TTS
      if (isAckSegment(e.text) && !acknowledgementOpen) {
        tts.openStream('acknowledgement');
        acknowledgementOpen = true;
      }
      tts.appendText(e.text);
    } else if (e.type === 'result') {
      tts.openStream('completion');
      tts.appendText(extractCompletionSummary(e));
      tts.flush();
    }
  }
});

// stage 4: TTS audio → renderer playback
tts.on('audio_chunk', (bytes) => ipc.send('renderer', 'tts-chunk', bytes));
```

## Data Flow

### End-to-end voice flow

```
T+0ms    User presses Cmd-Shift-A (global hotkey) or clicks the circle
         │
         ▼
T+1ms    Main → renderer: state = Listening
         Main → STT socket: open (if not already)
         Renderer: getUserMedia({ audio }), AudioWorklet starts emitting 20ms frames
         │
         ▼
T+20-200ms (varies, depends on first user phoneme)
         Renderer → Main → STT socket: input_audio_chunk frames
         │
         ▼
T+200ms..end-of-speech
         STT → Main: partial_transcript events
         Renderer: waveform reacts to live amplitude
         │
         ▼
T = end-of-speech
         STT (VAD commit_strategy) → Main: committed_transcript
         Main → renderer: state = Thinking
         Main → claude child: write transcript to stdin (or spawn with --resume)
         │
         │  (~150ms STT inference tail + Claude TTFB)
         ▼
T + ~300-500ms
         claude stdout → Main: first text_delta containing ACK
         Main: detect ACK boundary, open TTS socket, append text
         TTS socket → Main: first MP3/PCM bytes (~75ms model + network)
         │
         ▼
T + ~500-900ms total (mic-end to first audio out — the latency budget)
         Main → renderer: state = Speaking { phase: 'acknowledgement' }
         Renderer: MediaSource appendBuffer, playback starts
         Circle pulses to TTS audio amplitude
         │
         ▼
T + 1s..task duration
         claude continues working (tool calls, file edits, etc.)
         All claude events still arrive on stdout as NDJSON
         Main holds in Thinking-after-ack state; renderer shows breathing circle
         │
         ▼
T = claude result event arrives
         Main extracts completion summary (the second segment per companion.md contract)
         Main → TTS socket: openStream('completion'), append text, flush
         Main → renderer: state = Speaking { phase: 'completion' }
         │
         ▼
T = TTS playback done
         Renderer → Main: PLAYBACK_BUFFER_EMPTY
         Main → renderer: state = Idle
         STT socket stays open (warm); TTS socket closes (per-utterance)
         claude child stays alive with --resume sid for next utterance
```

### Renderer ↔ Main IPC contract (types live in `packages/voice-protocol`)

```typescript
// Renderer → Main
type RendererToMain =
  | { type: 'USER_HOTKEY' }
  | { type: 'USER_CANCEL' }
  | { type: 'MIC_FRAME'; pcm16: ArrayBuffer }   // transferable
  | { type: 'MIC_AMPLITUDE'; rms: number }      // 10Hz for circle animation
  | { type: 'PLAYBACK_BUFFER_EMPTY' }
  | { type: 'PLAYBACK_ERROR'; message: string };

// Main → Renderer
type MainToRenderer =
  | { type: 'STATE_CHANGED'; state: AchillesState }
  | { type: 'PARTIAL_TRANSCRIPT'; text: string }
  | { type: 'TTS_CHUNK'; bytes: ArrayBuffer; mime: 'audio/mpeg' | 'audio/pcm' }
  | { type: 'ERROR'; severity: 'transient' | 'fatal'; message: string };
```

### State machine

```
                  USER_HOTKEY                       STT_COMMITTED(text)
        ┌────────────────────────┐         ┌───────────────────────────┐
        │                        ▼         │                           ▼
   ┌─────────┐             ┌──────────┐   │                     ┌──────────┐
   │  Idle   │             │ Listening│───┴──── USER_CANCEL ──▶ │   Idle   │
   └─────────┘             └──────────┘                         └──────────┘
        ▲                        │                                    ▲
        │  PLAYBACK_DONE         │  STT_COMMITTED(text)               │
        │  (completion)          ▼                                    │
   ┌────────────┐           ┌──────────┐    CLAUDE_ACK_TEXT     ┌──────────┐
   │ Speaking   │◀──────────│ Thinking │────────────────────────│ Speaking │
   │ completion │           └──────────┘                        │   ack    │
   └────────────┘                ▲                              └──────────┘
        ▲                        │  CLAUDE_RESULT                      │
        │                        │                                     │
        └────────────────────────┴─────────────────────────────────────┘
              CLAUDE_RESULT (skip ack if model never emitted it)
```

**Overlap rules — user starts a new utterance while Claude is still working:**

| Current state | User presses hotkey | Behavior |
|---------------|---------------------|----------|
| `Speaking { ack }` | USER_HOTKEY | Cut off TTS playback, transition to `Listening`. The claude child is still working; we ignore its eventual `result` for this turn. The next utterance becomes a new turn via `--resume`. |
| `Thinking` | USER_HOTKEY | Soft-cancel: send the claude child a SIGINT (the equivalent of Ctrl-C in interactive mode), wait up to 200ms for it to drain, transition to `Listening`. If the user has a pattern of barging in we may want a "force-interrupt" preference. |
| `Speaking { completion }` | USER_HOTKEY | Treat as start of next turn: cut TTS, → `Listening`. The completion summary was lost but that's the explicit user signal. |
| `Listening` | USER_HOTKEY | Toggle off → `Idle`. (Hotkey behaves as push-to-toggle, not push-to-talk, in v1.2. Push-to-talk is a future preference.) |

The state machine is implemented in main only. Renderer's transitions are projections, not authoritative.

### Audio formats and buffer sizes (concrete numbers)

| Stage | Format | Frame size | Notes |
|-------|--------|-----------|-------|
| Microphone capture | Float32, native sample rate (44.1k or 48k) | AudioWorklet default 128 samples (~2.7ms @ 48k) | Browser's choice; we accept whatever and resample. |
| Renderer → Main | Int16 PCM, 16kHz, mono | 20ms = 320 samples = 640 bytes | Resampling done in AudioWorklet via linear interp + biquad anti-alias. |
| Main → STT WebSocket | `input_audio_chunk` carrying base64 PCM16, 16kHz | 20ms per message | ElevenLabs Scribe v2 default is `pcm_16000`; matches us natively. |
| STT → Main | `partial_transcript` and `committed_transcript` JSON | per VAD or 1.5s heuristic | We use `commit_strategy: "vad"`. |
| Main → TTS WebSocket | UTF-8 text chunks (per `text` field in stream-input) | sentence-bounded (avg 60-120 chars) | `chunk_length_schedule: [80, 120, 160, 220]` tunes initial TTFB low. |
| TTS → Main | Binary frames, `mp3_44100_64` (default) or `pcm_16000` (lower latency) | ~50ms per frame | v1.2 ships with `mp3_44100_64` for smaller payload; PCM is a future toggle. |
| Main → Renderer | Same bytes, forwarded | unchanged | Renderer uses `MediaSource.appendBuffer` for MP3 or `AudioContext.decodeAudioData` per chunk for PCM. |

### Latency budget (real number, mic-end → first spoken byte)

| Stage | Target | Notes / source |
|-------|--------|----------------|
| STT VAD commit + inference | ~150ms | ElevenLabs Scribe v2 Realtime documented end-to-end |
| Claude TTFB (first token) | ~200-400ms | Variable; depends on prompt size + cloud-hosted vs local |
| First `text_delta` containing ACK | ~50ms after TTFB | Stream is open; first delta arrives immediately |
| TTS open + first audio byte | ~150-200ms | Flash v2.5 model inference + WebSocket round-trip |
| Playback decode + first audio out speaker | ~50ms | `MediaSource` initial buffer |
| **Total mic-end → first audible byte (P50)** | **~600-800ms** | This is the conversational-feel threshold |
| **Total mic-end → first audible byte (P95)** | **~1100ms** | Slow network conditions |

**If a measurement comes back > 1500ms in dev**, the first thing to check is `chunk_length_schedule` — making the first chunk too large is the most common latency miss.

## Scaling Considerations

Achilles is a single-user local desktop app. "Scale" here is per-user resource consumption, not server load.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 user, 1 utterance | Default config. Single STT socket, single TTS socket per utterance, single claude child. |
| 1 user, rapid back-to-back utterances | STT socket stays warm (kept open between Idle transitions). TTS socket is per-utterance (open on Speaking, close on PLAYBACK_DONE). claude child stays alive across utterances via `--resume <sid>`. |
| 1 user, long-running claude session (30+ min) | claude child memory will grow with context. Watch RSS in the dev tools; if it crosses 500MB sustained, plan a "fresh session" UX prompt. v1.2 does not auto-rotate; this is a v1.3 concern. |
| 1 user, 8+ hour daily use | Electron renderer can accumulate detached audio buffers if `MediaSource.removeBuffer` isn't called periodically. We cap retained playback history at 60s. |

### Scaling Priorities

1. **First bottleneck (P0): ElevenLabs rate limits.** A power user running many utterances per hour will hit per-account caps. Mitigation: surface rate-limit errors in the spoken acknowledgement ("ElevenLabs is rate-limiting; try again in 30 seconds"), backoff. Plan a local TTS fallback (e.g., system `say`/`espeak`) only if usage data demands it.
2. **Second bottleneck (P1): claude child memory growth in long sessions.** Mitigated by `--resume` rotation: after N minutes of inactivity, emit a SIGTERM and start fresh on the next utterance. Tracked in v1.3.
3. **Third bottleneck (P2): Electron RAM baseline.** Electron at idle is ~120MB. For users who want it always-on-top all day this is acceptable on modern hardware. If we ever need to ship to lower-end machines we revisit Tauri (see anti-pattern #1).

## Anti-Patterns

### Anti-Pattern 1: Pick Tauri "because it's lighter"

**What people do:** Reach for Tauri 2 for any new desktop app because the bundle size and RAM numbers are better.
**Why it's wrong:** Tauri has documented production bugs with `getUserMedia` on macOS (notarized builds throw "request not allowed by user agent"), and the workaround is a custom Rust audio capture plugin. For an audio-first product on a 6-week milestone, that is the wrong corner to spend novelty budget on. Electron has battle-tested microphone permission flow via `systemPreferences.askForMediaAccess('microphone')` and a documented `NSMicrophoneUsageDescription` story.
**Do this instead:** Use Electron. Pay the 100MB bundle tax for shippability. Reconsider Tauri after v1.2 ships if RAM complaints arrive.

### Anti-Pattern 2: Put the system prompt in TypeScript string literals

**What people do:** Inline the embedded system prompt as a multi-line string in `apps/achilles/src/main/session.ts`.
**Why it's wrong:** The prompt is a product asset, not code. It needs review by non-engineers, version diffs in PRs, and identical injection into both the skill body (`SKILL.md` includes it via markdown include or duplication) and the npm-mode child spawn (`--append-system-prompt-file`). Two copies drift; literal strings are unreadable.
**Do this instead:** Source-of-truth file at `packages/achilles-skill/skill/prompts/companion.md`. Build script bundles it into the skill directory and into `apps/achilles/dist/` for `--append-system-prompt-file`.

### Anti-Pattern 3: Open the TTS socket per text delta

**What people do:** Open a fresh TTS WebSocket for every `assistant_text_delta` from claude.
**Why it's wrong:** WebSocket handshake is ~100ms over even good networks. Doing this per delta defeats streaming. The right model is one TTS socket per spoken segment (one for the acknowledgement, one for the completion), and stream text chunks into it as they arrive.
**Do this instead:** Per-segment TTS streams, gated by markers in the companion prompt that the claude model emits to delimit "spoken acknowledgement" vs "result for terminal".

### Anti-Pattern 4: Let the renderer own the WebSocket

**What people do:** Open the ElevenLabs STT WebSocket from the renderer process because that's where the audio is.
**Why it's wrong:** Two problems. First, the API key would have to be exposed to the renderer, blowing the "API keys stay local" constraint in PROJECT.md. Second, renderer crashes (which happen on GPU resets) would lose in-flight transcripts. Sockets belong in main.
**Do this instead:** Renderer captures audio and ships PCM frames to main via IPC. Main holds the socket. Keystore reads happen only in main.

### Anti-Pattern 5: Use a global skill from `~/.claude/skills/` and assume Claude Code in the current terminal will pick it up automatically

**What people do:** Ship `SKILL.md` and assume users will just see `/achilles` in their existing Claude Code session.
**Why it's wrong:** Skills installed mid-session are picked up via live change detection, but a new top-level skills directory created mid-session requires Claude Code restart. The postinstall step must surface a "restart Claude Code to enable `/achilles`" message.
**Do this instead:** Detect existing `~/.claude/skills/` before install. If it didn't exist, the postinstall message tells the user to restart Claude Code. If it did exist, live detection handles the rest.

### Anti-Pattern 6: Conflate "running on cloud-hosted Claude Code" with "Achilles must run in the cloud"

**What people do:** Read "cloud-hosted Claude Code is the primary install target" and conclude Achilles itself must be a hosted service.
**Why it's wrong:** Cloud-hosted Claude Code still runs against a developer's local source code and is invoked from the developer's terminal. Achilles is the voice surface on top of that terminal invocation. The audio capture, the floating UI, and the ElevenLabs sockets all live on the developer's machine. "Cloud-hosted Claude Code" just means the claude child we spawn talks to Anthropic's hosted backend instead of running an embedded model. From Achilles' perspective, both modes are the same: spawn `claude -p …`, read stdout.
**Do this instead:** Treat cloud-hosted as a config knob on the claude child (env vars, auth source), not as an architectural change.

## Integration Points

### External Services

| Service | Integration Pattern | Notes / Gotchas |
|---------|---------------------|------------------|
| **ElevenLabs Scribe v2 Realtime (STT)** | WebSocket: `wss://api.elevenlabs.io/v1/speech-to-text/realtime`. Auth via `xi-api-key` header. Send `input_audio_chunk` with PCM16 @ 16kHz. Use `commit_strategy: "vad"` so the server segments speech automatically. | Default `pcm_16000` matches our pipeline. Partial transcripts can be used for live captions if we want; v1.2 only uses `committed_transcript`. |
| **ElevenLabs TTS Flash v2.5 stream-input** | WebSocket: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_flash_v2_5`. Send text chunks; signal end-of-utterance with empty string `""`. | `chunk_length_schedule: [80, 120, 160, 220]` tuned for low TTFB. Default output is MP3; can switch to `pcm_16000` if WebGL/`MediaSource` decoder ever becomes the bottleneck. |
| **Claude Code CLI (`claude`)** | Child process: `claude -p --output-format stream-json --verbose --include-partial-messages --append-system-prompt-file <path> --resume <sid>`. Parse NDJSON on stdout. Use `--allowedTools` to pre-approve `Read,Edit,Bash` (matches existing Handoff Phase 06 convention). | Stdin is capped at 10MB per invocation (v2.1.128+), well above our needs. Background bash tasks are SIGTERM'd ~5s after the result; not an issue for our flow. |
| **Claude Code skill system** | Static `SKILL.md` at `~/.claude/skills/achilles/SKILL.md`. Skill body uses `` !`${CLAUDE_SKILL_DIR}/bin/launch.sh` `` dynamic context injection to exec the Achilles binary. | Skill body counts against the 1,536-char description cap for `description` + `when_to_use`, but the main body is unbounded — we use the body for the launch instruction and keep the description short. |
| **macOS Keychain / Windows Credential Manager / libsecret** | `keytar` Node module for storing `ELEVENLABS_API_KEY`. | `keytar` is unmaintained but still the most common option. Acceptable for v1.2; revisit `node-keytar` forks before v1.3 if it breaks. |
| **OS global hotkey** | `electron.globalShortcut.register('CommandOrControl+Shift+A', …)`. Released on `app.on('will-quit')`. | macOS Accessibility permission may be required on first run for global hotkeys. Surface a permission prompt. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Renderer ↔ Main | `contextBridge` exposing typed IPC channels matching `packages/voice-protocol` | `contextIsolation: true`, `nodeIntegration: false`. No `require` in renderer. |
| Main ↔ STT/TTS sockets | Each package exposes a typed event emitter; Main subscribes | Sockets owned and disposed by main only. Renderer never sees them. |
| Main ↔ claude child | `child_process.spawn` with `{ stdio: ['pipe', 'pipe', 'pipe'] }` | One claude child per Achilles session lifetime. Reused across utterances via `--resume`. |
| Achilles ↔ Handoff (existing apps) | **None.** Achilles is a separate vertical. | Confirmed by PROJECT.md: "It does NOT use the Handoff bridge/relay." Workspace integration is purely build-system (shared `tsconfig.base.json`, shared lint config). |
| `apps/achilles-cli` ↔ `apps/achilles` | Build-time only: `bundle-electron.mjs` script copies `apps/achilles/dist/` into `apps/achilles-cli/bundle/electron/` | The CLI's runtime job is locate-and-exec. No IPC. |
| `apps/achilles-cli` postinstall ↔ `~/.claude/skills/` | Filesystem copy of `packages/achilles-skill/skill/**` to `~/.claude/skills/achilles/` | Idempotent; symlinks if the user prefers (a `--dev` flag links the workspace directly for local development). |

## Build & distribution pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│                       MONOREPO BUILD                              │
│                                                                   │
│  packages/voice-stt ──┐                                          │
│  packages/voice-tts ──┤                                          │
│  packages/voice-     ─┤   tsc -p tsconfig.base.json              │
│   protocol           ─┤   →  packages/*/dist                     │
│  packages/claude-     ─┘                                          │
│   code-bridge         │                                          │
│                       ▼                                           │
│  apps/achilles/src ──→ vite (renderer) + tsc (main)              │
│                       →  apps/achilles/dist/{main,renderer}       │
│                       ▼                                           │
│  electron-builder ───→ apps/achilles/release/                     │
│                       │  ├── mac-arm64/Achilles.app/              │
│                       │  ├── mac-x64/Achilles.app/                │
│                       │  ├── win/Achilles.exe                     │
│                       │  └── linux/Achilles.AppImage              │
│                       ▼                                           │
│  apps/achilles-cli/   scripts/bundle-electron.mjs:               │
│   bundle/electron/    ──→ copies platform-matching binary         │
│                       ▼                                           │
│  packages/achilles-   apps/achilles-cli/skill/                    │
│   skill/skill/   ──→ ──→ (copy at build time)                    │
│                       ▼                                           │
│  npm pack            "achilles" tarball with:                     │
│                       ├── dist/cli.js  (npm bin entry)            │
│                       ├── bundle/electron/<platform>/             │
│                       └── skill/  (postinstall copy source)       │
└────────────────────────────┬──────────────────────────────────────┘
                              │
        ┌─────────────────────┴────────────────────┐
        ▼                                          ▼
┌──────────────────┐                    ┌────────────────────────┐
│  npm publish     │                    │  GitHub release        │
│  achilles@1.2.0  │                    │  (optional: standalone │
│                  │                    │   .app/.exe/.AppImage  │
│ install:         │                    │   for users who don't  │
│  npm i -g        │                    │   want npm/Node)       │
│   achilles       │                    └────────────────────────┘
│  ↓               │
│ postinstall:     │
│  → copy skill/   │
│    to ~/.claude/ │
│    skills/       │
│    achilles/     │
│  → unpack        │
│    bundled       │
│    electron      │
│    binary        │
└──────────────────┘
```

### Cross-platform packaging story

- **electron-builder configuration** (`apps/achilles/electron-builder.yml`):
  - `mac`: hardened runtime + notarization, `NSMicrophoneUsageDescription` in `Info.plist`, entitlements for `com.apple.security.device.audio-input`.
  - `win`: NSIS installer or portable `.exe`. No special audio entitlements needed.
  - `linux`: AppImage (the cross-distro option). `libsecret` is the keytar backend.
- **Per-platform binary in the npm tarball:** v1.2 ships a single tarball that includes all three platform binaries. Total size ~250MB, which is large but acceptable for a global install. Future optimization: platform-detect at install time and download the matching binary from a CDN (saves ~80% size).
- **Code signing:** Mac binary must be signed with a Developer ID certificate before the microphone permission prompt is honored on notarized builds. Signing key is a CI secret. Out of scope for the first dev build but required for the published release.

### Why one source of truth works

The dual-install target is satisfied by:
1. **Skill body (`packages/achilles-skill/skill/SKILL.md`):** Read by Claude Code from `~/.claude/skills/achilles/SKILL.md`. Contains the embedded system prompt and a one-line launch instruction.
2. **Embedded system prompt (`packages/achilles-skill/skill/prompts/companion.md`):** Read at runtime by `apps/achilles/src/main/session.ts` via `--append-system-prompt-file` for the claude child.
3. **Electron binary (`apps/achilles`):** The only thing that actually runs the voice loop. Exec'd by either the npm `bin` entry or the skill's preprocessing command.

The skill body is short ("here's how to launch Achilles, here's what to expect"). All the real product logic is in the binary. The system prompt is one file, referenced from both paths. There is one source of truth.

## Build order for the roadmap (downstream-consumer payload)

Suggested phase decomposition for the roadmapper, in implementation order:

1. **Voice clients (`packages/voice-stt`, `packages/voice-tts`, `packages/voice-protocol`).** Stateless, pure SDK wrappers. Cluster into one phase. Validatable in isolation with WAV fixtures and recorded text. ~3-5 days.
2. **Claude Code bridge (`packages/claude-code-bridge`).** Independent of voice. Validatable in isolation with golden NDJSON fixtures. Cluster with phase 1 or its own phase. ~2-3 days.
3. **Electron app shell (`apps/achilles`) — UI only.** Frameless transparent always-on-top window, reactive circle, waveform, mock state. No voice, no Claude. Validatable as a standalone visual. ~3-4 days.
4. **End-to-end wiring inside `apps/achilles/src/main/session.ts`.** Compose voice-stt + claude-code-bridge + voice-tts behind the state machine. First real "mic to spoken answer" validation. ~4-6 days.
5. **npm CLI (`apps/achilles-cli`).** The bin entry, the bundling step, the postinstall. Cross-platform smoke test. ~2-3 days.
6. **Skill packaging (`packages/achilles-skill`) and `~/.claude/skills/achilles/` install.** Includes the embedded system prompt. Test invocation via `/achilles` inside Claude Code. ~2 days.
7. **Hardening: latency profiling, reconnect behavior, error UX, microphone permission flows on all three platforms, code signing.** ~3-5 days.

Phases 1, 2, and 3 are independent and can run in parallel if there are multiple engineers. Phase 4 is the integration milestone. Phases 5 and 6 are the distribution milestone.

### Integration points with existing monorepo

- **`package.json` workspaces field:** no change — `apps/*` and `packages/*` already cover the new directories.
- **`tsconfig.base.json`:** add path aliases for new packages, matching existing `@codex-mobile/protocol` convention.
- **`vitest.workspace.ts`:** add the new packages and `apps/achilles` so `npm test` picks them up.
- **`playwright.config.ts`:** add an `apps/achilles` E2E project if we end up wanting renderer-level UI tests. Optional for v1.2.
- **No changes to `apps/web`, `apps/relay`, `apps/bridge`, `packages/protocol`, `packages/db`, `packages/auth`.** Achilles is hermetic.

## Open questions to surface to the roadmapper

- **Cloud-hosted Claude Code specifics:** PROJECT.md names cloud as the v1.2 target, but the cloud product's public API surface isn't fully documented at research time. Phase 1 should spike on whether `claude -p` with a cloud auth env var works identically to the local CLI, or whether there's a different entry point (`anthropic.claude.ai/cloud-cli`-style URL, hosted SDK runtime, etc.). If the cloud surface materially differs from the local CLI, the integration boundary may need a thin adapter inside `packages/claude-code-bridge`. The architecture survives that change; only the bridge's spawn step is affected.
- **macOS code signing identity:** Out of architectural scope but a known release blocker. Resolve before publishing.
- **Voice selection UI:** PROJECT.md doesn't specify whether users pick their own ElevenLabs voice. v1.2 ships one default voice; voice picker is a future feature.
- **Push-to-talk vs press-to-toggle:** v1.2 ships press-to-toggle (one hotkey press = start listening, second press = stop). Push-to-talk (hold to talk) is a preference for a future phase.

## Sources

- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) — confirms `SKILL.md` structure, frontmatter fields, `${CLAUDE_SKILL_DIR}`, skill-scoped hooks, live change detection (HIGH confidence, official docs)
- [Run Claude Code programmatically — Claude Code Docs](https://code.claude.com/docs/en/headless) — confirms `claude -p`, `--output-format stream-json`, `--include-partial-messages`, `--append-system-prompt-file`, `--resume <sid>`, `--allowedTools`, 10MB stdin cap, background task SIGTERM grace period (HIGH confidence, official docs)
- [Hooks reference — Claude Code Docs](https://code.claude.com/docs/en/hooks) — confirms `Stop`, `UserPromptSubmit`, `SessionStart`, transcript_path payload, skill-scoped hooks in frontmatter, `additionalContext` JSON output for context injection (HIGH confidence, official docs)
- [Plugin marketplaces — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces) — confirms skill distribution via marketplaces and the option of plain `~/.claude/skills/` install (HIGH confidence)
- [Realtime STT API — ElevenLabs Docs](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) — confirms `wss://api.elevenlabs.io/`, PCM 8/16/22/24/44/48 kHz, `input_audio_chunk`, `partial_transcript` / `committed_transcript`, `commit_strategy: "vad"` (HIGH confidence, official docs)
- [Scribe v2 Realtime — ElevenLabs](https://elevenlabs.io/realtime-speech-to-text) — confirms ~150ms inference latency target (HIGH confidence)
- [Realtime TTS stream-input — ElevenLabs Docs](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts) — confirms `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=`, `chunk_length_schedule`, send empty string to flush (HIGH confidence, official docs)
- [Latency optimization — ElevenLabs Docs](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization) — confirms `eleven_flash_v2_5` as the lowest-latency model (~75ms model TTFB) (HIGH confidence)
- [WebSocket TTS reference — ElevenLabs Docs](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input) — confirms protocol details (HIGH confidence)
- [Time to First Audio — Gradium](https://gradium.ai/blog/time-to-first-audio) — corroborates real-world TTS streaming TTFB numbers (MEDIUM confidence, third-party benchmark)
- [Streaming TTS benchmark — Podcastle](https://podcastle.ai/blog/tts-latency-vs-quality-benchmark/) — corroborates streaming TTS latency vs quality tradeoffs (MEDIUM confidence)
- [Electron systemPreferences API](https://www.electronjs.org/docs/latest/api/system-preferences) — confirms `getMediaAccessStatus('microphone')` and `askForMediaAccess('microphone')` on macOS (HIGH confidence, official docs)
- [Requesting microphone permission in Electron — BigBinary](https://www.bigbinary.com/blog/request-camera-micophone-permission-electron) — confirms `NSMicrophoneUsageDescription` Info.plist requirement (MEDIUM confidence, third-party but corroborated by official Electron docs)
- [Tauri getUserMedia bug — tauri-apps/tauri#8314](https://github.com/tauri-apps/tauri/issues/8314) and [#11951](https://github.com/tauri-apps/tauri/issues/11951) — confirms documented production friction with getUserMedia in notarized Tauri 2 macOS builds (HIGH confidence, official issue tracker)
- [Tauri vs Electron 2026 — PkgPulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) — bundle size and RAM comparison (MEDIUM confidence)
- [node-pty — Microsoft](https://github.com/microsoft/node-pty) — alternative spawn mechanism if we ever need PTY semantics for claude (not v1.2 — `child_process.spawn` is sufficient because `claude -p` is non-interactive) (HIGH confidence)
- [Web Audio API AudioWorklet — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet) — confirms AudioWorklet pattern for 128-sample frame processing (HIGH confidence, official docs)
- [Stream audio to Amazon Transcribe — AWS Blog](https://aws.amazon.com/blogs/machine-learning/stream-multi-channel-audio-to-amazon-transcribe-using-the-web-audio-api/) — corroborates 16kHz resampling + Int16 conversion pattern in browser (MEDIUM confidence)
- [Claude Code session JSONL format — Medium / Yi Huang](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b) — confirms transcript at `~/.claude/projects/<encoded>/<session-id>.jsonl` for hook-based final-message extraction (MEDIUM confidence, third-party)
- [@anthropic-ai/claude-agent-sdk — npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — alternative TypeScript SDK path. We choose CLI spawn over SDK in v1.2 because the CLI's `--output-format stream-json` already gives us NDJSON we can parse, and the CLI ships with users' existing Claude Code auth — we don't have to manage auth ourselves (HIGH confidence)

---
*Architecture research for: Achilles v1.2 voice companion*
*Researched: 2026-06-06*
