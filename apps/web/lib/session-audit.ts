import { appendAuditEvent } from "@codex-mobile/db";
import { AUDIT_EVENT_TYPES } from "@codex-mobile/protocol";

export async function recordWsTicketAudit(input: {
  outcome: "success" | "failure";
  userId?: string | null;
  sessionId: string;
  deviceSessionId?: string | null;
  expiresAt?: Date | string | null;
  failureCode?: string;
}): Promise<void> {
  await appendAuditEvent({
    userId: input.userId ?? null,
    eventType:
      input.outcome === "success"
        ? AUDIT_EVENT_TYPES.wsTicketMinted
        : AUDIT_EVENT_TYPES.wsTicketRejected,
    subject: input.sessionId,
    outcome: input.outcome,
    metadata: {
      sessionId: input.sessionId,
      deviceSessionId: input.deviceSessionId ?? null,
      expiresAt:
        input.expiresAt instanceof Date
          ? input.expiresAt.toISOString()
          : input.expiresAt ?? null,
      failureCode: input.failureCode ?? null,
    },
  });
}

export async function recordApprovalDecisionAudit(input: {
  userId: string;
  sessionId: string;
  deviceSessionId: string;
  requestId: string | number;
  decision: "approved" | "denied" | "abort";
}): Promise<void> {
  await appendAuditEvent({
    userId: input.userId,
    eventType: AUDIT_EVENT_TYPES.approvalResponded,
    subject: String(input.requestId),
    outcome: "success",
    metadata: {
      sessionId: input.sessionId,
      deviceSessionId: input.deviceSessionId,
      requestId: String(input.requestId),
      decision: input.decision,
    },
  });
}
