import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  registerOpsRoutes,
  type RelayReplayFailure,
} from "../../src/routes/ops.js";

describe("relay ops route", () => {
  it("returns the compact relay snapshot with exact keys", async () => {
    const app = Fastify({ logger: false });
    registerOpsRoutes(app, {
      bridgeRegistry: { size: 2 } as never,
      sessionRouter: {
        getBrowserSnapshot: () => ({
          activeBrowserCount: 3,
          queuePressureCount: 7,
          backpressuredSockets: 1,
          droppedBestEffortMessages: 11,
          recentDisconnectReasons: ["backpressure", "bridge_unavailable"],
        }),
      } as never,
      getRelayInstanceIdentity: () => ({
        appName: "codex-mobile-relay",
        machineId: "fly-machine-1",
        region: "iad",
      }),
      getRelayLeaseCountsForMachine: async () => ({
        activeLeaseCount: 5,
        staleLeaseCount: 2,
      }),
      getRecentReplayFailures: (): RelayReplayFailure[] => [
        {
          event: "browser_replay_failed",
          ownerMachineId: "fly-machine-2",
          ownerRegion: "dfw",
          replayState: "browser:user-alpha:session-alpha:device-alpha",
          replaySource: "instance=fly-machine-2;state=browser:user-alpha:session-alpha:device-alpha",
          replayFailed: true,
          recordedAt: "2026-04-18T12:05:00.000Z",
        },
      ],
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/ops/relay",
      });

      expect(response.statusCode).toBe(200);
      expect(Object.keys(response.json())).toEqual([
        "relayMachineId",
        "relayRegion",
        "activeBridgeCount",
        "activeBrowserCount",
        "activeLeaseCount",
        "staleLeaseCount",
        "queuePressureCount",
        "backpressuredSockets",
        "droppedBestEffortMessages",
        "recentDisconnectReasons",
        "recentReplayFailures",
        "readyzStatus",
      ]);
      expect(response.json()).toMatchObject({
        relayMachineId: "fly-machine-1",
        relayRegion: "iad",
        activeBridgeCount: 2,
        activeBrowserCount: 3,
        activeLeaseCount: 5,
        staleLeaseCount: 2,
        queuePressureCount: 7,
        backpressuredSockets: 1,
        droppedBestEffortMessages: 11,
        readyzStatus: "ready",
      });
      expect(response.json().recentDisconnectReasons).toEqual([
        "backpressure",
        "bridge_unavailable",
      ]);
    } finally {
      await app.close();
    }
  });
});
