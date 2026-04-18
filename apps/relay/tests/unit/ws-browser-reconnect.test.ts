import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";

const relayDbMocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(async () => undefined),
  findDeviceSessionForPrincipal: vi.fn(),
  upsertBridgeLease: vi.fn(async () => undefined),
  refreshBridgeLease: vi.fn(async () => undefined),
  markBridgeLeaseDisconnected: vi.fn(async () => undefined),
  findActiveBridgeLeaseForUser: vi.fn(),
  findActiveBridgeLeaseForSession: vi.fn(),
  getRelayLeaseCountsForMachine: vi.fn(async () => ({
    activeLeaseCount: 0,
    staleLeaseCount: 0,
  })),
  setAttachedSessionOnLease: vi.fn(async () => undefined),
}));

vi.mock("@codex-mobile/db", () => ({
  appendAuditEvent: relayDbMocks.appendAuditEvent,
  findDeviceSessionForPrincipal: relayDbMocks.findDeviceSessionForPrincipal,
  upsertBridgeLease: relayDbMocks.upsertBridgeLease,
  refreshBridgeLease: relayDbMocks.refreshBridgeLease,
  markBridgeLeaseDisconnected: relayDbMocks.markBridgeLeaseDisconnected,
  findActiveBridgeLeaseForUser: relayDbMocks.findActiveBridgeLeaseForUser,
  findActiveBridgeLeaseForSession: relayDbMocks.findActiveBridgeLeaseForSession,
  getRelayLeaseCountsForMachine: relayDbMocks.getRelayLeaseCountsForMachine,
  setAttachedSessionOnLease: relayDbMocks.setAttachedSessionOnLease,
}));

import { browserRegistry } from "../../src/browser/browser-registry.js";
import { sessionRouter } from "../../src/browser/session-router.js";
import { bridgeRegistry } from "../../src/bridge/bridge-registry.js";
import {
  handleRelayOps,
  resetRelayOpsState,
} from "../../src/routes/ops.js";
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

function createLease(userId: string, sessionId: string | null = null) {
  return {
    id: `${userId}-lease`,
    userId,
    deviceSessionId: "device-alpha",
    bridgeInstanceId: "bridge-alpha",
    relayMachineId: "local-dev-machine",
    relayRegion: "local",
    attachedSessionId: sessionId,
    leaseVersion: 1,
    connectedAt: new Date("2026-04-18T07:30:00.000Z"),
    lastHeartbeatAt: new Date("2026-04-18T07:30:00.000Z"),
    expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    disconnectedAt: null,
    replacedByLeaseId: null,
  };
}

describe("relay ws-browser reconnect safety", () => {
  beforeEach(() => {
    process.env.WS_TICKET_SECRET = WS_TICKET_SECRET;
    browserRegistry.clear();
    bridgeRegistry.clear();
    sessionRouter.clear();
    resetRelayOpsState();
    relayDbMocks.appendAuditEvent.mockClear();
    relayDbMocks.findDeviceSessionForPrincipal.mockResolvedValue({
      id: "device-alpha",
      userId: "user-alpha",
      cookieTokenHash: "hash-alpha",
      revokedAt: null,
      expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    });
    relayDbMocks.upsertBridgeLease.mockClear();
    relayDbMocks.refreshBridgeLease.mockClear();
    relayDbMocks.markBridgeLeaseDisconnected.mockClear();
    relayDbMocks.findActiveBridgeLeaseForUser.mockReset();
    relayDbMocks.findActiveBridgeLeaseForSession.mockReset();
    relayDbMocks.getRelayLeaseCountsForMachine.mockClear();
    relayDbMocks.setAttachedSessionOnLease.mockClear();
    relayDbMocks.findActiveBridgeLeaseForUser.mockResolvedValue(
      createLease("user-alpha"),
    );
    relayDbMocks.findActiveBridgeLeaseForSession.mockResolvedValue(
      createLease("user-alpha", "session-alpha"),
    );
  });

  afterEach(() => {
    browserRegistry.clear();
    bridgeRegistry.clear();
    sessionRouter.clear();
    resetRelayOpsState();
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
      const ops = await handleRelayOps({
        getRelayLeaseCountsForMachine: async () => ({
          activeLeaseCount: 1,
          staleLeaseCount: 0,
        }),
      });

      expect(ended.reason).toBe("bridge_unavailable");
      expect(closed.code).toBe(1011);
      expect(closed.reason).toBe("bridge_unavailable");
      expect(ops.recentDisconnectReasons[0]).toBe("bridge_unavailable");
    } finally {
      await app.close();
    }
  });

  it("surfaces backpressure disconnect reasons in relay ops state", async () => {
    function send(
      _message: string,
      _callback: (error?: Error) => void,
    ): void {
      // Intentionally never resolve the callback so pending queue pressure accumulates.
    }

    const slowSocket = {
      OPEN: 1,
      readyState: 1,
      send,
      close: vi.fn(),
    } as never;

    browserRegistry.register({
      userId: "user-alpha",
      deviceSessionId: "device-alpha",
      sessionId: "session-alpha",
      socket: slowSocket,
      connectedAt: new Date("2026-04-18T12:00:00.000Z"),
    });

    for (let index = 0; index < 51; index += 1) {
      browserRegistry.broadcast(
        "session-alpha",
        JSON.stringify({ kind: "activity.appended", cursor: index }),
        { priority: "important" },
      );
    }

    for (let index = 0; index < 26; index += 1) {
      browserRegistry.broadcast(
        "session-alpha",
        JSON.stringify({ kind: "session.history", cursor: index }),
        { priority: "best_effort" },
      );
    }

    const ops = await handleRelayOps({
      getRelayLeaseCountsForMachine: async () => ({
        activeLeaseCount: 1,
        staleLeaseCount: 0,
      }),
    });

    expect(slowSocket.close).toHaveBeenCalledWith(1013, "backpressure");
    expect(ops.recentDisconnectReasons[0]).toBe("backpressure");
  });
});
