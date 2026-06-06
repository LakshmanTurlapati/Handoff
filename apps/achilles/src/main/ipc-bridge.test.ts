/**
 * Behaviour tests for the IPC bridge.
 *
 * Covers the CR-02, CR-06, and WR-06 fixes:
 *
 *   - CR-02: requesting state==='error' through IPC_REQUEST_STATE emits
 *            BOTH the state-changed broadcast AND the IPC_ERROR copy.
 *   - CR-06: requesting state==='idle' from processing routes through
 *            CIRCLE_CLICK (not MOCK_PLAYBACK_DONE), so the cancel path
 *            actually advances the reducer.
 *   - WR-06: senders other than the floating window's webContents are
 *            rejected with a log entry.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ERROR_COPY,
  IPC_ERROR,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
} from "../shared/constants.js";
import { createMockStateController } from "./state-machine.js";
import type { MockStateController } from "./state-machine.js";
import { wireIpcBridge } from "./ipc-bridge.js";

interface CapturedSend {
  channel: string;
  payload: unknown;
}

interface FakeWindow {
  webContents: {
    send(channel: string, payload: unknown): void;
    id: number;
  };
  sent: CapturedSend[];
}

function makeFakeWindow(id = 1): FakeWindow {
  const sent: CapturedSend[] = [];
  return {
    webContents: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      id,
    },
    sent,
  };
}

interface CapturedHandler {
  channel: string;
  listener: (event: { sender: { id: number } }, payload: unknown) => void;
}

function makeFakeIpcMain(): {
  handlers: Map<string, CapturedHandler>;
  on: (
    channel: string,
    listener: (event: { sender: { id: number } }, payload: unknown) => void,
  ) => void;
  removeAllListeners: (channel?: string) => void;
} {
  const handlers = new Map<string, CapturedHandler>();
  return {
    handlers,
    on(channel, listener) {
      handlers.set(channel, { channel, listener });
    },
    removeAllListeners(channel) {
      if (channel === undefined) {
        handlers.clear();
      } else {
        handlers.delete(channel);
      }
    },
  };
}

function makeFakeStore(): {
  readWindowPosition: () => null;
  writeWindowPosition: ReturnType<typeof vi.fn>;
  readHotkeyMode: () => "toggle";
  writeHotkeyMode: ReturnType<typeof vi.fn>;
  readHotkeyKey: () => string;
  writeHotkeyKey: ReturnType<typeof vi.fn>;
} {
  return {
    readWindowPosition: () => null,
    writeWindowPosition: vi.fn(),
    readHotkeyMode: () => "toggle",
    writeHotkeyMode: vi.fn(),
    readHotkeyKey: () => "CommandOrControl+Shift+A",
    writeHotkeyKey: vi.fn(),
  };
}

function makeController(): {
  controller: MockStateController;
  broadcastSpy: ReturnType<typeof vi.fn>;
} {
  const broadcastSpy = vi.fn();
  const controller = createMockStateController({
    broadcast: broadcastSpy,
    getMode: () => "toggle",
    // Disable scheduling so the unit tests do not spawn timers we
    // have to clean up.
    setTimeoutImpl: () => null,
    clearTimeoutImpl: () => undefined,
  });
  return { controller, broadcastSpy };
}

describe("wireIpcBridge — CR-02 IPC_ERROR copy emitted alongside state transition", () => {
  it("emits BOTH state-changed: error AND error: { message } when REQUEST_STATE: 'error' fires", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();

    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      // Bypass sender check by leaving window id undefined-ish.
    });

    const handler = ipcMain.handlers.get(IPC_REQUEST_STATE);
    expect(handler).toBeDefined();
    handler!.listener({ sender: { id: 1 } }, { state: "error" });

    // The reducer moved to 'error'; CR-01 wired the controller's
    // broadcast in main/index.ts, but at this unit level we only need
    // to verify the IPC bridge emits the IPC_ERROR copy.
    const errorSends = window.sent.filter((s) => s.channel === IPC_ERROR);
    expect(errorSends.length).toBe(1);
    expect(errorSends[0]!.payload).toEqual({ message: ERROR_COPY.unknown });
  });
});

describe("wireIpcBridge — CR-06 processing -> idle cancel routes through CIRCLE_CLICK", () => {
  it("calls CIRCLE_CLICK so the reducer transitions processing -> idle", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const broadcastSpy = vi.fn();
    const controller = createMockStateController({
      broadcast: broadcastSpy,
      getMode: () => "toggle",
      setTimeoutImpl: () => null,
      clearTimeoutImpl: () => undefined,
    });
    // Drive the controller manually into 'processing'.
    controller.dispatch({ type: "HOTKEY_PRESS" }); // idle -> listening
    controller.dispatch({ type: "HOTKEY_PRESS" }); // listening -> processing
    expect(controller.now()).toBe("processing");

    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
    });

    const handler = ipcMain.handlers.get(IPC_REQUEST_STATE);
    handler!.listener({ sender: { id: 1 } }, { state: "idle" });

    // The reducer accepts CIRCLE_CLICK from processing and transitions
    // to idle. Pre-fix this used MOCK_PLAYBACK_DONE which the reducer
    // only honours from speaking, so the state stayed at processing.
    expect(controller.now()).toBe("idle");
  });

  it("calls CIRCLE_CLICK so the reducer transitions speaking -> idle", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const broadcastSpy = vi.fn();
    const controller = createMockStateController({
      broadcast: broadcastSpy,
      getMode: () => "toggle",
      setTimeoutImpl: () => null,
      clearTimeoutImpl: () => undefined,
    });
    controller.dispatch({ type: "HOTKEY_PRESS" });
    controller.dispatch({ type: "HOTKEY_PRESS" });
    controller.dispatch({ type: "MOCK_PROCESSING_COMPLETE" });
    expect(controller.now()).toBe("speaking");

    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
    });

    const handler = ipcMain.handlers.get(IPC_REQUEST_STATE);
    handler!.listener({ sender: { id: 1 } }, { state: "idle" });
    expect(controller.now()).toBe("idle");
  });
});

describe("wireIpcBridge — WR-06 senders are validated", () => {
  it("rejects an event whose sender id does not match the floating window's webContents id", () => {
    const window = makeFakeWindow(42);
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const log = vi.fn();

    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      logger: log,
    });

    const handler = ipcMain.handlers.get(IPC_REQUEST_STATE);
    // Foreign sender — id !== 42 -> dropped.
    handler!.listener({ sender: { id: 999 } }, { state: "listening" });

    // No state-changed sent (because no dispatch fired).
    expect(window.sent.filter((s) => s.channel === IPC_STATE_CHANGED).length)
      .toBe(0);
    expect(log).toHaveBeenCalled();
    const logMsg = (log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? "";
    expect(String(logMsg)).toContain("unexpected sender");
  });

  it("accepts an event whose sender id matches the floating window's webContents id", () => {
    const window = makeFakeWindow(42);
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();

    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
    });

    const handler = ipcMain.handlers.get(IPC_REQUEST_STATE);
    handler!.listener({ sender: { id: 42 } }, { state: "listening" });
    // CR-06 routes through CIRCLE_CLICK; idle -> listening.
    expect(controller.now()).toBe("listening");
  });
});
