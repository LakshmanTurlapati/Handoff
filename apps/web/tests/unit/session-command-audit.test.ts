import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENT_TYPES } from "@codex-mobile/protocol";

const commandAuditMocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  assertSameOrigin: vi.fn(),
  mintRelayTicket: vi.fn(),
  requireRemotePrincipal: vi.fn(),
  relayInternalFetch: vi.fn(),
  resolveRelayPublicWebSocketUrl: vi.fn(),
}));

vi.mock("@codex-mobile/db", () => ({
  appendAuditEvent: commandAuditMocks.appendAuditEvent,
}));

vi.mock("../../lib/live-session/server", () => ({
  assertSameOrigin: commandAuditMocks.assertSameOrigin,
  mintRelayTicket: commandAuditMocks.mintRelayTicket,
  requireRemotePrincipal: commandAuditMocks.requireRemotePrincipal,
  relayInternalFetch: commandAuditMocks.relayInternalFetch,
  resolveRelayPublicWebSocketUrl: commandAuditMocks.resolveRelayPublicWebSocketUrl,
}));

vi.mock("../../lib/session-audit", async () => {
  const actual = await vi.importActual<typeof import("../../lib/session-audit")>(
    "../../lib/session-audit",
  );
  return {
    ...actual,
    recordWsTicketAudit: vi.fn(actual.recordWsTicketAudit),
    recordApprovalDecisionAudit: vi.fn(actual.recordApprovalDecisionAudit),
  };
});

import * as sessionAudit from "../../lib/session-audit";
import { POST as connectRoute } from "../../app/api/sessions/[sessionId]/connect/route";
import { POST as commandRoute } from "../../app/api/sessions/[sessionId]/command/route";

describe("session audit helpers and routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    commandAuditMocks.assertSameOrigin.mockImplementation(() => undefined);
    commandAuditMocks.requireRemotePrincipal.mockResolvedValue({
      userId: "user-123",
      deviceSessionId: "device-123",
    });
    commandAuditMocks.mintRelayTicket.mockResolvedValue({
      ticket: "ticket-123",
      expiresAt: new Date("2026-04-18T12:30:00.000Z"),
    });
    commandAuditMocks.resolveRelayPublicWebSocketUrl.mockReturnValue(
      "wss://relay.codex-mobile.test/ws/browser",
    );
    commandAuditMocks.relayInternalFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          via: "relay",
          sessionId: "session-123",
        }),
        { status: 202 },
      ),
    );
  });

  it("records ws_ticket.minted on successful ticket creation", async () => {
    const response = await connectRoute(
      new Request("http://localhost:3000/api/sessions/session-123/connect", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ sessionId: "session-123" }),
      },
    );

    expect(response.status).toBe(200);
    expect(sessionAudit.recordWsTicketAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "success",
        sessionId: "session-123",
      }),
    );
    expect(commandAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENT_TYPES.wsTicketMinted,
      }),
    );
  });

  it("records ws_ticket.rejected with the exact failure code on rejected ticket mint", async () => {
    commandAuditMocks.assertSameOrigin.mockImplementationOnce(() => {
      throw new Error("cross_origin_not_allowed");
    });

    const response = await connectRoute(
      new Request("http://localhost:3000/api/sessions/session-123/connect", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ sessionId: "session-123" }),
      },
    );

    expect(response.status).toBe(403);
    expect(sessionAudit.recordWsTicketAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        sessionId: "session-123",
        failureCode: "cross_origin_not_allowed",
      }),
    );
    expect(commandAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENT_TYPES.wsTicketRejected,
      }),
    );
  });

  it("records approval.responded before forwarding approval commands", async () => {
    const response = await commandRoute(
      new Request("http://localhost:3000/api/sessions/session-123/command", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "approval",
          requestId: "request-123",
          decision: "approved",
        }),
      }),
      {
        params: Promise.resolve({ sessionId: "session-123" }),
      },
    );

    expect(response.status).toBe(202);
    expect(sessionAudit.recordApprovalDecisionAudit).toHaveBeenCalledWith({
      userId: "user-123",
      sessionId: "session-123",
      deviceSessionId: "device-123",
      requestId: "request-123",
      decision: "approved",
    });
    expect(commandAuditMocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENT_TYPES.approvalResponded,
      }),
    );
  });
});
