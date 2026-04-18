import { desc, eq } from "drizzle-orm";
import { getDb } from "../client.js";
import { audit_events, type AuditEventRow } from "../schema.js";

export interface AppendAuditEventInput {
  userId?: string | null;
  eventType: string;
  subject?: string | null;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sequence?: number | null;
  createdAt?: Date;
}

export async function appendAuditEvent(
  input: AppendAuditEventInput,
): Promise<AuditEventRow> {
  const db = getDb();
  const [row] = await db
    .insert(audit_events)
    .values({
      userId: input.userId ?? null,
      eventType: input.eventType,
      subject: input.subject ?? null,
      outcome: input.outcome,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      sequence: input.sequence ?? null,
      createdAt: input.createdAt ?? new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("audit_event insert failed");
  }

  return row;
}

export async function listAuditEventsForUser(input: {
  userId: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  const db = getDb();
  return db
    .select()
    .from(audit_events)
    .where(eq(audit_events.userId, input.userId))
    .orderBy(desc(audit_events.createdAt), desc(audit_events.id))
    .limit(input.limit ?? 50);
}
