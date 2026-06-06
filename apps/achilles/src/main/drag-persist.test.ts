/**
 * Behaviour tests for wireDragPersistence (UI-05).
 *
 *   - DP1: a 'moved' event with window.getPosition() === [120, 240]
 *     persists { x: 120, y: 240 } exactly once.
 *   - DP2: rapid successive 'moved' events within the debounce window
 *     are coalesced — only the last position is written.
 *   - DP3: when store.writeWindowPosition throws (persistence_failure),
 *     the helper catches and emits the documented IPC_ERROR copy.
 *   - DP4: applyDefaultTopRight returns the locked top-right anchor
 *     for the primary display's workArea + DEFAULT_MARGIN_PX.
 *
 * Tests inject a fake window, store, and clock — no Electron loaded.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MARGIN_PX,
  WINDOW_WIDTH,
} from "../shared/constants.js";
import { applyDefaultTopRight, wireDragPersistence } from "./drag-persist.js";

interface FakeWindow {
  position: [number, number];
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  on(channel: string, cb: (...args: unknown[]) => void): void;
  getPosition(): [number, number];
  setPosition(x: number, y: number): void;
  webContents: { send: ReturnType<typeof vi.fn> };
}

function makeFakeWindow(initial: [number, number] = [0, 0]): FakeWindow {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    position: initial,
    handlers,
    on(channel, cb) {
      if (handlers[channel] === undefined) handlers[channel] = [];
      handlers[channel].push(cb);
    },
    getPosition() {
      return this.position;
    },
    setPosition(x, y) {
      this.position = [x, y];
    },
    webContents: { send: vi.fn() },
  };
}

interface FakeClock {
  now: () => number;
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (token: unknown) => void;
  advance: (ms: number) => void;
}

function makeFakeClock(): FakeClock {
  let current = 0;
  const pending: Array<{
    cb: () => void;
    runAt: number;
    token: number;
  }> = [];
  let tokenSeq = 1;
  return {
    now: () => current,
    setTimeout(cb, ms) {
      const token = tokenSeq++;
      pending.push({ cb, runAt: current + ms, token });
      return token;
    },
    clearTimeout(token) {
      const idx = pending.findIndex((p) => p.token === token);
      if (idx >= 0) pending.splice(idx, 1);
    },
    advance(ms: number) {
      current += ms;
      const ready = pending.filter((p) => p.runAt <= current);
      for (const p of ready) {
        const i = pending.indexOf(p);
        if (i >= 0) pending.splice(i, 1);
        p.cb();
      }
    },
  };
}

describe("wireDragPersistence — DP1 single moved event persists position", () => {
  it("calls store.writeWindowPosition with the resting position exactly once after debounce", () => {
    const win = makeFakeWindow();
    const clock = makeFakeClock();
    const writeWindowPosition = vi.fn();
    const store = {
      writeWindowPosition,
      readWindowPosition: () => null,
    };

    wireDragPersistence({
      window: win as never,
      store: store as never,
      debounceMs: 150,
      clock: clock as never,
    });

    win.position = [120, 240];
    win.handlers.moved!.forEach((h) => h());

    // Before the debounce elapses, no write yet.
    expect(writeWindowPosition).not.toHaveBeenCalled();

    clock.advance(150);
    expect(writeWindowPosition).toHaveBeenCalledTimes(1);
    expect(writeWindowPosition).toHaveBeenCalledWith({ x: 120, y: 240 });
  });
});

describe("wireDragPersistence — DP2 coalesces successive events within debounce window", () => {
  it("writes only the last position when multiple moved events arrive within < debounceMs", () => {
    const win = makeFakeWindow();
    const clock = makeFakeClock();
    const writeWindowPosition = vi.fn();
    const store = {
      writeWindowPosition,
      readWindowPosition: () => null,
    };

    wireDragPersistence({
      window: win as never,
      store: store as never,
      debounceMs: 150,
      clock: clock as never,
    });

    // Three successive moved events within 100ms each.
    win.position = [10, 20];
    win.handlers.moved!.forEach((h) => h());
    clock.advance(50);
    win.position = [50, 60];
    win.handlers.moved!.forEach((h) => h());
    clock.advance(50);
    win.position = [100, 120];
    win.handlers.moved!.forEach((h) => h());

    // Still nothing written — the debounce keeps resetting.
    expect(writeWindowPosition).not.toHaveBeenCalled();

    clock.advance(150);
    expect(writeWindowPosition).toHaveBeenCalledTimes(1);
    expect(writeWindowPosition).toHaveBeenCalledWith({ x: 100, y: 120 });
  });
});

describe("wireDragPersistence — DP3 surfaces persistence_failure via emitError", () => {
  it("catches store.writeWindowPosition errors and invokes emitError with the documented copy", () => {
    const win = makeFakeWindow();
    const clock = makeFakeClock();
    const writeWindowPosition = vi.fn(() => {
      throw new Error("disk full");
    });
    const store = {
      writeWindowPosition,
      readWindowPosition: () => null,
    };
    const emitError = vi.fn();

    wireDragPersistence({
      window: win as never,
      store: store as never,
      debounceMs: 150,
      clock: clock as never,
      emitError,
    });

    win.position = [5, 5];
    win.handlers.moved!.forEach((h) => h());
    clock.advance(150);

    expect(writeWindowPosition).toHaveBeenCalledTimes(1);
    expect(emitError).toHaveBeenCalledTimes(1);
    expect(emitError.mock.calls[0]![0]).toMatch(/window position/i);
  });
});

describe("applyDefaultTopRight — DP4 returns the locked top-right anchor", () => {
  it("computes x = workArea.right - WINDOW_WIDTH - margin and y = workArea.y + margin", () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const pos = applyDefaultTopRight({
      screenRef: { getPrimaryDisplay: () => ({ workArea }) },
      marginPx: DEFAULT_MARGIN_PX,
    });
    expect(pos).toEqual({
      x: workArea.x + workArea.width - WINDOW_WIDTH - DEFAULT_MARGIN_PX,
      y: workArea.y + DEFAULT_MARGIN_PX,
    });
  });

  it("honours an offset workArea origin (non-primary display setup)", () => {
    const workArea = { x: 1920, y: 0, width: 2560, height: 1440 };
    const pos = applyDefaultTopRight({
      screenRef: { getPrimaryDisplay: () => ({ workArea }) },
      marginPx: DEFAULT_MARGIN_PX,
    });
    expect(pos).toEqual({
      x: 1920 + 2560 - WINDOW_WIDTH - DEFAULT_MARGIN_PX,
      y: 0 + DEFAULT_MARGIN_PX,
    });
  });

  it("uses the default margin when none supplied", () => {
    const workArea = { x: 0, y: 0, width: 1280, height: 800 };
    const pos = applyDefaultTopRight({
      screenRef: { getPrimaryDisplay: () => ({ workArea }) },
    });
    expect(pos.x).toBe(1280 - WINDOW_WIDTH - DEFAULT_MARGIN_PX);
    expect(pos.y).toBe(DEFAULT_MARGIN_PX);
  });
});
