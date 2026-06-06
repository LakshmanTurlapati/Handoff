# Phase 12 — Deferred Items

Items discovered during phase execution that are out of scope for the
plan that found them. Logged here per the executor SCOPE BOUNDARY rule.

## Plan 12-03 (renderer audio infrastructure)

### `npm test --workspace apps/achilles` fails for Phase 11 .tsx component tests

**Discovered:** 2026-06-06 during Plan 12-03 verification
**Reproduce:** `npm test --workspace apps/achilles`
**Symptom:** 18 test files fail with `ReferenceError: React is not defined` —
specifically the Phase 11 component test files
(`ReactiveCircle.test.tsx`, `Waveform.test.tsx`, `TranscriptOverlay.test.tsx`,
`FloatingShell.test.tsx`, `SettingsPopover.test.tsx`,
`PermissionOverlay.test.tsx`, `ErrorBanner.test.tsx`, `DragHandle.test.tsx`,
`App.test.tsx`, and the React-imports in their setup chain). The error
surfaces because the workspace-script's `vitest run` does not pick up the
root `vitest.workspace.ts` config — which is where the
`esbuild: { jsx: 'automatic', jsxImportSource: 'react' }` lives that
wires the JSX automatic runtime.

**Verified pre-existing:** A `git stash -u` of the Plan 12-03 changes
followed by `npm test --workspace apps/achilles` reproduces the same
failures from base commit `6f66ee5` (Plan 12-02 head). This is NOT
caused by Plan 12-03.

**Workaround used during Plan 12-03 verification:**
`npx vitest run --project phase-11-unit` passes 347/347 tests because it
uses the workspace config from the repo root, which applies the JSX
runtime transform. Plan 12-03's own verification commands are
`npx vitest run --project phase-12-unit ...` per the plan's
`<verify>` block, and those pass clean.

**Likely fix:** Either (a) add a thin `apps/achilles/vitest.config.ts`
that mirrors the root workspace's esbuild block, or (b) update
`apps/achilles/package.json`'s `test` script to point at the workspace
config explicitly (`vitest run --workspace ../../vitest.workspace.ts`).
Either is a one-line change but introducing it in Plan 12-03 would
expand scope into Plan 11 hygiene.

**Owner:** Plan 12-04 (orchestrator) is the natural place to address
this since 12-04 also extends the renderer composition root and will
exercise the same JSX path.
