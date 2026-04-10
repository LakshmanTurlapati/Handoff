/**
 * POST /api/pairings
 *
 * Entry point used by the local bridge CLI to start a new pairing session.
 * The response tells the bridge:
 *
 *   - `pairingId`   opaque server-side identifier
 *   - `pairingUrl`  absolute URL the terminal should render as a QR code
 *   - `userCode`    fallback code printed under the QR
 *   - `expiresAt`   ISO-8601 timestamp after which the pairing auto-expires
 *
 * This route intentionally does NOT require an authenticated browser
 * session — the bridge calls it from a developer's terminal before anyone
 * has opened the phone browser. It does, however, log the request so
 * operators can detect abuse.
 *
 * Security:
 *   - A pairing lives for exactly 5 minutes (`PAIRING_TTL_SECONDS`).
 *   - Only a SHA-256 hash of the pairing token is stored server-side.
 *   - The `expiresAt` string is returned in ISO-8601 form and matches
 *     `@codex-mobile/protocol.PairingCreateResponseSchema`.
 *   - The response body carries a one-time bearer `pairingToken` that the
 *     bridge CLI MUST hold only in process memory and never persist. The
 *     bridge echoes this token back in the `Authorization: Bearer` header
 *     on the subsequent `POST /api/pairings/[id]/confirm` call, and the
 *     server verifies `sha256(bearer) == pairing_sessions.pairingTokenHash`
 *     via `crypto.timingSafeEqual` inside `confirmPairing` (SEC-06).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PairingCreateResponseSchema } from "@codex-mobile/protocol";
import { createPairing } from "../../../lib/pairing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Request body accepted by the pairing start endpoint. All fields are
 * optional — the bridge can create a pairing without any context, but
 * the server will persist anything it sends for audit purposes.
 */
const CreatePairingBodySchema = z
  .object({
    deviceLabel: z.string().min(1).max(120).optional(),
    bridgeInstanceId: z.string().min(1).max(120).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof CreatePairingBodySchema> = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const raw = await request.json().catch(() => ({}));
    const parsed = CreatePairingBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  }

  const userAgent = request.headers.get("user-agent") ?? undefined;

  const result = await createPairing({
    deviceLabel: body.deviceLabel,
    bridgeInstanceId: body.bridgeInstanceId,
    userAgent,
  });

  const responseBody = {
    pairingId: result.pairingId,
    pairingUrl: result.pairingUrl,
    userCode: result.userCode,
    expiresAt: result.expiresAt,
    pairingToken: result.pairingToken,
  };

  // Structurally validate the response before returning so this route
  // never drifts away from @codex-mobile/protocol/PairingCreateResponse.
  const validated = PairingCreateResponseSchema.safeParse(responseBody);
  if (!validated.success) {
    return NextResponse.json(
      {
        error: "internal_response_invalid",
        details: validated.error.issues,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(validated.data, { status: 201 });
}
