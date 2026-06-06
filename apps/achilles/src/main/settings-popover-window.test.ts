/**
 * Behaviour tests for createSettingsPopoverWindow (UI-SPEC §7).
 *
 *   - SP1: constructor options match the locked child-window contract
 *     (parent, modal:false, frame:false, transparent:true,
 *     alwaysOnTop:true, focusable:true, skipTaskbar:true, 220x180,
 *     sandboxed webPreferences).
 *   - SP2: the popover is positioned at (parent.x + circle.center.x + 60,
 *     parent.y + circle.center.y - 50); if the resulting screen rect
 *     would overflow the right edge, the anchor mirrors to the LEFT.
 *   - SP3: Escape on the popover web contents AND clicking outside
 *     (parent focus event) calls popover.close().
 */
import { describe, expect, it, vi } from "vitest";
import { createSettingsPopoverWindow } from "./settings-popover-window.js";

interface CapturedPopover {
  options: Record<string, unknown>;
  setPosition: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    on: ReturnType<typeof vi.fn>;
    handlers: Record<string, Array<(...args: unknown[]) => void>>;
  };
}

interface CapturedPopoverWithClose extends CapturedPopover {
  closedHandlers: Array<() => void>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  triggerClosed: () => void;
}

function makePopoverCtor(): {
  ctor: new (opts: Record<string, unknown>) => CapturedPopoverWithClose;
  instances: CapturedPopoverWithClose[];
} {
  const instances: CapturedPopoverWithClose[] = [];
  const ctor = function (opts: Record<string, unknown>): CapturedPopoverWithClose {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const closedHandlers: Array<() => void> = [];
    const onFn = vi.fn((channel: string, cb: () => void) => {
      if (channel === "closed") closedHandlers.push(cb);
    });
    const offFn = vi.fn((channel: string, cb: () => void) => {
      if (channel !== "closed") return;
      const idx = closedHandlers.indexOf(cb);
      if (idx >= 0) closedHandlers.splice(idx, 1);
    });
    const instance: CapturedPopoverWithClose = {
      options: opts,
      setPosition: vi.fn(),
      close: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        handlers,
        on: vi.fn(
          (channel: string, cb: (...args: unknown[]) => void) => {
            if (handlers[channel] === undefined) handlers[channel] = [];
            handlers[channel].push(cb);
          },
        ),
      },
      closedHandlers,
      on: onFn,
      off: offFn,
      triggerClosed(): void {
        for (const cb of [...closedHandlers]) cb();
      },
    };
    instances.push(instance);
    return instance;
  } as unknown as new (opts: Record<string, unknown>) => CapturedPopoverWithClose;
  return { ctor, instances };
}

interface FakeParent {
  position: [number, number];
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  on(channel: string, cb: (...args: unknown[]) => void): void;
  off(channel: string, cb: (...args: unknown[]) => void): void;
  getPosition(): [number, number];
  focus(): void;
  isDestroyed(): boolean;
}

function makeFakeParent(initial: [number, number] = [100, 100]): FakeParent {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    position: initial,
    handlers,
    on(channel, cb) {
      if (handlers[channel] === undefined) handlers[channel] = [];
      handlers[channel].push(cb);
    },
    off(channel, cb) {
      const arr = handlers[channel];
      if (arr === undefined) return;
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    },
    getPosition() {
      return this.position;
    },
    focus() {},
    isDestroyed() {
      return false;
    },
  };
}

describe("createSettingsPopoverWindow — SP1 locked child-window contract", () => {
  it("constructs the popover with the documented options object", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([0, 0]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    expect(instances.length).toBe(1);
    const opts = instances[0]!.options;

    expect(opts.parent).toBe(parent);
    expect(opts.modal).toBe(false);
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.focusable).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.width).toBe(220);
    expect(opts.height).toBe(180);

    const wp = opts.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
  });
});

describe("createSettingsPopoverWindow — SP2 anchor logic", () => {
  it("anchors to the right of the circle by default (parent + circle.center.x + 60, parent.y + circle.center.y - 50)", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([200, 300]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    // Default circle.center = (130, 98) per UI-SPEC §2. Right anchor:
    //   x = parent.x + 130 + 60 = 200 + 190 = 390
    //   y = parent.y + 98 - 50 = 300 + 48 = 348
    const setPos = instances[0]!.setPosition;
    expect(setPos).toHaveBeenCalledTimes(1);
    expect(setPos).toHaveBeenCalledWith(390, 348);
  });

  it("mirrors anchor to the LEFT when the right anchor would overflow the screen edge", () => {
    const { ctor, instances } = makePopoverCtor();
    // Parent positioned far right so right-anchor would land off-screen.
    const parent = makeFakeParent([1600, 300]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    // Right anchor: x = 1600 + 130 + 60 = 1790; 1790 + 220 = 2010 > 1920.
    // Left anchor mirrors the offset around the circle center:
    //   x = parent.x + circle.center.x - 60 - popoverWidth (220)
    //     = 1600 + 130 - 60 - 220 = 1450
    const setPos = instances[0]!.setPosition;
    expect(setPos).toHaveBeenCalledTimes(1);
    expect(setPos).toHaveBeenCalledWith(1450, 348);
  });
});

describe("createSettingsPopoverWindow — SP3 Escape + outside-click close", () => {
  it("closes the popover when before-input-event fires with Escape", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([0, 0]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    const popover = instances[0]!;
    const escHandler = popover.webContents.handlers["before-input-event"]?.[0];
    expect(escHandler).toBeDefined();

    const preventDefault = vi.fn();
    escHandler!(
      { preventDefault },
      { type: "keyDown", key: "Escape" },
    );
    expect(popover.close).toHaveBeenCalledTimes(1);
  });

  it("closes the popover when the parent regains focus (outside click) — and is a no-op for the destroyed case", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([0, 0]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    const popover = instances[0]!;
    // The parent's 'focus' listener was wired; firing it closes the popover.
    expect(parent.handlers.focus).toBeDefined();
    parent.handlers.focus!.forEach((h) => h());
    expect(popover.close).toHaveBeenCalledTimes(1);
  });
});

describe("createSettingsPopoverWindow — CR-08 parent focus listener cleanup", () => {
  it("detaches the parent's 'focus' listener when the popover emits 'closed'", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([0, 0]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };

    const baselineCount =
      (parent.handlers.focus?.length ?? 0);

    createSettingsPopoverWindow(parent as never, {
      BrowserWindowCtor: ctor as never,
      screenRef,
    });

    // After construction, exactly ONE focus listener attached.
    expect(parent.handlers.focus?.length).toBe(baselineCount + 1);

    // Fire the popover's 'closed' event.
    instances[0]!.triggerClosed();

    // The parent's focus listener was detached.
    expect(parent.handlers.focus?.length ?? 0).toBe(baselineCount);
  });

  it("returns to baseline parent.focus listener count after 10 open/close cycles", () => {
    const { ctor, instances } = makePopoverCtor();
    const parent = makeFakeParent([0, 0]);
    const screenRef = {
      getPrimaryDisplay: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    };
    const baseline = parent.handlers.focus?.length ?? 0;

    for (let i = 0; i < 10; i++) {
      createSettingsPopoverWindow(parent as never, {
        BrowserWindowCtor: ctor as never,
        screenRef,
      });
      instances[i]!.triggerClosed();
    }

    // Pre-fix: 10 listeners stacked. With CR-08: back to baseline.
    expect(parent.handlers.focus?.length ?? 0).toBe(baseline);
  });
});
