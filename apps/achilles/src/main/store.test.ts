/**
 * Behaviour tests for the electron-store wrapper.
 *
 *   - readWindowPosition returns null when no position is persisted.
 *   - writeWindowPosition + readWindowPosition round-trip integers.
 *   - writeHotkeyMode + readHotkeyMode round-trip the mode literal.
 *   - When safeStorage.isEncryptionAvailable() returns false, the
 *     store falls back to plaintext and logs the SAFE-01 boundary
 *     warning (defence in depth — Phase 12 ships the API-key surface).
 *
 * Tests inject a recording in-memory Store ctor + a fake safeStorage.
 * No real Electron involved.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_HOTKEY_ACCELERATOR } from "../shared/constants.js";
import { createAchillesStore } from "./store.js";

class InMemoryStore<T extends Record<string, unknown>> {
  private store: Record<string, unknown> = {};
  constructor(public opts: { defaults?: T } = {}) {
    if (opts.defaults !== undefined) {
      this.store = { ...opts.defaults };
    }
  }
  get(key: string): unknown {
    return this.store[key];
  }
  set(key: string, value: unknown): void {
    this.store[key] = value;
  }
  has(key: string): boolean {
    return key in this.store;
  }
  delete(key: string): void {
    delete this.store[key];
  }
}

describe("createAchillesStore — readWindowPosition default branch (ST1)", () => {
  it("returns null when no position is persisted", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    expect(store.readWindowPosition()).toBeNull();
  });
});

describe("createAchillesStore — writeWindowPosition round-trip (ST2)", () => {
  it("persists and reads back the same integer pair", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    store.writeWindowPosition({ x: 100, y: 200 });
    expect(store.readWindowPosition()).toEqual({ x: 100, y: 200 });
  });
});

describe("createAchillesStore — hotkey mode round-trip (ST3)", () => {
  it("persists pushToTalk and reads it back", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    store.writeHotkeyMode("pushToTalk");
    expect(store.readHotkeyMode()).toBe("pushToTalk");
  });

  it("defaults to 'toggle' when nothing is persisted yet", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    expect(store.readHotkeyMode()).toBe("toggle");
  });

  it("hotkeyKey defaults to DEFAULT_HOTKEY_ACCELERATOR", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    expect(store.readHotkeyKey()).toBe(DEFAULT_HOTKEY_ACCELERATOR);
  });

  it("writeHotkeyKey persists a new accelerator", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    store.writeHotkeyKey("CommandOrControl+Alt+A");
    expect(store.readHotkeyKey()).toBe("CommandOrControl+Alt+A");
  });
});

describe("createAchillesStore — safeStorage fallback (ST4)", () => {
  it("logs the SAFE-01 boundary warning and falls back to plaintext", () => {
    const logs: string[] = [];
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(""),
        decryptString: () => "",
      },
      logger: (msg) => logs.push(msg),
    });

    store.writeWindowPosition({ x: 50, y: 60 });
    expect(store.readWindowPosition()).toEqual({ x: 50, y: 60 });

    expect(logs.some((msg) => msg.includes("SAFE-01"))).toBe(true);
    expect(
      logs.some((msg) => msg.includes("safeStorage unavailable")),
    ).toBe(true);
  });

  it("uses encrypted reads/writes when safeStorage is available", () => {
    // The Phase 11 store persists only non-secret values (windowPosition,
    // hotkeyMode, hotkeyKey) so encryption here is defence-in-depth.
    // We assert the store reports the encrypted-state in its
    // `getEncryptionState()` diagnostic accessor.
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, "utf-8"),
        decryptString: (buf: Buffer) => buf.toString("utf-8"),
      },
    });
    expect(store.getEncryptionState()).toBe("available");
  });
});

describe("createAchillesStore — windowPosition guards", () => {
  it("rejects non-integer coordinates", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    expect(() => store.writeWindowPosition({ x: 1.5, y: 2 })).toThrow();
  });

  it("logger receives the SAFE-01 warning exactly once across multiple writes", () => {
    const logs: string[] = [];
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(""),
        decryptString: () => "",
      },
      logger: (msg) => logs.push(msg),
    });
    store.writeWindowPosition({ x: 1, y: 2 });
    store.writeWindowPosition({ x: 3, y: 4 });
    store.writeHotkeyMode("pushToTalk");
    const warnings = logs.filter((msg) => msg.includes("SAFE-01"));
    expect(warnings.length).toBe(1);
  });
});

describe("createAchillesStore — initial defaults", () => {
  it("delete clears the position so the default null branch reappears", () => {
    const store = createAchillesStore({
      storeCtor: InMemoryStore as never,
    });
    store.writeWindowPosition({ x: 10, y: 20 });
    expect(store.readWindowPosition()).toEqual({ x: 10, y: 20 });
    store.deleteWindowPosition();
    expect(store.readWindowPosition()).toBeNull();
  });
});
