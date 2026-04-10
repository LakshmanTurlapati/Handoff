---
phase: 01-identity-pairing-foundation
verified: 2026-04-10T00:00:00Z
status: gaps_found
score: 6/11 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A signed-in browser user can begin pairing from a phone-sized web UI."
    status: partial
    reason: "Sign-in page, middleware guard, and mobile pairing screen all exist and are wired correctly for the browser half of the flow, but the pairing UI cannot complete end-to-end because the bridge CLI cannot reach the pairing API (see next gap). Browser-only parts pass structurally."
    artifacts:
      - path: "apps/web/app/sign-in/page.tsx"
        issue: "OK — contains exact CTA 'Continue with GitHub' wired to signIn server action."
      - path: "apps/web/middleware.ts"
        issue: "OK for browser redirect, but treats every /api/pairings path as protected via the PUBLIC_PATHS allowlist in auth.config.ts (CR-01)."
    missing:
      - "PUBLIC_PATHS in apps/web/auth.config.ts must allow POST /api/pairings and GET /api/pairings/[pairingId] so the bridge CLI (which has no browser cookie) can reach the create/status endpoints."
  - truth: "The local terminal can request a pairing, show a QR code plus fallback code, and wait for confirmation."
    status: failed
    reason: "Bridge CLI code exists and calls POST /api/pairings + GET /api/pairings/[pairingId] correctly, but (1) the Next.js middleware will redirect every bridge CLI request to /sign-in because /api/pairings is NOT in PUBLIC_PATHS (CR-01), and (2) no GET /api/pairings/[pairingId] route handler exists anywhere in apps/web/app/api/pairings/[pairingId]/ — only redeem/ and confirm/ subdirectories — so waitForRedeem polling can never resolve even if middleware were fixed. Both issues together make the terminal pairing flow non-functional end-to-end."
    artifacts:
      - path: "apps/web/auth.config.ts"
        issue: "PUBLIC_PATHS = ['/sign-in', '/api/auth', '/api/healthz'] — missing /api/pairings. Middleware redirects every bridge CLI call to /sign-in (HTML), PairingCreateResponseSchema.safeParse fails with 'invalid payload'."
      - path: "apps/web/app/api/pairings/[pairingId]"
        issue: "No route.ts file at this level. Only confirm/route.ts and redeem/route.ts exist. PairingClient.getPairingStatus() polls GET /api/pairings/{pairingId} and will always get 404 (or 307 to /sign-in before the fix)."
      - path: "apps/bridge/src/lib/pairing-client.ts"
        issue: "Lines 107-130: getPairingStatus polls a route that has no handler. waitForRedeem (line 176) further catches all errors as null so the operator only sees a timeout — see WR-09 in the code review."
    missing:
      - "Add '/api/pairings' to PUBLIC_PATHS (or better: pathname-equality allowlist for POST /api/pairings and a regex for GET /api/pairings/[id]) so the middleware does not redirect bridge CLI traffic."
      - "Create apps/web/app/api/pairings/[pairingId]/route.ts with a GET handler that calls loadPairingStatus and returns a PairingStatusResponse validated against the shared Zod schema."
      - "Add a Vitest unit test that constructs a NextRequest for POST /api/pairings and asserts middleware returns NextResponse.next() (not a redirect), AND a test that fetches GET /api/pairings/[id] and gets a 200 JSON payload."
  - truth: "A device session is issued only after both the browser and terminal see the same verification phrase and the terminal explicitly approves."
    status: partial
    reason: "The cookie-issuance invariant is enforced at the code level (confirmPairing -> constantTimeEqual -> issueDeviceSession, all within one function; bridge CLI has an explicit stdin y/N approval gate in runPairCommand). The verification phrase generation, constant-time comparison, and audit rows are all present. However: (a) the browser pair/[pairingId]/page.tsx redeems on GET via a server component, which link prefetchers can trigger (WR-06); (b) confirm/route.ts has no Origin/CSRF check even though it is the only path that mints cm_device_session (WR-02); (c) the confirm path itself cannot be exercised by the bridge CLI because of the CR-01/missing-GET gaps above. The invariant is structurally correct but the flow as deployed cannot actually reach it."
    artifacts:
      - path: "apps/web/lib/pairing-service.ts"
        issue: "confirmPairing correctly calls issueDeviceSession only after a constant-time phrase match — functionally correct."
      - path: "apps/web/app/pair/[pairingId]/page.tsx"
        issue: "Server component calls redeemPairing() on every GET. Link prefetchers / Slack unfurl / Safari Preview can burn the phrase before the real user sees it. WR-06."
      - path: "apps/web/app/api/pairings/[pairingId]/confirm/route.ts"
        issue: "No Origin / Referer / sec-fetch-site check guarding the only cookie-minting route. SameSite=Lax is not sufficient defense in depth for the single long-lived credential. WR-02."
    missing:
      - "Move redeem transition off server-component GET — either client component POST on mount, or form-action POST gate — so link prefetchers cannot trigger the state mutation."
      - "Add same-origin check (origin vs host) in confirm/route.ts before calling confirmPairing; same for redeem/route.ts."
      - "Once CR-01 and the missing GET /api/pairings/[id] handler are fixed, add a full-flow integration test that drives bridge CLI -> web app -> browser confirm -> cookie set against a live Next.js dev server."
  - truth: "Both public services can run on Fly.io with TLS and explicit health checks."
    status: partial
    reason: "fly.toml manifests exist for web and relay with internal_port, force_https, and explicit healthz/readyz probes. PUBLIC_PATHS correctly allowlists /api/healthz so Fly probes are not redirected. However, two deploy-blocking issues exist: (1) CR-03 — both Dockerfiles wrap 'npm run build' in '|| true', so a failing tsc or next build still produces a runtime image that will crash on the first real request (apps/web has no .next/ directory, `next start` fails); (2) CR-02 — .github/workflows/fly-deploy.yml interpolates repository secrets directly into a run: shell command string, which is the exact GitHub-documented script injection / unsafe secrets pattern. The deploy workflow is NOT safe to run as written, even though the manifests themselves are structurally correct. No build/deploy has actually been executed to confirm the images boot; runtime verification is deferred to human testing."
    artifacts:
      - path: "apps/web/Dockerfile"
        issue: "Line 68: 'RUN npm run build --workspace @codex-mobile/web --if-present || true' — masks tsc/next build failures. Image will ship without .next/ and crash on first request. CR-03."
      - path: "apps/relay/Dockerfile"
        issue: "Line 65: same pattern '|| true' on build step. Smaller impact because runtime uses --experimental-strip-types, but still hides regressions. CR-03."
      - path: ".github/workflows/fly-deploy.yml"
        issue: "Lines 100-109 and 140-147: 'AUTH_GITHUB_ID=\"${{ secrets.AUTH_GITHUB_ID }}\" ...' interpolates secrets into the shell command string. GitHub expression engine substitutes BEFORE the shell parses. Any secret with a quote/newline/$/backtick is a shell-injection vector. CR-02."
    missing:
      - "Remove '|| true' from both Dockerfile build RUN lines; add a test that asserts /repo/apps/web/.next exists at the end of the web build stage."
      - "Rewrite fly-deploy.yml secrets push steps to pass values via env: block and reference them as $VAR inside run: — secrets must never be interpolated into run: command strings."
      - "Add permissions: contents: read at the workflow top level (WR-04)."
      - "Manually execute the Fly deploy pipeline once after fixes land and confirm both services come up green — this is the human-verification step listed below."
  - truth: "No public route stores or accepts long-lived auth in query parameters or localStorage (SEC-01 / SEC-06)."
    status: failed
    reason: "Cookie-based identity is enforced correctly (HttpOnly + Secure + SameSite=Lax + Path=/), and the ws-ticket helper is 60 seconds as required. But SEC-06 explicitly requires 'Origin, CSRF, and replay protections for browser sessions and pairing flows' — and the ONLY cookie-minting route (confirm) has no Origin/CSRF check, the POST /api/pairings route has no rate limiting / abuse controls (WR-11), and the rawPairingToken generation in pairing-service.ts produces a hash that is never verified on redeem/confirm (IN-02) so the single-use pairing token story that SEC-06 / PAIR-03 imply is not actually enforced — the token is a UUID and possession of the UUID is proof. The Phase 1 trust-boundary ADR says 'hashed single-use pairing token' but the runtime code treats the pairing ID (UUID) as the sole proof of possession. This is a semantic gap between the ADR and the implementation."
    artifacts:
      - path: "apps/web/app/api/pairings/[pairingId]/confirm/route.ts"
        issue: "No Origin / Referer / sec-fetch-site check. WR-02 — directly contradicts SEC-06's 'Origin, CSRF ... protections for ... pairing flows'."
      - path: "apps/web/app/api/pairings/route.ts"
        issue: "Unauthenticated, no rate limiting, no CAPTCHA. An attacker can exhaust pairing_sessions and audit_events. WR-11."
      - path: "apps/web/lib/pairing-service.ts"
        issue: "Lines ~229-232: rawPairingToken is generated and hashed into pairingTokenHash but never returned to the CLI or verified on redeem/confirm. The PAIRING_TOKEN_SECRET env var is wired through Fly deploy but has no runtime consumer. IN-02. This makes the 'single-use token' story ADR-0001 Rule 3 describes non-binding at runtime."
      - path: "apps/web/lib/device-session.ts"
        issue: "loadSessionCookieSecret only requires length >= 16 chars but HS256 best practice is 32+ bytes. WR-03."
    missing:
      - "Add Origin / Referer check in confirm/route.ts and redeem/route.ts before any state transition."
      - "Add a minimal in-memory token-bucket rate limit on POST /api/pairings keyed by x-forwarded-for."
      - "Either (a) return rawPairingToken to the bridge CLI and require it as a Bearer on redeem/confirm, or (b) delete the rawPairingToken / pairingTokenHash / PAIRING_TOKEN_SECRET wiring until the feature is actually used. Pick one before Phase 1 ships — the current state is misleading dead-code scaffolding."
      - "Harden loadSessionCookieSecret to require a 32-byte minimum after TextEncoder().encode()."
human_verification:
  - test: "Deploy the stack to Fly.io end-to-end and run the QR pairing flow from a real terminal to a real phone browser"
    expected: "(1) flyctl deploy for both apps/web and apps/relay completes green. (2) curl https://<web>/api/healthz returns 200 JSON. (3) curl https://<relay>/readyz returns 200 JSON. (4) node apps/bridge/src/cli/pair.ts --base https://<web> prints a scannable QR. (5) Scanning the QR on a phone lands on /sign-in, GitHub OAuth completes, the pair page shows a verification phrase. (6) Terminal displays the same phrase and prompts y/N. (7) After 'y', the browser receives a Set-Cookie for cm_device_session (7-day Max-Age) and the bridge CLI reports success."
    why_human: "No npm install / next build / docker build / fly deploy has been run per the user's 'never run applications automatically' global rule. The full end-to-end flow requires (a) a real Fly deployment, (b) real GitHub OAuth credentials on the callback URL, (c) a real phone browser to scan the QR, and (d) real human timing between redeem and confirm. None of this can be verified programmatically. This test MUST be re-run AFTER all code-level gaps above are fixed — before the fixes, the flow will fail at step 4 because of CR-01 + the missing GET /api/pairings/[id] handler."
  - test: "Terminal QR readability and fallback code legibility in a normal terminal"
    expected: "The QR code rendered by renderTerminalQr is scannable by a phone camera at normal terminal font size, the fallback userCode is human-readable, and the verification phrase displayed in the terminal exactly matches the one shown in the phone browser."
    why_human: "Terminal rendering quality is font- and viewport-dependent and requires a real human eye. Listed in 01-VALIDATION.md Manual-Only Verifications for PAIR-02 / PAIR-04."
  - test: "GitHub OAuth round-trip with the real callback URL"
    expected: "Sign-in redirects to GitHub, the operator approves, and the callback lands back on the originally requested /pair/[pairingId] URL with a valid cm_web_session cookie."
    why_human: "Requires a real GitHub OAuth application with AUTH_GITHUB_ID / AUTH_GITHUB_SECRET configured and the callback URL registered in GitHub Developer Settings. Per PROJECT.md / the plan user_setup blocks, this is a human prerequisite."
  - test: "Playwright phase-01-e2e-mobile suite against a live Next.js dev server"
    expected: "`CODEX_MOBILE_E2E_LIVE=1 npm run test:phase-01:full` passes all three specs in auth-pairing.spec.ts (sign-in redirect, redeem verification-phrase, expired-pairing rejection)."
    why_human: "Requires spinning up a Next.js dev server with env vars set; the user's global 'never run applications automatically' rule defers this to a human-initiated run."
---

# Phase 1: Identity & Pairing Foundation Verification Report

**Phase Goal:** Establish a secure internet-facing entry point for Codex Mobile with QR-based pairing and 7-day device sessions.
**Verified:** 2026-04-10
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Truths come from ROADMAP.md Success Criteria (non-negotiable) merged with must_haves.truths from all three plan frontmatter blocks. Duplicates collapsed; roadmap wording kept where they overlap.

| #   | Truth                                                                                                                                   | Status     | Evidence                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The repo has one workspace layout for web, relay, bridge, and shared packages.                                                          | VERIFIED   | `package.json:12` declares `"workspaces"`; `apps/{web,relay,bridge}` and `packages/{protocol,auth,db}` all present with package.json manifests.                                                                                                                                                                                        |
| 2   | Session state is modeled as short-lived web sessions plus 7-day device sessions, not one catch-all bearer token.                        | VERIFIED   | `packages/auth/src/device-session.ts:28` sets `DEVICE_SESSION_COOKIE_NAME = "cm_device_session"`; `packages/db/src/schema.ts` has distinct `web_sessions` and `device_sessions` tables; `apps/web/lib/device-session.ts:47` declares `WEB_SESSION_COOKIE_NAME = "cm_web_session"` separate from `DEVICE_SESSION_COOKIE_NAME`.          |
| 3   | Pairing is modeled as a single-use server-side record with expiry and a verification phrase.                                            | VERIFIED   | `packages/db/src/schema.ts:154` pairing_sessions.status default `pending`; `packages/protocol/src/pairing.ts:27-32` exports all five status values; `apps/web/lib/pairing-service.ts:62` PAIRING_TTL_SECONDS = 5 minutes; verification phrase generated in redeem and constant-time compared in confirm.                               |
| 4   | Phase 1 trust boundaries explicitly keep codex app-server and the local machine off the public internet.                               | VERIFIED   | `docs/adr/0001-phase-1-trust-boundary.md:107` contains exact rule "No direct public exposure of codex app-server"; ADR referenced from 18 other files; rule 5 states local bridge is outbound-only.                                                                                                                                    |
| 5   | A signed-in browser user can begin pairing from a phone-sized web UI.                                                                   | PARTIAL    | Sign-in page has mobile-first layout and exact CTA `Continue with GitHub`; pair page renders verificationPhrase; middleware redirects unauthenticated to /sign-in with callbackUrl. Browser half works structurally. Does NOT complete end-to-end because bridge side is broken (see truth #6 / #10).                                  |
| 6   | The local terminal can request a pairing, show a QR code plus fallback code, and wait for confirmation.                                 | FAILED     | **GAP.** Bridge CLI calls POST /api/pairings and polls GET /api/pairings/[id], BUT (a) middleware blocks bridge calls — /api/pairings is NOT in PUBLIC_PATHS (CR-01), and (b) no `route.ts` exists at `apps/web/app/api/pairings/[pairingId]/route.ts` for the GET poll. `waitForRedeem` can never resolve. Flow non-functional E2E.    |
| 7   | A device session is issued only after both the browser and terminal see the same verification phrase and the terminal explicitly approves. | PARTIAL    | confirmPairing -> constantTimeEqual -> issueDeviceSession invariant is correct AT THE CODE LEVEL; bridge CLI requires explicit operator y/yes in runPairCommand. But (a) redeem happens on GET via server component (prefetcher risk, WR-06); (b) no Origin/CSRF check on confirm (WR-02); (c) the path is unreachable E2E per truth #6. |
| 8   | All browser and pairing routes use short-lived or cookie-based credentials rather than query-string bearer tokens.                      | PARTIAL    | Cookies have HttpOnly+Secure+SameSite=Lax+Path=/; ws-ticket helper is exactly 60 seconds. But rawPairingToken generation (pairing-service.ts ~L229) is dead code — hash is never verified — so the "single-use pairing token" story ADR Rule 3 promises is NOT enforced at runtime; only the UUID pairingId gates confirm.            |
| 9   | Both public services can run on Fly.io with TLS and explicit health checks.                                                              | PARTIAL    | fly.toml manifests correct (internal_port, force_https, healthz/readyz probes); PUBLIC_PATHS allowlists /api/healthz so probes don't 307. But CR-03 (Dockerfile `\|\| true` on build) means a broken build ships a crashing image, and CR-02 (shell-injection in fly-deploy.yml secrets push) means the deploy workflow is unsafe.                |
| 10  | Pairing and web access work over Fly.io-hosted services without any inbound port on the developer machine (ROADMAP SC #4).             | FAILED     | **GAP.** The "no inbound port" half is structurally correct (bridge is outbound-only; ADR enforced). But "pairing and web access work over Fly.io-hosted services" cannot be true as written because CR-01 + the missing GET handler break the bridge CLI entry point, CR-02 makes the deploy pipeline unsafe, and CR-03 ships broken images. |
| 11  | Secrets and callback URLs required for GitHub auth and pairing are documented for operators.                                            | VERIFIED   | README.md has `## Local Development`, `## Authentication Setup`, `## Pairing Flow`, `## Fly.io Deployment` sections; .env.example carries Used by: annotations; fly-deploy.yml has header comment block listing every required secret.                                                                                                |

**Score:** 6/11 truths fully verified. 4 partial, 2 failed.

### Required Artifacts

| Artifact                                                     | Expected                                                             | Status      | Details                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                               | Workspace root + phase-01 scripts                                    | VERIFIED    | Contains `"workspaces"` and `test:phase-01:{quick,full}`.                                                                     |
| `packages/db/src/schema.ts`                                  | 60+ lines, pairing_sessions, 6 tables                                | VERIFIED    | 216 lines; `users`, `oauth_accounts`, `web_sessions`, `device_sessions`, `pairing_sessions`, `audit_events` all present.      |
| `packages/protocol/src/pairing.ts`                           | 40+ lines, PairingStatus/Create/Confirm exports                      | VERIFIED    | 102 lines; all five status values and all three exports present; Zod schemas included.                                      |
| `packages/auth/src/device-session.ts`                        | 40+ lines, cookie name + create/verify/rotate                        | VERIFIED    | 156 lines; `DEVICE_SESSION_COOKIE_NAME = "cm_device_session"`, all three helpers exported.                                    |
| `packages/auth/src/ws-ticket.ts`                             | WS_TICKET_TTL_SECONDS = 60, 60-second single-use                     | VERIFIED    | `WS_TICKET_TTL_SECONDS = 60` on line 30; docstring restates 60-second + single-use binding.                                   |
| `docs/adr/0001-phase-1-trust-boundary.md`                    | Contains "No direct public exposure of codex app-server" + 60-second | VERIFIED    | Rule 1 (line 107) and Rule 4 (line 121-127) carry both strings; referenced from 18 files.                                    |
| `vitest.workspace.ts`                                        | `phase-01-unit` project                                              | VERIFIED    | Name is `phase-01-unit` at line 16.                                                                                           |
| `playwright.config.ts`                                       | `phase-01-e2e-mobile` project                                        | VERIFIED    | Name is `phase-01-e2e-mobile` at line 35; testMatch widened to pick up apps/web/tests/*.spec.ts (documented in 01-02 summary). |
| `apps/web/app/sign-in/page.tsx`                              | 30+ lines, "Continue with GitHub"                                    | VERIFIED    | 98 lines; CTA exact match at line 76.                                                                                         |
| `apps/web/app/pair/[pairingId]/page.tsx`                     | Renders verificationPhrase in mobile layout                          | VERIFIED    | Contains both `Verification phrase` label and `verificationPhrase` variable.                                                  |
| `apps/web/lib/device-session.ts`                             | WEB_SESSION/DEVICE_SESSION cookie names + issueDeviceSession          | VERIFIED    | 251 lines; all three exports + HttpOnly+Secure+SameSite=Lax cookie options + 7-day expiry.                                  |
| `apps/web/middleware.ts`                                     | Guards pairing UI, redirects to /sign-in                             | STUB        | Structurally correct for browser redirect, but does NOT let the bridge CLI through to /api/pairings — CR-01 blocks E2E flow. |
| `apps/web/app/api/pairings/route.ts`                         | POST create, returns pairingId+pairingUrl+userCode+expiresAt         | VERIFIED    | Route handler exists and returns correct shape validated against Zod.                                                        |
| `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`      | POST redeem, generates verificationPhrase                            | VERIFIED    | Handler exists; returns verificationPhrase.                                                                                   |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`     | POST confirm, issues cm_device_session                               | VERIFIED    | Handler exists; calls confirmPairing -> issueDeviceSession.                                                                   |
| `apps/web/app/api/pairings/[pairingId]/route.ts`             | GET status (implicit from bridge client polling)                     | MISSING     | **GAP.** Bridge polls GET /api/pairings/[id] via `getPairingStatus()` (pairing-client.ts:107). No route.ts at that level — only confirm/ and redeem/ subdirectories.  |
| `apps/web/lib/pairing-service.ts`                            | All five audit event strings, state machine                          | VERIFIED    | All five `pairing.*` events in `PAIRING_AUDIT_EVENTS` (lines 49-55).                                                          |
| `apps/bridge/src/cli/pair.ts`                                | 40+ lines, renderTerminalQr + verificationPhrase                     | VERIFIED    | 198 lines; renderTerminalQr imported and called; verificationPhrase displayed and approval-gated.                            |
| `apps/bridge/src/lib/pairing-client.ts`                      | `/api/pairings` typed client                                         | ORPHANED    | Contains `/api/pairings` string in 9 places, BUT the GET endpoint it polls has no handler, and every request is blocked by middleware. Exists but is not functionally reachable. |
| `apps/relay/src/server.ts`                                   | healthz + readyz registered                                          | VERIFIED    | Imports `registerHealthRoutes` which wires both probes.                                                                      |
| `apps/relay/src/routes/health.ts`                            | handleHealthz, handleReadyz, registerHealthRoutes                    | VERIFIED    | All three exports present; registerReadyzRoute delegated to ./readyz.                                                         |
| `apps/relay/src/routes/readyz.ts`                            | handleReadyz + registerReadyzRoute                                   | VERIFIED    | Module exists per 01-03 summary; re-exported from health.ts.                                                                   |
| `apps/web/app/api/healthz/route.ts`                          | GET returning {status, service, ...}                                 | VERIFIED    | Handler exists; public via PUBLIC_PATHS allowlist.                                                                            |
| `apps/web/Dockerfile`                                        | node:22 + EXPOSE                                                     | STUB        | Present with node:22-alpine + EXPOSE 3000, BUT build step has `\|\| true` (line 68) which hides real build failures. CR-03. |
| `apps/relay/Dockerfile`                                      | node:22 + EXPOSE                                                     | STUB        | Present with node:22-alpine + EXPOSE 8080, BUT build step has `\|\| true` (line 65). CR-03.                                  |
| `apps/web/fly.toml`                                          | internal_port + healthz                                              | VERIFIED    | internal_port = 3000, health check path /api/healthz.                                                                          |
| `apps/relay/fly.toml`                                        | internal_port + readyz                                               | VERIFIED    | internal_port = 8080, readiness path /readyz, liveness path /healthz split.                                                   |
| `.github/workflows/fly-deploy.yml`                           | flyctl + PAIRING_TOKEN_SECRET + DATABASE_URL                         | STUB        | All three strings present, BUT secrets are interpolated directly into run: shell command via `${{ secrets.X }}` — script injection vector. CR-02. |
| `README.md`                                                  | Local Dev + Auth Setup + Pairing Flow + Fly.io Deployment sections   | VERIFIED    | All four sections present; contains `/api/healthz`, `/readyz`, `outbound connectivity only`.                                  |

### Key Link Verification

| From                                                               | To                                                        | Via                                                              | Status     | Details                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/auth/src/device-session.ts`                              | `packages/db/src/schema.ts`                               | session helper references `device_sessions` + `web_sessions`    | WIRED      | Lines 5, 13, 18 mention both table names.                                                                                                      |
| `packages/protocol/src/pairing.ts`                                 | `packages/db/src/schema.ts`                               | protocol status values align with schema `status` column         | WIRED      | Both carry `pending/redeemed/confirmed/expired/cancelled`.                                                                                      |
| `docs/adr/0001-phase-1-trust-boundary.md`                          | `packages/auth/src/ws-ticket.ts`                          | ADR defines 60-second single-use derived ticket                  | WIRED      | Both contain `60-second` and `single-use`; `WS_TICKET_TTL_SECONDS = 60` enforced in code.                                                      |
| `apps/bridge/src/lib/pairing-client.ts`                            | `apps/web/app/api/pairings/route.ts`                      | bridge starts pairing by calling the hosted API                   | NOT_WIRED  | **GAP.** Middleware blocks the call (CR-01) so in production the client gets a 307 to HTML /sign-in and zod-parses garbage. Static code path exists but runtime path is broken. |
| `apps/bridge/src/lib/pairing-client.ts`                            | `apps/web/app/api/pairings/[pairingId]/route.ts`          | bridge polls status                                               | NOT_WIRED  | **GAP.** No route.ts exists at that level. Polling has nothing to hit. |
| `apps/web/app/pair/[pairingId]/page.tsx`                           | `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`  | redeem screen submits verification phrase confirmation            | WIRED      | Pair page auto-redeems and shows phrase; confirm route is called from the browser client on approval. |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts`           | `apps/web/lib/device-session.ts`                          | confirmation route issues device cookie via issueDeviceSession    | WIRED      | confirmPairing -> issueDeviceSession path confirmed; cookie Set-Cookie headers and 7-day Max-Age present.                                      |
| `apps/web/fly.toml`                                                | `apps/web/app/api/healthz/route.ts`                       | Fly health check targets /api/healthz                             | WIRED      | Path match; /api/healthz in PUBLIC_PATHS so it isn't 307'd.                                                                                     |
| `apps/relay/fly.toml`                                              | `apps/relay/src/routes/readyz.ts`                         | readiness probe targets /readyz                                   | WIRED      | Path match; relay server.ts registers /readyz via registerHealthRoutes.                                                                         |
| `.github/workflows/fly-deploy.yml`                                 | `apps/web/fly.toml`                                       | workflow deploys web using its fly.toml                           | PARTIAL    | Correct `--config apps/web/fly.toml` reference, BUT secrets push step is an injection vector (CR-02) so the workflow is unsafe to run as-is.  |

### Data-Flow Trace (Level 4)

| Artifact                                   | Data Variable          | Source                                                                 | Produces Real Data | Status       |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------- | ------------------ | ------------ |
| `apps/web/app/pair/[pairingId]/page.tsx`   | `pairing`              | Server component calls `redeemPairing()` / `loadPairingStatus()` directly on `apps/web/lib/pairing-service.ts` in-memory store | Yes (in-process)   | FLOWING      |
| `apps/web/app/sign-in/page.tsx`            | (static CTA)           | No dynamic data — CTA is a hardcoded string per plan spec              | N/A                | N/A          |
| `apps/bridge/src/cli/pair.ts`              | `created`, `redeemed`  | `PairingClient.createPairing()` -> `fetch` -> web API -> in-memory store | No (at runtime)    | DISCONNECTED |
| `apps/web/app/api/healthz/route.ts`        | `payload`              | Hardcoded `{ status: "ok", service: ... }` + process uptime            | Yes (static-ish)   | FLOWING      |
| `apps/relay/src/routes/readyz.ts`          | `payload`              | Hardcoded ready payload                                                | Yes                | FLOWING      |

Note on the bridge CLI row: the data variable (`created`, `redeemed`) would flow correctly IF the middleware allowed the request through AND IF the GET poll endpoint existed. At build time the code looks wired; at runtime the fetch will either be redirected to /sign-in HTML (causing a zod parse error) or hit a 404 on the GET status poll. Level 4 surfaces this as DISCONNECTED because the data source does not produce the expected data at runtime.

### Behavioral Spot-Checks

SKIPPED. The user's global rule "never run applications automatically" prevents running any `npm install`, `next build`, `docker build`, `node apps/bridge/src/cli/pair.ts`, or `flyctl deploy` command. All spot-checks for this phase would require one of those. The corresponding runtime verifications have been moved to the `human_verification` section.

### Requirements Coverage

| Requirement | Source Plan          | Description                                                                                  | Status       | Evidence                                                                                                                                                                                               |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AUTH-01     | 01-01, 01-02         | Secure first-party sign-in                                                                   | SATISFIED    | Auth.js GitHub provider wired; /sign-in page; middleware redirect; cm_web_session cookie; 12-hour rolling session.                                                                                   |
| AUTH-02     | 01-02                | 7-day device session                                                                         | PARTIAL      | DEVICE_SESSION_TTL_SECONDS = 7 days at the cookie helper level AND at the device-session issue call site; but the cookie is never actually issued E2E because of CR-01 / missing GET handler.        |
| PAIR-01     | 01-02                | Local CLI bridge can create a pairing session                                                | BLOCKED      | Bridge CLI code exists, but POST /api/pairings is blocked by middleware (CR-01). The create call cannot succeed on the deployed stack.                                                                |
| PAIR-02     | 01-02                | Terminal displays QR + fallback code                                                         | PARTIAL      | `renderTerminalQr` wired and QR rendering logic exists, BUT because PAIR-01 is blocked the CLI never gets a real pairingUrl to render. Static test of the QR renderer itself would still pass.     |
| PAIR-03     | 01-01, 01-02         | Pairing token single-use and expires within minutes                                          | PARTIAL      | 5-minute expiry is enforced; pending -> expired transition + audit row is correct. BUT the "hashed single-use pairing token" story from ADR Rule 3 is dead code — hash is never verified. IN-02.       |
| PAIR-04     | 01-01, 01-02         | Verification phrase displayed in both terminal and web                                       | PARTIAL      | Correct at the code level; both the terminal and web pages render the same phrase. Terminal requires explicit y/N approval. Non-functional E2E because of CR-01 / missing GET handler.              |
| PAIR-05     | 01-02                | Pairing never requires opening an inbound port                                               | SATISFIED    | Bridge is outbound-only (ADR Rule 5); no inbound server in apps/bridge; relay is the only hosted ingress. Structurally enforced and architecturally verified.                                      |
| SEC-01      | 01-01, 01-02         | Short-lived connection credentials derived from device session                               | SATISFIED    | `cm_ws_ticket` is 60 seconds, JWT-signed with WS_TICKET_SECRET (distinct from SESSION_COOKIE_SECRET), carries jti for single-use, minted from the device session. ADR Rule 4 binds this.            |
| SEC-06      | 01-01, 01-02         | Origin, CSRF, and replay protections for browser sessions and pairing flows                  | BLOCKED      | Cookie SameSite=Lax is present, but: (a) NO Origin/Referer check on confirm route (WR-02); (b) NO rate limit on POST /api/pairings (WR-11); (c) unused rawPairingToken (IN-02) — single-use not enforced. |
| OPS-01      | 01-03                | Public web app and relay deploy on Fly.io with TLS and health checks                        | BLOCKED      | fly.toml manifests structurally correct, but (1) CR-03 Dockerfiles mask build failures -> broken images ship green, (2) CR-02 script injection in deploy workflow makes the CI pipeline unsafe to run. |

**Coverage:** 3 of 10 requirements fully SATISFIED (AUTH-01, SEC-01, PAIR-05). 5 PARTIAL (AUTH-02, PAIR-02, PAIR-03, PAIR-04). 3 BLOCKED (PAIR-01, SEC-06, OPS-01).

**Orphaned requirements:** None. Every requirement the plans claim maps to something in the codebase. REQUIREMENTS.md traceability table maps exactly these 10 IDs to Phase 1, and all 10 are declared in at least one plan's `requirements:` frontmatter field.

### Anti-Patterns Found

| File                                          | Line    | Pattern                                                                                                                           | Severity   | Impact                                                                                                                    |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/Dockerfile`                         | 68      | `RUN npm run build --workspace @codex-mobile/web --if-present \|\| true`                                                          | Blocker    | Masks tsc/next build failures. Image ships without .next/ directory; `next start` crashes on first request. CR-03.        |
| `apps/relay/Dockerfile`                       | 65      | `RUN npm run build --workspace @codex-mobile/relay --if-present \|\| true`                                                        | Blocker    | Masks tsc failures. Runtime uses --experimental-strip-types so the image still boots, but compile errors become invisible. CR-03. |
| `.github/workflows/fly-deploy.yml`            | 100-109 | Secrets interpolated into `run:` shell command string via `${{ secrets.X }}`                                                      | Blocker    | Script-injection vector if any secret ever contains `"`, `$`, newline, backtick, `;`. GitHub's own docs list this as unsafe. CR-02. |
| `.github/workflows/fly-deploy.yml`            | 140-147 | Same as above in the deploy-relay job                                                                                             | Blocker    | Same CR-02 pattern.                                                                                                       |
| `apps/web/auth.config.ts`                     | 29-33   | `PUBLIC_PATHS` allowlist missing `/api/pairings`                                                                                  | Blocker    | Middleware redirects bridge CLI calls to /sign-in, breaking the pairing flow E2E. CR-01.                                  |
| `apps/web/app/api/pairings/[pairingId]/`      | —       | Missing `route.ts` GET handler at this path segment                                                                               | Blocker    | Bridge client `getPairingStatus()` polls this route and always gets 404 (or 307 without the CR-01 fix).                  |
| `apps/web/lib/pairing-service.ts`             | ~229    | `rawPairingToken` generated and hashed but never returned or verified                                                             | Warning    | Dead code that creates a misleading "hashed single-use token" impression. IN-02. Either use it or delete it before ship. |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | 43-110  | No Origin / Referer / sec-fetch-site check on the only cookie-minting route                                                      | Warning    | Violates SEC-06 "Origin, CSRF ... protections for pairing flows". WR-02.                                                 |
| `apps/web/lib/device-session.ts`              | 96-104  | `loadSessionCookieSecret` accepts `length >= 16` chars, not 32 bytes                                                              | Warning    | Accepts sub-HS256-best-practice keys. WR-03.                                                                              |
| `apps/web/app/pair/[pairingId]/page.tsx`      | 76-83   | State transition `pending -> redeemed` happens on HTTP GET in a server component                                                  | Warning    | Link prefetchers can burn the verification phrase before the user sees the page. WR-06.                                  |
| `apps/web/lib/pairing-service.ts`             | 115-147 | `defaultPairingStore` is a process-local Map; no production guard                                                                 | Warning    | fly.toml allows multi-machine; pairing created on machine A not findable on machine B. WR-08.                              |
| `apps/bridge/src/lib/pairing-client.ts`       | 187-201 | `waitForRedeem` converts every polling error (including the CR-01 redirect) to `null`                                             | Warning    | Masks auth / 4xx errors as "timed out waiting". Would have caught CR-01 in dev if it surfaced errors. WR-09.              |
| `apps/web/app/api/pairings/route.ts`          | 43-87   | No rate limit / abuse control on unauthenticated create                                                                           | Warning    | Public endpoint can be spammed. WR-11.                                                                                    |
| `apps/web/auth.config.ts`                     | —       | No `callbacks.redirect` allowlist for signIn callbackUrl                                                                          | Warning    | Relying on undocumented Auth.js default to block external redirects. WR-05.                                              |
| `apps/web/app/api/pairings/[pairingId]/confirm/route.ts` | 111-134 | `catch` block returns raw error message in 500 response                                                                           | Warning    | Internal state leaks to unauthenticated caller. WR-01.                                                                    |
| `apps/relay/src/server.ts`                    | 38-42   | `trustProxy: true` accepts X-Forwarded-* from any IP                                                                              | Warning    | Footgun if relay port ever exposed directly. WR-10.                                                                       |
| `.github/workflows/fly-deploy.yml`            | 50-78   | No `permissions:` block at workflow level                                                                                         | Warning    | GITHUB_TOKEN inherits repo-default scopes unnecessarily. WR-04.                                                          |
| `apps/web/tests/auth-pairing.spec.ts`         | 36-45   | Live-server redirect test gated on `CODEX_MOBILE_E2E_LIVE=1`                                                                      | Info       | The exact path CR-01 breaks is not covered by CI. IN-09.                                                                  |

### Human Verification Required

Four tests need human execution. The first is the critical deploy-and-pair-end-to-end test that must be re-run AFTER the gaps are closed. The others were already expected per 01-VALIDATION.md or the user setup blocks.

1. **Deploy and pair end-to-end on real Fly.io**
   - **Test:** (1) `flyctl deploy` both apps/web and apps/relay. (2) `curl https://<web>/api/healthz` -> 200 JSON. (3) `curl https://<relay>/readyz` -> 200 JSON. (4) Run `node apps/bridge/src/cli/pair.ts --base https://<web>` in a real terminal. (5) Scan the printed QR on a phone. (6) Complete GitHub sign-in. (7) Observe verification phrase matches on terminal and phone. (8) Approve on terminal. (9) Phone receives cm_device_session cookie with 7-day Max-Age. (10) Bridge CLI reports success.
   - **Expected:** All ten steps complete without error. curl to healthz/readyz returns 200. Pairing flow runs cleanly. Device session cookie issued.
   - **Why human:** Requires real Fly deployment, real GitHub OAuth, real phone camera, real human timing between steps 6 and 8. Per the global "never run applications automatically" rule, none of these can be executed by this verifier. **This test MUST be run AFTER the `gaps` above are closed — it WILL fail at step 4 or 5 before the fixes because CR-01 and the missing GET handler both break the bridge CLI entry point.**

2. **Terminal QR readability and verification phrase parity**
   - **Test:** Run the bridge pair command in a normal terminal (80-col minimum), scan the QR with a phone, confirm the fallback userCode is legible, and confirm the verification phrase displayed in the terminal exactly matches the phrase on the phone's pair page.
   - **Expected:** QR is scannable at normal terminal font size. userCode is human-readable. Phrases match character-for-character.
   - **Why human:** Terminal rendering fidelity is font- and viewport-dependent and requires a real human eye. Listed in 01-VALIDATION.md's Manual-Only Verifications for PAIR-02 / PAIR-04.

3. **GitHub OAuth round-trip with real callback URL**
   - **Test:** With AUTH_GITHUB_ID / AUTH_GITHUB_SECRET populated and the callback URL registered in GitHub Developer Settings, navigate to /pair/x on the deployed web app, get redirected to /sign-in, click "Continue with GitHub", approve on GitHub, land back on /pair/x with cm_web_session cookie set.
   - **Expected:** Full OAuth round-trip succeeds. cm_web_session cookie is present after callback.
   - **Why human:** Requires real GitHub OAuth credentials and a real browser. Deferred per user_setup blocks in 01-02-PLAN.md.

4. **Playwright phase-01-e2e-mobile full suite against a live dev server**
   - **Test:** `CODEX_MOBILE_E2E_LIVE=1 npm run test:phase-01:full`
   - **Expected:** All three specs in apps/web/tests/auth-pairing.spec.ts pass: sign-in redirect invariant, redeem verification-phrase invariant, expired-pairing rejection.
   - **Why human:** Requires a running Next.js dev server. Deferred per the "never run applications automatically" rule. Suggest running this as part of the same session as test #1 above.

### Gaps Summary

Phase 1 built almost everything the plans asked for: the workspace layout, six-table Drizzle schema, the protocol/auth/db shared packages with exact lifetimes (7-day device session, 60-second ws-ticket), the Phase-1 trust-boundary ADR with the binding "No direct public exposure of codex app-server" rule, the Auth.js GitHub sign-in, the mobile-first pair page with verification phrase, the in-memory pairing state machine with audit rows, the bridge CLI with `renderTerminalQr` and explicit y/N approval, the relay Fastify skeleton with /healthz and /readyz, the Fly.io manifests with explicit probes, the deploy workflow, and the operator README. At the artifact level, almost all must_haves are present and structurally correct.

The phase's **goal** — "Establish a secure internet-facing entry point for Codex Mobile with QR-based pairing and 7-day device sessions" — is not actually achieved. Two code-level blockers cut the pairing flow in half:

1. **CR-01: Middleware blocks the bridge CLI.** `PUBLIC_PATHS` in `apps/web/auth.config.ts` lists only `/sign-in`, `/api/auth`, and `/api/healthz`. The bridge CLI's `PairingClient.createPairing()` calls `POST /api/pairings` with no browser cookie. Middleware 307-redirects every such call to `/sign-in`, `fetch` follows the redirect to HTML, and `PairingCreateResponseSchema.safeParse(JSON.parse(html))` fails with a confusing "invalid payload". The end-to-end pairing flow is broken on the deployed stack.

2. **Missing GET /api/pairings/[pairingId] handler.** The bridge's `getPairingStatus()` polls `GET /api/pairings/{pairingId}` to wait for the user to scan the QR. No `route.ts` file exists at `apps/web/app/api/pairings/[pairingId]/route.ts` — only `confirm/route.ts` and `redeem/route.ts` subdirectories. Even if CR-01 were fixed, the polling loop would permanently 404.

Two further blockers exist on the deploy side:

3. **CR-02: Script injection in fly-deploy.yml.** Secrets are interpolated into `run:` shell command strings via `${{ secrets.X }}`. This is the exact pattern GitHub's own security docs list as unsafe. The deploy workflow is not safe to run as written.

4. **CR-03: Dockerfiles mask build failures.** Both apps/web/Dockerfile and apps/relay/Dockerfile wrap `npm run build` in `|| true`. A broken `next build` still produces a runtime image; for apps/web that image has no `.next/` directory and `next start` crashes on the first real request. Production images can ship green while being broken.

One architecturally significant semantic gap is also present:

5. **Unused pairing token hash.** `pairing-service.ts` generates a 32-byte `rawPairingToken`, hashes it into `pairingTokenHash`, and stores the hash — but never returns the raw token to the bridge CLI and never verifies it on redeem/confirm. The `PAIRING_TOKEN_SECRET` env var is wired through Fly deploy but has no runtime consumer. The ADR-0001 Rule 3 phrase "hashed single-use pairing token" is not actually enforced; possession of the pairing UUID is the only proof. Either complete the token-verification feature or delete the scaffolding to prevent a misleading security posture claim.

**The ADR itself is consistently referenced** across `packages/auth`, `packages/db`, `packages/protocol`, `apps/web`, and `apps/relay`, and the trust boundaries it enforces (cookies not bearer tokens, 60-second ws-ticket, stdio-only Codex, outbound-only bridge) are honored in code. The failures above are in the implementation of the runtime path, not in the trust model.

**Recommended next steps** (for `/gsd-plan-phase --gaps`):

- **Plan 01-04 (gap closure) Wave 1:** Fix CR-01 (PUBLIC_PATHS + middleware equality/regex allowlist), add GET /api/pairings/[pairingId]/route.ts handler, fix CR-02 (move secrets to env: block), fix CR-03 (drop `|| true`, add `.next/` existence assertion in web Dockerfile).
- **Plan 01-04 Wave 2:** Add regression tests: Vitest unit test for middleware allowing POST /api/pairings, Vitest unit test for GET /api/pairings/[id] returning 200 JSON, Playwright test that bridge CLI can complete the full flow against a dev server.
- **Plan 01-04 Wave 3:** Address SEC-06 semantic gaps — Origin check on confirm, rate limit on create, resolve the rawPairingToken / PAIRING_TOKEN_SECRET dead code (either implement or delete).
- **Manual step (operator):** After 01-04 lands, run the human-verification deploy test (test #1 above) end-to-end.

---

_Verified: 2026-04-10_
_Verifier: Claude (gsd-verifier)_
