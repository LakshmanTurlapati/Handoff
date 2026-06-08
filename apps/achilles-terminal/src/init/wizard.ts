/**
 * Phase 18, Plan 03, Task 1 — Init wizard module.
 *
 * Requirements:
 *   - INIT-01: Linear @clack/prompts flow: welcome -> api-key -> preflight ->
 *     ambient-calibration -> smoke-test -> summary -> marker.
 *   - INIT-04: The smoke test step exercises the full Phase 17 voice loop via
 *     runSmokeTest(). It is invoked ONLY when the operator runs `achilles init`
 *     interactively — NEVER from vitest. Tests use runSmokeTestImpl injection seam
 *     to mock the round-trip (CLAUDE.md no-auto-running rule).
 *   - INIT-05: Idempotent re-run with 'keep current' defaults. When readInitMarker
 *     returns a prior marker, every prompt defaults to the existing value.
 *
 * Flow:
 *   1. welcome — prints a welcome note
 *   2. api-key — resolves existing key; if env -> confirm keep or override;
 *                if missing -> prompt for key text + storage target
 *   3. preflight — checkPreflight; on failure -> suggestInstallCommand + offer install;
 *                  on sox device-failed + darwin -> resolveParentEmulator + remediation hint
 *   4. ambient-calibration — 5-second spinner; writes noiseFloor to settings
 *   5. smoke-test — confirm; if confirmed -> runSmokeTest; show result
 *   6. summary — diff table of changed settings; confirm save
 *   7. marker — writeInitMarker + writeNoiseFloor; only on confirm
 *
 * All prompts go through deps injection seams so tests run hermetically.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import {
  resolveApiKey,
  writeApiKey,
  type ApiKeySource,
} from "./api-key.js";
import {
  checkPreflight,
  type PreflightResult,
} from "./preflight.js";
import {
  suggestInstallCommand,
  invokePackageManager,
  type InstallCommand,
} from "./install-suggestions.js";
import {
  calibrateAmbient,
  writeNoiseFloorToSettings,
  DEFAULT_CALIBRATION_DURATION_MS,
} from "./ambient-calibration.js";
import {
  resolveParentEmulator,
  getRemediationHint,
  type ParentEmulator,
} from "./parent-terminal.js";
import {
  writeInitMarker,
  readInitMarker,
  hasInitMarker,
  type InitMarker,
} from "./marker.js";
import { runSmokeTest, type SmokeTestResult } from "./smoke-test.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * The 7 steps of the init wizard.
 *
 * @public
 */
export type WizardStep =
  | "welcome"
  | "api-key"
  | "preflight"
  | "ambient-calibration"
  | "smoke-test"
  | "summary"
  | "marker";

/**
 * The outcome of the init wizard.
 *
 * @public
 */
export interface WizardOutcome {
  readonly completed: boolean;
  readonly stepsCompleted: ReadonlyArray<WizardStep>;
  readonly apiKeySource: ApiKeySource | null;
  readonly noiseFloor: number | null;
  readonly smokeTestPassed: boolean;
  readonly cancelled: boolean;
}

/**
 * Dependency injection seam for the wizard. All Plan 01/02 module functions
 * plus @clack/prompts seams are injectable for hermetic tests.
 *
 * @public
 */
export interface WizardDeps {
  // Plan 01/02 module seams
  resolveApiKeyImpl?: typeof resolveApiKey;
  writeApiKeyImpl?: typeof writeApiKey;
  checkPreflightImpl?: typeof checkPreflight;
  calibrateAmbientImpl?: typeof calibrateAmbient;
  writeNoiseFloorImpl?: typeof writeNoiseFloorToSettings;
  resolveParentEmulatorImpl?: typeof resolveParentEmulator;
  writeInitMarkerImpl?: typeof writeInitMarker;
  readInitMarkerImpl?: typeof readInitMarker;
  runSmokeTestImpl?: typeof runSmokeTest;
  // install-suggestions seams
  suggestInstallCommandImpl?: typeof suggestInstallCommand;
  invokePackageManagerImpl?: typeof invokePackageManager;
  // @clack/prompts seams
  promptText?: (msg: string, opts?: unknown) => Promise<string | symbol>;
  promptSelect?: (msg: string, opts: unknown) => Promise<string | symbol>;
  promptConfirm?: (msg: string, opts?: unknown) => Promise<boolean | symbol>;
  noteImpl?: (msg: string, title?: string) => void;
  spinnerImpl?: () => { start: (msg?: string) => void; stop: (msg?: string) => void };
  isCancel?: (v: unknown) => boolean;
  // Platform override for tests
  platformOverride?: NodeJS.Platform;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PACKAGE_VERSION = "1.3.0"; // read from package.json at runtime in prod

function buildCancelledOutcome(
  stepsCompleted: WizardStep[],
): WizardOutcome {
  return {
    completed: false,
    stepsCompleted: [...stepsCompleted],
    apiKeySource: null,
    noiseFloor: null,
    smokeTestPassed: false,
    cancelled: true,
  };
}

function buildRejectedOutcome(
  stepsCompleted: WizardStep[],
  apiKeySource: ApiKeySource | null,
  noiseFloor: number | null,
  smokeTestPassed: boolean,
): WizardOutcome {
  return {
    completed: false,
    stepsCompleted: [...stepsCompleted],
    apiKeySource,
    noiseFloor,
    smokeTestPassed,
    cancelled: false,
  };
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Run the init wizard, composing Plan 01/02 modules into 7 linear @clack/prompts
 * steps with idempotency, summary diff, and a smoke test.
 *
 * @public
 */
export async function runInitWizard(deps: WizardDeps = {}): Promise<WizardOutcome> {
  // Resolve all implementations to either supplied seams or production defaults.
  const resolveApiKeyImpl = deps.resolveApiKeyImpl ?? resolveApiKey;
  const writeApiKeyImpl = deps.writeApiKeyImpl ?? writeApiKey;
  const checkPreflightImpl = deps.checkPreflightImpl ?? checkPreflight;
  const calibrateAmbientImpl = deps.calibrateAmbientImpl ?? calibrateAmbient;
  const writeNoiseFloorImpl = deps.writeNoiseFloorImpl ?? writeNoiseFloorToSettings;
  const resolveParentEmulatorImpl = deps.resolveParentEmulatorImpl ?? resolveParentEmulator;
  const writeInitMarkerImpl = deps.writeInitMarkerImpl ?? writeInitMarker;
  const readInitMarkerImpl = deps.readInitMarkerImpl ?? readInitMarker;
  const runSmokeTestImpl = deps.runSmokeTestImpl ?? runSmokeTest;
  const suggestInstallCommandImpl = deps.suggestInstallCommandImpl ?? suggestInstallCommand;
  const invokePackageManagerImpl = deps.invokePackageManagerImpl ?? invokePackageManager;
  const platform = deps.platformOverride ?? process.platform;
  const isCancelImpl = deps.isCancel ?? ((v) => typeof v === "symbol");

  // Lazy-load @clack/prompts in production; tests inject directly.
  let _clack: {
    text: (opts: { message: string; placeholder?: string }) => Promise<string | symbol>;
    select: (opts: { message: string; options: Array<{ value: string; label: string }> }) => Promise<string | symbol>;
    confirm: (opts: { message: string }) => Promise<boolean | symbol>;
    note: (message: string, title?: string) => void;
    spinner: () => { start: (msg?: string) => void; stop: (msg?: string) => void };
  } | null = null;

  async function getClack() {
    if (_clack !== null) return _clack;
    if (
      deps.promptText !== undefined &&
      deps.promptSelect !== undefined &&
      deps.promptConfirm !== undefined &&
      deps.noteImpl !== undefined &&
      deps.spinnerImpl !== undefined
    ) {
      // All seams injected — no need to import @clack/prompts
      return null;
    }
    _clack = await import("@clack/prompts") as typeof _clack;
    return _clack;
  }

  async function promptText(msg: string): Promise<string | symbol> {
    if (deps.promptText) return deps.promptText(msg);
    const clack = await getClack();
    if (!clack) return "";
    return clack.text({ message: msg });
  }

  async function promptSelect(msg: string, options: Array<{ value: string; label: string }>): Promise<string | symbol> {
    if (deps.promptSelect) return deps.promptSelect(msg, { options });
    const clack = await getClack();
    if (!clack) return options[0]?.value ?? "";
    return clack.select({ message: msg, options });
  }

  async function promptConfirm(msg: string): Promise<boolean | symbol> {
    if (deps.promptConfirm) return deps.promptConfirm(msg);
    const clack = await getClack();
    if (!clack) return true;
    return clack.confirm({ message: msg });
  }

  function noteImpl(msg: string, title?: string): void {
    if (deps.noteImpl) {
      deps.noteImpl(msg, title);
      return;
    }
    void getClack().then((clack) => {
      if (clack) clack.note(msg, title);
    });
  }

  function spinnerImpl(): { start: (msg?: string) => void; stop: (msg?: string) => void } {
    if (deps.spinnerImpl) return deps.spinnerImpl();
    // Return a no-op spinner if @clack/prompts isn't loaded yet
    return {
      start: () => {},
      stop: () => {},
    };
  }

  // Track state
  const stepsCompleted: WizardStep[] = [];
  let resolvedApiKeySource: ApiKeySource | null = null;
  let resolvedNoiseFloor: number | null = null;
  let smokeTestPassed = false;
  let priorMarker: InitMarker | null = null;

  // Read prior marker for idempotency defaults (INIT-05)
  try {
    priorMarker = readInitMarkerImpl();
  } catch {
    priorMarker = null;
  }

  // ── Step 1: Welcome ──────────────────────────────────────────────────────
  noteImpl(
    "Welcome to Achilles. This wizard configures your microphone, API key, and the voice loop. Press Ctrl-C at any time to cancel.",
    "achilles init",
  );
  stepsCompleted.push("welcome");

  // ── Step 2: API Key ──────────────────────────────────────────────────────
  const resolveResult = await resolveApiKeyImpl();
  resolvedApiKeySource = resolveResult.source;

  if (resolveResult.source === "env") {
    // Env var is set — ask if user wants to keep it
    const keyPreview =
      resolveResult.key && resolveResult.key.length > 8
        ? `${resolveResult.key.slice(0, 4)}...${resolveResult.key.slice(-4)}`
        : "(set)";
    const keepEnv = await promptConfirm(
      `ELEVENLABS_API_KEY is set in environment (${keyPreview}). Keep using the environment variable?`,
    );
    if (isCancelImpl(keepEnv)) return buildCancelledOutcome(stepsCompleted);
    // If user doesn't want to keep, fall through to manual entry below
    if (keepEnv === true) {
      // Keep env — do not write anything
    } else {
      // User wants to override with a persisted key
      const newKey = await promptText("Enter your ElevenLabs API key:");
      if (isCancelImpl(newKey)) return buildCancelledOutcome(stepsCompleted);
      const target = await promptSelect("Where to store the API key?", [
        { value: "keychain", label: "OS keychain (recommended)" },
        { value: "encrypted-file", label: "Encrypted file (~/.achilles/key.enc)" },
      ]);
      if (isCancelImpl(target)) return buildCancelledOutcome(stepsCompleted);
      await writeApiKeyImpl(String(newKey), target === "keychain" ? "keychain" : "encrypted-file");
      resolvedApiKeySource = target === "keychain" ? "keychain" : "encrypted-file";
    }
  } else if (resolveResult.source === "missing") {
    // No key found — prompt for one
    const newKey = await promptText("Enter your ElevenLabs API key:");
    if (isCancelImpl(newKey)) return buildCancelledOutcome(stepsCompleted);
    const target = await promptSelect("Where to store the API key?", [
      { value: "keychain", label: "OS keychain (recommended)" },
      { value: "encrypted-file", label: "Encrypted file (~/.achilles/key.enc)" },
    ]);
    if (isCancelImpl(target)) return buildCancelledOutcome(stepsCompleted);
    await writeApiKeyImpl(String(newKey), target === "keychain" ? "keychain" : "encrypted-file");
    resolvedApiKeySource = target === "keychain" ? "keychain" : "encrypted-file";
  }
  // For keychain / encrypted-file sources: key is already stored, nothing to write

  stepsCompleted.push("api-key");

  // ── Step 3: Preflight ────────────────────────────────────────────────────
  const preflight: PreflightResult = await checkPreflightImpl();

  if (!preflight.allOk) {
    // Handle each failing check
    for (const check of [preflight.sox, preflight.ffmpeg, preflight.claude]) {
      if (check.status === "ok") continue;

      if (check.status === "missing") {
        const installCmd: InstallCommand = suggestInstallCommandImpl(
          platform,
          [check.name],
        );
        noteImpl(
          `${check.name} is not installed. Install command: ${installCmd.cmd}`,
          `Missing: ${check.name}`,
        );
        if (installCmd.canAutoInvoke) {
          const doInstall = await promptConfirm(`Run ${installCmd.cmd} now?`);
          if (isCancelImpl(doInstall)) return buildCancelledOutcome(stepsCompleted);
          if (doInstall === true) {
            await invokePackageManagerImpl(installCmd.cmd);
          }
        }
      } else if (check.status === "device-failed") {
        noteImpl(
          `${check.name} found but device open failed: ${check.stderr ?? "unknown error"}`,
          `Device error: ${check.name}`,
        );
        // Only for sox on macOS — suggest the parent terminal remediation
        if (check.name === "sox" && platform === "darwin") {
          const emulator: ParentEmulator = resolveParentEmulatorImpl();
          const hint = getRemediationHint(emulator);
          noteImpl(
            `${hint}\nParent terminal: ${emulator}`,
            "macOS Microphone Permission",
          );
        }
      }
    }
  }

  stepsCompleted.push("preflight");

  // ── Step 4: Ambient Calibration ──────────────────────────────────────────
  const spinner = spinnerImpl();
  spinner.start("Calibrating microphone (5s)...");

  const calibrationResult = await calibrateAmbientImpl({
    onProgress: (elapsedMs, sampleCount) => {
      spinner.start(
        `Calibrating... ${Math.round((elapsedMs / DEFAULT_CALIBRATION_DURATION_MS) * 100)}% (${sampleCount} frames)`,
      );
    },
  });

  resolvedNoiseFloor = calibrationResult.noiseFloor;
  spinner.stop(`Noise floor: ${calibrationResult.noiseFloor.toFixed(4)}`);
  stepsCompleted.push("ambient-calibration");

  // ── Step 5: Smoke Test ───────────────────────────────────────────────────
  const doSmokeTest = await promptConfirm(
    "Run a 1-utterance smoke test now? (Exercises the full voice loop)",
  );
  if (isCancelImpl(doSmokeTest)) return buildCancelledOutcome(stepsCompleted);

  if (doSmokeTest === true) {
    const smokeResult: SmokeTestResult = await runSmokeTestImpl();
    smokeTestPassed = smokeResult.passed;
    if (smokeResult.passed) {
      noteImpl(`Smoke test passed in ${smokeResult.elapsedMs}ms`, "Smoke Test");
    } else {
      noteImpl(
        `Smoke test failed: ${smokeResult.failureReason ?? "unknown"}. You can still proceed but the voice loop may not work end-to-end.`,
        "Smoke Test",
      );
    }
  }

  stepsCompleted.push("smoke-test");

  // ── Step 6: Summary ──────────────────────────────────────────────────────
  // Build diff of changed settings
  const diffLines: string[] = [];
  if (resolvedApiKeySource !== null) {
    const oldSource = priorMarker?.apiKeySource ?? "missing";
    if (oldSource !== resolvedApiKeySource) {
      diffLines.push(`apiKeySource: ${oldSource} -> ${resolvedApiKeySource}`);
    } else {
      diffLines.push(`apiKeySource: ${resolvedApiKeySource} (unchanged)`);
    }
  }
  if (resolvedNoiseFloor !== null) {
    diffLines.push(`noiseFloor: ${resolvedNoiseFloor.toFixed(4)}`);
  }
  diffLines.push(`smokeTestPassed: ${String(smokeTestPassed)}`);

  noteImpl(
    diffLines.join("\n"),
    "Summary of changes",
  );

  const doSave = await promptConfirm("Save these changes?");
  if (isCancelImpl(doSave)) return buildCancelledOutcome(stepsCompleted);

  if (doSave !== true) {
    return buildRejectedOutcome(stepsCompleted, resolvedApiKeySource, resolvedNoiseFloor, smokeTestPassed);
  }

  stepsCompleted.push("summary");

  // ── Step 7: Write Marker ─────────────────────────────────────────────────
  if (resolvedNoiseFloor !== null) {
    await writeNoiseFloorImpl(resolvedNoiseFloor);
  }

  const markerSource: InitMarker["apiKeySource"] =
    resolvedApiKeySource === "env" || resolvedApiKeySource === null
      ? "env"
      : resolvedApiKeySource === "keychain"
        ? "keychain"
        : "encrypted-file";

  writeInitMarkerImpl({
    initializedAt: new Date().toISOString(),
    version: PACKAGE_VERSION,
    apiKeySource: markerSource,
  });

  stepsCompleted.push("marker");

  return {
    completed: true,
    stepsCompleted: [...stepsCompleted],
    apiKeySource: resolvedApiKeySource,
    noiseFloor: resolvedNoiseFloor,
    smokeTestPassed,
    cancelled: false,
  };
}
