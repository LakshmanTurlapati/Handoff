---
phase: 18
slug: init-wizard-config-transcripts-single-instance-lock
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 18 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 |
| Config | `apps/achilles-terminal/vitest.config.ts` |
| Quick run | `npm test --workspace apps/achilles-terminal` |
| Full suite | typecheck + lint + test + MOCK_LOOP integration |

## Per-Task Verification Map

| Task ID | Requirement | Test Type | Automated Command |
|---------|-------------|-----------|-------------------|
| 18-W0 | deps installed | install + smoke | `npm test --workspace apps/achilles-terminal` (309 baseline still pass) |
| 18-apikey | INIT-02, SAFE-01 | unit | `vitest run tests/init/api-key.test.ts` |
| 18-encrypt | SAFE-01 | unit | `vitest run tests/init/encrypted-key.test.ts` (libsodium roundtrip; 0o600 perm enforced) |
| 18-preflight | INIT-03 | unit (mock spawn) | `vitest run tests/init/preflight.test.ts` |
| 18-ambient | INIT-04 | unit | `vitest run tests/init/ambient-calibration.test.ts` |
| 18-parent | INIT-06 | unit (mock process) | `vitest run tests/init/parent-terminal.test.ts` |
| 18-wizard | INIT-01, INIT-05 | unit (mock prompts) | `vitest run tests/init/wizard.test.ts` |
| 18-lock | SAFE-04 | unit | `vitest run tests/lock-file.test.ts` |
| 18-transcripts | SAFE-02 | unit | `vitest run tests/transcripts/store.test.ts tests/transcripts/retention.test.ts` |
| 18-typed | ERR-04 | unit | `vitest run tests/typed-input.test.ts` |
| 18-config | (settings menu) | unit | `vitest run tests/config-menu.test.ts` |
| 18-latency | ERR-07 | unit | `vitest run tests/latency-report.test.ts` |
| 18-cli | INIT-07 preserved | unit + integration | `vitest run tests/cli.test.ts` (existing T1-T9 still pass + new subcommands) |

## Wave 0 Requirements

- [ ] `apps/achilles-terminal/package.json` — ADD `@clack/prompts`, `@napi-rs/keyring`, `libsodium-wrappers-sumo` (or `@stablelib/nacl` — planner picks)
- [ ] All Phase 18 source modules under `apps/achilles-terminal/src/init/`, `apps/achilles-terminal/src/transcripts/`, plus `lock-file.ts`, `typed-input.ts`, `config-menu.ts`, `latency-report.ts`
- [ ] All test files
- [ ] `cli.ts` extended with `init`, `config`, `transcripts`, `latency` subcommands via dynamic-import gates (INIT-07 preserved)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual |
|----------|-------------|------------|
| Full `achilles init` wizard end-to-end | INIT-01..06 | Requires interactive @clack/prompts session + real mic/sox/network — Phase 20 asciicast |
| macOS TCC parent-emulator denial path | INIT-06 | Requires actually denying mic permission in System Settings — Phase 20 |
| Real ElevenLabs API key in OS keychain | INIT-02 | Requires real key + write permission to Keychain — operator |

## Validation Sign-Off

- [ ] All Wave 0 deps installed
- [ ] LOOP-02 invariant: zero diff on packages/voice-*, packages/claude-code-bridge/, packages/achilles-skill/skill/prompts/companion.md
- [ ] No emojis
- [ ] INIT-07 invariant preserved (cli.ts top-level static imports unchanged)
- [ ] MOCK_LOOP integration test still passes
- [ ] `nyquist_compliant: true` set after planner sign-off

**Approval:** pending
