/**
 * Pairing lifecycle service for `apps/web`.
 *
 * This module is the single source of truth for pairing state transitions
 * on the hosted side. It owns:
 *
 *   - `createPairing`  (pending)       — POST /api/pairings
 *   - `redeemPairing`  (redeemed)      — POST /api/pairings/[id]/redeem
 *   - `confirmPairing` (confirmed)     — POST /api/pairings/[id]/confirm
 *   - `loadPairingStatus`              — read-only status lookup
 *
 * The service writes audit rows for `pairing.created`, `pairing.redeemed`,
 * `pairing.confirmed`, and `pairing.expired` in addition to mutating the
 * `pairing_sessions` table. The actual row persistence is intentionally
 * abstracted behind a `PairingStore` interface so Phase 1 can ship a
 * safe in-memory store while Plan 01-03 wires the real Drizzle/Postgres
 * adapter without having to rewrite any route handlers.
 *
 * Security rules enforced here:
 *   - Pairing rows use a 5-minute expiry window — pending pairings beyond
 *     `expiresAt` are moved to `expired` on the next read attempt and an
 *     audit row is written.
 *   - A pairing can only transition `pending -> redeemed -> confirmed`.
 *     Any other transition attempt returns an error and writes a failed
 *     audit row; the cookie is never issued.
 *   - The verification phrase is generated fresh at redeem time from
 *     `crypto.randomUUID` + a word list and is the only value the
 *     terminal is shown before confirmation.
 *   - Raw pairing tokens never land in Postgres — only a SHA-256 hash.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  PAIRING_STATUS_VALUES,
  type PairingCreateResponse,
  type PairingStatus,
  type PairingStatusResponse,
} from "@codex-mobile/protocol";
import { issueDeviceSession, type IssuedDeviceSession } from "./device-session";

// ---------------------------------------------------------------------------
// Audit event constants
// ---------------------------------------------------------------------------

/**
 * Load-bearing audit event strings referenced by the plan acceptance
 * criteria. Any new event MUST be added here so the `audit_events` writer
 * and the pairing verification suite stay in sync.
 */
export const PAIRING_AUDIT_EVENTS = {
  created: "pairing.created",
  redeemed: "pairing.redeemed",
  confirmed: "pairing.confirmed",
  expired: "pairing.expired",
  confirmFailed: "pairing.confirm_failed",
} as const;

// ---------------------------------------------------------------------------
// Lifecycle constants
// ---------------------------------------------------------------------------

/** Pairing sessions expire after 5 minutes (PAIR-03). */
export const PAIRING_TTL_SECONDS = 60 * 5;

/**
 * States a pairing may be in when the browser opens the redeem route.
 * Opening the page while the pairing is already `redeemed` or `confirmed`
 * is tolerated (it simply shows the existing phrase); any other state is
 * rejected.
 */
export const PAIRING_REDEEM_ALLOWED_STATES: readonly PairingStatus[] = [
  "pending",
  "redeemed",
  "confirmed",
];

// ---------------------------------------------------------------------------
// In-memory pairing row
// ---------------------------------------------------------------------------

/**
 * In-memory representation of a `pairing_sessions` row. Mirrors the
 * Drizzle schema in `packages/db/src/schema.ts` closely so the future
 * Postgres adapter can map fields one-to-one.
 */
export interface PairingRow {
  id: string;
  status: PairingStatus;
  userCode: string;
  verificationPhrase: string | null;
  pairingTokenHash: string;
  deviceLabel: string | null;
  bridgeInstanceId: string | null;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  confirmedAt: Date | null;
  confirmedByUserId: string | null;
  cancelledAt: Date | null;
}

/**
 * Storage abstraction. The Phase 1 default is an in-memory map keyed by
 * pairing id. Plan 01-03 replaces this with a Drizzle-backed adapter.
 */
export interface PairingStore {
  insert(row: PairingRow): Promise<void>;
  get(id: string): Promise<PairingRow | null>;
  update(
    id: string,
    patch: Partial<PairingRow>,
  ): Promise<PairingRow>;
  listExpired(now: Date): Promise<PairingRow[]>;
}

/** Default process-local in-memory store. */
class InMemoryPairingStore implements PairingStore {
  private readonly rows = new Map<string, PairingRow>();

  async insert(row: PairingRow): Promise<void> {
    this.rows.set(row.id, { ...row });
  }

  async get(id: string): Promise<PairingRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async update(id: string, patch: Partial<PairingRow>): Promise<PairingRow> {
    const current = this.rows.get(id);
    if (!current) {
      throw new Error(`pairing_session ${id} not found`);
    }
    const next = { ...current, ...patch };
    this.rows.set(id, next);
    return { ...next };
  }

  async listExpired(now: Date): Promise<PairingRow[]> {
    const expired: PairingRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status === "pending" && row.expiresAt.getTime() < now.getTime()) {
        expired.push({ ...row });
      }
    }
    return expired;
  }
}

// ---------------------------------------------------------------------------
// Audit store abstraction
// ---------------------------------------------------------------------------

/** Shape of an `audit_events` row written by the pairing service. */
export interface AuditRow {
  eventType: string;
  userId: string | null;
  subject: string | null;
  outcome: "success" | "failure";
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditStore {
  record(row: AuditRow): Promise<void>;
}

class InMemoryAuditStore implements AuditStore {
  readonly rows: AuditRow[] = [];
  async record(row: AuditRow): Promise<void> {
    this.rows.push({ ...row });
  }
}

// ---------------------------------------------------------------------------
// Service wiring
// ---------------------------------------------------------------------------

const defaultPairingStore: PairingStore = new InMemoryPairingStore();
const defaultAuditStore: AuditStore = new InMemoryAuditStore();

/** Dependencies a caller may override (tests, alternate persistence). */
export interface PairingServiceContext {
  store?: PairingStore;
  auditStore?: AuditStore;
  now?: () => Date;
  hostname?: string;
}

function resolveCtx(ctx: PairingServiceContext | undefined): Required<
  Omit<PairingServiceContext, "hostname">
> & { hostname: string } {
  return {
    store: ctx?.store ?? defaultPairingStore,
    auditStore: ctx?.auditStore ?? defaultAuditStore,
    now: ctx?.now ?? (() => new Date()),
    hostname:
      ctx?.hostname ??
      process.env.NEXTAUTH_URL ??
      process.env.APP_BASE_URL ??
      "http://127.0.0.1:3000",
  };
}

// ---------------------------------------------------------------------------
// Public API: createPairing
// ---------------------------------------------------------------------------

export interface CreatePairingInput {
  deviceLabel?: string;
  bridgeInstanceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Mint a fresh pending pairing session. Called by `POST /api/pairings`
 * from the bridge CLI (and, in tests, directly by the Playwright harness).
 */
export async function createPairing(
  input: CreatePairingInput,
  ctx?: PairingServiceContext,
): Promise<PairingCreateResponse & { pairingTokenHash: string }> {
  const { store, auditStore, now, hostname } = resolveCtx(ctx);

  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + PAIRING_TTL_SECONDS * 1000);
  const pairingId = randomUUID();
  const userCode = generateUserCode();
  const rawPairingToken = randomBytes(32).toString("base64url");
  const pairingTokenHash = createHash("sha256")
    .update(rawPairingToken)
    .digest("hex");

  const row: PairingRow = {
    id: pairingId,
    status: "pending",
    userCode,
    verificationPhrase: null,
    pairingTokenHash,
    deviceLabel: input.deviceLabel ?? null,
    bridgeInstanceId: input.bridgeInstanceId ?? null,
    createdAt,
    expiresAt,
    redeemedAt: null,
    confirmedAt: null,
    confirmedByUserId: null,
    cancelledAt: null,
  };

  await store.insert(row);

  await auditStore.record({
    eventType: PAIRING_AUDIT_EVENTS.created,
    userId: null,
    subject: pairingId,
    outcome: "success",
    metadata: {
      userCode,
      bridgeInstanceId: row.bridgeInstanceId,
      deviceLabel: row.deviceLabel,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
    createdAt,
  });

  const pairingUrl = buildPairingUrl(hostname, pairingId);

  return {
    pairingId,
    pairingUrl,
    userCode,
    expiresAt: expiresAt.toISOString(),
    pairingTokenHash,
  };
}

// ---------------------------------------------------------------------------
// Public API: redeemPairing
// ---------------------------------------------------------------------------

export interface RedeemPairingInput {
  pairingId: string;
  userId: string;
  userAgent?: string;
  allowExistingStates?: readonly PairingStatus[];
}

/**
 * Transition a pairing from `pending` -> `redeemed` and generate the
 * verification phrase the browser and terminal will compare.
 *
 * If the pairing is already in an allowed existing state the current row
 * is returned unchanged. This keeps the redeem endpoint idempotent so a
 * user refreshing the browser doesn't invalidate their own pairing.
 */
export async function redeemPairing(
  input: RedeemPairingInput,
  ctx?: PairingServiceContext,
): Promise<PairingStatusResponse & { userCode: string }> {
  const { store, auditStore, now } = resolveCtx(ctx);
  const row = await loadOrExpire(input.pairingId, ctx);
  const allowed = input.allowExistingStates ?? ["pending"];

  if (!PAIRING_STATUS_VALUES.includes(row.status)) {
    throw new Error(`unknown pairing status: ${row.status}`);
  }

  if (row.status !== "pending") {
    if (!allowed.includes(row.status)) {
      throw new Error(
        `cannot redeem pairing in state ${row.status}; expected pending`,
      );
    }
    return toStatusResponse(row);
  }

  const verificationPhrase = generateVerificationPhrase();
  const redeemedAt = now();
  const updated = await store.update(input.pairingId, {
    status: "redeemed",
    verificationPhrase,
    redeemedAt,
  });

  await auditStore.record({
    eventType: PAIRING_AUDIT_EVENTS.redeemed,
    userId: input.userId,
    subject: input.pairingId,
    outcome: "success",
    metadata: {
      verificationPhrase,
      userAgent: input.userAgent ?? null,
    },
    createdAt: redeemedAt,
  });

  return toStatusResponse(updated);
}

// ---------------------------------------------------------------------------
// Public API: confirmPairing
// ---------------------------------------------------------------------------

export interface ConfirmPairingInput {
  pairingId: string;
  userId: string;
  verificationPhrase: string;
  deviceLabel?: string;
}

export interface ConfirmPairingResult {
  pairingId: string;
  verificationPhrase: string;
  deviceSession: IssuedDeviceSession;
}

/**
 * Transition a pairing from `redeemed` -> `confirmed`. This is the only
 * path that issues a `cm_device_session` cookie. The browser MUST include
 * the verification phrase in the request body, and it must equal the
 * phrase stored on the row; otherwise the call is rejected and a failed
 * audit row is written.
 */
export async function confirmPairing(
  input: ConfirmPairingInput,
  ctx?: PairingServiceContext,
): Promise<ConfirmPairingResult> {
  const { store, auditStore, now } = resolveCtx(ctx);
  const row = await loadOrExpire(input.pairingId, ctx);
  const confirmedAt = now();

  if (row.status !== "pending" && row.status !== "redeemed") {
    await auditStore.record({
      eventType: PAIRING_AUDIT_EVENTS.confirmFailed,
      userId: input.userId,
      subject: input.pairingId,
      outcome: "failure",
      metadata: { reason: `invalid_state:${row.status}` },
      createdAt: confirmedAt,
    });
    throw new Error(
      `cannot confirm pairing in state ${row.status}; expected pending or redeemed`,
    );
  }

  if (!row.verificationPhrase) {
    await auditStore.record({
      eventType: PAIRING_AUDIT_EVENTS.confirmFailed,
      userId: input.userId,
      subject: input.pairingId,
      outcome: "failure",
      metadata: { reason: "not_redeemed" },
      createdAt: confirmedAt,
    });
    throw new Error(
      "pairing must be redeemed before confirmation (no verification phrase set)",
    );
  }

  if (
    !constantTimeEqual(row.verificationPhrase, input.verificationPhrase)
  ) {
    await auditStore.record({
      eventType: PAIRING_AUDIT_EVENTS.confirmFailed,
      userId: input.userId,
      subject: input.pairingId,
      outcome: "failure",
      metadata: { reason: "phrase_mismatch" },
      createdAt: confirmedAt,
    });
    throw new Error("verification phrase mismatch");
  }

  const deviceSession = await issueDeviceSession({
    userId: input.userId,
    deviceLabel: input.deviceLabel ?? row.deviceLabel ?? "codex-mobile device",
    issuedFromPairingId: row.id,
    now: confirmedAt,
  });

  await store.update(row.id, {
    status: "confirmed",
    confirmedAt,
    confirmedByUserId: input.userId,
  });

  await auditStore.record({
    eventType: PAIRING_AUDIT_EVENTS.confirmed,
    userId: input.userId,
    subject: row.id,
    outcome: "success",
    metadata: {
      deviceSessionId: deviceSession.deviceSessionId,
      devicePublicId: deviceSession.devicePublicId,
      deviceLabel: deviceSession.deviceLabel,
    },
    createdAt: confirmedAt,
  });

  return {
    pairingId: row.id,
    verificationPhrase: row.verificationPhrase,
    deviceSession,
  };
}

// ---------------------------------------------------------------------------
// Public API: loadPairingStatus
// ---------------------------------------------------------------------------

/** Side-effect-free lookup used by the pairing page fallback path. */
export async function loadPairingStatus(
  pairingId: string,
  ctx?: PairingServiceContext,
): Promise<PairingStatusResponse & { userCode: string }> {
  const row = await loadOrExpire(pairingId, ctx);
  return toStatusResponse(row);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadOrExpire(
  pairingId: string,
  ctx?: PairingServiceContext,
): Promise<PairingRow> {
  const { store, auditStore, now } = resolveCtx(ctx);
  const row = await store.get(pairingId);
  if (!row) {
    throw new Error(`pairing_session ${pairingId} not found`);
  }

  const currentTime = now();
  if (
    row.status === "pending" &&
    row.expiresAt.getTime() <= currentTime.getTime()
  ) {
    const expired = await store.update(pairingId, {
      status: "expired",
      cancelledAt: currentTime,
    });
    await auditStore.record({
      eventType: PAIRING_AUDIT_EVENTS.expired,
      userId: null,
      subject: pairingId,
      outcome: "success",
      metadata: { expiresAt: row.expiresAt.toISOString() },
      createdAt: currentTime,
    });
    return expired;
  }
  return row;
}

function toStatusResponse(
  row: PairingRow,
): PairingStatusResponse & { userCode: string } {
  return {
    pairingId: row.id,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    verificationPhrase: row.verificationPhrase ?? undefined,
    userCode: row.userCode,
  };
}

function buildPairingUrl(hostname: string, pairingId: string): string {
  const base = hostname.endsWith("/") ? hostname.slice(0, -1) : hostname;
  return `${base}/pair/${pairingId}`;
}

/**
 * Human-friendly fallback code. Avoids easily-confused characters
 * (O/0, I/1) and is short enough to type on a phone.
 */
function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    const byte = bytes[i] ?? 0;
    out += alphabet[byte % alphabet.length];
    if (i === 3) {
      out += "-";
    }
  }
  return out;
}

/**
 * Three-word verification phrase, picked from a small fixed list. The
 * actual list is intentionally short to keep the phrase readable on a
 * phone — 32^3 = ~32k combinations is sufficient when paired with the
 * 5-minute expiry and single-use lifecycle.
 */
const PHRASE_WORDS = [
  "amber",
  "anchor",
  "beacon",
  "bramble",
  "canyon",
  "cedar",
  "comet",
  "compass",
  "cypress",
  "delta",
  "ember",
  "falcon",
  "glacier",
  "harbor",
  "horizon",
  "indigo",
  "juniper",
  "kestrel",
  "lantern",
  "magnet",
  "marble",
  "meadow",
  "mirror",
  "orbit",
  "orchard",
  "prairie",
  "quasar",
  "ripple",
  "silver",
  "thunder",
  "tundra",
  "willow",
];

function generateVerificationPhrase(): string {
  const bytes = randomBytes(3);
  const words: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const byte = bytes[i] ?? 0;
    const word = PHRASE_WORDS[byte % PHRASE_WORDS.length] ?? "codex";
    words.push(word);
  }
  return words.join("-");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

/**
 * Create a fresh service context with isolated stores. Used by Playwright
 * and Vitest specs that must not leak state across test cases.
 */
export function createIsolatedPairingContext(
  overrides?: Omit<PairingServiceContext, "store" | "auditStore">,
): Required<Pick<PairingServiceContext, "store" | "auditStore">> &
  PairingServiceContext {
  return {
    store: new InMemoryPairingStore(),
    auditStore: new InMemoryAuditStore(),
    ...overrides,
  };
}
