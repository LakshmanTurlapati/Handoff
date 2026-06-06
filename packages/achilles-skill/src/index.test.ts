/**
 * Path-resolution + on-disk existence tests for the @achilles/achilles-skill
 * barrel.
 *
 * Scope of THIS file:
 *
 *   - The exported `companionPromptPath` is a string ending with the
 *     literal segment "/skill/prompts/companion.md"
 *   - The file referenced by `companionPromptPath` exists on disk
 *   - The file referenced by `companionPromptPath` has non-empty content
 *   - The exported `SKILL_PROMPTS_DIR` is a string ending with the literal
 *     segment "/skill/prompts" (no trailing slash)
 *   - `path.resolve(SKILL_PROMPTS_DIR, "companion.md") === companionPromptPath`
 *
 * The prompt body CONTENT contract (PROMPT-02/03/04/05 markers, word
 * caps, marker syntax, error-override phrase, forbidden emoji) is the
 * scope of prompt-content.test.ts — kept separate so a failing content
 * test does not mask a path-resolution regression and vice versa.
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md PROMPT-01 — single source of truth (the path
 *     resolution machinery this file exercises)
 *
 * Notes on test discipline:
 *
 *   - No console.* logging (tests use vitest's expect for assertions)
 *   - Synchronous fs APIs are acceptable in tests; the file system
 *     touches are bounded by a single readFileSync per test
 *   - NO emojis in assertion error messages or test names
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SKILL_PROMPTS_DIR, companionPromptPath } from "./index.js";

describe("@achilles/achilles-skill: path resolution surface", () => {
  it("companionPromptPath ends with /skill/prompts/companion.md", () => {
    expect(companionPromptPath.endsWith("/skill/prompts/companion.md")).toBe(
      true,
    );
  });

  it("companionPromptPath is absolute", () => {
    // A weak assertion that path resolution actually ran; strict
    // path.isAbsolute is left to the next test. On POSIX an absolute
    // path starts with "/"; on Windows the test runs only on macOS/Linux
    // in CI per the v1.2 milestone scope (NO Electron in CI, but Vitest
    // runs on POSIX-shaped paths in the dev environment).
    expect(companionPromptPath.startsWith("/")).toBe(true);
  });

  it("file referenced by companionPromptPath exists on disk", () => {
    expect(existsSync(companionPromptPath)).toBe(true);
  });

  it("file referenced by companionPromptPath has non-empty content", () => {
    const body = readFileSync(companionPromptPath, "utf8").trim();
    expect(body.length).toBeGreaterThan(0);
  });

  it("SKILL_PROMPTS_DIR ends with /skill/prompts (no trailing slash)", () => {
    expect(SKILL_PROMPTS_DIR.endsWith("/skill/prompts")).toBe(true);
    expect(SKILL_PROMPTS_DIR.endsWith("/skill/prompts/")).toBe(false);
  });

  it("path.resolve(SKILL_PROMPTS_DIR, 'companion.md') equals companionPromptPath", () => {
    expect(resolve(SKILL_PROMPTS_DIR, "companion.md")).toBe(companionPromptPath);
  });
});
