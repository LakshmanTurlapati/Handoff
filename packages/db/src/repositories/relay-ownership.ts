import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  relay_bridge_leases,
  type RelayBridgeLeaseRow,
} from "../schema.js";

export interface UpsertBridgeLeaseInput {
  userId: string;
  deviceSessionId: string;
  bridgeInstanceId: string;
  relayMachineId: string;
  relayRegion: string;
  attachedSessionId?: string | null;
  connectedAt?: Date;
  lastHeartbeatAt?: Date;
  expiresAt: Date;
  disconnectedAt?: Date | null;
  leaseVersion?: number;
}

export interface RefreshBridgeLeaseInput {
  userId: string;
  bridgeInstanceId: string;
  lastHeartbeatAt?: Date;
  expiresAt: Date;
}

export interface SetAttachedSessionOnLeaseInput {
  userId: string;
  attachedSessionId: string | null;
}

export interface MarkBridgeLeaseDisconnectedInput {
  userId: string;
  bridgeInstanceId: string;
  disconnectedAt?: Date;
}

export interface RelayLeaseCountsForMachineInput {
  relayMachineId: string;
}

export interface RelayLeaseCountsForMachineResult {
  activeLeaseCount: number;
  staleLeaseCount: number;
}

export async function upsertBridgeLease(
  input: UpsertBridgeLeaseInput,
): Promise<RelayBridgeLeaseRow> {
  const db = getDb();
  const connectedAt = input.connectedAt ?? new Date();
  const lastHeartbeatAt = input.lastHeartbeatAt ?? connectedAt;
  const [row] = await db
    .insert(relay_bridge_leases)
    .values({
      userId: input.userId,
      deviceSessionId: input.deviceSessionId,
      bridgeInstanceId: input.bridgeInstanceId,
      relayMachineId: input.relayMachineId,
      relayRegion: input.relayRegion,
      attachedSessionId: input.attachedSessionId ?? null,
      leaseVersion: input.leaseVersion ?? 1,
      connectedAt,
      lastHeartbeatAt,
      expiresAt: input.expiresAt,
      disconnectedAt: input.disconnectedAt ?? null,
      replacedByLeaseId: null,
    })
    .onConflictDoUpdate({
      target: relay_bridge_leases.userId,
      set: {
        deviceSessionId: input.deviceSessionId,
        bridgeInstanceId: input.bridgeInstanceId,
        relayMachineId: input.relayMachineId,
        relayRegion: input.relayRegion,
        attachedSessionId: input.attachedSessionId ?? null,
        connectedAt,
        lastHeartbeatAt,
        expiresAt: input.expiresAt,
        disconnectedAt: input.disconnectedAt ?? null,
        replacedByLeaseId: null,
        leaseVersion: sql`${relay_bridge_leases.leaseVersion} + 1`,
      },
    })
    .returning();

  if (!row) {
    throw new Error(`relay bridge lease upsert failed for ${input.userId}`);
  }

  return row;
}

export async function refreshBridgeLease(
  input: RefreshBridgeLeaseInput,
): Promise<RelayBridgeLeaseRow | null> {
  const db = getDb();
  const [row] = await db
    .update(relay_bridge_leases)
    .set({
      lastHeartbeatAt: input.lastHeartbeatAt ?? new Date(),
      expiresAt: input.expiresAt,
      disconnectedAt: null,
    })
    .where(
      and(
        eq(relay_bridge_leases.userId, input.userId),
        eq(relay_bridge_leases.bridgeInstanceId, input.bridgeInstanceId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function findActiveBridgeLeaseForUser(input: {
  userId: string;
}): Promise<RelayBridgeLeaseRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(relay_bridge_leases)
    .where(
      and(
        eq(relay_bridge_leases.userId, input.userId),
        isNull(relay_bridge_leases.disconnectedAt),
        gt(relay_bridge_leases.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findActiveBridgeLeaseForSession(input: {
  sessionId: string;
}): Promise<RelayBridgeLeaseRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(relay_bridge_leases)
    .where(
      and(
        eq(relay_bridge_leases.attachedSessionId, input.sessionId),
        isNull(relay_bridge_leases.disconnectedAt),
        gt(relay_bridge_leases.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function setAttachedSessionOnLease(
  input: SetAttachedSessionOnLeaseInput,
): Promise<RelayBridgeLeaseRow | null> {
  const db = getDb();
  const [row] = await db
    .update(relay_bridge_leases)
    .set({
      attachedSessionId: input.attachedSessionId,
    })
    .where(
      and(
        eq(relay_bridge_leases.userId, input.userId),
        isNull(relay_bridge_leases.disconnectedAt),
      ),
    )
    .returning();

  return row ?? null;
}

export async function markBridgeLeaseDisconnected(
  input: MarkBridgeLeaseDisconnectedInput,
): Promise<RelayBridgeLeaseRow | null> {
  const db = getDb();
  const [row] = await db
    .update(relay_bridge_leases)
    .set({
      disconnectedAt: input.disconnectedAt ?? new Date(),
      attachedSessionId: null,
    })
    .where(
      and(
        eq(relay_bridge_leases.userId, input.userId),
        eq(relay_bridge_leases.bridgeInstanceId, input.bridgeInstanceId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function getRelayLeaseCountsForMachine(
  input: RelayLeaseCountsForMachineInput,
): Promise<RelayLeaseCountsForMachineResult> {
  const db = getDb();
  const [activeRow] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(relay_bridge_leases)
    .where(
      and(
        eq(relay_bridge_leases.relayMachineId, input.relayMachineId),
        isNull(relay_bridge_leases.disconnectedAt),
        gt(relay_bridge_leases.expiresAt, sql`now()`),
      ),
    );
  const [staleRow] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(relay_bridge_leases)
    .where(
      and(
        eq(relay_bridge_leases.relayMachineId, input.relayMachineId),
        or(
          isNotNull(relay_bridge_leases.disconnectedAt),
          lte(relay_bridge_leases.expiresAt, sql`now()`),
        ),
      ),
    );

  return {
    activeLeaseCount: activeRow?.count ?? 0,
    staleLeaseCount: staleRow?.count ?? 0,
  };
}
