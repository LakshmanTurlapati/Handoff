/**
 * Achilles init wizard main-side orchestrator (DIST-04).
 *
 * Plan 13-03 ships two surfaces here:
 *
 *   1. {@link createInitWizardWindow} — factory for the modal-shape
 *      BrowserWindow that hosts the InitWizard React component. Mirrors
 *      the Plan 11-03 settings-popover-window.ts pattern but differs:
 *      no parent (the floating shell does NOT exist in init mode),
 *      360x480 dimensions, positioned at the primary display's centre.
 *
 *   2. {@link createInitWizardSession} — the pure state-machine for the
 *      three-step wizard flow:
 *
 *        - Step 1: submitApiKey  — validate length, optionally warn on
 *          missing sk_ prefix, persist via the store seam.
 *        - Step 2: requestMicPermission — route through the Plan 11-03
 *          probePermission helper with triggerAskForMediaAccess=true.
 *          The Electron HOST owns the prompt (Pitfall #3 mitigation —
 *          the launching terminal does NOT see the macOS TCC dialog).
 *        - Step 3: runSmokeTest — race createSmokeRoundTrip against the
 *          SMOKE_TEST_TIMEOUT_MS budget; broadcast the outcome.
 *
 *      The createSmokeRoundTrip seam is intentionally injected so the
 *      unit suite drives the wizard without real ElevenLabs or Claude
 *      Code calls (CLAUDE.md global: NO live network in CI). The
 *      production wiring at main/index.ts selects the seam based on
 *      `process.env.MOCK_LOOP === '1'` (Plan 12-04 mock-loop-clients vs
 *      real @achilles/voice-stt + claude-code-bridge + @achilles/voice-tts).
 *
 * SAFE-01 / T-13-13: the API key bytes are persisted via the store
 * seam (safeStorage-encrypted at rest) and the result IPC NEVER echoes
 * the bytes back to the renderer. The session does NOT carry the key
 * after writeElevenlabsApiKey returns — the bytes are immediately
 * eligible for GC.
 *
 * NO emojis (CLAUDE.md global). NO console.log. NO direct env reads
 * (the createSmokeRoundTrip selection is the only env-sensitive
 * decision and it lives at the call site, not here).
 */
import type { PermissionState } from "../shared/constants.js";
import {
  ELEVENLABS_KEY_PREFIX,
  IPC_INIT_API_KEY_RESULT,
  IPC_INIT_MIC_PERMISSION_RESULT,
  IPC_INIT_SMOKE_RESULT,
  MIN_ELEVENLABS_KEY_LENGTH,
  SMOKE_TEST_TIMEOUT_MS,
} from "../shared/constants.js";

// ─────────────────────────────────────────────────────────────────────
// Window factory
// ─────────────────────────────────────────────────────────────────────

/** Locked InitWizard window dimensions (per plan W1 contract). */
export const INIT_WIZARD_WINDOW_WIDTH = 360;
export const INIT_WIZARD_WINDOW_HEIGHT = 480;

/**
 * Minimal shape of the BrowserWindow handle the wizard window factory
 * returns to its caller. The factory does not need to expose the full
 * Electron BrowserWindow surface here — the caller (main/index.ts)
 * threads the handle through to webContents.send and isDestroyed
 * directly via narrow seams.
 */
export interface InitWizardWindow {
  setPosition(x: number, y: number, animate?: boolean): void;
  loadURL(url: string): Promise<void> | void;
  loadFile(path: string): Promise<void> | void;
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

/**
 * Options for {@link createInitWizardWindow}. Both seams are required
 * (no defaults) so tests have no global state to manage; the production
 * wiring at main/index.ts binds them to electron.BrowserWindow and
 * electron.screen.
 */
export interface CreateInitWizardWindowOptions {
  BrowserWindowCtor: new (opts: Record<string, unknown>) => InitWizardWindow;
  screenRef: {
    getPrimaryDisplay(): {
      workArea: { x: number; y: number; width: number; height: number };
    };
  };
  /** Optional initial URL — production wires the renderer entry. */
  loadUrl?: string;
}

/**
 * Constructs the InitWizard child BrowserWindow.
 *
 * Locked option contract (asserted by Plan 13-03 W1 test):
 *
 *   frame:false, transparent:true, alwaysOnTop:true, focusable:true,
 *   skipTaskbar:true, width:360, height:480, modal:false,
 *   resizable:false, webPreferences.contextIsolation:true,
 *   webPreferences.nodeIntegration:false, webPreferences.sandbox:true
 *
 * The window has NO `parent` option (W2): in init mode the floating
 * shell does not exist, so there is no parent to attach to. The window
 * is positioned at the primary display's workArea centre.
 *
 * @public
 */
export function createInitWizardWindow(
  opts: CreateInitWizardWindowOptions,
): InitWizardWindow {
  const Ctor = opts.BrowserWindowCtor;
  const window = new Ctor({
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: true,
    skipTaskbar: true,
    width: INIT_WIZARD_WINDOW_WIDTH,
    height: INIT_WIZARD_WINDOW_HEIGHT,
    modal: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    hasShadow: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Centre on the primary display's workArea. The Plan 13-03 W1 test
  // pins the formula (x = workArea.x + (workArea.width - 360) / 2,
  // y = workArea.y + (workArea.height - 480) / 2).
  const workArea = opts.screenRef.getPrimaryDisplay().workArea;
  const centerX = workArea.x + (workArea.width - INIT_WIZARD_WINDOW_WIDTH) / 2;
  const centerY = workArea.y + (workArea.height - INIT_WIZARD_WINDOW_HEIGHT) / 2;
  window.setPosition(centerX, centerY);

  if (opts.loadUrl !== undefined) {
    void window.loadURL(opts.loadUrl);
  }

  return window;
}

// ─────────────────────────────────────────────────────────────────────
// Session orchestrator
// ─────────────────────────────────────────────────────────────────────

/**
 * Outcome of {@link InitWizardSession.submitApiKey}.
 */
export type SubmitApiKeyResult =
  | { accepted: true }
  | { accepted: true; warning: "unexpected-prefix" }
  | { accepted: false; reason: "too-short" };

/**
 * Outcome of {@link InitWizardSession.runSmokeTest}.
 */
export type RunSmokeTestResult =
  | { status: "ok"; spokenPhrase: string }
  | { status: "timed-out" }
  | { status: "error" };

/**
 * Wizard session — four imperative actions driven by the renderer's IPC
 * calls (api-key-submit → submitApiKey, mic-permission-request →
 * requestMicPermission, smoke-start → runSmokeTest, wizard-done →
 * markWizardDone).
 */
export interface InitWizardSession {
  submitApiKey(key: string): Promise<SubmitApiKeyResult>;
  requestMicPermission(): Promise<PermissionState>;
  runSmokeTest(): Promise<RunSmokeTestResult>;
  markWizardDone(): void;
  dispose(): void;
}

/**
 * Dependencies for {@link createInitWizardSession}. Every external
 * surface is a seam so the test suite drives every branch without
 * touching real Electron, the keystore, the OS permission API, or the
 * ElevenLabs / Claude network paths.
 */
export interface CreateInitWizardSessionOptions {
  /**
   * Subset of AchillesStore exposing only writeElevenlabsApiKey. The
   * wider store surface is intentionally NOT required so callers can
   * pass a minimal in-test stub. Production wires the Plan 12-04
   * safeStorage-backed AchillesStore.
   */
  store: { writeElevenlabsApiKey(key: string): void };
  /**
   * IPC send seam. Bound to `window.webContents.send` in production.
   * The session NEVER reads from IPC — it only writes results back to
   * the renderer.
   */
  ipc: { send(channel: string, payload: unknown): void };
  /**
   * The Plan 11-03 probePermission helper bound to the production
   * systemPreferencesRef. The session calls this with
   * triggerAskForMediaAccess:true so the OS prompt fires INSIDE the
   * Electron host (Pitfall #3 mitigation).
   */
  probePermissionImpl: (opts: {
    triggerAskForMediaAccess: boolean;
  }) => Promise<PermissionState>;
  /**
   * Smoke round-trip factory. Production wires either the
   * MOCK_LOOP=1 deterministic fakes (Plan 12-04 mock-loop-clients)
   * or the real @achilles/voice-stt + claude-code-bridge +
   * @achilles/voice-tts composition. The factory MUST resolve to a
   * value (never rejects); error cases resolve to {status:'error'}.
   */
  createSmokeRoundTrip: () => Promise<RunSmokeTestResult>;
  /**
   * Bound to app.quit() in production. Tests pass a recording fake.
   */
  appQuitImpl: () => void;
  /**
   * Test seams for the smoke-test timeout. Production falls through
   * to globalThis.setTimeout / clearTimeout.
   *
   * WR-06 fix: the token type is intentionally `unknown` rather than
   * `ReturnType<typeof setTimeout>` because the test fakes return a
   * numeric id while production returns a `NodeJS.Timeout` object. The
   * critical contract is that whatever `setTimeoutImpl` returns is
   * passed verbatim to `clearTimeoutImpl` — neither side ever inspects
   * the token's shape, so the opaque `unknown` type captures the
   * contract precisely. The previous code combined `unknown` with an
   * unnecessary `as unknown` cast in the production fallback; the cast
   * has been removed since the return type is already `unknown` and
   * the double-cast obscured the intent.
   */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (token: unknown) => void;
  /**
   * Optional logger sink. Defaults to console.error with the
   * [achilles] prefix. The session NEVER logs the submitted API key
   * bytes (T-13-13 mitigation pinned by the K5 / SE13 patterns).
   */
  logger?: (msg: string) => void;
}

/**
 * Build the wizard session.
 *
 * @public
 */
export function createInitWizardSession(
  deps: CreateInitWizardSessionOptions,
): InitWizardSession {
  // WR-06 fix: drop the unnecessary `as unknown` cast on setTimeoutImpl
  // — the seam's declared return type is already `unknown`, so casting
  // again was redundant. The clearTimeoutImpl fallback still needs the
  // narrowing cast to `ReturnType<typeof setTimeout>` because the
  // global `clearTimeout` rejects `unknown`.
  const setT: (cb: () => void, ms: number) => unknown =
    deps.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT: (token: unknown) => void =
    deps.clearTimeoutImpl ??
    ((token) => clearTimeout(token as ReturnType<typeof setTimeout>));
  const log =
    deps.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });

  // Token for the in-flight smoke-test timeout, if any.
  let smokeTimeoutToken: unknown = null;

  async function submitApiKey(key: string): Promise<SubmitApiKeyResult> {
    if (typeof key !== "string" || key.length < MIN_ELEVENLABS_KEY_LENGTH) {
      const result: SubmitApiKeyResult = {
        accepted: false,
        reason: "too-short",
      };
      deps.ipc.send(IPC_INIT_API_KEY_RESULT, result);
      log("[achilles] init wizard: api key rejected (too-short)");
      return result;
    }
    // Persist via the store seam. The store routes through Plan 12-04's
    // safeStorage encryption (see store.ts writeElevenlabsApiKey).
    deps.store.writeElevenlabsApiKey(key);
    if (!key.startsWith(ELEVENLABS_KEY_PREFIX)) {
      const result: SubmitApiKeyResult = {
        accepted: true,
        warning: "unexpected-prefix",
      };
      deps.ipc.send(IPC_INIT_API_KEY_RESULT, result);
      log("[achilles] init wizard: api key persisted (warning: unexpected-prefix)");
      return result;
    }
    const result: SubmitApiKeyResult = { accepted: true };
    deps.ipc.send(IPC_INIT_API_KEY_RESULT, result);
    log("[achilles] init wizard: api key persisted");
    return result;
  }

  async function requestMicPermission(): Promise<PermissionState> {
    const status = await deps.probePermissionImpl({
      triggerAskForMediaAccess: true,
    });
    deps.ipc.send(IPC_INIT_MIC_PERMISSION_RESULT, { status });
    log(`[achilles] init wizard: mic permission status=${status}`);
    return status;
  }

  async function runSmokeTest(): Promise<RunSmokeTestResult> {
    return new Promise<RunSmokeTestResult>((resolve) => {
      let settled = false;
      function settle(result: RunSmokeTestResult): void {
        if (settled) return;
        settled = true;
        if (smokeTimeoutToken !== null) {
          clearT(smokeTimeoutToken);
          smokeTimeoutToken = null;
        }
        deps.ipc.send(IPC_INIT_SMOKE_RESULT, result);
        log(`[achilles] init wizard: smoke test status=${result.status}`);
        resolve(result);
      }

      smokeTimeoutToken = setT(() => {
        settle({ status: "timed-out" });
      }, SMOKE_TEST_TIMEOUT_MS);

      deps
        .createSmokeRoundTrip()
        .then((result) => {
          settle(result);
        })
        .catch(() => {
          settle({ status: "error" });
        });
    });
  }

  function markWizardDone(): void {
    log("[achilles] init wizard: done");
    deps.appQuitImpl();
  }

  function dispose(): void {
    if (smokeTimeoutToken !== null) {
      clearT(smokeTimeoutToken);
      smokeTimeoutToken = null;
    }
  }

  return {
    submitApiKey,
    requestMicPermission,
    runSmokeTest,
    markWizardDone,
    dispose,
  };
}
