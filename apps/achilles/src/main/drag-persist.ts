/**
 * Achilles drag-to-reposition persistence (UI-05).
 *
 * Phase 11's window survives drag-to-reposition by debouncing
 * `BrowserWindow.on('moved', ...)` events and writing the resting
 * position to electron-store. The 'moved' event fires once per OS
 * window-move commit (typically on mouseup); the 'move' event fires
 * continuously during drag. We listen to both so that:
 *
 *   - quick consecutive drags (window manager fires 'move' but not
 *     'moved' on some setups) still produce a write,
 *   - large amplitude drags only persist the final resting position.
 *
 * Failure path: when `store.writeWindowPosition` throws (electron-store
 * disk full, EACCES on linux, encryption failure, etc.) the helper
 * catches the error, logs through the optional `logger`, and invokes
 * `emitError` with the documented UI-SPEC §8 `persistence_failure`
 * copy so the renderer's ErrorBanner surfaces the failure.
 *
 * All dependencies (window, store, clock) are injection seams so the
 * unit suite can exercise the debounce + error paths without launching
 * Electron.
 */
import {
  DEFAULT_MARGIN_PX,
  WINDOW_WIDTH,
} from "../shared/constants.js";

/**
 * UI-SPEC §8 locked copy for the persistence_failure error kind. The
 * renderer's ErrorBanner uses the same string verbatim; centralising it
 * here means the main and renderer paths stay in lockstep without a
 * cross-package import.
 */
export const PERSISTENCE_FAILURE_COPY =
  "Could not save window position. Settings may not persist.";

/**
 * Minimal subset of `BrowserWindow` the persistence helper touches.
 * The unit tests inject a fake whose `on` records handlers in a map.
 */
export interface DragPersistWindow {
  on(channel: "move" | "moved", cb: (...args: unknown[]) => void): void;
  getPosition(): [number, number];
}

/**
 * Minimal subset of the AchillesStore the persistence helper writes
 * to. The full AchillesStore interface lives in `store.ts`; this
 * narrowing keeps the seam tight.
 */
export interface DragPersistStore {
  writeWindowPosition(pos: { x: number; y: number }): void;
  readWindowPosition(): { x: number; y: number } | null;
}

/**
 * Clock seam for tests. Production passes `undefined` so the helper
 * falls through to global `setTimeout` / `clearTimeout`.
 */
export interface DragPersistClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(token: unknown): void;
}

export interface WireDragPersistenceOptions {
  window: DragPersistWindow;
  store: DragPersistStore;
  /**
   * Surfaces persistence_failure to the renderer's ErrorBanner pipeline.
   * Typical wiring: `(msg) => window.webContents.send(IPC_ERROR, { message: msg })`.
   * When undefined, errors are still logged through `logger`; only the
   * renderer banner path is suppressed.
   */
  emitError?: (message: string) => void;
  /**
   * Optional logger; defaults to `console.warn` with the `[achilles]`
   * prefix.
   */
  logger?: (msg: string) => void;
  /**
   * Debounce window in milliseconds. Defaults to 150 — short enough to
   * feel snappy on mouseup, long enough to coalesce a flurry of
   * 'move' events during the drag itself.
   */
  debounceMs?: number;
  /**
   * Clock seam for tests. Production falls through to global timers.
   */
  clock?: DragPersistClock;
}

export interface WireDragPersistenceHandle {
  /**
   * Tears down the pending debounce timer (if any). Safe to call when
   * no timer is pending (no-op).
   */
  dispose(): void;
  /**
   * Forces an immediate flush of the pending position, bypassing the
   * debounce. Useful for `will-quit` so a still-pending drag commit
   * survives quit.
   */
  flushNow(): void;
}

export function wireDragPersistence(
  opts: WireDragPersistenceOptions,
): WireDragPersistenceHandle {
  const { window, store } = opts;
  const debounceMs = opts.debounceMs ?? 150;
  const logger =
    opts.logger ??
    ((msg: string) => {
      // eslint-disable-next-line no-console
      console.warn(msg);
    });
  const clock: DragPersistClock = opts.clock ?? {
    now: () => Date.now(),
    setTimeout: (cb, ms) =>
      setTimeout(cb, ms) as unknown,
    clearTimeout: (token) =>
      clearTimeout(token as ReturnType<typeof setTimeout>),
  };

  let pendingToken: unknown = null;

  function flush(): void {
    pendingToken = null;
    const [x, y] = window.getPosition();
    try {
      store.writeWindowPosition({ x, y });
    } catch (err) {
      const message = (err as Error).message;
      logger(
        `[achilles] writeWindowPosition failed (UI-05 persistence_failure): ${message}`,
      );
      opts.emitError?.(PERSISTENCE_FAILURE_COPY);
    }
  }

  function scheduleFlush(): void {
    if (pendingToken !== null) {
      clock.clearTimeout(pendingToken);
      pendingToken = null;
    }
    pendingToken = clock.setTimeout(flush, debounceMs);
  }

  // Listen to both 'move' (continuous during drag) and 'moved' (single
  // fire on mouseup). Both feed the same debounced flush — the resting
  // position is what gets persisted.
  window.on("move", scheduleFlush);
  window.on("moved", scheduleFlush);

  function dispose(): void {
    if (pendingToken !== null) {
      clock.clearTimeout(pendingToken);
      pendingToken = null;
    }
  }

  function flushNow(): void {
    if (pendingToken !== null) {
      clock.clearTimeout(pendingToken);
      pendingToken = null;
    }
    flush();
  }

  return { dispose, flushNow };
}

/**
 * Computes the locked top-right anchor for the floating window. Used:
 *
 *   - by `createAchillesWindow` (Plan 11-01) when no position is
 *     persisted (first launch),
 *   - by the SettingsPopover's "Reset window position" handler (this
 *     plan) to return the window to the documented default.
 *
 * Returns integer coordinates so `BrowserWindow.setPosition` does not
 * silently truncate floats.
 */
export interface ApplyDefaultTopRightOptions {
  screenRef?: {
    getPrimaryDisplay(): {
      workArea: { x: number; y: number; width: number; height: number };
    };
  };
  /**
   * Override for the inset margin. Defaults to DEFAULT_MARGIN_PX
   * (UI-SPEC §2 — the `lg` spacing token = 24).
   */
  marginPx?: number;
}

export function applyDefaultTopRight(
  opts: ApplyDefaultTopRightOptions = {},
): { x: number; y: number } {
  const margin = opts.marginPx ?? DEFAULT_MARGIN_PX;
  const screenRef = opts.screenRef;
  const wa = screenRef
    ? screenRef.getPrimaryDisplay().workArea
    : { x: 0, y: 0, width: 1920, height: 1080 };
  return {
    x: wa.x + wa.width - WINDOW_WIDTH - margin,
    y: wa.y + margin,
  };
}
