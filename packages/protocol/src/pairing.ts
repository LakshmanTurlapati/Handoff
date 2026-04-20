/**
 * Codex Mobile pairing protocol contracts.
 *
 * These types describe the shape of the pairing API that runs in `apps/web`
 * and is called by both the local bridge (to start pairing) and the
 * authenticated browser (to redeem and confirm it). They must stay aligned
 * with the `pairing_sessions.status` column defined in
 * `@codex-mobile/db/schema` — changing a value here requires a schema change.
 *
 * Security notes (see docs/adr/0001-phase-1-trust-boundary.md):
 *   - Pairing tokens are single-use and expire within minutes.
 *   - A pairing only transitions to `confirmed` after the developer confirms
 *     the verification phrase inside their local terminal.
 *   - The verification phrase is shown in both the terminal and the browser
 *     and must match before a device session is issued.
 */
import { z } from "zod";

/**
 * Exact lifecycle values a `pairing_sessions` row can hold. The order here
 * mirrors the expected transition path:
 *
 *   pending -> redeemed -> confirmed
 *                \-> expired
 *                \-> cancelled
 */
export const PAIRING_STATUS_VALUES = [
  "pending",
  "redeemed",
  "confirmed",
  "expired",
  "cancelled",
] as const;

export type PairingStatus = (typeof PAIRING_STATUS_VALUES)[number];

export const PairingStatusSchema = z.enum(PAIRING_STATUS_VALUES);

/**
 * Response returned by `POST /api/pairing` when the local bridge asks the
 * hosted web app to start a new pairing session.
 *
 * - `pairingId`: opaque server-side identifier for the pairing row
 * - `pairingUrl`: absolute URL the terminal should render as a QR code
 * - `userCode`: short human-friendly fallback code shown alongside the QR
 * - `expiresAt`: absolute ISO-8601 timestamp after which the pairing is
 *   auto-expired and cannot be redeemed
 * - `pairingToken`: one-time raw pairing token returned exactly once, at
 *   create time. The bridge carries it in an `Authorization: Bearer`
 *   header on the subsequent `/confirm` call. The server stores only
 *   `sha256(pairingToken)` as `pairing_sessions.pairingTokenHash` and
 *   verifies it with `crypto.timingSafeEqual` inside `confirmPairing`.
 *   Optional on the interface so older bridges keep parsing, but the
 *   server will always populate it after plan 01-05 lands.
 */
export interface PairingCreateResponse {
  pairingId: string;
  pairingUrl: string;
  userCode: string;
  expiresAt: string;
  /**
   * One-time raw pairing token. See interface-level comment above.
   */
  pairingToken?: string;
}

export const PairingCreateResponseSchema: z.ZodType<PairingCreateResponse> = z
  .object({
    pairingId: z.string().min(1),
    pairingUrl: z.string().url(),
    userCode: z.string().min(4),
    expiresAt: z.string().datetime(),
    pairingToken: z.string().min(32).optional(),
  })
  .strict();

/**
 * Response returned after the bridge confirms a pairing. The bridge
 * receives only the state-transition result. Device session cookie
 * issuance is handled by the browser-side /claim endpoint (Phase 01.1).
 *
 * `deviceSessionId` is optional for backward compatibility during the
 * monorepo transition. New code should not rely on it.
 */
export interface PairingConfirmResponse {
  verificationPhrase: string;
  confirmedAt?: string;
  deviceSessionId?: string;
  bridgeInstallationId?: string;
  bridgeBootstrapToken?: string;
}

export const PairingConfirmResponseSchema: z.ZodType<PairingConfirmResponse> = z
  .object({
    verificationPhrase: z.string().min(3),
    confirmedAt: z.string().datetime().optional(),
    deviceSessionId: z.string().min(1).optional(),
    bridgeInstallationId: z.string().min(1).optional(),
    bridgeBootstrapToken: z.string().min(32).optional(),
  })
  .strict();

/**
 * Response returned by POST /api/pairings/[id]/claim when the browser
 * successfully claims the device session cookie. The Set-Cookie header
 * on the HTTP response carries the actual cm_device_session JWT;
 * this body is informational.
 */
export interface PairingClaimResponse {
  status: "claimed";
  deviceSessionId: string;
  deviceLabel?: string;
}

export const PairingClaimResponseSchema: z.ZodType<PairingClaimResponse> = z
  .object({
    status: z.literal("claimed"),
    deviceSessionId: z.string().min(1),
    deviceLabel: z.string().optional(),
  })
  .strict();

/**
 * Polling payload the browser or bridge uses to read the current pairing
 * lifecycle state without triggering any side effects.
 */
export interface PairingStatusResponse {
  pairingId: string;
  status: PairingStatus;
  expiresAt: string;
  verificationPhrase?: string;
  /**
   * Short human-friendly fallback code also returned at create
   * time. Present on the status response so the phone browser's
   * pair page can render it without a second round trip. Optional
   * so bridges that only care about status/phrase can ignore it.
   * (WR-GAP-03: previously the strict schema silently dropped this
   * field even though `toStatusResponse` returned it.)
   */
  userCode?: string;
}

export const PairingStatusResponseSchema: z.ZodType<PairingStatusResponse> = z
  .object({
    pairingId: z.string().min(1),
    status: PairingStatusSchema,
    expiresAt: z.string().datetime(),
    verificationPhrase: z.string().min(3).optional(),
    userCode: z.string().min(4).max(12).optional(),
  })
  .strict();
