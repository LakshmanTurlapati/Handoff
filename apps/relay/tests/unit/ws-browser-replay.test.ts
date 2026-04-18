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

const BROWSER_PROTOCOL = "codex-mobile.live.v1";
const WS_TICKET_SECRET = "relay-browser-replay-test-secret";

async function mintTicket(userId: string, deviceSessionId: string): Promise<string> {
  const minted = await mintWsTicket({
    userId,
    deviceSessionId,
    secret: new TextEncoder().encode(WS_TICKET_SECRET),
  });

  return minted.ticket;
}

function createRemoteLease(userId: string, sessionId: string | null = null) {
  return {
    id: `${userId}-lease`,
    userId,
    deviceSessionId: "device-owner",
    bridgeInstanceId: "bridge-owner",
    relayMachineId: "fly-machine-2",
    relayRegion: "dfw",
    attachedSessionId: sessionId,
    leaseVersion: 1,
    connectedAt: new Date("2026-04-18T07:30:00.000Z"),
    lastHeartbeatAt: new Date("2026-04-18T07:30:00.000Z"),
    expiresAt: new Date("2026-04-25T12:00:00.000Z"),
    disconnectedAt: null,
    replacedByLeaseId: null,
  };
}

async function openBrowserSocketExpectReplay(input: {
  baseUrl: string;
  ticket: string;
  sessionId: string;
}): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${input.baseUrl}/ws/browser?sessionId=${input.sessionId}`,
      [BROWSER_PROTOCOL, input.ticket],
    );

    socket.once("open", () => {
      reject(new Error("expected replay response before websocket upgrade"));
    });

    socket.once("unexpected-response", (_request, response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    socket.once("error", (error) => {
      reject(error);
    });
  });
}

describe("relay ws-browser replay routing", () => {
  beforeEach(() => {
    process.env.WS_TICKET_SECRET = WS_TICKET_SECRET;
    bridgeRegistry.clear();
    sessionRouter.clear();
    relayDbMocks.findDeviceSessionForPrincipal.mockReset();
    relayDbMocks.findActiveBridgeLeaseForUser.mockReset();
    relayDbMocks.findActiveBridgeLeaseForSession.mockReset();
    relayDbMocks.findActiveBridgeLeaseForUser.mockResolvedValue(
      createRemoteLease("user-owner"),
    );
    relayDbMocks.findActiveBridgeLeaseForSession.mockResolvedValue(
      createRemoteLease("user-owner", "session-alpha"),
    );
  });

  afterEach(() => {
    bridgeRegistry.clear();
    sessionRouter.clear();
  });

  it("replays wrong-instance session listing requests to the owning Fly machine", async () => {
    const app = await buildRelayServer();

    try {
      const ticket = await mintTicket("user-owner", "device-owner");
      const response = await app.inject({
        method: "GET",
        url: "/internal/browser/sessions",
        headers: {
          authorization: `Bearer ${ticket}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain(
        "application/vnd.fly.replay+json",
      );
      expect(response.json()).toEqual({
        instance: "fly-machine-2",
        state: "browser:user-owner:list:device-owner",
        timeout: "5s",
        fallback: "prefer_self",
      });
    } finally {
      await app.close();
    }
  });

  it("replays wrong-instance session command requests to the owning Fly machine", async () => {
    const app = await buildRelayServer();

    try {
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
          text: "Keep routing at the relay edge",
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain(
        "application/vnd.fly.replay+json",
      );
      expect(response.json()).toEqual({
        instance: "fly-machine-2",
        state: "browser:user-owner:session-alpha:device-owner",
        timeout: "5s",
        fallback: "prefer_self",
      });
    } finally {
      await app.close();
    }
  });

  it("replays wrong-instance websocket attach requests before local upgrade", async () => {
    const app = await buildRelayServer();

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address() as AddressInfo;
      const baseUrl = `ws://127.0.0.1:${address.port}`;
      const ticket = await mintTicket("user-owner", "device-owner");
      const response = await openBrowserSocketExpectReplay({
        baseUrl,
        ticket,
        sessionId: "session-alpha",
      });

      expect(response.statusCode).toBe(200);
      expect(String(response.headers["content-type"])).toContain(
        "application/vnd.fly.replay+json",
      );
      expect(JSON.parse(response.body)).toEqual({
        instance: "fly-machine-2",
        state: "browser:user-owner:session-alpha:device-owner",
        timeout: "5s",
        fallback: "prefer_self",
      });
    } finally {
      await app.close();
    }
  });
});
