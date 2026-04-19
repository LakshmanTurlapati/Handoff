---
phase: 07-codex-native-handoff-command
plan: 03
subsystem: security
tags: [handoff, auth, safety, vitest, nextjs]
requires:
  - phase: 07-01
    provides: packaged `/handoff` command copy and installer path
  - phase: 07-02
    provides: hosted handoff route, shared schemas, and local `codex-handoff` helper
provides:
  - fail-closed `/handoff` guidance and terminal error handling
  - hosted authorization checks for revoked, expired, and mismatched handoff state
  - regression coverage for no-picker fallback and cross-thread non-reuse
affects: [08-hosted-launch-active-session-handoff]
tech-stack:
  added: []
  patterns:
    - hosted handoff routes map trust failures to explicit domain error codes instead of generic HTTP failures
    - local Codex command helpers return exact failure codes plus repair guidance without falling back to session selection
key-files:
  created:
    - apps/bridge/tests/unit/codex-handoff-safety.test.ts
    - .planning/phases/07-codex-native-handoff-command/07-03-SUMMARY.md
  modified:
    - apps/bridge/resources/codex/commands/handoff.md
    - apps/bridge/src/cli/codex-handoff.ts
    - apps/bridge/src/cli.ts
    - apps/bridge/src/lib/pairing-client.ts
    - apps/web/app/api/handoffs/route.ts
    - apps/web/lib/live-session/server.ts
    - apps/web/tests/unit/handoff-route.test.ts
key-decisions:
  - "Bridge-installation validation now lives in `apps/web/lib/live-session/server.ts` so the handoff route uses the same durable trust seam as the rest of the hosted control surface."
  - "The local helper keeps exact error codes (`handoff_not_authorized`, `handoff_revoked`, `handoff_expired`) distinct and attaches repair guidance instead of attempting recovery through a picker."
patterns-established:
  - "Fail-closed handoff flows treat revoked or mismatched ownership as terminal authorization failures."
  - "Safety regressions should prove same-thread reuse and cross-thread non-reuse through command-level tests, not only through route assertions."
requirements-completed: [SAFE-01, CMD-01, CMD-02]
duration: 1min
completed: 2026-04-19
---

# Phase 07: Codex-Native `/handoff` Command Summary

**Hardened the `/handoff` path so authorization, expiry, and thread-context failures stop with explicit repair guidance instead of drifting into a picker or generic error path.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-19T22:17:17Z
- **Completed:** 2026-04-19T22:17:56Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added fail-closed local helper guidance for missing thread context, missing bootstrap state, revoked handoffs, expired handoffs, and authorization failures.
- Reused a shared bridge-installation validation seam in `apps/web/lib/live-session/server.ts` and mapped hosted trust failures to explicit handoff error codes.
- Added regression coverage proving same-thread reuse, cross-thread non-reuse, no-picker fallback, and continued `thread/read` / `thread/resume` adapter assumptions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden local helper failures and slash-command copy so `/handoff` fails closed** - `6c95d8d` (fix)
2. **Task 2: Reuse durable ownership checks for hosted handoff minting** - `ec55e36` (fix)
3. **Task 3: Add safety regressions for no-picker fallback, same-thread reuse, and adapter non-regression** - `b72a521` (test)

## Files Created/Modified

- `apps/bridge/resources/codex/commands/handoff.md` - final command copy with explicit active-thread requirement and no-picker note
- `apps/bridge/src/cli/codex-handoff.ts` - fail-closed error mapping plus repair guidance for terminal handoff failures
- `apps/bridge/src/cli.ts` - stderr guidance output for failed `codex-handoff` runs
- `apps/bridge/src/lib/pairing-client.ts` - preserves domain error codes returned by `/api/handoffs`
- `apps/web/lib/live-session/server.ts` - shared bridge-installation principal validation
- `apps/web/app/api/handoffs/route.ts` - authorization, revocation, and expiry hardening for hosted handoff minting
- `apps/web/tests/unit/handoff-route.test.ts` - user mismatch, revoked installation, and revoked row regression coverage
- `apps/bridge/tests/unit/codex-handoff-safety.test.ts` - no-picker, reuse, and cross-thread safety regressions

## Decisions Made

- Mapped bridge-installation trust failures to `handoff_not_authorized` for the handoff route while preserving the route’s short-lived single-purpose descriptor behavior.
- Kept the local helper’s success path JSON-only and moved repair guidance into explicit terminal error handling instead of mixing diagnostic output into the success payload.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 7 now ends with a concrete command surface, thread-bound hosted descriptor, and fail-closed safety contract.
- Phase 8 can build launch consumption and mobile deep-link behavior on top of a stabilized `publicId` handoff URL shape and explicit terminal error vocabulary.
- The safety suite now guards against the two main regressions this phase needed to prevent: picker fallback and cross-thread reuse.

---
*Phase: 07-codex-native-handoff-command*
*Completed: 2026-04-19*
