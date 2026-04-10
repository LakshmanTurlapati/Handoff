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
 */
export const PUBLIC_PATHS = [
  "/sign-in",
  "/api/auth",
  "/api/healthz",
] as const;

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
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix));
      if (isPublic) {
        return true;
      }
      return Boolean(auth?.user);
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
