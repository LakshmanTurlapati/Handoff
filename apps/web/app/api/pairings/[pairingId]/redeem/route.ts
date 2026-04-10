/**
 * POST /api/pairings/[pairingId]/redeem
 *
 * Called by the authenticated browser after it opens the QR pairing URL
 * on the phone. The route:
 *
 *   1. Requires a valid `cm_web_session` from Auth.js (via `auth()`),
 *      returning 401 if the caller is not signed in.
 *   2. Transitions the pairing from `pending` -> `redeemed` and generates
 *      the `verificationPhrase` that the terminal and browser compare.
 *   3. Returns the redeemed pairing as a `PairingStatusResponse` with the
 *      phrase so the browser can render it.
 *
 * If the pairing is already `redeemed` (e.g., the page was refreshed), the
 * existing phrase is returned unchanged so the flow is idempotent.
 */
import { NextResponse } from "next/server";
import { PairingStatusResponseSchema } from "@codex-mobile/protocol";
import { auth } from "../../../../../auth";
import {
  PAIRING_REDEEM_ALLOWED_STATES,
  redeemPairing,
} from "../../../../../lib/pairing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ pairingId: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401 },
    );
  }

  // Same-origin CSRF guard (WR-02 from 01-REVIEW.md). The redeem
  // transition is stateful (generates the verificationPhrase) so a
  // cross-origin top-level POST must not be allowed to burn it. A
  // missing Origin header is permitted — only a PRESENT Origin whose
  // host differs from Host is hostile. This route stays bearer-free
  // (Option A) and is still authenticated by the cm_web_session cookie
  // via auth() above.
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

  const userId =
    (session.user as { id?: string }).id ??
    session.user.email ??
    "unknown-user";

  try {
    const redeemed = await redeemPairing({
      pairingId,
      userId,
      userAgent: request.headers.get("user-agent") ?? undefined,
      allowExistingStates: PAIRING_REDEEM_ALLOWED_STATES,
    });

    // Enforce the protocol contract on the way out — this guarantees
    // `verificationPhrase` is always set when status is redeemed or
    // confirmed.
    const validated = PairingStatusResponseSchema.safeParse({
      pairingId: redeemed.pairingId,
      status: redeemed.status,
      expiresAt: redeemed.expiresAt,
      verificationPhrase: redeemed.verificationPhrase,
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
    if (message.includes("cannot redeem")) {
      return NextResponse.json({ error: "invalid_state" }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
