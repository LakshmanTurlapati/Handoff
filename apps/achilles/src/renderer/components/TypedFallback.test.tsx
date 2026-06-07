/**
 * @vitest-environment jsdom
 *
 * Plan 14-03 — Behaviour tests for TypedFallback (SAFE-05 UX critical path).
 *
 *   TF1: active=true renders the overlay + locked label + autofocused input
 *   TF1b: active=false renders nothing (returns null)
 *   TF2: Enter on a non-empty value invokes onSubmit(trimmed) AND clears the input
 *   TF3: Escape invokes onCancel
 *   TF4: Empty / whitespace-only submission is silently ignored
 *   TF5: data-testids are stable + locked label text is verbatim
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TypedFallback } from "./TypedFallback.js";

afterEach(() => {
  cleanup();
});

describe("TypedFallback — TF1 active=true renders overlay + locked label + autofocused input", () => {
  it("renders the testid container, label, and input when active=true", () => {
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId("typed-fallback")).not.toBeNull();
    expect(screen.getByTestId("typed-fallback-label")).not.toBeNull();
    expect(screen.getByTestId("typed-fallback-input")).not.toBeNull();
  });

  it("locks the label text to 'STT unavailable. Type your prompt.' verbatim", () => {
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const label = screen.getByTestId("typed-fallback-label");
    expect(label.textContent).toBe("STT unavailable. Type your prompt.");
  });

  it("input carries placeholder='Type your prompt'", () => {
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    expect(input.placeholder).toBe("Type your prompt");
  });
});

describe("TypedFallback — TF1b active=false renders nothing", () => {
  it("returns null and produces no DOM children", () => {
    const { container } = render(
      <TypedFallback active={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.children.length).toBe(0);
    expect(screen.queryByTestId("typed-fallback")).toBeNull();
  });
});

describe("TypedFallback — TF2 Enter on non-empty value invokes onSubmit", () => {
  it("invokes onSubmit(trimmedText) on Enter and clears the input", () => {
    const onSubmit = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  refactor the auth module  " } });
    expect(input.value).toBe("  refactor the auth module  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("refactor the auth module");
    // After submit the input is cleared.
    expect(input.value).toBe("");
  });

  it("does NOT invoke onCancel when Enter is pressed", () => {
    const onCancel = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("TypedFallback — TF3 Escape invokes onCancel", () => {
  it("invokes onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onSubmit when Escape is pressed (even with non-empty value)", () => {
    const onSubmit = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "anything" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TypedFallback — TF4 empty / whitespace-only submission is silently ignored", () => {
  it("does NOT invoke onSubmit when value is empty", () => {
    const onSubmit = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT invoke onSubmit when value is whitespace-only", () => {
    const onSubmit = vi.fn();
    render(
      <TypedFallback active={true} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const input = screen.getByTestId("typed-fallback-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "    " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("TypedFallback — TF5 testids stable + accessibility wiring", () => {
  it("container carries role='dialog' for assistive tech", () => {
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const container = screen.getByTestId("typed-fallback");
    expect(container.getAttribute("role")).toBe("dialog");
  });

  it("container aria-label matches the locked label verbatim", () => {
    render(
      <TypedFallback active={true} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const container = screen.getByTestId("typed-fallback");
    expect(container.getAttribute("aria-label")).toBe(
      "STT unavailable. Type your prompt.",
    );
  });
});
