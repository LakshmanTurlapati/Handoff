import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getRelayLeaseCountsForMachine } from "@codex-mobile/db";
import { sessionRouter, type SessionRouter } from "../browser/session-router.js";
import { bridgeRegistry, type BridgeRegistry } from "../bridge/bridge-registry.js";
import {
  getRelayInstanceIdentity,
  type RelayInstanceIdentity,
} from "../ownership/relay-instance.js";

const MAX_RECENT_REPLAY_FAILURES = 10;

export interface RelayReplayFailure {
  event: string;
  ownerMachineId: string;
  ownerRegion: string;
  replayState: string;
  replaySource: string | null;
  replayFailed: boolean;
  recordedAt: string;
}

export interface RelayOpsSnapshot {
  relayMachineId: string;
  relayRegion: string;
  activeBridgeCount: number;
  activeBrowserCount: number;
  activeLeaseCount: number;
  staleLeaseCount: number;
  queuePressureCount: number;
  backpressuredSockets: number;
  droppedBestEffortMessages: number;
  recentDisconnectReasons: string[];
  recentReplayFailures: RelayReplayFailure[];
  readyzStatus: "ready" | "degraded";
}

export interface RelayOpsDependencies {
  bridgeRegistry?: Pick<BridgeRegistry, "size">;
  sessionRouter?: Pick<SessionRouter, "getBrowserSnapshot">;
  getRelayInstanceIdentity?: () => RelayInstanceIdentity;
  getRelayLeaseCountsForMachine?: typeof getRelayLeaseCountsForMachine;
  getRecentReplayFailures?: () => RelayReplayFailure[];
}

interface RelayLeaseCountsResult {
  activeLeaseCount: number;
  staleLeaseCount: number;
  ownershipStorageHealthy: boolean;
}

let recentReplayFailures: RelayReplayFailure[] = [];

export function recordReplayFailure(
  input: Omit<RelayReplayFailure, "recordedAt"> & { recordedAt?: string },
): void {
  recentReplayFailures = [
    {
      ...input,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    },
    ...recentReplayFailures,
  ].slice(0, MAX_RECENT_REPLAY_FAILURES);
}

export function resetRelayOpsState(): void {
  recentReplayFailures = [];
}

export function getRecentReplayFailures(): RelayReplayFailure[] {
  return [...recentReplayFailures];
}

export function computeReadyzStatus(input: {
  ownershipStorageHealthy: boolean;
  backpressuredSockets: number;
}): "ready" | "degraded" {
  if (!input.ownershipStorageHealthy || input.backpressuredSockets >= 5) {
    return "degraded";
  }

  return "ready";
}

async function loadRelayLeaseCounts(
  relayMachineId: string,
  getCounts: typeof getRelayLeaseCountsForMachine,
): Promise<RelayLeaseCountsResult> {
  try {
    const counts = await getCounts({ relayMachineId });
    return {
      activeLeaseCount: counts.activeLeaseCount,
      staleLeaseCount: counts.staleLeaseCount,
      ownershipStorageHealthy: true,
    };
  } catch {
    return {
      activeLeaseCount: 0,
      staleLeaseCount: 0,
      ownershipStorageHealthy: false,
    };
  }
}

export async function handleRelayOps(
  dependencies: RelayOpsDependencies = {},
): Promise<RelayOpsSnapshot> {
  const relayIdentity =
    dependencies.getRelayInstanceIdentity ?? getRelayInstanceIdentity;
  const leaseCountsLoader =
    dependencies.getRelayLeaseCountsForMachine ?? getRelayLeaseCountsForMachine;
  const browserSnapshot = (
    dependencies.sessionRouter ?? sessionRouter
  ).getBrowserSnapshot();
  const identity = relayIdentity();
  const leaseCounts = await loadRelayLeaseCounts(
    identity.machineId,
    leaseCountsLoader,
  );
  const readyzStatus = computeReadyzStatus({
    ownershipStorageHealthy: leaseCounts.ownershipStorageHealthy,
    backpressuredSockets: browserSnapshot.backpressuredSockets,
  });

  return {
    relayMachineId: identity.machineId,
    relayRegion: identity.region,
    activeBridgeCount: (dependencies.bridgeRegistry ?? bridgeRegistry).size,
    activeBrowserCount: browserSnapshot.activeBrowserCount,
    activeLeaseCount: leaseCounts.activeLeaseCount,
    staleLeaseCount: leaseCounts.staleLeaseCount,
    queuePressureCount: browserSnapshot.queuePressureCount,
    backpressuredSockets: browserSnapshot.backpressuredSockets,
    droppedBestEffortMessages: browserSnapshot.droppedBestEffortMessages,
    recentDisconnectReasons: browserSnapshot.recentDisconnectReasons,
    recentReplayFailures: (
      dependencies.getRecentReplayFailures ?? getRecentReplayFailures
    )(),
    readyzStatus,
  };
}

export function registerOpsRoutes(
  app: FastifyInstance,
  dependencies: RelayOpsDependencies = {},
): void {
  app.get(
    "/ops/relay",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const payload = await handleRelayOps(dependencies);
      reply.code(payload.readyzStatus === "ready" ? 200 : 503).send(payload);
    },
  );
}
