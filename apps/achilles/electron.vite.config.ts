/**
 * electron-vite + vite configuration for apps/achilles.
 *
 * This file does double duty:
 *
 *   1. `electron-vite dev` / `electron-vite build` consume the default
 *      `defineConfig` export — three named entries: main, preload,
 *      renderer (production). This is the canonical app build.
 *
 *   2. `vite build --mode headless` and `vite preview --mode headless`
 *      consume the same file (vite reads the default export and treats
 *      the renderer block as its config). The `headless` mode injects
 *      the MockAchillesBridge entry so Playwright drives the renderer
 *      bundle without launching Electron at all. This satisfies the
 *      CONTEXT.md test strategy and the CLAUDE.md global "never run
 *      applications automatically" rule.
 *
 * Locked dev-server ports:
 *   - 5173 → electron-vite renderer dev server (real Electron host)
 *   - 5174 → headless preview server (Playwright)
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: resolve(PROJECT_ROOT, "out/main"),
      lib: {
        entry: resolve(PROJECT_ROOT, "src/main/index.ts"),
        formats: ["es"],
      },
      rollupOptions: {
        external: ["electron", "electron-store"],
      },
      sourcemap: true,
      minify: false,
    },
    resolve: {
      alias: {
        "@achilles/app/shared": resolve(PROJECT_ROOT, "src/shared"),
        "@achilles/app/main": resolve(PROJECT_ROOT, "src/main"),
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(PROJECT_ROOT, "out/preload"),
      lib: {
        // Electron's preload context isolation requires CommonJS so the
        // sandboxed runtime can synchronously load the script before the
        // renderer's JS environment exists. ES module preloads are
        // accepted on recent Electron but cjs is still the safe default.
        entry: resolve(PROJECT_ROOT, "src/preload/index.ts"),
        formats: ["cjs"],
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          entryFileNames: "[name].js",
        },
      },
      sourcemap: true,
      minify: false,
    },
    resolve: {
      alias: {
        "@achilles/app/shared": resolve(PROJECT_ROOT, "src/shared"),
      },
    },
  },
  renderer: {
    root: resolve(PROJECT_ROOT, "src/renderer"),
    plugins: [react()],
    server: {
      port: 5173,
    },
    preview: {
      port: 5174,
    },
    build: {
      outDir: resolve(PROJECT_ROOT, "out/renderer"),
      sourcemap: true,
      rollupOptions: {
        input: resolve(PROJECT_ROOT, "src/renderer/index.html"),
      },
    },
    resolve: {
      alias: {
        "@achilles/app/shared": resolve(PROJECT_ROOT, "src/shared"),
        "@achilles/app/renderer": resolve(PROJECT_ROOT, "src/renderer"),
      },
    },
    // The `mode === 'headless'` toggle is consumed when the same file is
    // loaded by plain vite (build:renderer:headless / preview). In
    // headless mode we inject the mock-bridge entry as an additional
    // module in index.html via a vite plugin pattern. The mock-bridge
    // attaches window.__mockBridge BEFORE the renderer's main.tsx
    // mounts, so renderer/bridge.ts sees the test seam.
    define: {
      __ACHILLES_HEADLESS__: JSON.stringify(false),
    },
  },
});
