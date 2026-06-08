---
phase: 17
slug: end-to-end-voice-loop-gracefulshutdown
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 17 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (Phase 15 baseline) |
| Config | `apps/achilles-terminal/vitest.config.ts` (`pool: "forks"`) |
| Quick run | `npm test --workspace apps/achilles-terminal` |
| MOCK_LOOP gate | `MOCK_LOOP=1 npm test --workspace apps/achilles-terminal -- tests/integration/mock-loop.test.ts` |
| Full suite | typecheck + lint + `MOCK_LOOP=1 vitest run` |
| Estimated runtime | ~10-15s including MOCK_LOOP integration |

## Sampling Rate

- Per task commit: `npm test --workspace apps/achilles-terminal`
- Per wave: typecheck + lint + full vitest including MOCK_LOOP
- Phase gate: MOCK_LOOP=1 integration test passes; CI matrix from Phase 15 runs the same gate under both Bun and Node

## Per-Task Verification Map

| Task ID | Requirement | Test Type | Automated Command |
|---------|-------------|-----------|-------------------|
| 17-W0 | LOOP-02 wiring | install + smoke | `npm test --workspace apps/achilles-terminal` (Phase 15 + 16 tests still pass; new workspace deps resolve) |
| 17-tts | PLAY-01, PLAY-02 | unit + integration | `vitest run tests/audio/tts-playback.test.ts` |
| 17-stt | LOOP-01 stt half | unit | `vitest run tests/audio/stt-bridge.test.ts` |
| 17-claude | LOOP-01 claude half, LOOP-03, LOOP-04, LOOP-07 | unit + integration | `vitest run tests/audio/claude-bridge.test.ts` |
| 17-shutdown | LOOP-05 | integration | `vitest run tests/graceful-shutdown.test.ts` |
| 17-circuit | ERR-02 | unit | `vitest run tests/circuit-breaker.test.ts` |
| 17-thinking | ERR-05 | unit | `vitest run tests/stuck-thinking-watchdog.test.ts` |
| 17-childexit | ERR-03, ERR-06 | unit | `vitest run tests/child-exit-watchdog.test.ts` |
| 17-logger | ERR-08 | unit | `vitest run tests/structured-logger.test.ts` |
| 17-resume | LOOP-06 | unit + integration | `vitest run tests/resume-session.test.ts` |
| 17-mockloop | LOOP-01 end-to-end | integration | `MOCK_LOOP=1 vitest run tests/integration/mock-loop.test.ts` |
| 17-debug | ERR-07 | unit + cli | `vitest run tests/cli.test.ts -t "--debug"` + `vitest run tests/cli.test.ts -t "latency report"` |

## Wave 0 Requirements

- [ ] `apps/achilles-terminal/package.json` — ADD workspace-internal dependencies: `@achilles/voice-protocol`, `@achilles/voice-stt`, `@achilles/voice-tts`, `@achilles/claude-code-bridge` (workspace:* or version pin matching their package.jsons)
- [ ] New source files under `apps/achilles-terminal/src/`: `session.ts`, `session-events.ts`, `runVoice.ts`, `audio/tts-playback.ts`, `audio/stt-bridge.ts`, `audio/claude-bridge.ts`, `audio/companion-md.ts`, `graceful-shutdown.ts`, `circuit-breaker.ts`, `stuck-thinking-watchdog.ts`, `child-exit-watchdog.ts`, `structured-logger.ts`, `resume-session.ts`
- [ ] New test files under `apps/achilles-terminal/tests/`: per-module unit tests + `tests/integration/mock-loop.test.ts` (the CI gate)
- [ ] `.github/workflows/achilles-terminal-ci.yml` (Phase 15 file) — ADD `MOCK_LOOP=1` integration test step to test matrix entries
- [ ] CI: ADD SHA-256 source-of-truth check on `packages/achilles-skill/skill/prompts/companion.md` (LOOP-02 invariant verifier — port from v1.2 if it lives there; otherwise re-author)
- [ ] LOOP-02 grep gate in CI: `git diff --name-only HEAD^ HEAD packages/voice-*/ packages/claude-code-bridge/ packages/achilles-skill/skill/prompts/companion.md` returns empty for any Phase 17 commit

## Manual-Only Verifications

| Behavior | Requirement | Why Manual |
|----------|-------------|------------|
| Real ElevenLabs WSS round-trip | LOOP-01 against real network | Requires ELEVENLABS_API_KEY + quiet room; Phase 20 asciicast capture |
| Real claude subprocess + sandwich-wrap end-to-end | LOOP-01 against real Claude Code installation | Requires installed claude CLI; Phase 20 asciicast |
| Suspend/resume + device hot-swap | ERR-06 | Requires physical mac with mic disconnect; Phase 20 |
| Ctrl-C cancel chain in <1.5s against real binary | LOOP-05 | MOCK_LOOP test verifies the chain logically; real-binary timing measured in Phase 20 |

## Validation Sign-Off

- [ ] All Wave 0 deps installed; existing 129 tests still pass after the workspace-internal voice deps are added
- [ ] MOCK_LOOP=1 integration test exists AND passes
- [ ] LOOP-02 invariant: `git diff packages/voice-*/ packages/claude-code-bridge/ packages/achilles-skill/skill/prompts/companion.md` is empty for the entire Phase 17 commit range
- [ ] No emojis
- [ ] `nyquist_compliant: true` set after planner sign-off

**Approval:** pending
