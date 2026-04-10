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
import {
  PairingCreateResponseSchema,
  PairingStatusResponseSchema,
  PairingConfirmResponseSchema,
  type PairingCreateResponse,
  type PairingStatusResponse,
  type PairingConfirmResponse,
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

export class PairingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: PairingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? "codex-mobile-bridge/0.1.0";
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
      },
    });
    if (!response.ok) {
      throw new Error(
        `GET ${PAIRING_COLLECTION_PATH}/${pairingId} failed: ${response.status} ${response.statusText}`,
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
      const status = await this.getPairingStatus(pairingId).catch(() => null);
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
