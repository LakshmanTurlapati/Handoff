/**
 * Next.js middleware — pass-through for the hosted handoff runtime.
 *
 * The active handoff flow now authenticates at the route/page layer using
 * durable device sessions and short-lived handoff URLs. Keeping the edge
 * middleware as a no-op avoids accidental redirects to GitHub OAuth for
 * `/launch/[publicId]`, `/session/[sessionId]`, and the browser session APIs.
 *
 * The legacy bootstrap pairing path still performs its own auth checks
 * inside the route handlers and server components that need them.
 */
import { NextResponse } from "next/server";
export default function middleware(): Response {
  return NextResponse.next();
}

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
