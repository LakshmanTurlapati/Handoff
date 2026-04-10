/**
 * Codex Mobile session and WebSocket ticket protocol contracts.
 *
 * These types describe the payloads the browser, the web app, and the
 * relay exchange for authenticated sessions and live-channel tickets.
 * They intentionally do not include any raw cookie values — callers must
 * only ever move opaque identifiers and short-lived signed tickets across
 * the trust boundary.
 *
 * See:
 *   - docs/adr/0001-phase-1-trust-boundary.md
 *   - packages/auth/src/device-session.ts
 *   - packages/auth/src/ws-ticket.ts
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Session descriptors
// ---------------------------------------------------------------------------

/**
 * Minimal public description of a paired device that is safe to render in
 * the browser. Never includes the device session cookie value.
 */
export interface DeviceSessionPublic {
  id: string;
  deviceLabel: string;
  devicePublicId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt?: string | null;
}

export const DeviceSessionPublicSchema: z.ZodType<DeviceSessionPublic> = z
  .object({
    id: z.string().min(1),
    deviceLabel: z.string().min(1),
    devicePublicId: z.string().min(1),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// WebSocket upgrade ticket (cm_ws_ticket)
// ---------------------------------------------------------------------------

/**
 * Claims carried by a single-use cm_ws_ticket minted from an authenticated
 * browser session. The ticket is a signed JWT with a 60-second lifetime
 * (see `WS_TICKET_TTL_SECONDS` in `@codex-mobile/auth/ws-ticket`).
 *
 * `jti` is used by the relay to enforce single-use semantics.
 */
export interface WsTicketClaims {
  sub: string;
  userId: string;
  deviceSessionId: string;
  iat: number;
  exp: number;
  jti: string;
}

export const WsTicketClaimsSchema: z.ZodType<WsTicketClaims> = z
  .object({
    sub: z.string().min(1),
    userId: z.string().min(1),
    deviceSessionId: z.string().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    jti: z.string().min(1),
  })
  .strict();

/**
 * Response the browser receives when it asks the web app to mint a
 * WebSocket upgrade ticket. The browser then uses `ticket` as the
 * `Sec-WebSocket-Protocol`-style credential when opening the live channel
 * to the relay.
 */
export interface WsTicketMintResponse {
  ticket: string;
  expiresAt: string;
}

export const WsTicketMintResponseSchema: z.ZodType<WsTicketMintResponse> = z
  .object({
    ticket: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();
