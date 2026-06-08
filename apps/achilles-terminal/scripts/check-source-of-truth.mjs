#!/usr/bin/env node
/**
 * Phase 17, Plan 01, Task 1 — companion.md SHA-256 source-of-truth
 * CI gate.
 *
 * Ported from apps/achilles-cli/scripts/check-source-of-truth.mjs
 * with the following adaptations for Phase 17:
 *
 *   - Phase 17 does NOT publish (Phase 19 owns publish-then-cut), so
 *     the bundled-tarball arm of the v1.2 check is REMOVED. Only the
 *     source-vs-embedded-hash arm remains.
 *
 *   - The script compares the SHA-256 of the source-of-truth file
 *     `packages/achilles-skill/skill/prompts/companion.md` against
 *     the SOURCE_OF_TRUTH_HASH const embedded inside
 *     `apps/achilles-terminal/src/audio/companion-md.ts`. A drift
 *     here surfaces either (a) the source-of-truth file was edited
 *     without updating the const, or (b) the const was edited but the
 *     source-of-truth file was not — both shapes block LOOP-02.
 *
 *   - On match: exits 0 with a stdout line. On drift: exits 1 with a
 *     stderr line that includes ONLY the 12-hex prefixes of the two
 *     SHAs. Full bytes are NEVER logged (defence in depth — the file
 *     body is a system prompt and could itself carry contract text
 *     that a careless contributor might log into CI).
 *
 * Invocation:
 *
 *   npm run check:source-of-truth --workspace apps/achilles-terminal
 *
 * or directly:
 *
 *   node apps/achilles-terminal/scripts/check-source-of-truth.mjs
 *
 * No external dependencies. Node 22 stdlib only.
 *
 * No emojis (CLAUDE.md global).
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/achilles-terminal/scripts/; the repo root is
// three directories up.
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/**
 * Compute the SHA-256 hex digest of a Buffer.
 */
function sha256Hex(buf) {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

/**
 * Read the SOURCE_OF_TRUTH_HASH const from
 * apps/achilles-terminal/src/audio/companion-md.ts via a strict regex.
 * The regex matches a 64-char hex string assigned to the const.
 * Returns the hash or null if no match.
 */
function readEmbeddedHash() {
  const companionMdPath = resolve(
    REPO_ROOT,
    "apps/achilles-terminal/src/audio/companion-md.ts",
  );
  const src = readFileSync(companionMdPath, "utf8");
  const match = src.match(
    /SOURCE_OF_TRUTH_HASH\s*=\s*"([0-9a-f]{64})"/,
  );
  return match ? match[1] : null;
}

async function main() {
  const sourcePath = resolve(
    REPO_ROOT,
    "packages/achilles-skill/skill/prompts/companion.md",
  );

  let sourceBytes;
  try {
    sourceBytes = await readFile(sourcePath);
  } catch (e) {
    process.stderr.write(
      `[achilles] source missing expected file: ${sourcePath} (${
        e.code ?? e.message
      })\n`,
    );
    process.exit(1);
  }

  const embeddedHash = readEmbeddedHash();
  if (embeddedHash === null) {
    process.stderr.write(
      "[achilles] embedded SOURCE_OF_TRUTH_HASH not found in apps/achilles-terminal/src/audio/companion-md.ts\n",
    );
    process.exit(1);
  }

  const sourceSha = sha256Hex(sourceBytes);

  if (sourceSha === embeddedHash) {
    process.stdout.write(
      `[achilles] source-of-truth: companion.md SHA-256 match (${sourceSha.slice(
        0,
        12,
      )})\n`,
    );
    process.exit(0);
  } else {
    // Defence in depth: log only the truncated SHA-256 prefixes;
    // NEVER log the file bytes themselves.
    process.stderr.write(
      `[achilles] companion.md SHA-256 drift: file=${sourceSha.slice(
        0,
        12,
      )} embedded=${embeddedHash.slice(0, 12)}\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(
    `[achilles] source-of-truth check failed: ${e.message}\n`,
  );
  process.exit(1);
});
