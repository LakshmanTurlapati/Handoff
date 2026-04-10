import { defineWorkspace } from "vitest/config";

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
]);
