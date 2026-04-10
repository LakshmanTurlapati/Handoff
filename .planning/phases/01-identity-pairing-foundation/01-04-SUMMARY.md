---
phase: 01-identity-pairing-foundation
plan: 04
subsystem: auth-middleware-and-bridge-entry-points
tags: [auth, middleware, pairing, bridge, cr-01, gap-closure]
gap_closure: true
wave: 1
depends_on: []
requirements: [PAIR-01, PAIR-02, PAIR-04, PAIR-05, AUTH-02]
dependency_graph:
  requires:
    - apps/web/auth.config.ts
    - apps/web/middleware.ts
    - apps/web/lib/pairing-service.ts
    - packages/protocol/src/pairing.ts
  provides:
    - UNAUTHENTICATED_API_POST_PATHS exported from apps/web/auth.config.ts
    - GET /api/pairings/[pairingId] route handler
    - Regression tests under apps/web/tests/unit/ that guard CR-01 and the new GET handler
  affects:
    - apps/bridge/src/lib/pairing-client.ts (now has reachable POST create and GET poll endpoints against the deployed stack)
tech-stack:
  added: []
  patterns:
    - "Method + pathname equality allowlist for unauthenticated bridge-facing POSTs (UNAUTHENTICATED_API_POST_PATHS Set)"
    - "Single-segment regex allowlist for unauthenticated bridge-facing GET status polls (/^\\/api\\/pairings\\/[^\\/]+$/)"
    - "Protocol-validated Next.js route handler returning a zod-parsed PairingStatusResponse"
    - "Vitest unit tests driving Next.js middleware + route handlers directly without a dev server"
key-files:
  created:
    - apps/web/app/api/pairings/[pairingId]/route.ts
    - apps/web/tests/unit/middleware-public-paths.test.ts
    - apps/web/tests/unit/pairings-status-route.test.ts
  modified:
    - apps/web/auth.config.ts
    - apps/web/middleware.ts
decisions:
  - "Use a Set<string> for exact POST-path allowlist (UNAUTHENTICATED_API_POST_PATHS) rather than extending the existing prefix-matched PUBLIC_PATHS, so /api/pairings/[id]/redeem and /confirm are NOT accidentally wildcard-leaked."
  - "Use a single-segment regex (/^\\/api\\/pairings\\/[^\\/]+$/) for the GET status-poll allowlist so /api/pairings/[id]/redeem subpaths stay auth-gated on GET as well as POST."
  - "GET /api/pairings/[pairingId] is intentionally unauthenticated at the route-handler level; middleware is the single gate. Possession of the opaque pairingId is the only proof required to READ status."
  - "Error responses from the new GET route are generic (pairing_not_found / internal_error) with the underlying error.message logged internally via console.error — no raw internal strings leak to the unauthenticated caller."
  - "Test E calls createPairing WITHOUT a custom context so the pairing lands in the same module-level defaultPairingStore the GET route reads from; deviceLabel is unique per run to avoid cross-test collisions."
metrics:
  duration: "3m42s"
  tasks_completed: 3
  files_created: 3
  files_modified: 2
  commits: 3
  completed: "2026-04-10T22:23:52Z"
---

# Phase 01 Plan 04: Bridge Pairing Allowlist + GET Status Handler Summary

**One-liner:** Closes CR-01 and the missing `GET /api/pairings/[pairingId]` handler by adding a method+path-equality allowlist to middleware (POST `/api/pairings`, GET `/api/pairings/[id]`) and creating the missing GET status route, so the bridge CLI can actually reach the hosted pairing API end-to-end while `/redeem` and `/confirm` remain auth-gated.

## Objective Recap

Before this plan the bridge CLI could create pairings in unit tests but could not complete a round-trip against the deployed stack because:

1. `apps/web/middleware.ts` redirected every unauthenticated `/api/pairings` request to `/sign-in`, so `PairingClient.createPairing` received HTML and `PairingCreateResponseSchema.safeParse` failed with an opaque "invalid payload" error (CR-01 from `01-REVIEW.md`).
2. No route handler existed at `apps/web/app/api/pairings/[pairingId]/route.ts`, so `PairingClient.waitForRedeem` polled a 404 forever (missing-handler gap from `01-VERIFICATION.md`).

After this plan both entry points work AND the authenticated `/redeem` and `/confirm` subpaths remain blocked behind the `Boolean(auth?.user)` check.

## Work Completed

### Task 1 — Add method+path-equality allowlist (`5161852`)

**Files:** `apps/web/auth.config.ts`, `apps/web/middleware.ts`

**In `auth.config.ts`:**
- Kept `PUBLIC_PATHS` narrow (`/sign-in`, `/api/auth`, `/api/healthz`) — deliberately did NOT add `/api/pairings` to avoid wildcard-leaking `/redeem` and `/confirm`.
- Added a new exported `UNAUTHENTICATED_API_POST_PATHS = new Set<string>(["/api/pairings"])`.
- Extended the Auth.js `authorized` callback to check (a) POST + exact-path equality against the new Set, then (b) GET + single-segment regex `/^\/api\/pairings\/[^\/]+$/`, BEFORE falling through to the existing `PUBLIC_PATHS` prefix match and the `Boolean(auth?.user)` browser-cookie check.

**In `middleware.ts`:**
- Imported `UNAUTHENTICATED_API_POST_PATHS` alongside the existing `authConfig, PUBLIC_PATHS` import.
- Added two pass-through guards at the top of the `auth((request) => { ... })` callback, mirroring the `authorized` logic but returning `NextResponse.next()` directly so the edge runtime short-circuits before any cookie lookup.
- Line order confirmed: `isPairingStatusGet` at line 53 is BEFORE `PUBLIC_PATHS.some` at line 59 — the CR-01 allowlist runs first.

### Task 2 — Create `GET /api/pairings/[pairingId]/route.ts` (`7b356ef`)

**File created:** `apps/web/app/api/pairings/[pairingId]/route.ts` (sibling to `confirm/` and `redeem/`, NOT inside either).

- Imports `loadPairingStatus` via `../../../../lib/pairing-service` (four `../` hops — verified with `node -e` that the path resolves to `apps/web/lib/pairing-service.ts`).
- Imports `PairingStatusResponseSchema` from `@codex-mobile/protocol` and validates the outgoing payload so the route contract cannot drift from the bridge's zod parse.
- Declares `runtime = "nodejs"` and `dynamic = "force-dynamic"` to match the existing `redeem/` and `confirm/` route handlers.
- Does NOT call `auth()` — the route is intentionally unauthenticated at the handler level; middleware is the single gate.
- Returns:
  - `200` with the validated `PairingStatusResponse` JSON body on success.
  - `400 { error: "missing_pairing_id" }` when `params.pairingId` is empty.
  - `404 { error: "pairing_not_found" }` when the underlying error message contains `"not found"`.
  - `500 { error: "internal_response_invalid" }` when the outgoing payload fails zod validation (logged via `console.error`).
  - `500 { error: "internal_error" }` on any other thrown error (logged internally; raw `error.message` is NOT echoed to the unauthenticated caller).

### Task 3 — Regression tests (`cd48fdf`)

**Files created under `apps/web/tests/unit/` so `phase-01-unit` picks them up:**

1. `middleware-public-paths.test.ts` — five cases invoking the exported middleware handler directly with `NextRequest`:
   - `POST /api/pairings` → allowed through (no sign-in redirect)
   - `GET /api/pairings/abc-123` → allowed through
   - `POST /api/pairings/abc-123/redeem` → BLOCKED (sign-in redirect)
   - `POST /api/pairings/abc-123/confirm` → BLOCKED
   - `GET /api/pairings/abc-123/redeem` → BLOCKED (proves the single-segment regex does not wildcard-leak)
2. `pairings-status-route.test.ts` — three cases calling `GET` directly:
   - Happy path: `createPairing` → `GET` → `200` + `PairingStatusResponseSchema.safeParse(...).success === true` + `status === "pending"` + `expiresAt` round-trips.
   - Not found: unknown UUID → `404` + `{ error: "pairing_not_found" }` + body does NOT contain the raw `pairing_session` internal string.
   - Empty id: `params.pairingId = ""` → `400 { error: "missing_pairing_id" }`.

**Tests are NOT run automatically** per the user's "never run applications automatically" global rule. The operator runs them via `npm run test:phase-01:quick`. Both files live under `apps/web/tests/unit/` which the Vitest workspace project `phase-01-unit` includes via `apps/web/tests/unit/**/*.test.ts`.

## Key Links Verified

| From                                    | To                                                   | Via                                              | Status |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | ------ |
| `apps/bridge/src/lib/pairing-client.ts` | `apps/web/app/api/pairings/route.ts`                 | `UNAUTHENTICATED_API_POST_PATHS` allowlist       | WIRED  |
| `apps/bridge/src/lib/pairing-client.ts` | `apps/web/app/api/pairings/[pairingId]/route.ts`     | `loadPairingStatus` + GET regex allowlist        | WIRED  |
| `apps/web/middleware.ts`                | `apps/web/auth.config.ts`                            | imports `UNAUTHENTICATED_API_POST_PATHS`         | WIRED  |
| `apps/web/app/api/pairings/[pairingId]/route.ts` | `apps/web/lib/pairing-service.ts`                    | `loadPairingStatus` via 4-hop relative import    | WIRED  |
| `apps/web/app/api/pairings/[pairingId]/route.ts` | `packages/protocol/src/pairing.ts`                  | `PairingStatusResponseSchema` validation         | WIRED  |

## Truths Now Structurally Reachable

Two Phase 1 gap-verification truths become structurally reachable after this plan:

- **Truth #6:** "The local terminal can request a pairing, show a QR code plus fallback code, and wait for confirmation." Previously FAILED because the bridge could not reach the hosted API. Now the `POST /api/pairings` create call passes middleware and the `GET /api/pairings/[id]` poll has a real handler.
- **Truth #10:** "Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine." Previously FAILED for the same reason. The "no inbound port" architectural half was already correct; the hosted-API-reachability half now works too.

Runtime end-to-end verification against a live Fly deploy is still deferred to the human-verification checklist in `01-VERIFICATION.md` (the user's "never run applications automatically" rule blocks any live deploy).

## Deviations from Plan

None — plan executed exactly as written.

One intentional addition inside Task 3: the plan behavior list specified two test cases for `pairings-status-route.test.ts` (Tests E and F); a third case was added covering the `400 { error: "missing_pairing_id" }` branch to guard the defensive check at the top of the GET handler. This is within the file already being written in Task 3 and does not expand scope.

## Authentication Gates

None encountered during execution.

## Security Notes

- The new GET route handler does NOT call `auth()` — this is deliberate and documented in the file header. Middleware is the single gate and the single-segment regex precludes wildcard leakage to `/redeem` and `/confirm`.
- Error messages on the new route are generic (`pairing_not_found`, `internal_error`) with `console.error` used to log the real error for operators. This matches the fix recommended in WR-01 of `01-REVIEW.md`, applied here proactively to the new route (the existing `/redeem` and `/confirm` WR-01 raw-message leakage is deferred to a later plan per `01-04-PLAN.md` `<deferred>`).
- `SESSION_COOKIE_SECRET` 32-byte gate (WR-03), Origin/CSRF check on confirm (WR-02), rate limit on POST /api/pairings (WR-11), and raw-error leakage in `/redeem` and `/confirm` (WR-01 on existing routes) are explicitly deferred to plan 01-05 per the plan's `<deferred>` block.

## Deferred Issues

None encountered during execution beyond the items already listed in `01-04-PLAN.md` `<deferred>` (which are tracked for plans 01-05 and 01-06).

## Verification Checklist (from plan `<verification>`)

- [x] `apps/web/auth.config.ts` and `apps/web/middleware.ts` both import/export `UNAUTHENTICATED_API_POST_PATHS`
- [x] `apps/web/app/api/pairings/[pairingId]/route.ts` exists and exports `GET`
- [x] Two new Vitest files exist under `apps/web/tests/unit/`
- [x] No task attempted `npm install`, `next build`, `fly deploy`, or `docker build`
- [x] The authenticated `/redeem` and `/confirm` route files are unchanged by this plan (verified via `git diff --stat 682f5ff HEAD` — empty)
- [x] `PUBLIC_PATHS` still equals `["/sign-in", "/api/auth", "/api/healthz"]` (verified via `awk` extraction)
- [x] `resources/` directory untouched (verified via `git diff --stat`)

## Commits

| Task | Commit    | Message                                                                       |
| ---- | --------- | ----------------------------------------------------------------------------- |
| 1    | `5161852` | `feat(01-04): allowlist bridge pairing entry points in middleware`            |
| 2    | `7b356ef` | `feat(01-04): add GET /api/pairings/[pairingId] status handler`               |
| 3    | `cd48fdf` | `test(01-04): add regression tests for CR-01 allowlist and GET status route` |

## Known Stubs

None. All code paths introduced by this plan are fully wired:

- `UNAUTHENTICATED_API_POST_PATHS` is consumed by both `auth.config.ts` `authorized()` callback and `middleware.ts` pass-through guard.
- The new `GET` handler delegates to `loadPairingStatus` (real implementation in `apps/web/lib/pairing-service.ts`) and validates against `PairingStatusResponseSchema` (real zod schema in `packages/protocol/src/pairing.ts`).
- Both test files exercise real functions/routes with no mocked data flow.

## Self-Check: PASSED

Verified via shell checks after commit:

- `apps/web/app/api/pairings/[pairingId]/route.ts` — FOUND
- `apps/web/tests/unit/middleware-public-paths.test.ts` — FOUND
- `apps/web/tests/unit/pairings-status-route.test.ts` — FOUND
- `.planning/phases/01-identity-pairing-foundation/01-04-SUMMARY.md` — FOUND
- `apps/web/auth.config.ts` — FOUND (modified)
- `apps/web/middleware.ts` — FOUND (modified)
- Commit `5161852` (Task 1) — FOUND in git log
- Commit `7b356ef` (Task 2) — FOUND in git log
- Commit `cd48fdf` (Task 3) — FOUND in git log
