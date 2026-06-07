# achilles

Voice companion for Claude Code. Achilles opens a small floating window on your desktop, listens through your microphone, hands the transcript to a local `claude` subprocess, and speaks back the result. The npm package below is the cross-platform launcher and skill installer; the Electron app body ships from the same release.

## Install

```bash
npm install -g achilles
```

After install, the `achilles` command is on your `PATH`. No admin elevation is required on macOS, Windows (npm 9+), or Linux.

## Commands

- `achilles` — alias for `achilles launch`; opens the floating voice UI from the current terminal and exits cleanly so the GUI keeps running.
- `achilles launch` — explicit launch of the floating voice UI.
- `achilles install-skill` — install the Achilles Claude Code skill into `~/.claude/skills/achilles/` so Claude Code discovers it on next start. The command symlinks the skill body shipped inside the npm tarball directly into the user's Claude Code skills directory so any future update to the embedded prompt at `prompts/companion.md` is picked up the next time Claude Code restarts. Pass `--force` to overwrite an existing destination (useful when migrating from a hand-edited local skill or recovering from a partially-failed install). On Windows, symlink creation may require admin privileges or Developer Mode; if `fs.symlinkSync` returns EPERM the command falls back to a recursive copy with a clear warning so the install still completes. The destination is computed from `os.homedir()` and never reads `HOME` or `USERPROFILE` directly.
- `achilles init` — run the first-run wizard (ElevenLabs API key entry, microphone permission, end-to-end smoke round-trip). (Plan 13-03 wires the real implementation; this release ships the command surface.)
- `achilles transcripts purge` — placeholder for the Phase 14 hardening release. The command exits 0 with a clear "not yet implemented" message and performs no filesystem mutation. The full implementation ships in Phase 14 alongside `--save-transcripts`.

Run `achilles --help` for a full list and `achilles --version` for the installed version.

## Privacy

The ElevenLabs API key is stored only in the main-process OS keystore (macOS Keychain / Windows DPAPI / libsecret on Linux). The key never appears in the renderer, the npm tarball, IPC traffic, or local logs. Outbound network is restricted to ElevenLabs endpoints and the local `claude` subprocess; no audio or transcript content leaves your machine except to ElevenLabs. See REQUIREMENTS.md SAFE-01 and SAFE-03 for the full privacy contract.

## Release verification

Two automated gates run before `npm publish` is allowed to upload a tarball. The chain is wired into the `prepublishOnly` script in this package's `package.json`, so any operator running `npm publish` triggers both gates in order. Either non-zero exit aborts the publish.

- `node scripts/check-source-of-truth.mjs` — verifies that the bundled `@achilles/achilles-skill` companion prompt inside the tarball is byte-identical to `packages/achilles-skill/skill/prompts/companion.md` in the workspace (closes Pitfall #12 — dual-distribution drift between the npm CLI and the Claude Code skill body). Also verifies that the `version` field in `apps/achilles-cli/package.json` matches the `version` field in `apps/achilles/package.json` (the two consumer surfaces stay pinned). Exit 0 on byte-equality + version match; exit 1 on either mismatch.
- `node scripts/check-tarball-no-secrets.mjs` — packs the achilles-cli into a temporary tarball via `npm pack --dry-run --json`, extracts it, walks the extracted tree, and applies a fixed set of regex patterns to every scannable file (ElevenLabs `sk_`, `xi-api-key:`, `ELEVENLABS_API_KEY=<value>`, Anthropic `sk-`, GitHub `ghp_` / `github_pat_`). The implicit allowlist is encoded in the regex: the bare environment-variable NAME `ELEVENLABS_API_KEY` mentioned in prose without a value cannot match (the assignment regex requires `{16,}` characters after `=`). Exit 0 on clean scan; exit 1 if any pattern matches outside the allowlist. The leak log truncates the matched substring to its first eight characters so the CI artefact does not itself become a leak.

You can run either gate manually from the repo root:

```bash
npm run check:source-of-truth
npm run check:tarball:secrets
npm run check:dist            # both, in order
```

The `check:dist` composite chain is the recommended pre-release smoke test.
