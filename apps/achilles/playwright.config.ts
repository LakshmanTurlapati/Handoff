/**
 * Playwright configuration for apps/achilles.
 *
 * CRITICAL: this configuration NEVER launches Electron. Per CONTEXT.md
 * test strategy and the CLAUDE.md global "never run applications
 * automatically" rule, the e2e suite drives the headless Vite preview
 * of the renderer bundle directly. Real Electron is reserved for
 * manual / opt-in dev runs (`npm run dev` inside this workspace).
 *
 * Wired against:
 *   - npm --workspace @achilles/app run build:renderer:headless
 *     → produces a renderer bundle that auto-injects MockAchillesBridge
 *       on window before the renderer's main.tsx hydrates.
 *   - npm --workspace @achilles/app run preview:renderer:headless
 *     → vite preview on port 5174.
 *
 * Viewport is locked at 260x260 to match the BrowserWindow contract
 * exactly. Playwright tests assume the renderer is laid out within
 * those bounds.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 260, height: 260 },
    trace: "retain-on-failure",
  },
  webServer: {
    // Build the headless renderer bundle, then serve it via vite preview
    // on port 5174. The bundle includes mock-bridge.ts as the test seam.
    // We chain build + preview because Playwright only knows about one
    // command per webServer block; the build step is idempotent.
    command:
      "npm --workspace @achilles/app run build:renderer:headless && npm --workspace @achilles/app run preview:renderer:headless",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "achilles-renderer",
      testMatch: "**/*.spec.ts",
    },
  ],
});
