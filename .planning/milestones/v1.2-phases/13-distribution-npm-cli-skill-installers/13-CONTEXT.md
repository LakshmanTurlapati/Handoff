# Phase 13: Distribution - npm CLI + Skill + Installers - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (auto-optimized) — infrastructure-heavy phase with one UI surface (init wizard)

<domain>
## Phase Boundary

Phase 13 turns the v1.2 working loop (Phase 09 + 10 + 11 + 12) into something a user can install. Three distribution surfaces from ONE source of truth:

1. **`achilles` npm CLI** — `npm install -g achilles` provides the `achilles` command (launch the app), `achilles install-skill` (symlink the skill body into `~/.claude/skills/achilles/`), `achilles init` (first-run wizard), `achilles transcripts purge` (Phase 14 deferred stub here)
2. **Claude Code skill** — `~/.claude/skills/achilles/SKILL.md` plus the `prompts/companion.md` source-of-truth from Phase 12
3. **Signed cross-platform installers** — `.dmg` (macOS, hardened-runtime + notarised + `NSMicrophoneUsageDescription`), `.exe` (NSIS, Windows), `.AppImage` (Linux)

All three ship from one build pipeline. Phase 13 owns:

- `apps/achilles-cli` — the npm package + bin entrypoint
- `apps/achilles/electron-builder.json` — cross-platform installer config
- `packages/achilles-skill/SKILL.md` — finalised skill body (Phase 12 shipped the `prompts/companion.md`; Phase 13 wraps it with the discovery markdown)
- `apps/achilles/init` wizard — first-run flow (API key entry, mic permission, smoke round-trip)
- Build/release pipeline hooks in `package.json` scripts
- CI drift check: skill body + CLI bundled prompt are byte-identical (consume the same `packages/achilles-skill/skill/prompts/companion.md`)
- Tarball scan at release time: grep for ElevenLabs key prefix returns empty

Out of scope for Phase 13:
- Real ElevenLabs / Claude API in CI integration tests (Phase 14 hardening probe owns live validation)
- Latency probe `--debug` mode (Phase 14)
- Opt-in `--save-transcripts` flag and `transcripts purge` actual implementation (Phase 14 — Phase 13 ships the subcommand stub only)
- Stuck-thinking timeout (Phase 14)
- Suspend/resume + device-change recovery (Phase 14)
- Code-signing identity acquisition (logged as a release blocker; the build pipeline reads identities from env vars `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD` per electron-builder convention — Phase 13 documents the env vars; cert acquisition is owned by a human release operator)

</domain>

<decisions>
## Implementation Decisions

### Locked by REQUIREMENTS.md (do not reopen)
- Distribution targets: macOS (.dmg), Windows (.exe NSIS), Linux (.AppImage) — DIST-05
- One source of truth: skill body and CLI bin both reference the same `packages/achilles-skill/skill/prompts/companion.md` — DIST-03
- `achilles install-skill` symlinks into `~/.claude/skills/achilles/` — DIST-02
- First-run wizard: API key, mic permission, smoke round-trip — DIST-04
- `npm install -g achilles` succeeds on fresh macOS / Windows / Linux — DIST-01

### Package layout
- New `apps/achilles-cli` — published npm package
  - `apps/achilles-cli/package.json` — `name: "achilles"`, `bin: { achilles: "./dist/cli.js" }`, `publishConfig.access: "public"`, `files: ["dist", "skill"]`
  - `apps/achilles-cli/src/cli.ts` — commander.js-based CLI entrypoint
  - `apps/achilles-cli/src/commands/launch.ts` — locates the bundled Electron binary, execs it
  - `apps/achilles-cli/src/commands/install-skill.ts` — symlink skill body into `~/.claude/skills/achilles/`
  - `apps/achilles-cli/src/commands/init.ts` — first-run wizard orchestration (delegates to Electron host for the UI portion)
  - `apps/achilles-cli/src/commands/transcripts.ts` — `transcripts purge` subcommand stub (Phase 14 implements full)
  - At publish time, the tarball includes `dist/` + `skill/` (the latter is a symlink-resolved copy of `packages/achilles-skill/skill/`)

- Modify `packages/achilles-skill`:
  - Add `packages/achilles-skill/SKILL.md` — the skill body Claude Code reads to discover Achilles
  - Already shipped: `packages/achilles-skill/skill/prompts/companion.md` (Phase 12)
  - SKILL.md content:
    - Frontmatter with name, description, when_to_use
    - Body explaining: invocation, system requirements, prerequisites (npm install -g achilles), trigger to launch
    - References `prompts/companion.md` as the embedded system prompt source
  - Mark `packages/achilles-skill/package.json` as still private; the SKILL.md is consumed by the CLI tarball at publish time (NOT by the npm registry)

- Modify `apps/achilles`:
  - Add `apps/achilles/electron-builder.json` — cross-platform installer config
  - Add `apps/achilles/build/entitlements.mac.plist` — `com.apple.security.device.audio-input` for the mic
  - Add `apps/achilles/build/Info.plist.fragment` — `NSMicrophoneUsageDescription` text
  - Add `apps/achilles/src/main/init-wizard.ts` — main-side init wizard orchestration (driven by `achilles init` from the CLI)

### Init wizard UX (DIST-04)
- Triggered by `achilles init` from the CLI (or first launch of the Electron app with no API key configured)
- Three-step flow:
  1. **API key entry** — prompts in a small modal: "Paste your ElevenLabs API key" — input field + masked display + validation (length >= 32, prefix `sk_` or similar; Phase 09 fixed MIN_KEY_LENGTH to 32). Stored via electron-store + safeStorage.
  2. **Mic permission** — main calls `systemPreferences.askForMediaAccess('microphone')` (Phase 11 already wired); modal updates with the result; if denied, deep-link to System Settings.
  3. **Smoke round-trip** — small "Say something" prompt; mic captures 2-second utterance; full loop runs (STT -> Claude -> TTS); user hears Claude say "Hello from Achilles, I'm ready to help." (a fixed prompt that doesn't need a real task to complete); wizard exits.
- Wizard UI lives in the existing Phase 11 Electron app (reuse the SettingsPopover pattern for a new InitWizard child window) — NO new Electron app
- The CLI's `achilles init` simply launches the Electron app with `ACHILLES_MODE=init` env var; the app routes to the wizard component on start

### CLI architecture (DIST-01)
- `commander@13` for command parsing (small, well-maintained)
- Top-level commands:
  - `achilles` (no args) — launches the floating UI; equivalent to `achilles launch`
  - `achilles launch` — explicit launch
  - `achilles install-skill` — symlink skill into ~/.claude/skills/achilles/
  - `achilles init` — run first-run wizard
  - `achilles transcripts purge` — Phase 14 stub; logs "not yet implemented" + exits 0
  - `achilles --version` / `--help` — standard
- Locates the bundled Electron binary by:
  - Reading `dist/electron-binary-path.json` (written at publish time by the build script)
  - On Linux/macOS: `./dist/Achilles.app/Contents/MacOS/Achilles` (mac) or `./dist/linux/achilles` (linux)
  - On Windows: `./dist/Achilles.exe`
  - Spawn detached child so the CLI exits and the GUI stays running
- The CLI bundle is tiny (~50 KB after tree-shaking); the heavy lifting is the Electron app

### Skill install (DIST-02)
- `achilles install-skill` workflow:
  1. Locate the source skill body inside the installed npm package (under `node_modules/achilles/skill/`)
  2. Locate Claude Code skills directory: `${process.env.HOME}/.claude/skills/achilles/` (macOS/Linux); `%USERPROFILE%\.claude\skills\achilles\` (Windows)
  3. If destination exists, prompt user before overwriting (or `--force` flag bypasses)
  4. Create symlink: `~/.claude/skills/achilles -> /path/to/node_modules/achilles/skill`
  5. On Windows, symlink may require admin privileges — fall back to copy with warning
  6. Print success message + reminder "restart Claude Code to discover the skill"

### Cross-platform installers (DIST-05)
- `electron-builder.json` config:
  - `appId: "com.achilles.voice"`, `productName: "Achilles"`
  - `mac.target: "dmg"`, `mac.category: "public.app-category.developer-tools"`, `mac.hardenedRuntime: true`, `mac.notarize: true` (reads creds from env), `mac.entitlements: "build/entitlements.mac.plist"`
  - `win.target: "nsis"`, `win.icon: "build/icon.ico"`, signing via `CSC_LINK` env var
  - `linux.target: "AppImage"`, `linux.category: "Development"`
  - `directories.output: "dist-installers"`
- Build scripts:
  - `npm run dist` — runs electron-builder for the host OS
  - `npm run dist:all` — cross-platform via electron-builder's cross-build support (mac only builds mac; need CI with each OS for full coverage; document in README)
- CI hook (documentation only — actual CI infra is a v1.3 follow-up):
  - On a tagged release, GitHub Actions matrix builds mac/win/linux installers and uploads to a release page

### Source-of-truth diff check (DIST-03)
- CI step (defined in package.json scripts, runs in npm test):
  - `npm run check:source-of-truth` — verifies:
    - `packages/achilles-skill/SKILL.md` is referenced from the CLI's bin entrypoint
    - The companion.md path resolved by the CLI's published tarball is byte-identical to `packages/achilles-skill/skill/prompts/companion.md`
    - The version in `apps/achilles-cli/package.json` matches the version in `apps/achilles/package.json`
  - Implemented as a small script in `apps/achilles-cli/scripts/check-source-of-truth.mjs`
- Fails the build if any check fails

### Tarball scan at release (DIST-03 + SAFE-01)
- `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs`:
  - Pack the tarball locally (`npm pack`)
  - Grep for `xi-api-key`, `sk-`, `ghp_`, `github_pat_`, `ELEVENLABS_API_KEY`
  - Fail if any match outside of allowlisted documentation comments
- Run on `npm prepublish` and in CI

### Persistence Phase 14 deferred stubs
- `transcripts` subcommand exits 0 with "not yet implemented" copy
- `--save-transcripts` flag accepted but ignored in the CLI (logged as future feature)

### Documentation
- `apps/achilles-cli/README.md` — npm package README (user-facing install + commands)
- Update repo top-level `README.md` — point to Achilles in addition to the existing Handoff sections

### Testing strategy
- Vitest unit tests for: each CLI command, the source-of-truth check, the tarball scan, the symlink/copy logic with mocked filesystem
- Integration test under `ACHILLES_FRESH_INSTALL=1`: simulate a fresh `npm install -g achilles` in a temp directory; assert `achilles install-skill` produces the symlink; clean up
- NO real electron-builder build in CI by default (slow + needs OS-specific build tooling); a `--build-installers` opt-in flag triggers it locally
- NO real Electron app launch in CI (per CLAUDE.md global)
- NO publishing to npm registry in CI (require explicit `--publish` flag + valid `NPM_TOKEN`)

### Build pipeline
- Add `apps/achilles-cli/tsconfig.json` extending base
- Add `apps/achilles-cli/src/.gitignore` (CR-07 hygiene)
- Add `apps/achilles-cli/package.json` scripts: `build`, `typecheck`, `test`, `dist`, `dist:mac`, `dist:win`, `dist:linux`, `prepublishOnly`
- Update top-level `package.json` workspaces (already covered by `apps/*` glob)
- Update top-level scripts to include the new app

### NO emojis (CLAUDE.md global)
### NO real Electron launch in CI (CLAUDE.md global)
### NO live ElevenLabs / Claude in CI

### Claude's Discretion
- File partitioning inside `apps/achilles-cli/src/` (single cli.ts vs split by command)
- Exact wizard UI styling (matches Phase 11 design system; respects 5-state + tokens)
- Error message phrasing for CLI failure paths

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/achilles-skill` (Phase 12) — companion.md source of truth
- `apps/achilles` (Phase 11 + 12) — Electron app with init-wizard hook point
- `apps/achilles/src/main/init-wizard.ts` (NEW in Phase 13)
- `apps/achilles/src/main/store.ts` (Phase 11 + 12 extended) — elevenlabsApiKey accessor
- Phase 11's `SettingsPopover` pattern — child BrowserWindow with parent-anchored position; pattern reused for the init wizard

### Established Patterns
- All Phase 09-12 conventions: kebab-case, camelCase, named exports, NodeNext .js, Zod runtime validation, tsconfig excludes test files, src/.gitignore defensive guards
- Phase 12's MOCK_LOOP=1 environment-gated integration test pattern — reuse for Phase 13's ACHILLES_FRESH_INSTALL=1
- Phase 11's IPC channel pattern — extend for `init-wizard-*` channels

### Integration Points (downstream phase)
- Phase 14 (Hardening) consumes the CLI's `transcripts purge` stub (Phase 14 implements full); the `--debug` mode is added to `achilles launch`; the latency probe surface is wired into the existing IPC bridge

### Files to Create (new)
- `apps/achilles-cli/package.json`
- `apps/achilles-cli/tsconfig.json`
- `apps/achilles-cli/src/.gitignore`
- `apps/achilles-cli/src/cli.ts`
- `apps/achilles-cli/src/commands/{launch,install-skill,init,transcripts}.ts`
- `apps/achilles-cli/src/electron-binary-locator.ts`
- `apps/achilles-cli/src/skill-symlink.ts`
- `apps/achilles-cli/src/test-tarball.ts` (test helper)
- `apps/achilles-cli/scripts/check-source-of-truth.mjs`
- `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs`
- `apps/achilles-cli/README.md`
- `apps/achilles/electron-builder.json`
- `apps/achilles/build/entitlements.mac.plist`
- `apps/achilles/build/Info.plist.fragment`
- `apps/achilles/src/main/init-wizard.ts`
- `apps/achilles/src/renderer/components/InitWizard.tsx`
- `packages/achilles-skill/SKILL.md`

### Files to Modify
- `apps/achilles/package.json` — add electron-builder config reference; add `dist:*` scripts
- `apps/achilles/src/main/index.ts` — handle `ACHILLES_MODE=init` env var to route to init wizard
- `tsconfig.base.json` — add `apps/achilles-cli` aliases (or it works without if commander is the only external dep)
- `vitest.workspace.ts` — add `phase-13-unit` project
- Top-level `package.json` — `npm run check:source-of-truth` script
- Top-level `README.md` — Achilles section

</code_context>

<specifics>
## Specific Ideas

- The CLI bundle must be small (npm registry-friendly). Use `tsup` or plain `tsc` + treeshaking; `commander` is the only heavy external dep.
- The skill body (SKILL.md) is what Claude Code reads to discover the skill. It must be discoverable, brief (<= 2000 words per CONTEXT-style guidance), and explain when Achilles is appropriate.
- The init wizard's "smoke round-trip" can use the existing MOCK_LOOP=1 fakes for offline first-run; default to a real ElevenLabs round-trip if the key validates; document the offline path in README.
- `electron-builder` is a substantial dep; install it as a `devDependency` in `apps/achilles`, NOT in the CLI package (the CLI doesn't build installers, the Electron app does).

</specifics>

<deferred>
## Deferred Ideas

- Real CI matrix for cross-platform installers (v1.3)
- Auto-update path (electron-updater) — v1.3
- Signed npm package (npm provenance) — v1.3
- Multi-user / per-machine install — v2+
- `transcripts purge` actual implementation — Phase 14
- `--debug` mode latency probe — Phase 14
- `--save-transcripts` actual implementation — Phase 14
- Stuck-thinking timeout / graceful degradation / device-change resilience — Phase 14

</deferred>
