# Deferred Items — Phase 17

Items discovered during execution that are out of scope for the current plan.

## Pre-existing lint errors (Plan 17-01 deliverables)

Discovered during Plan 17-03 Task 1 verify. Lint errors live in files from Plan 17-01,
not in Plan 17-03 files. Out of scope per executor scope boundary rule.

- `apps/achilles-terminal/src/circuit-breaker.ts` — 1 warning (unused eslint-disable), 8 errors (no-unnecessary-type-assertion)
- `apps/achilles-terminal/tests/circuit-breaker.test.ts` — async-arrow-no-await errors (~25)
- `apps/achilles-terminal/tests/structured-logger.test.ts` — no-unsafe-* errors

Tracked here for follow-up; ports passed strict typecheck.
