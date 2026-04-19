import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createOrReuseThreadHandoff,
} from "@codex-mobile/db";
import { ThreadHandoffRecordSchema } from "@codex-mobile/protocol";
import { requireBridgeInstallationPrincipal } from "../../../lib/live-session/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDOFF_TTL_MS = 15 * 60 * 1000;

const HandoffBodySchema = z
  .object({
    bridgeInstallationId: z.string().uuid(),
    bridgeInstanceId: z.string().min(1).max(120),
    threadId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
  })
  .strict();

// POST /api/handoffs
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
  const parsedBody = HandoffBodySchema.safeParse(raw);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsedBody.error.issues },
      { status: 400 },
    );
  }

  let installation;
  try {
    installation = await requireBridgeInstallationPrincipal({
      bridgeBootstrapToken,
      bridgeInstallationId: parsedBody.data.bridgeInstallationId,
      bridgeInstanceId: parsedBody.data.bridgeInstanceId,
      touchLastUsed: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "missing_bridge_bootstrap_token") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (
      message === "bridge_installation_invalid" ||
      message === "bridge_installation_revoked"
    ) {
      return NextResponse.json(
        { error: "handoff_not_authorized" },
        { status: 403 },
      );
    }
    throw error;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);
  const { handoff, reused } = await createOrReuseThreadHandoff({
    userId: installation.userId,
    bridgeInstallationId: installation.id,
    bridgeInstanceId: installation.bridgeInstanceId,
    threadId: parsedBody.data.threadId,
    sessionId: parsedBody.data.sessionId,
    publicId: randomBytes(18).toString("base64url"),
    createdAt: now,
    lastUsedAt: now,
    expiresAt,
  });

  if (
    handoff.userId !== installation.userId ||
    handoff.bridgeInstallationId !== installation.id
  ) {
    return NextResponse.json(
      { error: "handoff_not_authorized" },
      { status: 403 },
    );
  }

  if (handoff.revokedAt) {
    return NextResponse.json({ error: "handoff_revoked" }, { status: 410 });
  }

  if (handoff.expiresAt.getTime() <= now.getTime()) {
    return NextResponse.json({ error: "handoff_expired" }, { status: 410 });
  }

  const baseUrl = new URL(request.url).origin;
  const publicId = handoff.publicId;
  const launchUrl = `${baseUrl}/launch/${publicId}`;
  const payload = ThreadHandoffRecordSchema.parse({
    threadId: handoff.threadId,
    sessionId: handoff.sessionId,
    launchUrl,
    qrText: launchUrl,
    expiresAt: handoff.expiresAt.toISOString(),
    reused,
  });

  return NextResponse.json(payload, { status: 200 });
}
