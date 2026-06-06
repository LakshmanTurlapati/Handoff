// @vitest-environment jsdom
/**
 * Waveform component tests (WF1-WF4).
 *
 * Verifies the canvas dimensions, the analyser polling, the null-source
 * static-baseline branch, and the state-driven color tokens.
 *
 * jsdom 26 does NOT ship a Canvas 2D context (it returns null and
 * throws a not-implemented warning unless the `canvas` npm package is
 * installed). To keep the dev dependency footprint tight, this test
 * installs a minimal Canvas 2D shim on `HTMLCanvasElement.prototype`
 * BEFORE rendering — the shim records `fillStyle` / `fillRect` /
 * `clearRect` calls so structural assertions (WF1/WF2/WF3) and the
 * fillStyle-token assertions (WF4) can run without rasterisation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MockAnalyser } from "./MockAnalyser.js";
import { Waveform } from "./Waveform.js";

interface Canvas2DStub {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  fillCalls: Array<{ x: number; y: number; w: number; h: number; style: string }>;
  recordedFillStyles: string[];
}

let canvasStubs: Canvas2DStub[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | null = null;

beforeEach(() => {
  canvasStubs = [];
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    type: string,
  ): any {
    if (type !== "2d") return null;
    let internalFill: string | CanvasGradient | CanvasPattern = "#000000";
    const recordedFillStyles: string[] = [];
    const fillCalls: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      style: string;
    }> = [];
    const stub: Canvas2DStub = {
      get fillStyle(): string | CanvasGradient | CanvasPattern {
        return internalFill;
      },
      set fillStyle(v: string | CanvasGradient | CanvasPattern) {
        internalFill = v;
        if (typeof v === "string") {
          recordedFillStyles.push(v);
        }
      },
      clearRect(_x: number, _y: number, _w: number, _h: number): void {
        // no-op (the shim does not rasterise)
      },
      fillRect(x: number, y: number, w: number, h: number): void {
        const style =
          typeof internalFill === "string" ? internalFill : "<non-string>";
        fillCalls.push({ x, y, w, h, style });
      },
      fillCalls,
      recordedFillStyles,
    };
    canvasStubs.push(stub);
    return stub as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  if (originalGetContext !== null) {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  }
});

function lastFillStyle(): string | null {
  for (let i = canvasStubs.length - 1; i >= 0; i--) {
    const stub = canvasStubs[i]!;
    if (stub.recordedFillStyles.length > 0) {
      return stub.recordedFillStyles[stub.recordedFillStyles.length - 1]!;
    }
  }
  return null;
}

/**
 * Installs a stub `requestAnimationFrame` that runs the callback
 * synchronously with the supplied timestamp, then disconnects so the
 * loop does not infinitely recurse.
 */
function installSingleShotRaf(timestamp: number): {
  invocations: number;
  restore: () => void;
} {
  const originalRaf = window.requestAnimationFrame;
  const originalCaf = window.cancelAnimationFrame;
  let invocations = 0;
  let scheduled = false;
  window.requestAnimationFrame = (
    cb: FrameRequestCallback,
  ): number => {
    if (scheduled) {
      // Already fired once — refuse to recurse.
      return 0;
    }
    scheduled = true;
    invocations++;
    cb(timestamp);
    return 1;
  };
  window.cancelAnimationFrame = (_id: number): void => {
    // no-op
  };
  return {
    get invocations(): number {
      return invocations;
    },
    restore(): void {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    },
  };
}

describe("Waveform — WF1: canvas dimensions match UI-SPEC §2", () => {
  it("WF1: renders a <canvas> with width=190 height=22 (32 bars at default size)", () => {
    const analyser = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.5,
    });
    const { getByTestId } = render(
      <Waveform state="listening" analyser={analyser} />,
    );
    const canvas = getByTestId("waveform") as HTMLCanvasElement;
    expect(canvas.tagName.toLowerCase()).toBe("canvas");
    expect(canvas.width).toBe(190);
    expect(canvas.height).toBe(22);
    analyser.stop();
  });

  it("WF1 variant: custom bar config produces the documented total width", () => {
    const analyser = new MockAnalyser({
      state: "listening",
      barCount: 16,
      amplitudeSource: () => 0.5,
    });
    const { getByTestId } = render(
      <Waveform
        state="listening"
        analyser={analyser}
        barCount={16}
        barWidth={6}
        barGap={3}
        maxBarHeight={20}
      />,
    );
    const canvas = getByTestId("waveform") as HTMLCanvasElement;
    expect(canvas.width).toBe(16 * 6 + 15 * 3); // 141
    expect(canvas.height).toBe(20);
    analyser.stop();
  });
});

describe("Waveform — WF2: schedules a draw call reading 32 values from the analyser", () => {
  it("WF2: in listening state with a MockAnalyser, the rAF loop polls getByteFrequencyData", () => {
    const analyser = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.5,
    });
    const spy = vi.spyOn(analyser, "getByteFrequencyData");

    const raf = installSingleShotRaf(1000);
    const { unmount } = render(
      <Waveform state="listening" analyser={analyser} />,
    );
    // The effect runs synchronously inside render, schedules the rAF
    // loop, and the single-shot callback fires. Total invocations:
    // initial draw (synchronous in effect) + one rAF loop tick.
    expect(spy).toHaveBeenCalled();
    expect(raf.invocations).toBeGreaterThanOrEqual(1);
    unmount();
    analyser.stop();
    raf.restore();
  });
});

describe("Waveform — WF3: null analyser → static baseline, no rAF loop", () => {
  it("WF3: when analyser is null, no rAF loop is scheduled", () => {
    const raf = installSingleShotRaf(1000);
    const { getByTestId, unmount } = render(
      <Waveform state="listening" analyser={null} />,
    );
    expect(getByTestId("waveform")).toBeDefined();
    expect(raf.invocations).toBe(0);
    unmount();
    raf.restore();
  });

  it("WF3 idle: state='idle' suppresses the rAF loop even with an analyser", () => {
    const analyser = new MockAnalyser({ state: "idle" });
    const raf = installSingleShotRaf(1000);
    const { unmount } = render(
      <Waveform state="idle" analyser={analyser} />,
    );
    expect(raf.invocations).toBe(0);
    unmount();
    analyser.stop();
    raf.restore();
  });
});

describe("Waveform — WF4: state-driven fill color tokens", () => {
  it("WF4: idle uses --achilles-text-dim color token", () => {
    const { unmount } = render(<Waveform state="idle" analyser={null} />);
    const recorded = lastFillStyle();
    expect(recorded).not.toBeNull();
    // jsdom does not resolve CSS custom properties without an
    // attached stylesheet, so the component falls back to the
    // documented literal `rgba(232,234,237,0.7)`.
    expect(recorded).toMatch(/rgba\(232,234,237,0\.7\)/);
    unmount();
  });

  it("WF4: listening uses --achilles-listening (or its #3DD68C fallback)", () => {
    const analyser = new MockAnalyser({
      state: "listening",
      amplitudeSource: () => 0.5,
    });
    const { unmount } = render(
      <Waveform state="listening" analyser={analyser} />,
    );
    const recorded = lastFillStyle();
    expect(recorded).not.toBeNull();
    expect(recorded!.toLowerCase()).toMatch(/(#3dd68c|3dd68c|rgb\(61,\s*214,\s*140\))/);
    unmount();
    analyser.stop();
  });

  it("WF4: speaking uses --achilles-speaking (or its #4A9EFF fallback)", () => {
    const analyser = new MockAnalyser({
      state: "speaking",
      amplitudeSource: () => 0.5,
    });
    const { unmount } = render(
      <Waveform state="speaking" analyser={analyser} />,
    );
    const recorded = lastFillStyle();
    expect(recorded).not.toBeNull();
    expect(recorded!.toLowerCase()).toMatch(/(#4a9eff|4a9eff|rgb\(74,\s*158,\s*255\))/);
    unmount();
    analyser.stop();
  });

  it("WF4: error uses --achilles-error at 0.3 opacity", () => {
    const { unmount } = render(<Waveform state="error" analyser={null} />);
    const recorded = lastFillStyle();
    expect(recorded).not.toBeNull();
    // 0.3 opacity is baked into rgba(...,0.3)
    expect(recorded).toMatch(/rgba\(255,77,79,0\.3\)/);
    unmount();
  });
});
