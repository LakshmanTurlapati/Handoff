import { appendAuditEvent } from "@codex-mobile/db";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  AUDIT_EVENT_TYPES,
  JsonRpcMessageSchema,
  SessionEndedParamsSchema,
  SessionEventParamsSchema,
  SessionHistoryParamsSchema,
  SessionListResultSchema,
  type SessionMetadata,
} from "@codex-mobile/protocol";
import {
  LiveActivitySchema,
  SessionCommandSchema,
  type BrowserSessionListItem,
  type LiveSessionEvent,
  type LiveSessionEndedReason,
  type SessionCommand,
} from "@codex-mobile/protocol/live-session";
import type { BridgeRegistry } from "../bridge/bridge-registry.js";
import { bridgeRegistry } from "../bridge/bridge-registry.js";
import type { BrowserRegistry } from "./browser-registry.js";
import { browserRegistry } from "./browser-registry.js";
import type {
  BrowserEventPriority,
  BrowserRegistrySnapshot,
} from "./browser-registry.js";
import type { SessionBuffer } from "./session-buffer.js";
import { sessionBuffer } from "./session-buffer.js";
import {
  ownershipService,
  type OwnershipService,
} from "../ownership/ownership-service.js";

const BRIDGE_REQUEST_TIMEOUT_MS = 3_000;

interface PendingBridgeRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  schema: z.ZodType<unknown>;
  timeout: ReturnType<typeof setTimeout>;
}

export interface AttachBrowserInput {
  userId: string;
  deviceSessionId: string;
  sessionId: string;
  socket: WebSocket;
  cursor?: number | null;
}

interface SessionRouterDependencies {
  bridgeRegistry?: BridgeRegistry;
  browserRegistry?: BrowserRegistry;
  sessionBuffer?: SessionBuffer;
  ownershipService?: OwnershipService;
}

export class SessionRouter {
  private readonly bridgeRegistry: BridgeRegistry;
  private readonly browserRegistry: BrowserRegistry;
  private readonly sessionBuffer: SessionBuffer;
  private readonly ownershipService: OwnershipService;
  private readonly pending = new Map<string, PendingBridgeRequest>();
  private requestSequence = 0;

  constructor(dependencies: SessionRouterDependencies = {}) {
    this.bridgeRegistry = dependencies.bridgeRegistry ?? bridgeRegistry;
    this.browserRegistry = dependencies.browserRegistry ?? browserRegistry;
    this.sessionBuffer = dependencies.sessionBuffer ?? sessionBuffer;
    this.ownershipService = dependencies.ownershipService ?? ownershipService;
  }

  async attachBrowser(input: AttachBrowserInput): Promise<string> {
    const browserId = this.browserRegistry.register({
      userId: input.userId,
      deviceSessionId: input.deviceSessionId,
      sessionId: input.sessionId,
      socket: input.socket,
      connectedAt: new Date(),
    });

    const buffered = this.sessionBuffer.getSince(input.sessionId, input.cursor);
    for (const event of buffered) {
      this.sendEventToSocket(input.socket, event);
    }

    if (input.cursor != null && buffered.length > 0) {
      const reconnectEvent = this.buildReconnectEvent(input.sessionId, buffered);
      this.sendEventToSocket(
        input.socket,
        reconnectEvent,
      );
      await this.appendAuditSafely({
        userId: input.userId,
        eventType: AUDIT_EVENT_TYPES.sessionReconnected,
        subject: input.sessionId,
        outcome: "success",
        metadata: {
          sessionId: input.sessionId,
          deviceSessionId: input.deviceSessionId,
          cursor: reconnectEvent.cursor,
        },
      });
    }

    const attached = this.dispatchBridgeRequest(input.userId, "session.attach", {
      sessionId: input.sessionId,
    });

    if (!attached) {
      this.sendEventToSocket(
        input.socket,
        this.buildErrorEvent(
          input.sessionId,
          "bridge_not_ready",
          "The relay could not reach the owning bridge for this session.",
        ),
      );
    } else {
      await this.recordAttachedSessionSafely(input.userId, input.sessionId);
    }

    return browserId;
  }

  async listSessionsForUser(userId: string): Promise<BrowserSessionListItem[]> {
    if (!this.bridgeRegistry.has(userId)) {
      return [];
    }

    try {
      const result = await this.requestBridge(
        userId,
        "session.list",
        undefined,
        SessionListResultSchema,
      );

      return result.sessions.map((session) => this.mapSessionMetadata(session));
    } catch {
      return [];
    }
  }

  async handleBrowserMessage(
    userId: string,
    sessionId: string,
    rawMessage: string,
    socket: WebSocket,
  ): Promise<void> {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawMessage);
    } catch {
      this.sendEventToSocket(
        socket,
        this.buildErrorEvent(
          sessionId,
          "invalid_json",
          "Browser command payload was not valid JSON.",
        ),
      );
      return;
    }

    const command = SessionCommandSchema.safeParse(parsedJson);
    if (!command.success) {
      this.sendEventToSocket(
        socket,
        this.buildErrorEvent(
          sessionId,
          "invalid_command",
          "Browser command payload failed validation.",
        ),
      );
      return;
    }

    const accepted = this.forwardCommand(userId, sessionId, command.data);
    if (!accepted) {
      this.sendEventToSocket(
        socket,
        this.buildErrorEvent(
          sessionId,
          "bridge_not_ready",
          "The relay could not forward the session command to the bridge.",
        ),
      );
    }
  }

  forwardCommand(
    userId: string,
    sessionId: string,
    command: SessionCommand,
  ): boolean {
    switch (command.kind) {
      case "prompt":
        return this.dispatchBridgeRequest(userId, "turn.send", {
          sessionId,
          userMessage: command.text,
        });
      case "steer":
        return this.dispatchBridgeRequest(userId, "turn.steer", {
          sessionId,
          userMessage: command.text,
          targetTurnId: command.targetTurnId,
          mode: command.mode,
        });
      case "approval":
        return this.dispatchBridgeRequest(userId, "approval.respond", {
          sessionId,
          requestId: command.requestId,
          decision: command.decision,
        });
      case "interrupt":
        return this.dispatchBridgeRequest(userId, "turn.interrupt", {
          sessionId,
          turnId: command.turnId,
          reason: command.reason,
          clientRequestId: command.clientRequestId,
        });
      default:
        return false;
    }
  }

  async handleBridgeMessage(userId: string, rawMessage: string): Promise<void> {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const message = JsonRpcMessageSchema.safeParse(parsedJson);
    if (!message.success) {
      return;
    }

    const data = message.data;
    if ("id" in data && ("result" in data || "error" in data)) {
      this.handleBridgeResponse(data);
      return;
    }

    if (!("method" in data)) {
      return;
    }

    switch (data.method) {
      case "session.history": {
        const params = SessionHistoryParamsSchema.safeParse(data.params);
        if (!params.success) return;

        const event: LiveSessionEvent = {
          kind: "session.history",
          sessionId: params.data.sessionId,
          cursor: params.data.cursor,
          occurredAt: new Date().toISOString(),
          replayed: params.data.replayed,
          turns: params.data.turns,
        };

        this.publishEvent(event);
        return;
      }

      case "session.event": {
        const params = SessionEventParamsSchema.safeParse(data.params);
        if (!params.success) return;
        if (params.data.event.sessionId !== params.data.sessionId) return;

        if (
          params.data.event.kind === "activity.appended" &&
          params.data.event.activity.kind === "approval"
        ) {
          await this.appendAuditSafely({
            userId,
            eventType: AUDIT_EVENT_TYPES.approvalRequested,
            subject: String(params.data.event.activity.requestId),
            outcome: "success",
            metadata: {
              sessionId: params.data.sessionId,
              requestId: String(params.data.event.activity.requestId),
              turnId: params.data.event.activity.turnId,
            },
          });
        }

        this.publishEvent(params.data.event);
        return;
      }

      case "session.ended": {
        const params = SessionEndedParamsSchema.safeParse(data.params);
        if (!params.success) return;

        const event = this.buildEndedEvent(
          params.data.sessionId,
          params.data.reason,
          params.data.cursor,
        );

        await this.clearAttachedSessionSafely(userId, event.sessionId);
        await this.appendDisconnectAudits(event);
        this.publishEvent(event);
        this.closeSessionBrowsers(event.sessionId, event.reason);
        return;
      }

      default:
        return;
    }
  }

  clear(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
    }
    this.pending.clear();
    this.browserRegistry.clear();
    this.sessionBuffer.clear();
  }

  unregisterBrowser(browserId: string): void {
    this.browserRegistry.unregister(browserId);
  }

  getBrowserSnapshot(): BrowserRegistrySnapshot {
    const snapshot = this.browserRegistry.getSnapshot();
    return {
      activeBrowserCount: snapshot.activeBrowserCount,
      queuePressureCount: snapshot.queuePressureCount,
      backpressuredSockets: snapshot.backpressuredSockets,
      droppedBestEffortMessages: snapshot.droppedBestEffortMessages,
      recentDisconnectReasons: snapshot.recentDisconnectReasons,
    };
  }

  revokeDeviceSession(userId: string, deviceSessionId: string): number {
    const matchingBrowserCount =
      this.browserRegistry.countByDeviceSessionId(deviceSessionId);
    if (matchingBrowserCount === 0) {
      return 0;
    }

    return this.browserRegistry.closeByDeviceSessionId(deviceSessionId, {
      code: 1008,
      reason: "device_session_revoked",
      predicate: (entry) => entry.userId === userId,
      beforeClose: (entry) => {
        this.sendEventToSocket(
          entry.socket,
          this.buildEndedEvent(entry.sessionId, "device_session_revoked"),
        );
      },
    });
  }

  async handleBridgeUnavailable(userId: string): Promise<number> {
    const entries = this.browserRegistry.listByUserId(userId);
    if (entries.length === 0) {
      return 0;
    }

    const seenSessions = new Set<string>();
    for (const entry of entries) {
      if (seenSessions.has(entry.sessionId)) {
        continue;
      }

      seenSessions.add(entry.sessionId);
      await this.clearAttachedSessionSafely(userId, entry.sessionId);
      const event = this.buildEndedEvent(entry.sessionId, "bridge_unavailable");
      await this.appendDisconnectAudits(event);
      this.publishEvent(event);
    }

    return this.browserRegistry.closeByUserId(userId, {
      code: 1011,
      reason: "bridge_unavailable",
    });
  }

  private publishEvent(event: LiveSessionEvent): void {
    this.sessionBuffer.append(event);
    this.browserRegistry.broadcast(event.sessionId, JSON.stringify(event), {
      priority: this.getEventPriority(event),
    });
  }

  private closeSessionBrowsers(
    sessionId: string,
    reason: LiveSessionEndedReason,
  ): number {
    return this.browserRegistry.closeBySessionId(sessionId, {
      code: reason === "bridge_unavailable" ? 1011 : 1000,
      reason,
    });
  }

  private async appendDisconnectAudits(event: LiveSessionEvent): Promise<void> {
    if (event.kind !== "session.ended") {
      return;
    }

    const entries = this.browserRegistry.listBySessionId(event.sessionId);
    const seenDeviceSessions = new Set<string>();
    for (const entry of entries) {
      if (seenDeviceSessions.has(entry.deviceSessionId)) {
        continue;
      }
      seenDeviceSessions.add(entry.deviceSessionId);

      await this.appendAuditSafely({
        userId: entry.userId,
        eventType: AUDIT_EVENT_TYPES.sessionDisconnected,
        subject: event.sessionId,
        outcome: "success",
        metadata: {
          sessionId: event.sessionId,
          deviceSessionId: entry.deviceSessionId,
          reason: event.reason,
          cursor: event.cursor,
        },
      });
    }
  }

  private async appendAuditSafely(input: {
    userId?: string | null;
    eventType: string;
    subject?: string | null;
    outcome: "success" | "failure";
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await appendAuditEvent(input);
    } catch (error) {
      console.error("session router audit append failed", error);
    }
  }

  private async recordAttachedSessionSafely(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.ownershipService.recordAttachedSession({ userId, sessionId });
    } catch (error) {
      console.error("session router attach record failed", error);
    }
  }

  private async clearAttachedSessionSafely(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.ownershipService.clearAttachedSession({ userId, sessionId });
    } catch (error) {
      console.error("session router attach clear failed", error);
    }
  }

  private handleBridgeResponse(
    message: z.infer<typeof JsonRpcMessageSchema>,
  ): void {
    if (!("id" in message) || (!("result" in message) && !("error" in message))) {
      return;
    }

    const pending = this.pending.get(String(message.id));
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(String(message.id));

    if ("error" in message && message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    const parsed = pending.schema.safeParse(message.result);
    if (!parsed.success) {
      pending.reject(new Error("bridge_result_invalid"));
      return;
    }

    pending.resolve(parsed.data);
  }

  private async requestBridge<T>(
    userId: string,
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const id = this.nextRequestId();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}_timeout`));
      }, BRIDGE_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        schema,
        timeout,
      });

      const sent = this.bridgeRegistry.sendTo(userId, {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error("bridge_not_ready"));
      }
    });
  }

  private dispatchBridgeRequest(
    userId: string,
    method: string,
    params: unknown,
  ): boolean {
    return this.bridgeRegistry.sendTo(userId, {
      jsonrpc: "2.0",
      id: this.nextRequestId(),
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `relay-${Date.now()}-${this.requestSequence}`;
  }

  private mapSessionMetadata(session: SessionMetadata): BrowserSessionListItem {
    const updatedAt = session.startedAt ?? new Date().toISOString();
    return {
      sessionId: session.sessionId,
      title: session.threadTitle ?? `Session ${session.sessionId}`,
      model: session.model,
      status:
        session.status === "active"
          ? "Live"
          : session.status === "notLoaded"
            ? "Waiting for bridge"
            : "Ready to resume",
      turnCount: session.turnCount,
      updatedAt,
      updatedLabel: this.formatUpdatedLabel(updatedAt),
    };
  }

  private formatUpdatedLabel(updatedAt: string): string {
    const deltaMs = Math.max(0, Date.now() - Date.parse(updatedAt));
    const deltaMinutes = Math.floor(deltaMs / 60_000);

    if (deltaMinutes <= 0) return "just now";
    if (deltaMinutes === 1) return "1 min ago";
    if (deltaMinutes < 60) return `${deltaMinutes} min ago`;

    const deltaHours = Math.floor(deltaMinutes / 60);
    if (deltaHours === 1) return "1 hour ago";
    return `${deltaHours} hours ago`;
  }

  private buildReconnectEvent(
    sessionId: string,
    bufferedEvents: LiveSessionEvent[],
  ): LiveSessionEvent {
    const occurredAt = new Date().toISOString();
    const lastEvent = bufferedEvents[bufferedEvents.length - 1];
    const turnId = this.resolveReconnectTurnId(sessionId, bufferedEvents);
    const reconnectActivity = LiveActivitySchema.parse({
      kind: "system",
      activityId: `${sessionId}-reconnected-${Date.now()}`,
      turnId,
      title: "Reconnected",
      preview: "Backfilled missed live activity after reconnect.",
      detail: "The relay replayed buffered session events after the browser rejoined the live stream.",
      status: "completed",
      createdAt: occurredAt,
    });

    return {
      kind: "session.reconnected",
      sessionId,
      cursor: lastEvent?.cursor ?? this.sessionBuffer.getLatestCursor(sessionId),
      occurredAt,
      activity: reconnectActivity,
    };
  }

  private buildEndedEvent(
    sessionId: string,
    reason: LiveSessionEndedReason,
    cursor = this.sessionBuffer.getLatestCursor(sessionId),
  ): Extract<LiveSessionEvent, { kind: "session.ended" }> {
    return {
      kind: "session.ended",
      sessionId,
      cursor,
      occurredAt: new Date().toISOString(),
      reason,
    };
  }

  private resolveReconnectTurnId(
    sessionId: string,
    bufferedEvents: LiveSessionEvent[],
  ): string {
    for (let index = bufferedEvents.length - 1; index >= 0; index -= 1) {
      const event = bufferedEvents[index];
      if (!event) continue;

      if (event.kind === "activity.appended") {
        return event.activity.turnId;
      }

      if (event.kind === "session.history") {
        const liveTurn = [...event.turns].reverse().find((turn) => turn.isLive);
        if (liveTurn) return liveTurn.turnId;
      }
    }

    return `${sessionId}-reconnect`;
  }

  private buildErrorEvent(
    sessionId: string,
    code: string,
    message: string,
  ): LiveSessionEvent {
    return {
      kind: "session.error",
      sessionId,
      cursor: this.sessionBuffer.getLatestCursor(sessionId),
      occurredAt: new Date().toISOString(),
      code,
      message,
    };
  }

  private sendEventToSocket(socket: WebSocket, event: LiveSessionEvent): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(event));
  }

  private getEventPriority(event: LiveSessionEvent): BrowserEventPriority {
    if (event.kind === "session.ended" || event.kind === "session.error") {
      return "critical";
    }

    if (
      event.kind === "activity.appended" &&
      event.activity.kind === "approval"
    ) {
      return "critical";
    }

    if (
      event.kind === "session.reconnected" ||
      event.kind === "interrupt.finished"
    ) {
      return "important";
    }

    return "best_effort";
  }
}

export const sessionRouter = new SessionRouter();
