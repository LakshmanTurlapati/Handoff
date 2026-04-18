/**
 * Readiness endpoint for `apps/relay` (Fastify).
 *
 * Split out from `./health.ts` in plan 01-03 so Fly.io's machine check
 * pipeline has a dedicated file to reference from `apps/relay/fly.toml`
 * and so later plans (Plan 02-01's bridge lifecycle, Plan 05-02's
 * ownership-aware routing) can extend the readiness logic without
 * touching liveness.
 *
 * Contract:
 *   - `GET /readyz` returns 200 OK when the process is allowed to accept
 *     NEW traffic. In Phase 1 this is identical to liveness — the relay
 *     has no durable state to warm up yet — but the URL is held stable so
 *     Fly.io's health-check target never has to change.
 *   - Phase 2+ will gate readiness on bridge ownership state and relay
 *     queue pressure. That logic will land here, not in `health.ts`.
 *   - The handler is exposed as a pure function (`handleReadyz`) so
 *     Vitest can assert the returned payload shape without binding a
 *     socket.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handleRelayOps, type RelayOpsDependencies } from "./ops.js";

/** Machine-readable readiness payload. */
export interface ReadyzPayload {
  status: "ready" | "degraded";
}

/**
 * Pure handler for `GET /readyz`. Kept distinct from `handleHealthz`
 * even though the Phase 1 implementation is identical — Plan 02-01 will
 * add ownership-aware gating here.
 */
export async function handleReadyz(
  dependencies: RelayOpsDependencies = {},
): Promise<ReadyzPayload> {
  const snapshot = await handleRelayOps(dependencies);
  return {
    status: snapshot.readyzStatus,
  };
}

/**
 * Register `GET /readyz` on the supplied Fastify instance. Called from
 * `registerHealthRoutes` in `./health.ts`, so `server.ts` continues to
 * expose a single wiring entry point and Plan 02-01 can swap the handler
 * here without touching the server bootstrap.
 */
export function registerReadyzRoute(
  app: FastifyInstance,
  dependencies: RelayOpsDependencies = {},
): void {
  app.get(
    "/readyz",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const payload = await handleReadyz(dependencies);
      reply.code(payload.status === "ready" ? 200 : 503).send(payload);
    },
  );
}
