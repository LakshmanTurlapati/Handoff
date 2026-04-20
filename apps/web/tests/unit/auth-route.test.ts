/**
 * Regression test for the Auth.js App Router mount.
 *
 * Importing `next-auth` directly under the current Vitest/node setup hits a
 * `next/server` resolution mismatch, so this test stays source-level. Its job
 * is to fail loudly if the catch-all route file disappears or stops
 * re-exporting the handlers from `apps/web/auth.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(
  TEST_DIR,
  "../../app/api/auth/[...nextauth]/route.ts",
);

describe("Auth.js route mount", () => {
  it("declares the catch-all auth route and re-exports GET and POST from auth.ts", () => {
    const source = readFileSync(ROUTE_PATH, "utf8");
    expect(source).toContain('export { GET, POST } from "../../../../auth";');
  });
});
