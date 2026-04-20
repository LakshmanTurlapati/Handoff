import { NextResponse } from "next/server";
import { SessionConnectResponseSchema } from "@codex-mobile/protocol/live-session";
import { recordWsTicketAudit } from "../../../../../lib/session-audit";
import {
  assertSameOrigin,
  mintRelayTicket,
  requireRemotePrincipal,
  resolveRelayPublicWebSocketUrl,
} from "../../../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  let sessionId: string | null = null;
  let principal:
    | { userId: string; deviceSessionId: string; bridgeInstallationId: string }
    | null = null;

  try {
    const params = await context.params;
    sessionId = params.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
    }

    assertSameOrigin(request);

    principal = await requireRemotePrincipal();
    const { ticket, expiresAt } = await mintRelayTicket(principal);
    await recordWsTicketAudit({
      outcome: "success",
      userId: principal.userId,
      sessionId,
      deviceSessionId: principal.deviceSessionId,
      expiresAt,
    });

    const payload = SessionConnectResponseSchema.parse({
      relayUrl: resolveRelayPublicWebSocketUrl(),
      ticket,
      expiresAt: expiresAt.toISOString(),
      sessionId,
      cursor: 0,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (
      sessionId &&
      [
        "cross_origin_not_allowed",
        "device_session_required",
        "device_session_expired",
        "device_session_revoked",
        "user_mismatch",
      ].includes(message)
    ) {
      await recordWsTicketAudit({
        outcome: "failure",
        userId: principal?.userId ?? null,
        sessionId,
        deviceSessionId: principal?.deviceSessionId ?? null,
        failureCode: message,
      });
    }

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

    console.error("session connect internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
