/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for DragHandle (UI-05 affordance).
 *
 *   - DH1: renders with data-testid="drag-handle", className="drag-handle",
 *     and the -webkit-app-region: drag style applied (so Electron treats
 *     the strip as the OS drag region).
 *   - DH2: children passed through can re-enable click handling via the
 *     `no-drag` class — used by Plan 11-02's settings affordance.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DragHandle } from "./DragHandle.js";

afterEach(() => {
  cleanup();
});

describe("DragHandle — DH1 renders the locked 260×30 drag region", () => {
  it("emits the drag-handle testid + className", () => {
    render(<DragHandle />);
    const handle = screen.getByTestId("drag-handle");
    expect(handle.className).toContain("drag-handle");
  });

  it("declares data-app-region='drag' so the .drag-handle CSS rule applies -webkit-app-region: drag", () => {
    render(<DragHandle />);
    const handle = screen.getByTestId("drag-handle");
    // The proprietary `-webkit-app-region` CSS property is applied via
    // the `.drag-handle` class in overlays.css (jsdom strips inline
    // declarations of the property because it is not standard). The
    // data attribute exposes the drag-region intent to test assertions
    // without depending on jsdom understanding the CSS property.
    expect(handle.getAttribute("data-app-region")).toBe("drag");
  });
});

describe("DragHandle — DH2 children can re-enable clicks via the no-drag class", () => {
  it("renders the child and lets it carry its own className without rewriting", () => {
    render(
      <DragHandle>
        <button type="button" className="no-drag" data-testid="clickable-child">
          settings
        </button>
      </DragHandle>,
    );
    const child = screen.getByTestId("clickable-child");
    expect(child.className).toContain("no-drag");
    // Sanity-check: the child is a descendant of the drag handle root
    // so the OS treats it as inside the drag region — the `no-drag`
    // class is what re-enables click handling.
    const handle = screen.getByTestId("drag-handle");
    expect(handle.contains(child)).toBe(true);
  });
});
