import { mintWsTicket } from "@codex-mobile/auth";
import { BridgeDaemon } from "../daemon/bridge-daemon.js";
import { RelayConnection } from "../daemon/relay-connection.js";
import {
  loadBridgeBootstrapState,
  saveBridgeDaemonLock,
  saveBridgeDaemonState,
} from "../lib/local-state.js";
import { PairingClient } from "../lib/pairing-client.js";

export interface DaemonCommandOptions {
  bridgeInstanceId?: string;
  deviceSessionId?: string;
  out?: NodeJS.WritableStream;
  relayUrl?: string;
  secret?: Uint8Array;
  signal?: AbortSignal;
  unsafeEnvOverride?: boolean;
  userId?: string;
  client?: PairingClient;
}

function waitForShutdown(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    if (signal) {
      signal.addEventListener("abort", () => resolve(), { once: true });
      return;
    }

    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };

    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`missing_required_config:${name}`);
  }

  return value;
}

async function createRelayConnection(
  options: DaemonCommandOptions,
): Promise<{
  bridgeInstanceId: string;
  daemon: BridgeDaemon;
}> {
  if (options.unsafeEnvOverride) {
    const relayUrl = requireValue(
      "CODEX_MOBILE_RELAY_URL",
      options.relayUrl ?? process.env.CODEX_MOBILE_RELAY_URL,
    );
    const userId = requireValue(
      "CODEX_MOBILE_USER_ID",
      options.userId ?? process.env.CODEX_MOBILE_USER_ID,
    );
    const deviceSessionId = requireValue(
      "CODEX_MOBILE_DEVICE_SESSION_ID",
      options.deviceSessionId ?? process.env.CODEX_MOBILE_DEVICE_SESSION_ID,
    );
    const secret =
      options.secret ??
      new TextEncoder().encode(
        requireValue(
          "CODEX_MOBILE_WS_TICKET_SECRET",
          process.env.CODEX_MOBILE_WS_TICKET_SECRET,
        ),
      );
    const bridgeInstanceId =
      options.bridgeInstanceId ??
      process.env.CODEX_MOBILE_BRIDGE_INSTANCE_ID ??
      crypto.randomUUID();

    return {
      bridgeInstanceId,
      daemon: new BridgeDaemon({
        relayConnection: new RelayConnection({
          bridgeInstanceId,
          ticketProvider: async () => {
            const { ticket } = await mintWsTicket({
              userId,
              deviceSessionId,
              secret,
            });
            return {
              relayUrl,
              ticket,
            };
          },
        }),
      }),
    };
  }

  const bootstrap = await loadBridgeBootstrapState();
  if (!bootstrap) {
    throw new Error("missing_bridge_bootstrap_state");
  }

  const client =
    options.client ??
    new PairingClient({
      baseUrl: bootstrap.baseUrl,
      userAgent: "handoff/0.1.0",
    });

  return {
    bridgeInstanceId: bootstrap.bridgeInstanceId,
    daemon: new BridgeDaemon({
      relayConnection: new RelayConnection({
        bridgeInstanceId: bootstrap.bridgeInstanceId,
        ticketProvider: async () => {
          const ticket = await client.createBridgeConnectTicket({
            bridgeInstallationId: bootstrap.bridgeInstallationId,
            bridgeBootstrapToken: bootstrap.bridgeBootstrapToken,
          });
          return {
            relayUrl: ticket.relayUrl,
            ticket: ticket.ticket,
          };
        },
      }),
    }),
  };
}

export async function runDaemonCommand(
  options: DaemonCommandOptions = {},
): Promise<number> {
  const out = options.out ?? process.stdout;
  const log = (line: string) => out.write(`${line}\n`);
  const startedAt = new Date().toISOString();
  let daemon: BridgeDaemon | null = null;
  let bridgeInstanceId = options.bridgeInstanceId ?? null;

  try {
    const created = await createRelayConnection(options);
    daemon = created.daemon;
    bridgeInstanceId = created.bridgeInstanceId;

    await saveBridgeDaemonLock({
      pid: process.pid,
      bridgeInstanceId,
    });
    await saveBridgeDaemonState({
      pid: process.pid,
      status: "starting",
      startedAt,
    });

    log("handoff · starting daemon");
    log(`  bridge instance : ${bridgeInstanceId}`);
    if (options.unsafeEnvOverride) {
      log("  auth mode       : --unsafe-env-override");
    } else {
      log("  connect route   : /api/bridge/connect-ticket");
    }

    await daemon.start();
    await saveBridgeDaemonState({
      pid: process.pid,
      status: "running",
      startedAt,
    });
    log("Bridge daemon connected. Press Ctrl+C to stop.");

    await waitForShutdown(options.signal);
    await daemon.stop();
    await saveBridgeDaemonState({
      pid: process.pid,
      status: "stopped",
      startedAt,
    });
    log("Bridge daemon stopped.");
    return 0;
  } catch (error) {
    await daemon?.stop().catch(() => undefined);
    if (bridgeInstanceId) {
      await saveBridgeDaemonLock({
        pid: process.pid,
        bridgeInstanceId,
      }).catch(() => undefined);
    }
    await saveBridgeDaemonState({
      pid: process.pid,
      status: "stopped",
      startedAt,
    }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    log(`Bridge daemon failed: ${message}`);
    return 1;
  }
}
