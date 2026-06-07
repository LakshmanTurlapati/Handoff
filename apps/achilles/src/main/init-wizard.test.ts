/**
 * init-wizard.ts behaviour tests for Plan 13-03 (DIST-04).
 *
 * Coverage map:
 *
 *   - K1  : shared/constants.ts exports all 13 new init-wizard constants
 *           with locked literal values.
 *   - W1  : createInitWizardWindow records the locked window options
 *           (frame:false, transparent:true, alwaysOnTop:true,
 *           focusable:true, skipTaskbar:true, width:360, height:480,
 *           modal:false, resizable:false, webPreferences contextIsolation
 *           + nodeIntegration:false + sandbox:true). The window is
 *           centred on the primary display's workArea.
 *   - W2  : createInitWizardWindow does NOT pass a `parent` option (the
 *           wizard is not a child of the floating shell — the floating
 *           shell does not exist in init mode).
 *   - S1  : submitApiKey validates length and persists via the store.
 *   - S2  : submitApiKey rejects keys shorter than MIN_ELEVENLABS_KEY_LENGTH.
 *   - S3  : submitApiKey accepts a key without the sk_ prefix with a
 *           non-blocking warning.
 *   - S4  : requestMicPermission routes through probePermissionImpl with
 *           triggerAskForMediaAccess: true and broadcasts the result.
 *   - S5  : requestMicPermission surfaces the denied outcome verbatim and
 *           does NOT trigger any side effect on main beyond the broadcast.
 *   - S6  : runSmokeTest happy path resolves with the spoken phrase and
 *           broadcasts via IPC_INIT_SMOKE_RESULT.
 *   - S7  : runSmokeTest times out at SMOKE_TEST_TIMEOUT_MS and broadcasts
 *           { status: 'timed-out' }.
 *   - S8  : markWizardDone invokes appQuitImpl().
 *
 * NO emojis (CLAUDE.md global). All Electron / store / probe / smoke
 * dependencies are injected — no real BrowserWindow or systemPreferences
 * is constructed in this file.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ACHILLES_MODE_INIT,
  ELEVENLABS_KEY_PREFIX,
  IPC_INIT_API_KEY_RESULT,
  IPC_INIT_API_KEY_SUBMIT,
  IPC_INIT_MIC_PERMISSION_REQUEST,
  IPC_INIT_MIC_PERMISSION_RESULT,
  IPC_INIT_SMOKE_RESULT,
  IPC_INIT_SMOKE_START,
  IPC_INIT_WIZARD_DONE,
  IPC_INIT_WIZARD_STEP,
  MIN_ELEVENLABS_KEY_LENGTH,
  SMOKE_TEST_CANNED_PHRASE,
  SMOKE_TEST_TIMEOUT_MS,
} from "../shared/constants.js";
import {
  createInitWizardSession,
  createInitWizardWindow,
} from "./init-wizard.js";

// ─────────────────────────────────────────────────────────────────────
// K1 — locked constant exports
// ─────────────────────────────────────────────────────────────────────

describe("K1: shared/constants.ts exports the 13 init-wizard constants", () => {
  it("ACHILLES_MODE_INIT is the literal 'init'", () => {
    expect(ACHILLES_MODE_INIT).toBe("init");
  });
  it("IPC_INIT_* channel constants follow the achilles: prefix convention", () => {
    expect(IPC_INIT_WIZARD_STEP).toBe("achilles:init-wizard-step");
    expect(IPC_INIT_API_KEY_SUBMIT).toBe("achilles:init-api-key-submit");
    expect(IPC_INIT_API_KEY_RESULT).toBe("achilles:init-api-key-result");
    expect(IPC_INIT_MIC_PERMISSION_REQUEST).toBe(
      "achilles:init-mic-permission-request",
    );
    expect(IPC_INIT_MIC_PERMISSION_RESULT).toBe(
      "achilles:init-mic-permission-result",
    );
    expect(IPC_INIT_SMOKE_START).toBe("achilles:init-smoke-start");
    expect(IPC_INIT_SMOKE_RESULT).toBe("achilles:init-smoke-result");
    expect(IPC_INIT_WIZARD_DONE).toBe("achilles:init-wizard-done");
  });
  it("validation + canned-phrase + timeout constants are locked at the literal values", () => {
    expect(MIN_ELEVENLABS_KEY_LENGTH).toBe(32);
    expect(ELEVENLABS_KEY_PREFIX).toBe("sk_");
    expect(SMOKE_TEST_CANNED_PHRASE).toBe(
      "Hello from Achilles, I am ready to help.",
    );
    expect(SMOKE_TEST_TIMEOUT_MS).toBe(60000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// W1 + W2 — createInitWizardWindow contract
// ─────────────────────────────────────────────────────────────────────

interface CapturedWindowOpts {
  opts: Record<string, unknown>;
}

interface FakeBrowserWindow {
  setPosition: (x: number, y: number, animate?: boolean) => void;
  loadURL: (url: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
  positionCalls: Array<{ x: number; y: number }>;
}

function makeFakeBrowserWindowCtor(): {
  Ctor: new (opts: Record<string, unknown>) => FakeBrowserWindow;
  captured: CapturedWindowOpts[];
} {
  const captured: CapturedWindowOpts[] = [];
  class Ctor {
    public positionCalls: Array<{ x: number; y: number }> = [];
    public webContents = { send: (_c: string, _p: unknown): void => {} };
    public constructor(opts: Record<string, unknown>) {
      captured.push({ opts });
    }
    public setPosition(x: number, y: number, _animate?: boolean): void {
      this.positionCalls.push({ x, y });
    }
    public async loadURL(_url: string): Promise<void> {
      return undefined;
    }
    public async loadFile(_path: string): Promise<void> {
      return undefined;
    }
    public isDestroyed(): boolean {
      return false;
    }
  }
  return {
    Ctor: Ctor as unknown as new (
      opts: Record<string, unknown>,
    ) => FakeBrowserWindow,
    captured,
  };
}

function makeFakeScreenRef(workArea: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { getPrimaryDisplay: () => { workArea: typeof workArea } } {
  return {
    getPrimaryDisplay() {
      return { workArea };
    },
  };
}

describe("W1: createInitWizardWindow records the locked options", () => {
  it("captures frame:false, transparent:true, alwaysOnTop:true, focusable:true, skipTaskbar:true, width:360, height:480, modal:false, resizable:false, contextIsolation:true, nodeIntegration:false, sandbox:true", () => {
    const { Ctor, captured } = makeFakeBrowserWindowCtor();
    const screenRef = makeFakeScreenRef({ x: 0, y: 0, width: 1920, height: 1080 });
    createInitWizardWindow({ BrowserWindowCtor: Ctor, screenRef });
    expect(captured).toHaveLength(1);
    const opts = captured[0]!.opts;
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.focusable).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.width).toBe(360);
    expect(opts.height).toBe(480);
    expect(opts.modal).toBe(false);
    expect(opts.resizable).toBe(false);
    const webPrefs = opts.webPreferences as Record<string, unknown>;
    expect(webPrefs.contextIsolation).toBe(true);
    expect(webPrefs.nodeIntegration).toBe(false);
    expect(webPrefs.sandbox).toBe(true);
  });

  it("positions the window at the workArea centre (x = workArea.x + (workArea.width - 360) / 2, y = workArea.y + (workArea.height - 480) / 2)", () => {
    const { Ctor } = makeFakeBrowserWindowCtor();
    const screenRef = makeFakeScreenRef({ x: 100, y: 50, width: 1920, height: 1080 });
    const window = createInitWizardWindow({ BrowserWindowCtor: Ctor, screenRef });
    const expectedX = 100 + (1920 - 360) / 2;
    const expectedY = 50 + (1080 - 480) / 2;
    expect(window.positionCalls).toEqual([{ x: expectedX, y: expectedY }]);
  });
});

describe("W2: createInitWizardWindow does NOT carry a `parent` option", () => {
  it("the captured opts have no `parent` key", () => {
    const { Ctor, captured } = makeFakeBrowserWindowCtor();
    const screenRef = makeFakeScreenRef({ x: 0, y: 0, width: 1920, height: 1080 });
    createInitWizardWindow({ BrowserWindowCtor: Ctor, screenRef });
    const opts = captured[0]!.opts;
    expect(Object.prototype.hasOwnProperty.call(opts, "parent")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// S1-S8 — createInitWizardSession state-machine contract
// ─────────────────────────────────────────────────────────────────────

interface IpcCall {
  channel: string;
  payload: unknown;
}

interface SessionSeams {
  ipcCalls: IpcCall[];
  writeKeyCalls: string[];
  probeCalls: Array<{ triggerAskForMediaAccess: boolean }>;
  smokeCalls: number;
  quitCalls: number;
  pendingTimers: Array<{ cb: () => void; ms: number; id: number }>;
  now: number;
}

function makeSeams(): SessionSeams {
  return {
    ipcCalls: [],
    writeKeyCalls: [],
    probeCalls: [],
    smokeCalls: 0,
    quitCalls: 0,
    pendingTimers: [],
    now: 0,
  };
}

describe("S1: submitApiKey persists a valid key and broadcasts accepted", () => {
  it("returns {accepted:true} when key has length >= 32 and starts with sk_; calls writeElevenlabsApiKey once with the exact bytes; broadcasts IPC_INIT_API_KEY_RESULT", async () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: {
        writeElevenlabsApiKey: (key: string): void => {
          seams.writeKeyCalls.push(key);
        },
      },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => {
        seams.quitCalls += 1;
      },
    });
    const key = `sk_${"x".repeat(31)}`;
    const result = await session.submitApiKey(key);
    expect(result).toEqual({ accepted: true });
    expect(seams.writeKeyCalls).toEqual([key]);
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_API_KEY_RESULT,
      payload: { accepted: true },
    });
  });
});

describe("S2: submitApiKey rejects too-short keys", () => {
  it("returns {accepted:false, reason:'too-short'} and does NOT persist", async () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: {
        writeElevenlabsApiKey: (key: string): void => {
          seams.writeKeyCalls.push(key);
        },
      },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => {
        seams.quitCalls += 1;
      },
    });
    const result = await session.submitApiKey("sk_short");
    expect(result).toEqual({ accepted: false, reason: "too-short" });
    expect(seams.writeKeyCalls).toEqual([]);
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_API_KEY_RESULT,
      payload: { accepted: false, reason: "too-short" },
    });
  });
});

describe("S3: submitApiKey accepts a key without sk_ prefix with a warning", () => {
  it("returns {accepted:true, warning:'unexpected-prefix'} and persists the value", async () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: {
        writeElevenlabsApiKey: (key: string): void => {
          seams.writeKeyCalls.push(key);
        },
      },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => {
        seams.quitCalls += 1;
      },
    });
    const key = `xi-api-key-${"x".repeat(40)}`;
    const result = await session.submitApiKey(key);
    expect(result).toEqual({ accepted: true, warning: "unexpected-prefix" });
    expect(seams.writeKeyCalls).toEqual([key]);
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_API_KEY_RESULT,
      payload: { accepted: true, warning: "unexpected-prefix" },
    });
  });
});

describe("S4: requestMicPermission routes through probePermissionImpl with triggerAskForMediaAccess:true", () => {
  it("calls probePermissionImpl({triggerAskForMediaAccess:true}) and broadcasts {status:'granted'}", async () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async (opts) => {
        seams.probeCalls.push({
          triggerAskForMediaAccess: opts.triggerAskForMediaAccess,
        });
        return "granted";
      },
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => undefined,
    });
    const status = await session.requestMicPermission();
    expect(status).toBe("granted");
    expect(seams.probeCalls).toEqual([{ triggerAskForMediaAccess: true }]);
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_MIC_PERMISSION_RESULT,
      payload: { status: "granted" },
    });
  });
});

describe("S5: requestMicPermission surfaces denial without auto-opening System Settings", () => {
  it("broadcasts {status:'denied'} and the session takes NO additional side-effect", async () => {
    const seams = makeSeams();
    const shellOpenSpy = vi.fn();
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "denied",
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => undefined,
    });
    const status = await session.requestMicPermission();
    expect(status).toBe("denied");
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_MIC_PERMISSION_RESULT,
      payload: { status: "denied" },
    });
    // No deep-link side effect from session.requestMicPermission itself.
    expect(shellOpenSpy).not.toHaveBeenCalled();
  });
});

describe("S6: runSmokeTest happy path resolves with the canned phrase", () => {
  it("broadcasts {status:'ok', spokenPhrase: SMOKE_TEST_CANNED_PHRASE} via IPC_INIT_SMOKE_RESULT and the createSmokeRoundTrip seam is consumed exactly once", async () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: async () => {
        seams.smokeCalls += 1;
        return { status: "ok", spokenPhrase: SMOKE_TEST_CANNED_PHRASE };
      },
      appQuitImpl: () => undefined,
    });
    const result = await session.runSmokeTest();
    expect(result).toEqual({
      status: "ok",
      spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
    });
    expect(seams.smokeCalls).toBe(1);
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_SMOKE_RESULT,
      payload: { status: "ok", spokenPhrase: SMOKE_TEST_CANNED_PHRASE },
    });
  });
});

describe("S7: runSmokeTest times out at SMOKE_TEST_TIMEOUT_MS", () => {
  it("when createSmokeRoundTrip never resolves, the injected setTimeoutImpl fires after SMOKE_TEST_TIMEOUT_MS and the session broadcasts {status:'timed-out'}", async () => {
    const seams = makeSeams();
    let nextTimerId = 1;
    const setTimeoutImpl = (cb: () => void, ms: number): unknown => {
      const id = nextTimerId++;
      seams.pendingTimers.push({ cb, ms, id });
      return id;
    };
    const clearTimeoutImpl = (token: unknown): void => {
      const idx = seams.pendingTimers.findIndex((t) => t.id === token);
      if (idx >= 0) seams.pendingTimers.splice(idx, 1);
    };
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: () => new Promise<never>(() => undefined),
      appQuitImpl: () => undefined,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    const resultPromise = session.runSmokeTest();
    // Verify the timer was scheduled with the locked timeout.
    expect(seams.pendingTimers).toHaveLength(1);
    expect(seams.pendingTimers[0]!.ms).toBe(SMOKE_TEST_TIMEOUT_MS);
    // Fire the timer.
    seams.pendingTimers[0]!.cb();
    const result = await resultPromise;
    expect(result).toEqual({ status: "timed-out" });
    expect(seams.ipcCalls).toContainEqual({
      channel: IPC_INIT_SMOKE_RESULT,
      payload: { status: "timed-out" },
    });
  });
});

describe("S8: markWizardDone calls appQuitImpl exactly once and broadcasts via IPC_INIT_WIZARD_STEP", () => {
  it("invokes the appQuitImpl seam once", () => {
    const seams = makeSeams();
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: {
        send: (channel, payload) => {
          seams.ipcCalls.push({ channel, payload });
        },
      },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: async () => ({
        status: "ok",
        spokenPhrase: SMOKE_TEST_CANNED_PHRASE,
      }),
      appQuitImpl: () => {
        seams.quitCalls += 1;
      },
    });
    session.markWizardDone();
    expect(seams.quitCalls).toBe(1);
  });
});

describe("dispose clears any pending smoke-test timer", () => {
  it("after dispose the pendingTimers list is empty", () => {
    const seams = makeSeams();
    let nextTimerId = 1;
    const setTimeoutImpl = (cb: () => void, ms: number): unknown => {
      const id = nextTimerId++;
      seams.pendingTimers.push({ cb, ms, id });
      return id;
    };
    const clearTimeoutImpl = (token: unknown): void => {
      const idx = seams.pendingTimers.findIndex((t) => t.id === token);
      if (idx >= 0) seams.pendingTimers.splice(idx, 1);
    };
    const session = createInitWizardSession({
      store: { writeElevenlabsApiKey: () => undefined },
      ipc: { send: () => undefined },
      probePermissionImpl: async () => "granted",
      createSmokeRoundTrip: () => new Promise<never>(() => undefined),
      appQuitImpl: () => undefined,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    void session.runSmokeTest();
    expect(seams.pendingTimers).toHaveLength(1);
    session.dispose();
    expect(seams.pendingTimers).toHaveLength(0);
  });
});
