/**
 * Phase 19, Plan 01, Task 1 — RED contract test for D-01 / D-02 darwin
 * sibling drop + achilles-skill version pin.
 *
 * Asserts the publish-ready shape of apps/achilles-terminal/package.json
 * after the macOS Option 3 lock + the v1.3.0 version flip on the workspace
 * @achilles/achilles-skill dependency:
 *
 *   1. optionalDependencies has exactly 3 entries (no darwin)
 *   2. No "darwin" string appears anywhere in optionalDependencies (regex)
 *   3. Each surviving entry is one of {linux-arm64, linux-x64, win32-x64}
 *      and pinned to "1.3.0"
 *   4. dependencies @achilles/achilles-skill is pinned to "1.3.0" (D-15-02
 *      version sync with the published achilles-skill package)
 *   5. apps/cli-darwin-arm64/ and apps/cli-darwin-x64/ directories do NOT
 *      exist on disk (D-01 hard removal, not no-op shim)
 *
 * Pattern: file-read + JSON.parse + assert, same shape as
 * apps/achilles-terminal/tests/cli.test.ts T8 (the package-json-version
 * read). No spawnSync, no child process — pure structural assertion.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(HERE, "..", "package.json");
const REPO_ROOT = resolve(HERE, "..", "..", "..");

interface PackageJsonShape {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function readPkg(): PackageJsonShape {
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as PackageJsonShape;
}

describe("apps/achilles-terminal/package.json shape (D-01 / D-02)", () => {
  it("optionalDependencies has exactly 3 entries (no darwin)", () => {
    const pkg = readPkg();
    const keys = Object.keys(pkg.optionalDependencies ?? {});
    expect(keys.length).toBe(3);
  });

  it("optionalDependencies contains no 'darwin' substring (D-01 hard drop)", () => {
    const pkg = readPkg();
    const serialized = JSON.stringify(pkg.optionalDependencies ?? {});
    expect(/darwin/.test(serialized)).toBe(false);
  });

  it("optionalDependencies entries are the locked 3 platforms", () => {
    const pkg = readPkg();
    const keys = Object.keys(pkg.optionalDependencies ?? {}).sort();
    expect(keys).toEqual([
      "@achilles/cli-linux-arm64",
      "@achilles/cli-linux-x64",
      "@achilles/cli-win32-x64",
    ]);
  });

  it("each surviving optional sibling is pinned to 1.3.0", () => {
    const pkg = readPkg();
    const versions = Object.values(pkg.optionalDependencies ?? {});
    for (const v of versions) {
      expect(v).toBe("1.3.0");
    }
  });

  it("dependencies @achilles/achilles-skill pins to 1.3.0 (D-15-02 sync)", () => {
    const pkg = readPkg();
    const pin = pkg.dependencies?.["@achilles/achilles-skill"];
    expect(pin).toBe("1.3.0");
  });

  it("apps/cli-darwin-arm64/ directory is absent on disk (D-01 hard removal)", () => {
    const darwinArm64 = resolve(REPO_ROOT, "apps", "cli-darwin-arm64");
    expect(existsSync(darwinArm64)).toBe(false);
  });

  it("apps/cli-darwin-x64/ directory is absent on disk (D-01 hard removal)", () => {
    const darwinX64 = resolve(REPO_ROOT, "apps", "cli-darwin-x64");
    expect(existsSync(darwinX64)).toBe(false);
  });
});
