import { beforeEach, describe, expect, it, vi } from "vitest";

const claimRouteMocks = vi.hoisted(() => ({
  auth: vi.fn(),
  issueDeviceSession: vi.fn(),
  loadPairingRow: vi.fn(),
  updatePairingRow: vi.fn(),
  recordAuditEvent: vi.fn(),
  createDeviceSessionRecord: vi.fn(),
  findDeviceSessionByPairingId: vi.fn(),
}));

vi.mock("../../auth", () => ({
  auth: claimRouteMocks.auth,
}));

vi.mock("../../lib/device-session", () => ({
  issueDeviceSession: claimRouteMocks.issueDeviceSession,
}));

vi.mock("../../lib/pairing-service", () => ({
  loadPairingRow: claimRouteMocks.loadPairingRow,
  updatePairingRow: claimRouteMocks.updatePairingRow,
  recordAuditEvent: claimRouteMocks.recordAuditEvent,
  PAIRING_AUDIT_EVENTS: {
    claimed: "pairing.claimed",
  },
}));

vi.mock("@codex-mobile/db", () => ({
  createDeviceSessionRecord: claimRouteMocks.createDeviceSessionRecord,
  findDeviceSessionByPairingId: claimRouteMocks.findDeviceSessionByPairingId,
}));

import { POST } from "../../app/api/pairings/[pairingId]/claim/route";

describe("POST /api/pairings/[pairingId]/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    claimRouteMocks.auth.mockResolvedValue({
      user: {
        id: "user-123",
        email: "user@example.com",
      },
    });
    claimRouteMocks.loadPairingRow.mockResolvedValue({
      id: "pairing-123",
      status: "confirmed",
      claimedAt: null,
      deviceLabel: "Pocket phone",
      redeemedByUserId: "user-123",
    });
    claimRouteMocks.issueDeviceSession.mockResolvedValue({
      deviceSessionId: "device-session-123",
      devicePublicId: "public-123",
      userId: "user-123",
      deviceLabel: "Pocket phone",
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      cookieTokenHash: "hash-123",
    });
    claimRouteMocks.createDeviceSessionRecord.mockResolvedValue({
      id: "device-session-123",
    });
    claimRouteMocks.updatePairingRow.mockResolvedValue(undefined);
    claimRouteMocks.recordAuditEvent.mockResolvedValue(undefined);
    claimRouteMocks.findDeviceSessionByPairingId.mockResolvedValue({
      id: "device-session-stored",
      deviceLabel: "Pocket phone",
    });
  });

  it("persists the durable device session row when a pairing is first claimed", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/pairings/pairing-123/claim", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ pairingId: "pairing-123" }),
      },
    );

    expect(response.status).toBe(200);
    expect(claimRouteMocks.createDeviceSessionRecord).toHaveBeenCalledWith({
      id: "device-session-123",
      userId: "user-123",
      deviceLabel: "Pocket phone",
      devicePublicId: "public-123",
      cookieTokenHash: "hash-123",
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
      issuedFromPairingId: "pairing-123",
    });
  });

  it("returns the stored durable deviceSessionId on idempotent re-claim", async () => {
    claimRouteMocks.loadPairingRow.mockResolvedValueOnce({
      id: "pairing-123",
      status: "confirmed",
      claimedAt: new Date("2026-04-18T12:00:00.000Z"),
      deviceLabel: "Pocket phone",
      redeemedByUserId: "user-123",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/pairings/pairing-123/claim", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ pairingId: "pairing-123" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "claimed",
      deviceSessionId: "device-session-stored",
      deviceLabel: "Pocket phone",
    });
    expect(claimRouteMocks.issueDeviceSession).not.toHaveBeenCalled();
  });
});
