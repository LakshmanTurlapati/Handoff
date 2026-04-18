import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayConnectionMocks = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static instances: MockWebSocket[] = [];

    readonly sent: string[] = [];
    readyState = 0;
    private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

    constructor(
      public readonly url: string,
      public readonly options: { headers?: Record<string, string> },
    ) {
      MockWebSocket.instances.push(this);
    }

    on(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (...args: any[]) => void): this {
      const wrapped = (...args: any[]) => {
        this.off(event, wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    off(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event);
      if (!listeners) {
        return this;
      }
      this.listeners.set(
        event,
        listeners.filter((candidate) => candidate !== listener),
      );
      return this;
    }

    emit(event: string, ...args: any[]): boolean {
      const listeners = this.listeners.get(event);
      if (!listeners || listeners.length === 0) {
        return false;
      }
      for (const listener of [...listeners]) {
        listener(...args);
      }
      return true;
    }

    send(payload: string): void {
      this.sent.push(payload);
    }

    close(code = 1000, reason = ""): void {
      this.readyState = 3;
      this.emit("close", code, Buffer.from(reason));
    }
  }

  return {
    MockWebSocket,
    mintWsTicket: vi.fn(),
  };
});

vi.mock("ws", () => ({
  default: relayConnectionMocks.MockWebSocket,
}));

vi.mock("@codex-mobile/auth/ws-ticket", () => ({
  mintWsTicket: relayConnectionMocks.mintWsTicket,
}));

import { RelayConnection } from "../../src/daemon/relay-connection.js";

describe("RelayConnection reconnect identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    relayConnectionMocks.MockWebSocket.instances.length = 0;
    relayConnectionMocks.mintWsTicket.mockReset();
    relayConnectionMocks.mintWsTicket
      .mockResolvedValueOnce({ ticket: "ticket-1" })
      .mockResolvedValueOnce({ ticket: "ticket-2" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-sends bridge.register with the same bridgeInstanceId after reconnect", async () => {
    const connection = new RelayConnection({
      relayUrl: "ws://relay.example.test",
      secret: new Uint8Array([1, 2, 3]),
      userId: "user-1",
      deviceSessionId: "device-1",
      bridgeInstanceId: "bridge-stable",
      initialReconnectDelay: 1000,
      maxReconnectDelay: 1000,
    });

    await connection.connect();

    const firstSocket = relayConnectionMocks.MockWebSocket.instances[0];
    expect(firstSocket).toBeTruthy();
    firstSocket.readyState = relayConnectionMocks.MockWebSocket.OPEN;
    firstSocket.emit("open");

    expect(JSON.parse(firstSocket.sent[0] ?? "{}")).toMatchObject({
      method: "bridge.register",
      params: {
        bridgeInstanceId: "bridge-stable",
      },
    });

    firstSocket.emit("close", 1006, Buffer.from("network"));
    await vi.advanceTimersByTimeAsync(1000);

    const secondSocket = relayConnectionMocks.MockWebSocket.instances[1];
    expect(secondSocket).toBeTruthy();
    secondSocket.readyState = relayConnectionMocks.MockWebSocket.OPEN;
    secondSocket.emit("open");

    expect(JSON.parse(secondSocket.sent[0] ?? "{}")).toMatchObject({
      method: "bridge.register",
      params: {
        bridgeInstanceId: "bridge-stable",
      },
    });
    expect(relayConnectionMocks.mintWsTicket).toHaveBeenCalledTimes(2);

    connection.disconnect();
  });
});
