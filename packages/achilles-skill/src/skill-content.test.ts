/**
 * SKILL.md content contract gate for the Plan 13-02 Claude Code skill body.
 *
 * Scope of THIS file:
 *
 *   - S1: YAML frontmatter present with required keys (name, description,
 *     allowed-tools)
 *   - S2: post-frontmatter body word count <= 2000 (Pitfall #11 skill
 *     bundle scope creep guard)
 *   - S3: zero emoji codepoints anywhere in the file (CLAUDE.md global)
 *   - S4: body contains the literal string `prompts/companion.md` exactly
 *     once (single canonical token for Plan 13-04's drift diff)
 *   - S5: the skill/ directory contains only markdown + the prompts/
 *     subdirectory; no executables (Pitfall #11 + community security)
 *   - S6: body contains the literal substring `achilles launch` (the CLI
 *     launch command shipped by Plan 13-01)
 *   - S7: body contains the substring `I ran into a problem` (PROMPT-05
 *     informational reference; not contractual — contract lives in
 *     companion.md)
 *   - S8: any claude-version pin must be of the form `>= <semver>` with a
 *     concrete `\d+\.\d+\.\d+` token (Pitfall #24 — no value-less pin)
 *   - P1: packages/achilles-skill/package.json `files` array includes
 *     both `dist` and `skill`
 *   - P2: packages/achilles-skill/package.json `private` field === true
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md DIST-02 — `achilles install-skill` symlinks the
 *     skill body into the Claude Code skills directory
 *   - REQUIREMENTS.md DIST-03 — single source of truth: skill body and
 *     CLI launch path reference the same `packages/achilles-skill/skill/
 *     prompts/companion.md`
 *   - PITFALLS.md #11 — skill bundle scope creep / executable artefact
 *     guard (target body 1500-2000 words, no native binaries)
 *
 * Notes on test discipline:
 *
 *   - File is read ONCE in beforeAll and shared across tests
 *   - Synchronous fs APIs are acceptable in tests; this is a small file
 *     read bounded by a single readFileSync
 *   - NO emojis in assertion messages or test names (CLAUDE.md global)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { SKILL_PROMPTS_DIR } from "./index.js";

// SKILL.md lives at the skill root (one level up from the prompts dir);
// the install-skill command symlinks this directory into
// ~/.claude/skills/achilles/ so Claude Code's skill discovery picks up
// the manifest at the standard path.
const SKILL_ROOT = resolve(SKILL_PROMPTS_DIR, "..");
const SKILL_MD_PATH = resolve(SKILL_ROOT, "SKILL.md");
const PACKAGE_ROOT = resolve(SKILL_ROOT, "..");
const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, "package.json");

interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

interface ParsedPackageJson {
  files?: string[];
  private?: boolean;
}

let parsed: ParsedSkill;
let pkg: ParsedPackageJson;

/**
 * Minimal YAML frontmatter parser scoped to the keys this contract
 * gates: `name` (string), `description` (string), `allowed-tools`
 * (string or array). Supports single-line `key: value`, single-line
 * `key: [a, b, c]`, and multi-line block lists (`key:` then `  - item`).
 * A full YAML parser is intentionally not pulled in — the surface is
 * small and the parser failure mode is "test sees the wrong shape and
 * fails", which is the desired behaviour.
 */
function parseFrontmatter(text: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  const rawFm = match[1] ?? "";
  const body = match[2] ?? "";
  const lines = rawFm.split(/\r?\n/);
  const fm: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const inline = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!inline) {
      i += 1;
      continue;
    }
    const key = inline[1] ?? "";
    const rest = (inline[2] ?? "").trim();
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (inner === "") {
        fm[key] = [];
      } else {
        fm[key] = inner
          .split(",")
          .map((tok) => tok.trim().replace(/^["']|["']$/g, ""));
      }
      i += 1;
      continue;
    }
    if (rest === "") {
      // possible block list
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        const itemMatch = next.match(/^\s*-\s+(.*)$/);
        if (itemMatch) {
          const v = (itemMatch[1] ?? "")
            .trim()
            .replace(/^["']|["']$/g, "");
          items.push(v);
          j += 1;
        } else if (next.trim() === "") {
          j += 1;
        } else {
          break;
        }
      }
      if (items.length > 0) {
        fm[key] = items;
        i = j;
        continue;
      }
      fm[key] = "";
      i += 1;
      continue;
    }
    // strip surrounding quotes if present
    const unquoted = rest.replace(/^["']|["']$/g, "");
    fm[key] = unquoted;
    i += 1;
  }
  return { frontmatter: fm, body };
}

beforeAll(() => {
  const raw = readFileSync(SKILL_MD_PATH, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  parsed = { frontmatter, body, raw };
  const pkgRaw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  pkg = JSON.parse(pkgRaw) as ParsedPackageJson;
});

describe("S1: YAML frontmatter present with required keys", () => {
  it("frontmatter begins on line 1 with the --- delimiter", () => {
    expect(parsed.raw.startsWith("---\n") || parsed.raw.startsWith("---\r\n"))
      .toBe(true);
  });

  it("frontmatter has `name` equal to the literal string 'achilles'", () => {
    expect(parsed.frontmatter["name"]).toBe("achilles");
  });

  it("frontmatter has a non-empty `description` string of length 1..1024", () => {
    const desc = parsed.frontmatter["description"];
    expect(typeof desc).toBe("string");
    expect((desc as string).length).toBeGreaterThan(0);
    expect((desc as string).length).toBeLessThanOrEqual(1024);
  });

  it("frontmatter has `allowed-tools` as a non-empty string or non-empty array", () => {
    const tools = parsed.frontmatter["allowed-tools"];
    if (typeof tools === "string") {
      expect(tools.length).toBeGreaterThan(0);
    } else if (Array.isArray(tools)) {
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(typeof t).toBe("string");
        expect((t as string).length).toBeGreaterThan(0);
      }
    } else {
      throw new Error(
        "Pitfall #11 — allowed-tools must be a non-empty string or array",
      );
    }
  });
});

describe("S2: post-frontmatter body word count <= 2000", () => {
  it("body length (excluding frontmatter and fenced code blocks) is <= 2000 words", () => {
    // Strip fenced code blocks (``` ... ```), strip H1/H2 markdown markers
    // so heading hashes don't inflate the token count, then split on
    // whitespace. The pass threshold is documented per Pitfall #11.
    const noFences = parsed.body.replace(/```[\s\S]*?```/g, " ");
    const noHeadingMarkers = noFences.replace(/^#{1,6}\s+/gm, "");
    const tokens = noHeadingMarkers
      .split(/\s+/)
      .filter((tok) => tok.length > 0);
    const count = tokens.length;
    if (count > 2000) {
      throw new Error(
        `Pitfall #11 skill bundle scope creep — SKILL.md body must be <= 2000 words; got ${count}`,
      );
    }
    expect(count).toBeLessThanOrEqual(2000);
  });

  // WR-04 fix: tighten the soft budget. The hard ceiling is 2000 (per
  // Pitfall #11) but the negotiated soft budget is 1250 words —
  // Claude Code's skill-discovery cost model is sensitive to body
  // length and every Achilles user pays this overhead per session.
  // The summary tracking doc claimed 1250 but the file shipped at
  // 1360 before this fix. Asserting at 1250 prevents quiet drift.
  it("WR-04: body length is <= 1250 words (negotiated soft budget; hard cap is 2000)", () => {
    const noFences = parsed.body.replace(/```[\s\S]*?```/g, " ");
    const noHeadingMarkers = noFences.replace(/^#{1,6}\s+/gm, "");
    const tokens = noHeadingMarkers
      .split(/\s+/)
      .filter((tok) => tok.length > 0);
    const count = tokens.length;
    if (count > 1250) {
      throw new Error(
        `WR-04 SKILL.md soft budget — body must be <= 1250 words; got ${count}. Trim sections or update both the SUMMARY claim and this assertion.`,
      );
    }
    expect(count).toBeLessThanOrEqual(1250);
  });
});

describe("S3: no emoji codepoints anywhere in the file", () => {
  it("raw file body does NOT contain any Extended_Pictographic Unicode codepoints", () => {
    expect(/\p{Extended_Pictographic}/u.test(parsed.raw)).toBe(false);
  });

  it("raw file body does NOT contain emoji codepoints in U+1F000-U+1FFFF", () => {
    // Belt + braces: explicit codepoint window check.
    for (const ch of parsed.raw) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp >= 0x1f000 && cp <= 0x1ffff) {
        throw new Error(
          `Found disallowed emoji codepoint U+${cp.toString(16).toUpperCase()}`,
        );
      }
      if (cp >= 0x2600 && cp <= 0x27ff) {
        throw new Error(
          `Found disallowed dingbat codepoint U+${cp.toString(16).toUpperCase()}`,
        );
      }
    }
  });
});

describe("S4: body references companion.md exactly once", () => {
  it("body contains the literal string 'prompts/companion.md' exactly once", () => {
    const occurrences = parsed.body.match(/prompts\/companion\.md/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("S5: no executable artefacts under skill/", () => {
  const forbiddenExtensions = new Set([
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".cmd",
    ".bat",
    ".ps1",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".sh",
  ]);

  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, out);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }

  it("skill/ directory contains only .md files (no executables)", () => {
    const files: string[] = [];
    walk(SKILL_ROOT, files);
    const violations: string[] = [];
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (forbiddenExtensions.has(ext)) {
        violations.push(f);
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Pitfall #11 — skill bundle must be pure markdown + the prompts/ directory; found executables: ${violations.join(", ")}`,
      );
    }
    expect(violations).toEqual([]);
  });
});

describe("S6: body names the launch command 'achilles launch'", () => {
  it("body contains the literal substring 'achilles launch'", () => {
    expect(parsed.body.includes("achilles launch")).toBe(true);
  });
});

describe("S7: body informationally references PROMPT-05 phrase", () => {
  it("body contains the substring 'I ran into a problem'", () => {
    expect(parsed.body.includes("I ran into a problem")).toBe(true);
  });
});

describe("S8: claude-version pin (if present) names a concrete semver", () => {
  it("if a claude version is mentioned, the line includes a >= semver token", () => {
    const lines = parsed.body.split(/\r?\n/);
    for (const line of lines) {
      if (/claude.*version/i.test(line)) {
        // If this line names a version, it must include a `>= x.y.z`
        // semver per Pitfall #24 (no value-less pin).
        const hasSemver = />=\s*\d+\.\d+\.\d+/.test(line);
        if (!hasSemver) {
          throw new Error(
            `Pitfall #24 — claude version mention must include '>= <semver>' with a concrete x.y.z; offending line: ${line}`,
          );
        }
      }
    }
    // The test passes by default when no claude-version line is present.
    expect(true).toBe(true);
  });
});

describe("P1: package.json ships the skill/ directory", () => {
  it("files array includes both 'dist' and 'skill'", () => {
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("skill");
  });
});

describe("P2: package.json stays private", () => {
  it("`private` field equals true", () => {
    expect(pkg.private).toBe(true);
  });
});
