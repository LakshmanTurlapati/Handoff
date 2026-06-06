/**
 * Achilles electron-store wrapper.
 *
 * Persists three values to disk:
 *   - windowPosition: { x: number; y: number } | null
 *   - hotkeyMode:     'toggle' | 'pushToTalk'
 *   - hotkeyKey:      Electron accelerator string
 *
 * `safeStorage` is consulted on every read/write. When encryption is
 * available, payloads are serialised + encrypted + base64-encoded
 * before persistence; when it's not (older OS, Linux without a
 * keyring service), we log a `[achilles] safeStorage unavailable …
 * SAFE-01 follow-up in Phase 12` warning and fall back to plaintext.
 *
 * Phase 11 persists only non-secret values (windowPosition + hotkey
 * config), so the plaintext fallback is acceptable — the API-key
 * surface ships in Phase 12 and owns the SAFE-01 contract.
 *
 * The factory is dependency-injected so the unit suite can drive an
 * in-memory store without touching the real electron-store package.
 */
import {
  DEFAULT_HOTKEY_ACCELERATOR,
  HOTKEY_MODES,
} from "../shared/constants.js";
import type { HotkeyMode } from "../shared/constants.js";

const KEY_WINDOW_POSITION = "windowPosition";
const KEY_HOTKEY_MODE = "hotkeyMode";
const KEY_HOTKEY_KEY = "hotkeyKey";

/**
 * Minimal contract a Store implementation must satisfy. Matches the
 * surface area of `electron-store`'s default `Store` class but kept
 * narrow so tests can substitute an in-memory map.
 */
export interface StoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  delete(key: string): void;
}

/**
 * Minimal contract for the Electron `safeStorage` module. Tests pass
 * a fake whose `isEncryptionAvailable` returns false to exercise the
 * SAFE-01 fallback.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(buf: Buffer): string;
}

export interface CreateAchillesStoreOptions {
  storeCtor?: new (opts?: { defaults?: Record<string, unknown> }) => StoreLike;
  safeStorage?: SafeStorageLike;
  logger?: (msg: string) => void;
}

export interface AchillesStore {
  readWindowPosition(): { x: number; y: number } | null;
  writeWindowPosition(pos: { x: number; y: number }): void;
  deleteWindowPosition(): void;
  readHotkeyMode(): HotkeyMode;
  writeHotkeyMode(mode: HotkeyMode): void;
  readHotkeyKey(): string;
  writeHotkeyKey(accelerator: string): void;
  getEncryptionState(): "available" | "unavailable" | "unknown";
}

interface PersistedPosition {
  x: number;
  y: number;
}

function isPersistedPosition(value: unknown): value is PersistedPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger((value as PersistedPosition).x) &&
    Number.isInteger((value as PersistedPosition).y)
  );
}

function isHotkeyMode(value: unknown): value is HotkeyMode {
  return typeof value === "string" && (HOTKEY_MODES as readonly string[]).includes(value);
}

/**
 * Creates the AchillesStore.
 *
 * Production: `storeCtor` defaults to `electron-store` (lazily
 * imported by the main entry point). Tests pass an in-memory class
 * whose `get`/`set`/`has`/`delete` shape matches `StoreLike`.
 */
export function createAchillesStore(
  opts: CreateAchillesStoreOptions = {},
): AchillesStore {
  const StoreCtor = opts.storeCtor;
  if (StoreCtor === undefined) {
    throw new Error(
      "createAchillesStore requires storeCtor; main/index.ts wires electron-store in production.",
    );
  }
  const safeStorage = opts.safeStorage;
  const logger = opts.logger ?? ((msg: string) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  });

  // Determine the encryption state once at construction time so the
  // SAFE-01 warning is logged exactly once per process, not once per
  // write. Defaults to 'unknown' when no safeStorage was injected;
  // the wrapper will then skip encryption entirely.
  let encryptionState: "available" | "unavailable" | "unknown" = "unknown";
  if (safeStorage !== undefined) {
    encryptionState = safeStorage.isEncryptionAvailable()
      ? "available"
      : "unavailable";
  }

  let warnedAboutSafeStorage = false;
  function maybeWarnSafeStorage(): void {
    if (encryptionState !== "unavailable") return;
    if (warnedAboutSafeStorage) return;
    warnedAboutSafeStorage = true;
    logger(
      "[achilles] safeStorage unavailable; persisting plaintext (SAFE-01 follow-up in Phase 12)",
    );
  }

  const store = new StoreCtor({
    defaults: {
      [KEY_WINDOW_POSITION]: null,
      [KEY_HOTKEY_MODE]: "toggle",
      [KEY_HOTKEY_KEY]: DEFAULT_HOTKEY_ACCELERATOR,
    },
  });

  function persist(key: string, value: unknown): void {
    if (encryptionState === "available" && safeStorage !== undefined) {
      const encrypted = safeStorage
        .encryptString(JSON.stringify(value))
        .toString("base64");
      store.set(key, { __encrypted: true, payload: encrypted });
      return;
    }
    maybeWarnSafeStorage();
    store.set(key, value);
  }

  function load(key: string): unknown {
    const raw = store.get(key);
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { __encrypted?: unknown }).__encrypted === true &&
      typeof (raw as { payload?: unknown }).payload === "string" &&
      safeStorage !== undefined
    ) {
      try {
        const buf = Buffer.from(
          (raw as { payload: string }).payload,
          "base64",
        );
        return JSON.parse(safeStorage.decryptString(buf));
      } catch {
        // If decryption fails (e.g., user moved profile across
        // machines), fall back to returning null and re-write on
        // next persist call.
        return null;
      }
    }
    return raw;
  }

  return {
    readWindowPosition() {
      const raw = load(KEY_WINDOW_POSITION);
      if (raw === null || raw === undefined) return null;
      if (isPersistedPosition(raw)) return raw;
      return null;
    },
    writeWindowPosition(pos) {
      if (!Number.isInteger(pos.x) || !Number.isInteger(pos.y)) {
        throw new Error(
          `windowPosition must be integers; got ${pos.x}, ${pos.y}`,
        );
      }
      persist(KEY_WINDOW_POSITION, { x: pos.x, y: pos.y });
    },
    deleteWindowPosition() {
      store.delete(KEY_WINDOW_POSITION);
    },
    readHotkeyMode() {
      const raw = load(KEY_HOTKEY_MODE);
      if (isHotkeyMode(raw)) return raw;
      return "toggle";
    },
    writeHotkeyMode(mode) {
      if (!isHotkeyMode(mode)) {
        throw new Error(`hotkeyMode must be one of ${HOTKEY_MODES.join("|")}`);
      }
      persist(KEY_HOTKEY_MODE, mode);
    },
    readHotkeyKey() {
      const raw = load(KEY_HOTKEY_KEY);
      if (typeof raw === "string" && raw.length > 0) return raw;
      return DEFAULT_HOTKEY_ACCELERATOR;
    },
    writeHotkeyKey(accelerator) {
      if (typeof accelerator !== "string" || accelerator.length === 0) {
        throw new Error("hotkeyKey must be a non-empty Electron accelerator");
      }
      persist(KEY_HOTKEY_KEY, accelerator);
    },
    getEncryptionState() {
      return encryptionState;
    },
  };
}
