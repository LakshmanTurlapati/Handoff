#!/usr/bin/env node
/**
 * Produce dist/main.js — the Node 22 ESM fallback bundle the shim imports
 * when no platform binary matches.
 *
 * Two-step build:
 *
 *   1. Copy the hand-authored shim from src/shim/cli.shim.js to
 *      dist/cli.js (the production location of the bin entry referenced
 *      by `bin: { achilles: "./dist/cli.js" }` in package.json). chmod
 *      0o755 the copy so npm tarball extraction preserves the executable
 *      bit (RESEARCH.md Pitfall 4).
 *
 *   2. Run esbuild over src/cli.ts producing dist/main.js per
 *      RESEARCH.md Pattern 4 (lines 391-415): platform=node, target=node22,
 *      format=esm, banner=`#!/usr/bin/env node`, sourcemap=linked,
 *      legalComments=linked. The five workspace voice/bridge/skill
 *      packages are marked external so Phase 17 can wire them without
 *      touching this script.
 *
 * Logging contract (CLAUDE.md global: NO emojis; defence in depth):
 *   - Success: log to stdout with the literal prefix `[achilles] `.
 *   - Failure: log to stderr.
 *
 * Requires esbuild (workspace devDep, pinned in apps/achilles-terminal/package.json).
 * Node 22 stdlib otherwise.
 */

import * as esbuild from "esbuild";
import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, "..");

const SHIM_SRC = join(WORKSPACE, "src/shim/cli.shim.js");
const DIST_DIR = join(WORKSPACE, "dist");
const DIST_CLI = join(DIST_DIR, "cli.js");
const DIST_MAIN = join(DIST_DIR, "main.js");

try {
  // Step 1: materialize the shim at its production location.
  mkdirSync(DIST_DIR, { recursive: true });
  copyFileSync(SHIM_SRC, DIST_CLI);
  chmodSync(DIST_CLI, 0o755);
  process.stdout.write("[achilles] Copied shim to dist/cli.js\n");

  // Step 2: esbuild the Node 22 ESM fallback bundle.
  await esbuild.build({
    entryPoints: [join(WORKSPACE, "src/cli.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: DIST_MAIN,
    // Workspace internal deps stay external — they resolve via node_modules
    // at runtime (Phase 17 wires the imports; Phase 15's cli.ts imports
    // none of them but listing them here locks the contract).
    external: [
      "@achilles/voice-protocol",
      "@achilles/voice-stt",
      "@achilles/voice-tts",
      "@achilles/claude-code-bridge",
      "@achilles/achilles-skill",
    ],
    // RESEARCH.md Pattern 4 specifies `banner: { js: "#!/usr/bin/env node" }`,
    // but in our actual production layout dist/main.js is dynamically
    // imported by dist/cli.js (the shim) — never invoked directly as a
    // bin entry. src/cli.ts already carries its own shebang, which esbuild
    // bundles into the output body; adding an esbuild banner would
    // produce a duplicate shebang on line 2 that the ESM parser rejects
    // with "Invalid or unexpected token". The shebang stays on dist/cli.js
    // (the shim, which IS the bin entry) instead. Banner intentionally
    // omitted — recorded as deviation D-15-04 (see 15-DEVIATIONS.md).
    sourcemap: "linked",
    legalComments: "linked",
  });

  process.stdout.write(
    "[achilles] Built dist/main.js (Node 22 ESM fallback bundle).\n",
  );
} catch (e) {
  process.stderr.write(
    `[achilles] build-node-bundle FAILED: ${e && e.message ? e.message : String(e)}\n`,
  );
  process.exit(1);
}
