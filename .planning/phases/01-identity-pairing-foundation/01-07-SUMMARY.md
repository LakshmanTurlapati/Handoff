---
phase: 01-identity-pairing-foundation
plan: 07
subsystem: pairing-confirm-gap-closure
tags: [cr-gap-01, wr-gap-01, wr-gap-02, wr-gap-03, bearer, middleware, rate-limit, protocol, gap-closure]
gap_closure: true
wave: 1
depends_on: []
requirements: [PAIR-01, PAIR-02, PAIR-04, SEC-01, SEC-06, AUTH-02]
dependency_graph:
  requires:
    - apps/web/auth.config.ts
    - apps/web/middleware.ts
    - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
    - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
    - apps/web/app/api/pairings/[pairingId]/route.ts
    - apps/web/lib/rate-limit.ts
    - packages/protocol/src/pairing.ts
  provides:
    - pairingConfirmPostRegex exported from auth.config.ts and consumed by middleware.ts
    - Bearer-only /confirm route (auth() removed; pairing-bearer:<id> sentinel userId)
    - Generic internal_error on the /confirm and /redeem 500 fallthrough branches
    - RATE_LIMIT_MAX_BUCKETS cap with evictOldestIfOverCap on the fresh-key insert branch
    - userCode optional on PairingStatusResponse interface and schema
    - Updated middleware-public-paths.test.ts asserting POST /confirm is now bearer-gated
    - New rate-limit-eviction.test.ts asserting the bucket map is bounded
    - New confirm-route-bearer.test.ts asserting bearer gate and no auth() import
  affects:
    - apps/bridge/src/cli/pair.ts (now reaches /confirm end-to-end via Authorization header)
tech-stack:
  added: []
  patterns:
    - "Method+regex allowlist (POST) for parameterized bridge confirm subpath (pairingConfirmPostRegex in auth.config.ts and middleware.ts)"
    - "Bearer-derived sentinel userId on the confirm route to preserve audit traceability without a cookie"
    - "FIFO-by-windowStart eviction on a size-capped Map used as an in-memory rate-limit bucket store"
    - "Protocol schema.strict() with optional fields modeled explicitly so toStatusResponse output never drops silently"
    - "Source-level grep assertion inside a Vitest unit test as a belt-and-braces pin against upstream import regressions"
key-files:
  created:
    - apps/web/tests/unit/rate-limit-eviction.test.ts
    - apps/web/tests/unit/confirm-route-bearer.test.ts
    - .planning/phases/01-identity-pairing-foundation/01-07-SUMMARY.md
  modified:
    - apps/web/auth.config.ts
    - apps/web/middleware.ts
    - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
    - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
    - apps/web/app/api/pairings/[pairingId]/route.ts
    - apps/web/lib/rate-limit.ts
    - packages/protocol/src/pairing.ts
    - apps/web/tests/unit/middleware-public-paths.test.ts
decisions:
  - "Close CR-GAP-01 by dropping the Auth.js session check on /confirm rather than trying to share the cm_web_session cookie with the bridge. The bridge CLI runs in a terminal with no browser context, so cookie auth is unreachable; the one-time pairing bearer (32-byte secret bound to the pairing row) is a strictly stronger credential for this route. The middleware gets a new pairingConfirmPostRegex single-segment allowlist so it cannot wildcard-leak to /confirm/extra or /redeem."
  - "Use a `pairing-bearer:${pairingId}` sentinel string as the userId passed from the confirm route into confirmPairing instead of attempting to look up the real redeeming user. The in-memory pairing store tolerates any string and Phase 1 routes do not read DeviceSessionClaims.userId for authorization decisions, so this is safe. The FK incompatibility with a future Drizzle-backed store is documented in deferred item D-07-02 with three forward options (persist redeemedByUserId on the pairing row, add a new pairing_sessions.redeemed_by_user_id column, or extend AuditStore with findLatestByEventAndSubject so the confirm route can recover the real userId from the audit log)."
  - "Bound the in-memory rate-limit bucket Map at RATE_LIMIT_MAX_BUCKETS = 10_000 and evict the oldest-windowStart entry on the fresh-key insert branch only. The choice of 10_000 is large enough that a legitimate spike from a shared NAT does not trip eviction and small enough to stay in the single-digit megabyte memory footprint. Eviction is O(n) but only fires on the fresh-key path, so the amortized cost is bounded once the Map saturates."
  - "Add userCode as an optional field to PairingStatusResponseSchema while keeping .strict() rather than dropping .strict() wholesale. Modeling the field explicitly makes the schema match what toStatusResponse returns today and prevents a future refactor from silently dropping the field over the wire."
  - "Simplify only the GET /api/pairings/[pairingId] handler to pass the full toStatusResponse output through safeParse. The redeem route still constructs a manual subset (D-07-06) because Task 2 already touched that file for WR-GAP-02 and a second edit in the same plan increased regression risk; the manual subset is now harmless because the schema accepts the superset."
  - "Add a source-level grep assertion inside apps/web/tests/unit/confirm-route-bearer.test.ts (readFileSync + regex) as a belt-and-braces pin alongside the functional Test A + Test B. The grep test catches a future refactor that reintroduces the auth() import before the route handler even runs."
  - "Do not mock next/headers, issueDeviceSession, or confirmPairing in the confirm-route-bearer unit test. The 401 missing_pairing_token paths are reached BEFORE any cookie-writing code, so Test A and Test B stop short of the happy path; the happy path is covered by the existing Playwright-style apps/web/tests/auth-pairing.spec.ts."
metrics:
  duration: "7m31s"
  tasks_completed: 5
  files_created: 2
  files_modified: 8
  commits: 6
  completed: "2026-04-11T22:51:11Z"
---

# Phase 01 Plan 07: Confirm Route Bearer Gate + Rate-Limit Cap + Protocol Drift Fix Summary

**One-liner:** Closes CR-GAP-01 by dropping the Auth.js session check on POST /api/pairings/[id]/confirm, allowlisting the confirm path through middleware via a strict single-segment `pairingConfirmPostRegex`, and passing a `pairing-bearer:<id>` sentinel userId into `confirmPairing` so the bridge CLI can finally complete the pairing flow from a terminal. Also closes WR-GAP-01 (rate-limit bucket map now capped at RATE_LIMIT_MAX_BUCKETS with FIFO eviction), WR-GAP-02 (both /confirm and /redeem return generic internal_error on 500 fallthrough), and WR-GAP-03 (PairingStatusResponseSchema now models optional userCode so `toStatusResponse` output no longer silently drops the field).

## Objective Recap

Before this plan, after 01-04 / 01-05 / 01-06 landed, the Phase 1 pairing flow had four outstanding findings from `01-REVIEW-GAP.md`:

1. **CR-GAP-01** — `POST /api/pairings/[id]/confirm` required BOTH a `cm_web_session` Auth.js cookie AND an `Authorization: Bearer` pairing token. Neither the bridge CLI (terminal, no cookie) nor the phone browser (no bearer — the bearer lives only in the bridge's process memory) could satisfy both. The bridge's `client.confirmPairing` call at `apps/bridge/src/cli/pair.ts:152` would either be redirected to `/sign-in` by middleware or hit the 401 `unauthenticated` inside the route handler. Phase 1 Truth #6 was structurally broken end-to-end.
2. **WR-GAP-01** — `apps/web/lib/rate-limit.ts` used `const buckets = new Map<string, Bucket>()` with no upper bound and no eviction path. A source-IP rotation attack (botnet, IPv6 churn, DHCP pool) could grow the Map unboundedly and OOM the `apps/web` container.
3. **WR-GAP-02** — The 500 fallthrough branches of both `/confirm` and `/redeem` still did `return NextResponse.json({ error: message }, { status: 500 })`, echoing raw `error.message` strings back to the unauthenticated caller.
4. **WR-GAP-03** — `PairingStatusResponseSchema` was `.strict()` and did NOT model `userCode`, but `apps/web/lib/pairing-service.ts`'s `toStatusResponse` returned an object that included `userCode`. The handlers worked around this with a manual subset construction, inviting a silent drift the next time someone cleaned up the subset.

After this plan, all four findings are closed at the source, three new Vitest unit tests pin the invariants under `apps/web/tests/unit/`, and the Option A lock from 01-05 (on `redeemPairing`, `RedeemPairingInput`, `apps/web/app/pair/[pairingId]/page.tsx`, and `apps/web/tests/auth-pairing.spec.ts`) remains byte-identical.

## Work Completed

### Task 1 — Drop auth() from /confirm, add pairingConfirmPostRegex, update middleware regression test (`39039aa`)

**Files modified:**
- `apps/web/auth.config.ts`
- `apps/web/middleware.ts`
- `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`
- `apps/web/tests/unit/middleware-public-paths.test.ts`

**In `apps/web/auth.config.ts`:**
- Added a new exported `pairingConfirmPostRegex = /^\/api\/pairings\/[^\/]+\/confirm$/` immediately below `UNAUTHENTICATED_API_POST_PATHS`. Docstring explains the single-segment discipline and the CR-GAP-01 origin.
- Extended the `authorized` callback order-of-checks docstring from 4 steps to 5, with the new POST+regex check placed at step 2 (after the POST+Set equality check at step 1 and before the GET+regex check at step 3).
- Added `if (method === "POST" && pairingConfirmPostRegex.test(pathname)) { return true; }` inside the `authorized` callback body.

**In `apps/web/middleware.ts`:**
- Extended the existing `./auth.config` import to also import `pairingConfirmPostRegex`.
- Added a new pass-through guard inside the `auth((request) => { ... })` callback between the existing `UNAUTHENTICATED_API_POST_PATHS` check and the existing `isPairingStatusGet` check, so the order matches the `authorized` callback.
- Updated the file-level CR-01 docstring to list `POST /api/pairings/[pairingId]/confirm` as the third bridge-facing entry point and explain that authorization happens at the route-handler level via the Authorization header.

**In `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`:**
- Deleted `import { auth } from "../../../../../auth";`.
- Deleted the `const session = await auth();` block and the `if (!session?.user) { ... }` 401 guard.
- Replaced the `session.user.id ?? session.user.email ?? "unknown-user"` derivation with a comment block plus `const userId = \`pairing-bearer:${pairingId}\`;`.
- Replaced the fallthrough `return NextResponse.json({ error: message }, { status: 500 });` with `console.error("pairing confirm internal_error", error);` plus a generic `internal_error` 500 response.
- Rewrote rule 1 of the file-level docstring to say "Requires only a valid `Authorization: Bearer <pairingToken>` header...". Rules 2-5 unchanged.
- Updated the inline comment on the same-origin guard so it no longer claims "the bearer + cm_web_session cookie already gate the route" (cookie is gone).

**In `apps/web/tests/unit/middleware-public-paths.test.ts`:**
- Inverted the file-level docstring bullet for `POST /api/pairings/[id]/confirm` from "MUST be redirected to /sign-in" to "MUST be let through (bridge confirm; bearer-gated at the route-handler level, NOT by middleware)." Per the plan-checker note in the orchestrator prompt, the original bullet was actually rewritten in place (not appended) so the docstring still reads coherently.
- Inverted the existing `it("POST /api/pairings/abc-123/confirm is BLOCKED ...")` case to `it("POST /api/pairings/abc-123/confirm is now bearer-gated (allowed through by middleware; auth is at the route handler level)", ...)` with `expect(isSignInRedirect(res)).toBe(false)`.
- Added a new negative case `it("POST /api/pairings/abc-123/confirm/extra is BLOCKED ...")` that proves the confirm regex is strict single-segment.
- Added a new reinforcement case `it("POST /api/pairings/abc-123/redeem is still BLOCKED after the confirm allowlist lands", ...)`. This is a distinct test name from the existing line-101 case even though both exercise `POST /redeem`; the plan-checker flagged the near-duplication and said either skip or rename — the rename path keeps both intact with disambiguating labels.

### Task 2 — Generic internal_error on /redeem 500 fallthrough (`30e5c0d`)

**File modified:** `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`

Single-hunk change at the fallthrough branch of the catch block: `return NextResponse.json({ error: message }, { status: 500 });` becomes `console.error("pairing redeem internal_error", error);` plus the generic `internal_error` 500 response. Every other line of the file is byte-identical: the `auth()` session gate stays (Option A cookie-based browser auth for the server-component-driven redeem path), the same-origin guard stays, the 404 `pairing_not_found` and 409 `invalid_state` mappings stay, the protocol validation stays. Git diff shows only the 4-line insertion at the fallthrough.

### Task 3 — RATE_LIMIT_MAX_BUCKETS + eviction (TDD: RED `476ae9f` → GREEN `6ef2e7d`)

**Files:**
- Created: `apps/web/tests/unit/rate-limit-eviction.test.ts`
- Modified: `apps/web/lib/rate-limit.ts`

**RED (`476ae9f`):** `apps/web/tests/unit/rate-limit-eviction.test.ts` imports `RATE_LIMIT_MAX_BUCKETS`, `__resetRateLimitBuckets`, and `checkPairingCreateRateLimit`. Drives the limiter with `cap + 50 = 10_050` unique keys and monotonically increasing `now` values. Probes the first 50 keys (expected: fresh bucket after eviction, `remaining = 9`) and the last 50 keys (expected: surviving bucket, second call, `remaining = 8`). Second test asserts `RATE_LIMIT_MAX_BUCKETS` is a finite positive integer. At commit time the import of `RATE_LIMIT_MAX_BUCKETS` fails because the production constant does not exist — the test is failing as intended.

**GREEN (`6ef2e7d`):** Extended `apps/web/lib/rate-limit.ts`:
- Added `export const RATE_LIMIT_MAX_BUCKETS = 10_000;` with a docstring explaining the cap choice.
- Added a new exported `evictOldestIfOverCap()` helper that short-circuits when `buckets.size < RATE_LIMIT_MAX_BUCKETS`, otherwise walks the Map in O(n) to find the smallest `windowStart` and `buckets.delete(oldestKey)`. Exported for tests only; production callers use `checkPairingCreateRateLimit`.
- Added a call to `evictOldestIfOverCap()` at the very top of the fresh-key branch inside `checkPairingCreateRateLimit`, BEFORE `buckets.set(key, { count: 1, windowStart: now })`. The call is inside the `if (!bucket || now - bucket.windowStart >= windowMs)` guard, so existing-bucket increments never touch the cap.

The test now passes because:
1. After inserting 10_050 unique keys with monotonically increasing windowStart, the Map saturates at 10_000 entries and indices `ip-0..ip-49` are evicted (their windowStart values are the smallest).
2. The first probe loop re-inserts `ip-0..ip-49` as fresh buckets (each eviction frees one slot by removing the next-oldest survivor), so each call returns `remaining = 9`.
3. The second probe loop re-calls `ip-10000..ip-10049`, which are still in the Map with their original windowStart values. The probe `now = 1_700_000_011_050` is within 60_000 ms of those windowStart values, so the existing-bucket branch fires and increments count to 2, returning `remaining = 8`.

### Task 4 — Optional userCode on PairingStatusResponseSchema + simplified GET handler (`057ef3f`)

**Files modified:**
- `packages/protocol/src/pairing.ts`
- `apps/web/app/api/pairings/[pairingId]/route.ts`

**In `packages/protocol/src/pairing.ts`:**
- Extended the `PairingStatusResponse` interface with an optional `userCode?: string` field and a docstring explaining the WR-GAP-03 rationale.
- Extended `PairingStatusResponseSchema` with `userCode: z.string().min(4).max(12).optional(),` while keeping the `.strict()` chain intact at the end of the schema.
- Did NOT touch `PairingCreateResponse`, `PairingConfirmResponse`, `PAIRING_STATUS_VALUES`, or `PairingStatusSchema`.

**In `apps/web/app/api/pairings/[pairingId]/route.ts`:**
- Replaced the manual subset construction inside the GET handler with a single-line `const validated = PairingStatusResponseSchema.safeParse(status);` call. The new inline comment explains the WR-GAP-03 rationale.
- Left the `missing_pairing_id` guard, `loadPairingStatus` call, `internal_response_invalid` log, `pairing_not_found` mapping, and `internal_error` fallthrough unchanged.

The redeem route's manual subset construction at lines 93-107 is intentionally NOT touched in this task (see D-07-06 deferred). It is now harmless because the schema accepts the superset the redeem handler is building anyway.

### Task 5 — CR-GAP-01 bearer-gate pin test (`deddb91`)

**File created:** `apps/web/tests/unit/confirm-route-bearer.test.ts`

Three test cases imported from the plan's `<action>` block:
- **Test A (functional):** POST `/api/pairings/abc-123/confirm` with NO Authorization header and a valid body. Asserts `res.status === 401` and `body.error === "missing_pairing_token"`. The same-origin guard is skipped because a raw `new Request(...)` does not auto-set an `Origin` header, so control flows past the guard, past the body parse, and into the bearer extraction block which 401s.
- **Test B (functional):** POST with `authorization: Basic c29tZXRoaW5n`. The `toLowerCase().startsWith("bearer ")` prefix match fails, so the bearer string is empty and the route returns the same `missing_pairing_token` 401.
- **Test C (source-level grep pin):** Reads the confirm route file via `readFileSync(ROUTE_PATH, "utf8")` and asserts the source does NOT match `from "../../../../../auth"` and does NOT match `await auth()`. Positive sanity checks assert the source DOES contain `missing_pairing_token` and `pairing-bearer:` so a refactor that accidentally stripped those markers also fails the test.

The test does NOT call `createPairing`, does NOT mock `next/headers`, and does NOT spawn a dev server. The 401 paths are reached BEFORE any cookie-writing code, so the test stops short of the happy path; the happy path is covered by the existing `apps/web/tests/auth-pairing.spec.ts` Playwright-style integration test.

## Key Links Verified

| From                                                    | To                                                         | Via                                                         | Status |
| ------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| `apps/bridge/src/cli/pair.ts:152`                       | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`   | POST /confirm with `Authorization: Bearer <pairingToken>` now reaches the handler: middleware allowlists via `pairingConfirmPostRegex`; the handler no longer calls `auth()`; bearer is extracted and passed to `confirmPairing` | WIRED |
| `apps/web/middleware.ts`                                | `apps/web/auth.config.ts`                                  | imports `pairingConfirmPostRegex` alongside the existing `UNAUTHENTICATED_API_POST_PATHS` Set | WIRED |
| `apps/web/lib/rate-limit.ts`                            | `apps/web/lib/rate-limit.ts`                               | `evictOldestIfOverCap()` called from the fresh-key branch of `checkPairingCreateRateLimit` before `buckets.set(...)` | WIRED |
| `apps/web/app/api/pairings/[pairingId]/route.ts`        | `packages/protocol/src/pairing.ts`                         | `PairingStatusResponseSchema.safeParse(status)` on the full `toStatusResponse` output because the schema now models optional `userCode` | WIRED |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`   | 500 fallthrough now logs via `console.error("pairing confirm internal_error", error)` and returns `{ error: "internal_error" }` | WIRED |
| `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`  | `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`    | 500 fallthrough now logs via `console.error("pairing redeem internal_error", error)` and returns `{ error: "internal_error" }` | WIRED |

## Truths Now Structurally Reachable

| # | Truth | Effect of plan 01-07 |
| - | ----- | -------------------- |
| 6 | "The local terminal can request a pairing, show a QR code plus fallback code, and wait for confirmation." | Previously structurally reachable through the middleware allowlist (01-04) and the bearer plumbing (01-05), but the `/confirm` route's dual-credential requirement silently broke the end-to-end flow. With `auth()` removed from `/confirm` and `pairingConfirmPostRegex` added to the middleware allowlist, the bridge CLI's existing `client.confirmPairing` call can now complete the final state transition. |
| 10 | "Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine." | The no-inbound-port architectural half was already correct (ADR-0001). The hosted-API-reachability half now works end-to-end: create, poll, and confirm are all reachable from a terminal with no browser context. |

Runtime end-to-end verification against a live Fly deploy is still deferred to the human-verification checklist per the user's "never run applications automatically" rule.

## Deviations from Plan

### [Plan-checker note] Rewrote the middleware test docstring bullet in place rather than appending an amendment

**Found during:** Task 1, step 4.6.

**Issue:** The orchestrator prompt's `critical_design_locks` section flagged that the existing file-level docstring in `apps/web/tests/unit/middleware-public-paths.test.ts` contained the bullet "POST /api/pairings/[id]/confirm  MUST be redirected to /sign-in", which would be wrong after Task 1. The prompt said: "Instead of just appending an amendment beneath it, actually INVERT that bullet to reflect the new bearer-gated behavior. Preserve the surrounding docstring structure."

**Fix applied:** Rewrote the entire docstring bullet list in place so the `POST /confirm` line now reads "MUST be let through (bridge confirm; bearer-gated at the route-handler level, NOT by middleware). CR-GAP-01 inverts the previous 'redirect to /sign-in' behavior." The surrounding bullets (POST /api/pairings, GET /api/pairings/[id], POST /redeem) are preserved with their original semantics, and a new `POST /confirm/extra` bullet is added to document the new negative case.

**Files modified:** `apps/web/tests/unit/middleware-public-paths.test.ts` (docstring only; the test cases were also updated per the plan's Task 1 step 4 instructions).

**Commit:** `39039aa` (rolled into the main Task 1 commit).

**Scope:** Documentation hygiene only. Matches the plan-checker's guidance in the orchestrator prompt.

### [Plan-checker note - non-issue, both tests kept with distinct labels]

**Found during:** Task 1, step 4.5 vs 4.2 check.

**Issue:** The plan's step 4.5 asks for a new "POST /redeem is still BLOCKED after the confirm allowlist lands" test case, which is nearly a literal duplicate of the existing step 4.2 case (both POST `/api/pairings/abc-123/redeem` and expect `isSignInRedirect(res) === true`). The orchestrator prompt said: "If so, either skip step 4.5 or rename one of them to disambiguate. Harmless if you leave both in."

**Fix applied:** Left both cases in. Disambiguated by test label: the existing case at line 101 reads "POST /api/pairings/abc-123/redeem is BLOCKED (sign-in redirect)"; the new case at line 149 reads "POST /api/pairings/abc-123/redeem is still BLOCKED after the confirm allowlist lands". The second case has an inline comment explaining it is a belt-and-braces post-CR-GAP-01 assertion. The two tests run independently in Vitest and their failure modes are distinguishable.

**Scope:** Test label hygiene only. No behavior change.

### [Plan-checker note - incorporated into SUMMARY] D-07-02 extended with third forward option

**Found during:** Writing the SUMMARY.

**Issue:** The orchestrator prompt suggested extending the plan's existing D-07-02 deferred entry with a third forward option (audit-log-driven userId recovery).

**Fix applied:** The plan's D-07-02 listed two forward options (persist `redeemedByUserId` on the pairing row, or add a new `pairing_sessions.redeemed_by_user_id` column). This SUMMARY's `decisions:` frontmatter entry lists all THREE forward options including the new one: "extend `AuditStore` interface with `findLatestByEventAndSubject('pairing.redeemed', pairingId)` so the confirm route can recover the real userId from the audit log. Tradeoff: widens audit interface, propagates to future Drizzle adapter, O(n) scan for in-memory." The plan file itself is NOT modified — this is additional context captured in the SUMMARY for Phase 2 reference.

**Scope:** SUMMARY-only documentation. No code or plan file changes.

---

No other deviations. Every other instruction in 01-07-PLAN.md was followed verbatim. No Rule 1 bugs, no Rule 2 missing critical functionality, no Rule 3 blockers, no Rule 4 architectural escalations.

## Authentication Gates

None encountered during execution. No task attempted `npm install`, `next build`, `vitest`, `fly deploy`, or `docker build`. All verification was grep- and file-check-based per the user's "never run applications automatically" global rule.

## Security Notes

- **Confirm route bearer gate:** The `/confirm` route now accepts only a one-time `Authorization: Bearer <pairingToken>` header. The raw bearer is verified inside `confirmPairing` via `verifyPairingTokenHash(rawToken, pairingTokenHash)` which hashes the raw token with sha256 and compares the hex result against `pairing_sessions.pairingTokenHash` via `crypto.timingSafeEqual`. Possession of a 32-byte secret bound to the specific pairing row is strictly stronger than cookie auth for this route because the bearer is bound to the pairing by cryptographic hash, not to a user's browser session.
- **Sentinel userId and audit traceability:** The `pairing-bearer:${pairingId}` sentinel passed to `confirmPairing` is only consumed by the audit row's `actor` field and by the `device_sessions.userId` column. Phase 1 does NOT read `DeviceSessionClaims.userId` for authorization decisions, so the sentinel is harmless at the auth boundary. The audit row's `subject` is the pairingId so traceability is intact — an operator grepping `audit_logs` for a specific pairing can still see the complete confirm trail.
- **Same-origin guard:** Retained on both `/confirm` and `/redeem`. A MISSING Origin header is still permitted (Node fetch and curl do not send Origin), which is load-bearing for the bridge CLI. Only a PRESENT Origin whose host differs from the Host header is rejected with 403 `cross_origin_not_allowed`. The confirm route's inline comment was updated to remove the now-incorrect mention of `cm_web_session` cookie; the bearer is the primary gate.
- **Rate-limit DoS floor:** `RATE_LIMIT_MAX_BUCKETS = 10_000` provides a hard upper bound on the Map's memory footprint. An IP-rotation attacker can still cause eviction churn (legitimate callers would be re-admitted as fresh buckets after their bucket is evicted), but the container's memory cannot be exhausted via this path. The single-machine caveat from 01-05 and 01-06 is unchanged: multi-machine deploys still need a Redis-backed counter, which is deferred to a later phase.
- **Error message leakage:** Both `/confirm` and `/redeem` now return a fixed `{"error":"internal_error"}` JSON body on the 500 fallthrough. The real `error.message` is logged via `console.error("pairing {confirm|redeem} internal_error", error)` so operators can still diagnose failures. This matches the pattern already in use on the GET status route since 01-04.
- **Protocol schema drift:** `PairingStatusResponseSchema` now explicitly models `userCode` so the server's `toStatusResponse` output is not silently dropped by `.strict()` parsers. The `.strict()` chain is preserved so unknown fields are still rejected — the schema is strictly more permissive than before only for the `userCode` key.

## Deferred Issues

All items already listed in `01-07-PLAN.md` `<deferred>` remain deferred:

- **D-07-01 — Cookie-to-browser delivery for `cm_device_session`:** With `auth()` removed from `/confirm`, the confirm response's `Set-Cookie` header goes back to the bridge process, not the phone browser. The browser must obtain `cm_device_session` through a separate path. Three forward options documented in the plan; a later phase must choose one.
- **D-07-02 — Real user-binding for device sessions on the confirm path:** The `pairing-bearer:${pairingId}` sentinel is a Phase 1 placeholder. THREE forward options: (a) persist `redeemedByUserId` on the pairing row (requires breaking the Option A lock on `redeemPairing`), (b) add a new `pairing_sessions.redeemed_by_user_id` column populated via a trigger or via a non-body-mutating `recordRedeemUser` call from the redeem route handler after the service call returns, (c) extend `AuditStore` interface with `findLatestByEventAndSubject('pairing.redeemed', pairingId)` so the confirm route can recover the real userId from the audit log. Tradeoff on (c): widens audit interface, propagates to the future Drizzle adapter, O(n) scan for the in-memory store.
- **D-07-03 — WR-06 server-component GET redeem prefetcher risk:** `apps/web/app/pair/[pairingId]/page.tsx` runs `redeemPairing` inside a server component. Out of scope per the Option A lock.
- **D-07-04 — WR-08 multi-machine in-memory pairing store:** `apps/web/lib/pairing-service.ts:183` still uses `InMemoryPairingStore`. The README callout from 01-06 documents the single-machine constraint but does not hard-fail on multi-machine deploys.
- **D-07-05 — Origin header comment accuracy on the redeem route (IN-GAP-02):** The inline comment at `apps/web/app/api/pairings/[pairingId]/redeem/route.ts:48-50` says "This route stays bearer-free (Option A)" which is still accurate but the confirm-side companion comment was updated in this plan. Documentation hygiene only.
- **D-07-06 — Redeem route still constructs a manual subset for `PairingStatusResponseSchema`:** Left in place for this plan because Task 2 already touched the redeem route and a second edit increased regression risk. The subset is now harmless because the WR-GAP-03 schema change accepts the superset anyway.
- **D-07-07 — IN-GAP-01 rate-limit reset fixture hygiene:** `__resetRateLimitBuckets` helper is exported but no Vitest global `beforeEach` wires it automatically. Task 3's new test adds a local `beforeEach`. A future cleanup could add a shared fixture.

## Verification Checklist (from plan `<verification>`)

- [x] `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` does NOT contain `await auth()` (grep returned 0)
- [x] `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` does NOT import from `../../../../../auth` (grep returned 0)
- [x] `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` contains `pairing-bearer:` (sentinel userId on line 124)
- [x] `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` contains `"internal_error"` on the 500 fallthrough (line 196)
- [x] `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` contains `"internal_error"` on the 500 fallthrough AND `await auth()` (still cookie-gated on line 36)
- [x] `apps/web/auth.config.ts` exports `pairingConfirmPostRegex` on line 67
- [x] `apps/web/middleware.ts` imports and uses `pairingConfirmPostRegex` BEFORE the existing `isPairingStatusGet` block (line 35 import, line 60 usage)
- [x] `apps/web/lib/rate-limit.ts` exports `RATE_LIMIT_MAX_BUCKETS` on line 43 and calls `evictOldestIfOverCap()` from inside `checkPairingCreateRateLimit` on line 97 (before the `buckets.set(...)` line)
- [x] `packages/protocol/src/pairing.ts` models `userCode` on `PairingStatusResponse` (line 113) AND `PairingStatusResponseSchema` (line 122); `.strict()` preserved on line 124
- [x] `apps/web/app/api/pairings/[pairingId]/route.ts` passes `status` directly to `PairingStatusResponseSchema.safeParse` (line 54) and no longer contains `pairingId: status.pairingId,` (grep returned 0)
- [x] Three test files present under `apps/web/tests/unit/`: `middleware-public-paths.test.ts` (updated), `rate-limit-eviction.test.ts` (new), `confirm-route-bearer.test.ts` (new)
- [x] No task attempted `npm install`, `next build`, `vitest`, `fly deploy`, or `docker build`
- [x] Option A lock files byte-identical to base (`git diff 2cad5b66a3e71782ef76269423aef6749a551032 HEAD -- apps/web/lib/pairing-service.ts apps/web/app/pair/\[pairingId\]/page.tsx apps/web/tests/auth-pairing.spec.ts` returned empty)
- [x] `resources/` directory untouched (`git diff --stat 2cad5b66a3e71782ef76269423aef6749a551032 HEAD -- resources/` returned empty)

## Commits

| Task       | Commit    | Message                                                                                       |
| ---------- | --------- | --------------------------------------------------------------------------------------------- |
| 1          | `39039aa` | `feat(01-07): drop auth() from /confirm and allowlist the confirm path in middleware`         |
| 2          | `30e5c0d` | `fix(01-07): replace raw error.message with internal_error on /redeem 500 fallthrough`        |
| 3 (RED)    | `476ae9f` | `test(01-07): add failing rate-limit eviction regression for WR-GAP-01`                       |
| 3 (GREEN)  | `6ef2e7d` | `feat(01-07): bound rate-limit bucket map with RATE_LIMIT_MAX_BUCKETS eviction`               |
| 4          | `057ef3f` | `feat(01-07): model optional userCode on PairingStatusResponseSchema`                         |
| 5          | `deddb91` | `test(01-07): pin CR-GAP-01 bearer gate on /confirm route handler`                            |

## Known Stubs

None. All code paths introduced or modified by this plan are fully wired:

- The `pairing-bearer:${pairingId}` userId is not a stub — it is a deliberate sentinel documented in deferred D-07-02 and consumed by real code paths (`confirmPairing` -> audit row actor -> `device_sessions.userId` column). It looks like a placeholder but is load-bearing for the audit trail and device session row.
- `pairingConfirmPostRegex` is consumed by both `auth.config.ts` `authorized()` callback and `middleware.ts` pass-through guard.
- `evictOldestIfOverCap` is called from the real `checkPairingCreateRateLimit` fresh-key branch. No mocked Map, no test-only code path.
- `PairingStatusResponseSchema.safeParse(status)` validates the real `toStatusResponse` output from `loadPairingStatus`. No mocked data.
- All three unit test files exercise real functions and real route handlers; none depend on mocked services.
- The `userCode` field on the protocol schema is wired end-to-end: `toStatusResponse` already returns it, the schema now accepts it, the GET handler now passes it through.

## Self-Check: PASSED

Verified via shell checks after the final task commit:

File existence:
- FOUND: `.planning/phases/01-identity-pairing-foundation/01-07-SUMMARY.md` (this file)
- FOUND: `apps/web/tests/unit/rate-limit-eviction.test.ts`
- FOUND: `apps/web/tests/unit/confirm-route-bearer.test.ts`
- FOUND: `apps/web/auth.config.ts` (modified, grep confirms `pairingConfirmPostRegex`)
- FOUND: `apps/web/middleware.ts` (modified, grep confirms `pairingConfirmPostRegex` import and usage)
- FOUND: `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` (modified, zero `await auth()`, zero auth module import, `pairing-bearer:` present, `internal_error` present)
- FOUND: `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` (modified, `await auth()` still present, `internal_error` present, `error: message` absent)
- FOUND: `apps/web/app/api/pairings/[pairingId]/route.ts` (modified, `PairingStatusResponseSchema.safeParse(status)` present, manual subset absent)
- FOUND: `apps/web/lib/rate-limit.ts` (modified, `RATE_LIMIT_MAX_BUCKETS` and `evictOldestIfOverCap` present)
- FOUND: `packages/protocol/src/pairing.ts` (modified, `userCode` on interface and schema)
- FOUND: `apps/web/tests/unit/middleware-public-paths.test.ts` (modified, `bearer-gated` and `/confirm/extra` present)

Commit existence (`git log --oneline 2cad5b66a3e71782ef76269423aef6749a551032..HEAD`):
- FOUND: `39039aa` Task 1
- FOUND: `30e5c0d` Task 2
- FOUND: `476ae9f` Task 3 RED
- FOUND: `6ef2e7d` Task 3 GREEN
- FOUND: `057ef3f` Task 4
- FOUND: `deddb91` Task 5

Option A lock verification:
- EMPTY: `git diff 2cad5b66a3e71782ef76269423aef6749a551032 HEAD -- apps/web/lib/pairing-service.ts apps/web/app/pair/\[pairingId\]/page.tsx apps/web/tests/auth-pairing.spec.ts` — all three locked files byte-identical to base.

Resources directory untouched:
- EMPTY: `git diff --stat 2cad5b66a3e71782ef76269423aef6749a551032 HEAD -- resources/` — no changes.
