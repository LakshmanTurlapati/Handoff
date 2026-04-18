import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";

const relayDbMocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(async () => undefined),
  findDeviceSessionForPrincipal: vi.fn(),
}));

vi.mock("@codex-mobile/db", () => ({
  appendAuditEvent: relayDbMocks.appendAuditEvent,
  findDeviceSessionForPrincipal: relayDbMocks.findDeviceSessionForPrincipal,
}));

import { sessionRouter } from "../../src/browser/session-router.js";
import { bridgeRegistry } from "../../src/bridge/bridge-registry.js";
import { buildRelayServer } from "../../src/server.js";

const BROWSER_PROTOCOL = "codex-mobile.live.v1";
const WS_TICKET_SECRET = "relay-browser-reconnect-test-secret";

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

async function openBrowserSocket(
  baseUrl: string,
  ticket: string,
  sessionId: string,
): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl}/ws/browser?sessionId=${sessionId}`, [
    BROWSER_PROTOCOL,
    ticket,
  ]);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  return socket;
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForSessionEnded(socket: WebSocket): Promise<{ reason: string }> {
  return new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.kind === "session.ended") {
          resolve({ reason: String(parsed.reason) });
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("relay ws-browser reconnect safety", () => {
  beforeEach(() => {
    process.env.WS_TICKET_SECRET = WS_TICKET_SECRET;
    bridgeRegistry.clear();
    sessionRouter.clear();
    relayDbMocks.appendAuditEvent.mockClear();
    relayDbMocks.findDeviceSessionForPrincipal.mockResolvedValue({
      id: "device-alpha",
      userId: "user-alpha",
      cookieTokenHash: "hash-alpha",
      revokedAt: null,
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    bridgeRegistry.clear();
    sessionRouter.clear();
  });

  it("rejects device_session_revoked during browser reconnect", async () => {
    relayDbMocks.findDeviceSessionForPrincipal.mockResolvedValueOnce({
      id: "device-alpha",
      userId: "user-alpha",
      cookieTokenHash: "hash-alpha",
      revokedAt: new Date("2026-04-18T12:00:00.000Z"),
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });

    const app = await buildRelayServer();

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const baseUrl = `ws://127.0.0.1:${address.port}`;
      const ticket = await mintTicket("user-alpha", "device-alpha");
      const socket = await openBrowserSocket(baseUrl, ticket, "session-alpha");

      const closed = await waitForClose(socket);
      expect(closed.code).toBe(1008);
      expect(closed.reason).toBe("device_session_revoked");
    } finally {
      await app.close();
    }
  });

  it("rejects device_session_expired during browser reconnect", async () => {
    relayDbMocks.findDeviceSessionForPrincipal.mockResolvedValueOnce({
      id: "device-alpha",
      userId: "user-alpha",
      cookieTokenHash: "hash-alpha",
      revokedAt: null,
      expiresAt: new Date("2026-04-17T12:00:00.000Z"),
    });

    const app = await buildRelayServer();

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const baseUrl = `ws://127.0.0.1:${address.port}`;
      const ticket = await mintTicket("user-alpha", "device-alpha");
      const socket = await openBrowserSocket(baseUrl, ticket, "session-alpha");

      const closed = await waitForClose(socket);
      expect(closed.code).toBe(1008);
      expect(closed.reason).toBe("device_session_expired");
    } finally {
      await app.close();
    }
  });

  it("fans bridge_unavailable to attached browsers before closing them", async () => {
    const app = await buildRelayServer();

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const wsBaseUrl = `ws://127.0.0.1:${address.port}`;

      const bridgeTicket = await mintTicket("user-alpha", "device-alpha");
      const browserTicket = await mintTicket("user-alpha", "device-alpha");
      const bridgeSocket = await openBridgeSocket(`${wsBaseUrl}/ws/bridge`, bridgeTicket);

      bridgeSocket.send(
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

      const browserSocket = await openBrowserSocket(
        wsBaseUrl,
        browserTicket,
        "session-alpha",
      );

      const endedPromise = waitForSessionEnded(browserSocket);
      const closePromise = waitForClose(browserSocket);

      bridgeSocket.close();

      const ended = await endedPromise;
      const closed = await closePromise;

      expect(ended.reason).toBe("bridge_unavailable");
      expect(closed.code).toBe(1011);
      expect(closed.reason).toBe("bridge_unavailable");
    } finally {
      await app.close();
    }
  });
});
