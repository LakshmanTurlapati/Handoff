/**
 * InitWizard — DIST-04 first-run setup component.
 *
 * A three-step state machine rendered as a single `<div role="dialog">`
 * inside the InitWizard child BrowserWindow (360x480, no parent — the
 * floating shell does not exist in init mode). Driven by the seven
 * init-wizard bridge methods exposed by `apps/achilles/src/preload/index.ts`
 * (mode === "init" only).
 *
 * State machine (discriminated union, driven by useReducer):
 *
 *   - 'api-key'        — Step 1: masked input + Next button
 *   - 'api-key-error'  — Step 1 with the locked too-short error copy
 *   - 'mic-permission' — Step 2: Request mic button
 *   - 'mic-denied'     — Step 2 with the locked deep-link copy + Retry +
 *                        Open System Settings + Skip
 *   - 'smoke-test'     — Step 3: Start smoke test button
 *   - 'smoke-ok'       — Step 3 with the locked spoken-phrase copy
 *   - 'smoke-timed-out' — Step 3 with the locked timeout copy
 *   - 'smoke-error'    — Step 3 with the locked error copy
 *
 * Subscriptions: on mount the component wires three IPC subscriptions
 * (api-key-result, mic-permission-result, smoke-result) via window.achilles.
 * Each subscription is unmounted via the returned unsubscribe closure
 * to avoid listener leaks.
 *
 * NO emoji. NO unicode bullets (use literal `-` per UI-SPEC conventions).
 * All copy is inline string literals — no separate i18n surface in v1.2.
 */
import {
  useEffect,
  useReducer,
  useState,
  type ReactElement,
} from "react";

import { MIN_ELEVENLABS_KEY_LENGTH } from "../../shared/constants.js";
import type { PermissionState } from "../../shared/constants.js";

// ─────────────────────────────────────────────────────────────────────
// Locked copy strings (mirrored by the U3/U5/U7/U8/U9 tests verbatim).
// ─────────────────────────────────────────────────────────────────────

const HEADING_API_KEY = "Step 1: ElevenLabs API key";
const HEADING_MIC = "Microphone permission";
const HEADING_SMOKE = "Smoke test";

const LABEL_API_KEY = "ElevenLabs API key";
const PLACEHOLDER_API_KEY = "Paste your ElevenLabs API key (starts with sk_)";

const ERROR_KEY_TOO_SHORT =
  "Key is too short — ElevenLabs keys are at least 32 characters.";

const WARNING_KEY_PREFIX =
  "This does not look like a typical ElevenLabs key but we have stored it anyway.";

const BODY_MIC_INTRO =
  "Achilles needs to record your voice to send it to ElevenLabs for transcription. On macOS, this prompt is requested by the Achilles app, not by your terminal — denying here only affects Achilles.";
const BUTTON_REQUEST_MIC = "Request microphone access";

const BODY_MIC_DENIED =
  "Open System Settings and grant access to Achilles. Then click Retry.";
const BUTTON_OPEN_SETTINGS = "Open System Settings";
const BUTTON_RETRY_MIC = "Retry";
const BUTTON_SKIP_MIC = "Skip mic test";

const BODY_SMOKE_INTRO =
  'This sends a short test message through the full voice loop. You should hear: "Hello from Achilles, I am ready to help."';
const BUTTON_START_SMOKE = "Start smoke test";

const SMOKE_OK_PREFIX = "You should now hear: ";
const SMOKE_TIMED_OUT_COPY =
  "The smoke test timed out. You can still use Achilles — try running `achilles` from your terminal.";
const SMOKE_ERROR_COPY =
  "The smoke test failed. Check that your microphone is connected and that you have network access to ElevenLabs.";

const BUTTON_EXIT = "Exit wizard";
const BUTTON_RETRY_SMOKE = "Retry";
const BUTTON_NEXT = "Next";

const STEP_HEADER_LABEL_FORMAT = (n: 1 | 2 | 3): string => `Step ${n} of 3`;

// ─────────────────────────────────────────────────────────────────────
// Internal state machine
// ─────────────────────────────────────────────────────────────────────

interface ApiKeyState {
  step: "api-key";
  error: string | null;
  warning: string | null;
}
interface MicPermissionState {
  step: "mic-permission";
  warning: string | null;
  status: "idle" | "requesting" | "granted" | "denied";
}
interface SmokeTestState {
  step: "smoke-test";
  status:
    | "idle"
    | "running"
    | { kind: "ok"; spokenPhrase: string }
    | { kind: "timed-out" }
    | { kind: "error" };
}

type State = ApiKeyState | MicPermissionState | SmokeTestState;

type Action =
  | { type: "API_KEY_ERROR"; reason: "too-short" }
  | { type: "API_KEY_ACCEPTED"; warning: "unexpected-prefix" | null }
  | { type: "MIC_REQUESTED" }
  | { type: "MIC_GRANTED" }
  | { type: "MIC_DENIED" }
  | { type: "MIC_SKIP" }
  | { type: "SMOKE_STARTED" }
  | { type: "SMOKE_OK"; spokenPhrase: string }
  | { type: "SMOKE_TIMED_OUT" }
  | { type: "SMOKE_ERROR" }
  | { type: "RETRY_SMOKE" };

const INITIAL_STATE: State = {
  step: "api-key",
  error: null,
  warning: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "API_KEY_ERROR":
      if (state.step !== "api-key") return state;
      return { step: "api-key", error: ERROR_KEY_TOO_SHORT, warning: null };
    case "API_KEY_ACCEPTED":
      return {
        step: "mic-permission",
        warning: action.warning === "unexpected-prefix" ? WARNING_KEY_PREFIX : null,
        status: "idle",
      };
    case "MIC_REQUESTED":
      if (state.step !== "mic-permission") return state;
      return { ...state, status: "requesting" };
    case "MIC_GRANTED":
      if (state.step !== "mic-permission") return state;
      return { step: "smoke-test", status: "idle" };
    case "MIC_DENIED":
      if (state.step !== "mic-permission") return state;
      return { ...state, status: "denied" };
    case "MIC_SKIP":
      if (state.step !== "mic-permission") return state;
      return { step: "smoke-test", status: "idle" };
    case "SMOKE_STARTED":
      if (state.step !== "smoke-test") return state;
      return { ...state, status: "running" };
    case "SMOKE_OK":
      if (state.step !== "smoke-test") return state;
      return { ...state, status: { kind: "ok", spokenPhrase: action.spokenPhrase } };
    case "SMOKE_TIMED_OUT":
      if (state.step !== "smoke-test") return state;
      return { ...state, status: { kind: "timed-out" } };
    case "SMOKE_ERROR":
      if (state.step !== "smoke-test") return state;
      return { ...state, status: { kind: "error" } };
    case "RETRY_SMOKE":
      if (state.step !== "smoke-test") return state;
      return { ...state, status: "idle" };
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Bridge surface — narrow shape of window.achilles the wizard consumes.
// ─────────────────────────────────────────────────────────────────────

interface InitWizardBridge {
  sendInitWizardApiKeySubmit(key: string): void;
  onInitWizardApiKeyResult(
    cb: (
      r:
        | { accepted: true }
        | { accepted: true; warning: "unexpected-prefix" }
        | { accepted: false; reason: "too-short" },
    ) => void,
  ): () => void;
  sendInitWizardMicPermissionRequest(): void;
  onInitWizardMicPermissionResult(
    cb: (r: { status: PermissionState }) => void,
  ): () => void;
  sendInitWizardSmokeStart(): void;
  onInitWizardSmokeResult(
    cb: (
      r:
        | { status: "ok"; spokenPhrase: string }
        | { status: "timed-out" }
        | { status: "error" },
    ) => void,
  ): () => void;
  sendInitWizardDone(): void;
  openSystemSettings(): void;
}

function getInitWizardBridge(): InitWizardBridge {
  const bridge = (window as unknown as { achilles?: InitWizardBridge })
    .achilles;
  if (bridge === undefined) {
    throw new Error(
      "[achilles-init-wizard] window.achilles is not defined; preload did not run",
    );
  }
  return bridge;
}

// ─────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────

export function InitWizard(): ReactElement {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  // The API key value is held in local state so the masked input
  // behaves predictably across re-renders.
  const [keyValue, setKeyValue] = useState<string>("");

  // Wire IPC subscriptions on mount.
  useEffect(() => {
    const bridge = getInitWizardBridge();
    const unsubscribeApiKey = bridge.onInitWizardApiKeyResult((result) => {
      if (result.accepted === false) {
        dispatch({ type: "API_KEY_ERROR", reason: result.reason });
        return;
      }
      const warning =
        "warning" in result && result.warning === "unexpected-prefix"
          ? "unexpected-prefix"
          : null;
      dispatch({ type: "API_KEY_ACCEPTED", warning });
    });
    const unsubscribeMic = bridge.onInitWizardMicPermissionResult((result) => {
      if (result.status === "granted") {
        dispatch({ type: "MIC_GRANTED" });
      } else if (result.status === "denied") {
        dispatch({ type: "MIC_DENIED" });
      }
      // For 'not-determined' / 'restricted' the user can retry; the
      // reducer keeps the state on Step 2 with status "requesting".
    });
    const unsubscribeSmoke = bridge.onInitWizardSmokeResult((result) => {
      if (result.status === "ok") {
        dispatch({ type: "SMOKE_OK", spokenPhrase: result.spokenPhrase });
      } else if (result.status === "timed-out") {
        dispatch({ type: "SMOKE_TIMED_OUT" });
      } else {
        dispatch({ type: "SMOKE_ERROR" });
      }
    });
    return () => {
      unsubscribeApiKey();
      unsubscribeMic();
      unsubscribeSmoke();
    };
  }, []);

  const stepNumber: 1 | 2 | 3 =
    state.step === "api-key" ? 1 : state.step === "mic-permission" ? 2 : 3;

  function handleApiKeySubmit(): void {
    const bridge = getInitWizardBridge();
    bridge.sendInitWizardApiKeySubmit(keyValue);
  }

  function handleRequestMic(): void {
    const bridge = getInitWizardBridge();
    dispatch({ type: "MIC_REQUESTED" });
    bridge.sendInitWizardMicPermissionRequest();
  }

  function handleSkipMic(): void {
    dispatch({ type: "MIC_SKIP" });
  }

  function handleOpenSettings(): void {
    const bridge = getInitWizardBridge();
    bridge.openSystemSettings();
  }

  function handleStartSmoke(): void {
    const bridge = getInitWizardBridge();
    dispatch({ type: "SMOKE_STARTED" });
    bridge.sendInitWizardSmokeStart();
  }

  function handleExitWizard(): void {
    const bridge = getInitWizardBridge();
    bridge.sendInitWizardDone();
  }

  function handleRetrySmoke(): void {
    dispatch({ type: "RETRY_SMOKE" });
  }

  return (
    <div
      role="dialog"
      aria-label="Achilles initial setup"
      data-testid="init-wizard"
      className="init-wizard"
    >
      <header className="init-wizard-header">
        <h1 className="init-wizard-title">Set up Achilles</h1>
        <p
          className="init-wizard-step-indicator"
          data-testid="init-wizard-step-indicator"
        >
          {STEP_HEADER_LABEL_FORMAT(stepNumber)}
        </p>
      </header>

      {state.step === "api-key" ? (
        <ApiKeyStep
          keyValue={keyValue}
          setKeyValue={setKeyValue}
          error={state.error}
          onSubmit={handleApiKeySubmit}
        />
      ) : null}

      {state.step === "mic-permission" ? (
        <MicPermissionStep
          warning={state.warning}
          status={state.status}
          onRequest={handleRequestMic}
          onOpenSettings={handleOpenSettings}
          onSkip={handleSkipMic}
        />
      ) : null}

      {state.step === "smoke-test" ? (
        <SmokeTestStep
          status={state.status}
          onStart={handleStartSmoke}
          onExit={handleExitWizard}
          onRetry={handleRetrySmoke}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Step components
// ─────────────────────────────────────────────────────────────────────

interface ApiKeyStepProps {
  keyValue: string;
  setKeyValue: (v: string) => void;
  error: string | null;
  onSubmit: () => void;
}

function ApiKeyStep(props: ApiKeyStepProps): ReactElement {
  const { keyValue, setKeyValue, error, onSubmit } = props;
  const disabled = keyValue.length < MIN_ELEVENLABS_KEY_LENGTH;
  return (
    <section className="init-wizard-step init-wizard-step-api-key">
      <h2 className="init-wizard-step-heading">{HEADING_API_KEY}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) onSubmit();
        }}
      >
        <label
          htmlFor="init-wizard-api-key-input"
          className="init-wizard-label"
        >
          {LABEL_API_KEY}
        </label>
        <input
          id="init-wizard-api-key-input"
          data-testid="init-wizard-api-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={PLACEHOLDER_API_KEY}
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
          className="init-wizard-input"
        />
        {error !== null ? (
          <p
            data-testid="init-wizard-api-key-error"
            className="init-wizard-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="init-wizard-actions">
          <button
            type="submit"
            data-testid="init-wizard-next"
            disabled={disabled}
            className="init-wizard-primary-button"
          >
            {BUTTON_NEXT}
          </button>
        </div>
      </form>
    </section>
  );
}

interface MicPermissionStepProps {
  warning: string | null;
  status: "idle" | "requesting" | "granted" | "denied";
  onRequest: () => void;
  onOpenSettings: () => void;
  onSkip: () => void;
}

function MicPermissionStep(props: MicPermissionStepProps): ReactElement {
  const { warning, status, onRequest, onOpenSettings, onSkip } = props;
  return (
    <section className="init-wizard-step init-wizard-step-mic">
      <h2 className="init-wizard-step-heading">{HEADING_MIC}</h2>
      {warning !== null ? (
        <p
          data-testid="init-wizard-api-key-warning"
          className="init-wizard-warning"
          role="status"
        >
          {warning}
        </p>
      ) : null}
      {status === "denied" ? (
        <>
          <p
            data-testid="init-wizard-mic-denied-copy"
            className="init-wizard-body"
          >
            {BODY_MIC_DENIED}
          </p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-open-settings"
              onClick={onOpenSettings}
              className="init-wizard-primary-button"
            >
              {BUTTON_OPEN_SETTINGS}
            </button>
            <button
              type="button"
              data-testid="init-wizard-retry-mic"
              onClick={onRequest}
              className="init-wizard-secondary-button"
            >
              {BUTTON_RETRY_MIC}
            </button>
            <button
              type="button"
              data-testid="init-wizard-skip-mic"
              onClick={onSkip}
              className="init-wizard-tertiary-button"
            >
              {BUTTON_SKIP_MIC}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="init-wizard-body">{BODY_MIC_INTRO}</p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-request-mic"
              onClick={onRequest}
              disabled={status === "requesting"}
              className="init-wizard-primary-button"
            >
              {BUTTON_REQUEST_MIC}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

interface SmokeTestStepProps {
  status:
    | "idle"
    | "running"
    | { kind: "ok"; spokenPhrase: string }
    | { kind: "timed-out" }
    | { kind: "error" };
  onStart: () => void;
  onExit: () => void;
  onRetry: () => void;
}

function SmokeTestStep(props: SmokeTestStepProps): ReactElement {
  const { status, onStart, onExit, onRetry } = props;
  const isObj = typeof status === "object";
  const isOk = isObj && status.kind === "ok";
  const isTimedOut = isObj && status.kind === "timed-out";
  const isError = isObj && status.kind === "error";
  return (
    <section className="init-wizard-step init-wizard-step-smoke">
      <h2 className="init-wizard-step-heading">{HEADING_SMOKE}</h2>
      {!isObj ? (
        <>
          <p className="init-wizard-body">{BODY_SMOKE_INTRO}</p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-start-smoke"
              onClick={onStart}
              disabled={status === "running"}
              className="init-wizard-primary-button"
            >
              {BUTTON_START_SMOKE}
            </button>
          </div>
        </>
      ) : null}
      {isOk ? (
        <>
          <p
            data-testid="init-wizard-smoke-result"
            className="init-wizard-body"
          >
            {SMOKE_OK_PREFIX}
            {(status as { kind: "ok"; spokenPhrase: string }).spokenPhrase}
          </p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-exit"
              onClick={onExit}
              className="init-wizard-primary-button"
            >
              {BUTTON_EXIT}
            </button>
          </div>
        </>
      ) : null}
      {isTimedOut ? (
        <>
          <p
            data-testid="init-wizard-smoke-result"
            className="init-wizard-body"
          >
            {SMOKE_TIMED_OUT_COPY}
          </p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-exit"
              onClick={onExit}
              className="init-wizard-primary-button"
            >
              {BUTTON_EXIT}
            </button>
          </div>
        </>
      ) : null}
      {isError ? (
        <>
          <p
            data-testid="init-wizard-smoke-result"
            className="init-wizard-body"
          >
            {SMOKE_ERROR_COPY}
          </p>
          <div className="init-wizard-actions">
            <button
              type="button"
              data-testid="init-wizard-retry-smoke"
              onClick={onRetry}
              className="init-wizard-secondary-button"
            >
              {BUTTON_RETRY_SMOKE}
            </button>
            <button
              type="button"
              data-testid="init-wizard-exit"
              onClick={onExit}
              className="init-wizard-primary-button"
            >
              {BUTTON_EXIT}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
