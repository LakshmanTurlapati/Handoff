/**
 * Edge-safe Auth.js configuration for the Codex Mobile web app.
 *
 * This file is imported by the Next.js middleware AND by `auth.ts`. Keep it
 * free of Node-only modules (database drivers, crypto, etc.) so it can run
 * inside the edge runtime that evaluates middleware.
 *
 * Phase 1 decisions:
 *   - GitHub is the ONLY enabled provider for v1. This is a deliberate
 *     developer-first choice documented in `.planning/phases/01-identity-pairing-foundation/01-RESEARCH.md`.
 *   - The sign-in screen lives at `/sign-in` and is the only public route
 *     for unauthenticated users. Middleware redirects everything else.
 *   - The long-lived `cm_device_session` cookie is issued by the pairing
 *     confirmation route — NOT by Auth.js. Auth.js only owns the short
 *     rolling browser session.
 */
import GitHub from "next-auth/providers/github";
import type { NextAuthConfig } from "next-auth";

/**
 * Paths that do not require an authenticated session. Everything else —
 * including the pairing UI — is guarded by middleware.
 *
 * `/api/healthz` is public so Fly.io's machine health checks (see
 * `apps/web/fly.toml` in plan 01-03) can probe the process without
 * round-tripping through GitHub OAuth. The handler itself is
 * dependency-free and reveals nothing sensitive.
 *
 * NOTE: this list is deliberately NARROW. The bridge-facing pairing
 * endpoints are NOT in this list — they are allowlisted separately
 * below by METHOD + PATHNAME EQUALITY so the authenticated
 * `/api/pairings/[id]/redeem` and `/api/pairings/[id]/confirm`
 * subpaths are not accidentally exposed by a prefix match.
 */
export const PUBLIC_PATHS = [
  "/sign-in",
  "/api/auth",
  "/api/healthz",
] as const;

/**
 * Exact pathnames for unauthenticated POST requests from the bridge CLI.
 * These are allowlisted by METHOD + PATHNAME EQUALITY in middleware.ts
 * so the `/redeem` and `/confirm` subpaths are NOT accidentally exposed.
 * (CR-01 fix from 01-VERIFICATION.md)
 *
 * Pair with the method=GET regex `/^\/api\/pairings\/[^\/]+$/` in
 * middleware.ts, which lets the bridge poll `GET /api/pairings/[id]`
 * without letting `GET /api/pairings/[id]/redeem` through.
 */
export const UNAUTHENTICATED_API_POST_PATHS = new Set<string>([
  "/api/pairings",
]);

/**
 * Regex allowlist for unauthenticated POST requests on the
 * parameterized pairing confirm subpath. The bridge CLI calls
 * POST /api/pairings/[pairingId]/confirm with only an
 * `Authorization: Bearer <pairingToken>` header (no browser cookie),
 * so the route must pass middleware and be authenticated by the
 * handler itself via `verifyPairingTokenHash`. The regex is strict
 * single-segment: it matches `/api/pairings/abc-123/confirm` but
 * NOT `/api/pairings/abc-123/confirm/extra` and NOT
 * `/api/pairings/abc-123/redeem`, so the /redeem subpath stays
 * browser-cookie-gated. (CR-GAP-01 fix from 01-REVIEW-GAP.md.)
 */
export const pairingConfirmPostRegex = /^\/api\/pairings\/[^\/]+\/confirm$/;

export const authConfig = {
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  session: {
    strategy: "jwt",
    // Match the documented 12-hour rolling window for `cm_web_session`.
    maxAge: 60 * 60 * 12,
  },
  callbacks: {
    /**
     * Middleware-friendly authorization gate. Called from `middleware.ts`
     * via the Auth.js `auth` wrapper — it must return a boolean or a
     * `Response` without touching any Node-only APIs.
     *
     * Order of checks (CR-01 + CR-GAP-01):
     *   1. Method+pathname-equality allowlist for unauthenticated bridge
     *      POSTs (`POST /api/pairings`).
     *   2. Method+regex allowlist for unauthenticated bridge POSTs on the
     *      parameterized confirm subpath (`POST /api/pairings/[id]/confirm`).
     *      The `pairingConfirmPostRegex` is strict single-segment so
     *      `/confirm/extra` and `/redeem` are NOT matched. (CR-GAP-01.)
     *   3. Method+regex allowlist for unauthenticated bridge GETs on the
     *      pairing status endpoint (`GET /api/pairings/[id]`). The regex
     *      has exactly ONE path segment after `/api/pairings/`, so
     *      `/api/pairings/abc-123/redeem` and `/api/pairings/abc-123/confirm`
     *      are NOT matched and stay auth-gated.
     *   4. `PUBLIC_PATHS` prefix allowlist (sign-in, auth callback, healthz).
     *   5. Fall through to the browser session check.
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const method = request.method;
      if (method === "POST" && UNAUTHENTICATED_API_POST_PATHS.has(pathname)) {
        return true;
      }
      if (method === "POST" && pairingConfirmPostRegex.test(pathname)) {
        return true;
      }
      if (method === "GET" && /^\/api\/pairings\/[^\/]+$/.test(pathname)) {
        return true;
      }
      const isPublic = PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix));
      if (isPublic) {
        return true;
      }
      return Boolean(auth?.user);
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
