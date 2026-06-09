/**
 * Phase 19, Plan 02, Task 2 — GATE-04 ESLint stdio:"ignore" forbid rule.
 *
 * Programmatic ESLint API test: instantiates ESLint with
 * `overrideConfigFile` pointing at
 * apps/achilles-terminal/eslint.config.js and runs `lintText` against
 * two synthetic fixture strings:
 *
 *   - Forbidden: contains `spawn(cmd, args, { stdio: "ignore" })` —
 *     the v1.2 silent-launch shape. The rule MUST fire and produce
 *     at least one `no-restricted-syntax` message.
 *   - Sanctioned: contains `spawn(cmd, args, { stdio: "inherit" })` —
 *     the v1.3 foreground shape. The rule MUST stay silent (zero
 *     `no-restricted-syntax` messages from this rule).
 *
 * RESEARCH Section Pitfall 8: the AST selector matches the LITERAL
 * `{ stdio: "ignore" }` object form only. The accepted false-negatives
 * (variable indirection, array form like `[ "ignore", "pipe", "pipe" ]`)
 * are documented but NOT covered by this rule.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESLINT_CONFIG = resolve(__dirname, "..", "eslint.config.js");
const SRC_DIR = resolve(__dirname, "..", "src");

/**
 * Build an ESLint instance bound to the workspace eslint.config.js.
 */
function buildEslint(): ESLint {
  return new ESLint({
    cwd: resolve(__dirname, ".."),
    overrideConfigFile: ESLINT_CONFIG,
  });
}

/**
 * Path manager for synthetic fixture files. The tsconfig `include`
 * glob covers `src/**\/*.ts`, so writing a fixture under `src/`
 * lets the type-checked ESLint config pick it up.
 */
const FIXTURE_FORBIDDEN = resolve(SRC_DIR, "__eslint_test_forbidden.ts");
const FIXTURE_SANCTIONED = resolve(SRC_DIR, "__eslint_test_sanctioned.ts");
const FIXTURE_ARRAY = resolve(SRC_DIR, "__eslint_test_array.ts");

const FORBIDDEN_SOURCE = `import { spawn } from "node:child_process";
spawn("rec", [], { stdio: "ignore" });
`;
const SANCTIONED_SOURCE = `import { spawn } from "node:child_process";
spawn("rec", [], { stdio: "inherit" });
`;
const ARRAY_SOURCE = `import { spawn } from "node:child_process";
spawn("rec", [], { stdio: ["pipe", "pipe", "pipe"] });
`;

beforeAll(() => {
  writeFileSync(FIXTURE_FORBIDDEN, FORBIDDEN_SOURCE);
  writeFileSync(FIXTURE_SANCTIONED, SANCTIONED_SOURCE);
  writeFileSync(FIXTURE_ARRAY, ARRAY_SOURCE);
});

afterAll(() => {
  for (const path of [FIXTURE_FORBIDDEN, FIXTURE_SANCTIONED, FIXTURE_ARRAY]) {
    if (existsSync(path)) unlinkSync(path);
  }
});

describe("ESLint stdio:\"ignore\" forbid rule (GATE-04)", () => {
  it("fires on the forbidden shape: spawn(cmd, args, { stdio: \"ignore\" })", async () => {
    const eslint = buildEslint();
    const results = await eslint.lintFiles([FIXTURE_FORBIDDEN]);
    expect(results.length).toBeGreaterThan(0);
    const messages = (results[0]?.messages ?? []).filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it("stays silent on the sanctioned shape: spawn(cmd, args, { stdio: \"inherit\" })", async () => {
    const eslint = buildEslint();
    const results = await eslint.lintFiles([FIXTURE_SANCTIONED]);
    const messages = (results[0]?.messages ?? []).filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(messages.length).toBe(0);
  });

  it("stays silent on the sanctioned array shape: spawn(cmd, args, { stdio: [\"pipe\", \"pipe\", \"pipe\"] })", async () => {
    // RESEARCH Section Pitfall 8 documents this as an accepted false
    // negative for the literal-only selector; the test asserts the rule
    // does NOT fire on the array form (any of pipe/inherit/ignore in an
    // array). We use ["pipe","pipe","pipe"] which is the v1.3 mic-sox
    // shape and must not be flagged.
    const eslint = buildEslint();
    const results = await eslint.lintFiles([FIXTURE_ARRAY]);
    const messages = (results[0]?.messages ?? []).filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(messages.length).toBe(0);
  });
});
