---
phase: 01-identity-pairing-foundation
reviewed: 2026-04-10T00:00:00Z
depth: standard
review_type: gap-closure
files_reviewed: 13
files_reviewed_list:
  - apps/bridge/src/lib/pairing-client.ts
  - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
  - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
  - apps/web/app/api/pairings/[pairingId]/route.ts
  - apps/web/app/api/pairings/route.ts
  - apps/web/auth.config.ts
  - apps/web/lib/device-session.ts
  - apps/web/lib/pairing-service.ts
  - apps/web/lib/rate-limit.ts
  - apps/web/middleware.ts
  - apps/web/tests/unit/middleware-public-paths.test.ts
  - apps/web/tests/unit/pairings-status-route.test.ts
  - packages/protocol/src/pairing.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
gap_closure_summary:
  original_critical: 3
  original_warning: 11
  original_info: 9
  closed: 7
  still_open: 3
  out_of_scope: 8
  new_issues: 1
---

# Phase 1: Code Review Gap-Closure Report

**Reviewed:** 2026-04-10
**Depth:** standard
**Review Type:** gap-closure (plans 01-04 / 01-05 / 01-06 follow-up)
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Gap plans 01-04, 01-05, and 01-06 landed a coherent set of fixes for the
original `01-REVIEW.md` blockers. The in-scope items for this re-review
(CR-01 middleware allowlist, missing GET handler, SEC-06 pairing-bearer
wiring, WR-02 Origin/CSRF, WR-03 secret length, WR-09 typed polling
errors, WR-11 rate limit) are all **structurally closed**. The new
`verifyPairingTokenHash` helper is correctly length-gated before
`crypto.timingSafeEqual`, the middleware regex is correctly
single-segment so `/redeem` and `/confirm` stay auth-gated, and the new
unit tests (`middleware-public-paths.test.ts`, `pairings-status-route.test.ts`)
pin the CR-01 and missing-handler invariants.

However, one **critical finding** remains that is a consequence of the
gap closure surfacing a pre-existing architectural contradiction, NOT
introduced by the gap closure itself:

- **`/api/pairings/[id]/confirm` requires BOTH `cm_web_session` (only the
  browser has this) AND the `Authorization: Bearer` pairing token (only
  the bridge has this).** Neither caller can satisfy both simultaneously,
  so the bridge CLI's `confirmPairing` call at `apps/bridge/src/cli/pair.ts:152`
  still cannot complete end-to-end. This was already true before the gap
  closure — the handler's `auth()` guard existed since Phase 01-02 — but
  plan 01-05 added the bearer requirement without resolving which
  principal is supposed to mint the cookie. This is the
  `01-VERIFICATION.md` Truth #6 gap that is **still FAILED** after the
  gap closure.

The executor's documented deviation on plan 01-05 (making
`ConfirmPairingInput.pairingToken` OPTIONAL rather than REQUIRED, and
moving `verifyPairingTokenHash` AFTER the state check rather than BEFORE)
does NOT open a runtime security hole at the HTTP boundary:
`apps/web/app/api/pairings/[pairingId]/confirm/route.ts:99-108` extracts
the bearer and returns 401 BEFORE reaching `confirmPairing`, so
production traffic is still bearer-gated. The deviation is safe.

Three additional findings surfaced in the re-review are listed below:
a memory-growth concern on the new rate limiter, a Zod strict-mode risk
on the status response where `userCode` passes through untyped, and a
call-order note on the Origin guard.

## Gap Closure Disposition

### Original CRITICAL findings

| ID    | Original Title                                                        | Disposition            | Evidence |
| ----- | --------------------------------------------------------------------- | ---------------------- | -------- |
| CR-01 | Middleware blocks bridge CLI from `/api/pairings`                     | **CLOSED**             | `apps/web/middleware.ts:43-57` method+pathname-equality allowlist for POST `/api/pairings` and single-segment regex for GET `/api/pairings/[id]`. `/redeem` and `/confirm` subpaths remain auth-gated. Pinned by `apps/web/tests/unit/middleware-public-paths.test.ts:71-122`. |
| CR-02 | GitHub Actions shell-injection via interpolated secrets               | OUT OF SCOPE           | Not in review file list — verified via 01-06 acceptance criteria per prompt instructions. |
| CR-03 | Dockerfile `\|\| true` masks build failures                           | OUT OF SCOPE           | Not in review file list — verified via 01-06 acceptance criteria per prompt instructions. |

### Original WARNING findings

| ID    | Original Title                                                        | Disposition            | Evidence |
| ----- | --------------------------------------------------------------------- | ---------------------- | -------- |
| WR-01 | Raw error messages leaked in API response bodies                      | **CLOSED (partial)**   | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:153-183` and `redeem/route.ts:110-119` now map known substrings to fixed error codes, but the fallthrough branch still returns `{ error: message }` in confirm (line 182) — see new finding WR-GAP-03 below. The new GET status handler (`apps/web/app/api/pairings/[pairingId]/route.ts:68-82`) does the right thing (`internal_error`, logged separately). |
| WR-02 | No Origin/CSRF check on cookie-minting `/confirm`                     | **CLOSED**             | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:59-75` rejects cross-origin POSTs with 403, and mirrored in `redeem/route.ts:51-67`. Missing-Origin fallthrough is intentional (node fetch / bridge do not send Origin) and is documented in the inline comment. |
| WR-03 | `SESSION_COOKIE_SECRET` length gate too weak (>=16)                   | **CLOSED**             | `apps/web/lib/device-session.ts:102-114` now gates on `bytes.byteLength < 32` (Uint8Array from TextEncoder), matching HS256 best practice. Error message calls out the UTF-8 byte requirement explicitly. |
| WR-04 | GitHub Actions workflow lacks explicit `permissions:` scoping         | OUT OF SCOPE           | Not in review file list. |
| WR-05 | `callbackUrl` pass-through open-redirect risk                         | OUT OF SCOPE           | `apps/web/app/sign-in/page.tsx` not in review file list. |
| WR-06 | Pairing redeem on GET (server component) link-prefetcher risk         | STILL OPEN             | `apps/web/app/pair/[pairingId]/page.tsx` is explicitly out of scope for this review per prompt. Plan 01-05 did not move redeem off the server component. |
| WR-07 | Production image ships devDependencies                                | OUT OF SCOPE           | Dockerfiles not in review file list. |
| WR-08 | Default `InMemoryPairingStore` breaks multi-machine Fly deploys       | STILL OPEN             | `apps/web/lib/pairing-service.ts:183` still uses `defaultPairingStore = new InMemoryPairingStore()` unconditionally. The `lib/rate-limit.ts:10-14` header documents the single-machine caveat for the rate limiter, but `pairing-service.ts` has no equivalent boot-time guard. |
| WR-09 | `waitForRedeem` silently swallows all polling errors                  | **CLOSED**             | `apps/bridge/src/lib/pairing-client.ts:77-86` introduces `PairingPollError` (carries `status` and `path`), `getPairingStatus:176-182` throws it on non-2xx, and `waitForRedeem:253-268` rethrows 4xx/schema/network errors while still retrying 5xx. The regression fix is explicitly tied to WR-09 in the inline comment. |
| WR-10 | `trustProxy: true` on relay Fastify                                   | OUT OF SCOPE           | `apps/relay/src/server.ts` not in review file list. |
| WR-11 | No rate limit on `POST /api/pairings`                                 | **CLOSED**             | New `apps/web/lib/rate-limit.ts` module + wired into `apps/web/app/api/pairings/route.ts:57-72`. Returns 429 with `retry-after` header. Process-local caveat documented. See new finding WR-GAP-02 for the memory-growth concern. |

### Original INFO findings

IN-01 (`constantTimeEqual` using `timingSafeEqual`) is **CLOSED** — `apps/web/lib/pairing-service.ts:649-654` now uses `Buffer.from` + `timingSafeEqual` after the length check.

IN-02 (unused `rawPairingToken`) is **CLOSED** — this is the core of plan 01-05. `createPairing` now returns `pairingToken: rawPairingToken` (line 282), the HTTP route echoes it in the response body (`apps/web/app/api/pairings/route.ts:101`), the bridge client stores it in memory only (`pairing-client.ts:101`) and sends `Authorization: Bearer` on subsequent calls, and `confirmPairing` verifies via `verifyPairingTokenHash`.

IN-03 through IN-09 are out of scope — files not in the review list.

### Option A Lock Verification

The critical design lock for plan 01-05 is **INTACT**:

- `RedeemPairingInput` (`apps/web/lib/pairing-service.ts:313-318`) contains only `pairingId`, `userId`, `userAgent?`, `allowExistingStates?`. **No `pairingToken` field.** Grep confirms zero matches of `pairingToken` inside the `redeemPairing` function body.
- `redeemPairing` body (`pairing-service.ts:328-370`) contains no `verifyPairingTokenHash` call. The only invocation lives inside `confirmPairing` at line 440.
- `apps/web/app/pair/[pairingId]/page.tsx` was **not modified** (last touched in commit `8323141` from 01-02; no gap-closure commit touches it). Out of scope per prompt — only noted for completeness.

### Deviation assessment (ConfirmPairingInput.pairingToken OPTIONAL)

The executor of 01-05 deliberately made `ConfirmPairingInput.pairingToken` optional (`pairing-service.ts:391`) and moved the `verifyPairingTokenHash` call to AFTER the state-machine check (line 440, after line 415-427), both deviating from the plan's REQUIRED / BEFORE specification. The stated justification is that `apps/web/tests/auth-pairing.spec.ts:92-98` calls `confirmPairing` on an expired pairing without a token and must stay byte-identical per the orchestrator prompt.

**Assessment: SAFE at the HTTP boundary.** The confirm route handler enforces the bearer gate at `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:99-108` BEFORE calling `confirmPairing`:
```ts
const authHeader = request.headers.get("authorization") ?? "";
const bearer = authHeader.toLowerCase().startsWith("bearer ")
  ? authHeader.slice(7).trim()
  : "";
if (!bearer) {
  return NextResponse.json(
    { error: "missing_pairing_token" },
    { status: 401 },
  );
}
```
Any production HTTP caller reaches this 401 before ever touching `confirmPairing`. The state-check-before-bearer ordering inside the service function only matters for in-process test callers, and those tests (by construction) exercise the expired/state-transition branches first. A test that tried to exercise a `pending`/`redeemed` pairing without a bearer would now hit the line-440 fail-closed path (`verification_failed` thrown) — which is still safe, just with a different error string than the plan envisioned.

**Assessment: SAFE at the helper boundary.** `verifyPairingTokenHash` at `pairing-service.ts:297-307`:
1. Returns `false` for `null`/`undefined` input (line 301).
2. Computes sha256 hex BEFORE decoding buffers.
3. Length-checks buffers BEFORE `timingSafeEqual` (line 305) — prevents the exception that would otherwise leak timing info when stored and computed hashes differ in length (impossible in practice since both are sha256-hex, but defensive).

The deviation is acceptable and the inline docstring at lines 381-391 explains the rationale for future readers.

## Critical Issues

### CR-GAP-01: Confirm route is unreachable by any single principal — neither bridge nor browser can satisfy both the `auth()` session check AND the `Authorization: Bearer` pairing-token check

**File:** `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:47-108` (in combination with `apps/bridge/src/cli/pair.ts:152-155` and `apps/web/app/pair/[pairingId]/page.tsx`)

**Issue:** After plan 01-05 lands, the `/confirm` handler requires two credentials that no single caller in the current codebase possesses at the same time:

1. `auth()` at line 47-50 requires a valid `cm_web_session` cookie (Auth.js browser session). Only the authenticated browser on the phone has this.
2. `Authorization: Bearer <pairingToken>` at line 99-108 requires the one-time bearer returned by `POST /api/pairings`. Only the bridge CLI (which stores it in `PairingClient.pairingToken`) has this.

The bridge CLI does not have a `cm_web_session` cookie — it runs from a developer's terminal with no browser context. The browser pair page (`apps/web/app/pair/[pairingId]/page.tsx`) does NOT POST to `/confirm` from the client (its docstring at line 11-12 claims "Offer a single primary action that posts to the `/confirm` route" but the rendered JSX has no such form or handler — it only displays the phrase and a link back to `/`). The only actual caller of `/confirm` in the tree is `apps/bridge/src/cli/pair.ts:152-155`, which sends the bearer but not the cookie. The bridge's call will therefore:

- Be redirected to `/sign-in` by middleware (middleware requires auth for `/confirm` since it is NOT in `UNAUTHENTICATED_API_POST_PATHS`), OR
- If the middleware were somehow bypassed, return `401 { error: "unauthenticated" }` from the handler itself at line 48-50.

**This is a pre-existing architectural contradiction from Phase 01-02, NOT introduced by the gap closure.** The original `01-VERIFICATION.md` Truth #6 was flagged as FAILED primarily because of CR-01 (middleware blocking the bridge) and the missing GET handler. Both of those are now closed. But the deeper contradiction (no principal can complete confirm) persists, and plan 01-05's addition of the bearer requirement further cements it: even if the browser pair page were extended to POST to `/confirm`, it could not supply the bearer because the bearer is held only by the bridge CLI's process memory.

**Classification:** Critical (blocks the Phase 1 pairing flow from completing end-to-end). Surfaces as part of gap closure verification because the stated purpose of plans 01-04/05 was to "close" the verification report, and Truth #6 is still FAILED after the closure.

**Fix:** Pick one of the following designs explicitly before Phase 1 ships; the current state is an unresolved three-way inconsistency between `pair.ts`, `page.tsx`, and `confirm/route.ts`:

1. **Bridge is the confirmer (matches current CLI code path):** Drop the `auth()` check on `/confirm` and rely solely on the bearer + verification phrase for authorization. Add `/api/pairings/[pairingId]/confirm` to the middleware's `UNAUTHENTICATED_API_POST_PATHS` (method+path-equality match on the exact confirm pathname — do NOT widen the single-segment regex). Update the confirm handler to look up `confirmedByUserId` via the pairing row's `redeemedBy` rather than `session.user`. Update the middleware unit tests and add a positive case asserting the bridge can POST `/confirm` with only a bearer.

2. **Browser is the confirmer (matches the route comment + page docstring):** Add a client component inside `pair/[pairingId]/page.tsx` that POSTs to `/api/pairings/[id]/confirm` from the browser on user interaction. The browser will supply the `cm_web_session` cookie automatically. Remove the bearer requirement from the confirm handler OR have the bridge pass the bearer to the browser via a side channel (not viable — the bridge has no way to reach the browser without an inbound port, which ADR-0001 Rule 5 forbids). This is the docstring-intended design but there is no mechanism to get the bearer to the browser, so this option reduces to "remove the bearer gate on /confirm" — which contradicts plan 01-05.

3. **Revisit Option A:** Plan 01-05's "Option A lock" was designed specifically to avoid putting the bearer on the redeem path, on the assumption that the browser would call confirm with its cm_web_session. That assumption was never verified against the CLI's actual call site. Escalate to a design conversation: either the bridge is the confirmer (drop `auth()` on `/confirm`) or the browser is the confirmer (drop the bearer on `/confirm`). Both cannot be true.

Recommended: Option 1. It matches the existing bridge CLI code path, preserves the bearer-as-proof-of-create-token invariant, and only requires a narrow middleware edit + dropping the `auth()` guard. Option 2 is fundamentally blocked by the no-inbound-port rule.

**Reproduction:** With the current code, any real end-to-end run of `node apps/bridge/src/cli/pair.ts --base https://<web>` will fail at the confirm step with the bridge's `confirmPairing` throwing `POST /api/pairings/{id}/confirm failed: 401 unauthenticated` (or a redirect-to-HTML zod parse error before middleware 01-04 fix). This matches the `01-VERIFICATION.md` Truth #6 FAILED status — the gap closure partially addressed the symptom (middleware on create/status) but not the root cause (who confirms).

## Warnings

### WR-GAP-01: Rate-limit bucket map has no eviction — unbounded memory growth under IP rotation

**File:** `apps/web/lib/rate-limit.ts:26-66`

**Issue:** `const buckets = new Map<string, Bucket>();` is a process-global map keyed by client IP. Every unique IP creates an entry on the first `POST /api/pairings` call. Entries are **overwritten** when the window expires (line 47-49 replaces the bucket wholesale when `now - bucket.windowStart >= windowMs`), but they are **never deleted** — a caller that hits once and never returns leaves its entry in the map forever. An attacker rotating source IPs (trivial with a botnet, cloud IPv6 allocation, or even a single misbehaving client on a DHCP pool) can grow the map unboundedly and eventually OOM the `apps/web` container.

This is a Warning rather than a Critical because (a) the rate limiter itself is process-local and the `apps/web/lib/rate-limit.ts:10-14` docstring already calls out a Phase 1 single-machine caveat, (b) Fly machines restart often enough to release memory on a practical timescale, and (c) an attacker mounting an IP-rotation attack would likely saturate the Fly edge long before OOMing the process. But it is still a correctness gap in the abuse-floor module — the original WR-11 fix introduces a new surface.

**Fix:** Add a simple sweep: on every `checkPairingCreateRateLimit` call, walk the map once and delete any bucket whose `windowStart + windowMs` is older than `now`. Bound by a maximum map size (e.g., 10_000 entries) and evict the oldest bucket when the cap is hit. Alternatively, lazily evict in a setInterval guarded by `process.env.NODE_ENV !== "test"`.

```ts
function evictExpired(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}
// Call evictExpired(now, windowMs) once per check (cheap — map is bounded
// to active callers) OR run a periodic sweep on a timer.
```

Add a unit test that creates 1000 unique keys, rolls the clock past the window, calls the limiter, and asserts `buckets.size` shrinks.

### WR-GAP-02: Confirm route still echoes raw error messages on the fallthrough 500

**File:** `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:182`

**Issue:** The gap closure mostly fixed the original WR-01 finding — known error substrings are now mapped to fixed error codes (`pairing_not_found`, `invalid_pairing_token`, `invalid_state`, `phrase_mismatch`, `not_redeemed`) — but the fallthrough branch at line 182 still does:
```ts
return NextResponse.json({ error: message }, { status: 500 });
```
Any future error string that doesn't match the substring allowlist (e.g., a new Drizzle error, a fetch timeout, or a stack-fragment assertion) will still be reflected back to the caller. The GET status handler (`[pairingId]/route.ts:77-81`) does the right thing — returns `{ error: "internal_error" }` and logs the real error internally. The redeem handler at `redeem/route.ts:118` has the same issue as confirm.

**Fix:** Replace the fallthrough branches in both `confirm/route.ts:182` and `redeem/route.ts:118` with the pattern already used by the new GET handler:
```ts
console.error("pairing confirm internal_error", error);
return NextResponse.json({ error: "internal_error" }, { status: 500 });
```
This finalizes the WR-01 remediation for the two remaining handlers.

### WR-GAP-03: `PairingStatusResponseSchema.safeParse` uses `.strict()` but service returns `userCode` — parse will strip the field silently

**File:** `apps/web/app/api/pairings/[pairingId]/route.ts:49-54`, `apps/web/app/api/pairings/[pairingId]/redeem/route.ts:93-98`, and `packages/protocol/src/pairing.ts:107-114`

**Issue:** `PairingStatusResponseSchema` is defined as `.strict()` in `packages/protocol/src/pairing.ts:108-114` and contains only `pairingId`, `status`, `expiresAt`, and `verificationPhrase`. `apps/web/lib/pairing-service.ts:562-571` (`toStatusResponse`) returns an object that also includes `userCode`. Both the GET handler at `[pairingId]/route.ts:49-54` and the redeem handler at `redeem/route.ts:93-98` pass explicitly-constructed subset objects to `safeParse`, so they currently drop `userCode` before parsing — fine. But the pair page at `apps/web/app/pair/[pairingId]/page.tsx:87` reads `pairing.userCode` from the return value of `redeemPairing`/`loadPairingStatus`, which still includes it because those helpers return `PairingStatusResponse & { userCode: string }`.

The protocol schema in `packages/protocol/src/pairing.ts` is the shared contract and does NOT model `userCode` on the status response. This inconsistency means:

1. Bridge CLI clients that validate `PairingStatusResponseSchema` cannot read `userCode` from the polling payload — they have it already from `createPairing`, so it's benign for the bridge.
2. Any future caller that does validate the status response against the schema will lose the field silently on the wire.
3. The server-side `toStatusResponse` helper returning an extra field that the schema strips invites a subtle drift the next time someone changes the schema.

**Fix:** Pick one:
1. Add `userCode: z.string().min(4).optional()` to `PairingStatusResponseSchema` in `packages/protocol/src/pairing.ts:107-114` and drop the `.strict()` if a wider drift is acceptable — OR keep `.strict()` and explicitly include `userCode` in the TS interface.
2. Remove `userCode` from `toStatusResponse` and have the pair page fetch it via a separate call. Changes the pair page but cleans up the contract.

Option 1 is less invasive and matches the server's current behavior. This is a Warning rather than Info because a future refactor that removes the manual subset construction in the handlers (a reasonable simplification) would start actually sending `userCode` on the wire, which would break strict parsers in the bridge.

## Info

### IN-GAP-01: Rate limiter is not reset between tests (beyond the exported helper)

**File:** `apps/web/lib/rate-limit.ts:28-31`

`__resetRateLimitBuckets` is exported for tests to clear state, which is good. However, the POST `/api/pairings` route does not call it automatically, and there is no Vitest global beforeEach hook in the scope of this review that wires it. If any test file exercises `POST /api/pairings` twice in the same process without resetting buckets, the second test may see rate-limited 429s. Document the reset requirement in the header comment, or (better) add a test fixture that resets buckets in a `beforeEach` for any file that touches the pairings route.

### IN-GAP-02: Origin header parsing uses `new URL(origin)` without a try/catch around the outer `if`

**File:** `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:62-75` and `redeem/route.ts:54-67`

The inner `try/catch` correctly handles a malformed Origin header by returning 403, and the outer `if (origin && host)` skips the check when Origin is absent. This is correct defensive coding. One minor clarity note: the inline comment at line 56-58 says "A missing Origin header is permitted — Node fetch and curl do not send Origin, and the bearer + cm_web_session cookie already gate the route." This is accurate for the confirm route (which requires bearer + session) but the redeem route at `redeem/route.ts:51` only requires `cm_web_session`, not the bearer. The copy-pasted comment is slightly misleading for the redeem route — it should say "the cm_web_session cookie already gates the route" without mentioning the bearer, since redeem is bearer-free by the Option A lock. Pure documentation hygiene.

### IN-GAP-03: `userCode` fallback in `redeem/route.ts` validated subset drops `userCode` — pair page relies on it coming from `toStatusResponse`

**File:** `apps/web/app/api/pairings/[pairingId]/redeem/route.ts:93-109`

See WR-GAP-03 above. The handler constructs a subset of the service's return value for the `safeParse` call but returns the validated subset via `NextResponse.json(validated.data, ...)`. The pair page's server-component call path goes through `redeemPairing` directly and does not pass through this HTTP handler, so the pair page still has `userCode` available. This is correct behavior today but brittle: if the pair page ever switches to fetching via the HTTP handler (to align with the "move redeem off server component" WR-06 fix) it will lose `userCode` silently. Linked to WR-GAP-03.

---

## Outstanding gaps (still OPEN after gap closure)

The following items from the original `01-REVIEW.md` / `01-VERIFICATION.md` remain open and are NOT in scope for this re-review, but are listed here so the orchestrator knows the full picture:

- **WR-06** — Pairing redeem on GET (server component) link-prefetcher risk. Out of scope; `pair/[pairingId]/page.tsx` not reviewed. Still open.
- **WR-08** — Default `InMemoryPairingStore` for `pairing-service.ts` has no production guard. `lib/rate-limit.ts` documents its single-machine caveat in-file but `lib/pairing-service.ts:183` still creates the default in-memory store unconditionally. Still open, aggravated by the fact that now BOTH the pairing store AND the rate limiter are process-local, so a multi-machine deploy has two independent sources of inconsistency.
- **WR-05** — `callbackUrl` pass-through open-redirect hardening. `sign-in/page.tsx` not in scope. Still open.
- **IN-03** — `uptimeSeconds` in healthz responses. Not in scope. Still open.
- **IN-04** — `deviceLabel` authoritative source in `confirmPairing`. Not in scope. Still open.
- **IN-05** — Cookie secret encoding documentation. Related to the now-closed WR-03; the encoding note at `device-session.ts:92-101` documents byte-length gating but does not document the preferred encoding (base64url vs hex). Minor, still open.
- **IN-06** — Dockerfile `--experimental-strip-types` runtime. Out of scope. Still open.
- **IN-07** — `stdinApprovalPrompt` SIGINT race. Not in scope (bridge CLI). Still open.
- **IN-08** — Sign-in error param display. Not in scope. Still open.
- **IN-09** — Phase 1 test suite gated on `CODEX_MOBILE_E2E_LIVE`. The new unit tests (`middleware-public-paths.test.ts`, `pairings-status-route.test.ts`) are NOT gated on the live env var, so they partially close IN-09 for the middleware allowlist and GET-handler invariants. Full e2e redirect test still gated — still partially open.

## Files reviewed

All 13 files in the `files:` config block were read and analyzed at standard depth. No source files were modified; only the review artifact at `.planning/phases/01-identity-pairing-foundation/01-REVIEW-GAP.md` was written.

---

_Reviewed: 2026-04-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Review type: gap-closure re-review of plans 01-04 / 01-05 / 01-06_
