/**
 * Auth.js entry point for the Codex Mobile web app.
 *
 * This module is NOT edge-safe — it may later import Node-only integrations
 * (database adapters, server-only crypto) without polluting the edge
 * middleware. The shared `authConfig` in `./auth.config.ts` is the
 * single source of truth for providers, callbacks, and pages; this file
 * only wires it into the Auth.js runtime and re-exports the helpers the
 * rest of `apps/web` consumes.
 *
 * Phase 1 scope:
 *   - `auth()` — server helper used by route handlers and server components
 *     to read the current `cm_web_session`.
 *   - `signIn` / `signOut` — server actions exposed to React components for
 *     the `Continue with GitHub` button and the sign-out flow.
 *   - `GET` / `POST` handlers re-exported by `app/api/auth/[...nextauth]/route.ts`.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth(authConfig);
