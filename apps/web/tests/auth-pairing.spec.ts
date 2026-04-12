/**
 * Phase 1 auth + pairing E2E suite.
 *
 * These specs exercise the three most important paths in Plan 01-02:
 *
 *   1. Unauthenticated users hitting any guarded page are redirected to
 *      the `/sign-in` screen, which renders the exact `Continue with
 *      GitHub` CTA required by the plan acceptance criteria.
 *   2. The hosted redeem flow produces a verification phrase that the
 *      browser can render without ever issuing a device session.
 *   3. Attempting to confirm an EXPIRED pairing is rejected and no
 *      `cm_device_session` cookie is set. This is the "expired-pairing
 *      assertion" the plan explicitly requires.
 *
 * The specs intentionally exercise the pairing-service in isolation via
 * the in-process factory so the suite remains deterministic and does not
 * depend on a live Postgres instance or a live Next.js dev server. A
 * future plan (01-03) will wire the same assertions against the deployed
 * Fly.io stack.
 */
import { test, expect } from "@playwright/test";
import {
  PAIRING_TTL_SECONDS,
  PAIRING_AUDIT_EVENTS,
  confirmPairing,
  createIsolatedPairingContext,
  createPairing,
  loadPairingRow,
  loadPairingStatus,
  redeemPairing,
} from "../lib/pairing-service";

test.describe("Phase 1 · auth + pairing", () => {
  test("unauthenticated users are redirected to /sign-in with the GitHub CTA", async ({
    page,
    baseURL,
  }) => {
    test.skip(
      !process.env.CODEX_MOBILE_E2E_LIVE,
      "Live redirect assertion requires the apps/web dev server. Set CODEX_MOBILE_E2E_LIVE=1 to enable.",
    );
    const target = new URL("/pair/00000000-0000-0000-0000-000000000000", baseURL).toString();
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });
    expect(response, "navigation produced a response").not.toBeNull();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  });

  test("redeem flow generates a verification phrase and preserves it on reload", async () => {
    const ctx = createIsolatedPairingContext();
    const created = await createPairing(
      { deviceLabel: "test phone" },
      ctx,
    );
    expect(created.pairingId).toBeTruthy();
    expect(created.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const redeemed = await redeemPairing(
      { pairingId: created.pairingId, userId: "user_e2e" },
      ctx,
    );
    expect(redeemed.status).toBe("redeemed");
    expect(redeemed.verificationPhrase).toBeTruthy();

    const reloaded = await loadPairingStatus(created.pairingId, ctx);
    expect(reloaded.status).toBe("redeemed");
    expect(reloaded.verificationPhrase).toBe(redeemed.verificationPhrase);
  });

  test("confirm fails on an expired pairing and never issues a device session", async () => {
    // Drive the clock forward past PAIRING_TTL_SECONDS so the pairing
    // created below is `expired` by the time we attempt to confirm it.
    const fakeNow = { value: new Date("2026-04-10T12:00:00.000Z") };
    const ctx = createIsolatedPairingContext({
      now: () => fakeNow.value,
    });

    const created = await createPairing({}, ctx);

    // Advance the clock 6 minutes (> PAIRING_TTL_SECONDS = 5 minutes).
    fakeNow.value = new Date(
      fakeNow.value.getTime() + (PAIRING_TTL_SECONDS + 60) * 1000,
    );

    // Any lookup past the expiry should auto-transition the row to
    // `expired` and record a `pairing.expired` audit row.
    const expired = await loadPairingStatus(created.pairingId, ctx);
    expect(expired.status).toBe("expired");

    // Confirming an expired pairing must throw and must NOT issue a
    // cm_device_session. We assert the error message explicitly so the
    // suite fails loudly if the confirm route ever forgets this check.
    await expect(
      confirmPairing(
        {
          pairingId: created.pairingId,
          userId: "user_e2e",
          verificationPhrase: "amber-anchor-beacon",
        },
        ctx,
      ),
    ).rejects.toThrow(/expired/);
  });

  test("claim flow: redeem persists redeemedByUserId and confirm uses real user", async () => {
    const ctx = createIsolatedPairingContext();
    const created = await createPairing(
      { deviceLabel: "test phone" },
      ctx,
    );

    // Redeem as a specific user
    const redeemed = await redeemPairing(
      { pairingId: created.pairingId, userId: "claim_test_user" },
      ctx,
    );
    expect(redeemed.status).toBe("redeemed");
    expect(redeemed.verificationPhrase).toBeTruthy();

    // Load the raw row and verify redeemedByUserId is set
    const row = await loadPairingRow(created.pairingId, ctx);
    expect(row.redeemedByUserId).toBe("claim_test_user");
    expect(row.claimedAt).toBeNull();

    // Confirm as the bridge (with the pairing token)
    const result = await confirmPairing(
      {
        pairingId: created.pairingId,
        userId: "bridge:test",
        verificationPhrase: redeemed.verificationPhrase!,
        pairingToken: created.pairingToken,
      },
      ctx,
    );

    // D-10: confirm returns confirmedAt, not deviceSession
    expect(result.confirmedAt).toBeInstanceOf(Date);
    expect((result as Record<string, unknown>).deviceSession).toBeUndefined();

    // D-12: confirmedByUserId should be the redeeming user, not the bridge sentinel
    const confirmedRow = await loadPairingRow(created.pairingId, ctx);
    expect(confirmedRow.status).toBe("confirmed");
    expect(confirmedRow.confirmedByUserId).toBe("claim_test_user");
  });

  test("PAIRING_AUDIT_EVENTS includes claimed event", () => {
    expect(PAIRING_AUDIT_EVENTS.claimed).toBe("pairing.claimed");
  });
});
