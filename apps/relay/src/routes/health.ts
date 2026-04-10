/**
 * Health and readiness route handlers for `apps/relay`.
 *
 * These two endpoints are the only public HTTP surface the relay exposes
 * in Phase 1. They exist now — before bridge traffic lands in Phase 2 —
 * because Fly.io's machine health check and deploy pipeline need both
 * paths to return 200 OK before a new release is considered live
 * (`fly deploy` uses them as the default liveness + readiness probes).
 *
 * Contracts:
 *   - `GET /healthz` — liveness: the process is up and able to serve
 *     requests. Must never block on external dependencies.
 *   - `GET /readyz`  — readiness: the process is up AND is allowed to
 *     accept new traffic. Right now this is identical to `/healthz`,
 *     but it is kept as a separate endpoint so later plans (Plan 02-01,
 *     Plan 05-02) can gate readiness on relay ownership state without
 *     changing the Fly.io health check URL.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Machine-readable liveness payload. */
export interface HealthzPayload {
  status: "ok";
  service: "codex-mobile-relay";
  timestamp: string;
  uptimeSeconds: number;
}

/** Machine-readable readiness payload. */
export interface ReadyzPayload {
  status: "ready";
  service: "codex-mobile-relay";
  timestamp: string;
  version: string;
}

/**
 * Pure handler for `GET /healthz`. Exposed directly (not just through
 * Fastify) so Vitest can assert the returned shape without spinning up
 * an HTTP listener.
 */
export async function handleHealthz(): Promise<HealthzPayload> {
  return {
    status: "ok",
    service: "codex-mobile-relay",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/**
 * Pure handler for `GET /readyz`. Kept distinct from `handleHealthz`
 * even though the Phase 1 implementation is identical — Plan 02-01 will
 * add ownership-aware gating here.
 */
export async function handleReadyz(): Promise<ReadyzPayload> {
  return {
    status: "ready",
    service: "codex-mobile-relay",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.1.0",
  };
}

/**
 * Register the `/healthz` and `/readyz` routes on the supplied Fastify
 * instance. Split out from `server.ts` so the route definitions can be
 * tested in isolation with `fastify.inject()`.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get(
    "/healthz",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const payload = await handleHealthz();
      reply.code(200).send(payload);
    },
  );

  app.get(
    "/readyz",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const payload = await handleReadyz();
      reply.code(200).send(payload);
    },
  );
}
