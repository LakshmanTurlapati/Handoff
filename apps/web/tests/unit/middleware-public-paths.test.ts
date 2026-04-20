/**
 * Regression tests for the hosted handoff middleware pass-through.
 *
 * The active Fly handoff path now authenticates inside route handlers and
 * server components using short-lived launch URLs plus durable device
 * sessions. The edge middleware must therefore never bounce `/launch`,
 * `/session`, or browser API calls into `/sign-in`.
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

async function invokeMiddleware(req: NextRequest): Promise<Response | undefined> {
  const handler = middleware as unknown as MiddlewareHandler;
  try {
    const result = await handler(req, {});
    return (result as Response | undefined) ?? undefined;
  } catch (error) {
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

describe("middleware · hosted handoff pass-through", () => {
  it("GET /launch/public-123 is allowed through", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/launch/public-123"),
      { method: "GET" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("GET /session/session-123 is allowed through", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/session/session-123"),
      { method: "GET" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("POST /api/sessions/session-123/connect is allowed through", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/sessions/session-123/connect"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });

  it("POST /api/devices/device-session-123/revoke is allowed through", async () => {
    const req = new NextRequest(
      new URL("http://localhost:3000/api/devices/device-session-123/revoke"),
      { method: "POST" },
    );
    const res = await invokeMiddleware(req);
    expect(isSignInRedirect(res)).toBe(false);
  });
});
