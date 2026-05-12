---
phase: 08-hosted-launch-active-session-handoff
plan: 02
subsystem: web
tags: [launch, device-session, authless, redirect, fail-closed, vitest]

requires:
  - phase: 08.1
    provides: authless `/launch/[publicId]` Route Handler, device-session-only browser principal, forwarded-origin redirect
  - phase: 7
    provides: thread handoff record consumed by the launch claim
  - phase: 6
    provides: bridge bootstrap + bridge installation linkage on device sessions via `issuedFromPairingId`

provides:
  - Verified end-to-end launch consumption path: publicId resolution -> device session issuance/reuse -> redirect to `/session/<sessionId>`
  - Verified fail-closed error surface for expired, revoked, unauthorized, and unknown launch ids
  - Verified device-session-only browser principal across live/session/device API surfaces (no Auth.js round-trip)
  - Test gap closure: locked the wall clock in `remote-principal.test.ts` happy-path so the success case stops drifting past the mocked `expiresAt`

affects:
  - Plan 08-03 (docs) inherits the verified runtime contract described here

tech-stack:
  added: []
  patterns:
    - Authless launch token exchange in a Next.js Route Handler that writes the device session cookie before issuing a server-side redirect
    - Browser principal derived from durable device session and linked bridge installation only

key-files:
  created: []
  modified:
    - apps/web/tests/unit/remote-principal.test.ts

key-decisions:
  - "Verification-only pass for the runtime path: every must_have truth maps to existing code or tests shipped in phase 08.1"
  - "Closed a date-drift test gap by freezing the system clock to a pre-`expiresAt` instant in the success case (rather than rolling the mock dates forward indefinitely)"

patterns-established:
  - "When test fixtures encode absolute dates, lock the wall clock in `beforeEach` rather than ratcheting the dates each calendar quarter"

requirements-completed:
  - LAUNCH-02
  - LAUNCH-03
  - SAFE-02

duration: ~30min
completed: 2026-05-12
---

# Phase 08-02: Hosted Launch Consumption + Active-Session Redirect Verification

**Verified that `/launch/<publicId>` resolves the single-use token, mints or reuses a durable device session linked to the originating bridge installation, redirects directly to `/session/<sessionId>` on the forwarded public origin, and fails closed with explicit error codes on the authless error page.**

## Performance

- **Duration:** ~30 minutes
- **Started:** 2026-05-12
- **Completed:** 2026-05-12
- **Tasks:** 1 (verification + 1 targeted test fix)
- **Files modified:** 1

## Accomplishments

- Cross-referenced every must_have truth against the existing implementation and tests shipped in phase 08.1.
- Confirmed `/launch/[publicId]/route.ts` honours forwarded host/proto headers when building both the session and the error redirect URL.
- Confirmed `claimHandoffLaunch` rejects with `handoff_not_found`, `handoff_revoked`, `handoff_expired`, or `handoff_not_authorized` before any cookie is issued, and revokes the publicId after a successful claim.
- Confirmed `requireRemotePrincipal` rejects missing, mismatched-user, revoked, and expired device sessions, and never calls `auth()`.
- Closed a date-drift test gap: the success case in `remote-principal.test.ts` was failing because its mocked `expiresAt` (2026-04-25) had passed; locked the system clock to 2026-04-19T12:00:00Z in `beforeEach` and restored real timers in `afterEach`.

## Task Commits

1. **Test fix — freeze clock in remote-principal happy path** — `b30dc3e` (test)

## Files Created/Modified

### Modified

- `apps/web/tests/unit/remote-principal.test.ts` — added `vi.useFakeTimers()` + `vi.setSystemTime("2026-04-19T12:00:00.000Z")` in `beforeEach`, and a matching `vi.useRealTimers()` in `afterEach`, so the success-path assertion no longer drifts past the mocked device-session `expiresAt`.

### Verified (read-only)

- `apps/web/app/launch/[publicId]/route.ts` — publicId resolution via `claimHandoffLaunch`; redirects valid claims with HTTP 307 to `/session/<encoded-sessionId>` on the forwarded origin; redirects all known terminal errors to `/launch/error?code=<code>`
- `apps/web/lib/handoff-launch.ts` — `claimHandoffLaunch`: validates publicId, rejects revoked / expired handoffs, rejects revoked installations, reuses an existing device-session bound to the same bridge installation when the cookie is already valid, otherwise issues a fresh device session, writes a `pairing.claimed` audit row, touches `bridgeInstallationLastUsed`, and revokes the handoff publicId
- `apps/web/app/launch/error/page.tsx` — maps `handoff_not_found` / `handoff_expired` / `handoff_revoked` / `handoff_not_authorized` to user-facing remediation copy pointing back at `$handoff`
- `apps/web/lib/live-session/server.ts::requireRemotePrincipal` — no `auth()` import; derives principal from `cm_device_session` cookie and `findBridgeInstallationForDeviceSession`; throws exact error codes on each terminal state

## Verification (must_haves mapped to evidence)

- "Opening `/launch/<publicId>` resolves the publicId server-side and redirects to `/session/<sessionId>` without a GitHub sign-in."
  - Implementation: `apps/web/app/launch/[publicId]/route.ts` lines 32-65
  - Tests: `apps/web/tests/unit/handoff-launch-route.test.ts` "redirects a valid launch directly into the target session"

- "The redirect issues or reuses a durable `cm_device_session` cookie linked to the originating bridge installation before redirecting into the session route."
  - Implementation: `apps/web/lib/handoff-launch.ts` lines 56-127 (reuse branch lines 62-85; fresh-issue branch lines 87-127; ties device session to the bridge installation via `issuedFromPairingId`)

- "`/launch/<publicId>` honours the forwarded public origin (Fly edge) when constructing the redirect target."
  - Implementation: `apps/web/app/launch/[publicId]/route.ts` `resolvePublicOrigin` lines 11-20
  - Tests: `apps/web/tests/unit/handoff-launch-route.test.ts` "prefers the forwarded public origin over the internal request url"

- "Expired, revoked, unknown, or unauthorized launch ids fail closed by redirecting to `/launch/error?code=<code>`."
  - Implementation: `apps/web/app/launch/[publicId]/route.ts` lines 53-64; `apps/web/lib/handoff-launch.ts` lines 38-55; `apps/web/app/launch/error/page.tsx` `ERROR_COPY` map
  - Tests: `apps/web/tests/unit/handoff-launch-route.test.ts` "redirects invalid launches to the hosted error page"

- "Browser principal derivation on `/session/<sessionId>` and the device/session APIs reads from the device session and linked bridge installation only — no `auth()` round-trip."
  - Implementation: `apps/web/lib/live-session/server.ts::requireRemotePrincipal` lines 44-96 (no `auth()` import; reads cookie, validates row, rejects revoked/expired/mismatched, touches `lastSeenAt`)
  - Tests: `apps/web/tests/unit/remote-principal.test.ts` — "rejects revoked", "rejects expired", "rejects mismatched owners with user_mismatch", "touches lastSeenAt when the durable device session resolves successfully"

## Build / Test Results

- `npx vitest run apps/web/tests/unit/handoff-launch-route.test.ts apps/web/tests/unit/remote-principal.test.ts`: 7/7 passing after the test-fix commit
- Pre-existing unrelated failures in `apps/bridge/tests/unit/event-relay.test.ts` are out of scope.

## Deviations from PLAN

- None. The single deviation from "pure verification" was a targeted date-drift test fix in `remote-principal.test.ts`, which falls under the gap-closure allowance in 08-CONTEXT D-02.

## Cross-References to Prior Phases

- **Authless launch entrypoint, device-session principal, forwarded-origin handling** — shipped in phase 08.1:
  - `3b2f288` feat(08.1): remove github oauth from handoff launch (created `/launch/[publicId]/route.ts`, `/launch/error/page.tsx`, rewrote `lib/live-session/server.ts` to be device-session-only)
  - `131451e` fix(web): use forwarded origin for launch redirects
  - `4cd14a4` fix(handoff): ship an executable cli bin (packaging fix referenced by the launch helper end-to-end)
- **Phase 08.1 plan and summary** — `.planning/phases/08.1-authless-hosted-launch/08.1-01-PLAN.md`, `08.1-01-SUMMARY.md` (`bc1b0e9` and `2d04e3c`).

---
*Phase: 08-hosted-launch-active-session-handoff*
*Completed: 2026-05-12*
