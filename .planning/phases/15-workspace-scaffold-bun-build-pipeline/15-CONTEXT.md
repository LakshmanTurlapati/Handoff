# Phase 15: Workspace Scaffold + Bun Build Pipeline - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per smart-discuss infrastructure detection)

<domain>
## Phase Boundary

Stand up the new `apps/achilles-terminal` workspace + 5 platform-binary sibling packages with a working `bun build --compile` cross-target matrix and a dual-runtime CI matrix (Bun + Node 22) so every subsequent phase catches runtime drift at the boundary it was introduced.

Inside scope:
- New `apps/achilles-terminal/` workspace (Bun-runtime ESM TypeScript) with `bin: { achilles: ./dist/cli.js }` field
- Five new `apps/cli-<platform>-<arch>/` sibling packages for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`
- `bun build --compile --target=bun-{darwin,linux,windows}-{x64,arm64}` cross-target matrix that produces self-contained binaries
- 30-line ESM JS bin shim that resolves the platform binary via `import.meta.resolve` or directory join; falls back to a Node 22 esbuild bundle when no platform binary matches
- `optionalDependencies` wire-up in the parent `achilles` package.json with `os`/`cpu` filters per sibling package
- Dual-runtime CI matrix (Bun 1.3+ AND Node 22+) running the existing vitest suite green for the seed test cases that exist in this phase
- `achilles --version` argv-parse-before-pipeline-boot path that works without API key/sox/ffmpeg on all 5 platforms (INIT-07)
- Cold-start latency probe demonstrating <50ms native / <200ms JS fallback (DIST-05 baseline measurement)
- ESLint config baseline for the new workspace (the `stdio:"ignore"` forbid rule lands later in Phase 19)

Outside scope (defer to later v1.3 phases):
- Actual TUI rendering (Phase 16)
- sox / ffplay / VAD wiring (Phase 16/17)
- voice-stt / voice-tts / claude-code-bridge integration (Phase 17)
- Init wizard (Phase 18)
- npm publish / Gatekeeper / signing (Phase 19)
- Real-binary asciicast evidence (Phase 20)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase per smart-discuss infrastructure detection. Use ROADMAP phase goal, success criteria, and the locked architecture from `.planning/research/v1.3-terminal-pivot.md` + `.planning/research/STACK.md` + `.planning/research/ARCHITECTURE.md` to guide decisions.

### Pre-locked architecture (from research, NOT grey areas)
- Runtime: Bun 1.3.14+ primary, Node 22 LTS fallback (STACK.md HIGH-confidence pick)
- TypeScript: ESM-only with NodeNext module resolution + `.js` import specifiers
- Workspace tooling: existing npm workspaces (no migration to pnpm/bun workspaces — additional risk for no v1.3 benefit)
- Test runner: vitest under both Bun and Node (defer Bun's `bun test` to v1.4)
- Build tooling: `tsc` for typecheck + `bun build` for compile-binary + `esbuild` for Node-fallback bundle
- Bin shim layout: per ARCHITECTURE.md — ESM JS file at `dist/cli.js`, resolves `@achilles/cli-<platform>-<arch>` via `import.meta.resolve`, spawns it or falls through to Node bundle
- New workspace path: `apps/achilles-terminal/` (NOT `apps/achilles` to avoid colliding with the soon-to-be-deleted Electron app; both coexist until Phase 19 publish-then-cut)

### LOOP-02 constraint (carried as project invariant)
- `packages/voice-protocol`, `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge` MUST stay byte-for-byte unchanged across the entire milestone. Phase 15 must not touch them.
- `packages/achilles-skill/skill/prompts/companion.md` stays byte-for-byte identical. Phase 15 must not touch it.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/voice-protocol`, `packages/voice-stt`, `packages/voice-tts`, `packages/claude-code-bridge` — survive untouched (research-confirmed). Phase 15 does NOT import them yet; that's Phase 17. But the new workspace must be able to depend on them via workspace protocol (`"workspace:*"` or `"@achilles/voice-protocol": "*"`).
- `packages/achilles-skill/skill/prompts/companion.md` — byte-for-byte preserved.
- Root `package.json` workspace globs already cover `apps/*` and `packages/*`.

### Established Patterns
- npm workspaces, TypeScript strict, ESM with `.js` import specifiers, vitest for unit tests, NodeNext module resolution. The new workspace mirrors these conventions.
- `apps/achilles-cli/package.json` has the existing `bin` field pattern (`"bin": { "achilles": "dist/cli.js" }`) that the new package picks up — though the CLI logic itself MIGRATES (the existing launcher dies in Phase 19 alongside the Electron app).

### Integration Points
- Root `package.json` workspaces array — already includes `apps/*`. New workspace `apps/achilles-terminal` and the 5 platform-binary `apps/cli-<platform>-<arch>` packages are picked up automatically.
- CI workflow (`.github/workflows/*.yml`) — new dual-runtime matrix lives alongside existing v1.2 workflows; do not delete existing workflows (they validate the surviving packages).
- The existing `apps/achilles-cli` workspace stays alive through Phase 18 so its `init.ts`, `install-skill.ts`, `transcripts.ts`, `latency.ts` command logic can be ported into the new workspace before deletion. Phase 15 does NOT migrate any of those — that's Phase 18.

</code_context>

<specifics>
## Specific Ideas

- The 30-line JS bin shim should be small enough to read in one screen. Per ARCHITECTURE.md: resolve `@achilles/cli-${process.platform}-${process.arch}` via `import.meta.resolve`; if that throws (package not installed, e.g. on an unsupported platform OR if a JS-only beta build), fall through to running the Node 22 esbuild bundle at `dist/cli-node.js`. Use `Bun.spawn` if running under Bun, `child_process.spawn` if running under Node.
- The cold-start latency probe is just a `console.time/timeEnd` wrapper around `argv parse → require/import deps → print version`. It does NOT depend on the full pipeline being implemented yet. Result is committed to `~/.achilles/latency/` JSON during the smoke test; for Phase 15 the probe output is captured manually and pasted into the SUMMARY.md.
- Dual-runtime CI matrix scope: a seed `cli.test.ts` that asserts `achilles --version` prints a version string, no API key required. That's the entire test surface for Phase 15. Real voice-loop tests come in Phase 17 (MOCK_LOOP gate).
- Optional ESLint rules: just establish the workspace's eslintrc baseline (typescript-eslint recommended + prettier disable conflicts). The `stdio:"ignore"` forbid rule is a Phase 19 concern.

</specifics>

<deferred>
## Deferred Ideas

- Migrating away from npm workspaces — out of scope for v1.3; current pattern works
- Bun's native `bun test` runner — deferred to v1.4 (would require fixture rewrites for no v1.3 benefit)
- `apps/cli-<platform>-<arch>` directory naming vs `packages/cli-<platform>-<arch>` — research recommendation is `apps/` (distribution artifacts, not libraries); coin-flip but locked here for consistency
- Pre-publish dry runs to verify npm tarball contents — handled in Phase 19 alongside the actual publish

</deferred>
