/**
 * Relay service entry point.
 *
 * This file is the CMD target for `apps/relay/Dockerfile` and the `start`
 * script in `apps/relay/package.json`. Keep it thin: it only wires the
 * Fastify instance produced by `buildRelayServer` to a real listener and
 * installs the signal handlers Fly.io expects for graceful shutdowns.
 *
 * Anything more interesting — routes, WebSocket upgrades, bridge
 * registration — belongs in `./server.ts` or `./routes/*` so the bootstrap
 * layer stays trivial and easy to audit.
 */
import { startRelayServer } from "./server.js";

async function main(): Promise<void> {
  const app = await startRelayServer({ logger: true });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "relay shutdown signal received");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "relay shutdown failed");
      process.exit(1);
    }
  };

  // Fly.io sends SIGINT/SIGTERM on release rollout and machine shutdown.
  // Install both handlers so in-flight requests drain before the process
  // exits. Each handler is registered once; no unref needed.
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console -- bootstrap failure, logger may not exist yet.
  console.error("relay failed to start:", error);
  process.exit(1);
});
