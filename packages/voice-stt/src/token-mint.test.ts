import { describe, expect, it, vi } from "vitest";
import type { MintSttError } from "./token-mint.js";
import { mintSttToken } from "./token-mint.js";

/**
 * Helper that builds a minimal stub `fetch` whose `Response` returns
 * the provided status and JSON body. We avoid relying on the global
 * `Response` constructor so the tests work in pure-Node Vitest projects
 * without a DOM polyfill.
 */
function makeFetchStub(opts: {
  status: number;
  body?: unknown;
  ok?: boolean;
}): typeof fetch {
  const ok = opts.ok ?? (opts.status >= 200 && opts.status < 300);
  return vi.fn(async () => {
    return {
      ok,
      status: opts.status,
      async json() {
        return opts.body ?? {};
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const VALID_API_KEY = "sk_test_long_enough_value_for_testing_purposes_only";

describe("mintSttToken — happy path", () => {
  it("POSTs to /v1/realtime/token with xi-api-key and the realtime_scribe body", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      // Capture the call for inspection inside the test body.
      void url;
      void init;
      return {
        ok: true,
        status: 200,
        async json() {
          return { token: "tok_abc", expires_at: "2026-06-06T11:15:00Z" };
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await mintSttToken({
      apiKey: VALID_API_KEY,
      fetchImpl,
    });

    expect(result).toEqual({
      token: "tok_abc",
      expiresAt: "2026-06-06T11:15:00Z",
    });

    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(callArgs).toBeDefined();
    const [calledUrl, init] = callArgs as [string, RequestInit];
    expect(calledUrl).toBe("https://api.elevenlabs.io/v1/realtime/token");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe(VALID_API_KEY);
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as { type: string };
    expect(body.type).toBe("realtime_scribe");
  });

  it("does NOT include an `apiKey` field on the resolved result (SAFE-01)", async () => {
    const fetchImpl = makeFetchStub({
      status: 200,
      body: { token: "tok_xyz", expires_at: "2026-06-06T11:30:00Z" },
    });

    const result = await mintSttToken({
      apiKey: VALID_API_KEY,
      fetchImpl,
    });

    const keys = Object.keys(result);
    expect(keys.sort()).toEqual(["expiresAt", "token"]);
    // Defence-in-depth: explicit `apiKey` absence check.
    expect((result as { apiKey?: unknown }).apiKey).toBeUndefined();
  });

  it("accepts a regional endpoint that passes the SAFE-03 allowlist", async () => {
    const fetchImpl = makeFetchStub({
      status: 200,
      body: { token: "tok_eu", expires_at: "2026-06-06T11:45:00Z" },
    });

    const result = await mintSttToken({
      apiKey: VALID_API_KEY,
      endpoint: "https://api.eu.residency.elevenlabs.io/v1/realtime/token",
      fetchImpl,
    });

    expect(result.token).toBe("tok_eu");
  });
});

describe("mintSttToken — error mapping (PITFALLS #4)", () => {
  it("rejects a non-ElevenLabs endpoint with SAFE-03 in the message (before any fetch)", async () => {
    const fetchImpl = vi.fn();
    await expect(
      mintSttToken({
        apiKey: VALID_API_KEY,
        endpoint: "https://evil.com/token",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/SAFE-03/);
    // SAFE-03 enforcement runs before any network attempt.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws an `auth`-coded error on HTTP 401", async () => {
    const fetchImpl = makeFetchStub({ status: 401, body: {} });
    try {
      await mintSttToken({ apiKey: VALID_API_KEY, fetchImpl });
      expect.fail("mintSttToken should have thrown");
    } catch (err) {
      const e = err as MintSttError;
      expect(e.code).toBe("auth");
      expect(e.message.toLowerCase()).toContain("auth");
    }
  });

  it("throws an `auth`-coded error on HTTP 403", async () => {
    const fetchImpl = makeFetchStub({ status: 403, body: {} });
    try {
      await mintSttToken({ apiKey: VALID_API_KEY, fetchImpl });
      expect.fail("mintSttToken should have thrown");
    } catch (err) {
      const e = err as MintSttError;
      expect(e.code).toBe("auth");
    }
  });

  it("throws a `concurrent_limit`-coded error on HTTP 429 with too_many_concurrent_requests", async () => {
    const fetchImpl = makeFetchStub({
      status: 429,
      body: { detail: { status: "too_many_concurrent_requests" } },
    });
    try {
      await mintSttToken({ apiKey: VALID_API_KEY, fetchImpl });
      expect.fail("mintSttToken should have thrown");
    } catch (err) {
      const e = err as MintSttError;
      expect(e.code).toBe("concurrent_limit");
    }
  });

  it("throws a `rate_limit`-coded error on HTTP 429 with system_busy", async () => {
    const fetchImpl = makeFetchStub({
      status: 429,
      body: { detail: { status: "system_busy" } },
    });
    try {
      await mintSttToken({ apiKey: VALID_API_KEY, fetchImpl });
      expect.fail("mintSttToken should have thrown");
    } catch (err) {
      const e = err as MintSttError;
      expect(e.code).toBe("rate_limit");
    }
  });

  it("throws an `unknown`-coded error on HTTP 500", async () => {
    const fetchImpl = makeFetchStub({ status: 500, body: {} });
    try {
      await mintSttToken({ apiKey: VALID_API_KEY, fetchImpl });
      expect.fail("mintSttToken should have thrown");
    } catch (err) {
      const e = err as MintSttError;
      expect(e.code).toBe("unknown");
    }
  });
});
