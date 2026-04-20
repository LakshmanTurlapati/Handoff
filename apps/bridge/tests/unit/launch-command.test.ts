import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLaunchCommand } from "../../src/cli/launch.js";
import { saveBridgeConfig } from "../../src/lib/local-state.js";

describe("launch command", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(os.tmpdir(), "handoff-launch-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempRoot, "config"));
    vi.stubEnv("XDG_STATE_HOME", join(tempRoot, "state"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("prints daemon_reused when a live daemon already exists", async () => {
    await saveBridgeConfig({
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
      deviceLabel: null,
    });

    const out = new PassThrough();
    let output = "";
    out.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const result = await runLaunchCommand({
      out,
      ensureDaemon: vi.fn().mockResolvedValue({
        action: "daemon_reused",
        status: {
          pid: 4242,
          status: "running",
          startedAt: "2026-04-19T14:00:00.000Z",
          bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("daemon_reused");
    expect(output).toContain("daemon_reused");
  });

  it("prints daemon_started after the daemon status turns running", async () => {
    await saveBridgeConfig({
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "33333333-3333-4333-8333-333333333333",
      bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
      deviceLabel: "Pocket phone",
    });

    const out = new PassThrough();
    let output = "";
    out.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        pid: 5151,
        status: "starting",
        startedAt: "2026-04-19T14:05:00.000Z",
        bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
      })
      .mockResolvedValueOnce({
        pid: 5151,
        status: "running",
        startedAt: "2026-04-19T14:05:00.000Z",
        bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
      });

    const result = await runLaunchCommand({
      out,
      ensureDaemon: vi.fn().mockResolvedValue({
        action: "daemon_started",
        status: {
          pid: 5151,
          status: "starting",
          startedAt: "2026-04-19T14:05:00.000Z",
          bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
        },
      }),
      readStatus,
      timeoutMs: 5000,
      pollIntervalMs: 1,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toBe("daemon_started");
    expect(output).toContain("daemon_started");
  });

  it("fails when bootstrap state is missing", async () => {
    const result = await runLaunchCommand();
    expect(result).toEqual({
      exitCode: 1,
      message: "missing_bridge_bootstrap_state",
    });
  });
});
