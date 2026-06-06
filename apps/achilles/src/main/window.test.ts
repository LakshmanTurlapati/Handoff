/**
 * Behaviour tests for the BrowserWindow contract.
 *
 * The real `electron.BrowserWindow` constructor is replaced with a
 * captured-options stub. We assert against the captured options
 * object rather than spinning up Electron (which the test environment
 * cannot do and the CLAUDE.md global forbids).
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARGIN_PX,
  DRAG_HANDLE_HEIGHT_PX,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "../shared/constants.js";
import { createAchillesWindow } from "./window.js";

interface CapturedWindow {
  options: Record<string, unknown>;
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  webContents: { send: ReturnType<typeof vi.fn> };
}

function makeStubCtor(): {
  ctor: new (opts: Record<string, unknown>) => CapturedWindow;
  instances: CapturedWindow[];
} {
  const instances: CapturedWindow[] = [];
  const ctor = function (opts: Record<string, unknown>): CapturedWindow {
    const instance: CapturedWindow = {
      options: opts,
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setPosition: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      webContents: { send: vi.fn() },
    };
    instances.push(instance);
    return instance;
  } as unknown as new (opts: Record<string, unknown>) => CapturedWindow;
  return { ctor, instances };
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: original });
  }
}

describe("createAchillesWindow — UI-01 BrowserWindow contract (W1)", () => {
  it("constructs with the exact locked options object", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: { x: 0, y: 0 },
      // 'win32' here so the macOS-only branches do not assert against
      // the dock stub for this specific window-contract test
      platform: "win32",
    });

    expect(instances.length).toBe(1);
    const opts = instances[0]!.options;

    expect(opts.width).toBe(WINDOW_WIDTH);
    expect(opts.height).toBe(WINDOW_HEIGHT);
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.focusable).toBe(false);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.backgroundColor).toBe("#00000000");

    const wp = opts.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
  });

  it("sets type:'panel' on macOS (UI-01 + PITFALLS #15)", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: { x: 0, y: 0 },
      platform: "darwin",
    });
    expect(instances[0]!.options.type).toBe("panel");
  });

  it("omits the macOS-only type field on Windows / Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const { ctor, instances } = makeStubCtor();
      createAchillesWindow({
        BrowserWindowCtor: ctor as never,
        appRef: { dock: { hide: vi.fn() } },
        initialPosition: { x: 0, y: 0 },
        platform,
      });
      // Non-darwin platforms drop the 'panel' literal so the OS
      // window manager treats Achilles as a regular utility window.
      expect(instances[0]!.options.type).toBeUndefined();
    }
  });
});

describe("createAchillesWindow — workspace + always-on-top calls (W2)", () => {
  it("calls setVisibleOnAllWorkspaces(true, visibleOnFullScreen:true) exactly once", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: { x: 0, y: 0 },
      platform: "darwin",
    });
    const win = instances[0]!;
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1);
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
  });

  it("calls setAlwaysOnTop(true, 'screen-saver') exactly once", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: { x: 0, y: 0 },
      platform: "darwin",
    });
    const win = instances[0]!;
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
  });
});

describe("createAchillesWindow — platform-specific dock.hide (W3)", () => {
  it("calls appRef.dock.hide() exactly once on darwin", () => {
    const hide = vi.fn();
    const { ctor } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide } },
      initialPosition: { x: 0, y: 0 },
      platform: "darwin",
    });
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("does NOT call dock.hide on win32 or linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      const hide = vi.fn();
      const { ctor } = makeStubCtor();
      createAchillesWindow({
        BrowserWindowCtor: ctor as never,
        appRef: { dock: { hide } },
        initialPosition: { x: 0, y: 0 },
        platform,
      });
      expect(hide).not.toHaveBeenCalled();
    }
  });
});

describe("createAchillesWindow — positioning", () => {
  it("calls setPosition with the persisted initialPosition when provided", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: { x: 123, y: 456 },
      platform: "win32",
    });
    expect(instances[0]!.setPosition).toHaveBeenCalledWith(123, 456);
  });

  it("falls back to the top-right default when no position is persisted", () => {
    const { ctor, instances } = makeStubCtor();
    createAchillesWindow({
      BrowserWindowCtor: ctor as never,
      appRef: { dock: { hide: vi.fn() } },
      initialPosition: null,
      platform: "win32",
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const [callX, callY] = instances[0]!.setPosition.mock.calls[0] as [
      number,
      number,
    ];
    // Top-right default: workArea.right - WINDOW_WIDTH - margin
    expect(callX).toBe(1920 - WINDOW_WIDTH - DEFAULT_MARGIN_PX);
    // Top: workArea.y + margin
    expect(callY).toBe(0 + DEFAULT_MARGIN_PX);
  });

  it("exposes DRAG_HANDLE_HEIGHT_PX through the constants module (sanity-check)", () => {
    // DRAG_HANDLE_HEIGHT_PX is a layout constant the renderer's CSS
    // consumes; window.ts does not use it directly but the test
    // catches an accidental rename in constants.ts.
    expect(DRAG_HANDLE_HEIGHT_PX).toBe(30);
  });
});
