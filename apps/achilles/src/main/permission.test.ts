/**
 * Behaviour tests for permission.ts — the macOS mic permission probe
 * + remediation deep-link owned by the Electron host (UI-07).
 *
 *   - PM1: darwin probePermission invokes systemPreferences.getMediaAccessStatus('microphone') once and returns the result
 *   - PM2: 'not-determined' + triggerAskForMediaAccess=true calls askForMediaAccess and maps to granted/denied
 *   - PM3: openSystemSettings on darwin invokes shell.openExternal with the LOCKED deep-link URL
 *   - PM4: openSystemSettings on win32 invokes shell.openExternal with the documented ms-settings URL
 *   - PM5: openSystemSettings on linux falls back to dialog.showMessageBox with the documented copy
 *   - PM6: schedulePermissionPoll installs a 2000ms-tick callback and returns a teardown
 *   - PM7: probePermission never throws; on unexpected systemPreferences errors returns 'granted' as safe default
 *
 * No real Electron loaded; all refs are injected fakes.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DARWIN_SYSTEM_SETTINGS_URL,
  LINUX_PERMISSION_DIALOG_COPY,
  WIN32_SYSTEM_SETTINGS_URL,
  openSystemSettings,
  probePermission,
  schedulePermissionPoll,
} from "./permission.js";

describe("probePermission — PM1 darwin reads getMediaAccessStatus once", () => {
  it("invokes systemPreferences.getMediaAccessStatus('microphone') exactly once and returns the result", async () => {
    const getStatus = vi.fn().mockReturnValue("granted");
    const ask = vi.fn();

    const status = await probePermission({
      platform: "darwin",
      systemPreferencesRef: {
        getMediaAccessStatus: getStatus,
        askForMediaAccess: ask,
      },
    });

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledWith("microphone");
    expect(status).toBe("granted");
    // The default is NOT to trigger askForMediaAccess (the CONTEXT.md
    // flow is "defer until first hotkey press").
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("probePermission — PM2 'not-determined' + trigger flag asks for access", () => {
  it("maps askForMediaAccess true → 'granted' and false → 'denied'", async () => {
    const getStatus = vi.fn().mockReturnValue("not-determined");
    const askYes = vi.fn().mockResolvedValue(true);

    const grantedStatus = await probePermission({
      platform: "darwin",
      triggerAskForMediaAccess: true,
      systemPreferencesRef: {
        getMediaAccessStatus: getStatus,
        askForMediaAccess: askYes,
      },
    });
    expect(askYes).toHaveBeenCalledTimes(1);
    expect(askYes).toHaveBeenCalledWith("microphone");
    expect(grantedStatus).toBe("granted");

    const askNo = vi.fn().mockResolvedValue(false);
    const deniedStatus = await probePermission({
      platform: "darwin",
      triggerAskForMediaAccess: true,
      systemPreferencesRef: {
        getMediaAccessStatus: vi.fn().mockReturnValue("not-determined"),
        askForMediaAccess: askNo,
      },
    });
    expect(deniedStatus).toBe("denied");
  });
});

describe("openSystemSettings — PM3 darwin deep-link URL is exact", () => {
  it("invokes shell.openExternal with the LOCKED Privacy_Microphone URL on darwin", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const dialogBox = vi.fn();
    await openSystemSettings({
      platform: "darwin",
      shellRef: { openExternal },
      dialogRef: { showMessageBox: dialogBox },
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(DARWIN_SYSTEM_SETTINGS_URL);
    expect(DARWIN_SYSTEM_SETTINGS_URL).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
    expect(dialogBox).not.toHaveBeenCalled();
  });
});

describe("openSystemSettings — PM4 win32 ms-settings URL", () => {
  it("invokes shell.openExternal with the documented ms-settings URL on win32", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const dialogBox = vi.fn();
    await openSystemSettings({
      platform: "win32",
      shellRef: { openExternal },
      dialogRef: { showMessageBox: dialogBox },
    });
    expect(openExternal).toHaveBeenCalledWith(WIN32_SYSTEM_SETTINGS_URL);
    expect(WIN32_SYSTEM_SETTINGS_URL).toBe("ms-settings:privacy-microphone");
    expect(dialogBox).not.toHaveBeenCalled();
  });
});

describe("openSystemSettings — PM5 linux fallback dialog", () => {
  it("invokes dialog.showMessageBox with the documented fallback copy on linux", async () => {
    const openExternal = vi.fn();
    const dialogBox = vi.fn().mockResolvedValue(undefined);
    await openSystemSettings({
      platform: "linux",
      shellRef: { openExternal },
      dialogRef: { showMessageBox: dialogBox },
    });
    expect(dialogBox).toHaveBeenCalledTimes(1);
    // The dialog options bundle includes the documented copy under
    // 'message' or 'detail'; we just assert the copy is present.
    const calledOpts = dialogBox.mock.calls[0]![0] as {
      message?: string;
      detail?: string;
    };
    const haystack = `${calledOpts.message ?? ""} ${calledOpts.detail ?? ""}`;
    expect(haystack).toContain(LINUX_PERMISSION_DIALOG_COPY);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("schedulePermissionPoll — PM6 installs interval and returns teardown", () => {
  it("invokes the callback at the configured intervalMs with the probed state and stops when teardown is called", async () => {
    const states: Array<string> = [];
    const probe = vi
      .fn()
      .mockResolvedValueOnce("denied")
      .mockResolvedValueOnce("denied")
      .mockResolvedValueOnce("granted");

    let intervalCb: (() => void) | null = null;
    let clearedToken: unknown = null;
    const fakeSetInterval = vi.fn((cb: () => void, _ms: number) => {
      intervalCb = cb;
      return 42 as unknown;
    });
    const fakeClearInterval = vi.fn((token: unknown) => {
      clearedToken = token;
    });

    const teardown = schedulePermissionPoll(
      (s) => states.push(s),
      {
        intervalMs: 2000,
        probe: probe as never,
        setIntervalImpl: fakeSetInterval,
        clearIntervalImpl: fakeClearInterval,
      },
    );

    expect(fakeSetInterval).toHaveBeenCalledTimes(1);
    expect(fakeSetInterval.mock.calls[0]![1]).toBe(2000);
    expect(intervalCb).not.toBeNull();

    // Drive 3 ticks; await microtasks so the promise resolutions land.
    await intervalCb!();
    await intervalCb!();
    await intervalCb!();
    expect(states).toEqual(["denied", "denied", "granted"]);

    teardown();
    expect(fakeClearInterval).toHaveBeenCalledTimes(1);
    expect(clearedToken).toBe(42);
  });
});

describe("probePermission — PM7 defensive fallback never throws", () => {
  it("returns 'granted' (safe default) when systemPreferences is undefined on a darwin-claimed platform", async () => {
    const logs: string[] = [];
    const status = await probePermission({
      platform: "darwin",
      logger: (msg) => logs.push(msg),
    });
    expect(status).toBe("granted");
    expect(logs.some((m) => m.includes("UI-07"))).toBe(true);
  });

  it("returns 'granted' when systemPreferences.getMediaAccessStatus throws", async () => {
    const logs: string[] = [];
    const status = await probePermission({
      platform: "darwin",
      systemPreferencesRef: {
        getMediaAccessStatus: vi.fn(() => {
          throw new Error("native bridge missing");
        }),
        askForMediaAccess: vi.fn(),
      },
      logger: (msg) => logs.push(msg),
    });
    expect(status).toBe("granted");
    expect(logs.some((m) => m.includes("UI-07"))).toBe(true);
  });

  it("returns 'granted' on win32 / linux (mac-only verified in Phase 11)", async () => {
    const onWin = await probePermission({ platform: "win32" });
    const onLinux = await probePermission({ platform: "linux" });
    expect(onWin).toBe("granted");
    expect(onLinux).toBe("granted");
  });
});
