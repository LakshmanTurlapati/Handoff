/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for RecordingIndicator (Plan 14-02 SAFE-02).
 *
 *   - RI1a: visible=true renders the dot + label + testid
 *   - RI1b: visible=true ships the locked label text 'Recording transcripts'
 *   - RI1c: visible=true marks the dot with the .recording-dot class
 *           so the pulse keyframe applies
 *   - RI2:  visible=false renders nothing (null)
 *   - RI3:  the component subscribes to NOTHING — it is controlled
 *           purely by props
 *   - RI4:  role='status' for assistive tech (screen reader announces)
 *
 * The component is exercised in isolation; the App.tsx wiring (which
 * subscribes to IPC_TRANSCRIPT_PERSISTENCE_STATE) is covered by the
 * App composition tests separately. RI1..RI4 verify the locked
 * markup contract.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecordingIndicator } from "./RecordingIndicator.js";

afterEach(() => {
  cleanup();
});

describe("RecordingIndicator — RI1 visible=true renders dot + label + testid", () => {
  it("RI1a: produces the data-testid='recording-indicator' container", () => {
    render(<RecordingIndicator visible={true} />);
    const container = screen.getByTestId("recording-indicator");
    expect(container).not.toBeNull();
  });

  it("RI1b: renders the locked label text 'Recording transcripts' verbatim", () => {
    render(<RecordingIndicator visible={true} />);
    const label = screen.getByTestId("recording-indicator-label");
    expect(label.textContent).toBe("Recording transcripts");
  });

  it("RI1c: marks the dot with the .recording-dot CSS class so the pulse keyframe applies", () => {
    render(<RecordingIndicator visible={true} />);
    const dot = screen.getByTestId("recording-indicator-dot");
    expect(dot.className).toContain("recording-dot");
  });

  it("RI1d: container carries the .recording-indicator CSS class for positioning", () => {
    render(<RecordingIndicator visible={true} />);
    const container = screen.getByTestId("recording-indicator");
    expect(container.className).toContain("recording-indicator");
  });
});

describe("RecordingIndicator — RI2 visible=false renders nothing", () => {
  it("returns null and produces no DOM children", () => {
    const { container } = render(<RecordingIndicator visible={false} />);
    expect(container.children.length).toBe(0);
    // The testid query must NOT find the indicator.
    const found = screen.queryByTestId("recording-indicator");
    expect(found).toBeNull();
  });
});

describe("RecordingIndicator — RI3 controlled (no subscriptions)", () => {
  it("re-rendering with toggled props mounts/unmounts cleanly", () => {
    const { rerender } = render(<RecordingIndicator visible={false} />);
    expect(screen.queryByTestId("recording-indicator")).toBeNull();
    rerender(<RecordingIndicator visible={true} />);
    expect(screen.getByTestId("recording-indicator")).not.toBeNull();
    rerender(<RecordingIndicator visible={false} />);
    expect(screen.queryByTestId("recording-indicator")).toBeNull();
  });
});

describe("RecordingIndicator — RI4 a11y role='status'", () => {
  it("declares role='status' for assistive tech", () => {
    render(<RecordingIndicator visible={true} />);
    const container = screen.getByTestId("recording-indicator");
    expect(container.getAttribute("role")).toBe("status");
  });

  it("carries the aria-label='Recording transcripts'", () => {
    render(<RecordingIndicator visible={true} />);
    const container = screen.getByTestId("recording-indicator");
    expect(container.getAttribute("aria-label")).toBe("Recording transcripts");
  });
});
