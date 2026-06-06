/**
 * Plain vite config for the headless renderer bundle.
 *
 * Used by `build:renderer:headless` and `preview:renderer:headless` to
 * produce a static bundle Playwright can drive without launching
 * Electron at all. The bundle's entry HTML lives at
 * `test/mocks/index.html` and pre-injects `mock-bridge.ts` so
 * `window.__mockBridge` is populated before `main.tsx` mounts.
 *
 * This separate config exists because `electron-vite` is purpose-built
 * for the Electron main+preload+renderer triple and does not have a
 * clean "skip the main process, please" mode. A plain vite config is
 * smaller and harder to misconfigure.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(PROJECT_ROOT, "test/mocks"),
  // Phase 11 Plan 11-02 update: define a build-time constant so the
  // renderer code can branch on `import.meta.env.MODE` to expose the
  // `__achilles_debug` test seam (Plan 11-02 e2e WAVEFORM spec asserts
  // analyser.frequencyBinCount === 32 via this seam). Vite's tree-shaker
  // strips the branch in any build that does NOT set this constant.
  define: {
    "import.meta.env.MODE": JSON.stringify("headless"),
  },
  build: {
    outDir: resolve(PROJECT_ROOT, "out/renderer-headless"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(PROJECT_ROOT, "test/mocks/index.html"),
    },
  },
  preview: {
    port: 5174,
    host: true,
    strictPort: true,
  },
  server: {
    port: 5174,
  },
});
