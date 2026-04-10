import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the Codex Mobile control plane database.
 *
 * All durable state for users, sessions, pairings, and audit lives in this
 * schema. See `src/schema.ts` for the Phase 1 table definitions and the
 * trust-boundary notes in `docs/adr/0001-phase-1-trust-boundary.md`.
 */
const config: Config = {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
};

export default config;
