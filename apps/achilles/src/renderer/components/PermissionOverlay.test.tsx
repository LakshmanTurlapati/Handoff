/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for PermissionOverlay (UI-07).
 *
 *   - PO1: 'denied' renders the locked heading + body + CTA copy verbatim
 *   - PO2: 'restricted' renders the organisation copy AND hides the CTA
 *   - PO3: clicking the CTA invokes onOpenSystemSettings exactly once
 *   - PO4: a11y — role="dialog", aria-modal="true", aria-labelledby
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PermissionOverlay } from "./PermissionOverlay.js";

afterEach(() => {
  cleanup();
});

describe("PermissionOverlay — PO1 'denied' renders locked UI-SPEC §6 copy", () => {
  it("includes heading 'Achilles needs microphone access', body deep-link copy, and CTA 'Open System Settings'", () => {
    render(
      <PermissionOverlay
        permissionState="denied"
        platform="darwin"
        onOpenSystemSettings={() => {}}
      />,
    );

    const overlay = screen.getByTestId("permission-overlay");
    expect(overlay).toBeTruthy();

    const heading = overlay.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe("Achilles needs microphone access");

    const body = overlay.querySelector("p");
    expect(body).not.toBeNull();
    expect(body!.textContent).toBe(
      "Open System Settings → Privacy & Security → Microphone and enable Achilles.",
    );

    const cta = screen.getByTestId("permission-overlay-cta");
    expect(cta.textContent).toBe("Open System Settings");
  });
});

describe("PermissionOverlay — PO2 'restricted' organisation copy + NO CTA", () => {
  it("includes the organisation-restricted body and DOES NOT render the CTA button", () => {
    render(
      <PermissionOverlay
        permissionState="restricted"
        platform="darwin"
        onOpenSystemSettings={() => {}}
      />,
    );

    const overlay = screen.getByTestId("permission-overlay");
    const heading = overlay.querySelector("h2");
    expect(heading!.textContent).toBe("Achilles needs microphone access");

    const body = overlay.querySelector("p");
    expect(body!.textContent).toBe(
      "Microphone access is restricted by your organization. Contact your administrator to enable Achilles.",
    );

    // The CTA is structurally absent — UI-SPEC §6 explicitly hides it
    // because the restricted user cannot self-remediate.
    expect(screen.queryByTestId("permission-overlay-cta")).toBeNull();
  });
});

describe("PermissionOverlay — PO3 CTA click invokes onOpenSystemSettings exactly once", () => {
  it("calls the prop callback when the user clicks the CTA", () => {
    const onOpenSystemSettings = vi.fn();
    render(
      <PermissionOverlay
        permissionState="denied"
        platform="darwin"
        onOpenSystemSettings={onOpenSystemSettings}
      />,
    );

    const cta = screen.getByTestId("permission-overlay-cta");
    cta.click();

    expect(onOpenSystemSettings).toHaveBeenCalledTimes(1);
  });
});

describe("PermissionOverlay — PO4 a11y attributes", () => {
  it("declares role='dialog', aria-modal='true', and aria-labelledby targeting the heading id", () => {
    render(
      <PermissionOverlay
        permissionState="denied"
        platform="darwin"
        onOpenSystemSettings={() => {}}
      />,
    );

    const overlay = screen.getByTestId("permission-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");

    const labelledById = overlay.getAttribute("aria-labelledby");
    expect(labelledById).not.toBeNull();

    const heading = overlay.querySelector(`#${labelledById!}`);
    expect(heading).not.toBeNull();
    expect(heading!.tagName.toLowerCase()).toBe("h2");
  });
});
