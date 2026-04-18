import type { WebSocket } from "ws";

export const MAX_PENDING_BROWSER_MESSAGES = 50;
export const PRESSURE_WARNING_THRESHOLD = 40;
export const MAX_BEST_EFFORT_DROPS = 25;

export type BrowserEventPriority = "critical" | "important" | "best_effort";

export interface BrowserEntry {
  id: string;
  userId: string;
  deviceSessionId: string;
  sessionId: string;
  socket: WebSocket;
  connectedAt: Date;
  pendingMessages: number;
  droppedBestEffortMessages: number;
  lastDisconnectReason: string | null;
}

export interface BrowserRegistrySnapshot {
  activeBrowserCount: number;
  queuePressureCount: number;
  backpressuredSockets: number;
  droppedBestEffortMessages: number;
  recentDisconnectReasons: string[];
}

export class BrowserRegistry {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly idsBySession = new Map<string, Set<string>>();
  private readonly idsByDeviceSession = new Map<string, Set<string>>();
  private readonly idsByUser = new Map<string, Set<string>>();
  private readonly backpressuredIds = new Set<string>();
  private queuePressureCount = 0;
  private droppedBestEffortMessages = 0;
  private recentDisconnectReasons: string[] = [];

  register(
    entry: Omit<
      BrowserEntry,
      "id" | "pendingMessages" | "droppedBestEffortMessages" | "lastDisconnectReason"
    >,
  ): string {
    const id = crypto.randomUUID();
    const record: BrowserEntry = {
      id,
      pendingMessages: 0,
      droppedBestEffortMessages: 0,
      lastDisconnectReason: null,
      ...entry,
    };
    this.entries.set(id, record);

    const sessionIds = this.idsBySession.get(record.sessionId) ?? new Set<string>();
    sessionIds.add(id);
    this.idsBySession.set(record.sessionId, sessionIds);

    const deviceSessionIds =
      this.idsByDeviceSession.get(record.deviceSessionId) ?? new Set<string>();
    deviceSessionIds.add(id);
    this.idsByDeviceSession.set(record.deviceSessionId, deviceSessionIds);

    const userIds = this.idsByUser.get(record.userId) ?? new Set<string>();
    userIds.add(id);
    this.idsByUser.set(record.userId, userIds);

    return id;
  }

  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    this.entries.delete(id);
    this.backpressuredIds.delete(id);

    const sessionIds = this.idsBySession.get(entry.sessionId);
    if (sessionIds) {
      sessionIds.delete(id);
      if (sessionIds.size === 0) {
        this.idsBySession.delete(entry.sessionId);
      }
    }

    const deviceSessionIds = this.idsByDeviceSession.get(entry.deviceSessionId);
    if (deviceSessionIds) {
      deviceSessionIds.delete(id);
      if (deviceSessionIds.size === 0) {
        this.idsByDeviceSession.delete(entry.deviceSessionId);
      }
    }

    const userIds = this.idsByUser.get(entry.userId);
    if (userIds) {
      userIds.delete(id);
      if (userIds.size === 0) {
        this.idsByUser.delete(entry.userId);
      }
    }
  }

  broadcast(
    sessionId: string,
    message: string,
    options: {
      priority?: BrowserEventPriority;
    } = {},
  ): number {
    const sessionIds = this.idsBySession.get(sessionId);
    if (!sessionIds) return 0;

    let delivered = 0;
    for (const id of [...sessionIds]) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      if (entry.socket.readyState !== entry.socket.OPEN) {
        this.unregister(id);
        continue;
      }

      if (
        entry.pendingMessages > MAX_PENDING_BROWSER_MESSAGES &&
        entry.droppedBestEffortMessages >= MAX_BEST_EFFORT_DROPS
      ) {
        this.closeEntries([id], {
          code: 1013,
          reason: "backpressure",
        });
        continue;
      }

      if (
        entry.pendingMessages > MAX_PENDING_BROWSER_MESSAGES &&
        (options.priority ?? "important") === "best_effort"
      ) {
        entry.droppedBestEffortMessages += 1;
        this.droppedBestEffortMessages += 1;

        if (entry.droppedBestEffortMessages > MAX_BEST_EFFORT_DROPS) {
          this.closeEntries([id], {
            code: 1013,
            reason: "backpressure",
          });
        }
        continue;
      }

      try {
        entry.pendingMessages += 1;
        if (entry.pendingMessages >= PRESSURE_WARNING_THRESHOLD) {
          this.queuePressureCount += 1;
        }
        this.syncBackpressureState(entry);

        const completeSend = () => {
          entry.pendingMessages = Math.max(0, entry.pendingMessages - 1);
          this.syncBackpressureState(entry);
        };

        if (entry.socket.send.length >= 2) {
          (entry.socket.send as unknown as (
            payload: string,
            callback: (error?: Error) => void,
          ) => void)(message, (error?: Error) => {
            if (error) {
              this.unregister(id);
              return;
            }
            completeSend();
          });
        } else {
          entry.socket.send(message);
          queueMicrotask(completeSend);
        }
        delivered += 1;
      } catch {
        this.unregister(id);
      }
    }

    return delivered;
  }

  listBySessionId(sessionId: string): BrowserEntry[] {
    const sessionIds = this.idsBySession.get(sessionId);
    if (!sessionIds) return [];

    return this.listEntries(sessionIds);
  }

  listByUserId(userId: string): BrowserEntry[] {
    const userIds = this.idsByUser.get(userId);
    if (!userIds) return [];

    return this.listEntries(userIds);
  }

  clear(): void {
    this.entries.clear();
    this.idsBySession.clear();
    this.idsByDeviceSession.clear();
    this.idsByUser.clear();
    this.backpressuredIds.clear();
    this.queuePressureCount = 0;
    this.droppedBestEffortMessages = 0;
    this.recentDisconnectReasons = [];
  }

  countByDeviceSessionId(deviceSessionId: string): number {
    const deviceSessionIds = this.idsByDeviceSession.get(deviceSessionId);
    return deviceSessionIds?.size ?? 0;
  }

  closeBySessionId(
    sessionId: string,
    options: {
      code?: number;
      reason?: string;
      predicate?: (entry: BrowserEntry) => boolean;
      beforeClose?: (entry: BrowserEntry) => void;
    } = {},
  ): number {
    const sessionIds = this.idsBySession.get(sessionId);
    if (!sessionIds) return 0;

    return this.closeEntries(sessionIds, options);
  }

  closeByDeviceSessionId(
    deviceSessionId: string,
    options: {
      code?: number;
      reason?: string;
      predicate?: (entry: BrowserEntry) => boolean;
      beforeClose?: (entry: BrowserEntry) => void;
    } = {},
  ): number {
    const deviceSessionIds = this.idsByDeviceSession.get(deviceSessionId);
    if (!deviceSessionIds) return 0;

    return this.closeEntries(deviceSessionIds, options);
  }

  closeByUserId(
    userId: string,
    options: {
      code?: number;
      reason?: string;
      predicate?: (entry: BrowserEntry) => boolean;
      beforeClose?: (entry: BrowserEntry) => void;
    } = {},
  ): number {
    const userIds = this.idsByUser.get(userId);
    if (!userIds) return 0;

    return this.closeEntries(userIds, options);
  }

  getSnapshot(): BrowserRegistrySnapshot {
    return {
      activeBrowserCount: this.entries.size,
      queuePressureCount: this.queuePressureCount,
      backpressuredSockets: this.backpressuredIds.size,
      droppedBestEffortMessages: this.droppedBestEffortMessages,
      recentDisconnectReasons: [...this.recentDisconnectReasons],
    };
  }

  private listEntries(ids: Iterable<string>): BrowserEntry[] {
    const entries: BrowserEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  private closeEntries(
    ids: Iterable<string>,
    options: {
      code?: number;
      reason?: string;
      predicate?: (entry: BrowserEntry) => boolean;
      beforeClose?: (entry: BrowserEntry) => void;
    },
  ): number {
    let closed = 0;

    for (const id of [...ids]) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (options.predicate && !options.predicate(entry)) continue;

      try {
        options.beforeClose?.(entry);
      } catch {
        // Closing the socket still takes priority over the pre-close hook.
      }

      if (options.reason) {
        entry.lastDisconnectReason = options.reason;
        this.recordDisconnectReason(options.reason);
      }

      try {
        entry.socket.close(options.code ?? 1008, options.reason);
      } catch {
        // Ignore close transport errors and continue unregistering.
      }

      this.unregister(id);
      closed += 1;
    }

    return closed;
  }

  get size(): number {
    return this.entries.size;
  }

  private syncBackpressureState(entry: BrowserEntry): void {
    if (entry.pendingMessages > MAX_PENDING_BROWSER_MESSAGES) {
      this.backpressuredIds.add(entry.id);
      return;
    }

    this.backpressuredIds.delete(entry.id);
  }

  private recordDisconnectReason(reason: string): void {
    this.recentDisconnectReasons = [
      reason,
      ...this.recentDisconnectReasons.filter((entry) => entry !== reason),
    ].slice(0, 10);
  }
}

export const browserRegistry = new BrowserRegistry();
