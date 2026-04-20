import {
  ensureDaemonRunning,
  readDaemonStatus,
} from "../daemon/daemon-manager.js";
import { loadBridgeConfig } from "../lib/local-state.js";

export interface LaunchCommandOptions {
  out?: NodeJS.WritableStream;
  ensureDaemon?: typeof ensureDaemonRunning;
  readStatus?: typeof readDaemonStatus;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface LaunchCommandResult {
  exitCode: number;
  message: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLaunchCommand(
  options: LaunchCommandOptions = {},
): Promise<LaunchCommandResult> {
  const out = options.out ?? process.stdout;
  const log = (line: string) => out.write(`${line}\n`);
  const ensureDaemon = options.ensureDaemon ?? ensureDaemonRunning;
  const readStatus = options.readStatus ?? readDaemonStatus;
  const bootstrap = await loadBridgeConfig();

  if (!bootstrap) {
    return {
      exitCode: 1,
      message: "missing_bridge_bootstrap_state",
    };
  }

  const ensured = await ensureDaemon({
    bridgeInstanceId: bootstrap.bridgeInstanceId,
  });

  if (ensured.action === "daemon_reused") {
    log("daemon_reused");
    return {
      exitCode: 0,
      message: "daemon_reused",
    };
  }

  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  const pollIntervalMs = options.pollIntervalMs ?? 100;

  // Wait for daemon.json to report status = "running" before returning.
  while (Date.now() < deadline) {
    const status = await readStatus();
    if (status.status === "running") {
      log("daemon_started");
      return {
        exitCode: 0,
        message: "daemon_started",
      };
    }
    await sleep(pollIntervalMs);
  }

  return {
    exitCode: 1,
    message: "daemon_start_timeout",
  };
}
