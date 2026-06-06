/**
 * Behaviour tests for the apps/achilles shared constants module.
 *
 * These constants are the Wave-1 substrate that Plans 11-02 and 11-03
 * consume directly:
 *   - WINDOW_WIDTH / WINDOW_HEIGHT / DEFAULT_MARGIN_PX / DRAG_HANDLE_HEIGHT_PX
 *     pin the locked BrowserWindow contract from UI-SPEC.md s2 (Layout Grid).
 *   - DEFAULT_HOTKEY_ACCELERATOR pins the UI-06 default hotkey.
 *   - IPC channel name constants pin the Main-Renderer wire-protocol;
 *     each value is a kebab-case string with the "achilles:" prefix so
 *     a single grep across the renderer makes the boundary obvious.
 *   - ACHILLES_STATES / HOTKEY_MODES / PERMISSION_STATES are the three
 *     `as const` tuples the state-machine + Zod schemas key off of.
 */
import { describe, expect, it } from "vitest";
import {
  ACHILLES_STATES,
  DEFAULT_HOTKEY_ACCELERATOR,
  DEFAULT_MARGIN_PX,
  DRAG_HANDLE_HEIGHT_PX,
  HOTKEY_MODES,
  IPC_ERROR,
  IPC_MIC_AMPLITUDE,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_TRANSCRIPT_COMMITTED,
  IPC_TRANSCRIPT_PARTIAL,
  IPC_TTS_AMPLITUDE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
  PERMISSION_STATES,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "./constants.js";

describe("apps/achilles shared constants — window + token constants", () => {
  it("WINDOW_WIDTH and WINDOW_HEIGHT match the locked UI-01 260x260 square", () => {
    expect(WINDOW_WIDTH).toBe(260);
    expect(WINDOW_HEIGHT).toBe(260);
  });

  it("DEFAULT_MARGIN_PX is 24 px (top-right inset on first launch)", () => {
    expect(DEFAULT_MARGIN_PX).toBe(24);
  });

  it("DRAG_HANDLE_HEIGHT_PX is 30 px (UI-SPEC s2 layout grid)", () => {
    expect(DRAG_HANDLE_HEIGHT_PX).toBe(30);
  });

  it("DEFAULT_HOTKEY_ACCELERATOR is CommandOrControl+Shift+A (UI-06 default)", () => {
    expect(DEFAULT_HOTKEY_ACCELERATOR).toBe("CommandOrControl+Shift+A");
  });
});

describe("apps/achilles shared constants — IPC channel names", () => {
  const channels = [
    IPC_STATE_CHANGED,
    IPC_TRANSCRIPT_PARTIAL,
    IPC_TRANSCRIPT_COMMITTED,
    IPC_MIC_AMPLITUDE,
    IPC_TTS_AMPLITUDE,
    IPC_PERMISSION_STATE,
    IPC_ERROR,
    IPC_REQUEST_STATE,
    IPC_REGISTER_HOTKEY,
    IPC_OPEN_SYSTEM_SETTINGS,
    IPC_UPDATE_WINDOW_POSITION,
    IPC_UPDATE_HOTKEY_CONFIG,
  ];

  it("exports 12 distinct IPC channel name constants", () => {
    const unique = new Set(channels);
    expect(unique.size).toBe(channels.length);
    expect(channels.length).toBe(12);
  });

  it("every IPC channel value begins with the 'achilles:' prefix", () => {
    for (const channel of channels) {
      expect(channel.startsWith("achilles:")).toBe(true);
    }
  });

  it("every IPC channel value is kebab-case after the prefix", () => {
    const kebab = /^achilles:[a-z][a-z0-9-]*$/;
    for (const channel of channels) {
      expect(channel).toMatch(kebab);
    }
  });
});

describe("apps/achilles shared constants — as const tuples", () => {
  it("ACHILLES_STATES has length 5 and lists every documented state", () => {
    expect(ACHILLES_STATES).toEqual([
      "idle",
      "listening",
      "processing",
      "speaking",
      "error",
    ] as const);
    expect(ACHILLES_STATES.length).toBe(5);
  });

  it("HOTKEY_MODES lists toggle and pushToTalk", () => {
    expect(HOTKEY_MODES).toEqual(["toggle", "pushToTalk"] as const);
    expect(HOTKEY_MODES.length).toBe(2);
  });

  it("PERMISSION_STATES lists granted, not-determined, denied, restricted", () => {
    expect(PERMISSION_STATES).toEqual([
      "granted",
      "not-determined",
      "denied",
      "restricted",
    ] as const);
    expect(PERMISSION_STATES.length).toBe(4);
  });
});
