/**
 * Behaviour tests for the ElevenLabs API key source surface.
 *
 * Plan 12-04 Task 1 — key-source.ts is the single read point in main
 * for the ElevenLabs API key. The contract is:
 *
 *   - Store-first (electron-store via safeStorage), env fallback
 *     (process.env.ELEVENLABS_API_KEY), throw MissingApiKeyError
 *     when both are absent.
 *
 *   - readApiKey logs which source it sourced from but NEVER logs the
 *     key bytes themselves.
 *
 *   - MissingApiKeyError is a named Error subclass so callers can
 *     branch on (err instanceof MissingApiKeyError) for the graceful
 *     "degraded mode" path documented in main/index.ts.
 *
 * The tests inject a fake `store.readElevenlabsApiKey()` and an env
 * object so no real Electron / OS keystore is involved.
 */
import { describe, expect, it, vi } from "vitest";
import { MissingApiKeyError, readApiKey } from "./key-source.js";

function makeStore(value: string | null): {
  readElevenlabsApiKey: () => string | null;
} {
  return {
    readElevenlabsApiKey: () => value,
  };
}

describe("readApiKey — store-first wins (K1)", () => {
  it("returns the store value when both store and env are set", () => {
    const result = readApiKey({
      store: makeStore("store-key-value"),
      env: { ELEVENLABS_API_KEY: "env-key-value" },
      logger: () => undefined,
    });
    expect(result).toBe("store-key-value");
  });

  it("returns the store value when env is unset", () => {
    const result = readApiKey({
      store: makeStore("store-key-value"),
      env: {},
      logger: () => undefined,
    });
    expect(result).toBe("store-key-value");
  });
});

describe("readApiKey — env fallback (K2)", () => {
  it("returns process.env.ELEVENLABS_API_KEY when store is empty", () => {
    const result = readApiKey({
      store: makeStore(null),
      env: { ELEVENLABS_API_KEY: "env-key-value" },
      logger: () => undefined,
    });
    expect(result).toBe("env-key-value");
  });

  it("treats an empty-string store value as absent and falls through to env", () => {
    const result = readApiKey({
      store: makeStore(""),
      env: { ELEVENLABS_API_KEY: "env-key-value" },
      logger: () => undefined,
    });
    expect(result).toBe("env-key-value");
  });
});

describe("readApiKey — both absent throws MissingApiKeyError (K3)", () => {
  it("throws MissingApiKeyError when both sources are absent", () => {
    expect(() =>
      readApiKey({
        store: makeStore(null),
        env: {},
        logger: () => undefined,
      }),
    ).toThrow(MissingApiKeyError);
  });

  it("the thrown error message mentions ELEVENLABS_API_KEY for operator clarity", () => {
    try {
      readApiKey({
        store: makeStore(null),
        env: {},
        logger: () => undefined,
      });
      expect.fail("readApiKey should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("ELEVENLABS_API_KEY");
    }
  });

  it("treats an empty env value as absent", () => {
    expect(() =>
      readApiKey({
        store: makeStore(null),
        env: { ELEVENLABS_API_KEY: "" },
        logger: () => undefined,
      }),
    ).toThrow(MissingApiKeyError);
  });
});

describe("MissingApiKeyError — typed error subclass (K4)", () => {
  it("has name === 'MissingApiKeyError'", () => {
    const err = new MissingApiKeyError();
    expect(err.name).toBe("MissingApiKeyError");
  });

  it("is an instanceof Error AND MissingApiKeyError", () => {
    const err = new MissingApiKeyError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MissingApiKeyError);
  });
});

describe("readApiKey — logging discipline (K5)", () => {
  it("logs a single [achilles] message indicating the source (store)", () => {
    const logger = vi.fn();
    readApiKey({
      store: makeStore("store-key-value"),
      env: {},
      logger,
    });
    expect(logger).toHaveBeenCalledTimes(1);
    const msg = String(logger.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[achilles]");
    expect(msg).toContain("store");
  });

  it("logs a single [achilles] message indicating the source (env)", () => {
    const logger = vi.fn();
    readApiKey({
      store: makeStore(null),
      env: { ELEVENLABS_API_KEY: "env-key-value" },
      logger,
    });
    expect(logger).toHaveBeenCalledTimes(1);
    const msg = String(logger.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[achilles]");
    expect(msg).toContain("env");
  });

  it("NEVER logs the key bytes themselves", () => {
    const logger = vi.fn();
    readApiKey({
      store: makeStore("ULTRASECRETKEY12345"),
      env: { ELEVENLABS_API_KEY: "ANOTHERSECRETXX98765" },
      logger,
    });
    const allMsgs = logger.mock.calls
      .map((c) => String(c[0] ?? ""))
      .join("\n");
    expect(allMsgs).not.toContain("ULTRASECRETKEY12345");
    expect(allMsgs).not.toContain("ANOTHERSECRETXX98765");
  });

  it("does not log when MissingApiKeyError is thrown", () => {
    const logger = vi.fn();
    expect(() =>
      readApiKey({
        store: makeStore(null),
        env: {},
        logger,
      }),
    ).toThrow();
    // No success-path log was emitted; the throw is the signal.
    expect(logger).not.toHaveBeenCalled();
  });
});
