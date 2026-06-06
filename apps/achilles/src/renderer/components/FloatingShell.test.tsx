// @vitest-environment jsdom
/**
 * FloatingShell composition-root tests (FS1-FS4).
 *
 * Verifies the layout slot wiring, the per-state visibility rules,
 * and that the component reads through `useAchillesState` rather than
 * prop-drilling.
 *
 * The bridge is mocked via a fake window.__mockBridge so the
 * AchillesStateProvider can wire its subscriptions in a deterministic
 * way. Each test installs a fresh mock, then drives setState /
 * emitPartialTranscript / setPermission before asserting.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type {
  AchillesState,
  PermissionState,
} from "../../shared/constants.js";
import { AchillesStateProvider } from "../state/useAchillesState.js";
import { FloatingShell } from "./FloatingShell.js";

interface MockBridge {
  setState(s: AchillesState): void;
  setPermission(p: PermissionState): void;
  emitPartialTranscript(text: string): void;
  emitCommittedTranscript(text: string): void;
  emitMicAmplitude(rms: number): void;
  emitTtsAmplitude(rms: number): void;
  emitError(message: string): void;
  __test_inject_error(kind: string): void;
  getLastEmittedIPC(): Array<{ type: string; payload: unknown }>;
  _subscribers: {
    state: Array<(s: AchillesState) => void>;
    permission: Array<(p: PermissionState) => void>;
    partial: Array<(text: string) => void>;
    committed: Array<(entry: { id: string; text: string; committedAt: number }) => void>;
    micAmp: Array<(rms: number) => void>;
    ttsAmp: Array<(rms: number) => void>;
    err: Array<(msg: string) => void>;
  };
}

function installMockBridge(): MockBridge {
  const subs: MockBridge["_subscribers"] = {
    state: [],
    permission: [],
    partial: [],
    committed: [],
    micAmp: [],
    ttsAmp: [],
    err: [],
  };
  const ipcLog: Array<{ type: string; payload: unknown }> = [];
  let committedCounter = 0;
  function nextUuid(): string {
    committedCounter++;
    return `00000000-0000-4000-8000-${committedCounter.toString(16).padStart(12, "0")}`;
  }
  const mock: MockBridge = {
    setState(s) {
      for (const cb of subs.state) cb(s);
    },
    setPermission(p) {
      for (const cb of subs.permission) cb(p);
    },
    emitPartialTranscript(text) {
      for (const cb of subs.partial) cb(text);
    },
    emitCommittedTranscript(text) {
      const entry = { id: nextUuid(), text, committedAt: Date.now() };
      for (const cb of subs.committed) cb(entry);
    },
    emitMicAmplitude(rms) {
      for (const cb of subs.micAmp) cb(rms);
    },
    emitTtsAmplitude(rms) {
      for (const cb of subs.ttsAmp) cb(rms);
    },
    emitError(message) {
      for (const cb of subs.err) cb(message);
    },
    __test_inject_error(_kind) {
      // not used in these tests
    },
    getLastEmittedIPC() {
      return ipcLog;
    },
    _subscribers: subs,
  };
  (window as unknown as { __mockBridge: MockBridge }).__mockBridge = mock;
  return mock;
}

function uninstallMockBridge(): void {
  delete (window as unknown as { __mockBridge?: MockBridge }).__mockBridge;
}

let bridge: MockBridge;
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | null = null;

beforeEach(() => {
  bridge = installMockBridge();
  // Install a minimal Canvas 2D shim so the embedded Waveform's
  // useEffect does not throw when jsdom's getContext('2d') returns
  // null. The shim records nothing — we only need to avoid the
  // not-implemented error path because FloatingShell tests do not
  // assert on Waveform internals.
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    type: string,
  ): any {
    if (type !== "2d") return null;
    return {
      fillStyle: "#000",
      clearRect: () => undefined,
      fillRect: () => undefined,
    };
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  uninstallMockBridge();
  if (originalGetContext !== null) {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  }
});

function renderShell(opts: {
  permissionOverlay?: React.ReactNode;
  errorBanner?: React.ReactNode;
  settingsPopover?: React.ReactNode;
} = {}) {
  return render(
    <AchillesStateProvider>
      <FloatingShell
        permissionOverlay={opts.permissionOverlay}
        errorBanner={opts.errorBanner}
        settingsPopover={opts.settingsPopover}
      />
    </AchillesStateProvider>,
  );
}

describe("FloatingShell — FS1: core composition with state + partial", () => {
  it("FS1: state='listening' partial='hello' renders all the expected regions", () => {
    const r = renderShell();
    act(() => {
      bridge.setState("listening");
      bridge.emitPartialTranscript("hello");
    });
    expect(r.queryByTestId("floating-shell")).not.toBeNull();
    const circle = r.queryByTestId("reactive-circle");
    expect(circle).not.toBeNull();
    expect(circle!.getAttribute("data-state")).toBe("listening");
    expect(r.queryByTestId("waveform")).not.toBeNull();
    expect(r.queryByTestId("transcript-overlay")).not.toBeNull();
    const partial = r.queryByTestId("transcript-partial");
    expect(partial).not.toBeNull();
    expect(partial!.textContent).toBe("hello");
  });
});

describe("FloatingShell — FS2: slot props render as sibling regions", () => {
  it("FS2a: permissionOverlay supplied + permission granted → permission overlay still renders", () => {
    const overlay = (
      <div data-testid="my-permission-overlay">My Permission UI</div>
    );
    const r = renderShell({ permissionOverlay: overlay });
    expect(r.queryByTestId("my-permission-overlay")).not.toBeNull();
    // permission is granted by default → core still visible
    expect(r.queryByTestId("reactive-circle")).not.toBeNull();
  });

  it("FS2b: errorBanner supplied + state==='error' → banner renders", () => {
    const banner = <div data-testid="my-error-banner">Oops</div>;
    const r = renderShell({ errorBanner: banner });
    act(() => {
      bridge.setState("error");
    });
    expect(r.queryByTestId("my-error-banner")).not.toBeNull();
  });

  it("FS2c: settingsPopover supplied → renders as a sibling", () => {
    const popover = <div data-testid="my-settings">Settings</div>;
    const r = renderShell({ settingsPopover: popover });
    expect(r.queryByTestId("my-settings")).not.toBeNull();
  });

  it("FS2d: errorBanner is only rendered when state==='error'", () => {
    const banner = <div data-testid="my-error-banner">Oops</div>;
    const r = renderShell({ errorBanner: banner });
    // Default state is 'idle' → banner should NOT render.
    expect(r.queryByTestId("my-error-banner")).toBeNull();
  });
});

describe("FloatingShell — FS3: per-state visibility rules", () => {
  it("FS3a: state==='error' hides the transcript-overlay", () => {
    const r = renderShell();
    act(() => {
      bridge.emitCommittedTranscript("hello world");
      bridge.setState("error");
    });
    expect(r.queryByTestId("transcript-overlay")).toBeNull();
  });

  it("FS3b: state==='listening' shows the transcript-overlay", () => {
    const r = renderShell();
    act(() => {
      bridge.setState("listening");
      bridge.emitPartialTranscript("in flight");
    });
    expect(r.queryByTestId("transcript-overlay")).not.toBeNull();
  });
});

describe("FloatingShell — FS4: permission overlay full-window replacement", () => {
  it("FS4a: permission='denied' AND permissionOverlay supplied → core regions hidden", () => {
    const overlay = (
      <div data-testid="full-permission-overlay">Allow mic access</div>
    );
    const r = renderShell({ permissionOverlay: overlay });
    act(() => {
      bridge.setPermission("denied");
    });
    expect(r.queryByTestId("full-permission-overlay")).not.toBeNull();
    expect(r.queryByTestId("reactive-circle")).toBeNull();
    expect(r.queryByTestId("waveform")).toBeNull();
    expect(r.queryByTestId("transcript-overlay")).toBeNull();
  });

  it("FS4b: permission='restricted' AND permissionOverlay supplied → core regions hidden", () => {
    const overlay = (
      <div data-testid="full-permission-overlay">Restricted</div>
    );
    const r = renderShell({ permissionOverlay: overlay });
    act(() => {
      bridge.setPermission("restricted");
    });
    expect(r.queryByTestId("full-permission-overlay")).not.toBeNull();
    expect(r.queryByTestId("reactive-circle")).toBeNull();
  });

  it("FS4c: permission='denied' WITHOUT permissionOverlay slot → core still renders (silent denial)", () => {
    const r = renderShell();
    act(() => {
      bridge.setPermission("denied");
    });
    // No overlay supplied → core is the only thing left to show.
    expect(r.queryByTestId("reactive-circle")).not.toBeNull();
  });

  it("FS4d: permission='granted' AND permissionOverlay supplied → both render (overlay docks above the core)", () => {
    const overlay = (
      <div data-testid="full-permission-overlay">Already granted</div>
    );
    const r = renderShell({ permissionOverlay: overlay });
    act(() => {
      bridge.setPermission("granted");
    });
    expect(r.queryByTestId("full-permission-overlay")).not.toBeNull();
    expect(r.queryByTestId("reactive-circle")).not.toBeNull();
  });
});

describe("FloatingShell — drag handle stub for Plan 11-03 wiring", () => {
  it("renders a drag-handle div with the drag-region marker (data + class)", () => {
    const r = renderShell();
    const handle = r.queryByTestId("drag-handle");
    expect(handle).not.toBeNull();
    expect((handle as HTMLElement).className).toContain("drag-handle");
    // jsdom does not serialize the proprietary -webkit-app-region CSS
    // property in the style attribute; the data-app-region marker is
    // the test seam (matches Plan 11-03's DragHandle convention so
    // FloatingShell and DragHandle can be swapped without breaking
    // tests).
    expect((handle as HTMLElement).getAttribute("data-app-region")).toBe(
      "drag",
    );
  });
});
