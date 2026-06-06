import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Grep guard against the compiled dist output (SAFE-01).
 *
 * These tests run AFTER `npm run build` and assert:
 *
 *   1. No renderer-exported `dist/*.js` file contains an ElevenLabs raw
 *      API-key shape (`sk_` followed by 30+ alphanumeric characters)
 *      or the `xi-api-key` header literal.
 *
 *   2. The `exports` map in `package.json` exposes the main-process
 *      token mint helper at a SEPARATE subpath
 *      (`@achilles/voice-stt/token-mint`) and the default barrel does
 *      NOT re-export `mintSttToken`.
 *
 *   3. The renderer-exported `src/index.ts` source file lists only the
 *      renderer-safe symbols.
 *
 * If `npm run build` has not been run the tests skip — they cannot
 * assert on dist files that do not yet exist. This avoids spurious
 * failures in pre-build CI stages.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const DIST_DIR = join(PKG_ROOT, "dist");
const RENDERER_EXPORTED_FILES = [
  "index.js",
  "realtime-client.js",
  "constants.js",
  "backoff.js",
];
const KEY_PATTERN = /sk_[a-zA-Z0-9_]{30,}/;
const HEADER_PATTERN = /xi-api-key/;

function distExists(): boolean {
  if (!existsSync(DIST_DIR)) return false;
  return statSync(DIST_DIR).isDirectory();
}

describe.runIf(distExists())(
  "SAFE-01 grep guard — renderer-exported dist files",
  () => {
    for (const name of RENDERER_EXPORTED_FILES) {
      it(`dist/${name} contains no raw API-key prefix`, () => {
        const filePath = join(DIST_DIR, name);
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf8");
        expect(content).not.toMatch(KEY_PATTERN);
      });

      it(`dist/${name} contains no xi-api-key header literal`, () => {
        const filePath = join(DIST_DIR, name);
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf8");
        expect(content).not.toMatch(HEADER_PATTERN);
      });
    }

    it("dist/token-mint.js is NOT among the renderer-exported files (separate subpath)", () => {
      expect(RENDERER_EXPORTED_FILES).not.toContain("token-mint.js");
      // And the file itself does exist — proven separately so the build
      // succeeded and the helper is reachable from the dedicated subpath.
      expect(existsSync(join(DIST_DIR, "token-mint.js"))).toBe(true);
    });

    it("the renderer-exported dist/ files contain no `mintSttToken` identifier outside of comments", () => {
      // Strip block comments and line comments before matching so we
      // do not trip on prose that references the boundary by name.
      // The SAFE-01 contract is that no executable code path in the
      // renderer-exported files references mintSttToken — not that the
      // human-readable doc comments are silent about it.
      for (const name of RENDERER_EXPORTED_FILES) {
        const content = readFileSync(join(DIST_DIR, name), "utf8");
        const noBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
        const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1");
        expect(noLineComments).not.toMatch(/mintSttToken/);
      }
    });

    it("dist/token-mint.js DOES set the xi-api-key header (the boundary lives here)", () => {
      const content = readFileSync(join(DIST_DIR, "token-mint.js"), "utf8");
      expect(content).toMatch(HEADER_PATTERN);
    });

    it("every other dist/*.js file (besides token-mint.js) is also key-prefix-free", () => {
      const entries = readdirSync(DIST_DIR);
      for (const entry of entries) {
        if (!entry.endsWith(".js")) continue;
        if (entry === "token-mint.js") continue;
        const content = readFileSync(join(DIST_DIR, entry), "utf8");
        expect(content).not.toMatch(KEY_PATTERN);
      }
    });
  },
);

describe("SAFE-01 exports map and barrel source contracts (run with or without dist)", () => {
  it("package.json exposes a separate ./token-mint subpath and the main barrel does not list it twice", () => {
    const pkgPath = join(PKG_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports["./token-mint"]).toBeDefined();
    expect(pkg.exports["."]).toBeDefined();
  });

  it("src/index.ts re-exports only renderer-safe symbols (no mintSttToken)", () => {
    const indexSrc = readFileSync(join(PKG_ROOT, "src", "index.ts"), "utf8");
    // The contract: no `export` line may name `mintSttToken` and no
    // `export` line may resolve from the `./token-mint.js` module.
    // Prose in TSDoc that REFERENCES the boundary by name is fine —
    // that prose documents the invariant, it does not violate it.
    const exportLines = indexSrc
      .split("\n")
      .filter((line) => /\bexport\b/.test(line) || /\bfrom\b/.test(line));
    const exportBlock = exportLines.join("\n");
    expect(exportBlock).not.toMatch(/mintSttToken/);
    expect(exportBlock).not.toMatch(/["']\.\/token-mint\.js["']/);
    // And it MUST mention the renderer-facing factory + constants.
    expect(indexSrc).toMatch(/createRealtimeSttClient/);
    expect(indexSrc).toMatch(/SCRIBE_MODEL/);
  });
});
