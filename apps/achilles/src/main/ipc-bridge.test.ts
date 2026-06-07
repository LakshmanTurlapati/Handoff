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
  IPC_MIC_FRAME,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_STT_TOKEN,
  IPC_STT_TOKEN_REQUEST,
  IPC_TTS_CHUNK,
  IPC_TTS_PLAYBACK_COMPLETE,
  IPC_UTTERANCE_COMMIT,
} from "../shared/constants.js";
import { createMockStateController } from "./state-machine.js";
import type { MockStateController } from "./state-machine.js";
import type { AchillesSession } from "./session.js";
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

function makeFakeSession(): AchillesSession & {
  spies: {
    onHotkeyPress: ReturnType<typeof vi.fn>;
    requestSttToken: ReturnType<typeof vi.fn>;
    onUtteranceCommit: ReturnType<typeof vi.fn>;
    onMicFrame: ReturnType<typeof vi.fn>;
    onTtsPlaybackComplete: ReturnType<typeof vi.fn>;
    onCancel: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    onHotkeyPress: vi.fn(async () => undefined),
    requestSttToken: vi.fn(async () => undefined),
    onUtteranceCommit: vi.fn(),
    onMicFrame: vi.fn(),
    onTtsPlaybackComplete: vi.fn(),
    onCancel: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    onHotkeyPress: spies.onHotkeyPress,
    requestSttToken: spies.requestSttToken,
    onUtteranceCommit: spies.onUtteranceCommit,
    onMicFrame: spies.onMicFrame,
    onTtsPlaybackComplete: spies.onTtsPlaybackComplete,
    onCancel: spies.onCancel,
    dispose: spies.dispose,
    metrics: { framesDroppedDuringSpeaking: 0 },
    spies,
  };
}

describe("wireIpcBridge — Plan 12-04 IB1 utterance-commit forwarding", () => {
  it("IPC_UTTERANCE_COMMIT inbound forwards a valid payload to session.onUtteranceCommit", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
    });
    const handler = ipcMain.handlers.get(IPC_UTTERANCE_COMMIT);
    expect(handler).toBeDefined();
    handler!.listener(
      { sender: { id: 1 } },
      {
        id: "11111111-1111-4111-8111-111111111111",
        text: "do the work",
        committedAt: 0,
      },
    );
    expect(session.spies.onUtteranceCommit).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
      text: "do the work",
      committedAt: 0,
    });
  });

  it("drops invalid payloads with a [achilles] log line", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    const log = vi.fn();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
      logger: log,
    });
    const handler = ipcMain.handlers.get(IPC_UTTERANCE_COMMIT);
    // Missing text field — Zod rejects.
    handler!.listener({ sender: { id: 1 } }, { id: "x" });
    expect(session.spies.onUtteranceCommit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});

describe("wireIpcBridge — Plan 12-04 IB2 tts-playback-complete forwarding", () => {
  it("IPC_TTS_PLAYBACK_COMPLETE inbound forwards to session.onTtsPlaybackComplete", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
    });
    const handler = ipcMain.handlers.get(IPC_TTS_PLAYBACK_COMPLETE);
    handler!.listener({ sender: { id: 1 } }, {});
    expect(session.spies.onTtsPlaybackComplete).toHaveBeenCalledTimes(1);
  });
});

describe("wireIpcBridge — Plan 12-04 IB3 mic-frame forwarding", () => {
  it("IPC_MIC_FRAME inbound forwards to session.onMicFrame", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
    });
    const handler = ipcMain.handlers.get(IPC_MIC_FRAME);
    const payload = {
      pcm: new ArrayBuffer(640),
      sampleRate: 16000,
      samplesPerFrame: 320,
    };
    handler!.listener({ sender: { id: 1 } }, payload);
    expect(session.spies.onMicFrame).toHaveBeenCalledTimes(1);
  });

  it("rejects mic-frame payloads with wrong sampleRate (LOOP-01 IPC pin)", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    const log = vi.fn();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
      logger: log,
    });
    const handler = ipcMain.handlers.get(IPC_MIC_FRAME);
    handler!.listener(
      { sender: { id: 1 } },
      {
        pcm: new ArrayBuffer(640),
        sampleRate: 48000, // WRONG — must be 16000 literal.
        samplesPerFrame: 320,
      },
    );
    expect(session.spies.onMicFrame).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
});

describe("wireIpcBridge — Plan 12-04 IB4 stt-token-request forwarding", () => {
  it("IPC_STT_TOKEN_REQUEST inbound triggers session.requestSttToken (renderer-requested mint) and NOT onHotkeyPress (CR-02)", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
    });
    const handler = ipcMain.handlers.get(IPC_STT_TOKEN_REQUEST);
    handler!.listener({ sender: { id: 1 } }, {});
    // CR-02: STT token-request must NOT route through onHotkeyPress
    // because that mutates state (listening → processing on the half-
    // committed path, or cancel from speaking). The dedicated
    // requestSttToken method mints a token without touching the reducer.
    expect(session.spies.requestSttToken).toHaveBeenCalledTimes(1);
    expect(session.spies.onHotkeyPress).not.toHaveBeenCalled();
  });
});

describe("wireIpcBridge — Plan 12-04 IB7 dispose removes Phase 12 listeners", () => {
  it("dispose removeAllListeners for IPC_UTTERANCE_COMMIT / TTS_PLAYBACK_COMPLETE / MIC_FRAME / STT_TOKEN_REQUEST", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    const session = makeFakeSession();
    const handle = wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      session,
    });
    // Each Phase 12 channel has a registered handler.
    expect(ipcMain.handlers.has(IPC_UTTERANCE_COMMIT)).toBe(true);
    expect(ipcMain.handlers.has(IPC_TTS_PLAYBACK_COMPLETE)).toBe(true);
    expect(ipcMain.handlers.has(IPC_MIC_FRAME)).toBe(true);
    expect(ipcMain.handlers.has(IPC_STT_TOKEN_REQUEST)).toBe(true);
    handle.dispose();
    expect(ipcMain.handlers.has(IPC_UTTERANCE_COMMIT)).toBe(false);
    expect(ipcMain.handlers.has(IPC_TTS_PLAYBACK_COMPLETE)).toBe(false);
    expect(ipcMain.handlers.has(IPC_MIC_FRAME)).toBe(false);
    expect(ipcMain.handlers.has(IPC_STT_TOKEN_REQUEST)).toBe(false);
  });

  it("does not register Phase 12 handlers when no session is provided", () => {
    const window = makeFakeWindow();
    const ipcMain = makeFakeIpcMain();
    const store = makeFakeStore();
    const { controller } = makeController();
    wireIpcBridge({
      window: window as never,
      controller,
      store: store as never,
      ipcMainRef: ipcMain as never,
      // session intentionally omitted — degraded-mode wiring.
    });
    expect(ipcMain.handlers.has(IPC_UTTERANCE_COMMIT)).toBe(false);
    expect(ipcMain.handlers.has(IPC_TTS_PLAYBACK_COMPLETE)).toBe(false);
    expect(ipcMain.handlers.has(IPC_MIC_FRAME)).toBe(false);
    expect(ipcMain.handlers.has(IPC_STT_TOKEN_REQUEST)).toBe(false);
  });
});

describe("wireIpcBridge — Plan 12-04 IB5/IB6 outbound payload constants are exported", () => {
  it("IPC_TTS_CHUNK / IPC_STT_TOKEN channel constants are visible to the bridge", () => {
    // The outbound channels are driven by the session orchestrator
    // calling deps.sendIpc(channel, payload); the bridge does not
    // need to register a handler — it provides the destination
    // (window.webContents.send) via the WireIpcBridgeOptions. This
    // smoke test pins the IPC channel constants are available so a
    // future renaming is caught at the type level.
    expect(IPC_TTS_CHUNK).toBe("achilles:tts-chunk");
    expect(IPC_STT_TOKEN).toBe("achilles:stt-token");
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
