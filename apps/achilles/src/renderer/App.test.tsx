/**
 * @vitest-environment jsdom
 *
 * Behaviour test for App.tsx composition root.
 *
 *   - APP1: composes FloatingShell with the three overlay slots based on
 *     permissionState (denied/restricted → permissionOverlay), state==='error'
 *     + error.message (errorBanner), and the local popoverOpen flag
 *     (settingsPopover). The test asserts testid presence/absence per branch.
 *
 * The FloatingShell from Plan 11-02 is mocked here as a pass-through so this
 * test does NOT depend on Plan 11-02 being committed at the time App.test
 * runs — the integration is exercised via the headless Playwright specs.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock FloatingShell BEFORE importing App so the mock is in place when
// App's import resolution runs.
vi.mock("./components/FloatingShell.js", () => ({
  FloatingShell: ({
    permissionOverlay,
    errorBanner,
    settingsPopover,
  }: {
    permissionOverlay?: React.ReactNode;
    errorBanner?: React.ReactNode;
    settingsPopover?: React.ReactNode;
  }) => (
    <div data-testid="floating-shell-stub">
      <div data-testid="permission-slot">{permissionOverlay}</div>
      <div data-testid="error-slot">{errorBanner}</div>
      <div data-testid="settings-slot">{settingsPopover}</div>
    </div>
  ),
}));

import { App } from "./App.js";
import {
  AchillesStateProvider,
  useAchillesState,
} from "./state/useAchillesState.js";

// Install a minimal mock bridge before each render so getBridge() does
// not throw. The mock collects subscribers in arrays so dispatching
// into state happens through useReducer's setState path.
beforeEach(() => {
  (window as unknown as { __mockBridge: unknown }).__mockBridge = {
    setState: () => {},
    setPermission: () => {},
    emitPartialTranscript: () => {},
    emitCommittedTranscript: () => {},
    emitMicAmplitude: () => {},
    emitTtsAmplitude: () => {},
    emitError: () => {},
    __test_inject_error: () => {},
    getLastEmittedIPC: () => [],
    _subscribers: {
      state: [],
      permission: [],
      partial: [],
      committed: [],
      micAmp: [],
      ttsAmp: [],
      err: [],
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __mockBridge?: unknown }).__mockBridge;
});

/**
 * Test helper component — pumps actions into the reducer ONCE on mount
 * so the branches under test are exercised without round-tripping
 * through the mock bridge. The dispatch loop runs in a useEffect so
 * React doesn't see "render → setState → re-render → setState" as
 * infinite recursion.
 */
function StateActions({
  actions,
}: {
  actions: ReadonlyArray<{
    type: string;
    [k: string]: unknown;
  }>;
}): null {
  const { dispatch } = useAchillesState();
  useDispatchOnce(dispatch, actions);
  return null;
}

function useDispatchOnce(
  dispatch: ReturnType<typeof useAchillesState>["dispatch"],
  actions: ReadonlyArray<{ type: string; [k: string]: unknown }>,
): void {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ran = useRef(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    for (const a of actions) {
      dispatch(a as never);
    }
  }, [dispatch, actions]);
}

describe("App — APP1 composition root supplies overlay slots based on reducer state", () => {
  it("renders ONLY the floating shell when permissionState=granted, state=idle, popover closed", () => {
    render(
      <AchillesStateProvider>
        <App />
      </AchillesStateProvider>,
    );
    expect(screen.getByTestId("floating-shell-stub")).toBeTruthy();
    // No permission overlay, error banner, or settings popover by default.
    expect(screen.queryByTestId("permission-overlay")).toBeNull();
    expect(screen.queryByTestId("error-banner")).toBeNull();
    expect(screen.queryByTestId("settings-popover")).toBeNull();
  });

  it("mounts PermissionOverlay when permissionState is 'denied'", async () => {
    render(
      <AchillesStateProvider>
        <StateActions
          actions={[{ type: "PERMISSION_CHANGED", permission: "denied" }]}
        />
        <App />
      </AchillesStateProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("permission-overlay")).not.toBeNull();
    });
  });

  it("mounts PermissionOverlay when permissionState is 'restricted' AND hides the CTA", async () => {
    render(
      <AchillesStateProvider>
        <StateActions
          actions={[
            { type: "PERMISSION_CHANGED", permission: "restricted" },
          ]}
        />
        <App />
      </AchillesStateProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("permission-overlay")).not.toBeNull();
    });
    expect(screen.queryByTestId("permission-overlay-cta")).toBeNull();
  });

  it("mounts ErrorBanner when state === 'error' and error.message is non-empty", async () => {
    render(
      <AchillesStateProvider>
        <StateActions
          actions={[
            { type: "ERROR", message: "Something went wrong." },
            { type: "STATE_CHANGED", state: "error" },
          ]}
        />
        <App />
      </AchillesStateProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("error-banner")).not.toBeNull();
    });
    expect(screen.getByTestId("error-banner")!.textContent).toContain(
      "Something went wrong.",
    );
  });

  it("does NOT mount ErrorBanner when state === 'idle' even if a stale error is in the reducer (STATE_CHANGED to idle clears error)", async () => {
    render(
      <AchillesStateProvider>
        <StateActions
          actions={[
            { type: "ERROR", message: "Stale" },
            { type: "STATE_CHANGED", state: "idle" },
          ]}
        />
        <App />
      </AchillesStateProvider>,
    );
    // Let any pending dispatch flush before asserting absence.
    await waitFor(() => {
      // Use a positive assertion as the readiness gate: the floating
      // shell stub is always rendered.
      expect(screen.getByTestId("floating-shell-stub")).toBeTruthy();
    });
    expect(screen.queryByTestId("error-banner")).toBeNull();
  });
});
