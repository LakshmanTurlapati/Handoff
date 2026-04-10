---
phase: 01-identity-pairing-foundation
plan: 05
subsystem: pairing-bearer-csrf-ratelimit-secretgate
tags: [sec-06, wr-02, wr-03, wr-09, wr-11, in-02, gap-closure, bearer, csrf, rate-limit]
gap_closure: true
wave: 2
depends_on: ["01-04"]
requirements: [SEC-06, SEC-01, PAIR-03, AUTH-02]
dependency_graph:
  requires:
    - packages/protocol/src/pairing.ts
    - apps/web/lib/pairing-service.ts
    - apps/web/lib/device-session.ts
    - apps/web/app/api/pairings/route.ts
    - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
    - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
    - apps/bridge/src/lib/pairing-client.ts
  provides:
    - One-time pairingToken bearer plumbed end-to-end on the confirm path
    - verifyPairingTokenHash helper using crypto.timingSafeEqual
    - Same-origin CSRF guard on both redeem and confirm routes
    - In-memory token-bucket rate limiter for POST /api/pairings (10 / 60s / IP)
    - 32-byte minimum gate on SESSION_COOKIE_SECRET after UTF-8 encoding
    - PairingPollError class + error-propagating waitForRedeem loop
  affects:
    - apps/bridge/src/cli/pair.ts (outer try now sees real HTTP status on poll failure)
tech-stack:
  added: []
  patterns:
    - "One-time bearer token returned in create response, carried in memory only, verified via timingSafeEqual on sha256 of the bearer"
    - "Server-side Origin-vs-Host CSRF check permitting missing Origin (Node fetch/curl) but rejecting mismatched host"
    - "Process-local token-bucket rate limiter keyed by x-forwarded-for with single-machine caveat documented inline"
    - "Typed PairingPollError carrying HTTP status so callers can distinguish transient 5xx from hard 4xx"
key-files:
  created:
    - apps/web/lib/rate-limit.ts
  modified:
    - packages/protocol/src/pairing.ts
    - apps/web/lib/pairing-service.ts
    - apps/web/lib/device-session.ts
    - apps/web/app/api/pairings/route.ts
    - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
    - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
    - apps/bridge/src/lib/pairing-client.ts
decisions:
  - "Placed verifyPairingTokenHash AFTER the state-machine check inside confirmPairing (deviation from plan <action> which said BEFORE) to preserve the orchestrator-locked byte-identical auth-pairing.spec.ts. The expired test asserts rejects.toThrow(/expired/) on a confirmPairing call with no pairingToken; with verify-first the call would throw 'verification_failed' and the test would break. Security envelope is preserved because the HTTP confirm route 401s on missing Authorization before confirmPairing is reached, so all real traffic is bearer-gated; only in-process test callers that deliberately exercise non-bearer failure paths skip the bearer branch, and they still fail closed via the state check."
  - "Made ConfirmPairingInput.pairingToken OPTIONAL (pairingToken?: string) instead of the plan's REQUIRED spec for the same reason as above. Required-on-the-type would force updates to auth-pairing.spec.ts, which the orchestrator prompt explicitly locks byte-identical. The runtime check inside confirmPairing still fails closed when pairingToken is undefined AND the pairing is in a state where verification would otherwise succeed."
  - "Same-origin CSRF guard treats a MISSING Origin header as permitted, not hostile. Node's fetch and curl do not send Origin by default and the routes are still protected by cm_web_session (via auth()) plus the bearer token on confirm. Only a PRESENT Origin whose host differs from the Host header is rejected with 403 cross_origin_not_allowed."
  - "Rate limiter is process-local in-memory. Multi-machine Fly deploys need a Redis-backed counter. The single-machine limitation is documented inline in rate-limit.ts and a README callout is deferred to plan 01-06 (per 01-05-PLAN <deferred>)."
  - "Bridge client does NOT expose a redeem method and does NOT send the bearer on any /redeem path. The redeem transition is driven exclusively by the phone browser's server component via direct service call (apps/web/app/pair/[pairingId]/page.tsx -> redeemPairing). This is the Option A lock the orchestrator re-stated in critical_design_lock."
metrics:
  duration: "6m29s"
  tasks_completed: 3
  files_created: 1
  files_modified: 7
  commits: 3
  completed: "2026-04-10T22:39:58Z"
---

# Phase 01 Plan 05: Pairing Bearer, CSRF, Rate Limit, and Cookie-Secret Gate Summary

**One-liner:** Closes the SEC-06 semantic gap plus four companion warnings from 01-REVIEW.md (WR-02 Origin/CSRF, WR-03 weak cookie secret, WR-09 swallowed polling errors, WR-11 missing rate limit) by making the server mint a one-time pairing bearer that the bridge carries in memory and echoes as `Authorization: Bearer` on `POST /api/pairings/[id]/confirm`, where the server verifies `sha256(bearer) == pairing_sessions.pairingTokenHash` via `crypto.timingSafeEqual` before issuing `cm_device_session`. The redeem path, the phone browser server component, and the Playwright redeem test stay byte-identical under the Option A lock.

## Objective Recap

Before this plan the `pairing_sessions.pairingTokenHash` column was dead code: `createPairing` generated a 32-byte random token, hashed it, and discarded the raw. The confirm route minted `cm_device_session` on possession of the pairing UUID alone, which is exactly what SEC-06 and ADR-0001 Rule 3 say MUST NOT be the case. In addition:

- The confirm route had no Origin/CSRF defense in depth (WR-02).
- `loadSessionCookieSecret` accepted 16-character secrets (WR-03).
- `POST /api/pairings` had no abuse floor (WR-11).
- `waitForRedeem` swallowed every polling error as `null` so operators saw "timed out" for every failure mode (WR-09).

After this plan the confirm path is bearer-gated end-to-end, both cookie-affecting routes enforce same-origin, the rate limiter raises the abuse floor to 10 creates per minute per IP per machine, the cookie secret minimum is 32 bytes after UTF-8 encoding, and the bridge CLI's outer error handler now sees the real HTTP status on poll failures.

## Work Completed

### Task 1 — One-time pairing bearer plumbed through protocol + pairing-service + create/confirm routes (`3e7d405`)

**Files modified:**
- `packages/protocol/src/pairing.ts`
- `apps/web/lib/pairing-service.ts`
- `apps/web/app/api/pairings/route.ts`
- `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`

**In `packages/protocol/src/pairing.ts`:**
- Extended `PairingCreateResponse` interface with an optional `pairingToken?: string` field. Optional so older bridge parses still succeed; the server always populates it after this plan lands.
- Extended `PairingCreateResponseSchema` with `pairingToken: z.string().min(32).optional()`. Kept the `.strict()` chain intact.

**In `apps/web/lib/pairing-service.ts`:**
- Imported `timingSafeEqual` from `node:crypto` alongside the existing `createHash`, `randomBytes`, `randomUUID` imports.
- Rewrote `constantTimeEqual(a, b)` to delegate to `timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))`. The hand-rolled `charCodeAt` loop is gone. All existing callers of `constantTimeEqual` (the verification phrase check in confirmPairing) continue to work unchanged.
- Added a new exported helper `verifyPairingTokenHash(rawToken, storedHashHex)` that returns `false` on null/undefined input, hashes the raw token with sha256, and compares the resulting hex against the stored hex via `timingSafeEqual` on Buffer decodings. Length-checks first so `timingSafeEqual` never throws.
- Changed `createPairing`'s return type from `Promise<PairingCreateResponse & { pairingTokenHash: string }>` to `Promise<PairingCreateResponse & { pairingTokenHash: string; pairingToken: string }>` and added `pairingToken: rawPairingToken` to the returned object alongside the existing fields. The hash is still returned so tests (and any future caller) can still assert on it.
- `RedeemPairingInput` and the entire `redeemPairing` function body are byte-identical to the base commit. Verified via `awk` range extraction — no `verifyPairingTokenHash` inside the function body.
- Extended `ConfirmPairingInput` with an optional `pairingToken?: string` field (deviation — see "Deviations" section below). Docstring explains why the field is optional at the type level while the runtime check still fails closed.
- Inserted a `verifyPairingTokenHash` call inside `confirmPairing` AFTER the state-machine check and BEFORE the `row.verificationPhrase` null check (deviation — see "Deviations" section below). A missing or mismatched token writes a `pairing.confirm_failed` audit row with `metadata.reason === "invalid_pairing_token"` and throws `pairing token verification_failed`, which the HTTP route maps to 403.

**In `apps/web/app/api/pairings/route.ts`:**
- Extended the file-level security comment block with a new bullet explaining the one-time bearer flow, containing the exact literal string `one-time bearer` (required by Task 1 acceptance criterion).
- Added `pairingToken: result.pairingToken` to the `responseBody` construction so `PairingCreateResponseSchema` validates the new field on the way out.

**In `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`:**
- Extracted the bearer from the `Authorization` header after body parsing and before calling `confirmPairing`. A missing or malformed header returns `401 { error: "missing_pairing_token" }`.
- Passed `pairingToken: bearer` into the `confirmPairing({ ... })` call alongside the existing `pairingId`, `userId`, `verificationPhrase`, `deviceLabel` fields.
- Added a `message.includes("verification_failed")` branch in the catch block that returns `403 { error: "invalid_pairing_token" }`. Placed after the `"not found"` branch and before the generic `"cannot confirm"` branch.

**NOT modified in Task 1 (verified with `git diff`):**
- `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` — Task 2 adds only a same-origin guard; no bearer extraction.
- `apps/web/app/pair/[pairingId]/page.tsx` — Option A locked.
- `apps/web/tests/auth-pairing.spec.ts` — Option A locked.

### Task 2 — Same-origin CSRF guard, in-memory rate limit, 32-byte cookie secret gate (`ddb970d`)

**Files created:**
- `apps/web/lib/rate-limit.ts`

**Files modified:**
- `apps/web/lib/device-session.ts`
- `apps/web/app/api/pairings/route.ts`
- `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`
- `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`

**In `apps/web/lib/device-session.ts`:**
- Rewrote `loadSessionCookieSecret` to encode the raw env value via `TextEncoder`, then gate on `bytes.byteLength < 32`. The old `raw.length < 16` string-length check is gone. Updated the JSDoc block to explain the WR-03 fix and reference the review document. An operator who supplies a 16-character password-style secret will now crash at first cookie operation with a clear error message instead of silently minting weak HS256 HMACs.

**In the new `apps/web/lib/rate-limit.ts`:**
- File matches the plan's embedded spec exactly: module-level `Map<string, Bucket>` state, `RateLimitResult` interface, `__resetRateLimitBuckets` test helper, `checkPairingCreateRateLimit(key, options)` with `limit=10` and `windowMs=60_000` defaults, `extractClientIp(request)` that prefers the first entry of `x-forwarded-for`, falls back to `x-real-ip`, and finally returns the literal `"unknown"` so unknown callers still get rate-limited under a shared key.
- Header comment documents the single-machine caveat and points to the README callout deferred to plan 01-06.

**In `apps/web/app/api/pairings/route.ts`:**
- Imported `checkPairingCreateRateLimit` and `extractClientIp` from `../../../lib/rate-limit` (matches the existing `../../../lib/pairing-service` import style).
- Called the limiter at the very top of the `POST` handler, before body parsing. When `rl.allowed === false` the route returns `429 { error: "rate_limited" }` with a computed `retry-after` header.

**In `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`:**
- Added the same-origin check immediately after the `auth()` session check and before reading `context.params`, matching the plan's action spec exactly. A missing `Origin` header is permitted. A present `Origin` whose host differs from the `Host` header returns `403 { error: "cross_origin_not_allowed" }`. A malformed `Origin` (throws inside `new URL(origin)`) also returns 403.

**In `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`:**
- Applied the identical same-origin guard in the same position. The redeem route stays bearer-free per the Option A lock — no `Authorization` header extraction, no `Bearer` string, no `verifyPairingTokenHash` call. Verified via grep.

### Task 3 — Bridge client carries pairing bearer and propagates waitForRedeem errors (`c417fe6`)

**File modified:**
- `apps/bridge/src/lib/pairing-client.ts`

- Added a private `pairingToken: string | null = null` field on `PairingClient` with a docstring explaining the in-memory-only contract (no disk, no logging, no query params).
- Added a public `setPairingToken(token: string | null)` setter so tests can drive the field directly and so the setter call site is explicit (grep-able).
- Added a private `authHeaders()` helper returning `{ authorization: "Bearer <token>" }` when the token is non-null and `{}` otherwise, so callers can unconditionally spread the result into their headers object.
- `createPairing`: after the `PairingCreateResponseSchema.safeParse` succeeds, calls `this.setPairingToken(parsed.data.pairingToken)` if the server provided one. The parsed response is still returned unchanged so callers can access `.pairingToken` directly if they want.
- `getPairingStatus`: spreads `...this.authHeaders()` into the request headers, and throws a new `PairingPollError` (instead of a generic `Error`) on `!response.ok`. The error carries the HTTP status code and the request path.
- `confirmPairing`: spreads `...this.authHeaders()` into the request headers alongside the existing `cookie` spread, so the bridge always sends the bearer on confirm.
- Added a new exported `class PairingPollError extends Error` with readonly `status: number` and `path: string` fields, plus a header docstring explaining WR-09.
- Rewrote the `waitForRedeem` polling loop: a `try { status = await this.getPairingStatus(pairingId); } catch (err) { ... }` block replaces the old `.catch(() => null)` line. Inside the catch: `PairingPollError` instances with `err.status >= 500` are treated as transient and retried (status set to null, loop sleeps and polls again). Every other error — including 4xx PairingPollErrors, schema failures, and network errors — is re-thrown so the operator sees the real failure instead of a generic timeout.
- Did NOT add any redeem method. No `/redeem` path constant. The bridge still never calls the redeem endpoint — the browser drives that transition via the server component.
- `apps/bridge/src/cli/pair.ts` is byte-identical. Its existing outer `try` that calls `client.waitForRedeem` now automatically sees the propagated error.

## Key Links Verified

| From                                              | To                                                                  | Via                                                   | Status |
| ------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| `apps/web/app/api/pairings/route.ts`              | `apps/web/lib/pairing-service.ts`                                   | `createPairing` return shape now includes `pairingToken` | WIRED  |
| `apps/bridge/src/lib/pairing-client.ts`           | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`            | `Authorization: Bearer` header; server extracts and forwards to `confirmPairing` | WIRED |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | `apps/web/lib/pairing-service.ts`                                   | `confirmPairing({ pairingToken: bearer, ... })`       | WIRED |
| `apps/web/lib/pairing-service.ts` `confirmPairing` | `apps/web/lib/pairing-service.ts` `verifyPairingTokenHash`          | `timingSafeEqual(Buffer, Buffer)` on sha256 hex       | WIRED |
| `apps/web/app/api/pairings/route.ts`              | `apps/web/lib/rate-limit.ts`                                        | `checkPairingCreateRateLimit` + `extractClientIp`     | WIRED |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | (self)                                                              | same-origin guard before `context.params` read        | WIRED |
| `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`  | (self)                                                              | same-origin guard before `context.params` read        | WIRED |
| `apps/web/lib/device-session.ts`                  | `process.env.SESSION_COOKIE_SECRET`                                 | `bytes.byteLength < 32` gate                          | WIRED |
| `apps/bridge/src/lib/pairing-client.ts`           | `apps/bridge/src/lib/pairing-client.ts` `PairingPollError`          | `waitForRedeem` retries 5xx, propagates 4xx           | WIRED |

## Truths Now Structurally Reachable

| # | Truth                                                                                                                                    | Effect of plan 01-05 |
| - | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 8 | "All browser and pairing routes use short-lived or cookie-based credentials rather than query-string bearer tokens."                    | The one-time pairing bearer is now actually verified server-side. `rawPairingToken` generation is no longer dead code. Possession of the pairing UUID alone is insufficient to mint `cm_device_session` — the bridge must ALSO present the bearer it received at create time in the `Authorization` header. |
| 7 | "A device session is issued only after both the browser and terminal see the same verification phrase and the terminal explicitly approves." | Same-origin guard added to confirm route (WR-02). A cross-origin top-level POST that slips past SameSite=Lax is now rejected with 403 `cross_origin_not_allowed`. The phrase comparison and cookie issuance paths remain unchanged. |

Truths #5, #6, and #10 (the "end-to-end bridge flow" truths) were made STRUCTURALLY reachable by plan 01-04 and remain structurally reachable after this plan. Runtime verification against a live Fly deploy is still gated on human verification per the user's "never run applications automatically" rule.

## Deviations from Plan

### [Rule 2 - Correctness] Orchestrator-locked test file conflicts with plan's bearer-check ordering

**Found during:** Task 1 planning, before any code was written.

**Issue:** The plan's Task 1 acceptance criteria specify `ConfirmPairingInput.pairingToken: string` (REQUIRED, no `?`) and state that `verifyPairingTokenHash` must be called BEFORE the state-machine check inside `confirmPairing`. The orchestrator prompt's `<critical_design_lock>` and `<success_criteria>` sections explicitly require `apps/web/tests/auth-pairing.spec.ts` to be byte-identical to the base commit (`git diff ... is empty`).

The existing test file calls `confirmPairing({ pairingId, userId, verificationPhrase }, ctx)` WITHOUT a `pairingToken` field on an already-expired pairing and asserts `rejects.toThrow(/expired/)`. With the plan's REQUIRED + BEFORE ordering:
1. TypeScript compilation of the Playwright spec would fail because the required field is missing at the call site.
2. Even with the field optional, running the check BEFORE the state-machine branch would make the expired test throw `pairing token verification_failed` instead of `cannot confirm pairing in state expired`, breaking the `/expired/` regex assertion.

**Fix applied:**
1. Made `ConfirmPairingInput.pairingToken` OPTIONAL (`pairingToken?: string`). Docstring explains the rationale and points to the runtime fail-closed behavior.
2. Moved the `verifyPairingTokenHash` call AFTER the state-machine check and BEFORE the `row.verificationPhrase` null check. A bad bearer still never reaches the phrase comparison or `issueDeviceSession`, so the security envelope (no cookie issuance on bearer failure) is preserved. The only observable difference vs. the plan's ordering is that a bad bearer on an expired pairing now throws `cannot confirm` instead of `verification_failed` — a mild information leak about state that is NOT a credential exposure.
3. Kept the plan's security envelope intact at the HTTP boundary: the `POST /confirm` route still extracts `Authorization: Bearer` and 401s on missing header BEFORE reaching `confirmPairing`. All production traffic is bearer-gated; only in-process test callers that intentionally exercise non-bearer failure paths can skip the bearer branch, and they still fail closed via the state check.

**Files modified:** `apps/web/lib/pairing-service.ts`

**Commit:** `3e7d405`

**Scope:** Deviation is isolated to `ConfirmPairingInput` interface shape and `verifyPairingTokenHash` placement inside `confirmPairing`. No other files affected. The orchestrator's success criteria (empty diff for auth-pairing.spec.ts, verifyPairingTokenHash defined and called inside confirmPairing ONLY, NOT in redeemPairing; pairingToken on ConfirmPairingInput AND PairingCreateResponse optional but NOT on RedeemPairingInput) are all satisfied.

### [Minor - Comment hygiene] Reworded PairingPollError docstring to avoid `.catch(() => null)` literal

**Found during:** Task 3 verification.

**Issue:** The plan's Task 3 `<verify>` grep command is `! grep -n "\.catch(() => null)" apps/bridge/src/lib/pairing-client.ts` — it must return zero matches anywhere in the file, including comments. My first pass of the PairingPollError header docstring explained WR-09 by quoting the old `.catch(() => null)` literal, which caused the verify to fail.

**Fix:** Reworded the docstring to describe the old behavior prose-first ("silently swallowed every failure mode by catching and coercing to null") without quoting the exact literal. Semantically identical, grep-clean.

**Files modified:** `apps/bridge/src/lib/pairing-client.ts`

**Commit:** `c417fe6` (combined with the main Task 3 work)

**Scope:** One docstring inside PairingPollError's header comment. No behavioral change.

## Authentication Gates

None encountered during execution. No task attempted `npm install`, `next build`, `vitest`, `fly deploy`, or `docker build`.

## Security Notes

- **Bearer lifetime:** The raw pairing token is returned exactly once in the `POST /api/pairings` response, held only in `PairingClient.pairingToken` (process memory), and sent on every subsequent `getPairingStatus` and `confirmPairing` call as `Authorization: Bearer <token>`. It is never written to disk, never logged, and never sent as a query parameter. The token's lifetime is bounded by the 5-minute pairing TTL (PAIR-03).
- **Same-origin guard:** A MISSING Origin header is permitted on both confirm and redeem routes. This is load-bearing: Node's built-in fetch and curl do not send Origin, and the bridge CLI uses Node fetch. The routes are still protected by `cm_web_session` via `auth()` (both routes) AND the one-time bearer (confirm only). Only a PRESENT Origin whose host differs from the Host header is rejected.
- **Rate limiter scope:** Process-local token bucket, 10 creates per 60 seconds per IP per machine. Multi-machine Fly deploys need a Redis-backed counter; single-machine caveat is documented inline in `rate-limit.ts` and the README callout is deferred to plan 01-06. For Phase 1 (which is the dev-only hosted stack), this is enough to raise the abuse floor from "trivial" to "per-machine non-trivial".
- **Cookie secret gate:** The 32-byte minimum is enforced at `loadSessionCookieSecret` call time, which happens from `issueDeviceSession` on every confirm call AND from `readDeviceSession` on every middleware cookie lookup. Misconfigured deploys will crash loudly at first real traffic instead of silently minting weak HMACs.
- **Error propagation on poll:** `waitForRedeem` now throws on any non-5xx failure, so a misconfigured base URL, expired OAuth, 403 cross-origin rejection, 429 rate limit hit, or 404 pairing-not-found are all surfaced to the operator as typed `PairingPollError` exceptions with readable HTTP status strings instead of the previous generic "timed out" symptom.

## Deferred Issues

None encountered during execution beyond the items already listed in `01-05-PLAN.md` `<deferred>`:
- Dockerfile `|| true` and GitHub Actions shell injection (CR-02/CR-03) — covered by 01-06.
- README single-machine pairing store + single-machine rate-limit callouts — covered by 01-06.
- Drizzle-backed pairing store (WR-08) — deferred to a later phase.
- Raw-error leakage on confirm/redeem 500 fallthrough (WR-01 on existing branches) — out of plan 01-05's scope.
- Server-component GET redeem prefetcher risk (WR-06) — out of scope.
- `callbackUrl` open-redirect hardening (WR-05) — out of scope.
- `trustProxy: true` on relay Fastify (WR-10) — out of scope.
- Bearer verification on the bridge's GET `/api/pairings/[id]` polling calls — the bridge SENDS the bearer in Task 3, but the server-side GET handler is not required to verify it in this plan; that's a defense-in-depth follow-up.

## Verification Checklist (from plan `<verification>`)

- [x] `packages/protocol/src/pairing.ts` contains `pairingToken` on `PairingCreateResponse` interface and Zod schema (verified via grep: line 64 interface, line 73 schema)
- [x] `apps/web/lib/pairing-service.ts` imports `timingSafeEqual` and exports `verifyPairingTokenHash` (verified via grep: line 35 import, line 297 export)
- [x] `apps/web/lib/pairing-service.ts` `confirmPairing` calls `verifyPairingTokenHash` (verified via grep: line 440 inside `confirmPairing`) — **Note: placed AFTER state check, not BEFORE, as a deliberate deviation documented above.**
- [x] `apps/web/lib/pairing-service.ts` `redeemPairing` is UNCHANGED — no bearer verification, no new audit row, no `pairingToken` in `RedeemPairingInput` (verified via `awk` range extraction of the function body)
- [x] `apps/web/app/pair/[pairingId]/page.tsx` is NOT touched by any task (verified via `git diff ... is empty`)
- [x] `apps/web/tests/auth-pairing.spec.ts` redeem-flow test still calls `redeemPairing({ pairingId, userId })` without a bearer (verified via `git diff ... is empty` — whole file byte-identical)
- [x] `apps/web/lib/rate-limit.ts` exists and exports `checkPairingCreateRateLimit` and `extractClientIp` (verified via `test -f` and grep)
- [x] `apps/web/lib/device-session.ts` enforces a 32-byte minimum after UTF-8 encoding (verified via grep: line 108 `bytes.byteLength < 32`)
- [x] Both `/redeem` and `/confirm` routes contain `cross_origin_not_allowed` right after the `auth()` check (verified via grep: confirm lines 65/71, redeem lines 57/63)
- [x] The `/redeem` route contains NO `Bearer` or `authorization` string (verified via grep: zero matches)
- [x] The `/confirm` route extracts `Authorization: Bearer` and passes it as `pairingToken` into `confirmPairing` (verified via grep: lines 74 authorization extraction, pairingToken: bearer inside the confirmPairing call)
- [x] `apps/bridge/src/lib/pairing-client.ts` carries the token as `Authorization: Bearer` on `getPairingStatus` and `confirmPairing` and throws a typed `PairingPollError` on non-5xx failures (verified via grep)
- [x] No task attempted `npm install`, `next build`, `vitest`, `fly deploy`, or `docker build`.

## Commits

| Task | Commit    | Message                                                                       |
| ---- | --------- | ----------------------------------------------------------------------------- |
| 1    | `3e7d405` | `feat(01-05): plumb one-time pairing bearer token end-to-end on confirm`      |
| 2    | `ddb970d` | `feat(01-05): add same-origin CSRF guard, create rate limit, 32-byte secret gate` |
| 3    | `c417fe6` | `feat(01-05): carry pairing bearer and propagate waitForRedeem errors`        |

## Known Stubs

None. All code paths introduced by this plan are fully wired:

- `pairingToken` is generated in `createPairing`, returned to the HTTP caller by `POST /api/pairings`, stored on `PairingClient`, sent in `Authorization: Bearer` on subsequent `getPairingStatus` and `confirmPairing` calls, extracted by the confirm route, passed as `ConfirmPairingInput.pairingToken`, and verified by `verifyPairingTokenHash` against the stored `pairing_sessions.pairingTokenHash`. No mocked data anywhere on the path.
- `checkPairingCreateRateLimit` is called from the real `POST /api/pairings` handler with a real `extractClientIp(request)` key. The in-memory buckets are process state; no mock store.
- `loadSessionCookieSecret` is called from real `issueDeviceSession` and `readDeviceSession` code paths.
- `PairingPollError` is thrown from real `getPairingStatus` when `!response.ok` and caught by real `waitForRedeem` logic.

## Self-Check: PASSED

Verified via shell checks after the final commit (commands run via `grep -n` and `git diff`):

- `apps/web/lib/rate-limit.ts` — FOUND
- `.planning/phases/01-identity-pairing-foundation/01-05-SUMMARY.md` — FOUND (this file)
- `packages/protocol/src/pairing.ts` — FOUND (modified, grep confirms `pairingToken` on interface and schema)
- `apps/web/lib/pairing-service.ts` — FOUND (modified, grep confirms `verifyPairingTokenHash` defined and called inside `confirmPairing` only)
- `apps/web/lib/device-session.ts` — FOUND (modified, grep confirms `bytes.byteLength < 32`)
- `apps/web/app/api/pairings/route.ts` — FOUND (modified, grep confirms `checkPairingCreateRateLimit`, `rate_limited`, `pairingToken`, `one-time bearer`)
- `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` — FOUND (modified, grep confirms `cross_origin_not_allowed`, `missing_pairing_token`, `invalid_pairing_token`, `authorization` extraction, `pairingToken: bearer`)
- `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` — FOUND (modified, grep confirms `cross_origin_not_allowed` and zero `Bearer`/`authorization` matches)
- `apps/bridge/src/lib/pairing-client.ts` — FOUND (modified, grep confirms `PairingPollError`, `setPairingToken`, `authorization`, `err.status >= 500`, zero `.catch(() => null)` matches)
- `apps/web/app/pair/[pairingId]/page.tsx` — byte-identical (empty `git diff` against base)
- `apps/web/tests/auth-pairing.spec.ts` — byte-identical (empty `git diff` against base)
- `apps/bridge/src/cli/pair.ts` — byte-identical (empty `git diff` against base)
- `resources/` — untouched (empty `git diff --stat` against base)
- Commit `3e7d405` (Task 1) — FOUND in git log
- Commit `ddb970d` (Task 2) — FOUND in git log
- Commit `c417fe6` (Task 3) — FOUND in git log
