// @vitest-environment jsdom
/**
 * Behaviour tests for InitWizard (DIST-04 — three-step first-run flow).
 *
 *   - U1 : initial render is the Step 1 API key entry; masked input;
 *          Next button disabled until >= MIN_ELEVENLABS_KEY_LENGTH chars
 *   - U2 : typing + clicking Next fires bridge.sendInitWizardApiKeySubmit
 *          with the entered key verbatim
 *   - U3 : on accepted:false reason:'too-short' the locked error copy
 *          renders inline and Next stays disabled
 *   - U4 : on accepted:true the component advances to Step 2 (mic
 *          permission)
 *   - U5 : on accepted:true warning:'unexpected-prefix' a non-blocking
 *          warning banner renders and Step 2 is shown
 *   - U6 : Step 2 — clicking "Request microphone access" fires the
 *          bridge IPC; on granted the component advances to Step 3
 *   - U7 : Step 2 — on denied the locked remediation copy renders with
 *          "Open System Settings", "Retry", and "Skip mic test" buttons
 *   - U8 : Step 3 — happy path: clicking Start fires bridge.sendInitWizardSmokeStart;
 *          on ok the canned-phrase copy renders + Exit wizard button
 *          dispatches bridge.sendInitWizardDone
 *   - U9 : Step 3 — on timed-out the locked timeout copy renders + Exit
 *          wizard button
 *   - U10: no emoji codepoints in the rendered DOM at any step
 *
 * The bridge is a recording fake — the component subscribes via
 * window.achilles (the test installs it as a getter), so the same
 * AchillesPreloadApi shape that the production preload exposes is used.
 *
 * NO real Electron. NO real network. NO emojis.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PermissionState } from "../../shared/constants.js";
import { InitWizard } from "./InitWizard.js";

interface RecordedSend {
  channel: string;
  payload?: unknown;
}

interface SubscriberRegistry {
  apiKeyResult: Array<
    (
      r:
        | { accepted: true }
        | { accepted: true; warning: "unexpected-prefix" }
        | { accepted: false; reason: "too-short" },
    ) => void
  >;
  micPermissionResult: Array<(r: { status: PermissionState }) => void>;
  smokeResult: Array<
    (
      r:
        | { status: "ok"; spokenPhrase: string }
        | { status: "timed-out" }
        | { status: "error" },
    ) => void
  >;
}

function installFakeBridge(): {
  sends: RecordedSend[];
  subs: SubscriberRegistry;
} {
  const sends: RecordedSend[] = [];
  const subs: SubscriberRegistry = {
    apiKeyResult: [],
    micPermissionResult: [],
    smokeResult: [],
  };
  const bridge = {
    mode: "init" as "init" | "launch",
    // The InitWizard only consumes the seven init-wizard bridge methods.
    // The rest of the AchillesPreloadApi surface is stubbed as no-ops so
    // any accidental call surfaces immediately (no silent fall-through).
    sendInitWizardApiKeySubmit(key: string): void {
      sends.push({ channel: "init-api-key-submit", payload: { key } });
    },
    onInitWizardApiKeyResult(
      cb: (
        r:
          | { accepted: true }
          | { accepted: true; warning: "unexpected-prefix" }
          | { accepted: false; reason: "too-short" },
      ) => void,
    ): () => void {
      subs.apiKeyResult.push(cb);
      return () => {
        const i = subs.apiKeyResult.indexOf(cb);
        if (i >= 0) subs.apiKeyResult.splice(i, 1);
      };
    },
    sendInitWizardMicPermissionRequest(): void {
      sends.push({ channel: "init-mic-permission-request" });
    },
    onInitWizardMicPermissionResult(
      cb: (r: { status: PermissionState }) => void,
    ): () => void {
      subs.micPermissionResult.push(cb);
      return () => {
        const i = subs.micPermissionResult.indexOf(cb);
        if (i >= 0) subs.micPermissionResult.splice(i, 1);
      };
    },
    sendInitWizardSmokeStart(): void {
      sends.push({ channel: "init-smoke-start" });
    },
    onInitWizardSmokeResult(
      cb: (
        r:
          | { status: "ok"; spokenPhrase: string }
          | { status: "timed-out" }
          | { status: "error" },
      ) => void,
    ): () => void {
      subs.smokeResult.push(cb);
      return () => {
        const i = subs.smokeResult.indexOf(cb);
        if (i >= 0) subs.smokeResult.splice(i, 1);
      };
    },
    sendInitWizardDone(): void {
      sends.push({ channel: "init-wizard-done" });
    },
    openSystemSettings(): void {
      sends.push({ channel: "open-system-settings" });
    },
  };
  (window as unknown as { achilles?: unknown }).achilles = bridge;
  return { sends, subs };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { achilles?: unknown }).achilles;
});

// ─────────────────────────────────────────────────────────────────────
// U1
// ─────────────────────────────────────────────────────────────────────

describe("U1: InitWizard initial render is Step 1 (API key entry)", () => {
  it("renders a masked input + Next button that is disabled until >= 32 chars typed", () => {
    installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("password");
    const next = screen.getByTestId("init-wizard-next") as HTMLButtonElement;
    expect(next).toBeTruthy();
    expect(next.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x".repeat(10) } });
    expect(next.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x".repeat(32) } });
    expect(next.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// U2
// ─────────────────────────────────────────────────────────────────────

describe("U2: clicking Next fires bridge.sendInitWizardApiKeySubmit with the typed value verbatim", () => {
  it("the recorded payload contains the typed value exactly", () => {
    const { sends } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    const typed = `sk_${"y".repeat(31)}`; // 34 chars total
    fireEvent.change(input, { target: { value: typed } });
    const next = screen.getByTestId("init-wizard-next") as HTMLButtonElement;
    fireEvent.click(next);
    const submits = sends.filter((s) => s.channel === "init-api-key-submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]?.payload).toEqual({ key: typed });
  });
});

// ─────────────────────────────────────────────────────────────────────
// U3
// ─────────────────────────────────────────────────────────────────────

describe("U3: on accepted:false reason:'too-short' the locked error copy renders inline", () => {
  it("the rendered tree includes the locked error copy", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: false, reason: "too-short" });
    });
    const error = screen.getByTestId("init-wizard-api-key-error");
    expect(error.textContent).toBe(
      "Key is too short — ElevenLabs keys are at least 32 characters.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// U4
// ─────────────────────────────────────────────────────────────────────

describe("U4: on accepted:true the component advances to Step 2", () => {
  it("Step 2 renders the mic permission heading and Request button", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    expect(screen.getByText("Microphone permission")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-request-mic")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// U5
// ─────────────────────────────────────────────────────────────────────

describe("U5: on accepted:true warning:'unexpected-prefix' a warning banner renders + Step 2 advances", () => {
  it("the warning copy renders and Step 2 is visible", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "y".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult)
        cb({ accepted: true, warning: "unexpected-prefix" });
    });
    const warn = screen.getByTestId("init-wizard-api-key-warning");
    expect(warn.textContent).toBe(
      "This does not look like a typical ElevenLabs key but we have stored it anyway.",
    );
    // Step 2 is now visible.
    expect(screen.getByText("Microphone permission")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// U6
// ─────────────────────────────────────────────────────────────────────

describe("U6: Step 2 — clicking Request fires bridge.sendInitWizardMicPermissionRequest; on granted, advance to Step 3", () => {
  it("recorded bridge send + advances on granted", () => {
    const { sends, subs } = installFakeBridge();
    render(<InitWizard />);
    // Advance to Step 2.
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    // Click Request mic.
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    const requestSends = sends.filter(
      (s) => s.channel === "init-mic-permission-request",
    );
    expect(requestSends).toHaveLength(1);
    // Granted advances to Step 3.
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "granted" });
    });
    expect(screen.getByText("Smoke test")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-start-smoke")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// U7
// ─────────────────────────────────────────────────────────────────────

describe("U7: Step 2 — on denied the locked remediation copy renders + Open System Settings, Retry, Skip buttons", () => {
  it("denied keeps user on Step 2 with locked copy and the three buttons", () => {
    const { subs, sends } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "denied" });
    });
    const remediation = screen.getByTestId("init-wizard-mic-denied-copy");
    expect(remediation.textContent).toBe(
      "Open System Settings and grant access to Achilles. Then click Retry.",
    );
    const openSettings = screen.getByTestId("init-wizard-open-settings");
    expect(openSettings).toBeTruthy();
    fireEvent.click(openSettings);
    expect(
      sends.filter((s) => s.channel === "open-system-settings"),
    ).toHaveLength(1);
    expect(screen.getByTestId("init-wizard-retry-mic")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-skip-mic")).toBeTruthy();
  });

  it("clicking Skip mic test advances to Step 3 without re-requesting permission", () => {
    const { subs, sends } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "denied" });
    });
    fireEvent.click(screen.getByTestId("init-wizard-skip-mic"));
    expect(screen.getByText("Smoke test")).toBeTruthy();
    // Skip does NOT re-fire the request.
    const requestSends = sends.filter(
      (s) => s.channel === "init-mic-permission-request",
    );
    expect(requestSends).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// U7b: CR-02 fix — Skip + Open Settings affordances render for
//      'not-determined' and 'restricted' too, not just 'denied'.
// ─────────────────────────────────────────────────────────────────────

describe("U7b: CR-02 — not-determined and restricted surface Skip + Open Settings (not just denied)", () => {
  it("on 'not-determined' the Skip + Open Settings + Retry buttons render and the Request button does NOT stall on 'requesting'", () => {
    const { sends, subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    // OS reports not-determined (the user dismissed the system prompt
    // without choosing). Before the CR-02 fix, the renderer stalled on
    // a "requesting" spinner forever.
    act(() => {
      for (const cb of subs.micPermissionResult)
        cb({ status: "not-determined" });
    });
    // The remediation surface must be reachable.
    expect(screen.getByTestId("init-wizard-mic-denied-copy")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-open-settings")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-retry-mic")).toBeTruthy();
    const skip = screen.getByTestId("init-wizard-skip-mic");
    expect(skip).toBeTruthy();
    // Skip advances to Step 3 without re-requesting permission.
    fireEvent.click(skip);
    expect(screen.getByText("Smoke test")).toBeTruthy();
    // Only the initial request was fired — Skip does NOT re-trigger it.
    expect(
      sends.filter((s) => s.channel === "init-mic-permission-request"),
    ).toHaveLength(1);
  });

  it("on 'restricted' (MDM-managed device) the Skip + Open Settings + Retry buttons render", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    // OS reports restricted (MDM policy denies mic globally).
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "restricted" });
    });
    // Treat 'restricted' as denied-equivalent — surface the same
    // remediation copy + Skip button so the user can still proceed.
    expect(screen.getByTestId("init-wizard-mic-denied-copy")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-open-settings")).toBeTruthy();
    expect(screen.getByTestId("init-wizard-skip-mic")).toBeTruthy();
  });

  it("on 'not-determined' the Retry button is enabled (not the 'requesting' disabled spinner)", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult)
        cb({ status: "not-determined" });
    });
    const retry = screen.getByTestId("init-wizard-retry-mic") as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// U8
// ─────────────────────────────────────────────────────────────────────

describe("U8: Step 3 happy path", () => {
  it("clicking Start fires bridge.sendInitWizardSmokeStart; on ok, locked phrase copy renders; Exit dispatches sendInitWizardDone", () => {
    const { sends, subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "granted" });
    });
    fireEvent.click(screen.getByTestId("init-wizard-start-smoke"));
    expect(sends.filter((s) => s.channel === "init-smoke-start")).toHaveLength(
      1,
    );
    act(() => {
      for (const cb of subs.smokeResult)
        cb({
          status: "ok",
          spokenPhrase: "Hello from Achilles, I am ready to help.",
        });
    });
    const result = screen.getByTestId("init-wizard-smoke-result");
    expect(result.textContent).toBe(
      "You should now hear: Hello from Achilles, I am ready to help.",
    );
    const exit = screen.getByTestId("init-wizard-exit");
    fireEvent.click(exit);
    expect(
      sends.filter((s) => s.channel === "init-wizard-done"),
    ).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// U9
// ─────────────────────────────────────────────────────────────────────

describe("U9: Step 3 — timeout offers Exit copy", () => {
  it("timed-out renders the locked timeout copy + Exit wizard button", () => {
    const { subs } = installFakeBridge();
    render(<InitWizard />);
    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "granted" });
    });
    fireEvent.click(screen.getByTestId("init-wizard-start-smoke"));
    act(() => {
      for (const cb of subs.smokeResult) cb({ status: "timed-out" });
    });
    const result = screen.getByTestId("init-wizard-smoke-result");
    expect(result.textContent).toBe(
      "The smoke test timed out. You can still use Achilles — try running `achilles` from your terminal.",
    );
    expect(screen.getByTestId("init-wizard-exit")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// U10
// ─────────────────────────────────────────────────────────────────────

describe("U10: no emoji codepoints in the rendered DOM at any step", () => {
  it("Steps 1, 2, 3 each render zero Extended_Pictographic codepoints", () => {
    const { subs } = installFakeBridge();
    const { container } = render(<InitWizard />);

    function assertNoEmoji(): void {
      // Match U+1F000..U+1FFFF and U+2600..U+27FF range explicitly per
      // the plan's U10 contract. Also fall through to the unicode
      // Extended_Pictographic property as defence in depth.
      const text = container.textContent ?? "";
      expect(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]/u.test(text)).toBe(
        false,
      );
      expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
    }

    assertNoEmoji();

    const input = screen.getByLabelText(/elevenlabs api key/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(40) } });
    fireEvent.click(screen.getByTestId("init-wizard-next"));
    act(() => {
      for (const cb of subs.apiKeyResult) cb({ accepted: true });
    });
    assertNoEmoji();

    fireEvent.click(screen.getByTestId("init-wizard-request-mic"));
    act(() => {
      for (const cb of subs.micPermissionResult) cb({ status: "granted" });
    });
    assertNoEmoji();
  });
});
