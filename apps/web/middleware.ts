/**
 * Next.js middleware — authentication guard for Codex Mobile.
 *
 * Everything except the public sign-in page and the Auth.js callback API
 * requires an authenticated browser session. Unauthenticated requests are
 * redirected to `/sign-in` with a `callbackUrl` so the user lands back on
 * the originally requested page (typically the pairing screen) after
 * GitHub OAuth completes.
 *
 * This middleware runs in the edge runtime, so it may ONLY import from
 * `./auth.config` and not from `./auth.ts`. The `authConfig` exported from
 * `auth.config.ts` is intentionally edge-safe.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig, PUBLIC_PATHS } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

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
