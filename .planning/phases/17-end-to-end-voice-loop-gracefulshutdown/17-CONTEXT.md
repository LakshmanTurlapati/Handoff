# Phase 17: End-to-end Voice Loop + gracefulShutdown - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Auto-generated (synthesized from .planning/research/ARCHITECTURE.md + FEATURES.md + PITFALLS.md + v1.3-terminal-pivot.md + the v1.2 session.ts + claude-code-bridge code that this phase ports)

<domain>
## Phase Boundary

Make the actual product real. Port v1.2 `session.ts` ~80% verbatim — stripping IPC envelope wrappers, replacing them with direct `EventEmitter` function calls — and wire `voice-stt`, `voice-tts`, `claude-code-bridge` via their existing DI seams (`webSocketCtor`, `spawnImpl`). Spawn `ffplay` for gapless MP3 TTS sink via stdin. Enforce half-duplex via the existing `SPEAKING_DEBOUNCE_MS = 300` constant (already ported in Phase 16). Route ack + `<spoken-summary>` extractors unchanged. Authoritative failure-override from claude subprocess exit code + tool_result events. Ctrl-C cancel chain routes through existing claude-code-bridge cancellation with claude detached into its own process group. `MOCK_LOOP=1` in-process smoke gate runs on every PR.

This is the riskiest phase. The whole point of v1.3 is to structurally prevent the v1.2 silent-launch shape: code-side green + binary DOA. Phase 17 must produce an end-to-end loop that exercises in CI (MOCK_LOOP=1) AND on the published binary (Phase 20 asciicasts gate it).

Inside scope:
- `apps/achilles-terminal/src/session.ts` — port from `apps/achilles/src/main/session.ts` (~80% verbatim); replace IPC envelope wrappers (`broadcast`, `on(IPC_*, ...)`) with direct EventEmitter calls on a session-scoped emitter
- `apps/achilles-terminal/src/runVoice.ts` — entry point exported as `runVoice(argv)` (already stubbed by Phase 16 Plan 04); now wires the real loop
- `apps/achilles-terminal/src/audio/tts-playback.ts` — ffplay child spawn + `voice-tts` events$ → ffplay stdin pipe + drain detection
- `apps/achilles-terminal/src/audio/stt-bridge.ts` — `voice-stt` WSS factory + DI seam wiring; consumes Int16Array frames from `mic-sox.ts` (Phase 16) and forwards via `commit()`
- `apps/achilles-terminal/src/audio/claude-bridge.ts` — thin wrapper around `claude-code-bridge` that:
  - dynamically loads the package via NodeNext (LOOP-02 — runtime import is fine NOW, this is the phase that wires it)
  - applies the sandwich-wrap pattern from v1.2 (`<context>` ... `</context>` envelope around user transcript)
  - parses the `claude -p --output-format stream-json --include-partial-messages` line stream
  - extracts the ≤12-word ack region + `<spoken-summary>` block (≤40 words)
  - emits authoritative failure-override on claude exit code != 0 OR tool_result events with error
  - detaches claude into its own process group via `posix_spawn(detached:true)` (workaround for anthropics/claude-code#45717)
- `apps/achilles-terminal/src/audio/companion-md.ts` — embedded asset loader for `packages/achilles-skill/skill/prompts/companion.md` (read at install/build time, embedded into the bun-compiled binary; SHA-256 verified against source of truth — port the v1.2 CI check)
- `apps/achilles-terminal/src/graceful-shutdown.ts` — `gracefulShutdown(reason)` registered via `process.once("SIGINT", ...)` (NOT `on`); second SIGINT escalates; tears down voice-tts WSS, ffplay child, claude child, sox child, in <1.5s
- `apps/achilles-terminal/src/circuit-breaker.ts` — port from v1.2 SAFE-05; threshold + cooldown + full-jitter backoff; consumed by voice-stt WSS factory + voice-tts WSS factory
- `apps/achilles-terminal/src/stuck-thinking-watchdog.ts` — port from v1.2 ERR-05; if `claude -p` emits no stream-json line for 60s, surface "Claude has been thinking for 60s — Ctrl-C to cancel" via session emitter → TUI status row
- `apps/achilles-terminal/src/child-exit-watchdog.ts` — sox/ffplay child-exit-code polling, bounded respawn (3-in-10s cap), transitions to error on cap-exceeded; supports ERR-03, ERR-06
- `apps/achilles-terminal/src/structured-logger.ts` — unconditional structured logger to `~/.achilles/achilles.log` on every run regardless of flags (ERR-08; closes v1.2 silent-stdio gap); 10MB rotation; key redaction
- `apps/achilles-terminal/src/resume-session.ts` — `--resume <sid>` support (LOOP-06 port from v1.2); lock-file at `~/.achilles/voice.lock`; reads prior session state from `~/.achilles/sessions/<sid>.json`
- Session-scoped EventEmitter shape: events `mic_frame`, `vad_speech_start`, `vad_speech_end`, `stt_partial`, `stt_committed`, `claude_ack`, `claude_partial`, `claude_summary`, `claude_done`, `claude_failed`, `tts_ready`, `tts_drained`, `state_change`, `error`, `shutdown` — typed via TypeScript discriminated union; session.ts owns the wiring, audio/* modules emit, UI listens
- MOCK_LOOP=1 in-process integration test: full loop runs against mocked Scribe v2 WSS + mocked claude subprocess; transitions idle → listening → processing → speaking → idle within a single vitest run; this becomes the upstream CI smoke gate that catches v1.2-shape failures BEFORE they reach the binary
- `--resume <sid>` flag in cli.ts voice subcommand
- `--debug` flag enabling verbose latency-probe + line-trace logging (ERR-07)
- `achilles latency --report` subcommand printing rolling-window P50/P95 speech-end → ack-spoken (ERR-07; reads from `~/.achilles/latency/` JSON files)
- Tests: end-to-end MOCK_LOOP integration test; per-module unit tests for tts-playback, stt-bridge, claude-bridge, graceful-shutdown, circuit-breaker, stuck-thinking-watchdog, child-exit-watchdog, structured-logger, resume-session

Outside scope (defer to later v1.3 phases):
- Init wizard / API key resolution / sox/ffmpeg preflight (Phase 18)
- `achilles config` settings menu (Phase 18)
- Single-instance `~/.achilles/voice.lock` enforcement at startup (Phase 18; Phase 17 wires the file but startup-time conflict resolution is Phase 18)
- Encrypted `~/.achilles/key.enc` (Phase 18)
- macOS codesigning + notarytool: OUT OF SCOPE for v1.3 per the Option 3 lock (`.planning/research/v1.3-terminal-pivot.md` §10.2) — no compiled darwin binary ships; macOS runs JS-fallback under Bun runtime
- npm publish (Phase 19)
- Real-binary asciicast capture across 3 platforms (Phase 20)
- Apple Developer ID acquisition: NOT REQUIRED per the v1.3 Option 3 lock — macOS ships via JS-fallback only; no codesign pipeline (Phase 17 doesn't touch signing either way)

</domain>

<decisions>
## Implementation Decisions

### Pre-locked architecture (from research — DO NOT relitigate)

**LOOP-02 invariant relaxation for Phase 17:** Phase 16's "zero runtime imports of voice-protocol/voice-stt/voice-tts/claude-code-bridge" rule is LIFTED in Phase 17 — this is the phase that wires them. But the packages themselves stay byte-for-byte unchanged. Phase 17 must NOT modify any file under `packages/voice-protocol/`, `packages/voice-stt/`, `packages/voice-tts/`, `packages/claude-code-bridge/`, or `packages/achilles-skill/`. A workflow assertion (`grep -L "^[+-]" git diff` against those paths) runs in the CI matrix and on every plan commit.

**session.ts port shape (ARCHITECTURE.md §Pattern 1):**
- v1.2 source: `apps/achilles/src/main/session.ts` (~600 LOC; read end-to-end before porting)
- IPC envelope wrappers REPLACED by direct EventEmitter calls. `broadcast(IPC_STT_COMMIT, payload)` → `session.emit("stt_committed", payload)`
- The state machine (already ported in Phase 16) is wired in via constructor injection — session.ts holds a reference, calls `dispatch(action)`, listens for `state_change`
- Voice packages injected via factory pattern: `runVoice({ webSocketCtor, spawnImpl, ...flags })`; defaults to `globalThis.WebSocket` and `child_process.spawn`; tests inject mocks via MOCK_LOOP=1 env var
- Session is per-invocation (one `achilles voice` run = one Session); resumption via `--resume <sid>` creates a new session with prior state hydrated

**Sandwich-wrap pattern (LOOP-03):**
- Existing helper in `packages/claude-code-bridge` (verify by reading the package); port unchanged
- Envelopes user transcript with `<context>` block containing: session ID, terminal info, ambient calibration (Phase 18 will add real values; Phase 17 stubs defaults), prior turn summary
- The companion.md content is `--append-system-prompt-file`-injected to claude; sandwich wrap is the USER turn structure
- Ack region extraction: regex captures the first sentence (≤12 words) from claude's stream-json deltas BEFORE any tool_use event
- `<spoken-summary>` block extraction: ports the v1.2 extractor verbatim (locate the `<spoken-summary>...</spoken-summary>` tags in claude's final assistant text); content trimmed to ≤40 words for TTS

**Failure-override (LOOP-04 — load-bearing):**
- "I ran into a problem" phrase fires authoritatively from:
  - `claude` subprocess exit code != 0 OR
  - `tool_result` event with `is_error: true` OR
  - `claude_failed` from claude-code-bridge (any cause)
- NEVER derived from LLM narration (claude's own text saying "sorry I failed" does NOT trigger this path; only structural events do)
- Specific phrase "I ran into a problem" is a constant; Phase 17 exports it from a module-level const so Phase 20 asciicasts can grep for it

**Ctrl-C cancel chain (LOOP-05 — load-bearing):**
- SIGINT registered via `process.once("SIGINT", gracefulShutdown)` — NOT `process.on`. First SIGINT triggers shutdown; second SIGINT (received during shutdown) escalates to SIGKILL via the existing claude-code-bridge cancellation chain
- Cancel sequence within `gracefulShutdown(reason)`:
  1. Mark session as shutting down (block new state transitions)
  2. `voice-tts.close()` — closes TTS WSS, stops streaming new audio frames
  3. `ffplayChild.stdin.end()` — signals ffplay to drain and exit; followed by 200ms timeout then `ffplayChild.kill("SIGTERM")` if still alive
  4. `claude-code-bridge.cancel()` — sends SIGINT to claude subprocess; existing chain escalates to SIGTERM after 100ms, SIGKILL after 200ms (300ms total tail)
  5. `voice-stt.close()` — closes STT WSS
  6. `mic-sox.stop()` — kills sox child
  7. Wait for all to exit; emit `shutdown` event; resolve runVoice() promise
- Total budget: <1.5s end-to-end. Verified by MOCK_LOOP=1 integration test with synthetic delays.

**Process group detachment for claude (LOOP-07):**
- `posix_spawn(detached: true)` so when this binary is invoked as a Claude Code skill via `Bash(achilles voice ...)`, the parent Claude Code's SIGTERM (when the user closes the Claude Code thread) does NOT propagate to the spawned claude subprocess
- Workaround for anthropics/claude-code#45717
- claude-code-bridge already has the seam; Phase 17 wires `{ detached: true }` in the spawnImpl options

**ffplay TTS playback (PLAY-01, PLAY-02):**
- Spawn `ffplay -loglevel quiet -nodisp -autoexit -fflags +nobuffer -flags +low_delay -framedrop -probesize 32 -analyzeduration 0 -i -`
- TTS frame stream from voice-tts events$ piped via stdin
- Drain detection: voice-tts emits `tts_drained` when its internal buffer is empty AND stream is ended; session waits SPEAKING_DEBOUNCE_MS (300) before transitioning state machine to listening
- Half-duplex enforcement (PLAY-02): mic frames during speaking state are dropped at the VAD layer (already done in Phase 16's self-trigger guard); 300ms playback-tail debounce prevents listening transition before TTS audio fully drains

**Circuit breaker (ERR-02):**
- Port v1.2 SAFE-05 verbatim from `packages/voice-protocol` if it lives there, OR re-implement at session level if v1.2 had it in `apps/achilles/src/main/`
- Threshold: 3 consecutive failures within 30s opens the breaker
- Cooldown: 60s before next attempt
- Full-jitter backoff between attempts: `delay = random(0, base * 2^attempt)` capped at 30s
- Applies to voice-stt WSS connect AND voice-tts WSS connect
- Open breaker emits `error` event; state machine transitions to error

**HTTP 429 messaging (ERR-02):**
- voice-stt and voice-tts already classify HTTP errors via `classifyHttpError` helper (verify location in those packages)
- 429 produces "ElevenLabs rate limit — retrying in Ns" surfaced via session `error` event → TUI status row → screen-reader announcer

**Stuck-thinking watchdog (ERR-05):**
- Timer reset on every stream-json line from claude subprocess
- After 60s of silence: emit `claude_thinking_stuck` event → status row shows "Claude has been thinking for 60s — Ctrl-C to cancel"
- Stops on first line received after the warning

**Child-exit watchdog (ERR-03, ERR-06):**
- Polls sox child + ffplay child exit codes
- On unexpected exit (not from gracefulShutdown): respawn up to 3 times in a 10-second sliding window
- Cap exceeded: transition state machine to error with "Audio device lost — restart Achilles"
- Suspend/resume detection: macOS sends SIGCONT after wake; sox/ffplay may emit EIO on stdin — child exit triggers respawn path

**Structured logger (ERR-08):**
- Unconditionally writes to `~/.achilles/achilles.log` on every run regardless of `--debug` flag
- Format: NDJSON, one event per line
- Redacts `ELEVENLABS_API_KEY` everywhere it appears
- 10MB rotation: when file exceeds 10MB, rename to `achilles.log.1` (delete .1 if it exists)
- Closes the v1.2 silent-stdio gap — even if the user ran with stdio:"ignore", this log exists

**Lock file + resume (LOOP-06):**
- Lock file: `~/.achilles/voice.lock` containing the current session's PID + start time
- On startup: read lock file; if PID is alive, error "another achilles voice instance is running (PID X); use --resume <sid> to attach"
- On `gracefulShutdown`: unlink lock file
- Sessions stored at `~/.achilles/sessions/<sid>.json`: state, last partial transcript, latency P50/P95
- `--resume <sid>` reads the session file and starts a new session with the prior state hydrated (Phase 17 implements; Phase 18 adds the interactive picker UX)

**MOCK_LOOP=1 integration test (CRITICAL — silent-launch defence):**
- vitest integration test under `apps/achilles-terminal/tests/integration/mock-loop.test.ts`
- Mocks: Scribe v2 WSS (responds with synthetic transcript after 200ms), claude subprocess (synthesizes stream-json with ack + spoken-summary), ElevenLabs WSS (returns synthetic MP3 frames), sox (already mock-amplitude from Phase 16), ffplay (mock spawn that consumes stdin and exits on stdin.end)
- Asserts: full state machine cycle idle → listening → processing → speaking → idle within 2 seconds; ack region extracted; `<spoken-summary>` extracted; TTS frames piped to ffplay stdin; no orphaned children at end
- This test is the upstream CI gate. PRs cannot merge if it fails.

### Claude's Discretion (planner-level)

- Exact module boundary between session.ts and the individual audio/* modules (more granular vs more monolithic)
- Whether to port v1.2's session.ts as a class or rewrite as a functional composition of EventEmitters
- Whether the embedded companion.md asset uses `bun build --bundle` static-import or `fs.readFileSync(import.meta.url + "../../skill/companion.md")` runtime read (Bun-compiled binary differs from Node fallback)
- Whether the circuit-breaker is a standalone module or lives inside the WSS factory
- Whether to chunk the plan: scaffolding plan, port plan, integration plan, and watchdog plan — versus a 2-plan split

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 milestone research
- `.planning/research/v1.3-terminal-pivot.md` §6 state machine, §7 voice loop wiring, §10.6 skill body lifecycle
- `.planning/research/FEATURES.md` — Half-duplex turn-taking, barge-in, failure-override
- `.planning/research/ARCHITECTURE.md` §Pattern 1 composition root, §Pattern 4 ffplay sink, §Test Seams Under Bun and Node
- `.planning/research/PITFALLS.md` §1 silent-launch (THE failure shape Phase 17 must structurally prevent), §2 SIGINT propagation through claude subprocess, §5 Bun stdout flush, §7 stream-json line parsing chunk boundaries, §10 SIGINT propagation under Claude Code

### Phase 15 + Phase 16 outputs
- `apps/achilles-terminal/package.json` (current state — Phase 16 added ink/react/chalk/ink-testing-library; Phase 17 adds NOTHING new to dependencies — uses existing claude-code-bridge etc. via workspace protocol)
- `apps/achilles-terminal/src/cli.ts` (Phase 15 + Phase 16; Phase 17 EXTENDS the voice subcommand path by replacing the stub runVoice with the real implementation)
- `apps/achilles-terminal/src/audio/mic-sox.ts` (Phase 16)
- `apps/achilles-terminal/src/audio/vad-energy.ts` (Phase 16; self-trigger guard already present)
- `apps/achilles-terminal/src/state/state-machine.ts` (Phase 16; muted as 6th state)
- `apps/achilles-terminal/src/state/constants.ts` (Phase 16; SPEAKING_DEBOUNCE_MS=300)
- `apps/achilles-terminal/src/ui/VoiceShell.tsx` (Phase 16; subscribes to session events via useAchillesState)

### v1.2 source (READ-ONLY — port targets)
- `apps/achilles/src/main/session.ts` — the load-bearing port target (~80% verbatim, IPC envelopes stripped)
- `apps/achilles/src/main/`  — adjacent files: extractors, circuit-breaker, stuck-thinking-watchdog, child-exit-watchdog if present
- `packages/voice-protocol/` — DI types
- `packages/voice-stt/` — STT WSS factory
- `packages/voice-tts/` — TTS WSS factory + events$
- `packages/claude-code-bridge/` — claude subprocess spawn + cancellation chain
- `packages/achilles-skill/skill/prompts/companion.md` — embedded asset

### LOOP-02 invariant sources (byte-for-byte unchanged through Phase 17)
- `packages/voice-protocol/**` — Phase 17 imports types + runtime functions but does NOT modify files
- `packages/voice-stt/**` — same
- `packages/voice-tts/**` — same
- `packages/claude-code-bridge/**` — same
- `packages/achilles-skill/skill/prompts/companion.md` — same (the file's SHA-256 is verified in CI; Phase 17 ports the v1.2 CI check)

### Project-level rules
- No emojis (CLAUDE.md global)
- No auto-running of `achilles voice` from any task (vitest MOCK_LOOP=1 is OK)
- No browser automation (FSB MCP — not applicable here)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/voice-protocol/` — DI types: `WebSocketCtor`, `SpawnImpl`, event shapes
- `packages/voice-stt/` — Scribe v2 WSS factory; consumes Int16Array frames; emits `partial` + `committed` events
- `packages/voice-tts/` — ElevenLabs WSS factory; produces audio frame async iterator (events$); supports drain detection
- `packages/claude-code-bridge/` — claude subprocess spawn; cancellation chain; stream-json line parser; sandwich-wrap helper; existing `posix_spawn(detached:true)` seam
- `packages/achilles-skill/skill/prompts/companion.md` — embedded system prompt for claude; SHA-256 source of truth check ports verbatim
- Phase 16's session-scoped EventEmitter shape via `useAchillesState` hook — the UI subscription contract already designed; Phase 17 implements the emitter side

### Established Patterns
- ESM with `.js` import specifiers
- vitest `--pool=forks`
- Constructor-injection / factory-pattern DI for voice packages
- `process.once("SIGINT", ...)` for shutdown handlers (NOT `process.on`)
- Async iterators (`events$`) for streaming TTS frames
- Per-module exports of constants (e.g., `FAILURE_OVERRIDE_PHRASE = "I ran into a problem"`)

### Integration Points
- `apps/achilles-terminal/package.json` — Phase 17 ADDS: workspace-internal `dependencies` (`"@achilles/voice-protocol": "workspace:*"`, etc.). LOOP-02 is intentionally lifted here — these were stubbed away in Phase 16
- `apps/achilles-terminal/src/cli.ts` — Phase 17 does NOT modify the static top-level imports (INIT-07 preserved); the existing `await import("./session.js")` voice branch now resolves to the real session
- `apps/achilles-terminal/tests/integration/mock-loop.test.ts` (NEW) — the upstream CI smoke gate
- `.github/workflows/achilles-terminal-ci.yml` (Phase 15 lock) — Phase 17 ADDS a step that runs `MOCK_LOOP=1 npm test --workspace apps/achilles-terminal -- tests/integration/`; Phase 17 modifies the workflow file
- `~/.achilles/` — Phase 17 creates the directory + sessions/ + lock + log files at runtime (`fs.mkdirSync(recursive: true)`); Phase 18 adds the interactive init wizard
- v1.2 `packages/claude-code-bridge/` — Phase 17 reads it end-to-end as the port reference for the cancellation chain; should NOT modify it (LOOP-02)

</code_context>

<specifics>
## Specific Ideas

- `runVoice({ webSocketCtor, spawnImpl, mockLoop })` accepts undefined defaults for first two; mockLoop boolean is the test gate (set from `MOCK_LOOP=1` env var)
- Session emitter shape (use TypeScript discriminated union): event types defined in `apps/achilles-terminal/src/session-events.ts`; each event has `{ type: "X", payload: Y, timestamp: number }`
- ffplay command line: confirmed in v1.3-terminal-pivot.md research; embed as a const string in tts-playback.ts so a reader can audit it without grep
- The MOCK_LOOP=1 integration test must complete in <5s wall-clock. Mock WSS responses use synthetic 200ms delays so the test exercises the timing-sensitive paths (SPEAKING_DEBOUNCE_MS, ffplay drain) without being slow.
- `~/.achilles/` directory creation is idempotent and lazy — created on first write (lock, session, log); never errors if it already exists
- The "I ran into a problem" failure-override phrase is the FIRST thing TTS speaks when the chain triggers — NOT the LLM's own narration. It overrides whatever the LLM was going to say.
- ack region regex: capture group `^([^.!?]{1,80}[.!?])` — first sentence up to 80 chars; trimmed to ≤12 words
- `<spoken-summary>` regex: `/<spoken-summary>([\s\S]*?)<\/spoken-summary>/` capture group; trimmed to ≤40 words
- claude-code-bridge detach: `spawn("claude", [...args], { detached: true, stdio: ["pipe", "pipe", "pipe"] })` — verify the existing package supports this options shape; if not, file an internal note (the package source is FROZEN per LOOP-02; the wiring lives in Phase 17's claude-bridge.ts wrapper)

</specifics>

<deferred>
## Deferred Ideas

- macOS Sequoia 15.4+ VS Code-integrated-terminal TCC validation — Phase 20 asciicast capture
- Real-binary asciicast capture across darwin-arm64 / linux-x64 / win32-x64 — Phase 20
- Apple Developer ID + notarytool: dropped per the v1.3 Option 3 lock; revisit only if a compiled macOS binary is reintroduced post-v1.3
- npm publish — Phase 19 (Gatekeeper bypass test no longer applicable under Option 3 — no compiled darwin binary exists to dequarantine)
- Persistent latency JSON + report subcommand polish — partially landed (ERR-07), refinement Phase 18
- Init wizard ambient calibration (5-second pre-flight) → seeds the VAD EWMA noise floor — Phase 18
- Encrypted API key in `~/.achilles/key.enc` — Phase 18
- Settings menu (`achilles config`) — Phase 18
- `achilles transcripts list/purge` — Phase 18 (opt-in `--save-transcripts`)
- Field test at 65 dBA confirming VAD does not false-fire — Phase 20

</deferred>
