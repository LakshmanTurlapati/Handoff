/**
 * MockAchillesBridge — test seam attached to window.__mockBridge.
 *
 * This module is loaded by the headless renderer bundle BEFORE the
 * renderer's main.tsx hydrates. Loading order is enforced via the
 * `<script type="module" src="./mock-bridge.ts">` injection in the
 * headless index.html (apps/achilles/test/mocks/index.html).
 *
 * The mock maintains its own subscriber registry and forwards mock
 * dispatches through the renderer/bridge.ts adapter so the renderer
 * sees an identical surface in both production and test modes.
 *
 * `getLastEmittedIPC()` returns the running log of IPC calls the
 * renderer would have made (requestState, openSystemSettings, etc.)
 * so Playwright assertions can inspect them without faking the main
 * process.
 */

import type {
  AchillesState,
  PermissionState,
} from "../../src/shared/constants.js";

interface SubscriberSet {
  state: Array<(s: AchillesState) => void>;
  permission: Array<(p: PermissionState) => void>;
  partial: Array<(text: string) => void>;
  committed: Array<(entry: {
    id: string;
    text: string;
    committedAt: number;
  }) => void>;
  micAmp: Array<(rms: number) => void>;
  ttsAmp: Array<(rms: number) => void>;
  err: Array<(msg: string) => void>;
}

const subscribers: SubscriberSet = {
  state: [],
  permission: [],
  partial: [],
  committed: [],
  micAmp: [],
  ttsAmp: [],
  err: [],
};

const ipcLog: Array<{ type: string; payload: unknown }> = [];

let committedCounter = 0;
function nextUuid(): string {
  // Deterministic version-4-shaped UUID for tests. Real UUIDs come from
  // ElevenLabs in Phase 12; we never round-trip these IDs to network.
  committedCounter++;
  const hex = committedCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

const mock = {
  setState(s: AchillesState): void {
    for (const cb of subscribers.state) cb(s);
  },
  setPermission(p: PermissionState): void {
    for (const cb of subscribers.permission) cb(p);
  },
  emitPartialTranscript(text: string): void {
    for (const cb of subscribers.partial) cb(text);
  },
  emitCommittedTranscript(text: string): void {
    const entry = {
      id: nextUuid(),
      text,
      committedAt: Date.now(),
    };
    for (const cb of subscribers.committed) cb(entry);
  },
  emitMicAmplitude(rms: number): void {
    for (const cb of subscribers.micAmp) cb(rms);
  },
  emitTtsAmplitude(rms: number): void {
    for (const cb of subscribers.ttsAmp) cb(rms);
  },
  emitError(message: string): void {
    for (const cb of subscribers.err) cb(message);
  },
  __test_inject_error(
    kind:
      | "mic_unavailable"
      | "hotkey_collision"
      | "persistence_failure"
      | "unknown",
  ): void {
    const copy: Record<string, string> = {
      mic_unavailable:
        "Microphone not available. Check your input device.",
      hotkey_collision:
        "Hotkey is in use by another app. Change it in Settings.",
      persistence_failure:
        "Could not save window position. Settings may not persist.",
      unknown: "Something went wrong. Try again in a moment.",
    };
    for (const cb of subscribers.state) cb("error");
    for (const cb of subscribers.err) cb(copy[kind]!);
  },
  getLastEmittedIPC(): Array<{ type: string; payload: unknown }> {
    return ipcLog;
  },
  // Internal: the renderer bridge adapter reads `_subscribers` to wire
  // its subscribe functions against the mock's lists.
  _subscribers: subscribers,
};

(
  window as unknown as { __mockBridge: typeof mock }
).__mockBridge = mock;
