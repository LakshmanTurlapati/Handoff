/**
 * Main-process helper that mints a single-use ElevenLabs Scribe v2
 * Realtime STT token (SAFE-01).
 *
 * Where this module is allowed to run:
 *   ONLY the Electron main process or an equivalent server-side surface
 *   that holds the ElevenLabs API key. The renderer-facing barrel
 *   (`@achilles/voice-stt`) does NOT re-export this module; instead it
 *   is shipped at a separate exports subpath
 *   (`@achilles/voice-stt/token-mint`) so that a renderer bundle that
 *   only imports the default barrel cannot accidentally drag in the
 *   `xi-api-key` header literal that lives here.
 *
 * Why this lives behind a separate exports subpath:
 *   SAFE-01 requires the API key never reach the renderer. The realtime
 *   client signature deliberately accepts only a `getToken` callback,
 *   never the key. This file is the one place in the package that
 *   touches the raw key, and isolating it on its own subpath lets us
 *   grep-assert (`safe-01.test.ts`) that the renderer-exported dist
 *   files contain no occurrence of `xi-api-key` or a `sk_...` key
 *   prefix.
 */
import { assertElevenLabsHost } from "@achilles/voice-protocol";
import { TOKEN_MINT_URL } from "./constants.js";

/**
 * Result returned to the main process after a successful mint. The
 * shape is intentionally narrow — `token` is the short-lived realtime
 * credential and `expiresAt` is the absolute ISO-8601 timestamp at
 * which the token stops being accepted. Crucially this object does NOT
 * expose `apiKey` in any form.
 */
export interface MintSttTokenResult {
  token: string;
  expiresAt: string;
}

/**
 * Inputs for {@link mintSttToken}.
 *
 * - `apiKey`: the raw ElevenLabs API key, read in main only (e.g. from
 *   Electron `safeStorage` in Phase 11). Never logged.
 * - `endpoint`: optional override for the mint URL. Useful for regional
 *   residency hosts. The host MUST pass the SAFE-03 allowlist; the
 *   function asserts that before making any network call.
 * - `fetchImpl`: optional `fetch` implementation. Defaults to the
 *   ambient `globalThis.fetch`. The test suite passes a stub here.
 */
export interface MintSttTokenOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Body POSTed to `/v1/realtime/token`. The literal `"realtime_scribe"`
 * is documented by ElevenLabs as the discriminator for the Scribe
 * single-use token flow.
 */
const TOKEN_MINT_BODY = { type: "realtime_scribe" } as const;

/**
 * Shape of an ElevenLabs 429 error body. Only `detail.status` is read;
 * any other shape is treated as `"unknown"`.
 */
interface ElevenLabsErrorBody {
  detail?: {
    status?: string;
  };
}

/**
 * POST `/v1/realtime/token` and return a single-use STT token.
 *
 * Error mapping (PITFALLS #4):
 *   - HTTP 401/403           -> Error with code "auth"
 *   - HTTP 429 + status="too_many_concurrent_requests"
 *                            -> Error with code "concurrent_limit"
 *   - HTTP 429 + status="system_busy"
 *                            -> Error with code "rate_limit"
 *   - HTTP 429 + anything else
 *                            -> Error with code "rate_limit" (default)
 *   - Other non-2xx          -> Error with code "unknown"
 *
 * Each thrown error carries a `code` property in addition to its
 * message so the caller can branch on the typed code without parsing
 * the string. The `code` property uses the same vocabulary as
 * `SttErrorEventSchema` in `@achilles/voice-protocol`.
 */
export async function mintSttToken(
  opts: MintSttTokenOptions,
): Promise<MintSttTokenResult> {
  const endpoint = opts.endpoint ?? TOKEN_MINT_URL;
  // SAFE-03 enforcement — runs BEFORE any network I/O so a misconfigured
  // endpoint surfaces at the call site with the SAFE-03 marker rather
  // than as an opaque network error later.
  assertElevenLabsHost(endpoint);

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "mintSttToken: no fetch implementation available (pass `fetchImpl` or run on a runtime with global fetch)",
    );
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(TOKEN_MINT_BODY),
  });

  if (response.status === 401 || response.status === 403) {
    throw createMintError("auth", `mintSttToken: HTTP ${response.status} auth`);
  }

  if (response.status === 429) {
    let body: ElevenLabsErrorBody = {};
    try {
      body = (await response.json()) as ElevenLabsErrorBody;
    } catch {
      // Body wasn't JSON; default to rate_limit.
    }
    const innerStatus = body.detail?.status;
    if (innerStatus === "too_many_concurrent_requests") {
      throw createMintError(
        "concurrent_limit",
        "mintSttToken: HTTP 429 too_many_concurrent_requests",
      );
    }
    throw createMintError("rate_limit", "mintSttToken: HTTP 429 rate_limit");
  }

  if (!response.ok) {
    throw createMintError(
      "unknown",
      `mintSttToken: HTTP ${response.status} unknown error`,
    );
  }

  const data = (await response.json()) as {
    token: string;
    expires_at: string;
  };
  if (typeof data.token !== "string" || typeof data.expires_at !== "string") {
    throw createMintError(
      "unknown",
      "mintSttToken: malformed response body (token/expires_at missing)",
    );
  }

  // Note: the returned object intentionally has only `token` and
  // `expiresAt` — no `apiKey` field. Defence in depth against an
  // accidental future widening of this interface.
  return { token: data.token, expiresAt: data.expires_at };
}

/**
 * Typed error code attached to errors thrown by `mintSttToken`. The
 * vocabulary mirrors `STT_ERROR_CODES` in `@achilles/voice-protocol`
 * so a caller can forward the code into an `SttErrorEvent`.
 */
export type MintSttErrorCode =
  | "auth"
  | "rate_limit"
  | "concurrent_limit"
  | "unknown";

/**
 * Error shape thrown by `mintSttToken`. The `code` field is the typed
 * discriminator; `message` is human-readable.
 */
export interface MintSttError extends Error {
  code: MintSttErrorCode;
}

function createMintError(code: MintSttErrorCode, message: string): MintSttError {
  const err = new Error(message) as MintSttError;
  err.code = code;
  return err;
}
