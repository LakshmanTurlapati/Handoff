import { NextResponse } from "next/server";
import {
  appendAuditEvent,
  revokeDeviceSession,
} from "@codex-mobile/db";
import { AUDIT_EVENT_TYPES } from "@codex-mobile/protocol";
import {
  assertSameOrigin,
  relayInternalFetch,
  requireRemotePrincipal,
} from "../../../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deviceSessionId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);

    const principal = await requireRemotePrincipal();
    const { deviceSessionId } = await context.params;
    if (!deviceSessionId) {
      return NextResponse.json(
        { error: "missing_device_session_id" },
        { status: 400 },
      );
    }

    const revokedDevice = await revokeDeviceSession({
      deviceSessionId,
      userId: principal.userId,
      bridgeInstallationId: principal.bridgeInstallationId,
    });
    if (!revokedDevice) {
      return NextResponse.json(
        { error: "device_session_not_found" },
        { status: 404 },
      );
    }

    await appendAuditEvent({
      userId: principal.userId,
      eventType: AUDIT_EVENT_TYPES.deviceRevoked,
      subject: deviceSessionId,
      outcome: "success",
      metadata: {
        deviceLabel: revokedDevice.deviceLabel,
        devicePublicId: revokedDevice.devicePublicId,
        revokedByDeviceSessionId: principal.deviceSessionId,
      },
    });

    const relayResponse = await relayInternalFetch(
      `/internal/browser/devices/${encodeURIComponent(deviceSessionId)}/revoke`,
      principal,
      { method: "POST" },
    );
    if (!relayResponse.ok) {
      return NextResponse.json({ error: "relay_unavailable" }, { status: 503 });
    }

    return NextResponse.json({ status: "revoked" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (message === "cross_origin_not_allowed") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (
      message === "device_session_required" ||
      message === "device_session_expired"
    ) {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === "user_mismatch" || message === "device_session_revoked") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("device revoke internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
