import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client.js";
import {
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
  userId: string;
  cookieTokenHash: string;
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
}: FindDeviceSessionForPrincipalInput): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(device_sessions)
    .where(eq(device_sessions.id, deviceSessionId))
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

export async function revokeDeviceSession(input: {
  deviceSessionId: string;
  userId: string;
  revokedAt?: Date;
}): Promise<DeviceSessionRow | null> {
  const db = getDb();
  const revokedAt = input.revokedAt ?? new Date();
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
