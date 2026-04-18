import { beforeEach, describe, expect, it, vi } from "vitest";

const revokeRouteMocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  requireRemotePrincipal: vi.fn(),
  relayInternalFetch: vi.fn(),
  revokeDeviceSession: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("../../lib/live-session/server", () => ({
  assertSameOrigin: revokeRouteMocks.assertSameOrigin,
  requireRemotePrincipal: revokeRouteMocks.requireRemotePrincipal,
  relayInternalFetch: revokeRouteMocks.relayInternalFetch,
}));

vi.mock("@codex-mobile/db", () => ({
  revokeDeviceSession: revokeRouteMocks.revokeDeviceSession,
  appendAuditEvent: revokeRouteMocks.appendAuditEvent,
}));

import { POST } from "../../app/api/devices/[deviceSessionId]/revoke/route";

describe("POST /api/devices/[deviceSessionId]/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    revokeRouteMocks.assertSameOrigin.mockImplementation(() => undefined);
    revokeRouteMocks.requireRemotePrincipal.mockResolvedValue({
      userId: "user-123",
      deviceSessionId: "current-device-123",
    });
    revokeRouteMocks.revokeDeviceSession.mockResolvedValue({
      id: "device-session-123",
      deviceLabel: "Pocket phone",
      devicePublicId: "public-123",
    });
    revokeRouteMocks.appendAuditEvent.mockResolvedValue(undefined);
    revokeRouteMocks.relayInternalFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: "revoked" }), { status: 200 }),
    );
  });

  it("returns 401 when the caller is not authenticated for a remote principal", async () => {
    revokeRouteMocks.requireRemotePrincipal.mockRejectedValueOnce(
      new Error("unauthenticated"),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/devices/device-session-123/revoke", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ deviceSessionId: "device-session-123" }),
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns status revoked, appends device.revoked, and calls the relay revoke endpoint", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/devices/device-session-123/revoke", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ deviceSessionId: "device-session-123" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
    expect(revokeRouteMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "device.revoked",
        subject: "device-session-123",
      }),
    );
    expect(revokeRouteMocks.relayInternalFetch).toHaveBeenCalledWith(
      "/internal/browser/devices/device-session-123/revoke",
      {
        userId: "user-123",
        deviceSessionId: "current-device-123",
      },
      { method: "POST" },
    );
  });
});
