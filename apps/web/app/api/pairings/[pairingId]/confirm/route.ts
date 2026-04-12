/**
 * POST /api/pairings/[pairingId]/confirm
 *
 * Transitions a pairing from redeemed to confirmed. Cookie issuance moved
 * to POST /api/pairings/[id]/claim (Phase 01.1, D-09). The route:
 *
 *   1. Requires only a valid `Authorization: Bearer <pairingToken>` header
 *      -- the one-time token returned from POST /api/pairings. Cookie-based
 *      auth has been removed (CR-GAP-01) because the bridge CLI has no
 *      browser context. The bearer is verified inside `confirmPairing` via
 *      `verifyPairingTokenHash` against `pairing_sessions.pairingTokenHash`.
 *   2. Validates that the pairing exists and is `pending` or `redeemed`.
 *   3. Compares the request's `verificationPhrase` against the phrase
 *      stored on the pairing row using constant-time comparison.
 *   4. On success, writes `pairing.confirmed` to the audit trail and
 *      transitions the row to `confirmed`.
 *   5. Returns a `PairingConfirmResponse` containing the verification
 *      phrase and confirmedAt timestamp.
 *
 * Security rules enforced here are documented in
 * `docs/adr/0001-phase-1-trust-boundary.md` under the Phase 1 pairing
 * boundary.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PairingConfirmResponseSchema } from "@codex-mobile/protocol";
import { confirmPairing } from "../../../../../lib/pairing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConfirmPairingBodySchema = z
  .object({
    verificationPhrase: z.string().min(3),
    deviceLabel: z.string().min(1).max(120).optional(),
  })
  .strict();

interface RouteContext {
  params: Promise<{ pairingId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  // Same-origin CSRF guard (WR-02 from 01-REVIEW.md). This is the ONLY
  // route that mints a `cm_device_session` cookie, so a top-level
  // cross-origin POST that slips past SameSite=Lax must be rejected.
  // A missing Origin header is permitted — Node fetch and curl do not
  // send Origin, and the one-time pairing bearer already gates this
  // route at the Authorization header check below. Only a PRESENT
  // Origin whose host differs from Host is treated as hostile.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json(
          { error: "cross_origin_not_allowed" },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "cross_origin_not_allowed" },
        { status: 403 },
      );
    }
  }

  const { pairingId } = await context.params;
  if (!pairingId) {
    return NextResponse.json(
      { error: "missing_pairing_id" },
      { status: 400 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = ConfirmPairingBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Extract the one-time pairing bearer from the Authorization header
  // (SEC-06 / plan 01-05). The bridge CLI stores this token in process
  // memory from the POST /api/pairings response and carries it here on
  // the confirm call. Missing or malformed header is a hard 401 — a
  // bad bearer must never reach confirmPairing's state machine.
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) {
    return NextResponse.json(
      { error: "missing_pairing_token" },
      { status: 401 },
    );
  }

  // CR-GAP-01: the Auth.js session check above was removed because
  // /confirm is now bearer-only. The bridge CLI (the sole real-world
  // caller of this route) runs in a terminal and has no
  // `cm_web_session` cookie. Authorization is enforced entirely by
  // the one-time pairing bearer verified inside confirmPairing via
  // verifyPairingTokenHash -- possession of a 32-byte secret bound
  // to the specific pairing row is strictly stronger than cookie auth.
  //
  // D-12 (Phase 01.1): confirmPairing now uses row.redeemedByUserId
  // (set during redeemPairing) for the real user identity. The bridge
  // userId below is only used as a fallback and for audit attribution.
  // D-12: the bridge has no browser session, so userId is bridge-scoped.
  // confirmPairing uses row.redeemedByUserId for the real user binding.
  const userId = `bridge:${pairingId}`;

  try {
    // D-09 (Phase 01.1): confirmPairing is now a pure state transition.
    // Cookie issuance moved to POST /api/pairings/[id]/claim.
    const result = await confirmPairing({
      pairingId,
      userId,
      verificationPhrase: parsed.data.verificationPhrase,
      deviceLabel: parsed.data.deviceLabel,
      pairingToken: bearer,
    });

    const validated = PairingConfirmResponseSchema.safeParse({
      verificationPhrase: result.verificationPhrase,
      confirmedAt: result.confirmedAt.toISOString(),
    });
    if (!validated.success) {
      return NextResponse.json(
        {
          error: "internal_response_invalid",
          details: validated.error.issues,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(validated.data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: "pairing_not_found" }, { status: 404 });
    }
    if (message.includes("verification_failed")) {
      return NextResponse.json(
        { error: "invalid_pairing_token" },
        { status: 403 },
      );
    }
    if (message.includes("cannot confirm")) {
      return NextResponse.json(
        { error: "invalid_state", details: message },
        { status: 409 },
      );
    }
    if (message.includes("phrase mismatch")) {
      return NextResponse.json(
        { error: "phrase_mismatch" },
        { status: 403 },
      );
    }
    if (message.includes("must be redeemed")) {
      return NextResponse.json(
        { error: "not_redeemed" },
        { status: 409 },
      );
    }
    // WR-GAP-02: do NOT echo raw error.message on the 500 fallthrough.
    // Log internally for operators; return a generic code for the caller.
    console.error("pairing confirm internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
