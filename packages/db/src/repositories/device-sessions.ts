import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  bridge_installations,
  device_sessions,
  type DeviceSessionRow,
} from "../schema.js";

export interface CreateDeviceSessionRecordInput {
  id: string;
  userId: string;
  deviceLabel: string;
  devicePublicId: string;
  cookieTokenHash: string;
  expiresAt: Date;
  issuedFromPairingId?: string;
}

export interface FindDeviceSessionForPrincipalInput {
  deviceSessionId: string;
  userId?: string;
  cookieTokenHash?: string;
  bridgeInstallationId?: string;
}

export async function createDeviceSessionRecord(
  input: CreateDeviceSessionRecordInput,
): Promise<DeviceSessionRow> {
  const db = getDb();
  const [inserted] = await db
    .insert(device_sessions)
    .values({
      id: input.id,
      userId: input.userId,
      deviceLabel: input.deviceLabel,
      devicePublicId: input.devicePublicId,
      cookieTokenHash: input.cookieTokenHash,
      expiresAt: input.expiresAt,
      issuedFromPairingId: input.issuedFromPairingId,
    })
    .onConflictDoNothing({ target: device_sessions.id })
    .returning();

  if (inserted) {
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(device_sessions)
    .where(eq(device_sessions.id, input.id))
    .limit(1);

  if (!existing) {
    throw new Error(`device_session ${input.id} not found after create`);
  }

  return existing;
}

export async function findDeviceSessionForPrincipal({
  deviceSessionId,
  userId,
  cookieTokenHash,
  bridgeInstallationId,
}: FindDeviceSessionForPrincipalInput): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const conditions = [eq(device_sessions.id, deviceSessionId)];

  if (userId) {
    conditions.push(eq(device_sessions.userId, userId));
  }

  if (cookieTokenHash) {
    conditions.push(eq(device_sessions.cookieTokenHash, cookieTokenHash));
  }

  if (bridgeInstallationId) {
    const [joined] = await db
      .select({
        deviceSession: device_sessions,
      })
      .from(device_sessions)
      .innerJoin(
        bridge_installations,
        eq(device_sessions.issuedFromPairingId, bridge_installations.pairingId),
      )
      .where(
        and(
          ...conditions,
          eq(bridge_installations.id, bridgeInstallationId),
        ),
      )
      .limit(1);

    return joined?.deviceSession ?? null;
  }

  const [row] = await db
    .select()
    .from(device_sessions)
    .where(and(...conditions))
    .limit(1);

  return row ?? null;
}

export async function findDeviceSessionByPairingId(input: {
  pairingId: string;
  userId: string;
}): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(device_sessions)
    .where(
      and(
        eq(device_sessions.issuedFromPairingId, input.pairingId),
        eq(device_sessions.userId, input.userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function listDeviceSessionsForUser(
  userId: string,
): Promise<DeviceSessionRow[]> {
  const db = getDb();
  return db
    .select()
    .from(device_sessions)
    .where(eq(device_sessions.userId, userId))
    .orderBy(desc(device_sessions.lastSeenAt), desc(device_sessions.createdAt));
}

export async function listDeviceSessionsForBridgeInstallation(input: {
  bridgeInstallationId: string;
}): Promise<DeviceSessionRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      deviceSession: device_sessions,
    })
    .from(device_sessions)
    .innerJoin(
      bridge_installations,
      eq(device_sessions.issuedFromPairingId, bridge_installations.pairingId),
    )
    .where(eq(bridge_installations.id, input.bridgeInstallationId))
    .orderBy(desc(device_sessions.lastSeenAt), desc(device_sessions.createdAt));

  return rows.map((row) => row.deviceSession);
}

export async function revokeDeviceSession(input: {
  deviceSessionId: string;
  userId: string;
  bridgeInstallationId?: string;
  revokedAt?: Date;
}): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const revokedAt = input.revokedAt ?? new Date();

  if (input.bridgeInstallationId) {
    const allowed = await findDeviceSessionForPrincipal({
      deviceSessionId: input.deviceSessionId,
      userId: input.userId,
      bridgeInstallationId: input.bridgeInstallationId,
    });

    if (!allowed) {
      return null;
    }
  }

  const [updated] = await db
    .update(device_sessions)
    .set({ revokedAt })
    .where(
      and(
        eq(device_sessions.id, input.deviceSessionId),
        eq(device_sessions.userId, input.userId),
        isNull(device_sessions.revokedAt),
      ),
    )
    .returning();

  if (updated) {
    return updated;
  }

  const [existing] = await db
    .select()
    .from(device_sessions)
    .where(
      and(
        eq(device_sessions.id, input.deviceSessionId),
        eq(device_sessions.userId, input.userId),
      ),
    )
    .limit(1);

  return existing ?? null;
}

export async function touchDeviceSessionLastSeen(
  deviceSessionId: string,
  lastSeenAt = new Date(),
): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const [updated] = await db
    .update(device_sessions)
    .set({ lastSeenAt })
    .where(eq(device_sessions.id, deviceSessionId))
    .returning();

  return updated ?? null;
}
