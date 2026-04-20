import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../client.js";
import {
  thread_handoffs,
  type ThreadHandoffRow,
} from "../schema.js";

export interface FindValidThreadHandoffInput {
  userId: string;
  bridgeInstallationId: string;
  threadId: string;
  sessionId: string;
  now?: Date;
}

export interface CreateOrReuseThreadHandoffInput
  extends FindValidThreadHandoffInput {
  bridgeInstanceId: string;
  publicId: string;
  expiresAt: Date;
  createdAt?: Date;
  lastUsedAt?: Date;
}

export async function findValidThreadHandoff(
  input: FindValidThreadHandoffInput,
): Promise<ThreadHandoffRow | null> {
  const db = getDb();
  const now = input.now ?? new Date();
  const [row] = await db
    .select()
    .from(thread_handoffs)
    .where(
      and(
        eq(thread_handoffs.userId, input.userId),
        eq(thread_handoffs.bridgeInstallationId, input.bridgeInstallationId),
        eq(thread_handoffs.threadId, input.threadId),
        eq(thread_handoffs.sessionId, input.sessionId),
        isNull(thread_handoffs.revokedAt),
        gt(thread_handoffs.expiresAt, now),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function createOrReuseThreadHandoff(
  input: CreateOrReuseThreadHandoffInput,
): Promise<{ handoff: ThreadHandoffRow; reused: boolean }> {
  const db = getDb();
  const now = input.lastUsedAt ?? input.createdAt ?? new Date();
  const existing = await findValidThreadHandoff({
    userId: input.userId,
    bridgeInstallationId: input.bridgeInstallationId,
    threadId: input.threadId,
    sessionId: input.sessionId,
    now,
  });

  if (existing) {
    const [updated] = await db
      .update(thread_handoffs)
      .set({
        lastUsedAt: now,
      })
      .where(eq(thread_handoffs.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error(`thread_handoff ${existing.id} not found after update`);
    }

    return {
      handoff: updated,
      reused: true,
    };
  }

  const createdAt = input.createdAt ?? now;
  const [created] = await db
    .insert(thread_handoffs)
    .values({
      publicId: input.publicId,
      userId: input.userId,
      bridgeInstallationId: input.bridgeInstallationId,
      bridgeInstanceId: input.bridgeInstanceId,
      threadId: input.threadId,
      sessionId: input.sessionId,
      createdAt,
      lastUsedAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
    })
    .returning();

  if (!created) {
    throw new Error("thread_handoff insert failed");
  }

  return {
    handoff: created,
    reused: false,
  };
}

export async function findThreadHandoffByPublicId(input: {
  publicId: string;
}): Promise<ThreadHandoffRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(thread_handoffs)
    .where(eq(thread_handoffs.publicId, input.publicId))
    .limit(1);

  return row ?? null;
}

export async function revokeThreadHandoff(input: {
  threadHandoffId?: string;
  publicId?: string;
  userId?: string;
  revokedAt?: Date;
}): Promise<ThreadHandoffRow | null> {
  if (!input.threadHandoffId && !input.publicId) {
    throw new Error("thread_handoff identifier required");
  }

  const db = getDb();
  const conditions = [];

  if (input.threadHandoffId) {
    conditions.push(eq(thread_handoffs.id, input.threadHandoffId));
  }

  if (input.publicId) {
    conditions.push(eq(thread_handoffs.publicId, input.publicId));
  }

  if (input.userId) {
    conditions.push(eq(thread_handoffs.userId, input.userId));
  }

  const [updated] = await db
    .update(thread_handoffs)
    .set({
      revokedAt: input.revokedAt ?? new Date(),
    })
    .where(and(...conditions))
    .returning();

  return updated ?? null;
}
