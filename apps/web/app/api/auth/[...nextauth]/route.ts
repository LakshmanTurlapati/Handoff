/**
 * Mount the Auth.js handlers under the App Router catch-all route.
 *
 * Without this file, `/api/auth/*` returns 404 even though `apps/web/auth.ts`
 * exports the handlers. The sign-in page's server action depends on these
 * endpoints for the GitHub OAuth round-trip.
 */
export { GET, POST } from "../../../../auth";
