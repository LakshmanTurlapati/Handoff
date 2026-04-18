import { NextResponse } from "next/server";
import { SessionListResponseSchema } from "@codex-mobile/protocol/live-session";
import {
  relayInternalFetch,
  requireRemotePrincipal,
} from "../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const principal = await requireRemotePrincipal();
    const relayResponse = await relayInternalFetch(
      "/internal/browser/sessions",
      principal,
      { method: "GET" },
    );

    if (!relayResponse.ok) {
      return NextResponse.json({ error: "relay_unavailable" }, { status: 503 });
    }

    const body = await relayResponse.json();
    const parsed = SessionListResponseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "internal_response_invalid" },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed.data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (message === "unauthenticated" || message === "device_session_required") {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === "user_mismatch") {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    console.error("sessions list internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
