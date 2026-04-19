import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createOrReuseThreadHandoff,
  findBridgeInstallationByTokenHash,
  touchBridgeInstallationLastUsed,
} from "@codex-mobile/db";
import { ThreadHandoffRecordSchema } from "@codex-mobile/protocol";

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

  const installTokenHash = createHash("sha256")
    .update(bridgeBootstrapToken)
    .digest("hex");
  const installation = await findBridgeInstallationByTokenHash({
    installTokenHash,
  });

  if (
    !installation ||
    installation.revokedAt ||
    installation.id !== parsedBody.data.bridgeInstallationId ||
    installation.bridgeInstanceId !== parsedBody.data.bridgeInstanceId
  ) {
    return NextResponse.json(
      { error: "bridge_installation_invalid" },
      { status: 403 },
    );
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

  await touchBridgeInstallationLastUsed({
    bridgeInstallationId: installation.id,
    lastUsedAt: now,
  });

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
