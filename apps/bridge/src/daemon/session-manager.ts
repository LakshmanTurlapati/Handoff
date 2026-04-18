import type { SessionMetadata } from "@codex-mobile/protocol";

type ApprovalRequestId = string | number;

interface SessionRecord {
  cursor: number;
  metadata: SessionMetadata;
}

function cloneSessionMetadata(
  metadata: SessionMetadata,
  status = metadata.status,
): SessionMetadata {
  return {
    ...metadata,
    status,
  };
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly activeTurns = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, Set<ApprovalRequestId>>();
  private attachedSessionId: string | null = null;

  replaceSessions(sessions: SessionMetadata[]): void {
    const nextIds = new Set<string>();

    for (const session of sessions) {
      nextIds.add(session.sessionId);
      const existing = this.sessions.get(session.sessionId);
      const status =
        session.sessionId === this.attachedSessionId ? "active" : session.status;

      this.sessions.set(session.sessionId, {
        cursor: existing?.cursor ?? 0,
        metadata: cloneSessionMetadata(session, status),
      });
    }

    for (const sessionId of [...this.sessions.keys()]) {
      if (sessionId === this.attachedSessionId) continue;
      if (!nextIds.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.activeTurns.delete(sessionId);
        this.pendingApprovals.delete(sessionId);
      }
    }
  }

  listSessions(): SessionMetadata[] {
    return [...this.sessions.values()].map(({ metadata }) =>
      cloneSessionMetadata(
        metadata,
        metadata.sessionId === this.attachedSessionId ? "active" : metadata.status,
      ),
    );
  }

  getAttachedSessionId(): string | null {
    return this.attachedSessionId;
  }

  ensureAttachable(sessionId: string): SessionMetadata {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error("session_not_found");
    }

    if (this.attachedSessionId && this.attachedSessionId !== sessionId) {
      throw new Error("session_already_attached");
    }

    return cloneSessionMetadata(record.metadata);
  }

  attach(sessionId: string): SessionMetadata {
    this.ensureAttachable(sessionId);
    this.attachedSessionId = sessionId;
    this.activeTurns.delete(sessionId);
    this.pendingApprovals.delete(sessionId);
    return this.setStatus(sessionId, "active");
  }

  detach(sessionId: string): SessionMetadata {
    this.ensureAttached(sessionId);
    this.attachedSessionId = null;
    this.activeTurns.delete(sessionId);
    this.pendingApprovals.delete(sessionId);
    return this.setStatus(sessionId, "idle");
  }

  ensureAttached(sessionId: string): SessionMetadata {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error("session_not_found");
    }

    if (this.attachedSessionId !== sessionId) {
      throw new Error("session_not_attached");
    }

    return cloneSessionMetadata(record.metadata, "active");
  }

  markSessionEnded(sessionId: string): void {
    if (this.attachedSessionId === sessionId) {
      this.attachedSessionId = null;
    }

    this.activeTurns.delete(sessionId);
    this.pendingApprovals.delete(sessionId);

    if (this.sessions.has(sessionId)) {
      this.setStatus(sessionId, "idle");
    }
  }

  markTurnStarted(sessionId: string, turnId: string): void {
    this.activeTurns.set(sessionId, turnId);
  }

  markTurnCompleted(sessionId: string, turnId?: string | null): void {
    if (!turnId) {
      this.activeTurns.delete(sessionId);
      return;
    }

    if (this.activeTurns.get(sessionId) === turnId) {
      this.activeTurns.delete(sessionId);
    }
  }

  getActiveTurnId(sessionId: string): string | null {
    return this.activeTurns.get(sessionId) ?? null;
  }

  requireActiveTurn(sessionId: string, turnId?: string): string {
    this.ensureAttached(sessionId);
    const resolvedTurnId = turnId ?? this.activeTurns.get(sessionId);
    if (!resolvedTurnId) {
      throw new Error("turn_not_active");
    }
    return resolvedTurnId;
  }

  rememberApproval(sessionId: string, requestId: ApprovalRequestId): void {
    this.ensureAttached(sessionId);
    const existing = this.pendingApprovals.get(sessionId) ?? new Set<ApprovalRequestId>();
    existing.add(requestId);
    this.pendingApprovals.set(sessionId, existing);
  }

  resolveApproval(sessionId: string, requestId: ApprovalRequestId): void {
    const existing = this.pendingApprovals.get(sessionId);
    if (!existing) return;

    existing.delete(requestId);
    if (existing.size === 0) {
      this.pendingApprovals.delete(sessionId);
    }
  }

  nextCursor(sessionId: string): number {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error("session_not_found");
    }

    record.cursor += 1;
    return record.cursor;
  }

  getCursor(sessionId: string): number {
    return this.sessions.get(sessionId)?.cursor ?? 0;
  }

  private setStatus(
    sessionId: string,
    status: SessionMetadata["status"],
  ): SessionMetadata {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error("session_not_found");
    }

    record.metadata = cloneSessionMetadata(record.metadata, status);
    return cloneSessionMetadata(record.metadata);
  }
}
