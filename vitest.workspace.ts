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
  {
    find: "@achilles/voice-protocol",
    replacement: resolve(ROOT_DIR, "packages/voice-protocol/src/index.ts"),
  },
  {
    find: /^@achilles\/voice-protocol\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/voice-protocol/src/$1.ts"),
  },
  {
    find: "@achilles/voice-stt",
    replacement: resolve(ROOT_DIR, "packages/voice-stt/src/index.ts"),
  },
  {
    find: /^@achilles\/voice-stt\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/voice-stt/src/$1.ts"),
  },
  {
    find: "@achilles/voice-tts",
    replacement: resolve(ROOT_DIR, "packages/voice-tts/src/index.ts"),
  },
  {
    find: /^@achilles\/voice-tts\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/voice-tts/src/$1.ts"),
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
 *
 * WR-10 note: `passWithNoTests: true` is set on each project's `test`
 * config. The flag works at runtime (verified by running each project
 * with an empty include glob) but the `defineWorkspace` `ProjectConfig`
 * type in Vitest 2.x does not declare it directly, only on the deeper
 * `ResolvedConfig` (see node_modules/vitest/dist/chunks/config.*.d.ts).
 * This is a pre-existing type gap tracked in
 * .planning/phases/09-voice-vendor-wrappers/deferred-items.md and is
 * the cleanest expression site — moving it to the CLI invocation would
 * scatter the configuration across multiple package.json scripts.
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
  {
    resolve: {
      alias: workspaceAlias,
    },
    test: {
      name: "phase-09-unit",
      include: [
        "packages/voice-protocol/src/**/*.test.ts",
        "packages/voice-stt/src/**/*.test.ts",
        "packages/voice-tts/src/**/*.test.ts",
      ],
      environment: "node",
      passWithNoTests: true,
    },
  },
]);
// v1.2 phase-09 addition: workspace aliases + phase-09-unit project for the
// "@achilles/voice-protocol", "@achilles/voice-stt", and "@achilles/voice-tts" packages.
