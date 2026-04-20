import { beforeEach, describe, expect, it, vi } from "vitest";

const remotePrincipalMocks = vi.hoisted(() => ({
  readDeviceSession: vi.fn(),
  readRawDeviceSessionToken: vi.fn(),
  hashCookieToken: vi.fn(),
  findDeviceSessionForPrincipal: vi.fn(),
  findBridgeInstallationForDeviceSession: vi.fn(),
  touchDeviceSessionLastSeen: vi.fn(),
}));

vi.mock("../../lib/device-session", () => ({
  readDeviceSession: remotePrincipalMocks.readDeviceSession,
  readRawDeviceSessionToken: remotePrincipalMocks.readRawDeviceSessionToken,
  hashCookieToken: remotePrincipalMocks.hashCookieToken,
}));

vi.mock("@codex-mobile/db", () => ({
  findDeviceSessionForPrincipal: remotePrincipalMocks.findDeviceSessionForPrincipal,
  findBridgeInstallationForDeviceSession:
    remotePrincipalMocks.findBridgeInstallationForDeviceSession,
  touchDeviceSessionLastSeen: remotePrincipalMocks.touchDeviceSessionLastSeen,
}));

vi.mock("@codex-mobile/auth", () => ({
  mintWsTicket: vi.fn(),
}));

import { requireRemotePrincipal } from "../../lib/live-session/server";

describe("requireRemotePrincipal", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    remotePrincipalMocks.readRawDeviceSessionToken.mockResolvedValue("raw-device-token");
    remotePrincipalMocks.readDeviceSession.mockResolvedValue({
      deviceSessionId: "device-session-123",
      userId: "user-123",
    });
    remotePrincipalMocks.hashCookieToken.mockReturnValue("hash-123");
    remotePrincipalMocks.findDeviceSessionForPrincipal.mockResolvedValue({
      id: "device-session-123",
      userId: "user-123",
      cookieTokenHash: "hash-123",
      revokedAt: null,
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });
    remotePrincipalMocks.findBridgeInstallationForDeviceSession.mockResolvedValue({
      id: "bridge-installation-123",
      revokedAt: null,
    });
    remotePrincipalMocks.touchDeviceSessionLastSeen.mockResolvedValue({
      id: "device-session-123",
    });
  });

  it("rejects revoked device sessions with the exact device_session_revoked error", async () => {
    remotePrincipalMocks.findDeviceSessionForPrincipal.mockResolvedValueOnce({
      id: "device-session-123",
      userId: "user-123",
      cookieTokenHash: "hash-123",
      revokedAt: new Date("2026-04-18T12:00:00.000Z"),
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });

    await expect(requireRemotePrincipal()).rejects.toThrow(
      "device_session_revoked",
    );
  });

  it("rejects expired device sessions with the exact device_session_expired error", async () => {
    remotePrincipalMocks.findDeviceSessionForPrincipal.mockResolvedValueOnce({
      id: "device-session-123",
      userId: "user-123",
      cookieTokenHash: "hash-123",
      revokedAt: null,
      expiresAt: new Date("2026-04-17T12:00:00.000Z"),
    });

    await expect(requireRemotePrincipal()).rejects.toThrow(
      "device_session_expired",
    );
  });

  it("rejects mismatched owners with user_mismatch", async () => {
    remotePrincipalMocks.findDeviceSessionForPrincipal.mockResolvedValueOnce({
      id: "device-session-123",
      userId: "user-999",
      cookieTokenHash: "hash-123",
      revokedAt: null,
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });

    await expect(requireRemotePrincipal()).rejects.toThrow("user_mismatch");
  });

  it("touches lastSeenAt when the durable device session resolves successfully", async () => {
    const principal = await requireRemotePrincipal();

    expect(principal).toEqual({
      userId: "user-123",
      deviceSessionId: "device-session-123",
      bridgeInstallationId: "bridge-installation-123",
    });
    expect(remotePrincipalMocks.findDeviceSessionForPrincipal).toHaveBeenCalledWith({
      deviceSessionId: "device-session-123",
      cookieTokenHash: "hash-123",
    });
    expect(
      remotePrincipalMocks.findBridgeInstallationForDeviceSession,
    ).toHaveBeenCalledWith({
      deviceSessionId: "device-session-123",
    });
    expect(remotePrincipalMocks.touchDeviceSessionLastSeen).toHaveBeenCalledWith(
      "device-session-123",
    );
  });
});
