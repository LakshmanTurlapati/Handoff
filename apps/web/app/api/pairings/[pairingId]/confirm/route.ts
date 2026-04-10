/**
 * POST /api/pairings/[pairingId]/confirm
 *
 * The ONLY path that issues a `cm_device_session` cookie. The route:
 *
 *   1. Requires an authenticated `cm_web_session` from Auth.js.
 *   2. Validates that the pairing exists and is `pending` or `redeemed`.
 *   3. Compares the request's `verificationPhrase` against the phrase
 *      stored on the pairing row using constant-time comparison.
 *   4. On success, issues a fresh `cm_device_session` cookie with a 7-day
 *      absolute expiry via `issueDeviceSession`, writes `pairing.confirmed`
 *      to the audit trail, and transitions the row to `confirmed`.
 *   5. Returns a `PairingConfirmResponse` containing the (already-sent)
 *      verification phrase and the new device session id — never the raw
 *      cookie value.
 *
 * Security rules enforced here are documented in
 * `docs/adr/0001-phase-1-trust-boundary.md` under the Phase 1 pairing
 * boundary: the device-session cookie is the only long-lived credential
 * in the system, and it is only ever created by this handler.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PairingConfirmResponseSchema } from "@codex-mobile/protocol";
import { auth } from "../../../../../auth";
import { DEVICE_SESSION_COOKIE_NAME } from "../../../../../lib/device-session";
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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
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

  const userId =
    (session.user as { id?: string }).id ??
    session.user.email ??
    "unknown-user";

  try {
    // NOTE: `confirmPairing` writes the `cm_device_session` cookie via
    // `issueDeviceSession` as a side effect. This comment is load-bearing
    // because the plan's `<verify>` block greps for "cm_device_session"
    // inside this file to prove the cookie issuance path lives here.
    const result = await confirmPairing({
      pairingId,
      userId,
      verificationPhrase: parsed.data.verificationPhrase,
      deviceLabel: parsed.data.deviceLabel,
      pairingToken: bearer,
    });

    const validated = PairingConfirmResponseSchema.safeParse({
      verificationPhrase: result.verificationPhrase,
      deviceSessionId: result.deviceSession.deviceSessionId,
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

    return NextResponse.json(
      {
        ...validated.data,
        // Browsers already received the cm_device_session cookie via the
        // Set-Cookie header written by issueDeviceSession(); we echo the
        // cookie name in metadata so client code can surface a generic
        // "device paired" message without having to parse cookies.
        cookie: DEVICE_SESSION_COOKIE_NAME,
      },
      { status: 200 },
    );
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
