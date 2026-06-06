/**
 * ErrorBanner — UI-SPEC §8 banner rendered when `state === 'error'`.
 *
 * Displays the message text for one of the four mocked error kinds with
 * a Dismiss button. Phase 11 auto-dismisses after 8000ms (UI-SPEC §8
 * mock semantics); Phase 12 will make this configurable per error class.
 *
 * Accessibility:
 *   - `role="alert"` for assertive screen-reader announcement
 *   - The Dismiss button is a real `<button>` so keyboard focus works
 *
 * The component intentionally does NOT own the four locked copy strings
 * — App.tsx looks up the appropriate message from the error kind and
 * passes it through `props.message`. Centralising the copy at the
 * composition root keeps the locked strings in one place (and lets
 * Plan 12 swap them with localised variants without touching this
 * component).
 */
import { useEffect, type ReactElement } from "react";

export interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  /**
   * Auto-dismiss timeout in milliseconds. Default 8000 per UI-SPEC §8.
   * Tests inject 0 (or `Infinity` via undefined override) to disable.
   */
  autoDismissMs?: number;
}

const DEFAULT_AUTO_DISMISS_MS = 8000;
const DISMISS_COPY = "Dismiss";

function ExclamationTriangleIcon(): ReactElement {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
}: ErrorBannerProps): ReactElement {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const token = setTimeout(() => {
      onDismiss();
    }, autoDismissMs);
    return () => {
      clearTimeout(token);
    };
  }, [autoDismissMs, message, onDismiss]);

  return (
    <div
      role="alert"
      data-testid="error-banner"
      className="error-banner"
    >
      <span className="error-banner-icon" aria-hidden="true">
        <ExclamationTriangleIcon />
      </span>
      <span className="error-banner-message">{message}</span>
      <button
        type="button"
        data-testid="error-banner-dismiss"
        className="error-banner-dismiss"
        onClick={onDismiss}
      >
        {DISMISS_COPY}
      </button>
    </div>
  );
}
