/**
 * Regression tests for the middleware allowlist (CR-01 + CR-GAP-01 fixes,
 * Plans 01-04 and 01-07).
 *
 * These tests pin the allowlist invariants from 01-REVIEW.md,
 * 01-VERIFICATION.md, and 01-REVIEW-GAP.md:
 *
 *   - POST /api/pairings                     MUST be let through (bridge create)
 *   - GET  /api/pairings/[id]                MUST be let through (bridge status poll)
 *   - POST /api/pairings/[id]/confirm        MUST be let through (bridge
 *                                            confirm; bearer-gated at the
 *                                            route-handler level, NOT by
 *                                            middleware). CR-GAP-01 inverts
 *                                            the previous "redirect to
 *                                            /sign-in" behavior.
 *   - POST /api/pairings/[id]/redeem         MUST be redirected to /sign-in
 *                                            (stays browser-cookie-gated
 *                                            per the Option A lock)
 *   - POST /api/pairings/[id]/confirm/extra  MUST be redirected to /sign-in
 *                                            (confirm regex is strict
 *                                            single-segment and must NOT
 *                                            wildcard-leak subpaths)
 *
 * The tests do NOT spin up a Next.js dev server and do NOT mock Auth.js
 * internals. They invoke the middleware handler directly with a
 * hand-constructed NextRequest and assert the returned NextResponse is
 * either a pass-through (200 or no location header pointing at /sign-in)
 * or a 307 redirect to /sign-in.
 *
 * If Auth.js internals throw when called without a session cookie (which
 * should NOT happen because the allowlist short-circuits before any
 * session lookup), the test wraps the call in try/catch so the allowed
 * paths still fail the "redirect to /sign-in" check and the blocked
 * paths surface the failure.
 *
 * Run via `npm run test:phase-01:quick` — Vitest workspace project
 * `phase-01-unit` picks up this file via the `apps/web/tests/unit/**`
 * include glob in vitest.workspace.ts.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import middleware from "../../middleware";

// The Auth.js-wrapped middleware is typed loosely in next-auth's public
// API; we cast the call to `any` so the test file does not depend on
// internal next-auth handler types.
type MiddlewareHandler = (
  req: unknown,
  ctx: unknown,
) => Promise<Response | undefined | void>;

async function invokeMiddleware(
  req: NextRequest,
): Promise<Response | undefined> {
  const handler = middleware as unknown as MiddlewareHandler;
  try {
    const result = await handler(req, {});
    return (result as Response | undefined) ?? undefined;
  } catch (error) {
    // If Auth.js internals throw for a request that the allowlist was
    // supposed to short-circuit, surface the error so the test fails
    // loudly instead of silently passing.
    throw new Error(
      `middleware threw for ${req.method} ${req.nextUrl.pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isSignInRedirect(res: Response | undefined): boolean {
  if (!res) return false;
  if (res.status === 307 || res.status === 302 || res.status === 303) {
    const location = res.headers.get("location");
    if (location && location.includes("/sign-in")) {
      return true;
    }
  }
  return false;
}

describe("middleware · CR-01 bridge-facing allowlist", () => {
  it("POST /api/pairings is allowed through (no sign-in redirect)", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("GET /api/pairings/abc-123 is allowed through (no sign-in redirect)", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123"),
      { method: "GET" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("POST /api/pairings/abc-123/redeem is BLOCKED (sign-in redirect)", async () => {
    // Negative case: the single-segment regex in middleware.ts MUST NOT
    // wildcard-leak to /redeem. This is the "do not accidentally expose
    // the authenticated subpath" invariant from CR-01.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/redeem"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(true);
  });

  it("POST /api/pairings/abc-123/confirm is now bearer-gated (allowed through by middleware; auth is at the route handler level)", async () => {
    // CR-GAP-01: the confirm route no longer calls auth(). The bearer
    // check happens inside the route handler, so middleware must let
    // the request pass. A blocked middleware here would make the
    // bridge CLI unable to complete pairing from a terminal.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/confirm"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("GET /api/pairings/abc-123/redeem is BLOCKED (sign-in redirect)", async () => {
    // Belt-and-braces: prove the regex is single-segment by also checking
    // a GET on a subpath.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/redeem"),
      { method: "GET" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(true);
  });

  it("POST /api/pairings/abc-123/confirm/extra is BLOCKED (confirm regex is strict single-segment)", async () => {
    // CR-GAP-01 negative case: `pairingConfirmPostRegex` must not
    // wildcard-leak to a longer subpath. Anything under `/confirm/...`
    // must still hit the redirect.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/confirm/extra"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(true);
  });

  it("POST /api/pairings/abc-123/redeem is still BLOCKED after the confirm allowlist lands", async () => {
    // Belt-and-braces: even though confirm is now allowed, redeem
    // must stay browser-cookie-gated because it is called by the
    // phone browser's server component, not the bridge.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/redeem"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(true);
  });
});
