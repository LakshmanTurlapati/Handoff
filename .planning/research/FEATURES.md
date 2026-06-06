# Feature Research

**Domain:** Voice companion / floating HUD for terminal coding agents (Claude Code)
**Researched:** 2026-06-06
**Confidence:** HIGH for table stakes (verified against ChatGPT Advanced Voice, Pi, Vapi, Retell, Wispr Flow, Aqua Voice, Claude Code voice-mode); MEDIUM for differentiator scoping; HIGH for anti-features (industry consensus on barge-in cost, wake-word fragility, transcript-review usability regressions).

## Reference Products Surveyed

| Product | Surface | Relevance to Achilles |
|---------|---------|----------------------|
| **ChatGPT Advanced Voice Mode** | Mobile + desktop, "blue orb" full-screen + unified inline | Sets baseline UX: orb state animation, barge-in, continuous mode |
| **Pi (Inflection)** | Mobile call-style voice | Sets tone bar for "natural backchannels"; designed by ustwo for emotional resonance |
| **Vapi / Retell** | Voice agent platforms / SDKs | Sets technical bar for latency (~465ms end-to-end), barge-in, VAD; widget patterns (VoiceButton, VoiceStatus, VoiceVisualizer) |
| **Wispr Flow** | Push-to-hotkey dictation, dev-focused | Sets the developer expectation: PTT hotkey, IDE-agnostic, "speak and let the IDE refine" |
| **Aqua Voice** | Push-to-talk dictation, dev-focused | Sets quality bar: Instant Mode 200ms startup / 450ms result, dev-aware vocab, edit-by-voice |
| **Claude Code `/voice`** | Anthropic's own voice mode | Sets the *direct* baseline Achilles must beat or differentiate from: spacebar PTT, no wake word, no always-listening, inserts at cursor |
| **Suki** | Ambient clinical assistant | Reference for "ambient capture + structured summary" pattern; explicitly *not* what Achilles is |
| **Krisp Voice** | Audio processing SDK | Reference for noise/voice isolation expectations on a desktop voice surface |
| **Voice Mode (Claude Code MCP)** | Community MCP for spoken Claude | Direct functional precedent; Achilles supersedes with first-party UI and ElevenLabs |

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

#### Voice Capture UX

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Push-to-talk hotkey (hold-to-talk)** | This is the dev-tool baseline. Wispr Flow, Aqua Voice, and Claude Code's own `/voice` all default to PTT. Devs explicitly do not want always-listening when a terminal/IDE has focus. | LOW | Hold-to-record pattern; default hotkey should not collide with Claude Code's spacebar PTT or common terminal shortcuts. macOS global hotkey requires Accessibility / Input Monitoring permissions. |
| **On-screen mic button (click-to-start, click-to-stop)** | Floating UI must be operable when hotkey is unmapped / not granted permission yet. ChatGPT, Pi, Vapi all expose a tappable mic. | LOW | Toggle-style for the floating window (single click starts, single click stops); hold-style for keyboard hotkey. |
| **Mute / pause control** | Privacy norm. Users expect a one-click way to stop listening without quitting the app. Wispr Flow, Krisp, and OS-level mic indicators normalize this. | LOW | Single "muted" state that visibly distinguishes from "idle." OS mic indicator continues to be the source of truth. |
| **Four visible states: idle / listening / processing / speaking** | Every reference product (ChatGPT orb, Pi, Vapi VoiceStatus, LiveKit VoiceAssistantBarVisualizer) renders these four explicitly. | LOW | Maps 1:1 to the brief: "listening / transcribing / Claude Code working / speaking back." Adding "error" as a fifth state is table-stakes for any production agent. |
| **OS-level microphone permission flow on first run** | macOS / Windows refuse mic access until user grants. Not handling this is a launch-day bug. | LOW | Detect permission denial, route user to System Settings with explicit copy. |

#### Reactive UI (Circle + Waveform)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Central circle that pulses with live mic amplitude when listening** | ChatGPT blue orb, Pi orb, Siri orb — this is the canonical voice-agent shape. Users will pattern-match instantly. | MEDIUM | Drive scale and glow from `AnalyserNode` RMS / smoothed amplitude. Web Audio API in the renderer is sufficient. |
| **Circle changes color/intensity per state** | Industry convention: cool/blue or neutral when idle, brighter / warmer when listening, animated swirl when processing, calmer pulse when speaking back. | LOW | State → color token mapping in a single style hook. |
| **Breathing animation when idle** | ChatGPT and Pi both render a gentle ambient pulse to signal "alive but inactive." Dead-still circles read as broken/disconnected. | LOW | Sine-driven scale on a long period (3-5s); pause when window is hidden. |
| **Live waveform that responds to mic when listening, to TTS amplitude when speaking** | Vapi widget reference, LiveKit VoiceAssistantBarVisualizer, Voice UI Kit CircularWaveform, and every consumer voice agent ship some form of live bar/wave. | MEDIUM | Frequency-bin bars from `AnalyserNode.getByteFrequencyData`. Same component renders mic input during *listening* and TTS playback during *speaking* — single switch on audio source. |
| **Small, always-on-top floating window** | Brief specifies it; precedent: Floaty, Voicemod Overlay, Chrome's Gemini Live floating panel, MIA HUD. Anything else covers the terminal and defeats the purpose. | MEDIUM | Electron / Tauri frameless window, always-on-top, draggable. Compact footprint (~200-300px square). |
| **Drag-to-reposition** | Floating windows that cannot be moved get in the way and get uninstalled. | LOW | Standard frameless drag region. |

#### Speech Output (Acknowledgement + Completion)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Short spoken acknowledgement at task start ("okay, working on that")** | Voice-agent norm: "back-channel" responses (mm-hmm, okay, on it) acknowledge user input within ~200-400ms of utterance end. Acknowledgements that arrive faster than full LLM response close the perceived-latency gap. ChatGPT, Pi, Vapi all do this. | MEDIUM | Driven by Claude Code's embedded system prompt: first token of model output is the spoken ack, streamed to ElevenLabs TTS immediately. Keep <2s of audio. |
| **Spoken completion summary ("done — here's what I changed")** | Hands-busy users need an audible end-of-task marker. Suki, ChatGPT Record summaries, and ambient-AI norms all close work with an explicit summary. Brief is explicit. | MEDIUM | System prompt instructs Claude Code to emit a labeled "spoken summary" block at completion. Achilles extracts and routes that block to TTS, not the entire transcript. Tone should be short, declarative, ~10-25 seconds of audio. |
| **TTS plays through the same default output device the user expects** | Audio that comes out of the wrong device is a launch-day support burden. | LOW | Use system default; expose explicit override in settings. |
| **State transitions while Claude Code is working** | The "Claude Code thinking" state cannot be silent or invisible — users will speak again, then get a barge-in race. Vapi, Retell, and ChatGPT all show a "processing" animation. | LOW | Circle switches to processing animation (subtle swirl / shimmer) for the entire duration Claude Code is running, until the completion summary plays. |

#### Transcript Fidelity

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Show the heard transcript in the floating UI before / as it lands in Claude Code** | OpenAI explicitly regressed by *hiding* the transcript and was met with "major usability regression" backlash. Wispr Flow shows transcript in the active app. Aqua shows formatted text. Users want to *see* what was heard. | LOW | Render below the waveform; truncate older lines. Treat this as a live caption, not an editor. |
| **Stream tokens visually as STT returns them (low-latency feel)** | ElevenLabs Scribe / streaming STT returns partial transcripts. Showing them as they arrive matches user expectation set by Whisper-in-browser apps and ChatGPT dictation. | MEDIUM | Streaming STT; UI updates per partial. |
| **Last-utterance "what I heard" buffer visible after send** | After release-PTT, users want to confirm what Achilles thought they said before Claude Code reacts. Aqua/Wispr both show post-dictation text. | LOW | Persist the last final transcript on screen until the next utterance starts. |

#### Voice Selection + Customization

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **ElevenLabs API key configured via env var or one-time CLI prompt** | Industry norm for any tool depending on a third-party API key. `ANTHROPIC_API_KEY` precedent within Claude Code itself. | LOW | `ELEVENLABS_API_KEY` env, plus `achilles configure` flow that writes to local config file (e.g., `~/.config/achilles/config.json`). Never commit, never log. |
| **Voice ID configurable (pick from any voice in the user's ElevenLabs library)** | ElevenLabs SDK exposes `voices.search()`. Users with cloned/library voices will not accept a hardcoded default. | LOW | `achilles voices list` command + voice-ID field in config. Cache voice metadata locally; voice ID is permanent so safe to cache aggressively. |
| **Sane default voice if user has not picked one** | First-run must work. Asking the user to pick a voice before any audio plays is a friction wall. | LOW | Use a documented ElevenLabs public voice ID as fallback (one of the well-known production voices). |

#### Install + Onboarding

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`npm install -g` from a single command, no monorepo clone** | Set by Claude Code itself (`npm install -g @anthropic-ai/claude-code`). Anything more involved than one command is a drop-off. | LOW | Publish `@handoff/achilles` (or chosen scope) with a `bin` entry. |
| **Claude Code skill install from same artifact** | Brief constraint. Precedent: skills-npm pattern (npm install brings the skill folder; a postinstall or `achilles install-skill` symlinks into `.claude/skills/`). | MEDIUM | Single npm package contains both the CLI binary and the `skill.json` + skill assets. `achilles install-skill` or postinstall script symlinks/copies into the Claude Code skills directory. |
| **First-run wizard: API key prompt → mic permission → voice selection → test round-trip** | Aqua, Wispr, Suki all walk new users through this. Skipping it leaves the user staring at silence. | MEDIUM | `achilles init` runs the wizard; ends with "say something now" smoke test that confirms STT round-trip, then plays a TTS confirmation. |
| **One canonical way to start Achilles** | A floating UI that requires three flags and two env vars is dead on arrival. Cursor / Wispr launch with one click or one command. | LOW | `achilles` (no args) opens the floating window with current config. |
| **Discoverable docs at first run (where to find help, how to swap voices, how to revoke key)** | Standard CLI norm. Failing to surface this drives support tickets. | LOW | `achilles --help` lists subcommands; readme link in init output. |

#### Claude Code Integration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Transcript piped into Claude Code as if typed by the user** | Brief constraint. This is the contract. Voice Mode (Claude Code MCP) and Claude Code's own `/voice` both work this way. | MEDIUM | Pipe via stdin to a running Claude Code process, or via the Claude Code CLI's documented entrypoint. Cloud-hosted Claude Code is the v1.2 install target — exact integration path is a Phase 1 research item. |
| **Embedded system prompt that forces "spoken ack then spoken summary"** | Brief constraint. Without this prompt, Claude Code's output is not playable — it is full of code, paths, and tool call traces. | MEDIUM | Ship a minimal `prompts/spoken.md` in the skill. Instructs Claude Code to: (1) start with one-sentence spoken acknowledgement, (2) end with a `<spoken-summary>` block ≤25 seconds of speech, (3) keep the body of the work normal/full-fidelity for the terminal reader. |
| **Achilles extracts only the spoken portions and routes them to TTS** | Reading every line of `tool_use` output aloud is anti-productive. Acknowledgement and `<spoken-summary>` are the only things spoken. | LOW | Parse stream for the agreed markers; pass the rest to the on-screen terminal unchanged. |
| **Visible indicator that Claude Code is currently running** | If Achilles looks idle while Claude Code is editing 12 files, the user will speak again and create a race. | LOW | Use the "processing" state of the orb plus a one-line status caption ("Claude Code is working…"). |

#### Privacy + Permissions

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Respect OS-level microphone indicators (orange dot / taskbar mic)** | Both macOS and Windows show a system mic indicator that cannot be bypassed. Achilles should not appear to fight it. | LOW | Use the standard `getUserMedia` path so OS indicators light up correctly. |
| **Stop capturing the moment user hits mute or releases PTT** | Privacy norm; expected by every PTT product. | LOW | Tear down the media stream, not just stop the analyser. |
| **No audio sent anywhere other than ElevenLabs** | Brief constraint. Standard expectation for a local-first dev tool. | LOW | Single outbound endpoint; documented in the README and in the first-run wizard. |
| **API keys stored only on the local machine, never logged** | Industry baseline; Aqua/Wispr both document this. | LOW | Plain config file with documented permissions; redact in any debug log output. |
| **Visible "currently capturing" state inside the Achilles window** | Floating windows that capture without visibly indicating it lose trust. ChatGPT, Pi, Vapi all have a distinct capturing state. | LOW | Already covered by the listening-state visual; just ensure no edge case (window minimized) leaves capture running silently. |

### Differentiators (Competitive Advantage)

Features that set Achilles apart. Not required to ship, but each meaningfully widens the gap against Claude Code's built-in `/voice` and generic STT-into-Claude-Code workflows.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **First-class "spoken summary" surface** | Claude Code's `/voice` only does dictation in; it does not speak the result back. Voice Mode MCP speaks but has no first-class UI. Achilles being the first surface where Claude Code *speaks completion* with a designed prompt is the most defensible differentiator. | MEDIUM | Owned by the embedded system prompt + Achilles' completion-summary extractor. Iterate on prompt tone (terse, declarative, ~10-25s). |
| **Reactive circle + waveform that matches the consumer-grade orb feel users already know from ChatGPT/Pi** | Most developer voice tools (Wispr, Aqua) hide behind a tray icon. Devs respond emotionally to a "real" voice surface. This is the easiest "feel premium" win. | MEDIUM | Web Audio API in renderer, frameless window. Use Voice UI Kit / react-ai-voice-visualizer patterns as references but ship a custom look. |
| **Single artifact → CLI + Claude Code skill** | Most skill ecosystems ask users to clone or copy skill folders. Shipping both from one npm package is genuinely rare. skills-npm is exploring this; Achilles can lead with it. | MEDIUM | Postinstall or explicit `achilles install-skill` subcommand; documented in the README's one-line install. |
| **Voice-aware system prompt tuned for spoken playback** | Most "voice-on-top-of-an-agent" stacks naively read the entire model output. Tuning the prompt so completion summaries are written *for the ear* (short sentences, no code blocks, no file paths) is a small change with outsized perceived quality. | LOW | One markdown file. The differentiator is craft, not engineering. |
| **Status line that names what Claude Code is doing** | "Claude Code is editing src/lib/index.ts" in the floating window beats a silent processing animation. Cursor's UI does similar inline. Maps to Claude Code's tool-call stream. | MEDIUM | Subscribe to Claude Code's structured event stream (if available against the chosen integration path) and surface a one-line status. Gate behind feature flag if cloud-hosted Claude Code does not expose tool events cleanly. |
| **Voice ID hot-swap from the floating UI (no restart)** | ElevenLabs voice ID is just a parameter on the next TTS call — there is no reason to require a restart. Users love to try different voices. | LOW | Dropdown / cycle button in the window; persists to config on selection. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look like the right move but create problems in v1.2.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Wake-word ("Hey Achilles" / "Hey Claude")** | Sounds futuristic; users see it in Alexa/Siri | Terminal users prefer push-to-talk for privacy and determinism (verified across Wispr, Aqua, Claude Code `/voice`). Wake-word engines are heavy (Porcupine etc.), licensed, and false-fire constantly in dev environments where music/podcasts are playing. Anthropic's own product explicitly chose no wake word. | Push-to-talk hotkey + on-screen click. Revisit only after PMF. |
| **Always-listening / continuous VAD mode** | Frictionless feel | Same as above plus active-mic-while-typing breaks every privacy norm devs hold. Generates noise in cluttered audio environments. ChatGPT's continuous mode is for handheld/mobile, not desktop dev workstations. | Push-to-talk only in v1.2. If a user wants long-form dictation, they can hold the hotkey. |
| **Full barge-in / mid-TTS interrupt** | "Natural conversation" feel from ChatGPT Advanced Voice | Production bar in 2026 is 200-400ms turn-taking gap, <2% false-barge-in rate, <60ms TTS flush — that is a heavy engineering investment for a v1.2 voice-into-coding-agent. ElevenLabs TTS streaming + abort-on-PTT is enough for v1.2 and degrades gracefully. | "Press PTT again to cancel current playback" + abort the in-flight TTS request. Skip true full-duplex audio. |
| **Reading the entire Claude Code transcript aloud** | "I want Achilles to keep me posted" | Tool calls, code, paths, JSON — none of it plays well as speech. Listening to a `Bash(rm -rf ...)` invocation read aloud is hostile. Suki's lesson: ambient capture is good; ambient playback is bad. | Only the ack and the `<spoken-summary>` block are routed to TTS. Everything else stays on the screen. |
| **Editable transcript before send (full text editor in the floating UI)** | "Let me fix what Achilles misheard before it goes to Claude Code" | Adds a modal in a UI that is supposed to feel ambient. Devs who want to edit can type — the entire point of Achilles is to avoid typing. The transcript is shown for *confidence*, not for editing. | Show the heard text post-send as confirmation. If the user wants to re-do it, hold PTT and re-speak. (Optional later: "say 'undo that' to redo the last turn" — voice-driven retry, not a text editor.) |
| **Custom voice cloning UX inside Achilles** | "Use my own voice" | ElevenLabs already has a full Instant/Professional Voice Cloning UI. Rebuilding it inside a tiny floating window is scope explosion. | Document how to clone in ElevenLabs and paste the voice ID. |
| **Multi-user / shared voice rooms** | Brainstorm sessions, pair programming | Explicitly out of scope in PROJECT.md. Multi-mic routing, identity, and TTS-back-to-many are a separate product. | Single user, single mic, single TTS playback in v1.2. |
| **Custom in-house STT/TTS models** | "Local privacy" or "no vendor lock-in" | Explicitly out of scope. ElevenLabs is the chosen vendor. Spinning up Whisper-on-device etc. blows the v1.2 timeline. | Vendor-only in v1.2. Local model fallback is a v1.x or v2 conversation. |
| **Surfacing every Claude Code tool call as a separate spoken event** | "Tell me everything Claude Code is doing" | Becomes noise within 30 seconds. Suki's lesson again. | Show tool calls visually as a one-line status; only speak the acknowledgement and the summary. |
| **Inbound network surface for the Achilles window (web socket server, etc.)** | "Control Achilles from the phone" | This is what Handoff exists for. Mixing voice and Handoff control surfaces in v1.2 widens the security boundary unnecessarily. | Outbound-only HTTPS/WSS to ElevenLabs; local IPC only for Claude Code. |
| **Persistent transcript log on disk by default** | "I want to search what I said" | Audio + transcripts of dev work are sensitive (proprietary code, internal names). Default-on retention will surprise users badly. | No persistent transcripts by default. Opt-in `--save-transcripts` flag with documented path and rotation. |

## Feature Dependencies

```
[OS mic permission] (table stakes)
    └──required-for──> [Live mic amplitude → circle + waveform]
    └──required-for──> [STT capture / push-to-talk]

[Push-to-talk hotkey] (table stakes)
    └──required-for──> [Listening state of circle]
    └──required-for──> [STT capture]

[ElevenLabs STT] (table stakes)
    └──required-for──> [Transcript display]
    └──required-for──> [Pipe transcript to Claude Code]

[Pipe transcript to Claude Code] (table stakes)
    └──required-for──> [Spoken acknowledgement]
    └──required-for──> [Spoken completion summary]

[Embedded system prompt] (table stakes)
    └──required-for──> [Spoken acknowledgement]
    └──required-for──> [Spoken completion summary]
    └──required-for──> [Completion-summary extractor]

[ElevenLabs TTS] (table stakes)
    └──required-for──> [Spoken acknowledgement]
    └──required-for──> [Spoken completion summary]
    └──required-for──> [TTS amplitude → waveform during speaking state]

[Floating window framework (Electron/Tauri)] (table stakes)
    └──required-for──> [Reactive circle + waveform]
    └──required-for──> [Always-on-top behavior]
    └──required-for──> [Drag-to-reposition]

[Single npm artifact] (table stakes)
    └──required-for──> [Claude Code skill install from same artifact]
    └──required-for──> [Global CLI install]

[First-run wizard] (table stakes)
    └──enhances──> [Time-to-first-voice-round-trip]

[Status line showing what Claude Code is doing] (differentiator)
    └──requires──> [Claude Code tool-event stream access]
    └──conflicts──> [Cloud-hosted Claude Code target if events not exposed]

[Voice ID hot-swap from UI] (differentiator)
    └──requires──> [ElevenLabs voices.list cache]

[Full barge-in] (anti-feature in v1.2)
    └──would-require──> [Full-duplex audio, VAD on TTS playback, <60ms TTS flush]
    └──conflicts-with──> [v1.2 timeline]
```

### Dependency Notes

- **Embedded system prompt sits in the middle of the dependency graph.** Both the acknowledgement and the completion summary depend on it producing parseable markers. Designing the prompt before designing the extractor saves a round of rework.
- **Floating window framework choice (Electron vs Tauri) is on the critical path.** Window decoration, always-on-top, frameless drag, and global hotkeys all depend on it. The Web Audio API for circle/waveform amplitude works in either, but the rest of the surface does not.
- **Single npm artifact serving both CLI and skill installs is on the critical path** of the install/onboarding story. Get this layout right before scaling out subcommands.
- **The status-line differentiator depends on Claude Code exposing tool events to the chosen integration path.** Against cloud-hosted Claude Code (the v1.2 target), this is unverified — flag as a research item in Phase 1.
- **No dependency on the Handoff bridge/relay path.** Achilles talks directly to Claude Code locally and to ElevenLabs over outbound HTTPS/WSS. The only shared Handoff capability is the existing monorepo tooling (workspaces, lint, TS config) and the npm publishing pipeline established in v1.1.

## MVP Definition

### Launch With (v1.2)

The minimum surface that delivers the brief and validates the voice-into-Claude-Code loop.

- [ ] **`npm install -g` distribution of `achilles`** — gate for everything else; brief constraint
- [ ] **Claude Code skill install from the same artifact** — brief constraint
- [ ] **`achilles init` first-run wizard** — API key, mic permission, voice selection, round-trip smoke test
- [ ] **Floating always-on-top window with frameless drag, ~250-300px square** — brief constraint
- [ ] **Reactive central circle: idle (breathing) / listening (amplitude pulse) / processing (swirl) / speaking (calm pulse from TTS amplitude)** — brief constraint
- [ ] **Reactive waveform: live mic amplitude when listening, live TTS amplitude when speaking** — brief constraint
- [ ] **Push-to-talk via configurable hotkey + on-screen click** — table stakes
- [ ] **Mute / pause control** — table stakes
- [ ] **ElevenLabs STT, streamed; transcript shown in the floating window** — brief constraint + table stakes
- [ ] **Transcript piped into Claude Code as user input** — brief constraint
- [ ] **Embedded system prompt that produces a one-sentence ack + a `<spoken-summary>` block at completion** — brief constraint
- [ ] **Completion-summary extractor that routes only the ack and the summary block to ElevenLabs TTS** — table stakes
- [ ] **ElevenLabs TTS playback of ack and completion summary** — brief constraint
- [ ] **Voice ID selection (env var + `achilles voices` + config file)** — table stakes
- [ ] **OS mic permission handling on first run with a fallback path to System Settings** — table stakes
- [ ] **Privacy defaults: no audio uploaded anywhere except ElevenLabs; no transcripts persisted by default** — brief constraint

### Add After Validation (v1.x)

Trigger: after end-to-end loop works against cloud-hosted Claude Code and at least a small group of users have tried it.

- [ ] **Status line that names what Claude Code is currently doing** — trigger: tool-event stream access verified against the chosen Claude Code integration path
- [ ] **Voice ID hot-swap from the floating UI** — trigger: first user feedback that env-var swap is too slow
- [ ] **"Press PTT again to cancel current playback" with TTS abort** — trigger: first user attempts barge-in
- [ ] **`--save-transcripts` opt-in with rotation** — trigger: first user asks for a record of the session
- [ ] **Per-app or per-Claude-Code-project voice profiles** — trigger: multi-project users ask
- [ ] **TTS playback device override** — trigger: first user with multiple output devices reports playback to the wrong one
- [ ] **Skill-only install path that does not require global CLI** — trigger: users on managed npm environments where global installs are blocked
- [ ] **Configurable acknowledgement template (let users tune the spoken style)** — trigger: feedback that the default tone does not fit

### Future Consideration (v2+)

Defer until product-market fit is established or the v1.2 constraints relax.

- [ ] **Full barge-in / mid-TTS interrupt with full-duplex audio** — defer: heavy infra, low marginal value once "press PTT to cancel" exists
- [ ] **Wake-word ("Hey Achilles")** — defer: terminal users prefer PTT; only reconsider if the dominant install target shifts off the workstation
- [ ] **Continuous always-listening mode with on-device VAD** — defer: privacy concerns, mobile/handheld more natural home
- [ ] **In-product voice cloning UX (vs paste-voice-ID)** — defer: ElevenLabs already has it
- [ ] **Local STT/TTS fallback for offline use** — defer: out of scope per PROJECT.md
- [ ] **Multi-user voice rooms / shared sessions** — defer: out of scope per PROJECT.md
- [ ] **Native iOS/Android Achilles client** — defer: not the v1.2 target
- [ ] **Voice-driven retry ("undo that," "say it again")** — defer: clever but each command is its own prompt-engineering risk; needs PMF first
- [ ] **Integration with Handoff (drive Achilles from a phone)** — defer: explicitly out of scope; would expand the security boundary

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| npm CLI + skill install from single artifact | HIGH | MEDIUM | P1 |
| Floating always-on-top window | HIGH | MEDIUM | P1 |
| Reactive circle (4 states) | HIGH | MEDIUM | P1 |
| Reactive waveform (mic + TTS) | HIGH | MEDIUM | P1 |
| Push-to-talk hotkey + click | HIGH | LOW | P1 |
| Mute / pause | MEDIUM | LOW | P1 |
| ElevenLabs STT with streaming | HIGH | MEDIUM | P1 |
| Transcript displayed in UI | HIGH | LOW | P1 |
| Pipe transcript to Claude Code | HIGH | MEDIUM | P1 |
| Embedded "speak ack + summary" system prompt | HIGH | LOW | P1 |
| Completion-summary extractor | HIGH | LOW | P1 |
| ElevenLabs TTS playback | HIGH | LOW | P1 |
| `achilles init` first-run wizard | HIGH | MEDIUM | P1 |
| Voice ID selection via config | MEDIUM | LOW | P1 |
| OS mic permission handling | HIGH | LOW | P1 |
| Status line showing Claude Code activity | MEDIUM | MEDIUM | P2 |
| Voice ID hot-swap from UI | MEDIUM | LOW | P2 |
| "Press PTT again to cancel" with TTS abort | MEDIUM | LOW | P2 |
| Opt-in transcript persistence | LOW | LOW | P2 |
| TTS output device override | LOW | LOW | P2 |
| Full barge-in / full-duplex | MEDIUM | HIGH | P3 |
| Wake-word | LOW | HIGH | P3 |
| Continuous listening mode | LOW | HIGH | P3 |
| In-product voice cloning UX | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.2 launch
- P2: Should have, add when validation feedback or follow-up phase justifies
- P3: Defer or explicitly out of scope per PROJECT.md

## Competitor Feature Analysis

| Feature | ChatGPT Advanced Voice | Pi (Inflection) | Wispr Flow / Aqua Voice | Claude Code `/voice` | Achilles (Planned) |
|---------|-----------------------|----------------|-------------------------|---------------------|-------------------|
| **Capture mode** | Continuous (mobile-first), PTT on desktop | Continuous, call-style | PTT hotkey | PTT (hold spacebar) | PTT hotkey + on-screen click |
| **Visual feedback** | Full-screen blue orb with state animation | Custom orb (ustwo-designed) | Tray icon + post-dictation popup | Inline cursor + Ctrl+O transcript viewer | Floating window, circle + waveform, 4 states |
| **Transcript visibility** | Inline (post-regression backlash) | Hidden (call-style) | Shown in app | Inline text | Live in floating window |
| **Spoken response** | Yes, voice-out is the point | Yes, conversational | No (dictation only) | No (dictation only) | Yes, ack + completion summary only |
| **Wake word** | No on desktop | No | No | No | No |
| **Barge-in** | Full duplex | Full duplex | N/A | N/A | PTT-to-cancel only in v1.2 |
| **Voice selection** | Fixed set | Fixed | N/A | N/A | Any ElevenLabs voice ID |
| **Install** | Built into ChatGPT app | Built into Pi app | One-app install per OS | Built into Claude Code | `npm i -g` + skill from same artifact |
| **Integration with coding agent** | None | None | IDE-agnostic dictation | Tightly integrated (it *is* Claude Code) | First-class voice surface for Claude Code |
| **Differentiation for Achilles** | — | — | — | Achilles speaks back; `/voice` only dictates | Voice-out + reactive UI + spoken summary is the Achilles wedge |

## Sources

### Voice agent UX and visual feedback
- [ChatGPT Voice Mode Explained: Features, Tips & Setup in 2026 - justainews](https://justainews.com/companies/openai/chatgpt-voice-mode-explained/)
- [ChatGPT Voice Gets Major UX Upgrade with Unified Interface - TechBuzz](https://www.techbuzz.ai/articles/chatgpt-voice-gets-major-ux-upgrade-with-unified-interface)
- [Voice Mode FAQ - OpenAI Help Center](https://help.openai.com/en/articles/8400625-voice-mode-faq)
- [Pi by Inflection AI Review: Features, Pros & Cons - toolstack.io](https://toolstack.io/tools/pi-by-inflection-ai)
- [Inflection AI x ustwo (Pi design partner)](https://ustwo.com/work/inflection-ai/)
- [You Can Now Have Voice Conversations with Pi - Maginative](https://www.maginative.com/article/pi-now-lets-you-talk-back-and-forth-with-ai-like-you-would-with-a-friend/)

### Visualizer and orb design references
- [Building a Voice Reactive Orb in React (Medium)](https://medium.com/@therealmilesjackson/building-a-voice-reactive-orb-in-react-audio-visualization-for-voice-assistants-2bee12797b93)
- [Circular Waveform — Voice UI Kit (Pipecat)](https://voiceuikit.pipecat.ai/visualizers/circular-waveform)
- [react-ai-voice-visualizer (GitHub)](https://github.com/chevgan/react-ai-voice-visualizer)
- [VoiceAssistantBarVisualizer — LiveKit Compose Components](https://docs.livekit.io/reference/components-android/livekit-compose-components/io.livekit.android.compose.ui.audio/-voice-assistant-bar-visualizer.html)
- [Voice (assistant-ui)](https://www.assistant-ui.com/docs/ui/voice)
- [feat(voice): animated waveform visualizer for voice mode state feedback — google-gemini/gemini-cli#21109](https://github.com/google-gemini/gemini-cli/issues/21109)

### Developer-focused voice dictation references
- [Aqua Voice — Fast and Accurate Voice Dictation for Mac and Windows](https://aquavoice.com/)
- [Aqua Voice Transcription + Hotkeys (Paul Karayan)](https://paulkarayan.com/blog/aqua-hotkeys-and-loom/)
- [Wispr Flow — Effortless Voice Dictation](https://wisprflow.ai/)
- [Vibe Coding with Wispr Flow](https://wisprflow.ai/post/vibe-coding-with-wispr-flow)
- [Best Voice Dictation Tools for Developers in 2026 — Medium](https://medium.com/@ryanshrott/best-voice-dictation-tools-for-developers-in-2026-dictaflow-vs-wispr-flow-vs-superwhisper-edc75f70de9c)

### Claude Code voice mode (direct precedent)
- [Claude Code Voice Mode: Talk to Your Terminal (2026)](https://claudefa.st/blog/guide/mechanics/voice-mode)
- [Voice dictation - Claude Code Docs](https://code.claude.com/docs/en/voice-dictation)
- [Claude Code Voice Mode: The Complete Guide to /voice — Unmarkdown](https://unmarkdown.com/blog/claude-code-voice-mode-guide)
- [Claude Code — Voice Mode (community MCP)](https://voice-mode.readthedocs.io/en/stable/integrations/claude-code/)

### Voice agent platforms and latency engineering
- [Vapi — Build Advanced Voice AI Agents](https://vapi.ai/)
- [How to build the lowest latency voice agent in Vapi (AssemblyAI)](https://www.assemblyai.com/blog/how-to-build-lowest-latency-voice-agent-vapi)
- [Voice AI Latency: What's Fast, What's Slow — Hamming](https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it)
- [Voice Agent Latency Optimization — CallSphere](https://callsphere.ai/blog/voice-agent-latency-optimization-sub-500ms-response-times)
- [What is voice agent barge-in? — Decagon](https://decagon.ai/glossary/what-is-voice-agent-barge-in)
- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide — Future AGI](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/)

### Voice agent response design (acks, summaries, backchannels)
- [Voice agent design best practices — Dialogflow CX](https://docs.cloud.google.com/dialogflow/cx/docs/concept/voice-agent-design)
- [How to evaluate voice agents — Braintrust](https://www.braintrust.dev/articles/how-to-evaluate-voice-agents)
- [Suki — Ambient Clinical Intelligence](https://www.suki.ai/)
- [Engineering an Invisible AI Medical Scribe — Suki](https://www.suki.ai/blog/engineering-an-invisible-and-assistive-voice-agent-for-clinicians/)
- [ChatGPT Record — OpenAI Help Center](https://help.openai.com/en/articles/11487532-chatgpt-record)

### Transcript visibility / dictation regressions
- [Voice dictation no longer shows transcribed text before sending — OpenAI Developer Community](https://community.openai.com/t/voice-dictation-no-longer-shows-transcribed-text-before-sending-major-usability-regression/1177339)

### ElevenLabs configuration and voice IDs
- [Instant Voice Cloning quickstart — ElevenLabs Documentation](https://elevenlabs.io/docs/cookbooks/voices/instant-voice-cloning)
- [ElevenLabs API in 2025: The Ultimate Guide for Developers — Webfuse](https://www.webfuse.com/blog/elevenlabs-api-in-2025-the-ultimate-guide-for-developers)
- [ElevenLabs Cheat Sheet (2026)](https://www.webfuse.com/elevenlabs-cheat-sheet)
- [elevenlabs/elevenlabs-python (SDK)](https://github.com/elevenlabs/elevenlabs-python)

### Distribution: npm CLI + Claude Code skill
- [Claude Code Quickstart](https://code.claude.com/docs/en/quickstart)
- [How to install Claude Code: npm, brew, and setup (2026) — eesel](https://www.eesel.ai/blog/npm-install-claude-code)
- [How to Build & Install Claude Skills — Verdent](https://www.verdent.ai/guides/how-to-build-install-claude-skills)
- [skills-npm (skill distribution via npm)](https://npmx.dev/package/skills-npm)
- [claude-skills/INSTALLATION.md (alirezarezvani)](https://github.com/alirezarezvani/claude-skills/blob/main/INSTALLATION.md)

### Floating window / always-on-top precedents
- [Floaty — Always on Top on macOS (workflow article)](https://www.floatytool.com/posts/macos-multitasking-workflow-floating-windows/)
- [Chrome tests Gemini Live voice assistant in a floating overlay panel — OnMSFT](https://onmsft.com/news/chrome-tests-gemini-live-voice-assistant-in-a-floating-overlay-panel/)
- [MIA AI Desktop Assistant (HUD overlays)](https://dev.to/trojanmocx/mia-a-futuristic-ai-desktop-assistant-built-with-voice-gestures-and-controlled-chaos-1259)

### Privacy / OS mic permission
- [Windows camera, microphone, and privacy — Microsoft Support](https://support.microsoft.com/en-us/windows/windows-camera-microphone-and-privacy-a83257bc-e990-d54a-d212-b5e41beba857)
- [What "Microphone in Use" Means — MuteDeck](https://mutedeck.com/blog/2026-03-08-microphone-in-use/)

---
*Feature research for: Voice companion / floating HUD for terminal coding agents (Claude Code)*
*Researched: 2026-06-06*
