/**
 * GET /api/pairings/[pairingId]
 *
 * Read-only status poll consumed by the bridge CLI's PairingClient.waitForRedeem.
 * This route is INTENTIONALLY unauthenticated — the bridge has no browser
 * cookie at this point in the flow, and the middleware allowlist in
 * apps/web/middleware.ts (method=GET, regex /^\/api\/pairings\/[^\/]+$/) lets
 * it through. Possession of the opaque pairingId is the only proof required
 * to READ status; it does NOT let the caller mutate state (redeem / confirm
 * remain auth-gated at the route-handler level).
 *
 * Response shape is validated against PairingStatusResponseSchema from
 * @codex-mobile/protocol so the bridge's Zod parse on the other side cannot
 * drift from the server contract.
 *
 * Error responses are intentionally generic (no raw error.message leakage
 * to an unauthenticated caller); the underlying error is logged internally
 * for operators.
 *
 * Gap closure: 01-04 (closes the missing GET handler gap documented in
 * .planning/phases/01-identity-pairing-foundation/01-VERIFICATION.md).
 */
import { NextResponse } from "next/server";
import { PairingStatusResponseSchema } from "@codex-mobile/protocol";
import { loadPairingStatus } from "../../../../lib/pairing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ pairingId: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { pairingId } = await context.params;
  if (!pairingId) {
    return NextResponse.json(
      { error: "missing_pairing_id" },
      { status: 400 },
    );
  }

  try {
    const status = await loadPairingStatus(pairingId);

    const validated = PairingStatusResponseSchema.safeParse({
      pairingId: status.pairingId,
      status: status.status,
      expiresAt: status.expiresAt,
      verificationPhrase: status.verificationPhrase,
    });
    if (!validated.success) {
      // Log internally; do NOT leak zod issues to the unauthenticated caller.
      console.error(
        "pairing status internal_response_invalid",
        validated.error.issues,
      );
      return NextResponse.json(
        { error: "internal_response_invalid" },
        { status: 500 },
      );
    }

    return NextResponse.json(validated.data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message.includes("not found")) {
      return NextResponse.json(
        { error: "pairing_not_found" },
        { status: 404 },
      );
    }
    // Generic message for the caller; log the real one for operators.
    console.error("pairing status internal_error", error);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
}
