import { and, eq, or } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  bridge_installations,
  type BridgeInstallationRow,
} from "../schema.js";

export interface CreateBridgeInstallationInput {
  userId: string;
  pairingId: string;
  bridgeInstanceId: string;
  deviceLabel?: string | null;
  installTokenHash: string;
  createdAt?: Date;
  lastUsedAt?: Date;
}

export async function createBridgeInstallation(
  input: CreateBridgeInstallationInput,
): Promise<BridgeInstallationRow> {
  const db = getDb();
  const createdAt = input.createdAt ?? new Date();
  const lastUsedAt = input.lastUsedAt ?? createdAt;

  const [existing] = await db
    .select()
    .from(bridge_installations)
    .where(
      or(
        eq(bridge_installations.pairingId, input.pairingId),
        and(
          eq(bridge_installations.userId, input.userId),
          eq(bridge_installations.bridgeInstanceId, input.bridgeInstanceId),
        ),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(bridge_installations)
      .set({
        pairingId: input.pairingId,
        bridgeInstanceId: input.bridgeInstanceId,
        deviceLabel: input.deviceLabel ?? null,
        installTokenHash: input.installTokenHash,
        lastUsedAt,
        revokedAt: null,
      })
      .where(eq(bridge_installations.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error(`bridge_installation ${existing.id} not found after update`);
    }

    return updated;
  }

  const [created] = await db
    .insert(bridge_installations)
    .values({
      userId: input.userId,
      pairingId: input.pairingId,
      bridgeInstanceId: input.bridgeInstanceId,
      deviceLabel: input.deviceLabel ?? null,
      installTokenHash: input.installTokenHash,
      createdAt,
      lastUsedAt,
      revokedAt: null,
    })
    .returning();

  if (!created) {
    throw new Error("bridge_installation insert failed");
  }

  return created;
}

export async function findBridgeInstallationByTokenHash(input: {
  installTokenHash: string;
}): Promise<BridgeInstallationRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bridge_installations)
    .where(eq(bridge_installations.installTokenHash, input.installTokenHash))
    .limit(1);

  return row ?? null;
}

export async function touchBridgeInstallationLastUsed(input: {
  bridgeInstallationId: string;
  lastUsedAt?: Date;
}): Promise<BridgeInstallationRow | null> {
  const db = getDb();
  const [row] = await db
    .update(bridge_installations)
    .set({
      lastUsedAt: input.lastUsedAt ?? new Date(),
    })
    .where(eq(bridge_installations.id, input.bridgeInstallationId))
    .returning();

  return row ?? null;
}

export async function revokeBridgeInstallation(input: {
  bridgeInstallationId: string;
  userId?: string;
  revokedAt?: Date;
}): Promise<BridgeInstallationRow | null> {
  const db = getDb();
  const conditions = [eq(bridge_installations.id, input.bridgeInstallationId)];

  if (input.userId) {
    conditions.push(eq(bridge_installations.userId, input.userId));
  }

  const [row] = await db
    .update(bridge_installations)
    .set({
      revokedAt: input.revokedAt ?? new Date(),
    })
    .where(and(...conditions))
    .returning();

  return row ?? null;
}
