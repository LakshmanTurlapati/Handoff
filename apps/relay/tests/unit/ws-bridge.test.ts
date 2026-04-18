import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";
import { sessionRouter } from "../../src/browser/session-router.js";
import { bridgeRegistry } from "../../src/bridge/bridge-registry.js";
import { buildRelayServer } from "../../src/server.js";

const WS_TICKET_SECRET = "relay-bridge-test-secret-with-32-bytes";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function mintTicket(userId: string, deviceSessionId: string): Promise<string> {
  const minted = await mintWsTicket({
    userId,
    deviceSessionId,
    secret: new TextEncoder().encode(WS_TICKET_SECRET),
  });

  return minted.ticket;
}

async function openBridgeSocket(url: string, ticket: string): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    headers: {
      authorization: `Bearer ${ticket}`,
    },
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  return socket;
}

describe("relay ws-bridge route", () => {
  beforeEach(() => {
    process.env.WS_TICKET_SECRET = WS_TICKET_SECRET;
    bridgeRegistry.clear();
    sessionRouter.clear();
  });

  afterEach(() => {
    bridgeRegistry.clear();
    sessionRouter.clear();
  });

  it("registers authenticated bridges and forwards richer session traffic to the router", async () => {
    const routerSpy = vi.spyOn(sessionRouter, "handleBridgeMessage");
    const app = await buildRelayServer();

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const url = `ws://127.0.0.1:${address.port}/ws/bridge`;
      const ticket = await mintTicket("user-bridge", "device-bridge");
      const socket = await openBridgeSocket(url, ticket);

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "bridge.register",
          params: {
            bridgeVersion: "0.1.0",
            bridgeInstanceId: "bridge-alpha",
          },
        }),
      );
      await flush();

      expect(bridgeRegistry.get("user-bridge")?.bridgeInstanceId).toBe(
        "bridge-alpha",
      );

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session.ended",
          params: {
            sessionId: "thr_alpha",
            cursor: 3,
            reason: "codex_process_exited",
          },
        }),
      );
      await flush();

      expect(routerSpy).toHaveBeenCalledWith(
        "user-bridge",
        expect.stringContaining('"method":"session.ended"'),
      );

      socket.close();
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
      });
      await flush();
      expect(bridgeRegistry.has("user-bridge")).toBe(false);
    } finally {
      routerSpy.mockRestore();
      await app.close();
    }
  });
});
