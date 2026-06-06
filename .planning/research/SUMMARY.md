# Project Research Summary

**Project:** v1.2 Achilles — Voice companion for Claude Code
**Domain:** Voice front-end for a terminal coding agent, distributed as both a Claude Code skill and an npm CLI from one source of truth
**Researched:** 2026-06-06
**Confidence:** HIGH on stack/protocols/UX patterns; MEDIUM on cloud-hosted Claude Code integration shape (the v1.2 primary target as named in PROJECT.md has a structural conflict that REQUIREMENTS.md must resolve before any phase ships)

## Executive Summary

Achilles is a single-user desktop voice surface for Claude Code. The expert consensus across all four research streams is that this is an Electron app with a tiny Claude Code skill body that shells out to it. The Electron app captures microphone audio in the renderer via `getUserMedia`, streams 16 kHz PCM mono frames to the main process, ships them up to ElevenLabs Scribe v2 Realtime STT over a renderer-side WebSocket (using single-use tokens so the API key never leaves main), feeds committed transcripts to a child `claude` process (either via the `@anthropic-ai/claude-agent-sdk` `query()` AsyncIterable shape or via `claude -p --output-format stream-json` subprocess — both are documented; SDK path is preferred when available, subprocess is the universal fallback), and pipes Claude's streamed assistant text — gated by an embedded system prompt that mandates a short spoken acknowledgement first and a tight spoken completion at the end — into ElevenLabs Flash v2.5 TTS streamed back to the renderer for playback. P50 latency target speech-end-to-first-audible-byte is 600-800 ms, P95 1100 ms.

The product is built around four visible states (idle/listening/processing/speaking), a frameless transparent always-on-top "panel" window with a hand-rolled Canvas waveform off `AnalyserNode`, push-to-talk only (no wake word, no continuous mode, no full barge-in in v1.2), and half-duplex turn-taking with the mic gated during TTS playback. Voice-out is the explicit wedge against Claude Code's built-in `/voice` (which only dictates in) and against community Voice Mode MCP (which speaks but has no first-class UI). The single npm tarball ships both the CLI binary (via `bin` entry) and the SKILL.md-rooted skill directory; `achilles install-skill` symlinks the skill body into `~/.claude/skills/achilles/` so the two distribution surfaces are one source of truth.

**The unresolved scope question:** PROJECT.md names cloud-hosted Claude Code as the v1.2 primary install target, but all three deeper research outputs (STACK, ARCHITECTURE, PITFALLS) independently flag that cloud-hosted Claude Code cannot reach the developer's local microphone, has no local display surface for the floating UI, and skills do not sync across surfaces (claude.ai, API, Code). REQUIREMENTS.md must pick exactly one of three resolutions before any phase ships: **(a)** reinterpret "cloud" as "local Claude Code installed via cloud-distributed skill bundle" — every research output's architecture survives this with no changes; **(b)** split into local audio capture + cloud transcript injection — requires naming the transport (the Handoff relay already in this monorepo is a candidate but would expand the security boundary); or **(c)** defer the cloud target to v1.3 and ship local-first in v1.2. Top risks across all research streams converge on echo-loop self-triggering (mitigated by half-duplex + headphone recommendation), hallucinated completion summaries on failed jobs (mitigated by deriving completion from exit code + `tool_result` events, not LLM narration), TCC mic permission attributed to the terminal not Achilles on macOS (mitigated by the Electron host owning the prompt), and the Ink/programmatic-newline gotcha in `claude` interactive mode (mitigated by using non-interactive `--output-format stream-json`).

## Key Findings

### Recommended Stack

Single npm package with one Electron application, dual-distributed as a global CLI and a SKILL.md-rooted Claude Code skill. All audio I/O and the floating UI live in the renderer; sockets, keystore, and the Claude bridge live in the main process. ElevenLabs Scribe v2 Realtime is used for STT (~150 ms inference) and Flash v2.5 for TTS (~75 ms first-byte). The Claude Code integration is the Agent SDK `query()` AsyncIterable pattern when in-process, with `claude -p --output-format stream-json` subprocess as the universal fallback (and the canonical path for cloud-auth + version-independence). Detailed versions, install commands, and rejection rationale for alternatives are in `STACK.md`.

**Core technologies:**
- **Electron 42.3.3** — frameless transparent always-on-top floating window with `focusable: false`, `type: 'panel'` on macOS, identical Chromium audio behavior across macOS/Windows/Linux — chosen over Tauri because Tauri has documented `getUserMedia` permission edge cases on macOS (wry#1195, tauri#10898, #11951) that are an unacceptable risk for an audio-first product.
- **`@anthropic-ai/claude-agent-sdk` 0.3.165** (primary) and **`claude -p --output-format stream-json`** subprocess (fallback) — the SDK gives a typed `AsyncGenerator<SDKMessage>` for streaming Claude output and accepts `AsyncIterable<SDKUserMessage>` as input; the subprocess shape is the universal path that works regardless of SDK availability and is the natural pairing for `--append-system-prompt-file` and `--resume <sid>`.
- **`@elevenlabs/client`** (renderer, browser SDK) for `Scribe.connect()` over WebSocket with a single-use 15-min token — keeps the API key in main; avoids native PortAudio (`naudiodon`) and SoX (`node-record-lpcm16`) install pain.
- **`@elevenlabs/elevenlabs-js` 2.51.0** (main process) for Flash v2.5 streaming TTS — `textToSpeech.stream(voiceId, { modelId: 'eleven_flash_v2_5' })` returns audio chunks; recommended over deprecated Turbo v2.5.
- **`@ricky0123/vad-web` 0.0.30** (Silero VAD via ONNX in an Audio Worklet) for end-of-utterance detection — the Node port is discontinued upstream; renderer-only is the right call and matches the Electron choice.
- **Hand-rolled Canvas2D + `AnalyserNode`** for waveform/reactive circle — wavesurfer.js is file-oriented (issue #578) and adds 100 kB+ for no value here; ~30 lines of code do the live amplitude visualisation.
- **commander + electron-vite + electron-builder + electron-store + zod** — CLI surface, build pipeline, signed cross-platform installers, encrypted local config (via macOS Keychain / Windows DPAPI), runtime IPC validation.

### Expected Features

The product cleanly partitions into table stakes that match every voice-agent UX precedent (ChatGPT, Pi, Vapi, Wispr, Aqua, Claude Code `/voice`), differentiators that widen the gap against `/voice` and Voice Mode MCP, and anti-features that are commonly requested but explicitly out of scope for v1.2. Full breakdown including dependency graph and competitor matrix is in `FEATURES.md`.

**Must have (table stakes):**
- Four visible states with explicit `error` as a fifth (idle / listening / processing / speaking / error).
- Push-to-talk hotkey + on-screen click; mute/pause; visible mic-capturing state.
- Floating always-on-top frameless panel window ~220-300px square with drag-to-reposition.
- Live reactive circle (amplitude-driven scale + glow) and waveform (mic during listening, TTS during speaking — same component, switched audio source).
- ElevenLabs STT streaming with partial + committed transcripts; transcript shown live in the floating UI as confirmation (not editable — Aqua/Wispr precedent + OpenAI regression backlash).
- Transcript piped into Claude Code as if typed by the user.
- Embedded system prompt that produces a one-sentence acknowledgement at start (<=12 words / ~2 s of audio) and a tight `<spoken-summary>` block at completion (<=40 words / ~10-25 s).
- Completion-summary extractor that routes only the ack and the `<spoken-summary>` block to ElevenLabs TTS — never tool calls, never code, never paths.
- ElevenLabs TTS playback of ack + completion via Flash v2.5 streaming.
- `achilles init` first-run wizard: API key prompt -> mic permission flow -> voice selection -> smoke test round-trip.
- Single npm artifact serving both `npm install -g achilles` and `~/.claude/skills/achilles/` symlink; `achilles install-skill` subcommand.
- OS mic permission handling with explicit remediation copy (deep-link to System Settings).
- Privacy defaults: API key stored only in main-process keystore, never persisted transcripts, only outbound network is ElevenLabs.

**Should have (competitive):**
- First-class spoken completion is the Achilles wedge — Claude Code's `/voice` only dictates in; Achilles speaking back is the defensible differentiator.
- Consumer-grade reactive orb + waveform aesthetic (Wispr/Aqua hide in tray icons; the floating reactive UI feels premium and matches the ChatGPT/Pi shape users already know).
- One artifact -> CLI + skill is genuinely rare; skills-npm and the Anthropic skills repo are exploring this pattern, Achilles can lead with it.
- Voice-aware system prompt explicitly tuned for ear-reading (no slashes, no parens, no paths) — small craft, outsized perceived quality.

**Defer (v2+):**
- Wake-word ("Hey Achilles") — terminal users prefer PTT; Claude Code's `/voice` also chose no wake word.
- Always-listening / continuous VAD on the desktop — privacy norm violation in dev environments.
- Full barge-in / mid-TTS interrupt with full-duplex AEC — 2026 production bar is 200-400 ms turn-taking, <2% false-barge-in, <60 ms TTS flush; ship "press PTT to cancel" instead.
- Reading the entire Claude Code transcript aloud — Suki's lesson, hostile UX.
- Editable transcript in the floating UI before send — the entire point of Achilles is to avoid typing; hold PTT and re-speak.
- Custom voice cloning UX, multi-user voice rooms, native iOS/Android, local Whisper fallback — explicitly out of scope per PROJECT.md.

### Architecture Approach

A 7-package monorepo addition under the existing Handoff TypeScript workspace, with a single Electron app, a thin npm-CLI shim, four shared packages (voice STT/TTS/protocol + Claude bridge), and the skill source-of-truth package. The renderer is a pure projection of state owned by the main process; all state transitions, sockets, child processes, and keystore reads happen in main, with the renderer emitting intents (mic frames, hotkey press, playback-buffer-empty) and consuming `STATE_CHANGED` / `TTS_CHUNK` IPC events. Half-duplex turn-taking with mic gated during TTS playback. Sessions persist across utterances via `--resume <sid>` on the Claude child. Full diagrams, component contracts, state machine, latency budget, and the alternatives matrix are in `ARCHITECTURE.md`.

**Major components:**
1. **`apps/achilles` (Electron main + preload + renderer)** — process lifetime, window config, global hotkey, IPC owner, keystore reader, owns both ElevenLabs sockets, owns the state machine.
2. **`apps/achilles-cli`** — npm `bin` entry that locates the bundled Electron binary and execs it; runs the `install-skill` postinstall step.
3. **`packages/voice-stt`** — thin client for ElevenLabs Scribe v2 Realtime. `Int16Array` frames in -> `partial` / `committed` events out.
4. **`packages/voice-tts`** — thin client for ElevenLabs Flash v2.5 stream-input. Text chunks in -> MP3/PCM byte chunks out.
5. **`packages/voice-protocol`** — shared TypeScript types + Zod schemas for renderer<->main IPC, voice events, state machine enum.
6. **`packages/claude-code-bridge`** — wraps either `query()` from the Agent SDK or `child_process.spawn('claude', ['-p', ...])`. Parses NDJSON `stream-json`, normalises into typed events. Owns session-id resume.
7. **`packages/achilles-skill`** — source-of-truth `SKILL.md` body + `prompts/companion.md` embedded system prompt. Both surfaces (skill install + npm CLI) reference the same prompt file (`--append-system-prompt-file`).

**Claude Code integration path (locked):** Subprocess `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <companion.md> --resume <sid>` is the primary spine. Agent SDK is the preferred in-process variant when available. MCP is rejected (wrong directionality — MCP lets Claude call tools, not the reverse). Hooks are rejected as the primary path (hooks augment but cannot originate prompts) — kept as a status-sync mechanism if needed.

**Latency budget (verified-additive):** STT VAD commit + inference ~150 ms -> Claude TTFB ~200-400 ms -> first text_delta ~50 ms -> TTS first audio byte ~150-200 ms -> playback decode ~50 ms = **P50 600-800 ms mic-end-to-first-audible-byte, P95 1100 ms**. This is the conversational threshold from PROJECT.md.

### Critical Pitfalls

The four highest-impact pitfalls converge across STACK, ARCHITECTURE, and PITFALLS. Full list of 25 pitfalls with warning signs, prevention, and per-pitfall phase-mapping is in `PITFALLS.md`.

1. **Cloud-hosted Claude Code cannot reach the local mic (Pitfall #20).** The v1.2 primary install target as named in PROJECT.md is structurally incompatible with the audio loop: the mic is on the developer's laptop, the cloud Code session is on Anthropic's infra, the skill cannot capture audio inside the cloud sandbox, and `/skills` do not sync across surfaces. **Mitigation:** pin the integration model in REQUIREMENTS.md before any code (Architecture phase). Three resolutions are viable (see Implications below); the project cannot ship without picking one.
2. **TTS playback bleeds into the mic and Achilles self-triggers (Pitfall #2).** Naive implementations leave the mic open during TTS playback; speakers are physically closer to the mic than the user is. **Mitigation:** ship half-duplex by default — gate the STT WebSocket / stop forwarding mic frames during TTS playback. Recommend headphones in onboarding. Full-duplex AEC is explicitly out of scope for v1.2.
3. **Hallucinated "I have finished" when the underlying job failed (Pitfall #17).** Claude Code returns a tool error; the LLM paraphrases it as a success-toned sentence; the user trusts the spoken summary; the working tree is actually broken. **Mitigation:** completion is derived from exit code + `tool_result` events, not LLM narration. System prompt mandates "begin with 'I ran into a problem' if any tool call failed." Achilles refuses to play a success completion when it sees non-zero exit / tool errors in the stream regardless of what the LLM says.
4. **macOS TCC silently denies mic when the parent is the terminal, not Achilles (Pitfall #3).** On macOS, mic permission is attributed to the launching process. The npm-CLI path launched from iTerm/Terminal.app gets the mic prompt against the terminal — and if denied, every app launched from that terminal is denied until `tccutil reset`. **Mitigation:** the Electron host owns the prompt via `systemPreferences.askForMediaAccess('microphone')`. Ship code-signed + notarised; include `NSMicrophoneUsageDescription` + `com.apple.security.device.audio-input` entitlement.
5. **Ink stdin/Enter behavior breaks programmatic transcript injection (Pitfall #7, issue #15553).** Spawning `claude` in interactive mode with `stdio: 'pipe'` and writing transcripts to stdin produces silent no-ops — Ink `<TextInput>` treats programmatic `\n` as a literal newline in the buffer, not a submit. **Mitigation:** use non-interactive `claude -p --output-format stream-json` for programmatic transcript injection.

## Implications for Roadmap

The combined research strongly suggests a seven-phase ordering, opened by a small but unskippable scoping phase that resolves the cloud-vs-local question, then a parallelisable trio of vendor-wrapper packages, then the integration milestone where the loop first runs end-to-end, then UI shell, then distribution, then hardening. Phases 1-3 can be developed in parallel by multiple engineers; Phase 4 is the synchronisation point.

### Phase 1: Architecture & Requirements Scoping (Cloud-vs-Local Decision)

**Rationale:** PITFALLS Pitfall #20 + the cloud-Claude-Code contradiction surfaced across STACK, ARCHITECTURE, and PITFALLS. Foundational — every other phase depends on whether the audio loop is local-only or routed through a transport.
**Delivers:** REQUIREMENTS.md with the cloud-vs-local model locked in. One of: (a) reinterpret "cloud" as "local Claude Code installed via cloud-distributed skill bundle"; (b) split into local audio capture + cloud transcript injection — name the transport (Handoff relay reuse is one option but expands the security boundary); (c) defer cloud target to v1.3 and ship local-first.
**Avoids:** Pitfall #20 (cloud Claude Code unclear integration story), #24 (skill assumes specific Claude Code version — pin minimum here).

### Phase 2: Voice Vendor Wrappers (parallel-safe with Phase 3, 4)

**Rationale:** STACK and ARCHITECTURE both isolate ElevenLabs into thin SDK wrappers (`voice-stt`, `voice-tts`, `voice-protocol`) testable in isolation against WAV fixtures and recorded transcripts. ARCHITECTURE estimates 3-5 days.
**Delivers:** `packages/voice-stt` (Scribe v2 Realtime client, partial/committed events, exponential-backoff reconnect, 429 distinction); `packages/voice-tts` (Flash v2.5 stream-input, MP3 default, sequence-tracked chunked playback, `chunk_length_schedule: [80, 120, 160, 220]`); `packages/voice-protocol` (Zod-validated IPC + STT/TTS event types).
**Uses:** `@elevenlabs/client`, `@elevenlabs/elevenlabs-js@2.51.0`, `ws@8.18`, `zod@3.23`.
**Avoids:** Pitfalls #1 (sample-rate/codec mismatch), #4 (WebSocket lifecycle), #5 (model selection per call site), #6 (TTS chunk ordering + 500 ms prebuffer).

### Phase 3: Claude Code Bridge (parallel-safe with Phase 2, 4)

**Rationale:** Independent of voice. Testable in isolation with golden NDJSON fixtures. ARCHITECTURE estimates 2-3 days. PITFALLS #7 and #8 demand a robust LDJSON line reader and the non-interactive subprocess path before the integration milestone.
**Delivers:** `packages/claude-code-bridge` with `createClaudeSession({ systemPromptFile })` -> `{ send(text), events$, close() }`. Subprocess path with `--output-format stream-json --include-partial-messages --append-system-prompt-file --resume`. Agent SDK alternative gated behind a flag. LDJSON line buffer with N KB watchdog. Authoritative success/failure signal from exit code + `tool_result` events.
**Avoids:** Pitfalls #7 (Ink stdin gotcha), #8 (partial JSON across reads), #17 (hallucinated completion), #19 (stuck "thinking" state), #24 (Claude Code version pinning).

### Phase 4: Floating UI Shell (Electron app) (parallel-safe with Phase 2, 3)

**Rationale:** PITFALLS #15 (panel-window failure modes) and #3 (macOS TCC) both demand fresh-account testing. Window plumbing, four-state visual surface, Canvas waveform, and mic permission flow are independent of the voice loop. ARCHITECTURE estimates 3-4 days.
**Delivers:** `apps/achilles` with `BrowserWindow({ frame: false, transparent: true, alwaysOnTop: true, focusable: false, type: 'panel', skipTaskbar: true })`. `app.dock.hide()` + `Tray`. `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. `showInactive()` for TTS reveals. Reactive circle + Canvas waveform off mock `AnalyserNode`. Five visible states. AudioWorklet stub for 48k->16k Int16 PCM. Mic permission flow with `systemPreferences.askForMediaAccess('microphone')`.
**Uses:** Electron 42.3.3, `@ricky0123/vad-web`, hand-rolled Canvas2D off `AnalyserNode`, `electron-store`, `electron-vite`.
**Avoids:** Pitfalls #3 (TCC denial flow), #15 (panel window failure modes), #25 (USB/Bluetooth device-change handling).

### Phase 5: End-to-End Integration + State Machine + Embedded System Prompt

**Rationale:** Synchronisation milestone where Phases 2, 3, 4 compose. ARCHITECTURE estimates 4-6 days. The half-duplex echo gating (#2), re-utterance race (#10), and long/symbol-heavy completion (#16) can only be designed jointly across voice + UI + bridge boundaries.
**Delivers:** `apps/achilles/src/main/session.ts` orchestrating voice-stt -> claude-code-bridge -> voice-tts behind the state machine. Half-duplex turn-taking with STT-gate-during-TTS. `packages/achilles-skill/skill/prompts/companion.md` embedded system prompt: one-sentence ack <=12 words; `<spoken-summary>` block <=40 words; no paths, symbols, code, or ANSI. Pre-TTS string normalisation. Cancellation primitive (SIGINT). Debounce mic re-activation ~300 ms after TTS ends.
**Avoids:** Pitfalls #2 (echo loop), #9 (prompt injection — sandwich-defense wrapper), #10 (re-utterance race), #16 (long completion), #17 (hallucinated success), #21 (secrets read aloud).

### Phase 6: Distribution — npm CLI + Skill Packaging + Cross-platform Installer

**Rationale:** Once the loop works locally, distribution is the gate to user validation. ARCHITECTURE splits into ~2-3 days for CLI and ~2 days for skill. PITFALLS #11, #12, #13, #14 cluster here. Test against a fresh Windows VM and a fresh macOS account.
**Delivers:** `apps/achilles-cli` with `bin: { achilles: './dist/cli.js' }`, `achilles install-skill` symlinks `packages/achilles-skill/skill/` into `~/.claude/skills/achilles/`. `electron-builder` config producing signed `.dmg` (hardened runtime + notarisation + `NSMicrophoneUsageDescription`), `.exe` (NSIS), `.AppImage`. `SKILL.md` body <=2000 words shelling out to `${CLAUDE_SKILL_DIR}/bin/launch.sh`. CI diff-check across skill + CLI. Tarball scan for ElevenLabs key prefix at release.
**Avoids:** Pitfalls #11 (skill bundle scope), #12 (dual-distribution drift), #13 (Windows global install), #14 (monorepo workspace symlinks), #22 (API key leak).

### Phase 7: Hardening, Privacy, Resilience

**Rationale:** PITFALLS closes with privacy/security and resilience as cross-cutting concerns. ARCHITECTURE allocates 3-5 days. Turns a working loop into a shippable product.
**Delivers:** Default-off transcript persistence with `--save-transcripts` opt-in + retention + `achilles transcripts purge`. `--debug-audio` flag with loud on-screen indicator. Graceful degradation: STT failure -> "type your prompt" fallback; TTS failure -> completion text surfaced in UI and printed to terminal. ElevenLabs incident detection + exponential backoff with full jitter. Stuck "thinking" timeout (60 s default) + audible status update + cancel gesture. Device-change reacquisition. Code-signing identity + notarisation for the release build. macOS TCC remediation flows tested on a fresh account; Windows install tested on a fresh VM.
**Avoids:** Pitfalls #18 (no graceful degradation), #19 (stuck thinking), #21/22/23 (secrets, key leaks, persisted audio), #25 (USB/Bluetooth/suspend audio).

### Phase Ordering Rationale

- **Phase 1 is unskippable and foundational** — REQUIREMENTS.md edit, should take hours not days, but everything downstream depends on it.
- **Phases 2, 3, 4 are independent and parallel-safe** — voice wrappers test against WAV fixtures, the Claude bridge tests against golden NDJSON, the UI shell tests against mocked state. Sequence if single engineer; parallelise if multiple.
- **Phase 5 is the integration milestone** — highest-risk phase, reserve buffer. State machine cannot be retrofit cleanly after the loop is wired.
- **Phases 6 and 7 close the milestone** — distribution turns the artifact into something a user can install; hardening turns "works on developer's machine" into "works on a fresh Windows VM and a fresh macOS account."
- **System prompt design is fused with Phase 5** rather than treated as a separate phase because the prompt and the extractor are mutually dependent.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):

- **Phase 1 (Architecture & Requirements Scoping):** the cloud-hosted Claude Code surface is the only research area where current confidence is MEDIUM. If resolution (b) is picked (split local audio + cloud transport), the chosen transport's API and quotas need a spike — Handoff relay reuse specifically needs architectural review against the v1.2 security boundary.
- **Phase 5 (End-to-End Integration):** the embedded system prompt design has MEDIUM precedent — the specific contract that makes Claude reliably emit a tight `<spoken-summary>` block needs empirical iteration against representative tasks (refactor / bug fix / test run).
- **Phase 7 (Hardening / Resilience):** ElevenLabs rate-limit semantics on the user's actual plan and the 429 class distinction (PITFALLS #4) deserve a verification pass against the production account.

Phases with standard patterns (skip `--research-phase`):

- **Phase 2 (Voice Wrappers):** ElevenLabs Scribe v2 Realtime and Flash v2.5 are HIGH-confidence documented protocols; the wrappers are mechanical SDK glue.
- **Phase 3 (Claude Code Bridge):** the non-interactive subprocess + stream-json path is HIGH-confidence; the LDJSON line reader is a well-known pattern.
- **Phase 4 (Floating UI Shell):** Electron `BrowserWindow` panel configuration is HIGH-confidence (verified against official Electron docs and known issues).
- **Phase 6 (Distribution):** the npm-CLI + SKILL.md dual-distribution pattern is MEDIUM-confidence but composed from multiple precedents (skills-npm, openskills, Anthropic skills repo) — no novel research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | ElevenLabs and Claude Code skill/SDK surfaces verified against current official docs and Context7. Electron + `@ricky0123/vad-web` versions current. MEDIUM only on the dual-distribution packaging pattern (composed from multiple references, no single canonical). |
| Features | HIGH | Table stakes verified across 9 reference products. Anti-features grounded in industry consensus. MEDIUM on differentiator scoping (subjective). |
| Architecture | HIGH on the spine (component contracts, IPC, state machine, latency math). MEDIUM on the cloud-hosted Claude Code shape — ARCHITECTURE explicitly flags this as the open question. |
| Pitfalls | MEDIUM-HIGH. STT/TTS, Electron, macOS TCC, and Claude Code subprocess behaviors are documented and verified from 2025-2026 official sources. Claude Code stdin-injection (issue #15553) and cloud-hosted skill semantics are partially in flux. |

**Overall confidence:** HIGH on everything except the cloud-hosted Claude Code integration model, which is MEDIUM and must be resolved in Phase 1 before any other phase ships.

### Gaps to Address

1. **Cloud-hosted Claude Code integration model (the unresolved scope question).** Three viable resolutions: (a) reinterpret cloud = local Claude Code installed via cloud-distributed skill bundle; (b) split local audio capture + cloud transcript injection — needs transport choice; (c) defer cloud target to v1.3. REQUIREMENTS.md must pick one in Phase 1. The architecture survives all three with minimal changes; only the Claude bridge's spawn step is affected.
2. **macOS code-signing identity** is a known release blocker. Phase 6 / Phase 7 must own resolution.
3. **Voice selection UI** is not specified in PROJECT.md. v1.2 ships one default voice; voice picker is deferred per FEATURES.
4. **Push-to-talk vs press-to-toggle** is unspecified. ARCHITECTURE recommends press-to-toggle; FEATURES recommends PTT. Phase 1 / Phase 4 should pick one consistent with the embedded system prompt's cadence.
5. **Agent SDK vs subprocess for Claude integration**: STACK leans SDK-primary, ARCHITECTURE leans subprocess-primary. Not in conflict (subprocess is universal fallback). Phase 3 should decide the default. Subprocess is safer for cloud-auth + version-independence; SDK is preferable when developer environment has it pre-configured.

## Sources

### Primary (HIGH confidence)
- Context7 `/nothflare/claude-agent-sdk-docs`
- Anthropic docs — Skills, Headless `claude -p`, Agent SDK TypeScript, Hooks, MCP, Low-latency voice cookbook, Claude Code on the web
- ElevenLabs docs — Realtime STT, client-side streaming, Scribe v2 Realtime overview, models overview, Flash v2.5, streaming TTS, multi-context WebSocket, latency optimisation, pricing
- Electron docs — `BrowserWindow` API, `systemPreferences.askForMediaAccess`, Releases (42.3.3 latest stable Jun 3 2026)
- npm registry / GitHub — `@anthropic-ai/claude-agent-sdk@0.3.165`, `@elevenlabs/elevenlabs-js@2.51.0`, `@ricky0123/vad-web@0.0.30`
- Known issues — tauri-apps/wry#1195, tauri-apps/tauri#10898/#11951/#5042/#8314 (mic permission edge cases); anthropics/claude-code#15553 (Ink stdin/Enter); electron/electron#10078, #24703

### Secondary (MEDIUM confidence)
- Reference product surveys — ChatGPT Advanced Voice, Pi (Inflection), Wispr Flow, Aqua Voice, Vapi/Retell, Suki, Voice Mode MCP, Claude Code `/voice`
- Dual-distribution pattern — openskills npm, Anthropic skills GitHub, skills-npm, Cross-Agent Skills (Termdock)
- Latency engineering — Hamming, CallSphere, Decagon, FutureAGI 2026, Gradium
- macOS TCC behavior — pingdotgg/t3code#728; BigBinary Electron mic permission; Screenify macOS deep-dive
- Voice agent UX — Voice UI Kit (Pipecat), react-ai-voice-visualizer, LiveKit, assistant-ui
- Tauri vs Electron 2026 — PkgPulse

### Tertiary (LOW confidence)
- Cloud-hosted Claude Code API surface — the cloud product is named as the v1.2 primary target but the public API for transcript injection is not yet fully documented; **must be resolved by Phase 1 spike.**
- ElevenLabs Agents bundle pricing — we do not use this bundle but rates need verification at release time.
- Specific 429 class distinction — documented in PITFALLS #4 but exact response payload shape should be verified during Phase 2 implementation.

---
*Research completed: 2026-06-06*
*Ready for roadmap: yes — pending REQUIREMENTS.md resolution of the cloud-vs-local question in Phase 1*
