/**
 * Server-side cookie issuance and validation for `apps/web`.
 *
 * This module is the Phase 1 browser-facing wrapper around the lower-level
 * helpers in `@codex-mobile/auth/device-session`. It adds:
 *
 *   - Next.js `cookies()` integration for reading and writing the
 *     `cm_web_session` and `cm_device_session` cookies with the exact
 *     HttpOnly + Secure + SameSite=Lax + path=/ attributes required by the
 *     Phase 1 trust-boundary ADR (see docs/adr/0001-phase-1-trust-boundary.md).
 *   - A 7-day absolute expiry for `cm_device_session` imported from
 *     `DEVICE_SESSION_TTL_SECONDS` so the lifetime is declared once and
 *     reused everywhere.
 *   - A concrete `issueDeviceSession` entry point that the pairing
 *     confirmation route calls AFTER validating the verification phrase.
 *
 * Security notes:
 *   - Raw cookie values never land in Postgres. We only persist a SHA-256
 *     hash in `device_sessions.cookie_token_hash`.
 *   - The returned JWT carries only opaque identifiers. All expiry and
 *     revocation checks MUST be performed against the `device_sessions`
 *     row before trusting the principal.
 *   - The wider web session cookie is named `cm_web_session` and is a
 *     separate trust object from `cm_device_session`; they have different
 *     lifetimes (12 hours rolling vs. 7 days absolute) and are rotated
 *     independently.
 */
import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createDeviceSession,
  DEVICE_SESSION_COOKIE_NAME as AUTH_DEVICE_SESSION_COOKIE_NAME,
  DEVICE_SESSION_TTL_SECONDS,
  verifyDeviceSession,
  type DeviceSessionClaims,
} from "@codex-mobile/auth";

// ---------------------------------------------------------------------------
// Cookie names
// ---------------------------------------------------------------------------

/**
 * Cookie name for the short-lived rolling browser session. This is distinct
 * from the 7-day device session cookie and is used for normal signed-in
 * navigation inside `apps/web`.
 */
export const WEB_SESSION_COOKIE_NAME = "cm_web_session";

/**
 * Cookie name for the 7-day paired device session. Re-exported from
 * `@codex-mobile/auth` so API routes, middleware, and the pairing service
 * share a single source of truth. Must equal `cm_device_session`.
 */
export const DEVICE_SESSION_COOKIE_NAME = AUTH_DEVICE_SESSION_COOKIE_NAME;

// ---------------------------------------------------------------------------
// Cookie attributes
// ---------------------------------------------------------------------------

/** Twelve hours in seconds — used for the rolling `cm_web_session` cookie. */
export const WEB_SESSION_TTL_SECONDS = 60 * 60 * 12;

/**
 * Attributes applied to the `cm_device_session` cookie. HttpOnly + Secure +
 * SameSite=Lax + Path=/ + 7-day maxAge match the trust-boundary ADR exactly.
 */
export const DEVICE_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DEVICE_SESSION_TTL_SECONDS,
};

/**
 * Attributes applied to the `cm_web_session` cookie. Same flags as the
 * device-session cookie but a shorter 12-hour rolling lifetime.
 */
export const WEB_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: WEB_SESSION_TTL_SECONDS,
};

// ---------------------------------------------------------------------------
// Secret loading
// ---------------------------------------------------------------------------

/**
 * Load the raw signing secret for session cookies from the environment.
 * Callers must ensure `SESSION_COOKIE_SECRET` is populated in the runtime
 * environment (see `.env.example`).
 *
 * Gates on the UTF-8 byte length of the encoded secret (not the JS string
 * length) and requires at least 32 bytes — HS256 best practice and the
 * WR-03 fix from .planning/phases/01-identity-pairing-foundation/01-REVIEW.md.
 * An operator who supplies a 16-character password-style secret will now
 * crash at first cookie operation instead of silently minting weak HMACs.
 */
export function loadSessionCookieSecret(): Uint8Array {
  const raw = process.env.SESSION_COOKIE_SECRET;
  if (!raw) {
    throw new Error("SESSION_COOKIE_SECRET is not set");
  }
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength < 32) {
    throw new Error(
      "SESSION_COOKIE_SECRET must be at least 32 bytes after UTF-8 encoding (HS256 best practice)",
    );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Token hashing
// ---------------------------------------------------------------------------

/**
 * Hash a raw JWT cookie value so it can be safely stored in the
 * `device_sessions.cookie_token_hash` column. We deliberately use a plain
 * SHA-256 digest here — the stored value is an opaque lookup key, not a
 * password, and the JWT is already high-entropy.
 */
export function hashCookieToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Public device-session descriptor
// ---------------------------------------------------------------------------

/**
 * Minimal description of an issued device session that is safe to return
 * from a route handler. Never includes the raw cookie value.
 */
export interface IssuedDeviceSession {
  deviceSessionId: string;
  devicePublicId: string;
  userId: string;
  deviceLabel: string;
  expiresAt: Date;
  cookieTokenHash: string;
}

/** Inputs for {@link issueDeviceSession}. */
export interface IssueDeviceSessionInput {
  userId: string;
  deviceLabel: string;
  issuedFromPairingId?: string;
  /** Optional override for the cookie secret, used only in tests. */
  secret?: Uint8Array;
  /** Optional override for the current time, used only in tests. */
  now?: Date;
  /** Optional override for the generated deviceSessionId, used only in tests. */
  deviceSessionId?: string;
  /** Optional override for the generated devicePublicId, used only in tests. */
  devicePublicId?: string;
}

/**
 * Issue a fresh `cm_device_session` cookie for the given user and device
 * label.
 *
 * This function:
 *   1. Generates opaque device session identifiers.
 *   2. Signs a JWT using `SESSION_COOKIE_SECRET` with a 7-day expiry.
 *   3. Writes the JWT into the `cm_device_session` cookie with the Phase 1
 *      cookie attributes (HttpOnly, Secure, SameSite=Lax, Path=/).
 *   4. Returns the metadata the pairing service needs to persist the
 *      `device_sessions` row (cookie token hash, public id, expiry).
 *
 * The caller is responsible for inserting the corresponding row in the
 * `device_sessions` table with the returned `cookieTokenHash` before
 * trusting the cookie on subsequent requests.
 */
export async function issueDeviceSession(
  input: IssueDeviceSessionInput,
): Promise<IssuedDeviceSession> {
  const secret = input.secret ?? loadSessionCookieSecret();
  const now = input.now ?? new Date();
  const deviceSessionId = input.deviceSessionId ?? randomUUID();
  const devicePublicId =
    input.devicePublicId ?? randomBytes(16).toString("hex");

  const minted = await createDeviceSession({
    deviceSessionId,
    userId: input.userId,
    deviceLabel: input.deviceLabel,
    secret,
    now,
  });

  const cookieStore = await cookies();
  cookieStore.set({
    name: DEVICE_SESSION_COOKIE_NAME,
    value: minted.token,
    ...DEVICE_SESSION_COOKIE_OPTIONS,
    expires: minted.expiresAt,
  });

  return {
    deviceSessionId,
    devicePublicId,
    userId: input.userId,
    deviceLabel: input.deviceLabel,
    expiresAt: minted.expiresAt,
    cookieTokenHash: hashCookieToken(minted.token),
  };
}

// ---------------------------------------------------------------------------
// Reading the device session on the server side
// ---------------------------------------------------------------------------

/**
 * Read and structurally verify the `cm_device_session` cookie on the server
 * side. Returns `null` if the cookie is missing, malformed, expired, or
 * signed with the wrong key.
 *
 * IMPORTANT: this only proves the cookie is structurally valid. Callers
 * MUST still look up the `device_sessions` row and reject revoked records
 * before trusting the returned claims.
 */
export async function readDeviceSession(options?: {
  secret?: Uint8Array;
  now?: Date;
}): Promise<DeviceSessionClaims | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(DEVICE_SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return null;
  }
  try {
    return await verifyDeviceSession({
      token: cookie.value,
      secret: options?.secret ?? loadSessionCookieSecret(),
      now: options?.now,
    });
  } catch {
    return null;
  }
}

/** Clear both the web session and device session cookies on sign-out. */
export async function clearAllSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set({
    name: DEVICE_SESSION_COOKIE_NAME,
    value: "",
    ...DEVICE_SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  cookieStore.set({
    name: WEB_SESSION_COOKIE_NAME,
    value: "",
    ...WEB_SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
