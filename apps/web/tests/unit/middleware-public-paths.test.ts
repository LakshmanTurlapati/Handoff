/**
 * Regression tests for the middleware allowlist (CR-01 fix, Plan 01-04).
 *
 * These tests pin the CR-01 fix from 01-REVIEW.md / 01-VERIFICATION.md:
 *
 *   - POST /api/pairings               MUST be let through (bridge create)
 *   - GET  /api/pairings/[id]          MUST be let through (bridge status poll)
 *   - POST /api/pairings/[id]/redeem   MUST be redirected to /sign-in
 *                                      (the single-segment regex must NOT
 *                                      wildcard-leak subpaths)
 *   - POST /api/pairings/[id]/confirm  MUST be redirected to /sign-in
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

  it("POST /api/pairings/abc-123/confirm is BLOCKED (sign-in redirect)", async () => {
    // Negative case: /confirm is the ONLY cookie-minting route and must
    // remain auth-gated even though it shares the /api/pairings prefix.
    const req = new NextRequest(
      new URL("http://localhost:3000/api/pairings/abc-123/confirm"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(true);
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
});
