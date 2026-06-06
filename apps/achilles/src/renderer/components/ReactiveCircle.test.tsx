// @vitest-environment jsdom
/**
 * ReactiveCircle component tests (RC1-RC5).
 *
 * Runs under jsdom because the component uses `document.visibilityState`
 * and the testing-library renders into a real DOM. The
 * `@vitest-environment jsdom` docblock at the top of the file overrides
 * the phase-11-unit project's default `node` environment for this file
 * only (other renderer tests can opt in the same way).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import type { AchillesState } from "../../shared/constants.js";
import { ReactiveCircle } from "./ReactiveCircle.js";

afterEach(() => {
  cleanup();
});

describe("ReactiveCircle — RC1: data-testid + data-state per state", () => {
  const STATES: AchillesState[] = [
    "idle",
    "listening",
    "processing",
    "speaking",
    "error",
  ];

  for (const s of STATES) {
    it(`RC1: state="${s}" renders with data-testid="reactive-circle" and data-state="${s}"`, () => {
      const { getByTestId } = render(
        <ReactiveCircle state={s} amplitude={0.5} />,
      );
      const el = getByTestId("reactive-circle");
      expect(el.getAttribute("data-state")).toBe(s);
      expect(el.tagName.toLowerCase()).toBe("div");
    });
  }
});

describe("ReactiveCircle — RC2: state-driven CSS classes", () => {
  it("RC2a: idle includes 'breathing' class when document is visible", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const { getByTestId } = render(
      <ReactiveCircle state="idle" amplitude={0} />,
    );
    expect(getByTestId("reactive-circle").className).toMatch(/\bbreathing\b/);
  });

  it("RC2b: processing includes 'spinning' class", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="processing" amplitude={0} />,
    );
    expect(getByTestId("reactive-circle").className).toMatch(/\bspinning\b/);
  });

  it("RC2c: error includes 'shake' class on initial mount", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="error" amplitude={0} />,
    );
    expect(getByTestId("reactive-circle").className).toMatch(/\bshake\b/);
  });

  it("RC2d: listening includes 'amplitude-driven' class", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="listening" amplitude={0.5} />,
    );
    expect(getByTestId("reactive-circle").className).toMatch(
      /\bamplitude-driven\b/,
    );
  });

  it("RC2e: speaking includes 'amplitude-driven' class", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="speaking" amplitude={0.5} />,
    );
    expect(getByTestId("reactive-circle").className).toMatch(
      /\bamplitude-driven\b/,
    );
  });
});

describe("ReactiveCircle — RC3: --circle-scale matches 0.9 + amplitude * 0.5", () => {
  it("RC3a: listening with amplitude=0 sets --circle-scale to 0.9", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="listening" amplitude={0} />,
    );
    const el = getByTestId("reactive-circle");
    const styleValue = (el as HTMLElement).style.getPropertyValue(
      "--circle-scale",
    );
    expect(parseFloat(styleValue)).toBeCloseTo(0.9, 5);
  });

  it("RC3b: listening with amplitude=0.5 sets --circle-scale to 1.15", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="listening" amplitude={0.5} />,
    );
    const el = getByTestId("reactive-circle");
    expect(
      parseFloat(el.style.getPropertyValue("--circle-scale")),
    ).toBeCloseTo(1.15, 5);
  });

  it("RC3c: speaking with amplitude=1.0 sets --circle-scale to 1.4", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="speaking" amplitude={1.0} />,
    );
    const el = getByTestId("reactive-circle");
    expect(
      parseFloat(el.style.getPropertyValue("--circle-scale")),
    ).toBeCloseTo(1.4, 5);
  });

  it("RC3d: idle/processing/error do NOT set --circle-scale", () => {
    for (const s of ["idle", "processing", "error"] as const) {
      const { getByTestId, unmount } = render(
        <ReactiveCircle state={s} amplitude={0.5} />,
      );
      const el = getByTestId("reactive-circle");
      const styleValue = el.style.getPropertyValue("--circle-scale");
      // Either empty (no inline style at all) or "" (no property set).
      expect(styleValue).toBe("");
      unmount();
    }
  });

  it("RC3e: out-of-range amplitude is clamped (defence in depth)", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="listening" amplitude={2.0} />,
    );
    const el = getByTestId("reactive-circle");
    // amplitude=1.0 → 0.9 + 1.0*0.5 = 1.4
    expect(
      parseFloat(el.style.getPropertyValue("--circle-scale")),
    ).toBeCloseTo(1.4, 5);
  });
});

describe("ReactiveCircle — RC4: breathing pauses when document hidden", () => {
  let visibilityState: "visible" | "hidden" = "visible";

  beforeEach(() => {
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
  });

  it("RC4: 'breathing' class is removed when visibility changes to hidden", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="idle" amplitude={0} />,
    );
    const el = getByTestId("reactive-circle");
    expect(el.className).toMatch(/\bbreathing\b/);

    // Flip visibility and dispatch the event the hook listens for.
    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(getByTestId("reactive-circle").className).not.toMatch(
      /\bbreathing\b/,
    );
  });

  it("RC4 reverse: 'breathing' class returns when visibility flips back", () => {
    const { getByTestId } = render(
      <ReactiveCircle state="idle" amplitude={0} />,
    );
    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getByTestId("reactive-circle").className).not.toMatch(
      /\bbreathing\b/,
    );

    act(() => {
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getByTestId("reactive-circle").className).toMatch(/\bbreathing\b/);
  });
});

describe("ReactiveCircle — RC5: click + right-click emit prop callbacks", () => {
  it("RC5a: click invokes onClick prop", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <ReactiveCircle state="idle" amplitude={0} onClick={onClick} />,
    );
    fireEvent.click(getByTestId("reactive-circle"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("RC5b: contextmenu invokes onRightClick with the React.MouseEvent", () => {
    const onRightClick = vi.fn();
    const { getByTestId } = render(
      <ReactiveCircle
        state="idle"
        amplitude={0}
        onRightClick={onRightClick}
      />,
    );
    const el = getByTestId("reactive-circle");
    fireEvent.contextMenu(el);
    expect(onRightClick).toHaveBeenCalledTimes(1);
    // First arg is a synthetic event with clientX/clientY accessible
    // (so Plan 11-03 can position the settings popover).
    const arg = onRightClick.mock.calls[0]![0]!;
    expect(arg).toBeDefined();
    expect(typeof arg.clientX).toBe("number");
    expect(typeof arg.clientY).toBe("number");
  });

  it("RC5c: contextmenu preventDefault is invoked (native menu suppressed)", () => {
    const onRightClick = vi.fn();
    const { getByTestId } = render(
      <ReactiveCircle
        state="idle"
        amplitude={0}
        onRightClick={onRightClick}
      />,
    );
    const el = getByTestId("reactive-circle");
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
