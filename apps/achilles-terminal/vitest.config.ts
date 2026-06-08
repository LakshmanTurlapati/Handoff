import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Phase 15 vitest seed config + Plan 16-03 resolve aliases (D-16-03-01).
//
// pool: "forks" is required per Pitfall 9 (Bun + vitest "threads" pool emits
// node:worker_threads partial-support warnings that clutter CI logs). The
// "forks" pool spawns one child process per test file, sidestepping the
// worker_threads surface entirely. Both Node 22 and Bun 1.3 honour the
// fork-per-file model, so the dual-runtime CI matrix in Plan 04 verifies the
// same shape under both runtimes.
//
// resolve.alias (D-16-03-01 — Plan 16-03 Task 1 deviation):
//
// npm 10.9.3 hoists ink-testing-library to the workspace-root node_modules
// (no chalk peer conflict) but keeps ink at apps/achilles-terminal/node_modules
// because ink@7's chalk@5 peer conflicts with root's chalk@4 (used by other
// workspace packages). The repo root also has react@19.2.4 pinned by apps/web
// (Next.js) + apps/achilles (legacy Electron) while apps/achilles-terminal
// pins react@19.2.7 (Ink 7's peer). Two React copies in the same process
// produce "Invalid hook call" errors inside ink-testing-library's render().
//
// The aliases below redirect ALL package imports to the workspace-local copies
// at vitest's transform layer. The pretest hook (scripts/link-ink.mjs) also
// nests ink-testing-library under apps/achilles-terminal/node_modules so the
// native ESM resolver finds the same physical files when transitively
// resolving inside ink/ink-testing-library themselves.
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_REACT = resolve(__dirname, "node_modules", "react");
const WORKSPACE_REACT_JSX_RUNTIME = resolve(
  __dirname,
  "node_modules",
  "react",
  "jsx-runtime.js",
);
const WORKSPACE_INK = resolve(__dirname, "node_modules", "ink");
const WORKSPACE_INK_TESTING = resolve(
  __dirname,
  "node_modules",
  "ink-testing-library",
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: WORKSPACE_REACT_JSX_RUNTIME },
      { find: /^react$/, replacement: WORKSPACE_REACT },
      { find: /^ink$/, replacement: WORKSPACE_INK },
      { find: /^ink-testing-library$/, replacement: WORKSPACE_INK_TESTING },
    ],
  },
  esbuild: {
    // JSX automatic runtime: lets .tsx files use JSX without explicit
    // `import React from "react"` and lets `_jsx` calls resolve through
    // the alias above to the workspace-local react/jsx-runtime.
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
