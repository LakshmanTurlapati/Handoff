/**
 * Health (liveness) route for `apps/relay`.
 *
 * Phase 1 exposes exactly two probes on the relay:
 *   - `GET /healthz` — liveness: the process is up and able to serve
 *     requests. Must never block on external dependencies. Owned here.
 *   - `GET /readyz`  — readiness: the process is up AND is allowed to
 *     accept new traffic. Lives in `./readyz.ts` so Plan 02-01 / Plan
 *     05-02 can extend it without touching liveness.
 *
 * Fly.io's machine health check and deploy pipeline need both paths to
 * return 200 OK before a new release is considered live.
 *
 * `registerHealthRoutes` is the single wiring entry point consumed by
 * `server.ts` so the server bootstrap does not need to know that
 * liveness and readiness now live in separate modules.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registerReadyzRoute } from "./readyz";

export type { ReadyzPayload } from "./readyz";
export { handleReadyz, registerReadyzRoute } from "./readyz";

/** Machine-readable liveness payload. */
export interface HealthzPayload {
  status: "ok";
  service: "codex-mobile-relay";
  timestamp: string;
  uptimeSeconds: number;
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
 * Register both `/healthz` and `/readyz` on the supplied Fastify
 * instance. `/healthz` is defined inline here; `/readyz` is delegated to
 * `registerReadyzRoute` so readiness logic can evolve independently.
 *
 * Split out from `server.ts` so the route definitions can be tested in
 * isolation with `fastify.inject()`.
 */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get(
    "/healthz",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const payload = await handleHealthz();
      reply.code(200).send(payload);
    },
  );

  registerReadyzRoute(app);
}
