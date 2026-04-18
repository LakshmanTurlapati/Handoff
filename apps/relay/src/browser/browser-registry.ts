import type { WebSocket } from "ws";

export interface BrowserEntry {
  id: string;
  userId: string;
  deviceSessionId: string;
  sessionId: string;
  socket: WebSocket;
  connectedAt: Date;
}

export class BrowserRegistry {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly idsBySession = new Map<string, Set<string>>();
  private readonly idsByDeviceSession = new Map<string, Set<string>>();

  register(entry: Omit<BrowserEntry, "id">): string {
    const id = crypto.randomUUID();
    const record: BrowserEntry = { id, ...entry };
    this.entries.set(id, record);

    const sessionIds = this.idsBySession.get(record.sessionId) ?? new Set<string>();
    sessionIds.add(id);
    this.idsBySession.set(record.sessionId, sessionIds);

    const deviceSessionIds =
      this.idsByDeviceSession.get(record.deviceSessionId) ?? new Set<string>();
    deviceSessionIds.add(id);
    this.idsByDeviceSession.set(record.deviceSessionId, deviceSessionIds);

    return id;
  }

  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    this.entries.delete(id);

    const sessionIds = this.idsBySession.get(entry.sessionId);
    if (!sessionIds) return;

    sessionIds.delete(id);
    if (sessionIds.size === 0) {
      this.idsBySession.delete(entry.sessionId);
    }

    const deviceSessionIds = this.idsByDeviceSession.get(entry.deviceSessionId);
    if (!deviceSessionIds) return;

    deviceSessionIds.delete(id);
    if (deviceSessionIds.size === 0) {
      this.idsByDeviceSession.delete(entry.deviceSessionId);
    }
  }

  broadcast(sessionId: string, message: string): number {
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

      try {
        entry.socket.send(message);
        delivered += 1;
      } catch {
        this.unregister(id);
      }
    }

    return delivered;
  }

  clear(): void {
    this.entries.clear();
    this.idsBySession.clear();
    this.idsByDeviceSession.clear();
  }

  countByDeviceSessionId(deviceSessionId: string): number {
    const deviceSessionIds = this.idsByDeviceSession.get(deviceSessionId);
    return deviceSessionIds?.size ?? 0;
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

    let closed = 0;

    for (const id of [...deviceSessionIds]) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (options.predicate && !options.predicate(entry)) continue;

      try {
        options.beforeClose?.(entry);
      } catch {
        // Closing the socket still takes priority over the pre-close hook.
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
}

export const browserRegistry = new BrowserRegistry();
