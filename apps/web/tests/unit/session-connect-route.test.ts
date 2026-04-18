import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionConnectResponseSchema } from "@codex-mobile/protocol/live-session";

const {
  mockAssertSameOrigin,
  mockMintRelayTicket,
  mockRequireRemotePrincipal,
  mockResolveRelayPublicWebSocketUrl,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockMintRelayTicket: vi.fn(),
  mockRequireRemotePrincipal: vi.fn(),
  mockResolveRelayPublicWebSocketUrl: vi.fn(),
}));

vi.mock("../../lib/live-session/server", () => ({
  assertSameOrigin: mockAssertSameOrigin,
  mintRelayTicket: mockMintRelayTicket,
  requireRemotePrincipal: mockRequireRemotePrincipal,
  resolveRelayPublicWebSocketUrl: mockResolveRelayPublicWebSocketUrl,
}));

import { POST } from "../../app/api/sessions/[sessionId]/connect/route";

describe("POST /api/sessions/[sessionId]/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAssertSameOrigin.mockImplementation(() => undefined);
    mockRequireRemotePrincipal.mockResolvedValue({
      userId: "user-123",
      deviceSessionId: "device-123",
    });
    mockMintRelayTicket.mockResolvedValue({
      ticket: "ticket-123",
      expiresAt: new Date("2026-04-18T07:45:00.000Z"),
    });
    mockResolveRelayPublicWebSocketUrl.mockReturnValue(
      "wss://relay.codex-mobile.test/ws/browser",
    );
  });

  it("returns 401 when the browser session is missing", async () => {
    mockRequireRemotePrincipal.mockRejectedValueOnce(new Error("unauthenticated"));

    const response = await POST(
      new Request("http://localhost:3000/api/sessions/session-123/connect", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ sessionId: "session-123" }),
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns a protocol-validated connect payload with relayUrl, ticket, expiresAt, and sessionId", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/sessions/session-123/connect", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ sessionId: "session-123" }),
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    const parsed = SessionConnectResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.relayUrl).toBe("wss://relay.codex-mobile.test/ws/browser");
      expect(parsed.data.ticket).toBe("ticket-123");
      expect(parsed.data.expiresAt).toBe("2026-04-18T07:45:00.000Z");
      expect(parsed.data.sessionId).toBe("session-123");
    }
  });

  it("keeps credentials out of the relayUrl query string", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/sessions/session-safe/connect", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ sessionId: "session-safe" }),
      },
    );

    const body = SessionConnectResponseSchema.parse(await response.json());
    const relayUrl = new URL(body.relayUrl);

    expect(relayUrl.search).toBe("");
    expect(body.relayUrl).not.toContain(body.ticket);
    expect(body.relayUrl).not.toContain("ticket=");
  });
});
