/**
 * CR-GAP-01 regression test: POST /api/pairings/[id]/confirm must
 * require only an `Authorization: Bearer <pairingToken>` header and
 * must NOT call auth() anymore.
 *
 * Why this test is necessary even though we already have
 * `middleware-public-paths.test.ts`:
 *   - The middleware test proves middleware lets the request through.
 *   - This test proves the ROUTE HANDLER itself enforces the bearer
 *     gate and that a future refactor cannot silently reintroduce the
 *     Auth.js cookie check without breaking this assertion.
 *
 * The file-level grep assertion (Test C) pins CR-GAP-01 by reading
 * the route file source and asserting the `auth()` import path is
 * absent. This is intentional belt-and-braces: the functional test
 * (Test A + B) catches the runtime behavior, and the grep test
 * catches the upstream import that would re-enable cookie auth.
 *
 * Runs under `phase-01-unit` via the `apps/web/tests/unit/**`
 * include glob in vitest.workspace.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { POST } from "../../app/api/pairings/[pairingId]/confirm/route";

// Resolve the route file path relative to this test file so the grep
// assertion does not depend on the process CWD.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(
  TEST_DIR,
  "../../app/api/pairings/[pairingId]/confirm/route.ts",
);

describe("POST /api/pairings/[id]/confirm · CR-GAP-01 bearer gate", () => {
  it("returns 401 missing_pairing_token when the Authorization header is absent", async () => {
    const req = new Request(
      "http://localhost:3000/api/pairings/abc-123/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verificationPhrase: "amber anchor beacon" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ pairingId: "abc-123" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing_pairing_token");
  });

  it("returns 401 missing_pairing_token when the Authorization header is present but not a Bearer prefix", async () => {
    const req = new Request(
      "http://localhost:3000/api/pairings/abc-123/confirm",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Basic c29tZXRoaW5n",
        },
        body: JSON.stringify({ verificationPhrase: "amber anchor beacon" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ pairingId: "abc-123" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing_pairing_token");
  });

  it("route file source no longer imports auth() nor calls it (CR-GAP-01 pin)", () => {
    const source = readFileSync(ROUTE_PATH, "utf8");
    // No import from the Auth.js wrapper module at the root.
    expect(source).not.toMatch(/from\s+"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/auth"/);
    // No runtime call to auth() anywhere in the handler body.
    expect(source).not.toMatch(/await\s+auth\(\)/);
    // Sanity: the bearer error string IS still present.
    expect(source).toContain("missing_pairing_token");
    // Sanity: the sentinel userId derivation IS still present.
    expect(source).toContain("pairing-bearer:");
  });
});
