import { NextResponse } from "next/server";
import { SessionConnectResponseSchema } from "@codex-mobile/protocol/live-session";
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
  try {
    assertSameOrigin(request);

    const { sessionId } = await context.params;
    if (!sessionId) {
      return NextResponse.json({ error: "missing_session_id" }, { status: 400 });
    }

    const principal = await requireRemotePrincipal();
    const { ticket, expiresAt } = await mintRelayTicket(principal);

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

    if (message === "cross_origin_not_allowed") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (message === "unauthenticated" || message === "device_session_required") {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === "user_mismatch") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("session connect internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
