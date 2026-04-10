/**
 * Device-session helpers for Codex Mobile.
 *
 * A "device session" is the 7-day paired device trust record, distinct from
 * the short-lived browser `web_sessions` row. This module exposes the cookie
 * name, signing helpers, and rotation helpers consumed by `apps/web` and
 * later by pairing and device-management routes.
 *
 * Contracts:
 *   - Cookie name: `cm_device_session`
 *   - Cookie flags: HttpOnly, Secure, SameSite=Lax
 *   - Absolute lifetime: 7 days (enforced server-side, not from the token)
 *   - Storage: device session rows live in `device_sessions` — see
 *     `@codex-mobile/db/schema` for field definitions.
 *
 * The cookie value is a signed JWT containing only the opaque device
 * session id and the associated user id. All expiry, revocation, and last
 * seen bookkeeping happens against the `device_sessions` and `web_sessions`
 * tables on the server. The token is not the source of truth.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Cookie name for the 7-day paired device session. This exact string is
 * referenced by the web app middleware, the relay auth layer, and the
 * trust-boundary ADR — do not rename without a migration.
 */
export const DEVICE_SESSION_COOKIE_NAME = "cm_device_session";

/** Seven days, in seconds, for the absolute expiry of a device session. */
export const DEVICE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Cookie attributes the web app must use when writing the header. */
export const DEVICE_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DEVICE_SESSION_TTL_SECONDS,
};

/** Minimal payload persisted in the signed device session cookie. */
export interface DeviceSessionClaims extends JWTPayload {
  sub: string;
  deviceSessionId: string;
  userId: string;
  deviceLabel?: string;
}

/** Result of minting a new device-session cookie value. */
export interface CreateDeviceSessionResult {
  token: string;
  expiresAt: Date;
  claims: DeviceSessionClaims;
}

/** Inputs required to mint a device-session cookie. */
export interface CreateDeviceSessionInput {
  deviceSessionId: string;
  userId: string;
  deviceLabel?: string;
  /** Raw bytes used to sign the JWT. Must come from `SESSION_COOKIE_SECRET`. */
  secret: Uint8Array;
  /** Optional override for absolute expiry. Defaults to 7 days. */
  ttlSeconds?: number;
  /** Clock override used only in tests. */
  now?: Date;
}

/**
 * Mint a signed JWT intended to be written into the `cm_device_session`
 * cookie. This does NOT insert a row into `device_sessions` on its own —
 * callers must also persist the device session record and the token hash.
 */
export async function createDeviceSession(
  input: CreateDeviceSessionInput,
): Promise<CreateDeviceSessionResult> {
  const now = input.now ?? new Date();
  const ttl = input.ttlSeconds ?? DEVICE_SESSION_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const claims: DeviceSessionClaims = {
    sub: input.deviceSessionId,
    deviceSessionId: input.deviceSessionId,
    userId: input.userId,
    deviceLabel: input.deviceLabel,
  };

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setSubject(input.deviceSessionId)
    .sign(input.secret);

  return { token, expiresAt, claims };
}

/** Inputs required to verify a device-session cookie value. */
export interface VerifyDeviceSessionInput {
  token: string;
  secret: Uint8Array;
  now?: Date;
}

/**
 * Verify a `cm_device_session` cookie value and return its decoded claims.
 * Throws if the token is malformed, expired, or signed with the wrong key.
 *
 * NOTE: verification here only proves the cookie is structurally valid and
 * unexpired. Callers MUST still look up the device session row and ensure
 * it has not been revoked. The token is not authoritative on its own.
 */
export async function verifyDeviceSession(
  input: VerifyDeviceSessionInput,
): Promise<DeviceSessionClaims> {
  const { payload } = await jwtVerify(input.token, input.secret, {
    algorithms: ["HS256"],
    clockTolerance: 5,
    currentDate: input.now,
  });

  if (
    typeof payload.deviceSessionId !== "string" ||
    typeof payload.userId !== "string"
  ) {
    throw new Error("cm_device_session token is missing required claims");
  }

  return payload as DeviceSessionClaims;
}

/** Inputs required to rotate an existing device session cookie. */
export interface RotateDeviceSessionInput {
  current: DeviceSessionClaims;
  secret: Uint8Array;
  now?: Date;
}

/**
 * Mint a fresh device-session cookie value for an already-authenticated
 * device. Used to refresh the rolling expiry window without issuing a new
 * `device_sessions` row. Callers should update `last_seen_at` and the
 * cookie token hash atomically when writing the rotation back to storage.
 */
export async function rotateDeviceSession(
  input: RotateDeviceSessionInput,
): Promise<CreateDeviceSessionResult> {
  return createDeviceSession({
    deviceSessionId: input.current.deviceSessionId,
    userId: input.current.userId,
    deviceLabel: input.current.deviceLabel,
    secret: input.secret,
    now: input.now,
  });
}
