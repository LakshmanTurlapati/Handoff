# Phase 18: Init Wizard + Config + Transcripts + Single-Instance Lock - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Auto-generated (synthesized from .planning/research/FEATURES.md + ARCHITECTURE.md + PITFALLS.md + v1.3-terminal-pivot.md + ROADMAP)

<domain>
## Phase Boundary

Build the cold-start friction killer that makes `achilles voice` shippable to real users. Phase 18 wires:
- `achilles init` linear wizard via `@clack/prompts` — API key resolution → sox/ffmpeg/claude preflight → ambient calibration → 1-utterance smoke test
- API key resolution hierarchy: `ELEVENLABS_API_KEY` env → OS keychain via `@napi-rs/keyring` → encrypted `~/.achilles/key.enc` (libsodium secretbox, 0o600)
- macOS TCC parent-emulator detection on sox EPERM/EACCES (per PITFALLS.md §3): `process.ppid` + `ps -p $PPID -o comm=` → per-emulator remediation hint
- `~/.achilles/voice.lock` single-instance PID file with liveness check (Phase 17 wrote the file; Phase 18 enforces the conflict resolution at startup)
- Opt-in `--save-transcripts` + `achilles transcripts list|purge` subcommands; 30-day retention
- Typed-input fallback via `@clack/prompts.text()` when STT circuit breaker opens; transcript flows through the same sandwich-wrap pipeline as voice (ERR-04)
- `achilles config` settings menu (interactive `@clack/prompts` reading + editing `~/.achilles/settings.json`)
- `achilles voice --debug` flag enables verbose latency + line-trace logging to `~/.achilles/debug-<ts>.log` (key redacted) — extends Phase 17's structured-logger
- `achilles latency --report` printing rolling-window P50/P95 (Phase 17 wrote latency-probe; Phase 18 wires the `--report` CLI subcommand reading from disk)
- 7-regex redaction pattern for the structured logger covering `Bearer`, `JWT`, `sk-`, `xi-`, ELEVENLABS_API_KEY values, long hex, and basic-auth headers (Phase 17 has 6 regexes; Phase 18 adds the 7th from v1.2's tarball scanner)
- Confirm `packages/voice-protocol/src/transport.ts:assertElevenLabsHost` allowlist is still in place; if absent in v1.3 voice-protocol, port the v1.2 assertion (LOOP-02 boundary: if it lives in voice-protocol unchanged, Phase 18 does NOT modify; if v1.2 had it elsewhere, Phase 18 ports to a NEW file in apps/achilles-terminal/src/)

Inside scope:
- `apps/achilles-terminal/src/init/wizard.ts` — `@clack/prompts` linear flow
- `apps/achilles-terminal/src/init/api-key.ts` — env → keychain → encrypted file resolver
- `apps/achilles-terminal/src/init/keychain.ts` — `@napi-rs/keyring` wrapper (graceful fallback if keychain unavailable on Linux without libsecret)
- `apps/achilles-terminal/src/init/encrypted-key.ts` — libsodium secretbox read/write at `~/.achilles/key.enc`, 0o600 perms enforced
- `apps/achilles-terminal/src/init/preflight.ts` — `which` + device-open smoke test for sox/ffmpeg/claude
- `apps/achilles-terminal/src/init/install-suggestions.ts` — platform-specific install lines + optional package manager invocation
- `apps/achilles-terminal/src/init/ambient-calibration.ts` — 5-second mic capture, RMS histogram, EWMA seed value
- `apps/achilles-terminal/src/init/smoke-test.ts` — 1-utterance round-trip exercising mic → STT → claude → TTS → ffplay (uses session.ts from Phase 17)
- `apps/achilles-terminal/src/init/parent-terminal.ts` — `process.ppid` resolver + per-emulator remediation table
- `apps/achilles-terminal/src/init/marker.ts` — read/write `~/.achilles/init.json` so `achilles voice` skips wizard on subsequent runs
- `apps/achilles-terminal/src/lock-file.ts` — startup-time single-instance enforcement (Phase 17 wrote the file; Phase 18 reads + conflict-resolves)
- `apps/achilles-terminal/src/transcripts/store.ts` — JSONL writer with secret redaction
- `apps/achilles-terminal/src/transcripts/retention.ts` — 30-day cleanup
- `apps/achilles-terminal/src/transcripts/cli.ts` — `transcripts list|purge` subcommand handlers
- `apps/achilles-terminal/src/typed-input.ts` — `@clack/prompts.text()` fallback handler triggered by STT circuit open
- `apps/achilles-terminal/src/config-menu.ts` — interactive settings menu for `~/.achilles/settings.json`
- `apps/achilles-terminal/src/latency-report.ts` — `latency --report` subcommand reading from `~/.achilles/latency/` JSON files (Phase 17 wrote these files)
- `apps/achilles-terminal/src/cli.ts` extension — register `init`, `config`, `transcripts`, `latency` subcommands; keep INIT-07 invariant (top-level static imports stay `node:fs/promises`, `node:url`, `node:path`)
- Tests for every module
- Update SKILL.md (`packages/achilles-skill/skill/SKILL.md` — NOT companion.md; SKILL.md is the user-facing surface that Phase 19 will rewrite further) — Phase 18 may need to add `Bash(achilles init *)` and `Bash(achilles config *)` and `Bash(achilles transcripts *)` and `Bash(achilles latency *)` to the allowed-tools narrowing. **Confirm whether SKILL.md edits are LOOP-02-locked** — companion.md is the LOOP-02 invariant; SKILL.md may be editable. If not, defer to Phase 19's skill rewire.

Outside scope (defer):
- macOS codesigning + notarytool (Phase 19)
- npm publish (Phase 19)
- Real-binary asciicast capture across 3 platforms (Phase 20)
- Real Apple Developer ID acquisition (operator gate before Phase 19)
- VS Code-integrated-terminal asciicast under macOS Sequoia 15.4+ (Phase 20)
- Field test at 65 dBA (Phase 20)
- Dual-runtime CI matrix final-green (Phase 20 ratifies)

</domain>

<decisions>
## Implementation Decisions

### Pre-locked (from research/roadmap — do not relitigate)

**API key resolution (INIT-02, SAFE-01):**
- Read precedence: `ELEVENLABS_API_KEY` env var → `@napi-rs/keyring` getPassword("achilles", "ELEVENLABS_API_KEY") → libsodium secretbox decrypt of `~/.achilles/key.enc`
- Write precedence (during init wizard): user picks save-to-keychain (default) or save-to-encrypted-file (fallback); env var is read-only (never overwritten)
- `~/.achilles/key.enc` format: libsodium secretbox; nonce (24 bytes) prepended to ciphertext; key derived from machine-local entropy stored at `~/.achilles/.key.salt` (also 0o600)
- Encrypted file perms enforced via `fs.chmodSync(0o600)` after write; check on read and refuse to use if perms looser than 0o600

**`@napi-rs/keyring` fallback (Linux without libsecret):**
- The package throws on missing libsecret. Catch the error; surface "OS keychain unavailable on this system; falling back to encrypted file" via `@clack/prompts.note`; proceed to encrypted-file path
- Document the failure mode in the init wizard output

**libsodium choice:**
- Use `libsodium-wrappers-sumo` (or `@stablelib/nacl` if libsodium-wrappers is too heavy for the Bun-compiled binary). Verify both packages exist and pin the lighter one
- Verify via slopcheck at planning time

**Preflight (INIT-03):**
- `which sox` / `which ffmpeg` / `which claude` first (cheap path check)
- Then real 1-second device-open smoke: spawn `sox -q -n -t raw -r 16000 -b 16 -e signed -c 1 - trim 0 1` and verify exit code 0 (sox can open the default mic and emit 1 second of silence-of-real-mic). Same for ffmpeg (e.g., `ffmpeg -version` — actually need a real device test; use ffplay header parse on /dev/null or empty PCM)
- claude: `claude --version` exit 0
- On miss, print platform-specific install line + offer to invoke the package manager (`brew install ...`, `sudo apt install ...`, `choco install ...`)

**Ambient calibration (INIT-04):**
- 5 seconds of mic capture via mic-sox.ts (Phase 16)
- Histogram of RMS values; pick the 10th percentile as initial `noiseFloor` (EWMA seed)
- Write to `~/.achilles/settings.json` so VAD's EWMA bootstrap (Phase 16) uses this value as the initial floor instead of the default 0.005

**1-utterance smoke test (INIT-04):**
- Uses session.ts from Phase 17
- Mocks: NONE (this is the real-loop smoke; if Phase 17 wired it right, this test exercises real services)
- BUT: respect CLAUDE.md "no auto-running" rule — this test ONLY runs when the user is actively in the init wizard. It does NOT run from vitest. It DOES emit progress to the @clack/prompts UI.
- Success criterion: full state cycle completes within 30s; ack + spoken-summary both received

**Parent terminal detection (INIT-06, PITFALLS.md §3):**
- `process.ppid` → `ps -p ${ppid} -o comm=` → string like "iTerm2", "Terminal", "Code Helper" (VS Code), "Cursor", "ghostty", "WezTerm", "Warp"
- Per-emulator remediation table:
  - iTerm2 / Terminal.app / Ghostty / WezTerm: expect the standard System Settings prompt; if user denies, route them to System Settings → Privacy & Security → Microphone
  - VS Code / Cursor / "Code Helper": print "VS Code does not propagate mic permission. Open Terminal.app once and run `achilles init`, then return to VS Code."
  - Warp: similar to iTerm2
  - Unknown: generic "Open System Settings → Privacy & Security → Microphone and enable your terminal."

**Single-instance lock (SAFE-04):**
- `~/.achilles/voice.lock` PID file (created/cleaned in Phase 17; Phase 18 enforces conflict)
- Startup: read lock file; parse PID; check `process.kill(pid, 0)` (or equivalent) for liveness
- If alive: error "Another achilles voice session is running (pid X). Press Ctrl-C in that terminal first." and exit 1
- If stale (process not alive): remove file, proceed
- gracefulShutdown unlinks the file (Phase 17 wired this in graceful-shutdown.ts; verify and extend)
- `--resume <sid>` (LOOP-06; Phase 17 implemented) attaches to a prior session; lock file is shared

**Transcripts (SAFE-02):**
- Default OFF. `--save-transcripts` flag enables
- Format: JSONL at `~/.achilles/transcripts/<session-id>.jsonl`
- Each line: `{ "t": <ts>, "type": "user"|"assistant"|"system", "text": "..." }`
- Secret redaction applied before write (7-regex pattern from structured-logger Phase 17 + 1 new regex for ELEVENLABS keys)
- 30-day retention: cleanup runs at startup (delete files older than 30 days)
- `achilles transcripts list` prints filename + first user-line preview per file
- `achilles transcripts purge` interactive prompt: delete all / delete older than N days / cancel

**Typed-input fallback (ERR-04):**
- Triggered when STT circuit breaker emits `open` event
- @clack/prompts.text({ message: "STT unavailable — type your message:", placeholder: "..." })
- Typed string flows through the same `commitTranscript()` path as voice transcripts (which Phase 17 wired through sandwich-defence)

**Config menu (`achilles config`):**
- `@clack/prompts.select` menu listing settings + their current values from `~/.achilles/settings.json`
- Edit one at a time; "save and exit" / "cancel" at bottom
- Settings include: voice_threshold, silence_threshold, voice_hold_ms, silence_hold_ms, save_transcripts (default off), debug_mode, language (for STT — defer to v1.4)

**Latency report (ERR-07):**
- `~/.achilles/latency/<session-id>.json` files written by Phase 17's latency-probe
- `achilles latency --report` reads all of them, computes rolling-window P50/P95 over the last N sessions (default 30), prints a table

**`--debug` flag (ERR-07):**
- Sets a global flag that the structured-logger reads to ALSO write to `~/.achilles/debug-<timestamp>.log`
- Same key-redaction as the always-on log
- Useful for field debugging

**INIT-07 invariant (still active from Phase 15):**
- `apps/achilles-terminal/src/cli.ts` top-level static imports MUST remain `{ node:fs/promises, node:url, node:path }`
- All new subcommands (`init`, `config`, `transcripts`, `latency`) use dynamic `await import("./...")` gates inside `main()` after the argv parse
- `achilles --version` MUST still work without API key, sox, ffmpeg

**SKILL.md (consideration — verify before modifying):**
- The LOOP-02 invariant locks `packages/achilles-skill/skill/prompts/companion.md` (the prompt). `packages/achilles-skill/skill/SKILL.md` is the skill manifest — separate file. Confirm whether Phase 18 can edit SKILL.md or whether that's Phase 19's job
- Recommendation: defer SKILL.md edits to Phase 19 (which has the explicit "SKILL.md diff" task already)

### Claude's Discretion (planner-level)

- Whether `wizard.ts` is one monolithic file or split per-step
- Whether keychain + encrypted-file modules share a common interface or just call sites
- Whether the `transcripts` subcommands live in their own file or in cli.ts
- Whether the ambient calibration mic-spawn shares mic-sox.ts (Phase 16) or has its own simpler spawn
- Whether to integration-test the wizard end-to-end (mocked prompts) or only unit-test per-module
- Whether to add `~/.achilles/sessions/` for resume support enumeration (Phase 17 stubbed) or defer to v1.4

</decisions>

<canonical_refs>
## Canonical References

- ROADMAP.md Phase 18 entry — goal + 5 success criteria
- REQUIREMENTS.md — INIT-01..07, SAFE-01..04, ERR-04, ERR-07
- .planning/research/FEATURES.md — Init wizard reference patterns (OpenClaw + gh CLI auth pattern)
- .planning/research/PITFALLS.md §3 — macOS TCC parent-emulator
- .planning/research/v1.3-terminal-pivot.md §9 — init wizard design
- Phase 17 outputs: `apps/achilles-terminal/src/session.ts`, `latency-probe.ts`, `graceful-shutdown.ts`, `resume-session.ts`, `structured-logger.ts`, `circuit-breaker.ts`
- Phase 16 outputs: `mic-sox.ts`, `vad-energy.ts` (ambient calibration uses these)
- `packages/voice-protocol/src/transport.ts:assertElevenLabsHost` (LOOP-02 locked; Phase 18 verifies it exists)
- `packages/voice-stt/`, `packages/voice-tts/`, `packages/claude-code-bridge/`, `packages/achilles-skill/skill/prompts/companion.md` — all LOOP-02 locked

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable
- `@clack/prompts` — confirmed in research (FEATURES.md TABLE STAKES); install at Phase 18 Wave 0
- `@napi-rs/keyring` — slopcheck before install
- `libsodium-wrappers-sumo` or `@stablelib/nacl` — slopcheck before install; planner picks lighter package
- Phase 17's `structured-logger.ts` 7-regex redaction
- Phase 17's `circuit-breaker.ts` — Phase 18 attaches `open` event listener for typed-input fallback
- Phase 17's `session.ts` — smoke test invokes it
- Phase 16's `mic-sox.ts` + `vad-energy.ts` — ambient calibration uses them directly

### Established Patterns
- ESM with `.js` import specifiers
- vitest `--pool=forks`
- Dynamic-import gates in cli.ts (INIT-07 preserved)
- ~/.achilles/ directory created idempotently with `fs.mkdirSync(recursive: true)`; 0o700 perms
- Constants exported per-module (e.g., FAILURE_OVERRIDE_PHRASE from Phase 17)

### Integration Points
- `apps/achilles-terminal/package.json` — ADD dependencies: `@clack/prompts`, `@napi-rs/keyring`, `libsodium-wrappers-sumo` (or `@stablelib/nacl`)
- `apps/achilles-terminal/src/cli.ts` — extend with `init`, `config`, `transcripts`, `latency` subcommands via dynamic-import gates (INIT-07 preserved)
- `~/.achilles/` directory — read/write contract finalized in Phase 18 (init.json, key.enc, .key.salt, voice.lock, settings.json, transcripts/, latency/, sessions/, achilles.log, debug-*.log)

</code_context>

<specifics>
## Specific Ideas

- The init wizard's "keep current" defaults for INIT-05 idempotency: every prompt has a default value derived from the existing config; pressing Enter accepts current; only differences are written
- The summary diff before write: format `key: old → new` for each changed setting; print via `@clack/prompts.note`; require explicit confirmation
- The encrypted-file format: `nonce (24 bytes) + ciphertext`; key derived via `crypto.scryptSync(machineId, salt, 32)` where machineId is read from `/etc/machine-id` (Linux), `ioreg -rd1 -c IOPlatformExpertDevice` (macOS), or a generated UUID stored at `~/.achilles/.machine-id` (Windows or fallback)
- The 7th redaction regex (added in Phase 18): match ElevenLabs key prefix `xi_` followed by 40+ alphanumeric chars
- The transcripts JSONL `system` line type emitted on session boundaries: `{ "t": <ts>, "type": "system", "event": "session_start"|"session_end", "session_id": "..." }`
- The `achilles transcripts purge` prompt offers: "delete all", "delete older than 7 days", "delete older than 30 days", "cancel"

</specifics>

<deferred>
## Deferred Ideas

- Voice picker (multiple voices) — defer to v1.4
- silero-vad swap behind same VadHandle interface — v1.4
- Language picker for STT — v1.4
- `~/.achilles/sessions/<sid>.json` enumeration UX (Phase 17 wrote the files; Phase 18 reads via --resume; richer UX defer)
- Real `bun build --compile` against the new wizard module — Phase 19 publish
- Real signed binary smoke test — Phase 19/20
- TCC parent-emulator validation across all 7 emulators — Phase 20 asciicast capture

</deferred>
