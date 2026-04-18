import { describe, expect, it } from "vitest";
import { handleReadyz } from "../../src/routes/readyz.js";

describe("relay readyz", () => {
  it('returns `status: "ready"` below the backpressure threshold', async () => {
    const payload = await handleReadyz({
      bridgeRegistry: { size: 1 } as never,
      sessionRouter: {
        getBrowserSnapshot: () => ({
          activeBrowserCount: 2,
          queuePressureCount: 3,
          backpressuredSockets: 4,
          droppedBestEffortMessages: 2,
          recentDisconnectReasons: [],
        }),
      } as never,
      getRelayInstanceIdentity: () => ({
        appName: "codex-mobile-relay",
        machineId: "fly-machine-1",
        region: "iad",
      }),
      getRelayLeaseCountsForMachine: async () => ({
        activeLeaseCount: 2,
        staleLeaseCount: 1,
      }),
    });

    expect(payload).toEqual({ status: "ready" });
  });

  it('returns `status: "degraded"` at five backpressured sockets', async () => {
    const payload = await handleReadyz({
      bridgeRegistry: { size: 1 } as never,
      sessionRouter: {
        getBrowserSnapshot: () => ({
          activeBrowserCount: 2,
          queuePressureCount: 8,
          backpressuredSockets: 5,
          droppedBestEffortMessages: 9,
          recentDisconnectReasons: ["backpressure"],
        }),
      } as never,
      getRelayInstanceIdentity: () => ({
        appName: "codex-mobile-relay",
        machineId: "fly-machine-1",
        region: "iad",
      }),
      getRelayLeaseCountsForMachine: async () => ({
        activeLeaseCount: 2,
        staleLeaseCount: 1,
      }),
    });

    expect(payload).toEqual({ status: "degraded" });
  });

  it('returns `status: "degraded"` when ownership storage is unavailable', async () => {
    const payload = await handleReadyz({
      bridgeRegistry: { size: 1 } as never,
      sessionRouter: {
        getBrowserSnapshot: () => ({
          activeBrowserCount: 1,
          queuePressureCount: 0,
          backpressuredSockets: 0,
          droppedBestEffortMessages: 0,
          recentDisconnectReasons: [],
        }),
      } as never,
      getRelayInstanceIdentity: () => ({
        appName: "codex-mobile-relay",
        machineId: "fly-machine-1",
        region: "iad",
      }),
      getRelayLeaseCountsForMachine: async () => {
        throw new Error("db unavailable");
      },
    });

    expect(payload).toEqual({ status: "degraded" });
  });
});
