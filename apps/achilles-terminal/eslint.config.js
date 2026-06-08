// Phase 15 ESLint flat config baseline (lint half of GATE-04).
// typescript-eslint recommended-type-checked is enabled across the workspace;
// prettier MUST be last so it can disable any stylistic rules that would
// otherwise conflict with the formatter.
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // Type-checked rules apply only to TS source + tests covered by tsconfig.json.
  // Loose JS/MJS config + scripts get untyped recommended only — they are not in
  // the typecheck project graph.
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Slot for Phase 19 GATE-04 rule: forbid `stdio: "ignore"` on the launch path.
      // Phase 15 leaves this empty; Phase 19 adds the no-restricted-syntax rule:
      //   "no-restricted-syntax": [
      //     "error",
      //     {
      //       selector: "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
      //       message: "stdio:'ignore' is forbidden on the launch path (GATE-04)",
      //     },
      //   ],
      //
      // Rationale: the v1.2 CLI used `stdio: "ignore"` when spawning the Electron
      // child (apps/achilles-cli/src/commands/launch.ts:155) which is what hid the
      // renderer-loop-never-wired silent-launch failure from the user. v1.3 runs
      // foreground with `stdio: "inherit"`; the lint rule above structurally
      // prevents a future regression to the v1.2 shape.

      // Phase 15 baseline: no extra rules beyond typescript-eslint recommended-type-checked.
    },
  },
  // Untyped recommended for plain JS/MJS config + script files (outside tsconfig project).
  {
    files: ["*.js", "*.mjs", "scripts/**/*.mjs", "src/**/*.js", "vitest.config.ts"],
    extends: tseslint.configs.recommended,
  },
  prettier, // MUST be last - disables ESLint rules that conflict with prettier
  {
    ignores: ["dist", "node_modules", "**/*.cjs"],
  },
);
