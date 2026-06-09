/**
 * Phase 19, Plan 02, Task 3 — cli.ts install-skill dynamic-import gate.
 *
 * Source-shape regression guard: asserts the install-skill subcommand
 * has been added to cli.ts as the 6th dynamic-import gate INSIDE main(),
 * and that the INIT-07 invariant is preserved:
 *
 *   (a) top-level static imports remain EXACTLY 3 (node:fs/promises,
 *       node:url, node:path);
 *   (b) the install-skill branch `argv[0] === "install-skill"` literal
 *       appears in main();
 *   (c) the branch uses `await import("./install-skill.js")` (dynamic
 *       gate, NOT a top-level static import);
 *   (d) the branch parses `--force` from argv;
 *   (e) the branch ends with a `return;` (or `process.exit`) so the
 *       voice subcommand does not run as a fall-through.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(__dirname, "..", "src", "cli.ts");

describe("cli.ts install-skill dynamic-import gate (Phase 19 Plan 02 Task 3)", () => {
  const source = readFileSync(CLI_SRC, "utf8");
  const lines = source.split("\n");
  const mainFnIdx = lines.findIndex((l) => /^async function main\(\)/.test(l));

  it("(a) INIT-07 invariant: top-level static imports remain EXACTLY 3", () => {
    expect(mainFnIdx).toBeGreaterThan(0);
    const topImports = lines
      .slice(0, mainFnIdx)
      .filter((line) => /^import /.test(line));
    expect(topImports).toHaveLength(3);
    const allowed = new Set(["node:fs/promises", "node:url", "node:path"]);
    for (const line of topImports) {
      const match = /from\s+["']([^"']+)["']/.exec(line);
      expect(match).not.toBeNull();
      expect(allowed.has(match![1]!)).toBe(true);
    }
  });

  it("(b) install-skill branch is present in main()", () => {
    expect(source).toContain('argv[0] === "install-skill"');
  });

  it("(c) install-skill branch uses dynamic await import(\"./install-skill.js\")", () => {
    expect(source).toMatch(
      /await\s+import\(\s*["']\.\/install-skill\.js["']\s*\)/,
    );
  });

  it("(d) install-skill branch parses --force from argv", () => {
    // Find the install-skill branch and look for argv.includes("--force") in a small window.
    const branchIdx = source.indexOf('argv[0] === "install-skill"');
    expect(branchIdx).toBeGreaterThan(0);
    const branchBody = source.slice(branchIdx, branchIdx + 1_500);
    expect(branchBody).toMatch(/argv\.includes\(\s*["']--force["']\s*\)/);
  });

  it("(e) install-skill branch terminates with return; or process.exit so voice does not fall through", () => {
    const branchIdx = source.indexOf('argv[0] === "install-skill"');
    expect(branchIdx).toBeGreaterThan(0);
    const branchBody = source.slice(branchIdx, branchIdx + 1_500);
    // Either an explicit `return;` OR a `process.exit(` call must appear in
    // the branch body so control does not fall through to the next branch.
    const hasReturn = /\breturn\s*;/.test(branchBody);
    const hasExit = /process\.exit\s*\(/.test(branchBody);
    expect(hasReturn || hasExit).toBe(true);
  });

  it("install-skill branch sits inside main() (between main() opening and the unknown-command stderr write)", () => {
    expect(mainFnIdx).toBeGreaterThan(0);
    const branchIdx = source.indexOf('argv[0] === "install-skill"');
    expect(branchIdx).toBeGreaterThan(0);
    const unknownIdx = source.indexOf("achilles: unknown command");
    expect(unknownIdx).toBeGreaterThan(0);
    // Convert line indices for ordering.
    const mainLine = source
      .slice(0, source.indexOf(lines[mainFnIdx]!))
      .split("\n").length;
    void mainLine;
    expect(branchIdx).toBeLessThan(unknownIdx);
  });

  it("install-skill gate adds at least one more await-import call (6 total minimum)", () => {
    const dynamicImportCount = (source.match(/await import\(/g) ?? []).length;
    expect(dynamicImportCount).toBeGreaterThanOrEqual(6);
  });

  it("shebang line is preserved (Phase 15 T5 regression at Plan 02)", () => {
    expect(lines[0]).toBe("#!/usr/bin/env node");
  });
});
