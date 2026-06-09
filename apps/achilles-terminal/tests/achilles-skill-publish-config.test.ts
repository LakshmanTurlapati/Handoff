/**
 * Phase 19, Plan 01, Task 1 — RED contract test for DIST-03 achilles-skill
 * publish-config shape.
 *
 * Asserts the publish-ready shape of packages/achilles-skill/package.json
 * after the v1.3.0 release flip:
 *
 *   1. version is "1.3.0" (bump from 0.1.0)
 *   2. private is false (RESEARCH §Pitfall 2 — npm publish fails with
 *      EPRIVATE when this flag is true)
 *   3. publishConfig.access is "public" (RESEARCH §Anti-Patterns row 5 —
 *      required for first-time @-scoped publishes; without it npm errors
 *      with E402 Payment Required)
 *   4. name remains "@achilles/achilles-skill" (no scope rename)
 *
 * Pattern: file-read + JSON.parse + assert. No spawnSync.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "achilles-skill",
  "package.json",
);

interface PackageJsonShape {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly publishConfig?: { readonly access?: string };
}

function readPkg(): PackageJsonShape {
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as PackageJsonShape;
}

describe("packages/achilles-skill/package.json publish config (DIST-03)", () => {
  it("name is the scoped @achilles/achilles-skill (unchanged)", () => {
    const pkg = readPkg();
    expect(pkg.name).toBe("@achilles/achilles-skill");
  });

  it("version is bumped to 1.3.0", () => {
    const pkg = readPkg();
    expect(pkg.version).toBe("1.3.0");
  });

  it("private flag is flipped to false (RESEARCH §Pitfall 2)", () => {
    const pkg = readPkg();
    expect(pkg.private).toBe(false);
  });

  it("publishConfig.access is 'public' (RESEARCH §Anti-Patterns row 5)", () => {
    const pkg = readPkg();
    expect(pkg.publishConfig?.access).toBe("public");
  });
});
