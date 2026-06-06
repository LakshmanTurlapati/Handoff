/**
 * PermissionOverlay — UI-07 remediation surface.
 *
 * Three states surface through this component (UI-SPEC §6):
 *
 *   - 'denied'     → mic-off icon + locked heading + body deep-link copy
 *                    + primary CTA 'Open System Settings'
 *   - 'restricted' → same icon + heading + organisation-restricted body
 *                    + NO CTA (the user cannot self-remediate)
 *
 * The 'granted' and 'not-determined' branches never render the overlay
 * (the caller — App.tsx — gates mounting). This component intentionally
 * does NOT poll permission state itself; the main process owns the
 * 2000ms re-poll cadence via `schedulePermissionPoll` and broadcasts
 * updates through `IPC_PERMISSION_STATE`. The renderer is a pure
 * projection of main's view (CONTEXT.md locked decision).
 *
 * Accessibility (UI-SPEC §5):
 *   - role="dialog", aria-modal="true"
 *   - aria-labelledby points at the heading element's id
 *   - Focusable CTA button so screen readers can activate it
 *
 * NO emojis (CLAUDE.md global). The body uses the literal UTF-8 right
 * arrow '→' (U+2192), not the HTML entity `&rarr;` — matching the
 * verbatim UI-SPEC §6 copy.
 */
import type { ReactElement } from "react";

export interface PermissionOverlayProps {
  permissionState: "denied" | "restricted";
  platform: "darwin" | "win32" | "linux";
  onOpenSystemSettings: () => void;
}

const HEADING_ID = "permission-overlay-heading";

const HEADING_COPY = "Achilles needs microphone access";

const BODY_COPY_DENIED =
  "Open System Settings → Privacy & Security → Microphone and enable Achilles.";

const BODY_COPY_RESTRICTED =
  "Microphone access is restricted by your organization. Contact your administrator to enable Achilles.";

const CTA_COPY = "Open System Settings";

/**
 * Inline mic-off SVG. 32x32 viewport per UI-SPEC §6. Single-color so
 * it inherits `currentColor` and picks up `--achilles-error` from CSS.
 */
function MicOffIcon(): ReactElement {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export function PermissionOverlay({
  permissionState,
  platform: _platform,
  onOpenSystemSettings,
}: PermissionOverlayProps): ReactElement {
  const bodyCopy =
    permissionState === "denied" ? BODY_COPY_DENIED : BODY_COPY_RESTRICTED;
  const showCta = permissionState === "denied";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={HEADING_ID}
      data-testid="permission-overlay"
      data-permission-state={permissionState}
      className="permission-overlay"
    >
      <div className="permission-overlay-icon" aria-hidden="true">
        <MicOffIcon />
      </div>
      <h2 id={HEADING_ID} className="permission-overlay-heading">
        {HEADING_COPY}
      </h2>
      <p className="permission-overlay-body">{bodyCopy}</p>
      {showCta ? (
        <button
          type="button"
          data-testid="permission-overlay-cta"
          className="permission-overlay-cta"
          onClick={onOpenSystemSettings}
        >
          {CTA_COPY}
        </button>
      ) : null}
    </div>
  );
}
