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
 * Response returned after the browser redeems a pairing and the local
 * terminal confirms it. The browser uses `verificationPhrase` to show the
 * same phrase the terminal is rendering so the developer can verify they
 * are confirming the correct device. `deviceSessionId` is the opaque
 * identifier of the freshly issued 7-day device session.
 */
export interface PairingConfirmResponse {
  verificationPhrase: string;
  deviceSessionId: string;
}

export const PairingConfirmResponseSchema: z.ZodType<PairingConfirmResponse> = z
  .object({
    verificationPhrase: z.string().min(3),
    deviceSessionId: z.string().min(1),
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
}

export const PairingStatusResponseSchema: z.ZodType<PairingStatusResponse> = z
  .object({
    pairingId: z.string().min(1),
    status: PairingStatusSchema,
    expiresAt: z.string().datetime(),
    verificationPhrase: z.string().min(3).optional(),
  })
  .strict();
