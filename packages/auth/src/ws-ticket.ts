/**
 * WebSocket upgrade ticket helpers for Codex Mobile.
 *
 * The browser never connects to the relay using its long-lived
 * `cm_device_session` cookie. Instead, the authenticated web app mints a
 * short-lived single-use `cm_ws_ticket` JWT and hands it to the browser,
 * which then presents the ticket to the relay during the WebSocket
 * upgrade. The relay validates the signature, enforces single-use via the
 * `jti`, and allows the connection to proceed.
 *
 * Contracts:
 *   - Ticket name: `cm_ws_ticket`
 *   - Lifetime: exactly 60 seconds (`WS_TICKET_TTL_SECONDS = 60`)
 *   - Algorithm: HS256 signed with `WS_TICKET_SECRET`
 *   - Single-use: enforced server-side by the relay using `jti`
 *
 * See docs/adr/0001-phase-1-trust-boundary.md for the full derivation rule.
 */
import { SignJWT, jwtVerify } from "jose";
import type { WsTicketClaims } from "@codex-mobile/protocol/session";

/** Ticket cookie/header name recognized by the relay. */
export const WS_TICKET_NAME = "cm_ws_ticket";

/**
 * Absolute ticket lifetime in seconds. Deliberately set to 60 seconds so
 * a ticket captured in logs or proxy history cannot be replayed beyond
 * the time window required for the browser to open its WebSocket.
 */
export const WS_TICKET_TTL_SECONDS = 60;

/** Inputs required to mint a WebSocket upgrade ticket. */
export interface MintWsTicketInput {
  userId: string;
  deviceSessionId: string;
  /** Raw bytes used to sign the JWT. Must come from `WS_TICKET_SECRET`. */
  secret: Uint8Array;
  /** Clock override used only in tests. */
  now?: Date;
  /**
   * Optional caller-supplied `jti`. Defaults to a random UUID. The relay
   * stores consumed `jti` values briefly to enforce single-use semantics.
   */
  jti?: string;
}

/** Result of minting a WebSocket upgrade ticket. */
export interface MintWsTicketResult {
  ticket: string;
  expiresAt: Date;
  claims: WsTicketClaims;
}

/**
 * Mint a signed `cm_ws_ticket` JWT for the given authenticated device
 * session. Always returns a ticket with an exactly 60-second lifetime.
 */
export async function mintWsTicket(
  input: MintWsTicketInput,
): Promise<MintWsTicketResult> {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + WS_TICKET_TTL_SECONDS;
  const jti = input.jti ?? crypto.randomUUID();

  const claims: WsTicketClaims = {
    sub: input.deviceSessionId,
    userId: input.userId,
    deviceSessionId: input.deviceSessionId,
    iat,
    exp,
    jti,
  };

  const ticket = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.deviceSessionId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(input.secret);

  return {
    ticket,
    expiresAt: new Date(exp * 1000),
    claims,
  };
}

/** Inputs required to verify a WebSocket upgrade ticket. */
export interface VerifyWsTicketInput {
  ticket: string;
  secret: Uint8Array;
  now?: Date;
}

/**
 * Verify a `cm_ws_ticket` JWT and return its decoded claims.
 *
 * Throws if the ticket is malformed, expired, or signed with the wrong
 * secret. Callers MUST additionally enforce single-use semantics by
 * recording the returned `jti` and rejecting any later verification of
 * the same `jti`.
 */
export async function verifyWsTicket(
  input: VerifyWsTicketInput,
): Promise<WsTicketClaims> {
  const { payload } = await jwtVerify(input.ticket, input.secret, {
    algorithms: ["HS256"],
    clockTolerance: 5,
    currentDate: input.now,
  });

  if (
    typeof payload.userId !== "string" ||
    typeof payload.deviceSessionId !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.sub !== "string"
  ) {
    throw new Error("cm_ws_ticket is missing required claims");
  }

  return {
    sub: payload.sub,
    userId: payload.userId,
    deviceSessionId: payload.deviceSessionId,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}
