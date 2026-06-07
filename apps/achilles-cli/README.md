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
