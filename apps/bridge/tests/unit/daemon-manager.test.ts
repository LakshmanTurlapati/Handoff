import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureDaemonRunning,
  readDaemonStatus,
} from "../../src/daemon/daemon-manager.js";
import {
  saveBridgeDaemonLock,
  saveBridgeDaemonState,
} from "../../src/lib/local-state.js";

describe("daemon manager", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(os.tmpdir(), "handoff-daemon-manager-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(tempRoot, "config"));
    vi.stubEnv("XDG_STATE_HOME", join(tempRoot, "state"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("reports a live PID as running", async () => {
    vi.spyOn(process, "kill").mockImplementation(
      ((pid: number, signal?: number | NodeJS.Signals) => {
        expect(signal).toBe(0);
        return true;
      }) as typeof process.kill,
    );

    await saveBridgeDaemonLock({
      pid: 4242,
      bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
    });
    await saveBridgeDaemonState({
      pid: 4242,
      status: "running",
      startedAt: "2026-04-19T13:00:00.000Z",
    });

    await expect(readDaemonStatus()).resolves.toMatchObject({
      pid: 4242,
      status: "running",
      bridgeInstanceId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("treats ESRCH as stale", async () => {
    vi.spyOn(process, "kill").mockImplementation(
      ((pid: number, signal?: number | NodeJS.Signals) => {
        expect(signal).toBe(0);
        const error = Object.assign(new Error("missing"), { code: "ESRCH" });
        throw error;
      }) as typeof process.kill,
    );

    await saveBridgeDaemonLock({
      pid: 5252,
      bridgeInstanceId: "33333333-3333-4333-8333-333333333333",
    });
    await saveBridgeDaemonState({
      pid: 5252,
      status: "running",
      startedAt: "2026-04-19T13:05:00.000Z",
    });

    await expect(readDaemonStatus()).resolves.toMatchObject({
      pid: 5252,
      status: "stale",
      bridgeInstanceId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("reuses a locked live daemon without duplicate spawns", async () => {
    vi.spyOn(process, "kill").mockImplementation(
      ((pid: number, signal?: number | NodeJS.Signals) => {
        expect(signal).toBe(0);
        return true;
      }) as typeof process.kill,
    );

    await saveBridgeDaemonLock({
      pid: 6262,
      bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
    });
    await saveBridgeDaemonState({
      pid: 6262,
      status: "starting",
      startedAt: "2026-04-19T13:10:00.000Z",
    });

    const spawnProcess = vi.fn();
    const ensured = await ensureDaemonRunning({
      bridgeInstanceId: "44444444-4444-4444-8444-444444444444",
      spawnProcess: spawnProcess as never,
    });

    expect(ensured.action).toBe("daemon_reused");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
