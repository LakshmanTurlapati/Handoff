import type {
  ApprovalRespondParams,
  LiveSessionEvent,
  SessionAttachParams,
  SessionDetachParams,
  SessionListResult,
  SessionMetadata,
  TurnInterruptRequestParams,
  TurnSendParams,
  TurnSteerParams,
} from "@codex-mobile/protocol";
import { createNotification } from "../lib/jsonrpc.js";
import { CodexAdapter } from "./codex-adapter.js";
import {
  buildSessionHistoryPayload,
  normalizeCodexServerEvent,
} from "./codex-event-normalizer.js";
import { BridgeMessageRouter } from "./message-router.js";
import { RelayConnection } from "./relay-connection.js";
import { SessionManager } from "./session-manager.js";

interface EventSourceLike {
  off(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export interface RelayConnectionLike extends EventSourceLike {
  connect(): Promise<void>;
  disconnect(): void;
  send(message: object): boolean;
}

export interface CodexAdapterLike extends EventSourceLike {
  interruptTurn(sessionId: string, turnId: string): Promise<unknown>;
  listSessions(): Promise<SessionMetadata[]>;
  readSession(sessionId: string): Promise<unknown>;
  respondToApproval(
    requestId: string | number,
    decision: "approved" | "denied" | "abort",
  ): Promise<void>;
  resumeSession(sessionId: string): Promise<unknown>;
  start(): Promise<void>;
  startTurn(sessionId: string, userMessage: string): Promise<unknown>;
  steerTurn(
    sessionId: string,
    userMessage: string,
    expectedTurnId: string,
  ): Promise<unknown>;
  stop(): Promise<void>;
}

export interface BridgeDaemonOptions {
  codexAdapter?: CodexAdapterLike;
  relayConnection: RelayConnectionLike;
  sessionManager?: SessionManager;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function readTurnId(result: unknown): string | null {
  const record = asRecord(result);
  const turn = asRecord(record?.turn);
  return readString(turn ?? record ?? {}, "id", "turnId");
}

function resolveSessionId(message: unknown): string | null {
  const record = asRecord(message);
  const params = asRecord(record?.params);
  return readString(params ?? {}, "threadId", "sessionId");
}

export class BridgeDaemon {
  private readonly codexAdapter: CodexAdapterLike;
  private readonly relayConnection: RelayConnectionLike;
  private readonly sessionManager: SessionManager;
  private readonly messageRouter: BridgeMessageRouter;
  private started = false;

  private readonly handleRelayMessage = (rawMessage: unknown) => {
    if (typeof rawMessage !== "string") return;
    void this.messageRouter.routeMessage(rawMessage);
  };

  private readonly handleRelayConnected = () => {
    void this.refreshSessions();
  };

  private readonly handleCodexNotification = (message: unknown) => {
    this.forwardCodexMessage(message, false);
  };

  private readonly handleCodexRequest = (message: unknown) => {
    this.forwardCodexMessage(message, true);
  };

  private readonly handleCodexExit = () => {
    const sessionId = this.sessionManager.getAttachedSessionId();
    if (!sessionId) return;
    this.notifySessionEnded(sessionId, "codex_process_exited");
  };

  constructor(options: BridgeDaemonOptions) {
    this.codexAdapter = options.codexAdapter ?? new CodexAdapter();
    this.relayConnection = options.relayConnection;
    this.sessionManager = options.sessionManager ?? new SessionManager();
    this.messageRouter = new BridgeMessageRouter(this.relayConnection, {
      approvalRespond: async (params) => this.approvalRespond(params),
      attachSession: async (params) => this.attachSession(params),
      detachSession: async (params) => this.detachSession(params),
      interruptTurn: async (params) => this.interruptTurn(params),
      listSessions: async () => this.listSessions(),
      sendTurn: async (params) => this.sendTurn(params),
      steerTurn: async (params) => this.steerTurn(params),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.relayConnection.on("message", this.handleRelayMessage);
    this.relayConnection.on("connected", this.handleRelayConnected);
    this.codexAdapter.on("server-notification", this.handleCodexNotification);
    this.codexAdapter.on("server-request", this.handleCodexRequest);
    this.codexAdapter.on("exit", this.handleCodexExit);

    try {
      await this.codexAdapter.start();
      await this.refreshSessions();
      await this.relayConnection.connect();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    this.relayConnection.off("message", this.handleRelayMessage);
    this.relayConnection.off("connected", this.handleRelayConnected);
    this.codexAdapter.off("server-notification", this.handleCodexNotification);
    this.codexAdapter.off("server-request", this.handleCodexRequest);
    this.codexAdapter.off("exit", this.handleCodexExit);

    this.relayConnection.disconnect();
    await this.codexAdapter.stop();
  }

  async refreshSessions(): Promise<SessionListResult> {
    const sessions = await this.codexAdapter.listSessions();
    this.sessionManager.replaceSessions(sessions);
    return { sessions: this.sessionManager.listSessions() };
  }

  private async listSessions(): Promise<SessionListResult> {
    return this.refreshSessions();
  }

  private async attachSession(params: SessionAttachParams): Promise<void> {
    const { sessionId } = params;
    await this.refreshSessions();
    this.sessionManager.ensureAttachable(sessionId);

    await this.codexAdapter.resumeSession(sessionId);
    const readResult = await this.codexAdapter.readSession(sessionId);
    this.sessionManager.attach(sessionId);

    this.emitSessionEvent({
      kind: "session.attached",
      sessionId,
      cursor: this.sessionManager.nextCursor(sessionId),
      occurredAt: new Date().toISOString(),
    });

    const historyPayload = buildSessionHistoryPayload({
      sessionId,
      cursor: this.sessionManager.nextCursor(sessionId),
      readResult,
    });
    this.relayConnection.send(createNotification("session.history", historyPayload));
  }

  private async detachSession(params: SessionDetachParams): Promise<void> {
    this.sessionManager.detach(params.sessionId);
    this.notifySessionEnded(params.sessionId, "detached");
  }

  private async sendTurn(params: TurnSendParams): Promise<void> {
    this.sessionManager.ensureAttached(params.sessionId);
    const result = await this.codexAdapter.startTurn(
      params.sessionId,
      params.userMessage,
    );
    const turnId = readTurnId(result);
    if (turnId) {
      this.sessionManager.markTurnStarted(params.sessionId, turnId);
    }
  }

  private async steerTurn(params: TurnSteerParams): Promise<void> {
    const expectedTurnId = this.sessionManager.requireActiveTurn(
      params.sessionId,
      params.targetTurnId,
    );
    const result = await this.codexAdapter.steerTurn(
      params.sessionId,
      params.userMessage,
      expectedTurnId,
    );
    const turnId = readTurnId(result) ?? expectedTurnId;
    this.sessionManager.markTurnStarted(params.sessionId, turnId);
  }

  private async approvalRespond(params: ApprovalRespondParams): Promise<void> {
    this.sessionManager.ensureAttached(params.sessionId);
    await this.codexAdapter.respondToApproval(params.requestId, params.decision);
    this.sessionManager.resolveApproval(params.sessionId, params.requestId);
  }

  private async interruptTurn(params: TurnInterruptRequestParams): Promise<void> {
    const turnId = this.sessionManager.requireActiveTurn(
      params.sessionId,
      params.turnId,
    );
    await this.codexAdapter.interruptTurn(params.sessionId, turnId);
  }

  private forwardCodexMessage(message: unknown, fromServerRequest: boolean): void {
    const sessionId =
      resolveSessionId(message) ?? this.sessionManager.getAttachedSessionId();
    if (!sessionId || this.sessionManager.getAttachedSessionId() !== sessionId) {
      return;
    }

    const record = asRecord(message);
    const method = typeof record?.method === "string" ? record.method : null;
    const params = asRecord(record?.params);

    if (method === "turn/started") {
      const turn = asRecord(params?.turn);
      const turnId = readString(turn ?? {}, "id") ?? readString(params ?? {}, "turnId");
      if (turnId) {
        this.sessionManager.markTurnStarted(sessionId, turnId);
      }
    }

    if (method === "turn/completed") {
      const turn = asRecord(params?.turn);
      const turnId = readString(turn ?? {}, "id") ?? readString(params ?? {}, "turnId");
      this.sessionManager.markTurnCompleted(sessionId, turnId);
    }

    if (fromServerRequest) {
      const requestId = record?.id;
      if (typeof requestId === "string" || typeof requestId === "number") {
        this.sessionManager.rememberApproval(sessionId, requestId);
      }
    }

    const event = normalizeCodexServerEvent({
      sessionId,
      cursor: this.sessionManager.nextCursor(sessionId),
      message,
    });
    if (!event) return;

    if (event.kind === "session.ended") {
      this.notifySessionEnded(sessionId, event.reason, event.cursor);
      return;
    }

    this.emitSessionEvent(event);
  }

  private emitSessionEvent(event: LiveSessionEvent): void {
    this.relayConnection.send(
      createNotification("session.event", {
        sessionId: event.sessionId,
        event,
      }),
    );
  }

  private notifySessionEnded(
    sessionId: string,
    reason: string,
    cursor = this.sessionManager.nextCursor(sessionId),
  ): void {
    this.sessionManager.markSessionEnded(sessionId);
    this.relayConnection.send(
      createNotification("session.ended", {
        sessionId,
        cursor,
        reason,
      }),
    );
  }
}

export function createBridgeDaemon(options: BridgeDaemonOptions): BridgeDaemon {
  return new BridgeDaemon(options);
}

export { RelayConnection };
