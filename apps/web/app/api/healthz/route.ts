/**
 * Liveness endpoint for `apps/web` (Next.js App Router).
 *
 * Phase 1 scope (OPS-01): Fly.io's machine health checks must be able to
 * confirm that the Next.js process is running and can serve HTTP before a
 * new release is marked live. This route is intentionally:
 *
 *   - unauthenticated — Auth.js middleware excludes `/api/healthz` via its
 *     public-paths list so a probe never round-trips through GitHub OAuth.
 *   - dependency-free — it must not touch the database, the pairing store,
 *     or any outbound service. Readiness (not liveness) is where those
 *     checks belong, and later plans will add a distinct `/api/readyz` if
 *     the web app ever needs it. For now Fly only probes `/api/healthz`.
 *   - JSON-shaped — operators and test suites can assert on `status` and
 *     `service` without parsing HTML.
 *
 * Contract (pinned by plan 01-03 acceptance criteria):
 *   - Response MUST include `status` and `service` fields.
 *   - Response MUST be returned without any network I/O.
 */

import { NextResponse } from "next/server";

/**
 * Machine-readable liveness payload. Keep the shape aligned with the
 * relay's `HealthzPayload` in `apps/relay/src/routes/health.ts` so
 * operators and dashboards can treat `/api/healthz` (web) and `/healthz`
 * (relay) as interchangeable probes at the contract level.
 */
export interface WebHealthzPayload {
  status: "ok";
  service: "codex-mobile-web";
  timestamp: string;
  uptimeSeconds: number;
}

/** Static Next.js runtime hints — keep the probe on the Node runtime and
 * never cache the response (Fly needs a fresh answer on every probe). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** `GET /api/healthz` — liveness probe consumed by Fly.io. */
export async function GET(): Promise<NextResponse<WebHealthzPayload>> {
  const payload: WebHealthzPayload = {
    status: "ok",
    service: "codex-mobile-web",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
