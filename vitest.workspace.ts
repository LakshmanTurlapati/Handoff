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
  {
    find: "@achilles/claude-code-bridge",
    replacement: resolve(ROOT_DIR, "packages/claude-code-bridge/src/index.ts"),
  },
  {
    find: /^@achilles\/claude-code-bridge\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/claude-code-bridge/src/$1.ts"),
  },
  // v1.2 phase-12 addition: @achilles/achilles-skill aliases. The
  // literal points at the barrel that exports the resolved
  // companionPromptPath + SKILL_PROMPTS_DIR strings; the regex glob
  // covers any future submodule import (Phase 13 install-skill helpers
  // may live under @achilles/achilles-skill/<submodule>).
  {
    find: "@achilles/achilles-skill",
    replacement: resolve(ROOT_DIR, "packages/achilles-skill/src/index.ts"),
  },
  {
    find: /^@achilles\/achilles-skill\/(.+)$/,
    replacement: resolve(ROOT_DIR, "packages/achilles-skill/src/$1.ts"),
  },
  // v1.2 phase-11 addition: apps/achilles aliases. The literal points at
  // the constants barrel; the four subpath regexes rewrite to the
  // matching src/* tree so the renderer + main + preload + shared
  // modules can be imported by the test runner without bundling.
  {
    find: "@achilles/app",
    replacement: resolve(ROOT_DIR, "apps/achilles/src/shared/constants.ts"),
  },
  {
    find: /^@achilles\/app\/main\/(.+)$/,
    replacement: resolve(ROOT_DIR, "apps/achilles/src/main/$1.ts"),
  },
  {
    find: /^@achilles\/app\/preload\/(.+)$/,
    replacement: resolve(ROOT_DIR, "apps/achilles/src/preload/$1.ts"),
  },
  {
    find: /^@achilles\/app\/renderer\/(.+)$/,
    replacement: resolve(ROOT_DIR, "apps/achilles/src/renderer/$1.ts"),
  },
  {
    find: /^@achilles\/app\/shared\/(.+)$/,
    replacement: resolve(ROOT_DIR, "apps/achilles/src/shared/$1.ts"),
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
  {
    resolve: {
      alias: workspaceAlias,
    },
    test: {
      name: "phase-10-unit",
      include: ["packages/claude-code-bridge/src/**/*.test.ts"],
      environment: "node",
      passWithNoTests: true,
    },
  },
  {
    resolve: {
      alias: workspaceAlias,
    },
    esbuild: {
      // v1.2 phase-11-02 addition: renderer component tests (.test.tsx)
      // need JSX automatic runtime so React does not have to be imported
      // explicitly. The phase-11-unit project's environment defaults to
      // node; per-file `// @vitest-environment jsdom` docblocks opt
      // individual component tests into the DOM.
      jsx: "automatic",
      jsxImportSource: "react",
    },
    test: {
      name: "phase-11-unit",
      include: [
        "apps/achilles/src/**/*.test.ts",
        "apps/achilles/src/**/*.test.tsx",
      ],
      environment: "node",
      passWithNoTests: true,
    },
  },
  {
    // v1.2 phase-12 project. Includes (a) Plan 12-01 deliverables — the
    // @achilles/achilles-skill package tests (path resolution +
    // companion.md content contract) — and (b) Plan 12-02 deliverables
    // (sandwich-defence + normalisation main-process modules). Plans
    // 12-03 and 12-04 extend this list with session.test.ts and the
    // renderer audio test tree.
    resolve: {
      alias: workspaceAlias,
    },
    test: {
      name: "phase-12-unit",
      include: [
        "packages/achilles-skill/src/**/*.test.ts",
        "apps/achilles/src/main/sandwich-defence.test.ts",
        "apps/achilles/src/main/normalisation.test.ts",
        "apps/achilles/src/main/session.test.ts",
        "apps/achilles/src/renderer/audio/**/*.test.ts",
        // Plan 12-04 additions: key-source, mock-loop-clients, and the
        // Plan 11 modules extended by 12-04 (store + state-machine +
        // ipc-bridge). The Phase 11 patterns already pick these last
        // three up — Plan 12-04's explicit listing here keeps the
        // verification command (which targets the file by path)
        // unambiguous about which project owns them.
        "apps/achilles/src/main/key-source.test.ts",
        "apps/achilles/src/main/mock-loop-clients.test.ts",
        "apps/achilles/src/main/store.test.ts",
        "apps/achilles/src/main/state-machine.test.ts",
        "apps/achilles/src/main/ipc-bridge.test.ts",
        // Plan 12-04 MOCK_LOOP=1 integration test (skips when env unset).
        "apps/achilles/test/integration/**/*.test.ts",
      ],
      environment: "node",
      passWithNoTests: true,
    },
  },
]);
// v1.2 phase-09 addition: workspace aliases + phase-09-unit project for the
// "@achilles/voice-protocol", "@achilles/voice-stt", and "@achilles/voice-tts" packages.
// v1.2 phase-10 addition: workspace aliases + phase-10-unit project for @achilles/claude-code-bridge.
// v1.2 phase-11 addition: workspace aliases + phase-11-unit project for the
// "@achilles/app" Electron app (apps/achilles/src/**/*.test.ts(x)). The
// project runs in the node environment because the Phase 11 vitest tests
// are pure helpers + injected-stub seams; the Playwright suite drives
// the rendered DOM separately.
