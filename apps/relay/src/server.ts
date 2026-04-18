/**
 * Minimal Fastify server for `apps/relay`.
 *
 * Phase 1 scope: the relay service exists but does not yet carry live
 * bridge traffic. Its public surface is limited to `GET /healthz` and
 * `GET /readyz` so Fly.io can health-check a deployed instance before
 * Plan 02-01 lands the bridge lifecycle work.
 *
 * Security rules codified here:
 *   - The relay NEVER accepts long-lived cookies as an auth source.
 *     Future plans will add a `cm_ws_ticket` gate on the WebSocket
 *     upgrade path — see `docs/adr/0001-phase-1-trust-boundary.md`.
 *   - `buildRelayServer` exposes the configured Fastify instance as a
 *     pure function so Vitest can call `fastify.inject()` without ever
 *     opening a network socket.
 *   - `startRelayServer` is only invoked from the dedicated entry point
 *     (`src/index.ts` or `fly deploy`) so importing the module for
 *     tests has no side effects.
 */
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { registerHealthRoutes } from "./routes/health";
import { registerBridgeWsRoutes } from "./routes/ws-bridge.js";
import { registerBrowserWsRoutes } from "./routes/ws-browser.js";

/** Options accepted by {@link buildRelayServer}. */
export interface BuildRelayServerOptions {
  /** Optional logger override used by Vitest. */
  logger?: boolean;
}

/**
 * Build (but do not start) a Fastify instance wired with the Phase 1
 * health and readiness endpoints. The result can be used either by
 * `startRelayServer` to bind a real listener or by tests via
 * `fastify.inject()`.
 */
export async function buildRelayServer(
  options: BuildRelayServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    disableRequestLogging: true,
  });

  await app.register(websocket);
  registerHealthRoutes(app);
  await registerBridgeWsRoutes(app);
  await registerBrowserWsRoutes(app);

  return app;
}

/** Options accepted by {@link startRelayServer}. */
export interface StartRelayServerOptions extends BuildRelayServerOptions {
  host?: string;
  port?: number;
}

/**
 * Bind a real listener for the relay. Called from the CLI entry point
 * (`src/index.ts`) and from production (`fly deploy`). Returns the
 * underlying Fastify instance so callers can await a graceful shutdown.
 */
export async function startRelayServer(
  options: StartRelayServerOptions = {},
): Promise<FastifyInstance> {
  const app = await buildRelayServer({ logger: options.logger ?? true });
  const host = options.host ?? process.env.RELAY_HOST ?? "0.0.0.0";
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  await app.listen({ host, port });
  return app;
}
