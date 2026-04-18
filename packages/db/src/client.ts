import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export type ControlPlaneDb = PostgresJsDatabase<typeof schema>;

declare global {
  var __codexMobileDb: ControlPlaneDb | undefined;
  var __codexMobileSql: Sql | undefined;
}

function assertNodeRuntime(): void {
  if (typeof process === "undefined" || process.release?.name !== "node") {
    throw new Error("@codex-mobile/db requires a Node.js runtime");
  }
}

export function getDb(): ControlPlaneDb {
  assertNodeRuntime();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!globalThis.__codexMobileSql) {
    globalThis.__codexMobileSql = postgres(connectionString, {
      prepare: false,
    });
  }

  if (!globalThis.__codexMobileDb) {
    globalThis.__codexMobileDb = drizzle(globalThis.__codexMobileSql, {
      schema,
    });
  }

  return globalThis.__codexMobileDb;
}
