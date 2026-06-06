/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for ErrorBanner (UI-SPEC §8).
 *
 *   - EB1: each of the 4 mocked error kinds renders the locked copy
 *     verbatim alongside the 'Dismiss' button.
 *   - EB2: clicking the dismiss button invokes onDismiss exactly once
 *   - EB3: the banner auto-dismisses after 8000ms (vi.useFakeTimers)
 *   - EB4: role="alert" for assertive screen-reader announcement
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBanner } from "./ErrorBanner.js";

const ERROR_COPY: Record<string, string> = {
  mic_unavailable: "Microphone not available. Check your input device.",
  hotkey_collision:
    "Hotkey is in use by another app. Change it in Settings.",
  persistence_failure:
    "Could not save window position. Settings may not persist.",
  unknown: "Something went wrong. Try again in a moment.",
};

afterEach(() => {
  cleanup();
});

describe("ErrorBanner — EB1 locked UI-SPEC §8 copy + Dismiss button", () => {
  for (const [kind, message] of Object.entries(ERROR_COPY)) {
    it(`renders message text exactly for kind=${kind}`, () => {
      render(<ErrorBanner message={message} onDismiss={() => {}} autoDismissMs={0} />);
      const banner = screen.getByTestId("error-banner");
      expect(banner.textContent).toContain(message);

      const dismiss = screen.getByTestId("error-banner-dismiss");
      expect(dismiss.textContent).toBe("Dismiss");
    });
  }
});

describe("ErrorBanner — EB2 dismiss click invokes onDismiss exactly once", () => {
  it("calls the prop callback on click", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorBanner
        message={ERROR_COPY.mic_unavailable!}
        onDismiss={onDismiss}
        autoDismissMs={0}
      />,
    );
    const dismiss = screen.getByTestId("error-banner-dismiss");
    dismiss.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorBanner — EB3 auto-dismisses after 8000ms", () => {
  it("invokes onDismiss exactly once after 8000ms of mounted time", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <ErrorBanner
          message={ERROR_COPY.unknown!}
          onDismiss={onDismiss}
          autoDismissMs={8000}
        />,
      );
      // 7999ms in — not yet dismissed.
      vi.advanceTimersByTime(7999);
      expect(onDismiss).not.toHaveBeenCalled();
      // 8000ms — fires exactly once.
      vi.advanceTimersByTime(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ErrorBanner — EB4 role='alert' a11y", () => {
  it("declares role='alert' on the banner root", () => {
    render(
      <ErrorBanner
        message={ERROR_COPY.unknown!}
        onDismiss={() => {}}
        autoDismissMs={0}
      />,
    );
    const banner = screen.getByTestId("error-banner");
    expect(banner.getAttribute("role")).toBe("alert");
  });
});
