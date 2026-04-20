import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeBridgeStatePaths,
  loadBridgeBootstrapState,
  saveBridgeBootstrapState,
  saveBridgeDaemonState,
} from "../../src/lib/local-state.js";

describe("local bridge state", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(os.tmpdir(), "handoff-local-state-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes config.json, credentials.json, and daemon.json with 0o600 files under 0o700 XDG directories", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", join(tempRoot, "xdg-config"));
    vi.stubEnv("XDG_STATE_HOME", join(tempRoot, "xdg-state"));

    await saveBridgeBootstrapState({
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
      deviceLabel: "Pocket phone",
      bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
    });
    await saveBridgeDaemonState({
      pid: 4242,
      status: "running",
      startedAt: "2026-04-19T10:00:00.000Z",
    });

    const paths = describeBridgeStatePaths();
    const state = await loadBridgeBootstrapState();

    expect(state).toEqual({
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
      deviceLabel: "Pocket phone",
      bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
    });
    expect(JSON.parse(await readFile(paths.configPath, "utf8"))).toMatchObject({
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(JSON.parse(await readFile(paths.credentialsPath, "utf8"))).toMatchObject({
      bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
    });

    expect((await stat(paths.configDir)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.stateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(paths.configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.credentialsPath)).mode & 0o777).toBe(0o600);
    expect((await stat(paths.daemonPath)).mode & 0o777).toBe(0o600);
  });

  it("falls back to ~/.config/handoff and ~/.local/state/handoff when XDG dirs are unset", async () => {
    vi.stubEnv("HOME", tempRoot);
    vi.stubEnv("XDG_CONFIG_HOME", "");
    vi.stubEnv("XDG_STATE_HOME", "");

    await saveBridgeBootstrapState({
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "33333333-3333-4333-8333-333333333333",
      bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
      deviceLabel: null,
      bridgeBootstrapToken: "bootstrap-token-abcdefghijklmnopqrstuvwxyz123456",
    });
    await saveBridgeDaemonState({
      pid: 7,
      status: "starting",
      startedAt: "2026-04-19T11:00:00.000Z",
    });

    const paths = describeBridgeStatePaths();
    expect(paths.configDir).toBe(join(tempRoot, ".config", "handoff"));
    expect(paths.stateDir).toBe(join(tempRoot, ".local", "state", "handoff"));
  });
});
