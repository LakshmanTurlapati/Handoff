import { beforeEach, describe, expect, it, vi } from "vitest";

const connectTicketRouteMocks = vi.hoisted(() => ({
  findBridgeInstallationByTokenHash: vi.fn(),
  touchBridgeInstallationLastUsed: vi.fn(),
  mintWsTicket: vi.fn(),
  loadWsTicketSecret: vi.fn(),
  resolveRelayPublicWebSocketUrl: vi.fn(),
}));

vi.mock("@codex-mobile/db", () => ({
  findBridgeInstallationByTokenHash:
    connectTicketRouteMocks.findBridgeInstallationByTokenHash,
  touchBridgeInstallationLastUsed:
    connectTicketRouteMocks.touchBridgeInstallationLastUsed,
}));

vi.mock("@codex-mobile/auth/ws-ticket", () => ({
  mintWsTicket: connectTicketRouteMocks.mintWsTicket,
}));

vi.mock("../../lib/live-session/server", () => ({
  loadWsTicketSecret: connectTicketRouteMocks.loadWsTicketSecret,
  resolveRelayPublicWebSocketUrl:
    connectTicketRouteMocks.resolveRelayPublicWebSocketUrl,
}));

import { POST } from "../../app/api/bridge/connect-ticket/route";

describe("POST /api/bridge/connect-ticket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectTicketRouteMocks.findBridgeInstallationByTokenHash.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-123",
      revokedAt: null,
    });
    connectTicketRouteMocks.touchBridgeInstallationLastUsed.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    connectTicketRouteMocks.loadWsTicketSecret.mockReturnValue(
      new Uint8Array([1, 2, 3]),
    );
    connectTicketRouteMocks.resolveRelayPublicWebSocketUrl.mockReturnValue(
      "wss://relay.example.test/ws/browser",
    );
    connectTicketRouteMocks.mintWsTicket.mockResolvedValue({
      ticket: "ticket-123",
      expiresAt: new Date("2026-04-19T12:00:00.000Z"),
    });
  });

  it("returns missing_bridge_bootstrap_token when the bearer is absent", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/bridge/connect-ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "missing_bridge_bootstrap_token",
    });
  });

  it("returns bridge_installation_invalid when the token or installation is not valid", async () => {
    connectTicketRouteMocks.findBridgeInstallationByTokenHash.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      userId: "user-123",
      revokedAt: null,
    });

    const response = await POST(
      new Request("http://localhost:3000/api/bridge/connect-ticket", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "bridge_installation_invalid",
    });
  });

  it("returns relayUrl, ticket, expiresAt, and bridgeInstallationId on success", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/bridge/connect-ticket", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      relayUrl: "wss://relay.example.test/ws/browser",
      ticket: "ticket-123",
      expiresAt: "2026-04-19T12:00:00.000Z",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(connectTicketRouteMocks.touchBridgeInstallationLastUsed).toHaveBeenCalledWith({
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
