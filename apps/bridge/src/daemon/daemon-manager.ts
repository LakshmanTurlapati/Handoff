import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadBridgeDaemonLock,
  loadBridgeDaemonState,
  saveBridgeDaemonLock,
  saveBridgeDaemonState,
  type BridgeDaemonState,
} from "../lib/local-state.js";

// Coordination is persisted through daemon.json and daemon.lock in the
// handoff XDG state directory so repeated local launch attempts can reuse
// one outbound-only bridge daemon.

export interface DaemonStatusSnapshot {
  pid: number | null;
  status: "starting" | "running" | "stale" | "stopped";
  startedAt: string | null;
  bridgeInstanceId: string | null;
}

export interface StartDetachedDaemonOptions {
  bridgeInstanceId: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  spawnProcess?: typeof spawn;
}

export interface EnsureDaemonRunningOptions extends StartDetachedDaemonOptions {}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return false;
    }
    throw error;
  }
}

function toSnapshot(
  daemonState: BridgeDaemonState | null,
  bridgeInstanceId: string | null,
): DaemonStatusSnapshot {
  if (!daemonState) {
    return {
      pid: null,
      status: "stopped",
      startedAt: null,
      bridgeInstanceId,
    };
  }

  if (!isProcessAlive(daemonState.pid)) {
    return {
      pid: daemonState.pid,
      status: "stale",
      startedAt: daemonState.startedAt,
      bridgeInstanceId,
    };
  }

  return {
    pid: daemonState.pid,
    status:
      daemonState.status === "starting" ? "starting" : "running",
    startedAt: daemonState.startedAt,
    bridgeInstanceId,
  };
}

export async function readDaemonStatus(): Promise<DaemonStatusSnapshot> {
  const [daemonState, daemonLock] = await Promise.all([
    loadBridgeDaemonState(),
    loadBridgeDaemonLock(),
  ]);

  if (daemonState) {
    return toSnapshot(daemonState, daemonLock?.bridgeInstanceId ?? null);
  }

  if (daemonLock && isProcessAlive(daemonLock.pid)) {
    return {
      pid: daemonLock.pid,
      status: "starting",
      startedAt: null,
      bridgeInstanceId: daemonLock.bridgeInstanceId,
    };
  }

  if (daemonLock) {
    return {
      pid: daemonLock.pid,
      status: "stale",
      startedAt: null,
      bridgeInstanceId: daemonLock.bridgeInstanceId,
    };
  }

  return {
    pid: null,
    status: "stopped",
    startedAt: null,
    bridgeInstanceId: null,
  };
}

export async function startDetachedDaemon(
  options: StartDetachedDaemonOptions,
): Promise<DaemonStatusSnapshot> {
  const now = options.now ?? (() => new Date());
  const command = options.command ?? process.execPath;
  const args =
    options.args ??
    [fileURLToPath(new URL("../cli.js", import.meta.url)), "daemon"];
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: "ignore",
  });

  if (!child.pid) {
    throw new Error("failed_to_spawn_handoff_daemon");
  }

  child.unref();

  const startedAt = now().toISOString();
  await saveBridgeDaemonLock({
    pid: child.pid,
    bridgeInstanceId: options.bridgeInstanceId,
  });
  await saveBridgeDaemonState({
    pid: child.pid,
    status: "starting",
    startedAt,
  });

  return {
    pid: child.pid,
    status: "starting",
    startedAt,
    bridgeInstanceId: options.bridgeInstanceId,
  };
}

export async function ensureDaemonRunning(
  options: EnsureDaemonRunningOptions,
): Promise<{
  action: "daemon_reused" | "daemon_started";
  status: DaemonStatusSnapshot;
}> {
  const current = await readDaemonStatus();
  if (
    current.pid &&
    current.bridgeInstanceId === options.bridgeInstanceId &&
    current.status !== "stale" &&
    current.status !== "stopped"
  ) {
    return {
      action: "daemon_reused",
      status: current,
    };
  }

  const started = await startDetachedDaemon(options);
  return {
    action: "daemon_started",
    status: started,
  };
}
