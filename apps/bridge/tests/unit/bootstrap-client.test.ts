import { describe, expect, it, vi } from "vitest";
import { PairingClient } from "../../src/lib/pairing-client.js";

describe("PairingClient bridge bootstrap", () => {
  it("creates a bridge connect ticket with the stored bootstrap token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        relayUrl: "wss://relay.example.test/ws/browser",
        ticket: "ticket-123",
        expiresAt: "2026-04-19T12:00:00.000Z",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      }),
    });

    const client = new PairingClient({
      baseUrl: "https://handoff.example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await client.createBridgeConnectTicket({
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
    });

    expect(response).toEqual({
      relayUrl: "wss://relay.example.test/ws/browser",
      ticket: "ticket-123",
      expiresAt: "2026-04-19T12:00:00.000Z",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://handoff.example.test/api/bridge/connect-ticket",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer bootstrap-token-123456789012345678901234567890",
        }),
      }),
    );
  });

  it("surfaces bridge connect-ticket auth failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const client = new PairingClient({
      baseUrl: "https://handoff.example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.createBridgeConnectTicket({
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
      }),
    ).rejects.toThrow(
      "POST /api/bridge/connect-ticket failed: 403 Forbidden",
    );
  });
});
