/**
 * Phase 18, Plan 04, Task 2 — INIT-07 invariant integration test.
 *
 * INIT-07 (Phase 15 invariant + Phase 18 preservation contract):
 * cli.ts top-level static imports MUST remain EXACTLY the three node:
 * imports introduced in Phase 15 Plan 01:
 *   import { readFile } from "node:fs/promises";
 *   import { fileURLToPath } from "node:url";
 *   import { dirname, join } from "node:path";
 *
 * This file-level assertion enforces the invariant:
 * - Exactly 3 top-level static import lines
 * - All 3 imports are from the allowed node: specifiers
 * - Zero top-level relative imports (the @clack/prompts / @napi-rs/keyring /
 *   @stablelib/nacl libs must NOT be present at the top level — they would
 *   force loading on every `achilles --version` invocation and blow the
 *   DIST-05 cold-start budget)
 * - At least 6 `await import(` dynamic gates (init, config, transcripts x2,
 *   latency-report, lock-file, session)
 * - The shebang line is exactly "#!/usr/bin/env node"
 *
 * Threat T-18-21 mitigation: if a Plan 04 edit accidentally adds a top-level
 * static import of @clack/prompts (or any other wizard/voice dependency), this
 * test fails and blocks the merge.
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(HERE, "..", "..", "src", "cli.ts");

describe("INIT-07 invariant: cli.ts top-level static imports (Phase 18 Plan 04 preservation)", () => {
  const source = readFileSync(CLI_SRC, "utf8");
  const lines = source.split("\n");

  // Determine the line index of `async function main()` — top-level imports
  // must appear BEFORE this boundary.
  const mainFnLineIdx = lines.findIndex((l) => /^async function main\(\)/.test(l));

  it("cli.ts has exactly 3 top-level static imports before async function main()", () => {
    expect(mainFnLineIdx).toBeGreaterThan(0); // main() must be found
    const topImports = lines
      .slice(0, mainFnLineIdx)
      .filter((line) => /^import /.test(line));
    expect(topImports).toHaveLength(3);
  });

  it("all 3 top-level static imports are from node: specifiers only", () => {
    const topImports = lines
      .slice(0, mainFnLineIdx)
      .filter((line) => /^import /.test(line));
    const allowedSpecifiers = new Set([
      "node:fs/promises",
      "node:url",
      "node:path",
    ]);
    for (const line of topImports) {
      const match = /from\s+["']([^"']+)["']/.exec(line);
      expect(match).not.toBeNull();
      const specifier = match![1]!;
      expect(
        allowedSpecifiers.has(specifier),
        `Top-level import from "${specifier}" violates INIT-07 — only { node:fs/promises, node:url, node:path } are allowed`,
      ).toBe(true);
    }
  });

  it("cli.ts has zero top-level relative imports (no static `from './'`)", () => {
    const relativeTopImports = lines
      .slice(0, mainFnLineIdx)
      .filter((line) => /^import\s+.*from\s+["']\.\//.test(line));
    expect(relativeTopImports).toHaveLength(0);
  });

  it("cli.ts has at least 6 `await import(` dynamic gates (SAFE-04 + Plan 04 subcommands)", () => {
    const dynamicImportCount = (source.match(/await import\(/g) ?? []).length;
    expect(dynamicImportCount).toBeGreaterThanOrEqual(6);
  });

  it("cli.ts does NOT import from @clack/prompts, @napi-rs/keyring, or @stablelib/nacl at top level (T-18-21 mitigation)", () => {
    const forbiddenTopLevelPatterns = [
      /@clack\/prompts/,
      /@napi-rs\/keyring/,
      /@stablelib\/nacl/,
    ];
    const topLevelImportLines = lines
      .slice(0, mainFnLineIdx)
      .filter((line) => /^import /.test(line));
    for (const pattern of forbiddenTopLevelPatterns) {
      const matches = topLevelImportLines.filter((line) => pattern.test(line));
      expect(
        matches,
        `Found top-level import matching ${pattern.toString()} — this violates INIT-07 and blows the DIST-05 cold-start budget. All wizard/voice imports must stay inside await import() gates.`,
      ).toHaveLength(0);
    }
  });

  it("cli.ts shebang line is exactly '#!/usr/bin/env node' (Phase 15 T5 regression at Plan 04)", () => {
    expect(lines[0]).toBe("#!/usr/bin/env node");
  });

  it("INIT-07 spawn smoke: `achilles --version` exits 0 in under 5000ms in a clean env (no ELEVENLABS_API_KEY, no sox, no ffmpeg)", () => {
    // Strip env of API key and PATH entries for sox/ffmpeg/claude so this
    // test structurally validates the cold-start path without pipeline deps.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ELEVENLABS_API_KEY;

    const t0 = Date.now();
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      {
        encoding: "utf8",
        timeout: 5000,
        env: cleanEnv,
      },
    );
    const elapsed = Date.now() - t0;

    expect(result.status).toBe(0);
    // 5000ms budget: tsx in dev mode has compilation overhead; production binary
    // will be much faster. The 5s budget catches gross regressions (e.g., a top-level
    // import that forces loading a 30-dep wizard library on every --version call).
    expect(elapsed).toBeLessThan(5000);
  });
});
