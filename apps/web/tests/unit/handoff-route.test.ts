import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handoffRouteMocks = vi.hoisted(() => ({
  createOrReuseThreadHandoff: vi.fn(),
  requireBridgeInstallationPrincipal: vi.fn(),
}));

vi.mock("@codex-mobile/db", () => ({
  createOrReuseThreadHandoff: handoffRouteMocks.createOrReuseThreadHandoff,
}));

vi.mock("../../lib/live-session/server", () => ({
  requireBridgeInstallationPrincipal:
    handoffRouteMocks.requireBridgeInstallationPrincipal,
}));

import { POST } from "../../app/api/handoffs/route";

describe("POST /api/handoffs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T22:10:00.000Z"));

    handoffRouteMocks.requireBridgeInstallationPrincipal.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-123",
      bridgeInstanceId: "bridge-instance-123",
      revokedAt: null,
    });
    handoffRouteMocks.createOrReuseThreadHandoff.mockImplementation(
      async (input) => ({
        handoff: {
          id: "handoff-row-1",
          publicId: input.publicId,
          userId: input.userId,
          bridgeInstallationId: input.bridgeInstallationId,
          bridgeInstanceId: input.bridgeInstanceId,
          threadId: input.threadId,
          sessionId: input.sessionId,
          createdAt: input.createdAt,
          lastUsedAt: input.lastUsedAt,
          expiresAt: input.expiresAt,
          revokedAt: null,
        },
        reused: false,
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a fresh handoff descriptor for a valid bridge bootstrap token", async () => {
    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      threadId: "thread-123",
      sessionId: "session-123",
      launchUrl: expect.stringMatching(
        /^https:\/\/handoff\.example\.test\/launch\/.+$/,
      ),
      qrText: expect.stringMatching(
        /^https:\/\/handoff\.example\.test\/launch\/.+$/,
      ),
      expiresAt: "2026-04-19T22:25:00.000Z",
      reused: false,
    });
    expect(handoffRouteMocks.createOrReuseThreadHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        threadId: "thread-123",
        sessionId: "session-123",
        expiresAt: new Date("2026-04-19T22:25:00.000Z"),
      }),
    );
    expect(handoffRouteMocks.requireBridgeInstallationPrincipal).toHaveBeenCalledWith(
      {
        bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        touchLastUsed: true,
      },
    );
  });

  it("returns reused true when the same thread already has a valid handoff", async () => {
    handoffRouteMocks.createOrReuseThreadHandoff.mockResolvedValueOnce({
      handoff: {
        id: "handoff-row-2",
        publicId: "existing-public-id",
        userId: "user-123",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        threadId: "thread-123",
        sessionId: "session-123",
        createdAt: new Date("2026-04-19T22:05:00.000Z"),
        lastUsedAt: new Date("2026-04-19T22:10:00.000Z"),
        expiresAt: new Date("2026-04-19T22:25:00.000Z"),
        revokedAt: null,
      },
      reused: true,
    });

    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      threadId: "thread-123",
      sessionId: "session-123",
      launchUrl: "https://handoff.example.test/launch/existing-public-id",
      qrText: "https://handoff.example.test/launch/existing-public-id",
      reused: true,
    });
  });

  it("returns a replacement handoff when the previous row is expired", async () => {
    handoffRouteMocks.createOrReuseThreadHandoff.mockResolvedValueOnce({
      handoff: {
        id: "handoff-row-3",
        publicId: "replacement-public-id",
        userId: "user-123",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        threadId: "thread-123",
        sessionId: "session-123",
        createdAt: new Date("2026-04-19T22:10:00.000Z"),
        lastUsedAt: new Date("2026-04-19T22:10:00.000Z"),
        expiresAt: new Date("2026-04-19T22:25:00.000Z"),
        revokedAt: null,
      },
      reused: false,
    });

    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      launchUrl: "https://handoff.example.test/launch/replacement-public-id",
      qrText: "https://handoff.example.test/launch/replacement-public-id",
      reused: false,
    });
  });

  it("fails closed when the bridge bootstrap auth is missing", async () => {
    const missingTokenResponse = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(missingTokenResponse.status).toBe(401);
    expect(await missingTokenResponse.json()).toEqual({
      error: "missing_bridge_bootstrap_token",
    });
  });

  it("fails closed with handoff_not_authorized when the bridge installation is revoked", async () => {
    handoffRouteMocks.requireBridgeInstallationPrincipal.mockRejectedValueOnce(
      new Error("bridge_installation_revoked"),
    );

    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "handoff_not_authorized",
    });
  });

  it("fails closed with handoff_not_authorized on user mismatch", async () => {
    handoffRouteMocks.createOrReuseThreadHandoff.mockResolvedValueOnce({
      handoff: {
        id: "handoff-row-4",
        publicId: "mismatch-public-id",
        userId: "user-999",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        threadId: "thread-123",
        sessionId: "session-123",
        createdAt: new Date("2026-04-19T22:10:00.000Z"),
        lastUsedAt: new Date("2026-04-19T22:10:00.000Z"),
        expiresAt: new Date("2026-04-19T22:25:00.000Z"),
        revokedAt: null,
      },
      reused: true,
    });

    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "handoff_not_authorized",
    });
  });

  it("fails closed with handoff_revoked when a revoked handoff row is returned", async () => {
    handoffRouteMocks.createOrReuseThreadHandoff.mockResolvedValueOnce({
      handoff: {
        id: "handoff-row-5",
        publicId: "revoked-public-id",
        userId: "user-123",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        threadId: "thread-123",
        sessionId: "session-123",
        createdAt: new Date("2026-04-19T22:10:00.000Z"),
        lastUsedAt: new Date("2026-04-19T22:10:00.000Z"),
        expiresAt: new Date("2026-04-19T22:25:00.000Z"),
        revokedAt: new Date("2026-04-19T22:11:00.000Z"),
      },
      reused: true,
    });

    const response = await POST(
      new Request("https://handoff.example.test/api/handoffs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization:
            "Bearer bootstrap-token-123456789012345678901234567890",
        },
        body: JSON.stringify({
          bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
          bridgeInstanceId: "bridge-instance-123",
          threadId: "thread-123",
          sessionId: "session-123",
        }),
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "handoff_revoked",
    });
  });
});
