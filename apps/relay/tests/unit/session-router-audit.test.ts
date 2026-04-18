import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { BrowserRegistry } from "../../src/browser/browser-registry.js";
import { SessionBuffer } from "../../src/browser/session-buffer.js";

const relayAuditMocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  findActiveBridgeLeaseForUser: vi.fn(),
  findActiveBridgeLeaseForSession: vi.fn(),
  setAttachedSessionOnLease: vi.fn(),
}));

vi.mock("@codex-mobile/db", () => ({
  appendAuditEvent: relayAuditMocks.appendAuditEvent,
  findActiveBridgeLeaseForUser: relayAuditMocks.findActiveBridgeLeaseForUser,
  findActiveBridgeLeaseForSession: relayAuditMocks.findActiveBridgeLeaseForSession,
  setAttachedSessionOnLease: relayAuditMocks.setAttachedSessionOnLease,
}));

import { SessionRouter } from "../../src/browser/session-router.js";

function createSocket(): WebSocket {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe("SessionRouter audit capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends approval.requested when an approval activity is published", async () => {
    const router = new SessionRouter({
      bridgeRegistry: {
        sendTo: vi.fn(() => true),
        has: vi.fn(() => true),
      } as never,
      browserRegistry: new BrowserRegistry(),
      sessionBuffer: new SessionBuffer(),
      ownershipService: {
        recordAttachedSession: vi.fn(async () => undefined),
        clearAttachedSession: vi.fn(async () => undefined),
      } as never,
    });

    await router.handleBridgeMessage(
      "user-123",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session.event",
        params: {
          sessionId: "session-123",
          event: {
            kind: "activity.appended",
            sessionId: "session-123",
            cursor: 4,
            occurredAt: "2026-04-18T12:00:00.000Z",
            activity: {
              kind: "approval",
              activityId: "approval-1",
              turnId: "turn-1",
              title: "Waiting for approval",
              preview: "Approve the command",
              status: "pending",
              createdAt: "2026-04-18T12:00:00.000Z",
              requestId: "request-123",
              actions: [{ id: "approve", label: "Approve" }],
            },
          },
        },
      }),
    );

    expect(relayAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        eventType: "approval.requested",
        subject: "request-123",
      }),
    );
  });

  it("appends session.reconnected when a reconnect marker is emitted", async () => {
    const socket = createSocket();
    const sessionBuffer = new SessionBuffer();
    const router = new SessionRouter({
      bridgeRegistry: {
        sendTo: vi.fn(() => true),
        has: vi.fn(() => true),
      } as never,
      browserRegistry: new BrowserRegistry(),
      sessionBuffer,
      ownershipService: {
        recordAttachedSession: vi.fn(async () => undefined),
        clearAttachedSession: vi.fn(async () => undefined),
      } as never,
    });

    sessionBuffer.append({
      kind: "activity.appended",
      sessionId: "session-123",
      cursor: 7,
      occurredAt: "2026-04-18T12:05:00.000Z",
      activity: {
        kind: "system",
        activityId: "system-1",
        turnId: "turn-1",
        title: "Backfill",
        preview: "Buffered event",
        status: "completed",
        createdAt: "2026-04-18T12:05:00.000Z",
      },
    });

    await router.attachBrowser({
      userId: "user-123",
      deviceSessionId: "device-123",
      sessionId: "session-123",
      socket,
      cursor: 1,
    });

    expect(relayAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        eventType: "session.reconnected",
        metadata: expect.objectContaining({
          sessionId: "session-123",
          deviceSessionId: "device-123",
        }),
      }),
    );
  });

  it("appends session.disconnected with reason and cursor when a terminal end event is broadcast", async () => {
    const browserRegistry = new BrowserRegistry();
    browserRegistry.register({
      userId: "user-123",
      deviceSessionId: "device-123",
      sessionId: "session-123",
      socket: createSocket(),
      connectedAt: new Date("2026-04-18T12:10:00.000Z"),
    });

    const router = new SessionRouter({
      bridgeRegistry: {
        sendTo: vi.fn(() => true),
        has: vi.fn(() => true),
      } as never,
      browserRegistry,
      sessionBuffer: new SessionBuffer(),
      ownershipService: {
        recordAttachedSession: vi.fn(async () => undefined),
        clearAttachedSession: vi.fn(async () => undefined),
      } as never,
    });

    await router.handleBridgeMessage(
      "user-123",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session.ended",
        params: {
          sessionId: "session-123",
          cursor: 9,
          reason: "bridge_unavailable",
        },
      }),
    );

    expect(relayAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        eventType: "session.disconnected",
        metadata: expect.objectContaining({
          sessionId: "session-123",
          deviceSessionId: "device-123",
          reason: "bridge_unavailable",
          cursor: 9,
        }),
      }),
    );
  });
});
