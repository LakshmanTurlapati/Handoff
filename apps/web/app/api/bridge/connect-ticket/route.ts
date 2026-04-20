import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  findBridgeInstallationByTokenHash,
  touchBridgeInstallationLastUsed,
} from "@codex-mobile/db";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";
import {
  loadWsTicketSecret,
  resolveRelayPublicWebSocketUrl,
} from "../../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BridgeConnectTicketBodySchema = z
  .object({
    bridgeInstallationId: z.string().uuid(),
  })
  .strict();

// POST /api/bridge/connect-ticket
export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization") ?? "";
  const bridgeBootstrapToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!bridgeBootstrapToken) {
    return NextResponse.json(
      { error: "missing_bridge_bootstrap_token" },
      { status: 401 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = BridgeConnectTicketBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const installTokenHash = createHash("sha256")
    .update(bridgeBootstrapToken)
    .digest("hex");
  const installation = await findBridgeInstallationByTokenHash({
    installTokenHash,
  });

  if (
    !installation ||
    installation.revokedAt ||
    installation.id !== parsed.data.bridgeInstallationId
  ) {
    return NextResponse.json(
      { error: "bridge_installation_invalid" },
      { status: 403 },
    );
  }

  const { ticket, expiresAt } = await mintWsTicket({
    userId: installation.userId,
    deviceSessionId: installation.id,
    secret: loadWsTicketSecret(),
  });
  await touchBridgeInstallationLastUsed({
    bridgeInstallationId: installation.id,
  });

  return NextResponse.json(
    {
      relayUrl: resolveRelayPublicWebSocketUrl(),
      ticket,
      expiresAt: expiresAt.toISOString(),
      bridgeInstallationId: installation.id,
    },
    { status: 200 },
  );
}
