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
    files: [
      "src/**/*.ts",
      "src/**/*.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
    ],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // GATE-04 (Phase 19 Plan 02 Task 2): forbid the literal
      // `{ stdio: "ignore" }` shape on the launch path. The v1.2 CLI
      // used `stdio: "ignore"` when spawning the Electron child
      // (apps/achilles-cli/src/commands/launch.ts:155) which is what
      // hid the renderer-loop-never-wired silent-launch failure from
      // the user. v1.3 runs foreground with `stdio: "inherit"`; this
      // lint rule structurally prevents a regression to the v1.2 shape.
      //
      // Pitfall 8 (19-RESEARCH.md): the selector is LITERAL-only. It
      // matches `spawn(cmd, args, { stdio: "ignore" })` but does NOT
      // match the array form `spawn(cmd, args, { stdio: ["ignore", ...] })`
      // (legitimate when only stdin is silenced) nor variable
      // indirection (`const opts = { stdio: "ignore" }; spawn(..., opts)`).
      // The accepted false-negatives are documented; the locked rule
      // catches the v1.2 anti-pattern verbatim and is the smallest AST
      // selector that does not produce false-positives on the v1.3
      // sox/ffplay shapes.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ObjectExpression > Property[key.name='stdio'][value.value='ignore']",
          message:
            "stdio:'ignore' is forbidden on the launch path (GATE-04)",
        },
      ],
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
