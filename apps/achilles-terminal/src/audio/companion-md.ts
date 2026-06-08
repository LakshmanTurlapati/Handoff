/**
 * Phase 17, Plan 01, Task 1 — companion.md embedded-asset loader +
 * SHA-256 source-of-truth verifier.
 *
 * Two pure helpers consumed by Plan 03's claude-bridge (which passes
 * the resolved path to `claude -p --append-system-prompt-file
 * <companionPromptPath>`) and by the new LOOP-02 CI gate at
 * apps/achilles-terminal/scripts/check-source-of-truth.mjs.
 *
 * Path resolution:
 *   - Under Bun --compile (the binary path) the prompt is embedded as
 *     a bundled asset; @achilles/achilles-skill's `companionPromptPath`
 *     export resolves to the embedded absolute path
 *   - Under Node fallback (the JS-fallback path) the prompt resolves
 *     to the on-disk workspace location via the same import
 *
 * SHA-256 verification:
 *   - SOURCE_OF_TRUTH_HASH is embedded as a locked const at
 *     plan-execution time (executor computed the hex once via
 *     `node -e ...` at Task 1 entry). Drift detection happens by
 *     reading the file at the resolved path and comparing the
 *     computed digest to this const. Under Bun --compile the embedded
 *     bytes cannot drift (they are part of the binary); under Node
 *     fallback the file may be tampered with, and this verifier is
 *     the gate that catches the drift.
 *
 * Purity:
 *   - No console output
 *   - No clock reads (Date.now is not invoked)
 *   - No mutation of module-level state
 *   - The two exports are a string-returning function and a
 *     Promise-returning function — both deterministic over their
 *     inputs.
 *
 * Threat model:
 *   - T-17-02 mitigation: the embedded SOURCE_OF_TRUTH_HASH refuses
 *     any companion.md whose bytes differ from the v1.2-pinned hash;
 *     the CI gate fails on drift before the binary publishes.
 *
 * No emojis (CLAUDE.md global).
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { companionPromptPath } from "@achilles/achilles-skill";

/**
 * Locked SHA-256 hex digest of
 * packages/achilles-skill/skill/prompts/companion.md at Phase 17 plan
 * execution time. Computed once by the executor via:
 *
 *   node -e 'import("node:fs/promises").then(fs =>
 *     fs.readFile("packages/achilles-skill/skill/prompts/companion.md")
 *       .then(b => import("node:crypto").then(c =>
 *         console.log(c.createHash("sha256").update(b).digest("hex"))
 *       ))
 *   )'
 *
 * The hex prefix (first 12 chars) is logged in SUMMARY.md so a future
 * editor can confirm the hash they computed against companion.md still
 * matches this gate.
 *
 * @public
 */
export const SOURCE_OF_TRUTH_HASH =
  "e1308c2af287e372020ed8f5c97d74c773e602947a2f1824521648d9a4da692c";

/**
 * Resolved absolute filesystem path to the embedded companion system
 * prompt body. Delegates to @achilles/achilles-skill's
 * `companionPromptPath` export — that package owns the dual-mode
 * (Bun --compile bundle vs Node on-disk) resolution logic.
 *
 * Returns a string deterministically for the lifetime of the process.
 * Production callers pass the returned path to:
 *
 *   spawn("claude", ["-p", "--append-system-prompt-file", path, ...])
 *
 * via the Wave 2 claude-bridge wrapper.
 *
 * Pure: no side effects, no clock reads.
 *
 * @public
 */
export function resolveCompanionPromptPath(): string {
  return companionPromptPath;
}

/**
 * Result of {@link verifyCompanionSha256}. The `expected` field
 * carries the locked SOURCE_OF_TRUTH_HASH; the `actual` field carries
 * the digest of the on-disk bytes; `ok` is the strict-equality
 * verdict. Callers that need a boolean gate use `ok`; callers that
 * want to log a 12-char prefix on drift can format
 * `actual.slice(0, 12)` and `expected.slice(0, 12)`.
 *
 * @public
 */
export interface CompanionShaVerification {
  readonly ok: boolean;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Read the file at the supplied path and compare its SHA-256 hex
 * digest against the embedded SOURCE_OF_TRUTH_HASH. Returns the
 * verification result; never throws on a non-matching hash. The
 * underlying readFile call may reject if the path does not exist — in
 * that case, the caller's await will surface the error (the verifier
 * does NOT swallow read errors because a missing companion.md is a
 * blocking gate failure, not a "drift detected" outcome).
 *
 * @public
 */
export async function verifyCompanionSha256(
  path: string,
): Promise<CompanionShaVerification> {
  const bytes = await readFile(path);
  const hasher = createHash("sha256");
  hasher.update(bytes);
  const actual = hasher.digest("hex");
  return {
    ok: actual === SOURCE_OF_TRUTH_HASH,
    expected: SOURCE_OF_TRUTH_HASH,
    actual,
  };
}
