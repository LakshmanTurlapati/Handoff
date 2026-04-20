import { beforeEach, describe, expect, it, vi } from "vitest";

const launchRouteMocks = vi.hoisted(() => ({
  claimHandoffLaunch: vi.fn(),
}));

vi.mock("../../lib/handoff-launch", () => ({
  claimHandoffLaunch: launchRouteMocks.claimHandoffLaunch,
}));

import { GET } from "../../app/launch/[publicId]/route";

describe("GET /launch/[publicId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a valid launch directly into the target session", async () => {
    launchRouteMocks.claimHandoffLaunch.mockResolvedValue({
      sessionId: "session-123",
      reusedDeviceSession: false,
    });

    const response = await GET(
      new Request("https://handoff.example.test/launch/public-123"),
      {
        params: Promise.resolve({ publicId: "public-123" }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://handoff.example.test/session/session-123",
    );
  });

  it("redirects invalid launches to the hosted error page", async () => {
    launchRouteMocks.claimHandoffLaunch.mockRejectedValue(
      new Error("handoff_expired"),
    );

    const response = await GET(
      new Request("https://handoff.example.test/launch/public-123"),
      {
        params: Promise.resolve({ publicId: "public-123" }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://handoff.example.test/launch/error?code=handoff_expired",
    );
  });

  it("prefers the forwarded public origin over the internal request url", async () => {
    launchRouteMocks.claimHandoffLaunch.mockRejectedValue(
      new Error("handoff_not_found"),
    );

    const response = await GET(
      new Request("http://localhost:3000/launch/public-123", {
        headers: {
          "x-forwarded-host": "handoff-web.fly.dev",
          "x-forwarded-proto": "https",
        },
      }),
      {
        params: Promise.resolve({ publicId: "public-123" }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://handoff-web.fly.dev/launch/error?code=handoff_not_found",
    );
  });
});
