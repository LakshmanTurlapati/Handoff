---
phase: 01-identity-pairing-foundation
verified: 2026-04-11T23:10:00Z
status: human_needed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 6/11
  iteration: 2
  gaps_closed:
    - "CR-01: Middleware now allowlists POST /api/pairings by set-equality and GET /api/pairings/[id] by single-segment regex. Closed by 01-04."
    - "Missing GET /api/pairings/[pairingId] handler now exists at apps/web/app/api/pairings/[pairingId]/route.ts and is consumed by bridge PairingClient.getPairingStatus(). Closed by 01-04."
    - "SEC-06 / IN-02: One-time pairing bearer plumbed end-to-end. createPairing returns rawPairingToken in POST /api/pairings response body; bridge PairingClient stores it in process memory; sends Authorization: Bearer on getPairingStatus + confirmPairing; confirm route extracts bearer and passes to confirmPairing which verifies via verifyPairingTokenHash + crypto.timingSafeEqual. Closed by 01-05."
    - "WR-02: Same-origin CSRF guard added to both /confirm and /redeem route handlers (origin host vs host header comparison, 403 on mismatch). Closed by 01-05."
    - "WR-03: SESSION_COOKIE_SECRET length gate now enforces >= 32 bytes after TextEncoder UTF-8 encoding at loadSessionCookieSecret(). Closed by 01-05."
    - "WR-09: PairingClient.waitForRedeem now surfaces 4xx / schema / network errors via typed PairingPollError instead of swallowing them. Closed by 01-05."
    - "WR-11: POST /api/pairings now calls checkPairingCreateRateLimit(clientIp) before createPairing (10/minute per IP, in-memory token bucket). Closed by 01-05."
    - "CR-02: .github/workflows/fly-deploy.yml secrets now flow into env: blocks on the two secrets-push steps; run: scripts reference $VAR names. No line contains both ${{ secrets.X }} and a shell command. Closed by 01-06."
    - "CR-03: Both Dockerfiles dropped `|| true` on build lines and added post-build existence assertions (test -d /repo/apps/web/.next and test -f /repo/apps/relay/src/index.ts). Closed by 01-06."
    - "WR-04: Top-level `permissions: contents: read` block added to fly-deploy.yml. Closed by 01-06."
    - "CR-GAP-01: /confirm route is now bearer-only. auth() import and session check removed; middleware allowlists POST /api/pairings/[id]/confirm via strict single-segment pairingConfirmPostRegex; bearer is verified inside confirmPairing via verifyPairingTokenHash. Bridge CLI can now reach the route without a cookie. Closed by 01-07."
    - "WR-GAP-01: Rate-limit bucket map hard-capped at RATE_LIMIT_MAX_BUCKETS = 10_000 with FIFO-by-windowStart eviction on the fresh-key insert branch. Pinned by rate-limit-eviction.test.ts. Closed by 01-07."
    - "WR-GAP-02: Both /confirm and /redeem 500 fallthroughs now return generic {error: 'internal_error'} with console.error for operators instead of echoing raw error.message. Closed by 01-07."
    - "WR-GAP-03: PairingStatusResponseSchema now models userCode as optional (with .strict() preserved); GET /api/pairings/[id] handler simplified to safeParse(status) directly without manual subset construction. Closed by 01-07."
  gaps_remaining: []
  regressions: []
gaps: []
deferred:
  - truth: "Browser receives cm_device_session cookie after confirm"
    addressed_in: "Phase 2 follow-up (D-07-01)"
    evidence: "Documented in 01-07-PLAN.md and 01-07-SUMMARY.md: the Set-Cookie header is written during confirmPairing but the response flows to the bridge (which called POST /confirm), not to the phone browser. The browser needs a separate mechanism (e.g., /pair/[id] reload that detects state=confirmed and reads a server-side flag, or a polling endpoint that issues the cookie to the browser on first read after confirm). Deliberately deferred so Phase 1 ships the bearer-only confirm path; Phase 2 / bridge daemon work is expected to address the browser-side cookie issuance path."
  - truth: "Real userId binding on /confirm (not sentinel)"
    addressed_in: "Phase 2+ when Drizzle-backed pairing store lands (D-07-02)"
    evidence: "The confirm route now passes `pairing-bearer:${pairingId}` as a synthetic userId to confirmPairing because auth() was removed. InMemoryPairingStore tolerates any string for Phase 1, so this is runtime-safe today. The Drizzle migration in a later phase will need a real user-binding path (persist redeemedByUserId on the pairing row, or add pairing_sessions.redeemed_by_user_id column, or extend AuditStore.findLatestByEventAndSubject so /confirm can recover the real userId from the pairing.redeemed audit row). Documented in 01-07-SUMMARY.md deferred section with three forward-fix options."
  - truth: "InMemoryPairingStore production guard / Drizzle-backed store"
    addressed_in: "Phase 2+ (WR-08 code-level half)"
    evidence: "README.md Fly.io Deployment section has an IMPORTANT callout pinning apps/web to min_machines_running = 1 until the Drizzle-backed store lands (added by 01-06). The code-level fix (crash-on-boot in production or the Drizzle adapter itself) is explicitly deferred. Documented in 01-06-PLAN.md and 01-06-SUMMARY.md."
  - truth: "WR-06: Redeem on server-component GET could be triggered by link prefetchers"
    addressed_in: "Phase 2+ (tracked but deferred)"
    evidence: "apps/web/app/pair/[pairingId]/page.tsx was explicitly out of scope for the 01-REVIEW-GAP re-review (Option A lock prevented touching it). Flagged as STILL OPEN in 01-REVIEW-GAP.md outstanding gaps list but not a Phase 1 blocker because the redeem transition requires cm_web_session cookie (prefetchers typically do not carry auth cookies on cross-origin links) and the route is idempotent on repeat calls (returns existing phrase)."
  - truth: "Runtime end-to-end verification against live Fly deployment"
    addressed_in: "Human verification (listed below)"
    evidence: "No npm install / next build / docker build / fly deploy run per the user's 'never run applications automatically' global rule. All verification to date is static (grep / file-read / test-file inspection). The live end-to-end flow requires a real Fly deploy + real GitHub OAuth + real phone browser."
human_verification:
  - test: "End-to-end pairing flow on a live Fly.io deployment"
    expected: "(1) `flyctl deploy` for apps/web and apps/relay both complete green. (2) `curl https://<web>/api/healthz` returns 200 JSON. (3) `curl https://<relay>/readyz` returns 200 JSON. (4) `node apps/bridge/src/cli/pair.ts --base https://<web>` creates a pairing and prints a scannable QR plus fallback userCode to the terminal. (5) Scanning the QR on a phone lands on /sign-in, GitHub OAuth completes, the pair page redirects to /pair/[pairingId] which calls redeemPairing (cookie-authed) and displays a verification phrase. (6) The bridge's waitForRedeem poll sees state=redeemed and prints the same verification phrase in the terminal. (7) Operator compares both phrases and types Y to approve. (8) Bridge calls POST /api/pairings/[id]/confirm with Authorization: Bearer <pairingToken> — middleware allowlists the path via pairingConfirmPostRegex; the route handler extracts the bearer; confirmPairing verifies sha256(bearer) via timingSafeEqual; issueDeviceSession writes the Set-Cookie header; the bridge receives the confirm 200 response and reports success."
    why_human: "This is a pre-existing human-verification item from the initial VERIFICATION.md — it requires (a) a real Fly deploy, (b) real GitHub OAuth credentials with the callback URL registered, (c) a real phone browser, and (d) real human timing between redeem and confirm. None of this can be verified programmatically per the global 'never run applications automatically' rule."
  - test: "KNOWN FAILURE (D-07-01): cm_device_session cookie must reach the phone browser, not just the bridge"
    expected: "After step 8 above, open the phone browser and verify a cm_device_session cookie was set with a 7-day Max-Age. The browser is now authenticated as a paired device for 7 days and can access /dashboard or similar protected routes without re-signing in."
    why_human: "This step is EXPECTED TO FAIL in the current Phase 1 implementation. The Set-Cookie header written by issueDeviceSession during confirmPairing flows in the HTTP response to the bridge (the caller of POST /confirm), NOT to the phone browser. The phone browser never sees this cookie because it never made the /confirm request. This is an architectural gap explicitly deferred as D-07-01 in 01-07 to a follow-up (likely Phase 2 or a dedicated 01-08 gap plan). A workaround would be: the pair page polls GET /api/pairings/[id] after showing the verification phrase; when it observes state=confirmed, it makes a server-component round-trip that issues the cookie to the browser. Manual test: after confirm, reload the phone browser at /pair/[id] — if the cookie is not present, file a follow-up issue. The Phase 1 bearer-gated backend is still correct; this is the browser-side cookie-delivery piece."
  - test: "Rate limit at POST /api/pairings (11 rapid requests from same IP)"
    expected: "Send 11 POST /api/pairings requests from the same source IP within 60 seconds. The first 10 return 200 with pairing bodies; the 11th returns 429 with a retry-after header. After 60 seconds, the bucket resets and the next request returns 200 again."
    why_human: "Requires running the apps/web service locally (or against a live Fly deploy) and issuing 11 rapid curl calls. The unit test apps/web/tests/unit/rate-limit-eviction.test.ts covers the bucket-cap eviction invariant in-process, but the HTTP-layer 429 response requires a running server."
  - test: "Expired pairing is rejected by /confirm"
    expected: "Create a pairing via POST /api/pairings; wait 6 minutes (the 5-minute expiry window + buffer); attempt POST /api/pairings/[id]/confirm with the valid bearer. The route returns 404 `pairing_not_found` or 409 `invalid_state` (depending on whether loadOrExpire has sweeped the row yet). The pairing never transitions to confirmed."
    why_human: "Requires a live server and 6 minutes of clock time. The existing apps/web/tests/auth-pairing.spec.ts covers the expired-pairing rejection path in the Playwright suite but is gated on CODEX_MOBILE_E2E_LIVE and requires human invocation."
  - test: "Terminal QR readability and fallback code legibility"
    expected: "renderTerminalQr renders a phone-scannable QR at normal terminal font size; the fallback userCode is human-readable; the verification phrase in the terminal exactly matches the one on the phone browser."
    why_human: "Terminal rendering quality is font- and viewport-dependent and requires a human eye. Listed in 01-VALIDATION.md Manual-Only Verifications for PAIR-02 / PAIR-04."
  - test: "GitHub OAuth round-trip with real callback URL"
    expected: "Sign-in redirects to github.com, operator approves, callback lands back on the originally requested /pair/[pairingId] with a valid cm_web_session cookie."
    why_human: "Requires a real GitHub OAuth application with AUTH_GITHUB_ID / AUTH_GITHUB_SECRET configured and the callback URL registered."
  - test: "Playwright phase-01-e2e-mobile suite against a live Next.js dev server"
    expected: "`CODEX_MOBILE_E2E_LIVE=1 npm run test:phase-01:full` passes all three specs in auth-pairing.spec.ts (sign-in redirect, redeem verification-phrase, expired-pairing rejection)."
    why_human: "Requires spinning up a Next.js dev server; deferred to human-initiated run per the global 'never run applications automatically' rule."
---

# Phase 1: Identity & Pairing Foundation Verification Report

**Phase Goal:** Establish a secure internet-facing entry point for Codex Mobile with QR-based pairing and 7-day device sessions.
**Verified:** 2026-04-11
**Status:** human_needed
**Re-verification:** Yes — second gap-closure iteration (after 01-04 / 01-05 / 01-06 and the follow-up 01-07 closing CR-GAP-01, WR-GAP-01, WR-GAP-02, WR-GAP-03 from 01-REVIEW-GAP.md)

## Re-verification Summary

The initial 01-VERIFICATION.md (dated 2026-04-10) reported **6/11** with five blockers:
1. Middleware CR-01 (bridge CLI redirected to /sign-in on POST /api/pairings).
2. Missing GET /api/pairings/[pairingId] handler.
3. SEC-06 / IN-02 semantic gap — rawPairingToken never verified on redeem/confirm.
4. CR-02 GitHub Actions secret interpolation.
5. CR-03 Dockerfile `|| true` masking build failures.

Gap-iteration 1 (plans 01-04, 01-05, 01-06) closed all five blockers plus WR-02 (Origin/CSRF), WR-03 (32-byte cookie secret), WR-04 (permissions scope), WR-09 (waitForRedeem error propagation), and WR-11 (rate limit on POST /api/pairings).

The subsequent code re-review (01-REVIEW-GAP.md) surfaced **one new CRITICAL** (CR-GAP-01: /confirm required BOTH auth() cookie AND Authorization bearer — neither caller could satisfy both simultaneously) plus three warnings (WR-GAP-01 unbounded rate-limit map, WR-GAP-02 raw error leakage on 500 fallthroughs, WR-GAP-03 PairingStatusResponseSchema dropping userCode silently).

Gap-iteration 2 (plan 01-07) closed all four. `/confirm` is now bearer-only (auth() removed, middleware allowlists via pairingConfirmPostRegex, sentinel userId `pairing-bearer:${pairingId}` passed to confirmPairing). Rate-limit map hard-capped at 10,000 entries with FIFO eviction. Both /confirm and /redeem 500 fallthroughs return generic `internal_error`. PairingStatusResponseSchema now models optional userCode.

All 11 must-have truths are now structurally verified against the codebase. However, one deferred architectural gap (D-07-01: the cm_device_session cookie flows to the bridge, not the phone browser, after confirm) requires human testing and is expected to reveal a follow-up gap in Phase 2 or a dedicated 01-08 plan. Because human verification items remain, the final status is **human_needed**, not **passed**.

## Critical Check Matrix (from orchestrator prompt)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` does NOT contain `await auth()` | PASS | grep returns zero matches; the `import { auth }` line is also absent (verified via Read of full file, lines 1-199). CR-GAP-01 closed. |
| 2 | `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` STILL contains `await auth()` | PASS | Line 36: `const session = await auth();` remains. Redeem is called by the browser server component and stays cookie-gated. |
| 3 | `apps/web/middleware.ts` contains `pairingConfirmPostRegex` | PASS | Lines 35, 60: import and pass-through guard for POST + pairingConfirmPostRegex before the PUBLIC_PATHS check. |
| 4 | `/sign-in`, `/api/auth`, `/api/healthz`, POST `/api/pairings`, GET `/api/pairings/[id]`, POST `/api/pairings/[id]/confirm` are the ONLY public paths; `/redeem` is NOT public | PASS | `PUBLIC_PATHS = ["/sign-in", "/api/auth", "/api/healthz"]` in auth.config.ts line 35. `UNAUTHENTICATED_API_POST_PATHS = new Set(["/api/pairings"])` line 51. `pairingConfirmPostRegex = /^\/api\/pairings\/[^\/]+\/confirm$/` line 67 — strict single-segment. GET status regex `/^\/api\/pairings\/[^\/]+$/` in middleware.ts line 71 — single-segment, does NOT match `/redeem` or `/confirm`. `/redeem` falls through to the cookie check and is redirected. |
| 5 | `apps/web/lib/rate-limit.ts` exports `RATE_LIMIT_MAX_BUCKETS` with eviction | PASS | Line 43: `export const RATE_LIMIT_MAX_BUCKETS = 10_000;`. Lines 63-76: `evictOldestIfOverCap()` helper. Line 97: called from inside `checkPairingCreateRateLimit` on the fresh-key branch before `buckets.set(...)`. Pinned by rate-limit-eviction.test.ts. |
| 6 | `packages/protocol/src/pairing.ts` `PairingStatusResponseSchema` includes optional `userCode` | PASS | Line 113: `userCode?: string;` on the interface. Line 122: `userCode: z.string().min(4).max(12).optional(),` in the schema. `.strict()` chain still intact at line 124. |
| 7 | `apps/web/lib/pairing-service.ts` `verifyPairingTokenHash` exists, called by `confirmPairing`, NOT called by `redeemPairing` | PASS | Line 297: exported helper. Line 440: called inside confirmPairing body (after state check, before phrase comparison). Grep of redeemPairing function body (lines 328-370) returns zero matches for verifyPairingTokenHash. Option A lock intact. |
| 8 | `apps/web/lib/device-session.ts` SESSION_COOKIE_SECRET gate is 32 bytes | PASS | Lines 107-112: `const bytes = new TextEncoder().encode(raw); if (bytes.byteLength < 32) throw new Error("SESSION_COOKIE_SECRET must be at least 32 bytes after UTF-8 encoding (HS256 best practice)");`. WR-03 closed. |
| 9 | `apps/bridge/src/lib/pairing-client.ts` sends `Authorization: Bearer` on getPairingStatus + confirmPairing | PASS | Line 101: `private pairingToken: string | null = null;`. Lines 124-127: `authHeaders()` returns `{ authorization: Bearer ${token} }` when present. Line 173: getPairingStatus spreads `...this.authHeaders()`. Line 207: confirmPairing spreads `...this.authHeaders()`. Token is set from POST /api/pairings response at line 160. |
| 10 | Fly deploy workflow has no `${{ secrets.X }}` on the same line as shell commands | PASS | grep `secrets\.` in .github/workflows/fly-deploy.yml returns lines 113-119, 133, 163-167, 179 — ALL inside step-level `env:` blocks. None are in `run:` lines. `run:` scripts only reference `$VAR` names. Top-level `permissions: contents: read` at line 85. CR-02 + WR-04 closed. |
| 11 | Dockerfiles have no `\|\| true` on build lines | PASS | grep `\|\| true` in both apps/web/Dockerfile and apps/relay/Dockerfile returns zero matches. Lines 75 + 82 of apps/web/Dockerfile: `RUN npm run build --workspace @codex-mobile/web --if-present` followed by `RUN test -d /repo/apps/web/.next \|\| ...`. Lines 69 + 77 of apps/relay/Dockerfile: same pattern with `RUN test -f /repo/apps/relay/src/index.ts`. CR-03 closed. |

All 11 critical checks pass.

## Goal Achievement

### Observable Truths (merged from ROADMAP Success Criteria + all 7 PLAN must_haves.truths)

ROADMAP.md Success Criteria (load-bearing, non-negotiable):
- SC1: User can sign into the web app and begin pairing from a phone browser
- SC2: Local terminal can display a short-lived QR code and fallback code for pairing
- SC3: Terminal and browser both show a verification phrase before a 7-day device session is granted
- SC4: Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine

Plus plan-level truths from 01-01 through 01-07.

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | **SC1** / 01-02-T1: Signed-in browser user can begin pairing from a phone-sized web UI | VERIFIED | apps/web/app/sign-in/page.tsx contains exact CTA "Continue with GitHub" (01-02 Task 1). middleware.ts line 85-87 redirects unauthenticated non-public paths to /sign-in with callbackUrl preserved. apps/web/app/pair/[pairingId]/page.tsx renders verification phrase and userCode on mobile-safe layout. 01-02-SUMMARY.md line reference shows Auth.js GitHub-only provider configured. |
| 2 | **SC2** / 01-02-T2 / 01-04-T2: Local terminal can request a pairing, show a QR code plus fallback code, and wait for confirmation | VERIFIED | apps/bridge/src/cli/pair.ts contains `renderTerminalQr`, displays userCode, polls via waitForRedeem (with Authorization bearer), displays verification phrase, prompts y/N, calls confirmPairing. POST /api/pairings now passes middleware (UNAUTHENTICATED_API_POST_PATHS Set). GET /api/pairings/[id] has a real route handler at apps/web/app/api/pairings/[pairingId]/route.ts and passes middleware (single-segment regex). POST /api/pairings/[id]/confirm passes middleware (pairingConfirmPostRegex) and the route handler no longer calls auth(), so the bridge can now complete the entire ceremony with only its Authorization: Bearer header. |
| 3 | **SC3** / 01-02-T3: Device session issued only after both browser and terminal see the same verification phrase and terminal explicitly approves | VERIFIED | apps/web/lib/pairing-service.ts confirmPairing flow: (a) state check (pending/redeemed only), (b) verifyPairingTokenHash via sha256 + crypto.timingSafeEqual (fails closed), (c) verification phrase comparison via constantTimeEqual (now uses crypto.timingSafeEqual under the hood per 01-05), (d) issueDeviceSession. All four must pass for cm_device_session to be issued. Bridge CLI prompts explicit y/N in terminal before calling confirmPairing. Same-origin CSRF guard on /confirm at line 57-73 of route.ts. |
| 4 | **SC4** / 01-03-T1: Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine | VERIFIED (structurally) | apps/web/fly.toml and apps/relay/fly.toml define TLS + healthz/readyz. .github/workflows/fly-deploy.yml now hardened (env-block secrets, permissions: contents: read, no shell injection). Dockerfiles fail loudly on build errors (post-build existence assertions). ADR-0001 explicitly forbids direct public exposure of codex app-server. Bridge uses outbound-only polling + Authorization bearer; no inbound port required. **Runtime verification deferred to human testing** (listed below) because no deploy has been executed. |
| 5 | 01-01-T1: Repo has one workspace layout for web, relay, bridge, and shared packages | VERIFIED | package.json contains `"workspaces"` with apps/* and packages/*. tsconfig.base.json contains `@codex-mobile/protocol` path alias. |
| 6 | 01-01-T2: Session state is short-lived web sessions plus 7-day device sessions | VERIFIED | apps/web/lib/device-session.ts: WEB_SESSION_COOKIE_NAME="cm_web_session" with 12h TTL; DEVICE_SESSION_COOKIE_NAME="cm_device_session" with DEVICE_SESSION_TTL_SECONDS (7 days). Both cookies are HttpOnly + Secure + SameSite=Lax + Path=/. |
| 7 | 01-01-T3: Pairing is a single-use server-side record with expiry and verification phrase | VERIFIED | packages/db/src/schema.ts defines pairing_sessions. packages/protocol/src/pairing.ts defines PAIRING_STATUS_VALUES = [pending, redeemed, confirmed, expired, cancelled]. apps/web/lib/pairing-service.ts implements 5-minute expiry and verification phrase generation. |
| 8 | 01-01-T4: Phase 1 trust boundaries keep codex app-server and local machine off the public internet | VERIFIED | docs/adr/0001-phase-1-trust-boundary.md contains the exact sentence "No direct public exposure of codex app-server" and the "60-second" TTL rule for WS tickets. |
| 9 | 01-03-T2 / 01-06: Reproducible deploy configuration, hardened secrets, README operator docs | VERIFIED | apps/web/fly.toml + apps/relay/fly.toml have internal_port + healthz/readyz. .github/workflows/fly-deploy.yml is CR-02 + WR-04 safe. README.md has ## Fly.io Deployment section + the new ### IMPORTANT: Single-machine pairing store constraint callout from 01-06. |
| 10 | 01-04 / 01-05 / 01-07 merged: All cookie/bearer/same-origin/rate-limit defenses in place; /confirm is bearer-only; /redeem is cookie-only; rate-limit map is bounded; 500 fallthroughs are generic | VERIFIED | Evidence compiled in Critical Check Matrix above (checks 1-11). |
| 11 | 01-01 / 01-05: Shared schema, protocol contracts, and auth primitives exist with Phase 1 names/lifetimes | VERIFIED | packages/db/src/schema.ts, packages/protocol/src/pairing.ts, packages/protocol/src/session.ts, packages/auth/src/device-session.ts, packages/auth/src/ws-ticket.ts all exist and export the expected identifiers. `WS_TICKET_TTL_SECONDS = 60` present in ws-ticket.ts. |

**Score:** 11/11 truths structurally verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `package.json` | Workspace root with scripts | VERIFIED | Contains `"workspaces"` and Phase 1 scripts (01-01). |
| `packages/db/src/schema.ts` | DB schema (users, sessions, pairings, audit) | VERIFIED | 8234 bytes; contains `pairing_sessions` and `device_sessions` (01-01). |
| `packages/protocol/src/pairing.ts` | Pairing protocol contracts | VERIFIED | Exports PAIRING_STATUS_VALUES, PairingCreateResponse (with optional pairingToken), PairingConfirmResponse, PairingStatusResponse (with optional userCode post 01-07). |
| `packages/auth/src/device-session.ts` | Cookie/session helpers | VERIFIED | Exports DEVICE_SESSION_COOKIE_NAME ("cm_device_session"), createDeviceSession, verifyDeviceSession. |
| `packages/auth/src/ws-ticket.ts` | Short-lived WS ticket helpers | VERIFIED | Contains `WS_TICKET_TTL_SECONDS = 60`. |
| `docs/adr/0001-phase-1-trust-boundary.md` | Trust-boundary ADR | VERIFIED | Contains "No direct public exposure of codex app-server" and "60-second" phrases (01-01). |
| `apps/web/auth.config.ts` | Edge-safe Auth.js config + bridge allowlists | VERIFIED | Exports PUBLIC_PATHS, UNAUTHENTICATED_API_POST_PATHS, pairingConfirmPostRegex. authorized() callback implements the 5-step order-of-checks. |
| `apps/web/auth.ts` | Auth.js runtime entry | VERIFIED | GitHub provider only (01-02). |
| `apps/web/middleware.ts` | Edge middleware with bridge allowlists | VERIFIED | Imports pairingConfirmPostRegex + UNAUTHENTICATED_API_POST_PATHS; pass-through guards at lines 49, 60, 70 in the correct order; falls through to /sign-in redirect for everything else. |
| `apps/web/app/sign-in/page.tsx` | Mobile sign-in screen | VERIFIED | Contains exact CTA "Continue with GitHub" (01-02). |
| `apps/web/app/pair/[pairingId]/page.tsx` | Server component pairing screen | VERIFIED | Renders verification phrase + userCode (Option A lock intact; untouched by 01-04/05/07). |
| `apps/web/app/api/pairings/route.ts` | POST create pairing handler | VERIFIED | Calls checkPairingCreateRateLimit(clientIp) (01-05); returns pairingToken in response body (01-05). |
| `apps/web/app/api/pairings/[pairingId]/route.ts` | GET status poll handler | VERIFIED | Created by 01-04; passes full toStatusResponse output through PairingStatusResponseSchema.safeParse (simplified by 01-07); returns generic internal_error on 500 fallthrough (01-04). |
| `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` | POST redeem handler (cookie-gated) | VERIFIED | Still calls `await auth()` (Option A lock); same-origin guard (01-05); generic internal_error on 500 fallthrough (01-07). |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | POST confirm handler (bearer-only post 01-07) | VERIFIED | auth() import + call removed (01-07); pairingConfirmPostRegex middleware allowlist; same-origin guard (01-05); Authorization bearer extraction + 401 missing_pairing_token (01-05); sentinel userId `pairing-bearer:${pairingId}` passed to confirmPairing (01-07); generic internal_error on 500 fallthrough (01-07). |
| `apps/web/lib/device-session.ts` | Cookie issuance + 32-byte secret gate | VERIFIED | loadSessionCookieSecret requires `bytes.byteLength >= 32` after TextEncoder (01-05 / WR-03). issueDeviceSession writes Set-Cookie with 7-day maxAge. |
| `apps/web/lib/pairing-service.ts` | Pairing state machine + bearer verification | VERIFIED | verifyPairingTokenHash at line 297 (sha256 + crypto.timingSafeEqual with length check); called only by confirmPairing at line 440 (Option A lock — redeemPairing is bearer-free). createPairing returns rawPairingToken in the response shape (01-05). |
| `apps/web/lib/rate-limit.ts` | In-memory token bucket + hard cap | VERIFIED | checkPairingCreateRateLimit (10/min per IP, in-memory); RATE_LIMIT_MAX_BUCKETS = 10_000 with evictOldestIfOverCap on fresh-key branch (01-07). |
| `apps/bridge/src/cli/pair.ts` | Terminal pairing ceremony | VERIFIED | Calls POST /api/pairings, prints userCode + QR via renderTerminalQr, polls waitForRedeem, displays verification phrase, prompts y/N, calls confirmPairing. |
| `apps/bridge/src/lib/pairing-client.ts` | Typed client with bearer plumbing | VERIFIED | Stores pairingToken in process memory; sends Authorization: Bearer on getPairingStatus + confirmPairing via authHeaders(); throws PairingPollError (typed) on non-2xx; waitForRedeem rethrows 4xx errors (01-05 / WR-09). |
| `apps/relay/src/server.ts` + `routes/health.ts` + `routes/readyz.ts` | Fastify relay with health endpoints | VERIFIED | Both `/healthz` and `/readyz` handlers exist (01-02). |
| `apps/web/app/api/healthz/route.ts` | Web health endpoint | VERIFIED | Returns JSON with `status` (01-03). |
| `apps/web/Dockerfile` | Web container entrypoint with fail-loud build | VERIFIED | FROM node:22-alpine; EXPOSE 3000; CMD npm start; no `\|\| true`; post-build `test -d /repo/apps/web/.next` assertion (01-06). |
| `apps/relay/Dockerfile` | Relay container entrypoint | VERIFIED | FROM node:22-alpine; EXPOSE 8080; no `\|\| true`; post-build `test -f /repo/apps/relay/src/index.ts` assertion (01-06). |
| `apps/web/fly.toml` + `apps/relay/fly.toml` | Fly deployment manifests | VERIFIED | internal_port + healthz/readyz probes (01-03). |
| `.github/workflows/fly-deploy.yml` | CI deploy workflow | VERIFIED | top-level `permissions: contents: read` (01-06 / WR-04); env-block secret indirection on both push-secrets steps (01-06 / CR-02); no shell injection. |
| `README.md` | Operator docs | VERIFIED | Sections Local Development / Authentication Setup / Pairing Flow / Fly.io Deployment; new ### IMPORTANT: Single-machine pairing store constraint callout from 01-06 pins min_machines_running = 1. |
| `apps/web/tests/auth-pairing.spec.ts` | Playwright e2e suite | VERIFIED | Exists; exercises sign-in redirect, redeem verification phrase, expired-pairing rejection. Option A lock prevented touching it through all 4 gap plans. |
| `apps/web/tests/unit/middleware-public-paths.test.ts` | Middleware regression test | VERIFIED | Created 01-04; updated 01-07 to assert POST /confirm is now bearer-gated (allowed by middleware) + POST /confirm/extra is blocked + POST /redeem is still blocked. |
| `apps/web/tests/unit/pairings-status-route.test.ts` | GET status route regression test | VERIFIED | Created 01-04; asserts 200 for existing pairing and 404 pairing_not_found for missing. |
| `apps/web/tests/unit/rate-limit-eviction.test.ts` | Rate-limit cap regression test | VERIFIED | Created 01-07; drives limiter past RATE_LIMIT_MAX_BUCKETS with overfill=cap+50; asserts first-50 keys are evicted (remaining=9 on fresh bucket) and last-50 survive (remaining=8 on second call). |
| `apps/web/tests/unit/confirm-route-bearer.test.ts` | /confirm bearer-only regression test | VERIFIED | Created 01-07; asserts missing Authorization header returns 401 missing_pairing_token, malformed Basic header also 401s, and source-level grep pin asserts the file does not import `auth` from the five-level-up path nor call `await auth()`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `apps/bridge/src/lib/pairing-client.ts` | `apps/web/app/api/pairings/route.ts` | POST create — middleware allowlists via `UNAUTHENTICATED_API_POST_PATHS.has("/api/pairings")` | WIRED | Set membership check at middleware.ts:49. |
| `apps/bridge/src/lib/pairing-client.ts` | `apps/web/app/api/pairings/[pairingId]/route.ts` | GET status poll — middleware allowlists via single-segment regex `/^\/api\/pairings\/[^\/]+$/` | WIRED | Regex check at middleware.ts:70-73. loadPairingStatus is imported and called at route.ts:47. |
| `apps/bridge/src/cli/pair.ts` | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | POST confirm — middleware allowlists via `pairingConfirmPostRegex` single-segment regex | WIRED | auth.config.ts:67 defines the regex; middleware.ts:60 calls `NextResponse.next()` on match. confirm/route.ts:97-106 extracts Authorization bearer and 401s on missing. |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | `apps/web/lib/pairing-service.ts` | confirmPairing with pairingToken → verifyPairingTokenHash → timingSafeEqual | WIRED | route.ts:131-137 passes bearer as pairingToken. pairing-service.ts:440 calls verifyPairingTokenHash; line 297 uses crypto.timingSafeEqual on equal-length buffers. |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | `apps/web/lib/device-session.ts` | issueDeviceSession writes Set-Cookie after phrase match | WIRED | confirmPairing calls issueDeviceSession internally (pairing-service.ts). DEVICE_SESSION_COOKIE_NAME constant is imported at route.ts:29 and echoed in the response body. **CAVEAT:** the Set-Cookie header flows to the bridge (the HTTP caller), not to the phone browser — see D-07-01 deferred. |
| `apps/web/middleware.ts` | `apps/web/auth.config.ts` | imports pairingConfirmPostRegex + UNAUTHENTICATED_API_POST_PATHS | WIRED | middleware.ts:31-36 imports both. |
| `apps/web/app/api/pairings/route.ts` | `apps/web/lib/rate-limit.ts` | checkPairingCreateRateLimit(clientIp) before createPairing | WIRED | route.ts:34 imports, line 58 calls before createPairing. |
| `apps/web/lib/rate-limit.ts` | `apps/web/lib/rate-limit.ts` | evictOldestIfOverCap called on fresh-key branch | WIRED | rate-limit.ts:97 inside the `if (!bucket || now - bucket.windowStart >= windowMs)` branch BEFORE `buckets.set(...)`. |
| `apps/web/app/api/pairings/[pairingId]/route.ts` | `packages/protocol/src/pairing.ts` | PairingStatusResponseSchema.safeParse(status) (full object, not subset) | WIRED | route.ts:54 passes full toStatusResponse output because the schema now models optional userCode (protocol/pairing.ts:122). |
| `apps/web/app/api/pairings/[pairingId]/redeem/route.ts` | `apps/web/auth.ts` | await auth() cookie gate | WIRED | route.ts:36 retains the session check (Option A lock intact). |
| `apps/bridge/src/lib/pairing-client.ts` | `apps/web/app/api/pairings/[pairingId]/route.ts` / `.../confirm/route.ts` | Authorization: Bearer <pairingToken> on getPairingStatus + confirmPairing | WIRED | pairing-client.ts:124-127 `authHeaders()` helper; spread at lines 173 and 207. |
| `apps/web/fly.toml` | `apps/web/app/api/healthz/route.ts` | Fly HTTP health check path | WIRED | fly.toml references /api/healthz (01-03). |
| `apps/relay/fly.toml` | `apps/relay/src/routes/readyz.ts` | Fly readiness path | WIRED | fly.toml references /readyz (01-03). |
| `.github/workflows/fly-deploy.yml` | `apps/web/fly.toml` + `apps/relay/fly.toml` | flyctl deploy step | WIRED | Deploy steps reference each fly.toml with --config flag. |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| AUTH-01 | User can sign in to the Codex Mobile web app with a secure first-party session | SATISFIED | apps/web/auth.config.ts GitHub provider; apps/web/app/sign-in/page.tsx CTA; middleware redirects unauthenticated requests to /sign-in. Cookie-based cm_web_session with 12h rolling maxAge. |
| AUTH-02 | User can keep a paired device authorized for up to 7 days without re-pairing | SATISFIED | DEVICE_SESSION_TTL_SECONDS = 7 days; issueDeviceSession writes cm_device_session cookie with 7-day absolute expiry. **HUMAN VERIFICATION** needed for end-to-end cookie delivery to browser (D-07-01). |
| PAIR-01 | Local CLI bridge can create a new pairing session | SATISFIED | apps/bridge/src/cli/pair.ts + apps/bridge/src/lib/pairing-client.ts createPairing; POST /api/pairings middleware allowlist; rate-limited; returns pairingToken. |
| PAIR-02 | Terminal displays QR code and fallback code | SATISFIED | apps/bridge/src/cli/pair.ts uses renderTerminalQr and prints userCode. |
| PAIR-03 | Pairing token is single-use and expires within minutes | SATISFIED | apps/web/lib/pairing-service.ts createPairing generates 32-byte random pairingToken (base64url), hashes to pairingTokenHash; 5-minute expiry on the row; verifyPairingTokenHash via crypto.timingSafeEqual on confirm; state transitions are one-way (pending → redeemed → confirmed; any other state rejects). |
| PAIR-04 | Terminal and web client both show a verification phrase | SATISFIED | redeemPairing generates verificationPhrase; pair page renders it; bridge CLI displays it; confirmPairing compares with constantTimeEqual. |
| PAIR-05 | Pairing never requires opening an inbound port on the developer machine | SATISFIED | ADR-0001 explicitly forbids inbound ports. Bridge is outbound-only (POST + poll + confirm). README.md documents "outbound connectivity only" constraint. |
| SEC-01 | Web and WebSocket sessions use short-lived credentials derived from device session | SATISFIED | cm_web_session 12h rolling; cm_device_session 7d absolute; ws-ticket 60s; SESSION_COOKIE_SECRET gated at 32 bytes. |
| SEC-06 | Origin, CSRF, and replay protections for browser sessions and pairing flows | SATISFIED | Same-origin guard on /confirm + /redeem (WR-02 closed 01-05); rate limit on POST /api/pairings (WR-11 closed 01-05); one-time pairing bearer end-to-end (IN-02 / SEC-06 semantic gap closed 01-05); SameSite=Lax + HttpOnly + Secure cookies. |
| OPS-01 | Public web app and relay service deploy on Fly.io with TLS and health checks | SATISFIED (structurally) | apps/web/fly.toml + apps/relay/fly.toml with internal_port + health check paths; .github/workflows/fly-deploy.yml hardened (CR-02 + WR-04); Dockerfiles fail-loud (CR-03 closed); README.md Fly.io Deployment section + single-machine callout. **Runtime verification deferred to human testing.** |

All 10 requirements mapped to Phase 1 are SATISFIED at the code / structural level. Runtime confirmation (AUTH-02 cookie delivery to browser, OPS-01 live Fly deploy) requires human testing.

### Anti-Pattern Scan

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | 124 | Sentinel userId `pairing-bearer:${pairingId}` | Info | Deliberate synthetic value passed to confirmPairing since auth() was removed (CR-GAP-01). Documented in 01-07-SUMMARY.md D-07-02 with three forward-fix options for the Drizzle migration. In-memory pairing store tolerates any string at runtime; FK incompatibility deferred. Not a bug. |
| `apps/web/lib/pairing-service.ts` | 391 | `pairingToken?: string` optional on ConfirmPairingInput | Info | Executor deviation from 01-05 plan (originally REQUIRED). Documented in 01-05-SUMMARY.md deviations block. SAFE at the HTTP boundary because confirm/route.ts 401s on missing bearer BEFORE calling confirmPairing; line-440 verifyPairingTokenHash fails closed on missing token. Not a bug. |
| `apps/web/lib/pairing-service.ts` | 183 | `defaultPairingStore = new InMemoryPairingStore()` without production guard | Warning | WR-08 code-level half still open; mitigated by README.md single-machine callout (01-06). Phase 2 follow-up. Not a Phase 1 blocker given the operator-awareness gap is closed. |
| `apps/web/app/pair/[pairingId]/page.tsx` | server component GET | Redeem transition on server-component GET | Warning | WR-06 still open per 01-REVIEW-GAP outstanding gaps. Option A lock prevented touching this file through all 4 gap plans. Mitigated because /redeem requires cm_web_session cookie (link prefetchers typically don't carry auth cookies on cross-origin). |

No grep matches for TODO/FIXME/XXX/placeholder/"not yet implemented" in the touched files.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| GET /api/pairings/[pairingId] handler | `status` | `loadPairingStatus(pairingId)` → defaultPairingStore.getByIdOrNull → InMemoryPairingStore Map read | Yes (real pairing row or throws "not found") | FLOWING |
| POST /api/pairings handler | `result` | `createPairing` → randomUUID + crypto.randomBytes(32) + sha256 → InMemoryPairingStore.insert | Yes (fresh pairing row with real token) | FLOWING |
| POST /api/pairings/[id]/confirm handler | `result.deviceSession` | `confirmPairing` → issueDeviceSession → jose HS256 sign | Yes (real JWT + Set-Cookie header) | FLOWING (but see D-07-01: header flows to bridge, not browser) |
| POST /api/pairings/[id]/redeem handler | `redeemed` | `redeemPairing` → store.update({ status: "redeemed", verificationPhrase }) | Yes (real phrase generation + audit record) | FLOWING |
| Bridge PairingClient.waitForRedeem | polled status | `getPairingStatus` → fetch GET + Zod safeParse | Yes (server response or throws PairingPollError on 4xx) | FLOWING |
| Rate limit | `buckets` map | In-memory Map with FIFO eviction | Yes (process-local but tested via rate-limit-eviction.test.ts) | FLOWING |

### Behavioral Spot-Checks

SKIPPED: No runnable entry points were exercised per the global "never run applications automatically" rule. All verification is static (grep / file-read / test-file inspection). Behavioral verification is routed to the human verification section below.

### Human Verification Required

See the `human_verification:` frontmatter block for seven items. The two most important are:

1. **End-to-end pairing flow on a live Fly deploy** — structural verification shows all code paths are reachable; runtime confirmation requires actual deploy + OAuth + phone browser.

2. **D-07-01: cm_device_session cookie delivery to the phone browser** — EXPECTED TO FAIL. The Set-Cookie header is written during confirmPairing but flows to the bridge (HTTP caller of /confirm), not to the phone browser. This is an architectural gap deliberately deferred to a Phase 2 follow-up. The Phase 1 bearer-gated backend is correct; only the browser-side cookie-delivery piece is missing. Phase 1 can be marked complete, but this item MUST be tracked as a known open issue for the next phase.

### Gaps Summary

No actionable gaps. All 11 must-have truths are structurally verified, all 11 critical checks from the orchestrator prompt pass, and all 10 Phase 1 requirement IDs are SATISFIED at the code level.

Three architectural issues are intentionally deferred to later phases:

1. **D-07-01:** Browser-side cm_device_session cookie delivery after confirm (Phase 2 follow-up or 01-08 gap plan).
2. **D-07-02:** Real userId binding on /confirm (blocked on Drizzle-backed pairing store).
3. **WR-06 / WR-08:** Server-component GET redeem prefetcher hardening and InMemoryPairingStore production guard (Phase 2+ cleanup).

Because human verification items remain (most notably the end-to-end Fly test and the D-07-01 browser cookie test), the final status is **human_needed**. If the end-to-end test passes and D-07-01 is reclassified as an accepted Phase 2 follow-up via a ROADMAP update or verification override, Phase 1 can be marked complete.

---

_Verified: 2026-04-11_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Iteration 2 (after 01-07 closed the 01-REVIEW-GAP findings)_
