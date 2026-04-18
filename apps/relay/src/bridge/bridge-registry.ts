import type { WebSocket } from "ws";

export interface BridgeEntry {
  userId: string;
  deviceSessionId: string;
  bridgeInstanceId: string;
  socket: WebSocket;
  connectedAt: Date;
}

export class BridgeRegistry {
  private bridges = new Map<string, BridgeEntry>();

  register(entry: BridgeEntry): void {
    // Close existing bridge for same user if any (D-12: one at a time)
    const existing = this.bridges.get(entry.userId);
    if (existing && existing.socket.readyState === existing.socket.OPEN) {
      existing.socket.close(1000, "replaced by new bridge connection");
    }
    this.bridges.set(entry.userId, entry);
  }

  unregister(userId: string): void {
    this.bridges.delete(userId);
  }

  get(userId: string): BridgeEntry | undefined {
    return this.bridges.get(userId);
  }

  has(userId: string): boolean {
    return this.bridges.has(userId);
  }

  /** Send a JSON-RPC message to a specific bridge by userId */
  sendTo(userId: string, message: object): boolean {
    const entry = this.bridges.get(userId);
    if (!entry || entry.socket.readyState !== entry.socket.OPEN) return false;
    entry.socket.send(JSON.stringify(message));
    return true;
  }

  get size(): number {
    return this.bridges.size;
  }
}
