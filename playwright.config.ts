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
 *
 * v1.2 phase-11 addition: the `achilles-renderer` project drives the
 * apps/achilles headless Vite renderer bundle (NOT real Electron — per
 * CONTEXT.md test strategy and the CLAUDE.md global "never run
 * applications automatically" rule). The webServer command builds the
 * headless bundle and serves it via `vite preview` on port 5174; the
 * viewport is locked to 260x260 to match the BrowserWindow contract.
 */
export default defineConfig({
  testDir: "./",
  testMatch: [
    "apps/web/tests/e2e/**/*.spec.ts",
    "apps/web/tests/*.spec.ts",
    "apps/relay/tests/e2e/**/*.spec.ts",
    "apps/achilles/test/e2e/**/*.spec.ts",
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
  webServer: [
    {
      // Phase 11 — headless renderer bundle for the achilles-renderer
      // project. The webServer block is a Playwright array so it does
      // not collide with the other projects' server expectations; if
      // those projects are not being run, this server still gets
      // spun up before achilles-renderer specs execute.
      command:
        "npm --workspace @achilles/app run build:renderer:headless && npm --workspace @achilles/app run preview:renderer:headless",
      port: 5174,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: "phase-01-e2e-mobile",
      use: {
        ...devices["iPhone 14"],
      },
      testMatch: [
        "apps/web/tests/e2e/**/*.spec.ts",
        "apps/web/tests/*.spec.ts",
        "apps/relay/tests/e2e/**/*.spec.ts",
      ],
    },
    {
      name: "achilles-renderer",
      testDir: "./apps/achilles/test/e2e",
      testMatch: "**/*.spec.ts",
      use: {
        baseURL: "http://localhost:5174",
        viewport: { width: 260, height: 260 },
        trace: "retain-on-failure",
      },
    },
  ],
});
