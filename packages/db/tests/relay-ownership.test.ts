import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayBridgeLeaseRow } from "../src/schema.js";

const relayOwnershipDbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../src/client.js", () => ({
  getDb: relayOwnershipDbMocks.getDb,
}));

import {
  findActiveBridgeLeaseForSession,
  findActiveBridgeLeaseForUser,
  markBridgeLeaseDisconnected,
  refreshBridgeLease,
  setAttachedSessionOnLease,
  upsertBridgeLease,
} from "../src/repositories/relay-ownership.js";

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
    lastHeartbeatAt: new Date("2026-04-18T12:00:00.000Z"),
    expiresAt: new Date("2026-04-18T12:01:30.000Z"),
    disconnectedAt: null,
    replacedByLeaseId: null,
    ...overrides,
  };
}

function createInsertDb(returnedRows: RelayBridgeLeaseRow[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert }, insert, values, onConflictDoUpdate, returning };
}

function createSelectDb(returnedRows: RelayBridgeLeaseRow[]) {
  const limit = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, select, from, where, limit };
}

function createUpdateDb(returnedRows: RelayBridgeLeaseRow[]) {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update }, update, set, where, returning };
}

describe("relay ownership repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts the durable bridge lease row", async () => {
    const lease = createLeaseRow();
    const chain = createInsertDb([lease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await upsertBridgeLease({
      userId: "user-1",
      deviceSessionId: "device-1",
      bridgeInstanceId: "bridge-1",
      relayMachineId: "local-dev-machine",
      relayRegion: "local",
      expiresAt: new Date("2026-04-18T12:01:30.000Z"),
      leaseVersion: 1,
    });

    expect(row).toEqual(lease);
    expect(chain.insert).toHaveBeenCalledTimes(1);
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        bridgeInstanceId: "bridge-1",
        relayMachineId: "local-dev-machine",
        relayRegion: "local",
        leaseVersion: 1,
      }),
    );
    expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("refreshes the active bridge lease heartbeat", async () => {
    const lease = createLeaseRow({
      lastHeartbeatAt: new Date("2026-04-18T12:00:30.000Z"),
    });
    const chain = createUpdateDb([lease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await refreshBridgeLease({
      userId: "user-1",
      bridgeInstanceId: "bridge-1",
      expiresAt: new Date("2026-04-18T12:02:00.000Z"),
    });

    expect(row).toEqual(lease);
    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        disconnectedAt: null,
        expiresAt: new Date("2026-04-18T12:02:00.000Z"),
      }),
    );
  });

  it("finds the active bridge lease for a user", async () => {
    const lease = createLeaseRow();
    const chain = createSelectDb([lease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await findActiveBridgeLeaseForUser({ userId: "user-1" });

    expect(row).toEqual(lease);
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("finds the active bridge lease for an attached session", async () => {
    const lease = createLeaseRow({ attachedSessionId: "session-1" });
    const chain = createSelectDb([lease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await findActiveBridgeLeaseForSession({ sessionId: "session-1" });

    expect(row).toEqual(lease);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("sets and clears the attached session pointer on the active lease", async () => {
    const lease = createLeaseRow({ attachedSessionId: null });
    const chain = createUpdateDb([lease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await setAttachedSessionOnLease({
      userId: "user-1",
      attachedSessionId: null,
    });

    expect(row).toEqual(lease);
    expect(chain.set).toHaveBeenCalledWith({ attachedSessionId: null });
  });

  it("marks the bridge lease disconnected and clears its session pointer", async () => {
    const disconnectedLease = createLeaseRow({
      attachedSessionId: null,
      disconnectedAt: new Date("2026-04-18T12:01:00.000Z"),
    });
    const chain = createUpdateDb([disconnectedLease]);
    relayOwnershipDbMocks.getDb.mockReturnValue(chain.db);

    const row = await markBridgeLeaseDisconnected({
      userId: "user-1",
      bridgeInstanceId: "bridge-1",
    });

    expect(row).toEqual(disconnectedLease);
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        attachedSessionId: null,
        disconnectedAt: expect.any(Date),
      }),
    );
  });
});
