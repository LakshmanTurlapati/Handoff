/**
 * Typed HTTP client used by the bridge CLI to talk to the hosted
 * pairing API exposed by `apps/web`.
 *
 * Endpoints consumed:
 *   - POST /api/pairings                                (create)
 *   - POST /api/pairings/[pairingId]/confirm            (final approval)
 *   - GET  /api/pairings/[pairingId]                    (status poll)
 *
 * Design rules:
 *   - Route strings are declared once at the top of the file as
 *     constants so the plan's <verify> block can grep for the exact
 *     `/api/pairings` path inside this file.
 *   - Every response is validated at runtime against the shared
 *     `@codex-mobile/protocol` Zod schemas — the bridge must never
 *     trust a payload the hosted app sent without validating it.
 *   - The client only makes outbound calls. It never opens an inbound
 *     port and never stores long-lived credentials on disk; raw
 *     bearer tokens passed here are kept in memory only.
 */
import { z } from "zod";
import {
  PairingCreateResponseSchema,
  PairingStatusResponseSchema,
  PairingConfirmResponseSchema,
  ThreadHandoffRecordSchema,
  type PairingCreateResponse,
  type PairingStatusResponse,
  type PairingConfirmResponse,
  type ThreadHandoffRecord,
} from "@codex-mobile/protocol";

/**
 * Relative path for the pairing collection endpoint. Kept as an exported
 * constant so callers can log it and the plan acceptance criteria can
 * grep for `/api/pairings` inside this file.
 */
export const PAIRING_COLLECTION_PATH = "/api/pairings";

/** Default polling cadence while waiting for the browser to redeem. */
export const DEFAULT_POLL_INTERVAL_MS = 1500;

/** Default overall timeout for a full pairing attempt (6 minutes). */
export const DEFAULT_POLL_TIMEOUT_MS = 6 * 60 * 1000;

export interface PairingClientOptions {
  /** Absolute base URL of the hosted apps/web deployment. */
  baseUrl: string;
  /** Optional fetch implementation (test injection). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional User-Agent header value sent on every request. */
  userAgent?: string;
  /** Optional bridge bootstrap token for bridge-owned routes. */
  bridgeBootstrapToken?: string;
}

export interface CreatePairingRequest {
  deviceLabel?: string;
  bridgeInstanceId?: string;
}

export interface ConfirmPairingRequest {
  verificationPhrase: string;
  deviceLabel?: string;
  /** Cookie header value the browser must have supplied (for tests). */
  cookie?: string;
}

export interface BridgeConnectTicketRequest {
  bridgeInstallationId: string;
  bridgeBootstrapToken: string;
}

export interface CreateHandoffRequest {
  bridgeInstallationId: string;
  bridgeInstanceId: string;
  threadId: string;
  sessionId: string;
}

export interface BridgeConnectTicketResponse {
  relayUrl: string;
  ticket: string;
  expiresAt: string;
  bridgeInstallationId: string;
}

const BridgeConnectTicketResponseSchema: z.ZodType<BridgeConnectTicketResponse> = z
  .object({
    relayUrl: z.string().url(),
    ticket: z.string().min(1),
    expiresAt: z.string().datetime(),
    bridgeInstallationId: z.string().uuid(),
  })
  .strict();

/**
 * Thrown by `getPairingStatus` (and therefore observed by `waitForRedeem`)
 * when the hosted API returns a non-2xx response. Carries the HTTP status
 * code and the request path so the caller can distinguish transient
 * 5xx errors (retry) from hard 4xx errors (surface to operator).
 *
 * WR-09 from 01-REVIEW.md: the previous polling loop silently swallowed
 * every failure mode by catching and coercing to null, which collapsed
 * auth, schema, and network errors into the same "timed out" symptom as
 * normal pending polls. With PairingPollError the bridge CLI's outer
 * error handler now reports the real HTTP status so operators can fix
 * the root cause instead of guessing at the timeout.
 */
export class PairingPollError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "PairingPollError";
    this.status = status;
    this.path = path;
  }
}

export class PairingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly bridgeBootstrapToken: string | null;
  /**
   * One-time pairing bearer returned by `POST /api/pairings` in the
   * `pairingToken` response field. Held in process memory only — NEVER
   * written to disk, NEVER logged, NEVER sent as a query parameter.
   * Sent as `Authorization: Bearer <token>` on subsequent
   * `getPairingStatus` and `confirmPairing` calls so the server can
   * verify sha256(bearer) against `pairing_sessions.pairingTokenHash`
   * inside `confirmPairing` (SEC-06 / plan 01-05).
   */
  private pairingToken: string | null = null;

  constructor(options: PairingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? "handoff/0.1.0";
    this.bridgeBootstrapToken = options.bridgeBootstrapToken ?? null;
  }

  /**
   * Store (or clear) the one-time pairing bearer. Called automatically
   * by `createPairing` when the server provides a `pairingToken`, and
   * exposed as a public setter so tests can drive the field directly.
   */
  setPairingToken(token: string | null): void {
    this.pairingToken = token;
  }

  /**
   * Build the Authorization header fragment for a call that needs the
   * one-time pairing bearer. Returns `{}` when the token has not yet
   * been set so callers can unconditionally spread the return value
   * into their headers object.
   */
  private authHeaders(): Record<string, string> {
    return this.pairingToken
      ? { authorization: `Bearer ${this.pairingToken}` }
      : {};
  }

  /** POST /api/pairings */
  async createPairing(
    request: CreatePairingRequest = {},
  ): Promise<PairingCreateResponse> {
    const url = this.buildUrl(PAIRING_COLLECTION_PATH);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": this.userAgent,
        accept: "application/json",
      },
      body: JSON.stringify({
        deviceLabel: request.deviceLabel,
        bridgeInstanceId: request.bridgeInstanceId,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `POST ${PAIRING_COLLECTION_PATH} failed: ${response.status} ${response.statusText}`,
      );
    }
    const raw = await response.json();
    const parsed = PairingCreateResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `POST ${PAIRING_COLLECTION_PATH} returned an invalid payload: ${parsed.error.message}`,
      );
    }
    if (parsed.data.pairingToken) {
      this.setPairingToken(parsed.data.pairingToken);
    }
    return parsed.data;
  }

  /** GET /api/pairings/{pairingId} */
  async getPairingStatus(pairingId: string): Promise<PairingStatusResponse> {
    const url = this.buildUrl(`${PAIRING_COLLECTION_PATH}/${encodeURIComponent(pairingId)}`);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "user-agent": this.userAgent,
        accept: "application/json",
        ...this.authHeaders(),
      },
    });
    if (!response.ok) {
      throw new PairingPollError(
        `GET ${PAIRING_COLLECTION_PATH}/${pairingId} failed: ${response.status} ${response.statusText}`,
        response.status,
        `${PAIRING_COLLECTION_PATH}/${pairingId}`,
      );
    }
    const raw = await response.json();
    const parsed = PairingStatusResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `GET ${PAIRING_COLLECTION_PATH}/${pairingId} returned an invalid payload: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /** POST /api/pairings/{pairingId}/confirm */
  async confirmPairing(
    pairingId: string,
    request: ConfirmPairingRequest,
  ): Promise<PairingConfirmResponse> {
    const url = this.buildUrl(
      `${PAIRING_COLLECTION_PATH}/${encodeURIComponent(pairingId)}/confirm`,
    );
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": this.userAgent,
        accept: "application/json",
        ...this.authHeaders(),
        ...(request.cookie ? { cookie: request.cookie } : {}),
      },
      body: JSON.stringify({
        verificationPhrase: request.verificationPhrase,
        deviceLabel: request.deviceLabel,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `POST ${PAIRING_COLLECTION_PATH}/${pairingId}/confirm failed: ${response.status} ${response.statusText}`,
      );
    }
    const raw = await response.json();
    const parsed = PairingConfirmResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `confirm returned an invalid payload: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async createBridgeConnectTicket(
    request: BridgeConnectTicketRequest,
  ): Promise<BridgeConnectTicketResponse> {
    const response = await this.fetchImpl(
      this.buildUrl("/api/bridge/connect-ticket"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": this.userAgent,
          accept: "application/json",
          authorization: `Bearer ${request.bridgeBootstrapToken}`,
        },
        body: JSON.stringify({
          bridgeInstallationId: request.bridgeInstallationId,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `POST /api/bridge/connect-ticket failed: ${response.status} ${response.statusText}`,
      );
    }

    const raw = await response.json();
    const parsed = BridgeConnectTicketResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `/api/bridge/connect-ticket returned an invalid payload: ${parsed.error.message}`,
      );
    }

    return parsed.data;
  }

  async createHandoff(
    request: CreateHandoffRequest,
  ): Promise<ThreadHandoffRecord> {
    if (!this.bridgeBootstrapToken) {
      throw new Error("missing_bridge_bootstrap_token");
    }

    const response = await this.fetchImpl(this.buildUrl("/api/handoffs"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": this.userAgent,
        accept: "application/json",
        authorization: `Bearer ${this.bridgeBootstrapToken}`,
      },
      body: JSON.stringify({
        bridgeInstallationId: request.bridgeInstallationId,
        bridgeInstanceId: request.bridgeInstanceId,
        threadId: request.threadId,
        sessionId: request.sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `POST /api/handoffs failed: ${response.status} ${response.statusText}`,
      );
    }

    const raw = await response.json();
    const parsed = ThreadHandoffRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `/api/handoffs returned an invalid payload: ${parsed.error.message}`,
      );
    }

    return parsed.data;
  }

  /**
   * Poll `getPairingStatus` until the pairing transitions into
   * `redeemed` (so the browser has opened the pairing page and a
   * verification phrase is available) or until the timeout elapses.
   *
   * Returns the final status response. Throws on timeout, on expiry,
   * or on cancellation.
   */
  async waitForRedeem(
    pairingId: string,
    options: {
      intervalMs?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<PairingStatusResponse> {
    const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new Error("pairing wait cancelled");
      }
      let status: PairingStatusResponse | null = null;
      try {
        status = await this.getPairingStatus(pairingId);
      } catch (err) {
        if (err instanceof PairingPollError && err.status >= 500) {
          // Transient server error — retry until deadline.
          status = null;
        } else {
          // 4xx (auth, not found, rate limited) or schema/network errors:
          // surface to the operator instead of swallowing as null. This is
          // the WR-09 fix — previously every error collapsed to a generic
          // "timed out" symptom and operators couldn't tell a real auth
          // failure from normal polling latency.
          throw err;
        }
      }
      if (status && status.status !== "pending") {
        if (status.status === "expired" || status.status === "cancelled") {
          throw new Error(`pairing ${status.status} before redeem completed`);
        }
        return status;
      }
      await sleep(interval);
    }
    throw new Error("timed out waiting for pairing to be redeemed");
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
