/**
 * Phase 19 Plan 03 Task 3 -- shape contract for the release workflow.
 *
 * Parses .github/workflows/achilles-release.yml (as text, no YAML parser
 * dependency added) and asserts the load-bearing structural properties:
 *
 *   1. Triggers: workflow_dispatch + push.tags:["v*"]; NO push.branches
 *      (operator-gated release per CLAUDE.md "never auto-run applications").
 *   2. Concurrency block with cancel-in-progress: false.
 *   3. Permissions: contents:read + id-token:write (for --provenance).
 *   4. Matrix build covers EXACTLY 3 platforms (linux-x64, linux-arm64,
 *      win32-x64); NO darwin entries (D-01/D-02 Option 3 lock).
 *   5. Sequential publish order (RESEARCH Pattern 2): the 5 publish steps
 *      appear in exactly this order:
 *      a. @achilles/cli-linux-x64
 *      b. @achilles/cli-linux-arm64
 *      c. @achilles/cli-win32-x64
 *      d. @achilles/achilles-skill
 *      e. achilles (parent LAST)
 *   6. Every publish step uses --access public + --provenance and the
 *      NODE_AUTH_TOKEN env from secrets.NPM_PUBLISH_TOKEN.
 *   7. sleep 30 + npm view assertions for CDN propagation (Pitfall 9).
 *   8. macos-smoke job exists, depends on publish, runs on macos-14, and
 *      runs `bunx achilles@... --version` against the published artifact
 *      (DIST-06 Bun lane CI gate).
 *   9. macos-smoke job publishes NOTHING (Pitfall 5).
 *
 * No emojis (CLAUDE.md global).
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const WORKFLOW_PATH = resolve(
  REPO_ROOT,
  ".github/workflows/achilles-release.yml",
);

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("achilles-release.yml shape contract", () => {
  test("file exists and is non-empty", () => {
    const text = workflow();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("name: achilles-release");
  });

  test("triggers: workflow_dispatch + push.tags:[v*] (no push.branches)", () => {
    const text = workflow();
    expect(text).toContain("workflow_dispatch:");
    expect(text).toMatch(/push:\s*\n\s*tags:/);
    expect(text).toContain('"v*"');
    // The operator-gate rule: no auto-trigger on push to main/Achilles.
    expect(text).not.toMatch(/push:\s*\n\s*branches:/);
  });

  test("concurrency block with cancel-in-progress: false", () => {
    const text = workflow();
    expect(text).toMatch(/concurrency:\s*\n/);
    expect(text).toMatch(/cancel-in-progress:\s*false/);
  });

  test("permissions: contents:read + id-token:write (for --provenance)", () => {
    const text = workflow();
    expect(text).toMatch(/permissions:\s*\n[\s\S]*?contents:\s*read/);
    expect(text).toMatch(/permissions:\s*\n[\s\S]*?id-token:\s*write/);
  });

  test("matrix build covers EXACTLY 3 platforms: linux-x64, linux-arm64, win32-x64 (no darwin)", () => {
    const text = workflow();
    expect(text).toContain("bun-linux-x64");
    expect(text).toContain("bun-linux-arm64");
    expect(text).toContain("bun-windows-x64");
    expect(text).not.toContain("darwin");
    expect(text).not.toContain("bun-darwin");
  });

  test("publish steps appear in Pattern 2 order: siblings -> achilles-skill -> parent achilles LAST", () => {
    const text = workflow();
    const expectedOrder = [
      "@achilles/cli-linux-x64",
      "@achilles/cli-linux-arm64",
      "@achilles/cli-win32-x64",
      "@achilles/achilles-skill",
    ];
    let cursor = 0;
    for (const token of expectedOrder) {
      const i = text.indexOf(token, cursor);
      expect(i, `expected '${token}' after position ${cursor}`).toBeGreaterThanOrEqual(0);
      cursor = i + token.length;
    }
    // The parent 'achilles' name appears LAST as a publish step. Look
    // for the publish step's job-id 'Publish achilles (parent)' so we
    // do not accidentally match every prior `achilles-*` occurrence.
    const parentPublishIdx = text.indexOf("Publish achilles (parent)");
    expect(parentPublishIdx).toBeGreaterThan(cursor);
  });

  test("every publish step uses --access public + --provenance and NODE_AUTH_TOKEN from secrets.NPM_PUBLISH_TOKEN", () => {
    const text = workflow();
    const provenanceCount = (text.match(/--provenance/g) ?? []).length;
    // 5 publish steps: 3 siblings + skill + parent.
    expect(provenanceCount).toBeGreaterThanOrEqual(5);

    const accessPublicCount = (text.match(/--access public/g) ?? []).length;
    expect(accessPublicCount).toBeGreaterThanOrEqual(5);

    const nodeAuthRefCount = (
      text.match(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_PUBLISH_TOKEN\s*\}\}/g) ?? []
    ).length;
    expect(nodeAuthRefCount).toBeGreaterThanOrEqual(5);
  });

  test("sleep 30 + npm view assertions for CDN propagation (Pitfall 9)", () => {
    const text = workflow();
    expect(text).toMatch(/sleep 30/);
    // 5 npm view assertions for the 5 packages.
    const npmViewCount = (text.match(/npm view /g) ?? []).length;
    expect(npmViewCount).toBeGreaterThanOrEqual(5);
  });

  test("macos-smoke job exists, depends on publish, runs on macos-14, runs bunx achilles@<v> --version", () => {
    const text = workflow();
    expect(text).toMatch(/macos-smoke:/);
    // Job dependency: depends on publish.
    expect(text).toMatch(/macos-smoke:[\s\S]*?needs:\s*publish/);
    // Runs on macos-14.
    expect(text).toMatch(/macos-smoke:[\s\S]*?runs-on:\s*macos-14/);
    // The Bun lane smoke -- bunx achilles@<version> --version.
    expect(text).toMatch(/bunx achilles@/);
  });

  test("macos-smoke publishes NOTHING (Pitfall 5)", () => {
    const text = workflow();
    // Extract the macos-smoke job block (from 'macos-smoke:' to the next
    // top-level job key, end of file, or the next job line at the same
    // indent). Since we're using a YAML-as-text approach, just find the
    // macos-smoke block as the last job.
    const macosSmokeIdx = text.indexOf("macos-smoke:");
    expect(macosSmokeIdx).toBeGreaterThan(0);
    const macosSmokeBlock = text.slice(macosSmokeIdx);
    // No `npm publish` line in this job.
    expect(macosSmokeBlock).not.toMatch(/npm publish/);
  });

  test("setup-node uses node-version 22 + registry-url https://registry.npmjs.org for publish steps", () => {
    const text = workflow();
    expect(text).toMatch(/node-version:\s*["']?22["']?/);
    expect(text).toMatch(/registry-url:\s*["']https:\/\/registry\.npmjs\.org["']/);
  });

  test("no emoji codepoints in the workflow file", () => {
    const text = workflow();
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      expect(
        !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
        `emoji codepoint U+${cp.toString(16)} found in workflow file`,
      ).toBe(true);
    }
  });
});
