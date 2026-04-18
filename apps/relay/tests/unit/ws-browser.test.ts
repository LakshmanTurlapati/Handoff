import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";
import { SessionCommandResponseSchema } from "@codex-mobile/protocol/live-session";

const relayDbMocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(async () => undefined),
  findDeviceSessionForPrincipal: vi.fn(),
  upsertBridgeLease: vi.fn(async () => undefined),
  refreshBridgeLease: vi.fn(async () => undefined),
  markBridgeLeaseDisconnected: vi.fn(async () => undefined),
  findActiveBridgeLeaseForUser: vi.fn(),
  findActiveBridgeLeaseForSession: vi.fn(),
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
  setAttachedSessionOnLease: relayDbMocks.setAttachedSessionOnLease,
}));

import { sessionRouter } from "../../src/browser/session-router.js";
import { bridgeRegistry } from "../../src/bridge/bridge-registry.js";
import { buildRelayServer } from "../../src/server.js";

const WS_TICKET_SECRET = "relay-test-secret-with-at-least-32-bytes";

function createBridgeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as const;
}

async function mintTicket(userId: string, deviceSessionId: string): Promise<string> {
  const minted = await mintWsTicket({
    userId,
    deviceSessionId,
    secret: new TextEncoder().encode(WS_TICKET_SECRET),
  });

  return minted.ticket;
}

function createLease(userId: string, sessionId: string | null = null) {
  return {
    id: `${userId}-lease`,
    userId,
    deviceSessionId: `${userId}-device`,
    bridgeInstanceId: `${userId}-bridge`,
    relayMachineId: "local-dev-machine",
    relayRegion: "local",
    attachedSessionId: sessionId,
    leaseVersion: 1,
    connectedAt: new Date("2026-04-18T07:30:00.000Z"),
    lastHeartbeatAt: new Date("2026-04-18T07:30:00.000Z"),
    expiresAt: new Date("2026-04-25T07:31:30.000Z"),
    disconnectedAt: null,
    replacedByLeaseId: null,
  };
}

describe("relay ws-browser auth and routing", () => {
  beforeEach(() => {
    process.env.WS_TICKET_SECRET = WS_TICKET_SECRET;
    bridgeRegistry.clear();
    sessionRouter.clear();
    relayDbMocks.appendAuditEvent.mockClear();
    relayDbMocks.findDeviceSessionForPrincipal.mockReset();
    relayDbMocks.upsertBridgeLease.mockClear();
    relayDbMocks.refreshBridgeLease.mockClear();
    relayDbMocks.markBridgeLeaseDisconnected.mockClear();
    relayDbMocks.findActiveBridgeLeaseForUser.mockReset();
    relayDbMocks.findActiveBridgeLeaseForSession.mockReset();
    relayDbMocks.setAttachedSessionOnLease.mockClear();
  });

  afterEach(() => {
    bridgeRegistry.clear();
    sessionRouter.clear();
  });

  it("rejects a reused ticket on the internal browser session listing route", async () => {
    const app = await buildRelayServer();

    try {
      bridgeRegistry.register({
        userId: "user-list",
        deviceSessionId: "device-list",
        bridgeInstanceId: "bridge-list",
        relayMachineId: "local-dev-machine",
        socket: createBridgeSocket() as never,
        connectedAt: new Date("2026-04-18T07:30:00.000Z"),
      });
      relayDbMocks.findActiveBridgeLeaseForUser.mockResolvedValue(
        createLease("user-list"),
      );
      const ticket = await mintTicket("user-list", "device-list");

      const first = await app.inject({
        method: "GET",
        url: "/internal/browser/sessions",
        headers: {
          authorization: `Bearer ${ticket}`,
        },
      });

      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ sessions: [] });

      const second = await app.inject({
        method: "GET",
        url: "/internal/browser/sessions",
        headers: {
          authorization: `Bearer ${ticket}`,
        },
      });

      expect(second.statusCode).toBe(401);
      expect(second.json()).toEqual({ error: "ws-ticket already used" });
    } finally {
      await app.close();
    }
  });

  it("routes internal browser commands only to the bridge owned by the authenticated user", async () => {
    const app = await buildRelayServer();

    try {
      const ownerSocket = createBridgeSocket();
      const otherSocket = createBridgeSocket();

      bridgeRegistry.register({
        userId: "user-owner",
        deviceSessionId: "device-owner",
        bridgeInstanceId: "bridge-owner",
        relayMachineId: "local-dev-machine",
        socket: ownerSocket as never,
        connectedAt: new Date("2026-04-18T07:30:00.000Z"),
      });

      bridgeRegistry.register({
        userId: "user-other",
        deviceSessionId: "device-other",
        bridgeInstanceId: "bridge-other",
        relayMachineId: "local-dev-machine",
        socket: otherSocket as never,
        connectedAt: new Date("2026-04-18T07:30:00.000Z"),
      });
      relayDbMocks.findActiveBridgeLeaseForUser.mockImplementation(
        async ({ userId }: { userId: string }) => createLease(userId),
      );
      relayDbMocks.findActiveBridgeLeaseForSession.mockResolvedValue(
        createLease("user-owner", "session-alpha"),
      );

      const ticket = await mintTicket("user-owner", "device-owner");
      const response = await app.inject({
        method: "POST",
        url: "/internal/browser/sessions/session-alpha/command",
        headers: {
          authorization: `Bearer ${ticket}`,
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          kind: "prompt",
          text: "Ship the relay browser route",
        }),
      });

      expect(response.statusCode).toBe(202);

      const body = SessionCommandResponseSchema.parse(response.json());
      expect(body.accepted).toBe(true);
      expect(body.via).toBe("relay");
      expect(body.sessionId).toBe("session-alpha");

      expect(ownerSocket.send).toHaveBeenCalledTimes(1);
      expect(otherSocket.send).not.toHaveBeenCalled();

      const forwarded = ownerSocket.send.mock.calls[0]?.[0];
      expect(forwarded).toContain('"method":"turn.send"');
      expect(forwarded).toContain('"sessionId":"session-alpha"');
    } finally {
      await app.close();
    }
  });
});
