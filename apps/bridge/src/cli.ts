import { runDaemonCommand } from "./cli/daemon.js";
import { runPairCommand } from "./cli/pair.js";

function readFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
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
  process.stdout.write(`codex-mobile-bridge <command>

Commands:
  pair    Start device pairing
  daemon  Start the long-running bridge daemon

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
      const result = await runDaemonCommand({
        relayUrl: readRequiredValue("CODEX_MOBILE_RELAY_URL", "--relay-url"),
        secret: new TextEncoder().encode(
          readRequiredValue("CODEX_MOBILE_WS_TICKET_SECRET", "--ws-ticket-secret"),
        ),
        userId: readRequiredValue("CODEX_MOBILE_USER_ID", "--user-id"),
        deviceSessionId: readRequiredValue(
          "CODEX_MOBILE_DEVICE_SESSION_ID",
          "--device-session-id",
        ),
        bridgeInstanceId:
          readFlagValue("--bridge-instance-id") ??
          process.env.CODEX_MOBILE_BRIDGE_INSTANCE_ID,
      });

      process.exitCode = result;
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
