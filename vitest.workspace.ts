import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkspace } from "vitest/config";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const workspaceAlias = [
  {
    find: "@codex-mobile/protocol",
    replacement: resolve(ROOT_DIR, "packages/protocol/src/index.ts"),
  },
  {
    find: /^@codex-mobile\/protocol\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/protocol/src/$1.ts"),
  },
  {
    find: "@codex-mobile/auth",
    replacement: resolve(ROOT_DIR, "packages/auth/src/index.ts"),
  },
  {
    find: /^@codex-mobile\/auth\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/auth/src/$1.ts"),
  },
  {
    find: "@codex-mobile/db",
    replacement: resolve(ROOT_DIR, "packages/db/src/index.ts"),
  },
  {
    find: /^@codex-mobile\/db\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/db/src/$1.ts"),
  },
];

/**
 * Codex Mobile Vitest workspace.
 *
 * Project names are part of the Phase 1 validation contract. They are
 * referenced by:
 *   - package.json scripts (`test:phase-01:quick`, `test:phase-01:full`)
 *   - .planning/phases/01-identity-pairing-foundation/01-VALIDATION.md
 *
 * Do not rename `phase-01-unit` without updating every caller.
 */
export default defineWorkspace([
  {
    resolve: {
      alias: workspaceAlias,
    },
    test: {
      name: "phase-01-unit",
      include: [
        "packages/*/src/**/*.test.ts",
        "packages/*/tests/**/*.test.ts",
        "apps/web/tests/unit/**/*.test.ts",
        "apps/relay/tests/unit/**/*.test.ts",
        "apps/bridge/tests/unit/**/*.test.ts",
      ],
      environment: "node",
      passWithNoTests: true,
    },
  },
  {
    resolve: {
      alias: workspaceAlias,
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
    },
    test: {
      name: "phase-03-web",
      include: ["apps/web/tests/unit/**/*.test.tsx"],
      environment: "jsdom",
      setupFiles: ["apps/web/tests/setup.ts"],
      passWithNoTests: true,
    },
  },
]);
