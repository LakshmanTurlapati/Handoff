/**
 * Achilles BrowserWindow factory.
 *
 * The UI-01 contract is the source of truth: 260 x 260, frameless,
 * transparent, always-on-top, focusable:false, type:'panel' on macOS,
 * skipTaskbar:true, contextIsolation:true, nodeIntegration:false,
 * sandbox:true.
 *
 * The factory is dependency-injected so unit tests can capture the
 * constructor options without launching Electron. Production code
 * calls `createAchillesWindow()` with no arguments; injection seams
 * default to the real Electron exports.
 *
 * Pitfall mitigations applied here (see PITFALLS.md #15):
 *   - type:'panel' on macOS so the window survives Spaces + full
 *     screen.
 *   - setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }).
 *   - setAlwaysOnTop(true, 'screen-saver') — strongest always-on-top
 *     level Electron exposes.
 *   - app.dock.hide() on darwin so Achilles never shows in the dock
 *     or in Cmd+Tab.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DEFAULT_MARGIN_PX,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "../shared/constants.js";

/**
 * Minimal subset of `electron.BrowserWindow` the factory touches.
 * Tests substitute a stub that records the constructor options.
 */
export interface AchillesBrowserWindow {
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean },
  ): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setPosition(x: number, y: number, animate?: boolean): void;
  loadFile(path: string): Promise<void> | void;
  loadURL(url: string): Promise<void> | void;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
}

/**
 * Subset of `electron.app` the factory touches. The `dock` property
 * is macOS-only on the real Electron API; we model it as optional so
 * the injection seam doesn't have to fake the whole `app` surface
 * on Windows / Linux tests.
 */
export interface AchillesAppRef {
  dock?: { hide(): void };
}

export interface CreateAchillesWindowOptions {
  /**
   * Constructor for the BrowserWindow. Defaults to
   * `(await import('electron')).BrowserWindow` in production; tests
   * inject a recording stub.
   */
  BrowserWindowCtor?: new (
    opts: Record<string, unknown>,
  ) => AchillesBrowserWindow;

  /**
   * Reference to the Electron `app` object. Defaults to the real
   * `electron.app` in production; tests inject a fake with the
   * `dock.hide` spy.
   */
  appRef?: AchillesAppRef;

  /**
   * Persisted window position from `electron-store`, or `null` when
   * no position has been saved yet (first launch).
   */
  initialPosition?: { x: number; y: number } | null;

  /**
   * Override for `process.platform`. Tests inject 'darwin' /
   * 'win32' / 'linux' to exercise the platform branches without
   * touching the real environment.
   */
  platform?: NodeJS.Platform;

  /**
   * Override for the primary display's `workArea` used by the
   * top-right default positioning. In production this comes from
   * `screen.getPrimaryDisplay().workArea`. Tests inject a fixed
   * rectangle so the assertion is deterministic.
   */
  workArea?: { x: number; y: number; width: number; height: number };

  /**
   * Path to the preload script. Defaults to the electron-vite
   * output: `out/preload/index.js` next to `out/main/index.js`.
   * Tests can pass an arbitrary string — the value only flows into
   * `webPreferences.preload`.
   */
  preloadPath?: string;
}

/**
 * Resolve a reasonable default preload path. In production the main
 * bundle lives in `out/main/index.js` and the preload bundle lives in
 * `out/preload/index.js`. We compute the path relative to this file's
 * URL so the bundler's `__dirname` shim isn't a hard requirement.
 *
 * In a vitest run (where this module is imported directly from
 * source), `import.meta.url` will not resolve to the production
 * output path, but the value is never used at test time — the W1
 * test passes a stub `BrowserWindowCtor` that ignores the preload
 * path entirely.
 */
function defaultPreloadPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "../preload/index.js");
  } catch {
    return "preload.js";
  }
}

/**
 * Creates the locked Achilles BrowserWindow per UI-01.
 *
 * Production: `createAchillesWindow()` reads BrowserWindow + app
 * from Electron's exports.
 * Tests:      injection seams capture options + spy methods.
 */
export function createAchillesWindow(
  opts: CreateAchillesWindowOptions = {},
): AchillesBrowserWindow {
  const platform = opts.platform ?? process.platform;
  const preloadPath = opts.preloadPath ?? defaultPreloadPath();

  // Construct the window options object as a plain record so the
  // 'type:"panel"' key can be conditionally inserted on darwin only.
  // On non-darwin we leave the key off entirely so Electron's window
  // manager treats it as a regular utility window.
  const baseOptions: Record<string, unknown> = {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (platform === "darwin") {
    baseOptions.type = "panel";
  }

  const Ctor = opts.BrowserWindowCtor;
  if (Ctor === undefined) {
    throw new Error(
      "createAchillesWindow requires BrowserWindowCtor; main/index.ts wires the real electron.BrowserWindow in production.",
    );
  }

  const win = new Ctor(baseOptions);

  // PITFALLS.md #15 mitigations — survive fullscreen + Spaces, ride
  // above the screen saver level, never show in dock / Cmd-Tab.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");

  if (platform === "darwin") {
    opts.appRef?.dock?.hide();
  }

  // Position the window. If a persisted position exists, restore it
  // verbatim; otherwise lay out top-right of the primary display
  // workArea with DEFAULT_MARGIN_PX inset.
  if (opts.initialPosition !== null && opts.initialPosition !== undefined) {
    win.setPosition(opts.initialPosition.x, opts.initialPosition.y);
  } else {
    const wa = opts.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 };
    const x = wa.x + wa.width - WINDOW_WIDTH - DEFAULT_MARGIN_PX;
    const y = wa.y + DEFAULT_MARGIN_PX;
    win.setPosition(x, y);
  }

  return win;
}
