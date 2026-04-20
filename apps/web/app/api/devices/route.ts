import { NextResponse } from "next/server";
import {
  listAuditEventsForUser,
  listDeviceSessionsForBridgeInstallation,
} from "@codex-mobile/db";
import {
  SessionListResponseSchema,
  type BrowserSessionListItem,
} from "@codex-mobile/protocol/live-session";
import {
  relayInternalFetch,
  requireRemotePrincipal,
} from "../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const principal = await requireRemotePrincipal();
    const devices = await listDeviceSessionsForBridgeInstallation({
      bridgeInstallationId: principal.bridgeInstallationId,
    });
    const auditEvents = await listAuditEventsForUser({
      userId: principal.userId,
      limit: 25,
    });
    const relayResponse = await relayInternalFetch(
      "/internal/browser/sessions",
      principal,
      { method: "GET" },
    );

    let activeSessions: BrowserSessionListItem[] = [];
    if (relayResponse.ok) {
      const body = await relayResponse.json();
      const parsed = SessionListResponseSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "internal_response_invalid" },
          { status: 500 },
        );
      }
      activeSessions = parsed.data.sessions;
    }

    return NextResponse.json(
      {
        devices: devices.map((device) => ({
          ...device,
          createdAt: device.createdAt.toISOString(),
          expiresAt: device.expiresAt.toISOString(),
          lastSeenAt: device.lastSeenAt.toISOString(),
          revokedAt: device.revokedAt?.toISOString() ?? null,
        })),
        activeSessions,
        auditEvents: auditEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          subject: event.subject,
          outcome: event.outcome,
          createdAt: event.createdAt.toISOString(),
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (
      message === "device_session_required" ||
      message === "device_session_expired"
    ) {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === "user_mismatch" || message === "device_session_revoked") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("devices list internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
