const CLI_NAME = "handoff";

function readFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readRequiredValue(
  envName: string,
  flagName?: string,
): string {
  const value = (flagName ? readFlagValue(flagName) : undefined) ?? process.env[envName];
  if (!value) {
    throw new Error(`missing_required_config:${envName}`);
  }
  return value;
}

function printUsage(): void {
  process.stdout.write(`${CLI_NAME} <command>

Commands:
  pair    Start device pairing
  daemon  Start the long-running bridge daemon
  launch  Start or reuse the background bridge daemon
  codex-handoff  Start or reuse a thread-bound Codex handoff
  install-codex-command  Install or update the packaged /handoff Codex command

Environment:
  CODEX_MOBILE_BASE_URL
  CODEX_MOBILE_RELAY_URL
  CODEX_MOBILE_WS_TICKET_SECRET
  CODEX_MOBILE_USER_ID
  CODEX_MOBILE_DEVICE_SESSION_ID
  CODEX_MOBILE_BRIDGE_INSTANCE_ID
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  switch (command) {
    case "pair": {
      const { runPairCommand } = await import("./cli/pair.js");
      const result = await runPairCommand({
        baseUrl: readRequiredValue("CODEX_MOBILE_BASE_URL", "--base-url"),
        deviceLabel: process.env.CODEX_MOBILE_DEVICE_LABEL,
        bridgeInstanceId: process.env.CODEX_MOBILE_BRIDGE_INSTANCE_ID,
      });

      process.exitCode = result.exitCode;
      if (result.message) {
        process.stdout.write(`${result.message}\n`);
      }
      return;
    }

    case "daemon": {
      const { runDaemonCommand } = await import("./cli/daemon.js");
      const rawSecret =
        readFlagValue("--ws-ticket-secret") ??
        process.env.CODEX_MOBILE_WS_TICKET_SECRET;
      const result = await runDaemonCommand({
        unsafeEnvOverride: hasFlag("--unsafe-env-override"),
        relayUrl: readFlagValue("--relay-url") ?? process.env.CODEX_MOBILE_RELAY_URL,
        secret: rawSecret ? new TextEncoder().encode(rawSecret) : undefined,
        userId: readFlagValue("--user-id") ?? process.env.CODEX_MOBILE_USER_ID,
        deviceSessionId:
          readFlagValue("--device-session-id") ??
          process.env.CODEX_MOBILE_DEVICE_SESSION_ID,
        bridgeInstanceId:
          readFlagValue("--bridge-instance-id") ??
          process.env.CODEX_MOBILE_BRIDGE_INSTANCE_ID,
      });

      process.exitCode = result;
      return;
    }

    case "launch": {
      const { runLaunchCommand } = await import("./cli/launch.js");
      const result = await runLaunchCommand();
      process.exitCode = result.exitCode;
      return;
    }

    case "codex-handoff": {
      const { runCodexHandoffCommand } = await import("./cli/codex-handoff.js");
      const result = await runCodexHandoffCommand({
        threadId: readFlagValue("--thread-id"),
        sessionId: readFlagValue("--session-id"),
        format: readFlagValue("--format"),
      });
      process.exitCode = result.exitCode;
      if (result.exitCode !== 0) {
        process.stderr.write(`${result.message}\n`);
      }
      return;
    }

    case "install-codex-command": {
      const { installCodexHandoffCommand } = await import(
        "./lib/codex-command-install.js"
      );
      const status = await installCodexHandoffCommand();
      process.stdout.write(`${status}\n`);
      return;
    }

    default:
      throw new Error(`unsupported_command:${command}`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
