/**
 * Achilles macOS mic permission helper (UI-07).
 *
 * The Electron host owns the entire permission flow:
 *
 *   - `probePermission` reads `systemPreferences.getMediaAccessStatus('microphone')`
 *     on darwin; returns 'granted' on win32/linux (Phase 11 verifies
 *     macOS only — Phase 14 owns the Win/Linux paths).
 *
 *   - On 'not-determined' AND `triggerAskForMediaAccess=true`, the
 *     helper calls `systemPreferences.askForMediaAccess('microphone')`
 *     and maps the boolean result to 'granted' / 'denied'. The default
 *     is to NOT trigger the ask at boot — per CONTEXT.md the prompt is
 *     deferred until the user's first hotkey press, at which point
 *     main passes `triggerAskForMediaAccess=true`.
 *
 *   - `openSystemSettings` maps the current platform to the LOCKED
 *     deep-link URL:
 *       darwin → 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
 *       win32  → 'ms-settings:privacy-microphone'
 *       linux  → fallback `dialog.showMessageBox` with informational copy
 *     The URLs are module-level constants — the renderer never passes
 *     a URL through IPC, so a compromised renderer cannot trick main
 *     into opening an arbitrary external resource (T-11-13 mitigation).
 *
 *   - `schedulePermissionPoll` installs a 2000ms-tick poller (UI-SPEC §6
 *     re-poll cadence) that emits the latest probed state through the
 *     supplied callback; returns a teardown function so the caller can
 *     stop the poller when the overlay dismisses.
 *
 * The helper is fully defensive: probePermission never throws. On any
 * unexpected error (systemPreferences undefined, native bridge crash)
 * it returns 'granted' as the safest default — that path is logged via
 * the `[achilles]` prefix so the issue is visible in dev.
 */
import type { PermissionState } from "../shared/constants.js";

/**
 * UI-SPEC §6 locked deep-link URLs. Module-level constants so the IPC
 * boundary never carries a URL string — the renderer only emits the
 * `IPC_OPEN_SYSTEM_SETTINGS` envelope, and main looks up the matching
 * URL here.
 *
 * permission.test.ts asserts the literal strings stay exact; a
 * grep for these constants verifies the deep-link strings are
 * committed to source.
 */
export const DARWIN_SYSTEM_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

export const WIN32_SYSTEM_SETTINGS_URL = "ms-settings:privacy-microphone";

export const LINUX_PERMISSION_DIALOG_COPY =
  "Achilles needs microphone access. Open your distribution's audio settings (PulseAudio / PipeWire) and grant Achilles access.";

/**
 * Minimal contract for the Electron `systemPreferences` API. The unit
 * suite injects a fake — production wires `electron.systemPreferences`.
 */
export interface SystemPreferencesRef {
  getMediaAccessStatus(media: "microphone"): PermissionState;
  askForMediaAccess(media: "microphone"): Promise<boolean>;
}

/**
 * Minimal contract for the Electron `shell` API.
 */
export interface ShellRef {
  openExternal(url: string): Promise<void>;
}

/**
 * Minimal contract for the Electron `dialog` API used by the linux
 * fallback.
 */
export interface DialogRef {
  showMessageBox(opts: {
    type?: "none" | "info" | "warning" | "error";
    title?: string;
    message?: string;
    detail?: string;
  }): Promise<void>;
}

export interface ProbePermissionOptions {
  systemPreferencesRef?: SystemPreferencesRef;
  platform?: NodeJS.Platform;
  /**
   * When true AND the probed status is 'not-determined' on darwin,
   * the helper calls `askForMediaAccess('microphone')` and maps the
   * boolean result to 'granted' / 'denied'. Default: false (the boot
   * probe is silent; the ask is deferred to first hotkey press per
   * CONTEXT.md).
   */
  triggerAskForMediaAccess?: boolean;
  logger?: (msg: string) => void;
}

/**
 * Probes the current macOS mic permission state. Never throws.
 *
 * Behaviour:
 *   - darwin + systemPreferencesRef supplied → returns the probed state
 *   - darwin + 'not-determined' + triggerAskForMediaAccess → calls
 *     askForMediaAccess and maps true→'granted', false→'denied'
 *   - darwin without systemPreferencesRef → 'granted' (safe default,
 *     logs `[achilles]` warning naming UI-07 fallback)
 *   - win32/linux → 'granted' (Phase 11 verifies macOS only)
 *
 * The 'granted' safe-default exists so the renderer never blocks on a
 * misconfigured Electron host (defence in depth). The log line is the
 * only signal the fallback was hit.
 */
export async function probePermission(
  opts: ProbePermissionOptions = {},
): Promise<PermissionState> {
  const platform = opts.platform ?? process.platform;
  const logger =
    opts.logger ??
    ((msg: string) => {
      // eslint-disable-next-line no-console
      console.warn(msg);
    });

  if (platform !== "darwin") {
    // Phase 11 verifies macOS only; win32/linux ship in Phase 14.
    // Returning 'granted' here matches the renderer's expectation that
    // mic access is available; a real probe will land in the
    // platform-specific Phase 14 work.
    return "granted";
  }

  const sp = opts.systemPreferencesRef;
  if (sp === undefined) {
    logger(
      "[achilles] probePermission: systemPreferencesRef undefined; UI-07 fallback returning 'granted'",
    );
    return "granted";
  }

  let status: PermissionState;
  try {
    status = sp.getMediaAccessStatus("microphone");
  } catch (err) {
    logger(
      `[achilles] probePermission: getMediaAccessStatus threw; UI-07 fallback returning 'granted' (${
        (err as Error).message
      })`,
    );
    return "granted";
  }

  if (status === "not-determined" && opts.triggerAskForMediaAccess === true) {
    try {
      const granted = await sp.askForMediaAccess("microphone");
      return granted ? "granted" : "denied";
    } catch (err) {
      logger(
        `[achilles] probePermission: askForMediaAccess threw; UI-07 fallback returning 'granted' (${
          (err as Error).message
        })`,
      );
      return "granted";
    }
  }

  return status;
}

export interface OpenSystemSettingsOptions {
  shellRef?: ShellRef;
  dialogRef?: DialogRef;
  platform?: NodeJS.Platform;
  logger?: (msg: string) => void;
}

/**
 * Opens the System Settings panel pointing at the microphone privacy
 * preference. The renderer never reaches `shell.openExternal` directly —
 * it only emits IPC_OPEN_SYSTEM_SETTINGS, and main calls into here.
 *
 * The platform-specific URLs are module-level constants (see top of
 * file); a compromised renderer cannot trick main into opening an
 * arbitrary URL — there is no URL channel between them. (T-11-13
 * mitigation.)
 */
export async function openSystemSettings(
  opts: OpenSystemSettingsOptions = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform;
  const logger =
    opts.logger ??
    ((msg: string) => {
      // eslint-disable-next-line no-console
      console.warn(msg);
    });

  if (platform === "darwin") {
    if (opts.shellRef === undefined) {
      logger("[achilles] openSystemSettings: shellRef undefined; skipping (UI-07)");
      return;
    }
    await opts.shellRef.openExternal(DARWIN_SYSTEM_SETTINGS_URL);
    return;
  }

  if (platform === "win32") {
    if (opts.shellRef === undefined) {
      logger("[achilles] openSystemSettings: shellRef undefined; skipping (UI-07)");
      return;
    }
    await opts.shellRef.openExternal(WIN32_SYSTEM_SETTINGS_URL);
    return;
  }

  // linux fallback — distros have widely different audio stacks
  // (PulseAudio, PipeWire, ALSA-only). Surface an informational dialog
  // instead of guessing.
  if (opts.dialogRef === undefined) {
    logger(
      "[achilles] openSystemSettings: dialogRef undefined on linux; skipping fallback (UI-07)",
    );
    return;
  }
  await opts.dialogRef.showMessageBox({
    type: "info",
    title: "Microphone permission",
    message: "Microphone access required",
    detail: LINUX_PERMISSION_DIALOG_COPY,
  });
}

export interface SchedulePermissionPollOptions {
  /**
   * Poll interval in milliseconds. UI-SPEC §6 calls for 2000ms while
   * the PermissionOverlay is visible.
   */
  intervalMs?: number;
  /**
   * Probe function override. Defaults to the module's `probePermission`
   * so the call site does not need to thread the systemPreferencesRef
   * through schedulePermissionPoll. Tests pass a recording stub.
   */
  probe?: (opts?: ProbePermissionOptions) => Promise<PermissionState>;
  /**
   * Probe options forwarded to the default probe. Allows the call site
   * to wire its systemPreferencesRef once at boot.
   */
  probeOptions?: ProbePermissionOptions;
  /**
   * Timer seam for tests. Production falls through to global
   * setInterval / clearInterval.
   */
  setIntervalImpl?: (cb: () => void, ms: number) => unknown;
  clearIntervalImpl?: (token: unknown) => void;
}

/**
 * Installs a polling timer that emits the latest probed permission
 * state to the supplied callback. Returns a teardown function that
 * cancels the interval. UI-SPEC §6 documents the 2000ms cadence — the
 * overlay re-checks while visible, dismisses on 'granted'.
 */
export function schedulePermissionPoll(
  callback: (state: PermissionState) => void,
  opts: SchedulePermissionPollOptions = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 2000;
  const probe = opts.probe ?? probePermission;
  const setI =
    opts.setIntervalImpl ??
    ((cb: () => void, ms: number) =>
      setInterval(cb, ms) as unknown);
  const clearI =
    opts.clearIntervalImpl ??
    ((token: unknown) =>
      clearInterval(token as ReturnType<typeof setInterval>));

  const token = setI(async () => {
    try {
      const state = await probe(opts.probeOptions ?? {});
      callback(state);
    } catch {
      // probePermission swallows its own errors; this catch is
      // defence in depth in case a custom probe throws.
    }
  }, intervalMs);

  return () => {
    clearI(token);
  };
}
