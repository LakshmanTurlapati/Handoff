# Phase 09 Deferred Items

Pre-existing issues discovered while executing Phase 09 plans but out of scope per the deviation-rules scope boundary. These are NOT regressions introduced by Phase 09 — they predate the phase.

## Discovered during 09-03 execution (2026-06-06)

### apps/web — TS17004 "Cannot use JSX unless the '--jsx' flag is provided"

Root `npm run typecheck` reports dozens of JSX errors in `apps/web/components/session/*.tsx`, `apps/web/components/device/*.tsx`, and `apps/web/tests/unit/*.test.tsx`. Cause: the root `tsconfig.base.json` does not set `jsx`, and `apps/web` does not have a workspace-level typecheck script that points at its own (Next.js-managed) tsconfig with JSX enabled.

These are NOT in Phase 09 scope (Phase 09 is voice wrappers under `packages/voice-*`). The root typecheck regression is independent of voice-tts; running `npm run typecheck --workspace @achilles/voice-tts` exits 0 cleanly.

Recommend a future hygiene phase to either:
1. Add `"jsx": "preserve"` to `tsconfig.base.json` (Next.js default), or
2. Carve `apps/web` out of the root typecheck pass and rely on its own pipeline (Next.js' built-in TS check).

### apps/web — TS2352 in `tests/auth-pairing.spec.ts`

`apps/web/tests/auth-pairing.spec.ts(138,13): error TS2352: Conversion of type 'ConfirmPairingResult' to type 'Record<string, unknown>' may be a mistake`. Pre-existing; not introduced by Phase 09.

### vitest.workspace.ts — TS2353 `passWithNoTests` unknown property

`vitest.workspace.ts` declares `passWithNoTests: true` on its project configs but `defineWorkspace`'s `ProjectConfig` type does not include it. The flag still works at runtime (vitest accepts it via test config), so the regression is purely at the type level. Pre-existing (added in commit `b024d3e` for Plan 09-01 — actually, the vitest.workspace.ts plumbing predates Plan 09-01's changes to add the `phase-09-unit` project; the property was unknown for the earlier projects too).

Recommend reviewing whether `passWithNoTests` should live under `test:` or directly on the project (vitest changed the API in 2.x).
