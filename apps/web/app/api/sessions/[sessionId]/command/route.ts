import { NextResponse } from "next/server";
import {
  SessionCommandResponseSchema,
  SessionCommandSchema,
} from "@codex-mobile/protocol/live-session";
import { recordApprovalDecisionAudit } from "../../../../../lib/session-audit";
import {
  assertSameOrigin,
  relayInternalFetch,
  requireRemotePrincipal,
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
  try {
    assertSameOrigin(request);

    const { sessionId } = await context.params;
    if (!sessionId) {
      return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
    }

    const body = await request.json();
    const command = SessionCommandSchema.safeParse(body);
    if (!command.success) {
      return NextResponse.json({ error: "invalid_command" }, { status: 400 });
    }

    const principal = await requireRemotePrincipal();
    if (command.data.kind === "approval") {
      await recordApprovalDecisionAudit({
        userId: principal.userId,
        sessionId,
        deviceSessionId: principal.deviceSessionId,
        requestId: command.data.requestId,
        decision: command.data.decision,
      });
    }
    const relayResponse = await relayInternalFetch(
      `/internal/browser/sessions/${encodeURIComponent(sessionId)}/command`,
      principal,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(command.data),
      },
    );

    const relayBody = await relayResponse.json();
    const parsed = SessionCommandResponseSchema.safeParse(relayBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "internal_response_invalid" },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed.data, { status: relayResponse.status });
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

    console.error("session command internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
