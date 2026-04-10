/**
 * Regression tests for the GET /api/pairings/[pairingId] status handler
 * (Plan 01-04, closes the missing-handler gap documented in
 * .planning/phases/01-identity-pairing-foundation/01-VERIFICATION.md).
 *
 * Test E: a freshly created pending pairing can be read back through the
 *         GET handler and the response parses cleanly against
 *         PairingStatusResponseSchema from @codex-mobile/protocol.
 *
 * Test F: an unknown pairingId yields 404 with body
 *         { error: "pairing_not_found" } — the server does NOT leak the
 *         raw `pairing_session {id} not found` string.
 *
 * The GET route calls `loadPairingStatus(pairingId)` WITHOUT a custom
 * context, which means it uses the module-level `defaultPairingStore`.
 * Test E creates the pairing via the same `createPairing` helper, also
 * without a context, so the two calls share the same in-memory store.
 * This is acceptable inside `phase-01-unit` because each test file runs
 * in its own module scope; if Vitest ever switches to a shared-module
 * worker the test would need its own isolated store, which is why Test E
 * uses a unique deviceLabel so concurrent runs do not collide on lookup.
 *
 * Run via `npm run test:phase-01:quick` — Vitest workspace project
 * `phase-01-unit` picks up this file via the `apps/web/tests/unit/**`
 * include glob in vitest.workspace.ts.
 */
import { describe, it, expect } from "vitest";
import { PairingStatusResponseSchema } from "@codex-mobile/protocol";
import { GET } from "../../app/api/pairings/[pairingId]/route";
import { createPairing } from "../../lib/pairing-service";

describe("GET /api/pairings/[pairingId] · status handler", () => {
  it("returns a protocol-validated PairingStatusResponse for a pending pairing", async () => {
    const created = await createPairing({
      deviceLabel: "phase-01-04-test-phone",
    });

    const req = new Request(
      `http://localhost:3000/api/pairings/${created.pairingId}`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ pairingId: created.pairingId }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    const parsed = PairingStatusResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.pairingId).toBe(created.pairingId);
      expect(parsed.data.status).toBe("pending");
      expect(parsed.data.expiresAt).toBe(created.expiresAt);
    }
  });

  it("returns 404 { error: 'pairing_not_found' } for an unknown pairingId", async () => {
    const req = new Request(
      "http://localhost:3000/api/pairings/00000000-0000-0000-0000-000000000000",
    );
    const res = await GET(req, {
      params: Promise.resolve({
        pairingId: "00000000-0000-0000-0000-000000000000",
      }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("pairing_not_found");
    // Defense in depth: the raw internal message ("pairing_session ... not
    // found") must NOT be echoed to the unauthenticated caller.
    expect(JSON.stringify(body)).not.toContain("pairing_session");
  });

  it("returns 400 { error: 'missing_pairing_id' } when the param is empty", async () => {
    const req = new Request("http://localhost:3000/api/pairings/");
    const res = await GET(req, {
      params: Promise.resolve({ pairingId: "" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("missing_pairing_id");
  });
});
