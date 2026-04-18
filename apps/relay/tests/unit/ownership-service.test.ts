import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayBridgeLeaseRow } from "@codex-mobile/db";
import { OwnershipService } from "../../src/ownership/ownership-service.js";

function createLeaseRow(
  overrides: Partial<RelayBridgeLeaseRow> = {},
): RelayBridgeLeaseRow {
  return {
    id: "lease-1",
    userId: "user-1",
    deviceSessionId: "device-1",
    bridgeInstanceId: "bridge-1",
    relayMachineId: "local-dev-machine",
    relayRegion: "local",
    attachedSessionId: "session-1",
    leaseVersion: 1,
    connectedAt: new Date("2026-04-18T12:00:00.000Z"),
    lastHeartbeatAt: new Date("2026-04-18T12:00:30.000Z"),
    expiresAt: new Date("2026-04-25T12:01:30.000Z"),
    disconnectedAt: null,
    replacedByLeaseId: null,
    ...overrides,
  };
}

describe("OwnershipService", () => {
  const findActiveBridgeLeaseForUser = vi.fn();
  const findActiveBridgeLeaseForSession = vi.fn();
  const setAttachedSessionOnLease = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new OwnershipService({
      findActiveBridgeLeaseForUser,
      findActiveBridgeLeaseForSession,
      setAttachedSessionOnLease,
      getRelayInstanceIdentity: () => ({
        appName: "codex-mobile-relay",
        machineId: "local-dev-machine",
        region: "local",
      }),
    });
  }

  it("returns bridge_owner_missing for stale leases", async () => {
    findActiveBridgeLeaseForUser.mockResolvedValue(
      createLeaseRow({
        expiresAt: new Date("2026-04-17T11:59:00.000Z"),
      }),
    );

    const service = createService();
    const result = await service.resolveOwnerForUser("user-1");

    expect(result.status).toBe("bridge_owner_missing");
  });

  it("returns owner_not_local for active leases owned by another machine", async () => {
    findActiveBridgeLeaseForUser.mockResolvedValue(
      createLeaseRow({
        relayMachineId: "fly-machine-2",
        relayRegion: "dfw",
      }),
    );

    const service = createService();
    const result = await service.resolveOwnerForUser("user-1");

    expect(result.status).toBe("owner_not_local");
    expect(result.ownerMachineId).toBe("fly-machine-2");
    expect(result.ownerRegion).toBe("dfw");
  });

  it("returns local_owner for active local leases", async () => {
    findActiveBridgeLeaseForSession.mockResolvedValue(
      createLeaseRow({
        attachedSessionId: "session-1",
      }),
    );

    const service = createService();
    const result = await service.resolveOwnerForSession("session-1");

    expect(result.status).toBe("local_owner");
    expect(result.ownerMachineId).toBe("local-dev-machine");
  });

  it("records and clears the attached session pointer", async () => {
    findActiveBridgeLeaseForSession.mockResolvedValue(
      createLeaseRow({
        attachedSessionId: "session-1",
      }),
    );

    const service = createService();
    await service.recordAttachedSession({
      userId: "user-1",
      sessionId: "session-1",
    });
    await service.clearAttachedSession({ sessionId: "session-1" });

    expect(setAttachedSessionOnLease).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      attachedSessionId: "session-1",
    });
    expect(setAttachedSessionOnLease).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      attachedSessionId: null,
    });
  });
});
