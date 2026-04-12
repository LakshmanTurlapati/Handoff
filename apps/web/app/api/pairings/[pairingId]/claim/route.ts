/**
 * POST /api/pairings/[pairingId]/claim
 *
 * Browser-side claim endpoint that mints the cm_device_session cookie.
 * This is the sole path that issues a device session cookie after
 * Phase 01.1 (D-09 moved cookie issuance from /confirm to here).
 *
 * Auth model (D-03): requires a valid cm_web_session cookie via auth()
 * AND verifies session.user.id === pairing.redeemedByUserId. Only the
 * user who redeemed the pairing on the phone can claim the cookie.
 *
 * Idempotency: if the pairing already has a claimedAt timestamp, the
 * endpoint returns 200 with the existing metadata instead of re-issuing
 * a new device session. This prevents duplicate sessions from polling
 * race conditions (see RESEARCH.md Pitfall 2).
 *
 * Security: same-origin CSRF guard (Origin vs Host), cookie-only auth,
 * user-match check, audit trail.
 */
import { NextResponse } from "next/server";
import { PairingClaimResponseSchema } from "@codex-mobile/protocol";
import { auth } from "../../../../../auth";
import { issueDeviceSession } from "../../../../../lib/device-session";
import {
  loadPairingRow,
  updatePairingRow,
  recordAuditEvent,
  PAIRING_AUDIT_EVENTS,
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
  // Same-origin CSRF guard (pattern from /confirm and /redeem)
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

  // Cookie-based auth (D-03)
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

  const userId =
    (session.user as { id?: string }).id ??
    session.user.email ??
    "unknown-user";

  try {
    const row = await loadPairingRow(pairingId);

    // Pairing must be confirmed before claiming
    if (row.status !== "confirmed") {
      return NextResponse.json(
        { error: "invalid_state", details: `pairing is ${row.status}, expected confirmed` },
        { status: 409 },
      );
    }

    // D-03: user-match check
    if (row.redeemedByUserId && row.redeemedByUserId !== userId) {
      return NextResponse.json(
        { error: "user_mismatch" },
        { status: 403 },
      );
    }

    // Idempotency: if already claimed, return success without re-issuing
    if (row.claimedAt) {
      const response: { status: "claimed"; deviceSessionId: string; deviceLabel?: string } = {
        status: "claimed" as const,
        deviceSessionId: row.id,
        deviceLabel: row.deviceLabel ?? undefined,
      };
      return NextResponse.json(response, { status: 200 });
    }

    // Mint the cm_device_session cookie (D-04)
    const deviceSession = await issueDeviceSession({
      userId,
      deviceLabel: row.deviceLabel ?? "codex-mobile device",
      issuedFromPairingId: row.id,
    });

    // Mark the pairing as claimed
    await updatePairingRow(pairingId, {
      claimedAt: new Date(),
    });

    // Write audit event
    await recordAuditEvent({
      eventType: PAIRING_AUDIT_EVENTS.claimed,
      userId,
      subject: pairingId,
      outcome: "success",
      metadata: {
        deviceSessionId: deviceSession.deviceSessionId,
        devicePublicId: deviceSession.devicePublicId,
        deviceLabel: deviceSession.deviceLabel,
      },
      createdAt: new Date(),
    });

    // D-04: JSON success payload alongside the Set-Cookie header
    const body = {
      status: "claimed" as const,
      deviceSessionId: deviceSession.deviceSessionId,
      deviceLabel: deviceSession.deviceLabel,
    };

    const validated = PairingClaimResponseSchema.safeParse(body);
    if (!validated.success) {
      console.error("claim response validation failed", validated.error.issues);
      return NextResponse.json(
        { error: "internal_response_invalid" },
        { status: 500 },
      );
    }

    return NextResponse.json(validated.data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: "pairing_not_found" }, { status: 404 });
    }
    // Generic 500 -- do NOT leak error details
    console.error("pairing claim internal_error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
