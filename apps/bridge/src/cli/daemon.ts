import { BridgeDaemon } from "../daemon/bridge-daemon.js";
import { RelayConnection } from "../daemon/relay-connection.js";

export interface DaemonCommandOptions {
  bridgeInstanceId?: string;
  deviceSessionId: string;
  out?: NodeJS.WritableStream;
  relayUrl: string;
  secret: Uint8Array;
  signal?: AbortSignal;
  userId: string;
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

export async function runDaemonCommand(
  options: DaemonCommandOptions,
): Promise<number> {
  const out = options.out ?? process.stdout;
  const log = (line: string) => out.write(`${line}\n`);
  const bridgeInstanceId = options.bridgeInstanceId ?? crypto.randomUUID();

  const daemon = new BridgeDaemon({
    relayConnection: new RelayConnection({
      relayUrl: options.relayUrl,
      secret: options.secret,
      userId: options.userId,
      deviceSessionId: options.deviceSessionId,
      bridgeInstanceId,
    }),
  });

  try {
    log("codex-mobile-bridge · starting daemon");
    log(`  bridge instance : ${bridgeInstanceId}`);
    log(`  relay url       : ${options.relayUrl}`);
    log(`  user            : ${options.userId}`);
    log(`  device session  : ${options.deviceSessionId}`);

    await daemon.start();
    log("Bridge daemon connected. Press Ctrl+C to stop.");

    await waitForShutdown(options.signal);
    await daemon.stop();
    log("Bridge daemon stopped.");
    return 0;
  } catch (error) {
    await daemon.stop().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    log(`Bridge daemon failed: ${message}`);
    return 1;
  }
}
