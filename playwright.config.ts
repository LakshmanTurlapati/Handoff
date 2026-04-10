import { defineConfig, devices } from "@playwright/test";

/**
 * Codex Mobile Playwright configuration.
 *
 * Project names are part of the Phase 1 validation contract and are
 * referenced by `npm run test:phase-01:full` and
 * `.planning/phases/01-identity-pairing-foundation/01-VALIDATION.md`.
 *
 * The `phase-01-e2e-mobile` project intentionally targets a phone-sized
 * viewport because Codex Mobile is a phone-first product and the mobile
 * pairing flow is the primary end-to-end path Phase 1 must validate.
 *
 * Do not rename `phase-01-e2e-mobile` without updating every caller.
 */
export default defineConfig({
  testDir: "./",
  testMatch: [
    "apps/web/tests/e2e/**/*.spec.ts",
    "apps/web/tests/*.spec.ts",
    "apps/relay/tests/e2e/**/*.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "phase-01-e2e-mobile",
      use: {
        ...devices["iPhone 14"],
      },
    },
  ],
});
