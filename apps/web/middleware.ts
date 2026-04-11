/**
 * Next.js middleware — authentication guard for Codex Mobile.
 *
 * Everything except the public sign-in page and the Auth.js callback API
 * requires an authenticated browser session. Unauthenticated requests are
 * redirected to `/sign-in` with a `callbackUrl` so the user lands back on
 * the originally requested page (typically the pairing screen) after
 * GitHub OAuth completes.
 *
 * CR-01 + CR-GAP-01 (01-REVIEW.md / 01-VERIFICATION.md / 01-REVIEW-GAP.md):
 *   The bridge CLI has no browser cookie when it calls the hosted pairing
 *   API, so the middleware must explicitly let the bridge-facing entry
 *   points through without redirecting them to `/sign-in`:
 *     - POST /api/pairings                         (create)
 *     - GET  /api/pairings/[pairingId]             (status poll)
 *     - POST /api/pairings/[pairingId]/confirm     (confirm; bearer-gated
 *                                                   at the route handler
 *                                                   level via the
 *                                                   Authorization header)
 *   These are matched by METHOD + PATHNAME EQUALITY (POST) or a single
 *   segment regex (GET / confirm), NOT by prefix, so the authenticated
 *   `/api/pairings/[id]/redeem` subpath remains gated by
 *   `Boolean(auth?.user)` below.
 *
 * This middleware runs in the edge runtime, so it may ONLY import from
 * `./auth.config` and not from `./auth.ts`. The `authConfig` exported from
 * `auth.config.ts` is intentionally edge-safe.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import {
  authConfig,
  PUBLIC_PATHS,
  UNAUTHENTICATED_API_POST_PATHS,
  pairingConfirmPostRegex,
} from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const method = request.method;

  // CR-01: allow the bridge-facing create endpoint through the middleware
  // BEFORE any auth cookie check. This is exact pathname equality on POST,
  // so `/api/pairings/[id]/redeem` is NOT matched and stays
  // auth-gated at the route-handler level. `/api/pairings/[id]/confirm`
  // is allowlisted by `pairingConfirmPostRegex` below.
  if (method === "POST" && UNAUTHENTICATED_API_POST_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // CR-GAP-01: allow the bridge-facing confirm endpoint through the
  // middleware BEFORE any cookie check. The single-segment regex
  // matches only `/api/pairings/[id]/confirm` — `/redeem` and
  // `/confirm/extra` both fall through to the redirect below. The
  // confirm route handler enforces authorization via the one-time
  // `Authorization: Bearer <pairingToken>` header, not a cookie, so
  // the middleware layer must not reject a cookieless bridge POST.
  if (method === "POST" && pairingConfirmPostRegex.test(pathname)) {
    return NextResponse.next();
  }

  // CR-01: allow the bridge-facing status-poll endpoint through the
  // middleware BEFORE any auth cookie check. The regex has exactly ONE
  // path segment after `/api/pairings/`, so `/api/pairings/abc-123`
  // matches but `/api/pairings/abc-123/redeem` and
  // `/api/pairings/abc-123/confirm` do NOT — those continue to the
  // redirect logic below, which keeps them auth-gated.
  const isPairingStatusGet =
    method === "GET" && /^\/api\/pairings\/[^\/]+$/.test(pathname);
  if (isPairingStatusGet) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix));
  if (isPublic) {
    return NextResponse.next();
  }

  if (request.auth?.user) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/sign-in", request.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
});

/**
 * Matcher — skip Next.js internals and static assets. Everything else is
 * evaluated by the auth callback above, which enforces the public-path
 * allowlist.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png|manifest.webmanifest).*)",
  ],
};
