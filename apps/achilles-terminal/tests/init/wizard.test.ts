/**
 * Phase 18, Plan 03, Task 1 — Tests for init/wizard.ts.
 *
 * ALL tests use deps injection seams. No real prompts, no real file I/O,
 * no real smoke test. CLAUDE.md no-auto-running rule: the smoke test is
 * never called from vitest directly. No emojis.
 */

import { describe, it, expect } from "vitest";
import {
  runInitWizard,
  type WizardDeps,
  type WizardOutcome,
} from "../../src/init/wizard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CANCEL_SYMBOL = Symbol("clack-cancel");

function isCancel(v: unknown): boolean {
  return v === CANCEL_SYMBOL;
}

// Helper to reduce lint noise: wrap a value in a resolved promise
function pr<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

/** Build a minimal WizardDeps that succeeds all steps with sensible defaults. */
function makeHappyPathDeps(overrides: Partial<WizardDeps> = {}): WizardDeps {
  return {
    resolveApiKeyImpl: () => pr({ source: "env" as const, key: "xi_testkey" }),
    writeApiKeyImpl: () => pr(undefined),
    checkPreflightImpl: () => pr({
      sox: { name: "sox" as const, status: "ok" as const, path: "/usr/bin/sox" },
      ffmpeg: { name: "ffmpeg" as const, status: "ok" as const, path: "/usr/bin/ffmpeg" },
      claude: { name: "claude" as const, status: "ok" as const, path: "/usr/local/bin/claude" },
      allOk: true,
    }),
    calibrateAmbientImpl: () => pr({ noiseFloor: 0.012, sampleCount: 250, durationMs: 5000 }),
    writeNoiseFloorImpl: () => pr(undefined),
    resolveParentEmulatorImpl: () => "iTerm2" as const,
    writeInitMarkerImpl: () => {},
    readInitMarkerImpl: () => null,
    runSmokeTestImpl: () => pr({ passed: true, elapsedMs: 1200 }),
    promptText: () => pr("some-api-key"),
    promptSelect: () => pr("keychain"),
    promptConfirm: () => pr(true),
    noteImpl: () => {},
    spinnerImpl: () => ({ start: () => {}, stop: () => {} }),
    isCancel,
    ...overrides,
  };
}

describe("runInitWizard", () => {
  it("executes 7 steps in order when all inputs succeed", async () => {
    const deps = makeHappyPathDeps();
    const outcome: WizardOutcome = await runInitWizard(deps);

    expect(outcome.completed).toBe(true);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.stepsCompleted).toContain("welcome");
    expect(outcome.stepsCompleted).toContain("api-key");
    expect(outcome.stepsCompleted).toContain("preflight");
    expect(outcome.stepsCompleted).toContain("ambient-calibration");
    expect(outcome.stepsCompleted).toContain("smoke-test");
    expect(outcome.stepsCompleted).toContain("summary");
    expect(outcome.stepsCompleted).toContain("marker");
    expect(outcome.stepsCompleted).toHaveLength(7);
  });

  it("outcome.cancelled === true when the api-key promptText returns the clack cancel symbol", async () => {
    const deps = makeHappyPathDeps({
      resolveApiKeyImpl: () => pr({ source: "missing" as const, key: null }),
      promptText: () => pr(CANCEL_SYMBOL),
    });

    const outcome = await runInitWizard(deps);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.completed).toBe(false);
  });

  it("outcome.completed === false (not cancelled) when the summary confirm returns false", async () => {
    let confirmCallCount = 0;
    const deps = makeHappyPathDeps({
      // Happy path has source=env, so confirm order is:
      // 1: keep-env? yes, 2: run-smoke-test? yes, 3: save-summary? NO
      promptConfirm: () => {
        confirmCallCount++;
        if (confirmCallCount === 3) return pr(false);
        return pr(true);
      },
    });

    const outcome = await runInitWizard(deps);
    expect(outcome.completed).toBe(false);
    expect(outcome.cancelled).toBe(false);
  });

  it("runInitWizard does NOT writeInitMarker when summary confirm returns false", async () => {
    const writeMarkerCalls: unknown[] = [];
    let confirmCallCount = 0;

    const deps = makeHappyPathDeps({
      // source=env, confirm order: 1: keep-env? yes, 2: run-smoke-test? yes, 3: save-summary? NO
      promptConfirm: () => {
        confirmCallCount++;
        if (confirmCallCount === 3) return pr(false);
        return pr(true);
      },
      writeInitMarkerImpl: (marker) => {
        writeMarkerCalls.push(marker);
      },
    });

    await runInitWizard(deps);
    expect(writeMarkerCalls.length).toBe(0);
  });

  it("SKIPS the api-key write step when resolveApiKey returns source='env' AND user confirms 'keep'", async () => {
    const writeApiKeyCalls: unknown[] = [];

    const deps = makeHappyPathDeps({
      resolveApiKeyImpl: () => pr({ source: "env" as const, key: "xi_envkeytest" }),
      writeApiKeyImpl: (...args) => {
        writeApiKeyCalls.push(args);
        return pr(undefined);
      },
      // User confirms 'keep env key' (first promptConfirm is env-keep confirm)
      promptConfirm: () => pr(true),
    });

    await runInitWizard(deps);
    expect(writeApiKeyCalls.length).toBe(0);
  });

  it("calls suggestInstallCommand + invokePackageManager when preflight.sox.status === 'missing' AND user confirms install", async () => {
    const suggestCalls: unknown[] = [];
    const invokeCalls: unknown[] = [];

    const deps = makeHappyPathDeps({
      checkPreflightImpl: () => pr({
        sox: { name: "sox" as const, status: "missing" as const, path: null },
        ffmpeg: { name: "ffmpeg" as const, status: "ok" as const, path: "/usr/bin/ffmpeg" },
        claude: { name: "claude" as const, status: "ok" as const, path: "/usr/local/bin/claude" },
        allOk: false,
      }),
      suggestInstallCommandImpl: (platform, missing) => {
        suggestCalls.push({ platform, missing });
        return { cmd: "brew install sox", canAutoInvoke: true };
      },
      invokePackageManagerImpl: (cmd) => {
        invokeCalls.push(cmd);
        return pr({ exitCode: 0, stderr: "" });
      },
      promptConfirm: () => pr(true),
    });

    await runInitWizard(deps);
    expect(suggestCalls.length).toBeGreaterThanOrEqual(1);
    expect(invokeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("calls resolveParentEmulator AND getRemediationHint when preflight.sox.status === 'device-failed' AND platform === 'darwin'", async () => {
    let resolveParentCalled = false;
    const noteCalls: string[] = [];

    const deps = makeHappyPathDeps({
      checkPreflightImpl: () => pr({
        sox: { name: "sox" as const, status: "device-failed" as const, path: "/usr/bin/sox", stderr: "EPERM" },
        ffmpeg: { name: "ffmpeg" as const, status: "ok" as const, path: "/usr/bin/ffmpeg" },
        claude: { name: "claude" as const, status: "ok" as const, path: "/usr/local/bin/claude" },
        allOk: false,
      }),
      resolveParentEmulatorImpl: () => {
        resolveParentCalled = true;
        return "iTerm2" as const;
      },
      noteImpl: (msg) => {
        noteCalls.push(msg);
      },
      platformOverride: "darwin",
    });

    await runInitWizard(deps);
    expect(resolveParentCalled).toBe(true);
    // Note should contain a remediation hint about iTerm2
    const hasRemediationNote = noteCalls.some((n) => n.includes("iTerm2") || n.includes("Microphone") || n.includes("System Settings"));
    expect(hasRemediationNote).toBe(true);
  });

  it("does NOT call resolveParentEmulator on linux even when sox.status === 'device-failed'", async () => {
    let resolveParentCalled = false;

    const deps = makeHappyPathDeps({
      checkPreflightImpl: () => pr({
        sox: { name: "sox" as const, status: "device-failed" as const, path: "/usr/bin/sox", stderr: "EPERM" },
        ffmpeg: { name: "ffmpeg" as const, status: "ok" as const, path: "/usr/bin/ffmpeg" },
        claude: { name: "claude" as const, status: "ok" as const, path: "/usr/local/bin/claude" },
        allOk: false,
      }),
      resolveParentEmulatorImpl: () => {
        resolveParentCalled = true;
        return "unknown" as const;
      },
      platformOverride: "linux",
    });

    await runInitWizard(deps);
    expect(resolveParentCalled).toBe(false);
  });

  it("summary diff includes 'noiseFloor' reference when calibrateAmbient returns 0.012", async () => {
    const noteCalls: string[] = [];

    const deps = makeHappyPathDeps({
      calibrateAmbientImpl: () => pr({ noiseFloor: 0.012, sampleCount: 250, durationMs: 5000 }),
      noteImpl: (msg) => {
        noteCalls.push(msg);
      },
    });

    await runInitWizard(deps);
    const hasDiffNote = noteCalls.some((n) => n.includes("0.012") || n.includes("noiseFloor"));
    expect(hasDiffNote).toBe(true);
  });

  it("idempotency: when readInitMarker returns a prior marker, the api-key step shows the marker's apiKeySource", async () => {
    const noteCalls: string[] = [];
    const promptConfirmMessages: string[] = [];

    const deps = makeHappyPathDeps({
      readInitMarkerImpl: () => ({
        initializedAt: "2026-01-01T00:00:00Z",
        version: "1.3.0",
        apiKeySource: "keychain" as const,
      }),
      resolveApiKeyImpl: () => pr({ source: "keychain" as const, key: "xi_existingkeyvalue0000" }),
      noteImpl: (msg) => noteCalls.push(msg),
      promptConfirm: (msg) => {
        if (msg) promptConfirmMessages.push(msg);
        return pr(true);
      },
    });

    const outcome = await runInitWizard(deps);
    // Wizard should show that API key is already stored in keychain
    expect(outcome.completed).toBe(true);
    const hasKeychainRef = noteCalls.some((n) => n.includes("keychain") || n.includes("env")) ||
      promptConfirmMessages.some((m) => m.includes("keychain") || m.includes("env") || m.includes("key"));
    expect(hasKeychainRef).toBe(true);
  });

  it("writeInitMarker is called with the resolved apiKeySource + a string version + an ISO timestamp", async () => {
    const markerCalls: Array<{
      initializedAt: string;
      version: string;
      apiKeySource: string;
    }> = [];

    const deps = makeHappyPathDeps({
      writeInitMarkerImpl: (marker) => {
        markerCalls.push(marker);
      },
    });

    await runInitWizard(deps);
    expect(markerCalls.length).toBe(1);
    const marker = markerCalls[0]!;
    expect(typeof marker.version).toBe("string");
    expect(marker.version.length).toBeGreaterThan(0);
    // ISO timestamp check
    expect(() => new Date(marker.initializedAt)).not.toThrow();
    expect(new Date(marker.initializedAt).toISOString()).toBe(marker.initializedAt);
    expect(["env", "keychain", "encrypted-file"]).toContain(marker.apiKeySource);
  });
});
