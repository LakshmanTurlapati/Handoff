# Phase 19: Distribution + Publishing + Skill Rewire - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the v1.3 artifacts to npm under the locked Option 3 distribution shape, rewire the Claude Code skill from the v1.2 Electron `achilles launch` model to the v1.3 terminal-only `achilles voice` model, harden the runtime error surface (ERR-01 inline banner, ERR-03 sox/ffplay watchdog, ERR-08 unconditional structured logger), and delete the v1.2 Electron tree + the v1.2 launcher path in publish-then-cut ordering so a failed publish never orphans the workspace.

In scope:
- npm publish of the parent `achilles` package + 3 platform sibling packages (`@achilles/cli-linux-x64`, `@achilles/cli-linux-arm64`, `@achilles/cli-win32-x64`) atomically from one CI workflow
- Drop the 2 darwin sibling packages (`@achilles/cli-darwin-arm64`, `@achilles/cli-darwin-x64`) from the monorepo and from `apps/achilles-terminal/package.json` optionalDependencies under the Option 3 lock (no compiled darwin binary ships; macOS runs the JS-fallback bundle under Node 22+ via the `#!/usr/bin/env node` shebang on `dist/cli.js`, with Bun documented as the preferred runtime for sub-500ms cold-start)
- SHA-256 source-of-truth CI check porting from v1.2 against the new layout, asserting `companion.md` byte-for-byte equality between in-tarball + in-skill copies (DIST-03 / LOOP-02-locked)
- Tarball secret scan + `strings dist/achilles | grep -E "sk_[a-f0-9]{48,}"` empty-result test against the 3 compiled binaries; equivalent grep of the JS bundle for the macOS path
- Full SKILL.md rewrite to the terminal-only model: drop all Electron / floating-UI / `systemPreferences.askForMediaAccess` / X-forwarding language; add sox + ffmpeg + Node 22 (Bun-recommended on macOS) prerequisites; describe terminal TUI rendering inline in the calling terminal; describe `achilles init` for TCC + ambient calibration with the parent-terminal-emulator note for macOS; narrow `allowed-tools` frontmatter from `Bash` to `Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(achilles config *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)`; add `BASH_MAX_TIMEOUT_MS=86400000` documentation prominently at the top of the body
- ERR-01 inline error banner (pre-empt above status row) — names error class (network / auth / rate-limit / sox / ffplay / claude) and proposes next action; auto-dismisses after 8s or on next successful event
- ERR-03 sox + ffplay child-exit watchdog with bounded respawn (max 3 attempts in 10s window); on cap-exceeded transitions to error state with "Audio device lost -- restart Achilles"
- ERR-08 unconditional structured logger at `~/.achilles/achilles.log` writing on every run regardless of flags (closes the v1.2 silent-stdio gap); keys still redacted via the 7-regex DEFAULT_REDACT_PATTERNS from Phase 18; rotates at 10MB
- ESLint rule forbidding `stdio: "ignore"` on the launch path in `apps/achilles-terminal/` (prevents v1.2 detached-stdio regression); CI fails the build if the pattern appears
- Publish-then-cut deletion of `apps/achilles/` (Electron tree, 132 files) + `apps/achilles-cli/src/commands/launch.ts` (179 LOC) + any other newly-dead code in `apps/achilles-cli/` confirmed unreferenced (init/install-skill/latency/transcripts in `apps/achilles-cli/src/commands/` are likely all dead post-cut, but each must be verified before deletion)

Out of scope (explicitly):
- Apple Developer ID acquisition, codesign, notarytool, spctl, Gatekeeper bypass, `xattr -dr com.apple.quarantine` workaround — all descoped under Option 3 (see `.planning/research/v1.3-terminal-pivot.md` §10.2)
- Compiled darwin binary of any kind (the 2 darwin sibling packages drop)
- Real-binary asciicast capture (RBS-1/2/3) — that is Phase 20 GATE-01 scope
- VS Code-integrated-terminal asciicast on macOS Sequoia 15.4+ — Phase 20 GATE-02 scope
- 65 dBA noisy-environment field test — Phase 20 GATE-03 scope
- Dual-runtime CI matrix final-green ratification — Phase 20 GATE-04 scope (Phase 15 wired the scaffold; Phase 19 keeps it green; Phase 20 audits)
- Touching `packages/voice-protocol/`, `packages/voice-stt/`, `packages/voice-tts/`, `packages/claude-code-bridge/`, `packages/achilles-skill/skill/prompts/companion.md` — LOOP-02 byte-for-byte invariant
- Touching `apps/achilles-terminal/src/cli.ts` top-level static imports beyond `{node:fs/promises, node:url, node:path}` — INIT-07 invariant (any new entrypoint logic uses dynamic imports inside main())

</domain>

<decisions>
## Implementation Decisions

### Darwin Sibling Packages Disposition
- **D-01:** Drop the 2 darwin sibling packages ENTIRELY. Delete `apps/cli-darwin-arm64/` and `apps/cli-darwin-x64/` directories from the monorepo. Remove `"@achilles/cli-darwin-arm64": "1.3.0"` and `"@achilles/cli-darwin-x64": "1.3.0"` from `apps/achilles-terminal/package.json` optionalDependencies. Only the 3 compiled-binary platform packages (`@achilles/cli-linux-x64`, `@achilles/cli-linux-arm64`, `@achilles/cli-win32-x64`) remain. Reasoning: `@achilles` is a private npm scope so there is no squat risk on unpublished sub-package names; the bin shim's `existsSync(binPath)` check already handles missing-platform-binary deterministically (falls through to the JS bundle); 2 fewer packages to version-bump per release. Trade-off: anyone reading `apps/achilles-terminal/package.json` sees only 3 platforms, which is exactly the Option 3 lock and intentionally matches the published artifact set.
- **D-02:** The deletion of the 2 darwin directories happens as part of the PRE-publish work (not in the publish-then-cut deletion commit). Phase 19's publish-then-cut deletion is reserved for the v1.2 Electron + launcher artifacts; the darwin sibling drop is part of the v1.3.0 published-shape itself, not a v1.2 cleanup. The 2 darwin directories were never published (Phase 15 only scaffolded them), so deleting them now is the only place that touches them.

### SKILL.md Rewrite Scope
- **D-03:** Full rewrite of `packages/achilles-skill/skill/SKILL.md` to the v1.3 terminal-only model. NOT a one-line `achilles launch` -> `achilles voice` diff; the current 152-line SKILL.md body describes Electron + floating UI + `systemPreferences.askForMediaAccess` + X-forwarding prerequisites + Electron-host language, none of which is true under v1.3. Leaving any of it in place lies to the operator reading the manifest.
- **D-04:** Frontmatter `allowed-tools` is narrowed from `Bash` to: `Bash(achilles voice *), Bash(achilles init *), Bash(achilles transcripts *), Bash(achilles config *), Bash(achilles latency *), Bash(which achilles), Bash(which sox), Bash(which ffmpeg)`. The narrow list matches the 5 subcommands wired by Phase 18 plus the 3 preflight `which` invocations.
- **D-05:** `BASH_MAX_TIMEOUT_MS=86400000` (24 hours) is documented prominently at the top of the SKILL.md body so operators do not get blindsided by the 600s default Bash timeout cutting off a long voice session.
- **D-06:** The skill body shells out to `achilles voice`. Period. The `#!/usr/bin/env node` shebang on `dist/cli.js` dispatches to Node 22+. Bun is documented as the preferred runtime on macOS for sub-500ms cold-start (set `BUN_INSTALL_BIN=/path/to/bun` and reorder `PATH` per platform), but Bun is NOT a prerequisite -- if the user has `npm install -g achilles` working, they have Node 22+, the JS-fallback runs.
- **D-07:** SKILL.md rewrite drops every reference to Electron, the floating window, the `Achilles.app` bundle, `systemPreferences.askForMediaAccess`, "renderer", microphone-permission-via-Electron, X-forwarding requirements, and SSH-without-X-forwarding caveats. Replaces with: terminal TUI inline-rendering, sox + ffmpeg system tool prerequisites, parent-terminal-emulator TCC remediation note (cite Phase 18 INIT-06), `achilles init` for the linear wizard walk.

### Publish-then-Cut Deletion Staging
- **D-08:** Single cleanup commit AFTER `npm publish` succeeds for `achilles@1.3.0` + the 3 platform packages. The commit deletes: (a) `apps/achilles/` entirely (Electron tree, 132 files), (b) `apps/achilles-cli/src/commands/launch.ts` + paired `launch.test.ts`, (c) any other files in `apps/achilles-cli/` confirmed unreferenced post-v1.3 cut. The verification step (before the deletion commit) greps the entire monorepo for any importers of the deletion targets; if `apps/achilles-cli/` has nothing reachable from the new published bin path, the whole directory deletes. Rollback story: `git revert HEAD` undoes the whole cut atomically.
- **D-09:** The deletion commit lands as a SEPARATE commit, NOT in the same commit that flips the npm publish. Sequencing: (commit A) Phase 19 publish-ready state with new bin paths, SKILL.md rewrite, ESLint rule, structured logger, error-banner, watchdog -- everything except deletions; (CI runs publish job from commit A); (CI confirms `npm view achilles@1.3.0` succeeds and the 3 platform packages are discoverable); (commit B) deletion of apps/achilles + apps/achilles-cli launcher path. A publish failure leaves the workspace at commit A with the Electron tree still in place as a recoverable artifact.

### ERR-01 Error Banner UX
- **D-10:** Pre-empt model: the ERR-01 banner adds a NEW one-line red row ABOVE the existing `[state] <last 60 chars of transcript>` status row from Phase 18. Both rows are visible simultaneously while the banner is active. Banner content: `[error] <class> -- <suggested action>` where class is one of {network, auth, rate-limit, sox, ffplay, claude}. Auto-dismiss after 8s OR on next successful event (whichever comes first). Status row stays visible underneath the banner the whole time so the user sees BOTH the error AND the current state during cascading failures (e.g., red `network -- retrying...` + green `listening` simultaneously). Ink layout: `<Box flexDirection="column"><Banner conditional /><BlobAndSparkline /><StatusRow /></Box>`. Vertical jitter is acceptable (banner appears/disappears adds/removes 1 row).
- **D-11:** Screen-reader mode (Phase 16 ACC-02 / `INK_SCREEN_READER=1`) is NOT split into a separate replace-the-row variant -- the visual pre-empt is announced as a discrete `<Text aria-live="assertive">` ERR-01 row distinct from the `<Text aria-live="polite">` status row. The screen reader announces the error first (assertive) then the status (polite) per ARIA live-region semantics. Double-announcement during the 8s window is acceptable because the user explicitly wants to hear errors immediately.

### Claude's Discretion
- ERR-03 watchdog respawn cap behavior on cap-exceeded ("Audio device lost -- restart Achilles"): planner decides whether to exit the process or stay in error state with Phase 18 ERR-04 typed-input fallback still active. Recommend: stay in error state, mic capture is dead but typed-input still works, user can finish their thought then Ctrl-C clean-exit.
- ERR-08 structured logger rotation strategy at 10MB: planner decides between `achilles.log.1` (single archive) vs daily `achilles.log.YYYY-MM-DD` vs numbered N-archive ring buffer. Recommend: single archive (`achilles.log` + `achilles.log.1`), simplest, matches v1.2 logger semantics that operators already know.
- CI workflow shape (one workflow with per-OS runners publishing atomically vs separate per-platform workflows): planner picks based on GitHub Actions matrix semantics. Recommend: single workflow with `matrix.os` and a `publish` job that depends on `build` succeeding on all platforms; npm publish is sequential (parent first, then siblings) inside the publish job to keep ordering deterministic.
- ESLint rule scope: `stdio: "ignore"` forbid rule lives in `apps/achilles-terminal/eslint.config.js` only, NOT root. Other workspaces (Handoff bridge/relay/web) have legitimate `stdio:"ignore"` usage and should not be regressed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 Locked Decisions
- `.planning/ROADMAP.md` Phase 19 section -- the goal, success criteria, and requirements list (post macOS Option 3 lock as of 2026-06-09 commit `9589bad6`)
- `.planning/REQUIREMENTS.md` -- requirements DIST-03, DIST-04, DIST-06, ERR-01, ERR-03, ERR-08 (DIST-06 is the new JS-fallback verification scope under Option 3, NOT codesign)
- `.planning/STATE.md` -- Phase 19 decision row (line ~62) lists the Option 3 lock; blockers section (line ~82) flags the JS-fallback-bundle parity verification
- `.planning/PROJECT.md` -- release-operator scope (line ~88) excludes macOS code-signing identity acquisition
- `.planning/research/v1.3-terminal-pivot.md` §10.2 Option 3 -- the canonical macOS distribution decision; §1 Distribution bullet (line 21); §8.2 The bin shim (lines 657-684); §11 Phase 19 description (line 897, but superseded by the v1.3 lock)

### Phase 19 Memory
- `~/.claude/projects/-Users-lakshmanturlapati-Documents-Codes-Handoff/memory/v1.3-macos-option-3.md` -- the locked Option 3 decision with full Why + How-to-apply
- `~/.claude/projects/-Users-lakshmanturlapati-Documents-Codes-Handoff/memory/v1.3-planning-decisions-must-land-in-roadmap.md` -- feedback rule about locking research decisions into ROADMAP instead of leaving "both paths planned" language

### Prior Phase Contexts (carry-forward decisions)
- `.planning/phases/15-workspace-scaffold-bun-build-pipeline/15-CONTEXT.md` -- workspace scaffold + bin shim + dual-runtime CI matrix decisions; 3-platform compiled binary set; macOS JS-fallback canonical entrypoint
- `.planning/phases/16-tui-shell-state-machine-sox-mic-capture-energy-vad/16-CONTEXT.md` -- Ink 7 + React 19 + status row + ACC-01/02 (NO_COLOR, INK_SCREEN_READER) decisions; sets the UI surface the ERR-01 banner attaches to
- `.planning/phases/17-end-to-end-voice-loop-gracefulshutdown/17-CONTEXT.md` -- session.ts composition root + sandwich defence + ack/spoken-summary routing + Ctrl-C cancel chain; sets the runtime surface the ERR-03 watchdog respawn integrates with
- `.planning/phases/18-init-wizard-config-transcripts-single-instance-lock/18-CONTEXT.md` -- Phase 18 explicitly deferred SKILL.md edits to Phase 19 (lines 43, 142-143); single-instance lock at `~/.achilles/voice.lock` already in place; structured logger with 7-regex redaction (DEFAULT_REDACT_PATTERNS) exported and ready for ERR-08

### Code Surfaces in Scope
- `apps/achilles-terminal/package.json` -- optionalDependencies update (drop 2 darwin); `bin: { achilles: ./dist/cli.js }` (unchanged); engines field check for Node 22+
- `apps/achilles-terminal/dist/cli.js` -- the published JS-fallback bundle (Phase 15 esbuild output); the `#!/usr/bin/env node` shebang means Node dispatches it on macOS
- `apps/achilles-terminal/src/cli.ts` -- top-level static imports stay `{node:fs/promises, node:url, node:path}` per INIT-07 invariant; any new logic uses dynamic imports inside main()
- `apps/achilles-terminal/src/session.ts` -- composition root for the voice loop; Phase 19 ERR-03 watchdog wraps sox + ffplay child-exit handling here
- `apps/achilles-terminal/src/structured-logger.ts` -- Phase 18 already exports `DEFAULT_REDACT_PATTERNS` (7 regexes including the xi_ 7th); Phase 19 ERR-08 wires unconditional `~/.achilles/achilles.log` writes that consume this surface
- `apps/achilles-terminal/eslint.config.js` -- where the `stdio: "ignore"` forbid rule lands (NOT root)
- `packages/achilles-skill/skill/SKILL.md` -- the full-rewrite target (152 lines currently describing Electron model)
- `packages/achilles-skill/skill/prompts/companion.md` -- LOOP-02 byte-for-byte locked; DO NOT touch in Phase 19
- `apps/achilles/` -- Electron tree, 132 files, deletes in publish-then-cut commit B
- `apps/achilles-cli/src/commands/launch.ts` (179 LOC) + `launch.test.ts` -- deletes in publish-then-cut commit B
- `apps/achilles-cli/src/commands/` -- init.ts, install-skill.ts, latency.ts, transcripts.ts and paired test files are likely all dead post-v1.3; verify reachability before deletion in commit B
- `apps/cli-darwin-arm64/`, `apps/cli-darwin-x64/` -- drop in Phase 19 pre-publish work (NOT in the post-publish cleanup commit)

### Companion Sources of Truth
- `packages/achilles-skill/skill/prompts/companion.md` (LOOP-02 invariant) -- the in-tarball copy must SHA-256-match the in-skill copy per DIST-03; the CI check runs against the new layout

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/achilles-terminal/src/structured-logger.ts`: Phase 18 already exports `DEFAULT_REDACT_PATTERNS` (the 7-regex set). Phase 19 ERR-08's unconditional `~/.achilles/achilles.log` writer reuses this directly; no new redaction pipeline is needed.
- `apps/achilles-terminal/src/session.ts`: Phase 17 wired the EventEmitter + state machine; Phase 18 added `submitTranscript` public method. Phase 19's ERR-01 banner subscribes to the `event` emitter to render banner content on `error` typed events; ERR-03 watchdog subscribes to `process.exit` of sox/ffplay child references already held by the session.
- `apps/achilles-terminal/src/circuit-breaker.ts`: Already exposes `status()` returning `{state: "closed" | "open" | "half-open"}`. ERR-01 banner reads this for the network class transition; Phase 18's typed-input fallback already polls it (composes cleanly).
- v1.2 SHA-256 source-of-truth check script (in `apps/achilles/` or `scripts/` from prior milestone): port to the new layout asserting `companion.md` byte-for-byte equality between `packages/achilles-skill/skill/prompts/companion.md` (in-skill) and the bundled-in-tarball copy. The script logic is invariant; only the paths change.
- v1.2 tarball secret-scan script: ports to the new platform-package tarballs + the parent `achilles` tarball.

### Established Patterns
- TDD RED+GREEN commit pattern (Phases 15-18 all used it): each task is one RED commit (failing test) + one GREEN commit (passing implementation). Phase 19 expectations: SKILL.md rewrite is a docs-only change (no RED/GREEN, but it gets a contract test that the `allowed-tools` frontmatter array matches the expected 8 entries exactly, and a SHA-256 test against companion.md if the bundle path changes).
- Dynamic-import gating in `cli.ts` (Phase 18 INIT-07 invariant): all new subcommand branches use `await import("./xxx.js")` inside main() so the top-level static imports stay locked at `{node:fs/promises, node:url, node:path}`. Phase 19 does not add any new cli.ts subcommands -- the existing 5 (`voice`, `init`, `config`, `transcripts`, `latency`) cover the full surface.
- Test pool `forks` from `vitest.config.ts` (Phase 16): subprocess isolation for tests that spawn child processes. Phase 19's ERR-03 watchdog tests need this.

### Integration Points
- `apps/achilles-terminal/src/session.ts` `event` emitter -- ERR-01 banner subscribes here; ERR-03 watchdog reads sox/ffplay PIDs from session state held here.
- The bin shim in `apps/achilles-terminal/dist/cli.js` (Phase 15 30-line file) -- already implements the optionalDependencies + `existsSync` fallback per §8.2 of the v1.3 pivot. Phase 19 verifies the shim resolves to the JS bundle on darwin (the platform-binary check fails because no darwin sibling installs).
- The unconditional structured logger writer at `~/.achilles/achilles.log` -- subscribes to the same `session.on("event", ...)` surface as the transcript store from Phase 18 SAFE-02; both can attach without contention because the EventEmitter supports multiple listeners.
- GitHub Actions CI matrix from Phase 15: `os: [ubuntu-latest, macos-latest, windows-latest]` with Bun + Node 22 lanes. Phase 19 adds a `publish` job downstream of the existing `build` job; the macos lane in the matrix smokes the JS-fallback bundle (does not publish anything platform-specific).

</code_context>

<specifics>
## Specific Ideas

- The user explicitly chose Option 3 (drop, not no-op shim) on 2026-06-09 -- the simpler path -- citing private scope as the reason squat-defense is unnecessary.
- The user explicitly chose the full SKILL.md rewrite over the literal "one-line diff" wording in the ROADMAP -- the operator-reading-the-manifest argument outweighed the scope-minimalism argument.
- The user explicitly chose the single-cleanup-commit-after-publish-success path -- the simplest mental model.
- The user explicitly chose pre-empt above the status row for ERR-01 -- both error and current state visible during cascading failures.
- The Phase 19 plan must respect the LOOP-02 byte-for-byte invariant on `companion.md` (DIST-03 verifies via SHA-256) and the INIT-07 static-import invariant on `cli.ts` -- both invariants are load-bearing in the current test suite and the plan checker will reject any plan that proposes touching them.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within Phase 19 scope. The 4 areas discussed were all "HOW to implement what's already scoped"; no scope-creep ideas surfaced that needed deferring. Phase 20 (RBS-1/2/3 asciicasts + macOS Sequoia VS Code asciicast + 65 dBA noisy-environment field test + dual-runtime CI final-green) remains in its own scope as already roadmapped.

</deferred>

---

*Phase: 19-distribution-publishing-skill-rewire*
*Context gathered: 2026-06-09*
