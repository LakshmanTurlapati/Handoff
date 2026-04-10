---
phase: 01-identity-pairing-foundation
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - .github/workflows/fly-deploy.yml
  - apps/bridge/src/cli/pair.ts
  - apps/bridge/src/lib/pairing-client.ts
  - apps/bridge/src/lib/qr.ts
  - apps/relay/Dockerfile
  - apps/relay/fly.toml
  - apps/relay/src/index.ts
  - apps/relay/src/routes/health.ts
  - apps/relay/src/routes/readyz.ts
  - apps/relay/src/server.ts
  - apps/web/Dockerfile
  - apps/web/app/api/healthz/route.ts
  - apps/web/app/api/pairings/[pairingId]/confirm/route.ts
  - apps/web/app/api/pairings/[pairingId]/redeem/route.ts
  - apps/web/app/api/pairings/route.ts
  - apps/web/app/pair/[pairingId]/page.tsx
  - apps/web/app/sign-in/page.tsx
  - apps/web/auth.config.ts
  - apps/web/auth.ts
  - apps/web/fly.toml
  - apps/web/lib/device-session.ts
  - apps/web/lib/pairing-service.ts
  - apps/web/middleware.ts
  - apps/web/tests/auth-pairing.spec.ts
  - packages/auth/package.json
  - packages/db/drizzle.config.ts
  - packages/db/package.json
  - packages/protocol/package.json
findings:
  critical: 3
  warning: 11
  info: 9
  total: 23
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-10
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 1 (identity + pairing foundation) lays down the bridge -> web -> relay
trust boundary, the `/sign-in` GitHub OAuth flow, the QR/redeem/confirm
pairing ceremony, and the supporting Fly.io + CI plumbing. The design is
largely sound: cookie flags match the trust-boundary ADR, the verification
phrase is compared in constant time, pairing state transitions are
explicit, and audit rows are written at each stage.

Three Critical issues were found that will block the pairing flow and the
deploy pipeline from operating safely as-is:

1. The Next.js middleware public-path allowlist is missing the bridge
   facing pairing endpoints (`POST /api/pairings` and
   `GET /api/pairings/[pairingId]`). Auth.js will redirect every bridge
   CLI request to `/sign-in`, so `pair` cannot complete end-to-end.
2. `.github/workflows/fly-deploy.yml` interpolates repository secrets
   directly into the shell command string of a `run:` step, which is a
   textbook GitHub Actions script injection / secret handling
   anti-pattern.
3. Both Dockerfiles wrap their `npm run build` step in `|| true`, so a
   failing `tsc` or `next build` still produces a runtime image — for
   `apps/web` this means the container will boot without a `.next/`
   directory and `npm start` will crash in production.

A further 11 Warning items (CSRF/origin checks, error leakage in API
responses, dev dependencies shipped to production, single-machine state
assumptions, weak `SESSION_COOKIE_SECRET` length gate, etc.) and 9 Info
items are listed below. None of the Critical items require rewriting the
trust-boundary model — they are all fixable with small targeted patches
in this phase.

Note on scope: the review prompt explicitly calls out `packages/auth/src/ws-ticket.ts`
as a focus area, but that file is NOT in the `files:` list for this
review. Its findings (if any) should be covered by a future phase or a
re-run with the file added to scope.

## Critical Issues

### CR-01: Middleware blocks the bridge CLI from reaching `/api/pairings`

**File:** `apps/web/middleware.ts:23` and `apps/web/auth.config.ts:29-33`
**Issue:** `PUBLIC_PATHS` contains only `/sign-in`, `/api/auth`, and
`/api/healthz`. Every other path falls through to the `authorized`
callback's `Boolean(auth?.user)` check, and the middleware
redirects unauthenticated requests to `/sign-in`. The bridge CLI
(`apps/bridge/src/cli/pair.ts` -> `PairingClient.createPairing`) calls
`POST /api/pairings` and then polls `GET /api/pairings/{pairingId}` WITHOUT
any browser session cookie — those calls will be redirected to `/sign-in`,
the default `fetch` will follow the redirect to the 200 HTML sign-in page,
and `PairingCreateResponseSchema.safeParse(JSON.parse(html))` will fail
with an opaque "invalid payload" error. The bridge can never start or
observe a pairing against the deployed stack. The `POST /api/pairings`
route handler itself is correctly documented as unauthenticated
(`apps/web/app/api/pairings/route.ts:12-16`), but middleware runs first
and overrides that intent.

**Fix:** Add the bridge-facing pairing routes to `PUBLIC_PATHS` so the
middleware lets them through, and keep the route-level `auth()` guards in
`[pairingId]/redeem` and `[pairingId]/confirm` unchanged so authenticated
operations stay locked down:
```ts
// apps/web/auth.config.ts
export const PUBLIC_PATHS = [
  "/sign-in",
  "/api/auth",
  "/api/healthz",
  "/api/pairings",                // POST create + GET status (bridge CLI)
] as const;
```
Then in `middleware.ts`, keep the prefix-match logic but ensure
`/api/pairings/[pairingId]/redeem` and `/api/pairings/[pairingId]/confirm`
are NOT treated as public — they already enforce `auth()` at the handler
level, but the prefix-match of `/api/pairings` will incorrectly
whitelist them. Instead, allowlist the exact unauthenticated routes by
pathname equality:
```ts
// apps/web/middleware.ts
const UNAUTHENTICATED_API_ROUTES = new Set([
  "/api/pairings",                 // POST: create
]);
const isPairingStatusGet =
  request.method === "GET" &&
  /^\/api\/pairings\/[^\/]+$/.test(pathname);

if (UNAUTHENTICATED_API_ROUTES.has(pathname) || isPairingStatusGet) {
  return NextResponse.next();
}
```
Add a regression Playwright test that does an unauthenticated
`fetch("/api/pairings", { method: "POST" })` and asserts the response is
a 201 JSON payload, not a redirect to `/sign-in`.

### CR-02: Secrets interpolated directly into a shell command (script injection risk)

**File:** `.github/workflows/fly-deploy.yml:100-109` and `140-147`
**Issue:** Both `flyctl secrets set` steps interpolate every secret
directly into the shell command string via `${{ secrets.X }}`:
```yaml
run: |
  flyctl secrets set \
    --stage \
    --config apps/web/fly.toml \
    AUTH_GITHUB_ID="${{ secrets.AUTH_GITHUB_ID }}" \
    AUTH_GITHUB_SECRET="${{ secrets.AUTH_GITHUB_SECRET }}" \
    ...
```
The GitHub Actions expression engine substitutes the secret into the
YAML-rendered shell script BEFORE the shell parses it. If a secret ever
contains a double quote, `$`, backtick, newline, or `;` — whether by
accident during a rotation or via a malicious operator with repo write
access — the shell will see an injection payload, not the intended
value. This is the exact pattern GitHub's own security documentation
lists as "unsafe use of secrets" and calls out as a code execution
vector on the runner. It also risks leaking the secret into the
runner's process list and `set -x` traces.

**Fix:** Pass secrets via `env:` so the shell only ever sees variable
names, never the literal secret value, and never let the expression
engine touch the command string:
```yaml
- name: Push web app secrets to Fly
  env:
    FLY_API_TOKEN:        ${{ secrets.FLY_API_TOKEN }}
    AUTH_GITHUB_ID:       ${{ secrets.AUTH_GITHUB_ID }}
    AUTH_GITHUB_SECRET:   ${{ secrets.AUTH_GITHUB_SECRET }}
    SESSION_COOKIE_SECRET: ${{ secrets.SESSION_COOKIE_SECRET }}
    PAIRING_TOKEN_SECRET: ${{ secrets.PAIRING_TOKEN_SECRET }}
    WS_TICKET_SECRET:     ${{ secrets.WS_TICKET_SECRET }}
    DATABASE_URL:         ${{ secrets.DATABASE_URL }}
  run: |
    flyctl secrets set \
      --stage \
      --config apps/web/fly.toml \
      AUTH_GITHUB_ID="$AUTH_GITHUB_ID" \
      AUTH_GITHUB_SECRET="$AUTH_GITHUB_SECRET" \
      SESSION_COOKIE_SECRET="$SESSION_COOKIE_SECRET" \
      PAIRING_TOKEN_SECRET="$PAIRING_TOKEN_SECRET" \
      WS_TICKET_SECRET="$WS_TICKET_SECRET" \
      DATABASE_URL="$DATABASE_URL"
```
Apply the same change to the `deploy-relay` job at lines 140-147. While
editing, also add an explicit `permissions:` block at the workflow
level to drop unnecessary `GITHUB_TOKEN` scopes (see WR-04).

### CR-03: `npm run build ... || true` hides build failures in both Dockerfiles

**File:** `apps/web/Dockerfile:68` and `apps/relay/Dockerfile:65`
**Issue:** Both production Dockerfiles swallow non-zero exit codes from
their build step:
```dockerfile
# apps/web/Dockerfile:68
RUN npm run build --workspace @codex-mobile/web --if-present || true
```
For `apps/web` this is particularly bad: the runtime stage executes
`npm start --workspace @codex-mobile/web`, which runs `next start`
against a `.next/` directory that does not exist if the build failed.
The image still passes CI (docker build exits 0), Fly deploys it,
health checks hit `/api/healthz`, and the container crashes on the
first real request. A corrupt production image is produced silently.
For `apps/relay` the risk is smaller because the runtime uses
`node --experimental-strip-types` to run the TS sources directly, but
the masked failure still turns a broken `tsc` into an invisible
regression.

**Fix:** Drop the `|| true`. If `@codex-mobile/web` does not yet define
a `build` script, fall back to the `--if-present` flag alone (which
returns 0 when the script is genuinely absent, but preserves the real
exit code when the script runs and fails):
```dockerfile
RUN npm run build --workspace @codex-mobile/web --if-present
```
Add a grep-based build-time assertion that `/repo/apps/web/.next`
exists at the end of the build stage so the image cannot ship without
a compiled Next.js output:
```dockerfile
RUN test -d /repo/apps/web/.next || (echo "next build did not produce .next" && exit 1)
```
Apply the equivalent fix to `apps/relay/Dockerfile:65`.

## Warnings

### WR-01: Raw error messages leaked to API response bodies

**File:** `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:111-134` and
`apps/web/app/api/pairings/[pairingId]/redeem/route.ts:85-94`
**Issue:** Both handlers catch any error, read `error.message`, and if no
substring match is found they return `{ error: message }` in a 500
response. Because `pairing-service.ts` `throw new Error(...)` messages
include internal state (state machine names, "pairing_session UUID not
found", etc.), arbitrary internal strings are reflected back to the
unauthenticated caller. A future change that logs a stack fragment or a
DB error into `message` would leak that to the HTTP response too.

**Fix:** Replace the fallthrough 500 with a generic message and log the
original internally:
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message.includes("not found"))  return NextResponse.json({ error: "pairing_not_found" }, { status: 404 });
  if (message.includes("cannot confirm")) return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  if (message.includes("phrase mismatch")) return NextResponse.json({ error: "phrase_mismatch" }, { status: 403 });
  if (message.includes("must be redeemed")) return NextResponse.json({ error: "not_redeemed" }, { status: 409 });
  console.error("pairing confirm internal error", error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
```
Same change in `redeem/route.ts:93`.

### WR-02: No Origin / CSRF check on cookie-issuing `confirm` route

**File:** `apps/web/app/api/pairings/[pairingId]/confirm/route.ts:43-110`
**Issue:** The `POST /api/pairings/[pairingId]/confirm` handler is the
ONLY path that issues a `cm_device_session` cookie, yet it performs no
Origin / Referer / sec-fetch-site check. Auth.js's SameSite=Lax cookie
mitigates most cross-site POSTs, but Lax still allows top-level
navigations and a window-of-risk exists on browsers/Android WebViews
with weaker Lax enforcement. Because this is the ONLY long-lived
credential mint, it deserves defense in depth.

**Fix:** Add a same-origin check before calling `confirmPairing`:
```ts
const origin = request.headers.get("origin");
const host = request.headers.get("host");
if (origin && new URL(origin).host !== host) {
  return NextResponse.json({ error: "cross_origin_not_allowed" }, { status: 403 });
}
```
Also consider requiring the `sec-fetch-site: same-origin` header when
present. Mirror this guard on `redeem/route.ts` so the state
transition is also same-origin.

### WR-03: `SESSION_COOKIE_SECRET` length gate is too weak

**File:** `apps/web/lib/device-session.ts:96-104`
**Issue:** `loadSessionCookieSecret()` only requires `raw.length >= 16`,
i.e. 16 UTF-16 characters. The deploy workflow comments correctly say
"32+ byte random signing key" but the runtime check accepts a 16-char
key (as little as 16 bytes of entropy once ASCII-encoded, or worse if
the operator uses a human-memorable string). HS256 best practice is a
minimum 256-bit (32-byte) key; anything shorter is a weak HMAC.

**Fix:** Require the documented length AND gate on Buffer byte length
rather than JS string length (important if the operator supplies a
binary-encoded value):
```ts
export function loadSessionCookieSecret(): Uint8Array {
  const raw = process.env.SESSION_COOKIE_SECRET;
  if (!raw) throw new Error("SESSION_COOKIE_SECRET is not set");
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength < 32) {
    throw new Error(
      "SESSION_COOKIE_SECRET must be at least 32 bytes for HS256 signing",
    );
  }
  return bytes;
}
```
Add a startup-time assertion (call this function from `auth.ts` during
module load) so misconfigured deploys crash-on-boot instead of
silently minting weak JWTs.

### WR-04: GitHub Actions workflow lacks explicit `permissions:` scoping

**File:** `.github/workflows/fly-deploy.yml:50-78`
**Issue:** No `permissions:` block is declared, so the `GITHUB_TOKEN`
inherits repo-default permissions — on many repos that is
read/write to contents, issues, actions, packages, etc. The workflow
only needs to check out the code (contents: read) and call flyctl with
an externally-scoped `FLY_API_TOKEN`.

**Fix:** Drop to minimum privilege at the top of the workflow:
```yaml
permissions:
  contents: read
```
This runs BEFORE the jobs and applies to both deploy-web and
deploy-relay. If future steps need more (e.g. pushing a release tag),
add those scopes explicitly on the individual job.

### WR-05: `callbackUrl` pass-through enables open-redirect if Auth.js loosens defaults

**File:** `apps/web/app/sign-in/page.tsx:26-34`
**Issue:** `callbackUrl` is read directly from the query string and
passed to `signIn("github", { redirectTo: callbackUrl })` with no
server-side validation. Auth.js v5 blocks external origins by default
in `redirectTo`, but (a) this is relying on undocumented default
behavior, (b) the `redirect` callback is NOT defined in `authConfig.ts`
so there is no explicit allowlist, and (c) any future upgrade that
changes default behavior would silently open up a classic open-redirect
bug.

**Fix:** Validate explicitly at the server action boundary:
```ts
function isSafeCallback(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
async function handleSignIn() {
  "use server";
  await signIn("github", { redirectTo: isSafeCallback(callbackUrl) });
}
```
Also add a `callbacks.redirect` in `auth.config.ts` as belt-and-braces:
```ts
callbacks: {
  authorized(...) { ... },
  redirect({ url, baseUrl }) {
    return url.startsWith(baseUrl) ? url : baseUrl;
  },
}
```

### WR-06: Pairing state transition happens on an HTTP GET (server component)

**File:** `apps/web/app/pair/[pairingId]/page.tsx:76-83`
**Issue:** The `PairingPage` server component calls
`redeemPairing({ pairingId, ... })` every time the URL is rendered,
which is a stateful `pending -> redeemed` transition that also mints
the verification phrase and writes an audit row. GET requests are
supposed to be safe/idempotent. Link prefetchers (Slack unfurl, Safari
Preview, Chrome hover-prefetch on an authenticated dashboard, browser
extension link-scanners) can all trigger this unexpectedly and burn
the pairing phrase before the legitimate user has seen the page.

**Fix:** Two options — pick one:
1. Keep the page as a GET but have the `redeem` transition move to a
   small client component that POSTs to `/api/pairings/[id]/redeem`
   on mount. This matches the POST-only handler that already exists
   in `apps/web/app/api/pairings/[pairingId]/redeem/route.ts`.
2. Keep the server-component redeem but gate it on a header/form
   submission so prefetchers cannot trigger it. For example, render
   the phrase only after a `form action=POST` interaction on the
   first load.
Option 1 is simpler and aligns with the existing POST endpoint. The
current Playwright test
(`tests/auth-pairing.spec.ts:47-66`) does not exercise the page, only
the service, so it will not catch this.

### WR-07: Production image ships devDependencies (vitest, drizzle-kit, typescript, next dev toolchain)

**File:** `apps/relay/Dockerfile:41` and `apps/web/Dockerfile:44`
**Issue:** Both images install workspace deps with
`npm ci --workspaces --include-workspace-root`, which installs the
root-level `devDependencies` (vitest, drizzle-kit, typescript, etc.)
into the `deps` stage and copies the resulting `node_modules` into the
`runtime` stage. Production containers ship a full dev toolchain,
inflating the attack surface (every vitest transitive dep is now in
the image) and the image size.

**Fix:** Split into a dev-deps stage for the build and a prod-deps
stage for the runtime:
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/*/package.json packages/*/package.json
RUN npm ci --workspaces --include-workspace-root

FROM node:22-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/*/package.json packages/*/package.json
RUN npm ci --workspaces --include-workspace-root --omit=dev

FROM node:22-alpine AS build
# ... uses deps ...

FROM node:22-alpine AS runtime
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=build /repo/apps/web/.next /repo/apps/web/.next
# ...
```
Same pattern in `apps/relay/Dockerfile`.

### WR-08: Default `InMemoryPairingStore` breaks multi-machine Fly deploys

**File:** `apps/web/lib/pairing-service.ts:115-147` and `178-179`
**Issue:** `defaultPairingStore` is a process-local Map. `apps/web/fly.toml`
sets `auto_start_machines = true` and `min_machines_running = 0`, so
Fly is free to spin up a second machine under load. A pairing created
on machine A cannot be found by machine B — `loadOrExpire` will throw
"pairing_session ... not found" and the operator will see inconsistent
"pairing disappeared" errors in production. The header comment
correctly says "Plan 01-03 replaces this with a Drizzle-backed
adapter", but the default is still an in-memory store and nothing at
boot time prevents that default from being used in production.

**Fix:** Gate the in-memory store behind an explicit test/dev flag so a
production boot crashes instead of silently mis-routing:
```ts
const defaultPairingStore: PairingStore =
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("InMemoryPairingStore disabled in production — set store in resolveCtx"); })()
    : new InMemoryPairingStore();
```
Longer-term, land the Drizzle-backed adapter from Plan 01-03 before
Phase 1 is considered shippable. Alternatively, pin `min_machines_running = 1`
AND `auto_start_machines = false` in `fly.toml` until the DB store
lands. Document this as a Phase 1 deploy prerequisite.

### WR-09: `waitForRedeem` silently swallows all polling errors

**File:** `apps/bridge/src/lib/pairing-client.ts:187-201`
**Issue:** The polling loop does:
```ts
const status = await this.getPairingStatus(pairingId).catch(() => null);
if (status && status.status !== "pending") {
  // ...
}
```
Every HTTP error (4xx, 5xx, network failure, CORS, DNS) is converted
to `null` and the loop keeps polling until the overall timeout. A
misconfigured base URL, expired OAuth, or 500 on the status route
all present the same way to the operator: "timed out waiting for
pairing to be redeemed". Debugging is painful, and real auth-related
errors (e.g. the CR-01 middleware redirect) are indistinguishable from
normal polling latency.

**Fix:** Narrow the catch to benign transient errors and surface the
rest:
```ts
const status = await this.getPairingStatus(pairingId).catch((err) => {
  const status = (err as { response?: { status?: number } }).response?.status;
  if (status && status >= 500) return null;   // transient, retry
  throw err;                                   // auth/schema errors propagate
});
```
Or: log every polling error to `options.out` with a small exponential
backoff so the operator at least sees something.

### WR-10: `trustProxy: true` on relay Fastify is footgun if ever exposed directly

**File:** `apps/relay/src/server.ts:38-42`
**Issue:** `trustProxy: true` tells Fastify to believe any
`X-Forwarded-For` / `X-Forwarded-Proto` header on incoming requests,
regardless of source IP. Inside Fly this is fine because Fly's edge
proxy is the only upstream. If the relay's listen port is ever
exposed directly (debug, accidental `fly.toml` edit, port-forward
during an incident), IP-based rate limiting / audit logging / bridge
ownership decisions that rely on `request.ip` will trust spoofed
values.

**Fix:** Scope trust to the known proxy CIDR so only Fly's edge is
honored:
```ts
const app = Fastify({
  logger: options.logger ?? false,
  // Fly edge proxies originate from the private Fly network. Accept
  // X-Forwarded-* only from loopback + the RFC1918 range Fly uses.
  trustProxy: ["127.0.0.1", "::1", "fd00::/8"],
  disableRequestLogging: true,
});
```
Revisit in Plan 02-01 when the WebSocket upgrade lands.

### WR-11: `POST /api/pairings` has no abuse controls (rate limit / audit throttling)

**File:** `apps/web/app/api/pairings/route.ts:43-87`
**Issue:** This endpoint is intentionally unauthenticated (documented
in the header) AND will be genuinely public once CR-01 is fixed.
There is no per-IP rate limit, no CAPTCHA, no quota. Any attacker on
the internet can spam the endpoint to exhaust the `pairing_sessions`
table and flood `audit_events` with `pairing.created` rows. Even the
in-memory store will OOM eventually.

**Fix:** Phase 1 minimum: add a simple in-memory token bucket keyed by
`x-forwarded-for` (already honored via Next.js) with a conservative
limit like 10 creates per IP per minute. Long-term: move rate limiting
to the Fly edge or into a Redis-backed counter.

## Info

### IN-01: `constantTimeEqual` could reuse `crypto.timingSafeEqual`

**File:** `apps/web/lib/pairing-service.ts:584-591`
**Issue:** The hand-rolled constant-time comparison uses `charCodeAt` and
early-returns on length mismatch (leaks length). For the fixed-format
three-word phrase this is fine, but Node's built-in
`crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` is simpler and
better reviewed.

**Fix:**
```ts
import { timingSafeEqual } from "node:crypto";
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

### IN-02: `rawPairingToken` is generated but never used

**File:** `apps/web/lib/pairing-service.ts:229-232`
**Issue:** `createPairing` generates a 32-byte random token, hashes it
into `pairingTokenHash`, and stores the hash — but the raw token is
never returned to the bridge CLI, never carried in the `pairingUrl`,
and never verified on `redeem` or `confirm`. The hash column in the
DB is effectively a random string. The fly-deploy workflow ships a
`PAIRING_TOKEN_SECRET` that is similarly unused.

**Fix:** Either (a) return the raw token to the bridge and require it
as a bearer on `/redeem` and `/confirm` so possession is actually
proven, or (b) delete the unused token generation and the
`PAIRING_TOKEN_SECRET` environment wiring until the feature actually
lands. Pick (a) if the plan ever intended single-use tokens beyond
the UUID; pick (b) for now to avoid dead code and misleading secret
scaffolding.

### IN-03: `uptimeSeconds` in healthz responses is mild info disclosure

**File:** `apps/web/app/api/healthz/route.ts:44-51` and
`apps/relay/src/routes/health.ts:37-43`
**Issue:** Liveness payloads include `uptimeSeconds`. This tells any
scanner when the service last restarted, which can be useful for
timing post-patch exploitation. Not a practical risk on Fly (machines
restart often) but also not information the probe needs.

**Fix:** Drop `uptimeSeconds` from both payloads and keep only
`status`, `service`, `timestamp`.

### IN-04: `deviceLabel` from request body overrides server-side label

**File:** `apps/web/lib/pairing-service.ts:415-420`
**Issue:** `confirmPairing` takes `input.deviceLabel ?? row.deviceLabel`,
letting the bridge override the label originally set at create time.
Since the bridge is the trust principal this is acceptable, but it
means the audit row's final `deviceLabel` may not match the one
recorded at `pairing.created`. Investigators correlating audit rows
will need to know this.

**Fix:** Either pin `row.deviceLabel` as authoritative, or include
BOTH the original and the confirmed label in the
`pairing.confirmed` audit metadata so the correlation is explicit.

### IN-05: Cookie secret treated as string, not raw bytes

**File:** `apps/web/lib/device-session.ts:96-104`
**Issue:** `new TextEncoder().encode(raw)` treats the env var as a
UTF-8 string. Operators who supply a 32-byte secret as a 64-char hex
string get 64 bytes of effective key material (still fine) but
operators who supply a 32-byte secret as a `base64url` or raw-binary
string will get incorrect behavior or weaker keys than expected. This
interacts with WR-03.

**Fix:** Document the expected encoding in `.env.example` (preferably
base64url-encoded 32+ byte random) and decode accordingly, rejecting
any value that does not round-trip.

### IN-06: Dockerfile runtime keeps TypeScript sources AND uses `--experimental-strip-types`

**File:** `apps/relay/Dockerfile:99-104`
**Issue:** Production relay runs `node --experimental-strip-types apps/relay/src/index.ts`.
The header comment documents this as a Phase 1 fallback but it means
production depends on an experimental Node flag. If Node 22 changes
the flag semantics (happens often with experimental flags), the
container breaks.

**Fix:** Land the compiled JS build (`tsc -p apps/relay/tsconfig.json`)
and flip the CMD to `node apps/relay/dist/index.js` before Phase 1
ships. The Dockerfile already has a `build` stage; just ensure it
actually produces output (see CR-03) and switch the CMD.

### IN-07: `stdinApprovalPrompt` listener race on Ctrl-C

**File:** `apps/bridge/src/cli/pair.ts:180-198`
**Issue:** The stdin listener resumes stdin, attaches a `data`
listener, and waits. If the operator hits Ctrl-C the Promise never
resolves and the CLI's SIGINT handler never fires (because the
returned Promise is still awaited). Not a correctness bug but a minor
UX papercut.

**Fix:** Install a one-shot SIGINT handler inside the `confirm()`
implementation that rejects the Promise and detaches the data
listener.

### IN-08: `signIn/page.tsx` does not display the reason for `error` query param

**File:** `apps/web/app/sign-in/page.tsx:80-91`
**Issue:** The page only checks `if (error)` and shows a generic
"Sign-in failed" message. The OAuth error code (`AccessDenied`,
`OAuthAccountNotLinked`, etc.) is discarded, which makes debugging a
misconfigured GitHub app harder.

**Fix:** Switch on a small allowlist of known error codes and show a
meaningful message for each, while logging the unknown ones
server-side.

### IN-09: Phase 1 test suite skips the live redirect assertion by default

**File:** `apps/web/tests/auth-pairing.spec.ts:36-45`
**Issue:** The main redirect test is gated on
`CODEX_MOBILE_E2E_LIVE=1`, so by default CI does not exercise the
middleware -> `/sign-in` path. This is also exactly the path CR-01
is broken on. Combined with the absence of a test for the bridge
calling `/api/pairings` without a cookie, the regression was not
caught.

**Fix:** Add a unit test (not gated on the live env var) that uses
Next.js's `NextRequest` + the `middleware` export directly to assert:
(a) unauthenticated `GET /pair/x` redirects to `/sign-in?callbackUrl=...`,
(b) unauthenticated `POST /api/pairings` returns `NextResponse.next()`
(i.e. is allowed through). This catches CR-01 without a dev server.

---

_Reviewed: 2026-04-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
