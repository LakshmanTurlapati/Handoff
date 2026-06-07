/**
 * Tests for the package.json + root scripts wiring required by Plan 13-04
 * Task 1.
 *
 * BD1: apps/achilles-cli/package.json has bundledDependencies including
 *      @achilles/achilles-skill (so npm pack inlines the workspace dep).
 * BD2: apps/achilles-cli/package.json has the prepublishOnly script
 *      that chains source-of-truth + tarball-no-secrets checks.
 * RS1: root package.json exposes three new scripts: check:source-of-truth,
 *      check:tarball:secrets, check:dist.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

async function readJson(relPath) {
  const raw = await readFile(resolve(REPO_ROOT, relPath), "utf8");
  return JSON.parse(raw);
}

test("BD1: apps/achilles-cli/package.json has bundledDependencies including @achilles/achilles-skill", async () => {
  const pkg = await readJson("apps/achilles-cli/package.json");
  assert.ok(
    Array.isArray(pkg.bundledDependencies),
    `expected bundledDependencies array, got: ${typeof pkg.bundledDependencies}`,
  );
  assert.ok(
    pkg.bundledDependencies.includes("@achilles/achilles-skill"),
    `expected @achilles/achilles-skill in bundledDependencies, got: ${JSON.stringify(pkg.bundledDependencies)}`,
  );
  // The dependency declaration must still exist so npm resolves the
  // workspace symlink at install + pack time.
  assert.ok(
    pkg.dependencies?.["@achilles/achilles-skill"],
    "expected @achilles/achilles-skill in dependencies (still required so npm resolves workspace dep)",
  );
});

test("BD2: apps/achilles-cli/package.json prepublishOnly chains both checks in the correct order", async () => {
  const pkg = await readJson("apps/achilles-cli/package.json");
  assert.equal(
    pkg.scripts?.prepublishOnly,
    "node scripts/check-source-of-truth.mjs && node scripts/check-tarball-no-secrets.mjs",
    `unexpected prepublishOnly: ${pkg.scripts?.prepublishOnly}`,
  );
});

test("RS1: root package.json exposes check:source-of-truth, check:tarball:secrets, check:dist", async () => {
  const pkg = await readJson("package.json");
  assert.ok(
    pkg.scripts?.["check:source-of-truth"]?.includes(
      "check-source-of-truth.mjs",
    ),
    `expected check:source-of-truth script, got: ${pkg.scripts?.["check:source-of-truth"]}`,
  );
  assert.ok(
    pkg.scripts?.["check:tarball:secrets"]?.includes(
      "check-tarball-no-secrets.mjs",
    ),
    `expected check:tarball:secrets script, got: ${pkg.scripts?.["check:tarball:secrets"]}`,
  );
  // The composite chain runs both via `&&` so a non-zero from either fails fast.
  assert.ok(
    pkg.scripts?.["check:dist"]?.includes("check:source-of-truth") &&
      pkg.scripts?.["check:dist"]?.includes("check:tarball:secrets") &&
      pkg.scripts?.["check:dist"]?.includes("&&"),
    `expected check:dist composite chain, got: ${pkg.scripts?.["check:dist"]}`,
  );
});
