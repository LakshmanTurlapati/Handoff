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
import { registerHealthRoutes } from "./routes/health";

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
export function buildRelayServer(
  options: BuildRelayServerOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    disableRequestLogging: true,
  });

  // /healthz + /readyz are the only routes registered in Phase 1.
  // Plan 02-01 will add the bridge WebSocket upgrade gate on top of
  // this foundation without changing the health endpoints.
  registerHealthRoutes(app);

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
  const app = buildRelayServer({ logger: options.logger ?? true });
  const host = options.host ?? process.env.RELAY_HOST ?? "0.0.0.0";
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  await app.listen({ host, port });
  return app;
}
